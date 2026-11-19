// Panel de proveedores (solo lectura): lo util de cada proveedor en una sola vista.
//   GET /proveedores/panel            por proveedor: ultima compra, comprado en 90 dias, lo que se le debe, proximo vencimiento y pedidos abiertos
//   GET /proveedores/:id/ficha        detalle de uno: compras recientes, cuentas por pagar, pagos y algunos productos
// No escribe nada; cada consulta va protegida para que, si falta una tabla, el resto siga funcionando.
const { responderError } = require("./error-utils");

module.exports = (app, pool, requerirAccesoNegocio) => {
    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
    const seguro = async (consulta, parametros) => { try { return (await pool.query(consulta, parametros)).rows; } catch (error) { return []; } };

    // Las facturas guardan el nombre como lo escribio el proveedor ("DIPROFER MX"); la ficha lo llama "Diprofer": se toman como el mismo si uno empieza con el otro.
    const coincide = (a, b) => a.length >= 3 && b.length >= 3 && (a === b || a.startsWith(b + " ") || b.startsWith(a + " "));
    const SQL_NOMBRE = "(LOWER(TRIM(proveedor)) = $2 OR LOWER(TRIM(proveedor)) LIKE $2 || ' %' OR $2 LIKE LOWER(TRIM(proveedor)) || ' %')";

    app.get("/proveedores/panel", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            if (!id) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }

            const [compras, deudas, pedidos] = await Promise.all([
                seguro(`SELECT LOWER(TRIM(proveedor)) AS k, MAX(COALESCE(fecha_documento::timestamptz, created_at)) AS ultima,
                               COALESCE(SUM(total) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days'), 0) AS comprado_90d,
                               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS compras_90d
                        FROM public.recepciones_mercancia WHERE negocio_id = $1 GROUP BY 1`, [id]),
                seguro(`SELECT LOWER(TRIM(proveedor)) AS k, COALESCE(SUM(saldo), 0) AS debe, MIN(vencimiento) AS vence,
                               COUNT(*) FILTER (WHERE vencimiento < CURRENT_DATE) AS vencidas
                        FROM public.cuentas_pagar WHERE negocio_id = $1 AND estado IN ('pendiente','parcial') AND saldo > 0 GROUP BY 1`, [id]),
                seguro(`SELECT LOWER(TRIM(proveedor)) AS k, COUNT(*) AS abiertos FROM public.pedidos_proveedor
                        WHERE negocio_id = $1 AND estado IN ('borrador','enviado') GROUP BY 1`, [id])
            ]);

            const por = {};
            const crudo = {};
            const poner = (filas, campos) => filas.forEach(f => { crudo[f.k] = Object.assign(crudo[f.k] || {}, campos(f)); });
            poner(compras, f => ({ ultima_compra: f.ultima, comprado_90d: Number(f.comprado_90d), compras_90d: Number(f.compras_90d) }));
            poner(deudas, f => ({ debe: Number(f.debe), vence: f.vence, vencidas: Number(f.vencidas) }));
            poner(pedidos, f => ({ pedidos_abiertos: Number(f.abiertos) }));

            const nombres = await seguro("SELECT LOWER(TRIM(nombre)) AS k FROM public.proveedores WHERE negocio_id = $1", [id]);
            nombres.forEach(({ k }) => {
                const suma = {};
                Object.keys(crudo).filter(c => coincide(c, k)).forEach(c => {
                    const d = crudo[c];
                    if (d.ultima_compra && (!suma.ultima_compra || new Date(d.ultima_compra) > new Date(suma.ultima_compra))) suma.ultima_compra = d.ultima_compra;
                    ["comprado_90d", "compras_90d", "debe", "vencidas", "pedidos_abiertos"].forEach(c2 => { if (d[c2] !== undefined) suma[c2] = (suma[c2] || 0) + d[c2]; });
                    if (d.vence && (!suma.vence || new Date(d.vence) < new Date(suma.vence))) suma.vence = d.vence;
                });
                if (Object.keys(suma).length) por[k] = suma;
            });

            res.json({ ok: true, por });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/proveedores/:id/ficha", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = negocioId(req);
            const id = Number(req.params.id);
            if (!negocio || !Number.isInteger(id)) { res.status(400).json({ ok: false, error: "Proveedor no valido" }); return; }

            const proveedor = (await seguro(`SELECT * FROM public.proveedores WHERE id = $1 AND negocio_id = $2`, [id, negocio]))[0];
            if (!proveedor) { res.status(404).json({ ok: false, error: "Ese proveedor no existe." }); return; }
            const nombre = String(proveedor.nombre || "").trim().toLowerCase();

            const [compras, cuentas, pagos, productos] = await Promise.all([
                seguro(`SELECT id, referencia, total, estado, COALESCE(fecha_documento::timestamptz, created_at) AS fecha FROM public.recepciones_mercancia
                        WHERE negocio_id = $1 AND ${SQL_NOMBRE} ORDER BY COALESCE(fecha_documento::timestamptz, created_at) DESC LIMIT 15`, [negocio, nombre]),
                seguro(`SELECT id, concepto, monto_total, saldo, vencimiento, estado FROM public.cuentas_pagar
                        WHERE negocio_id = $1 AND ${SQL_NOMBRE} AND estado IN ('pendiente','parcial') ORDER BY vencimiento NULLS LAST LIMIT 15`, [negocio, nombre]),
                seguro(`SELECT id, monto, metodo, created_at FROM public.pagos_proveedor
                        WHERE negocio_id = $1 AND ${SQL_NOMBRE} ORDER BY created_at DESC LIMIT 10`, [negocio, nombre]),
                seguro(`SELECT id, codigo, nombre, stock, stock_minimo, costo, precio FROM public.productos
                        WHERE negocio_id = $1 AND (proveedor_id = $2 OR (proveedor_id IS NULL AND LOWER(COALESCE(proveedor, '')) = $3))
                        ORDER BY (COALESCE(stock, 0) <= COALESCE(stock_minimo, 0)) DESC, nombre LIMIT 12`, [negocio, id, nombre])
            ]);

            res.json({ ok: true, proveedor, compras, cuentas, pagos, productos });
        } catch (error) {
            responderError(res, error);
        }
    });
};

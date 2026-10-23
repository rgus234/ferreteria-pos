// Pedido sugerido por proveedor (abarrotes).
//
// Cada proveedor guarda el dia que viene (proveedores.dia_visita) y cada cuantos
// dias (frecuencia_dias). Con las ventas reales de los ultimos dias se calcula
// que conviene pedir de sus productos, con el dinero estimado, y unos dias antes
// de la visita Nexo avisa al dueño. No crea pedidos solo: el pedido (borrador) lo
// guarda el dueño con la ruta de siempre, POST /pedidos-proveedor.

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { enviarPushADuenoDelNegocio } = require("./push-server");
const { fechaLocal } = require("./lotes-server");
const { proximaVisita, sugerirProducto, formatoDinero, DIAS_SEMANA } = require("./pedido-sugerido-calculo");

const VENTANA_MAXIMA_DIAS = 28;
const VENTANA_MINIMA_DIAS = 7;
const DIAS_AVISO_ANTES = 3;
const HORA_AVISO = 8;
const INTERVALO_REVISION_MS = 60 * 60 * 1000;
const ZONA = "America/Mexico_City";

function horaLocal(ahora = new Date()) {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hour12: false }).format(ahora)) % 24;
}

function dinero(valor) {
    return Number((Number(valor) || 0).toFixed(2));
}

// Dias de historia de ventas que hay para calcular: un negocio nuevo no tiene 28.
async function ventanaDeVentas(pool, negocioId) {
    const fila = (await pool.query(
        `SELECT MIN(fecha) AS primera FROM public.historial_ventas WHERE negocio_id = $1 AND estado = 'completada'`,
        [negocioId]
    )).rows[0];

    if (!fila?.primera) return { dias: VENTANA_MINIMA_DIAS, hayVentas: false };

    const dias = Math.ceil((Date.now() - new Date(fila.primera).getTime()) / 86400000);
    return { dias: Math.min(VENTANA_MAXIMA_DIAS, Math.max(VENTANA_MINIMA_DIAS, dias)), hayVentas: true };
}

async function vendidoPorProducto(pool, negocioId, ids, dias) {
    if (!ids.length) return new Map();

    const filas = await pool.query(
        `SELECT (item->>'id')::int AS id, COALESCE(SUM((item->>'cantidad')::numeric), 0) AS vendido
         FROM public.historial_ventas h
         CROSS JOIN LATERAL jsonb_array_elements(h.productos) AS item
         WHERE h.negocio_id = $1 AND h.estado = 'completada'
         AND h.fecha >= NOW() - ($2 || ' days')::interval
         AND item->>'id' ~ '^[0-9]+$'
         AND (item->>'id')::int = ANY($3::int[])
         GROUP BY 1`,
        [negocioId, String(dias), ids]
    );

    return new Map(filas.rows.map(f => [f.id, Number(f.vendido)]));
}

// Lo que conviene pedir a un proveedor para su proxima visita.
async function sugeridoDeProveedor(pool, negocioId, proveedor, hoy = fechaLocal()) {
    const visita = proximaVisita(hoy, proveedor.dia_visita);
    const frecuenciaDias = Number(proveedor.frecuencia_dias) || 7;
    const diasHastaVisita = visita ? visita.dias : 0;

    const productos = (await pool.query(
        `SELECT id, nombre, codigo, stock, stock_minimo, unidad_venta, precio_distribuidor, costo
         FROM public.productos
         WHERE negocio_id = $1
         AND (proveedor_id = $2 OR (proveedor_id IS NULL AND LOWER(COALESCE(proveedor, '')) = LOWER($3)))`,
        [negocioId, proveedor.id, proveedor.nombre]
    )).rows;

    const ventana = await ventanaDeVentas(pool, negocioId);
    const vendidos = await vendidoPorProducto(pool, negocioId, productos.map(p => p.id), ventana.dias);
    const items = [];

    for (const producto of productos) {
        const sugerencia = sugerirProducto({
            stock: producto.stock,
            stockMinimo: producto.stock_minimo,
            vendido: vendidos.get(producto.id) || 0,
            diasVentana: ventana.dias,
            diasHastaVisita,
            frecuenciaDias
        });

        if (!sugerencia) continue;

        const costo = Number(producto.precio_distribuidor) || Number(producto.costo) || 0;

        items.push({
            productoId: producto.id,
            nombre: producto.nombre,
            codigo: producto.codigo || "",
            unidad: producto.unidad_venta || "pieza",
            existencia: Number(producto.stock) || 0,
            costo: dinero(costo),
            ...sugerencia,
            subtotal: dinero(sugerencia.cantidad * costo)
        });
    }

    items.sort((a, b) => b.subtotal - a.subtotal || a.nombre.localeCompare(b.nombre));

    return {
        proveedorId: proveedor.id,
        proveedor: proveedor.nombre,
        telefono: proveedor.telefono || "",
        diaVisita: visita ? Number(proveedor.dia_visita) : null,
        frecuenciaDias,
        proximaVisita: visita?.fecha || null,
        diasHastaVisita: visita ? visita.dias : null,
        productosDelProveedor: productos.length,
        diasDeVentas: ventana.dias,
        hayVentas: ventana.hayVentas,
        items,
        total: dinero(items.reduce((suma, i) => suma + i.subtotal, 0))
    };
}

function textoDiaVisita(visita) {
    if (visita.diasHastaVisita === 0) return "hoy";
    if (visita.diasHastaVisita === 1) return "mañana";
    return `el ${DIAS_SEMANA[visita.diaVisita]}`;
}

// Una vez por visita, de 1 a 3 dias antes: "viene Coca-Cola, te sugerimos pedir...".
async function avisarVisitas(pool, ahora = new Date()) {
    if (horaLocal(ahora) < HORA_AVISO) return 0;

    const hoy = fechaLocal(ahora);
    const proveedores = (await pool.query(
        `SELECT id, negocio_id, nombre, telefono, dia_visita, frecuencia_dias
         FROM public.proveedores WHERE activo = true AND dia_visita IS NOT NULL`
    )).rows;

    let avisados = 0;

    for (const proveedor of proveedores) {
        try {
            const visita = proximaVisita(hoy, proveedor.dia_visita);
            if (!visita || visita.dias < 1 || visita.dias > DIAS_AVISO_ANTES) continue;

            const yaAvisado = await pool.query(
                `SELECT 1 FROM public.avisos_pedido_sugerido WHERE proveedor_id = $1 AND fecha_visita = $2`,
                [proveedor.id, visita.fecha]
            );
            if (yaAvisado.rows.length) continue;

            const sugerido = await sugeridoDeProveedor(pool, proveedor.negocio_id, proveedor, hoy);
            if (!sugerido.items.length) continue;

            const reservado = await pool.query(
                `INSERT INTO public.avisos_pedido_sugerido (proveedor_id, fecha_visita, cuantos) VALUES ($1, $2, $3)
                 ON CONFLICT (proveedor_id, fecha_visita) DO NOTHING RETURNING proveedor_id`,
                [proveedor.id, visita.fecha, sugerido.items.length]
            );
            if (!reservado.rows.length) continue;

            await enviarPushADuenoDelNegocio(pool, proveedor.negocio_id, {
                titulo: `Viene ${proveedor.nombre} ${textoDiaVisita(sugerido)}`,
                cuerpo: `Te sugerimos pedir ${sugerido.items.length} producto${sugerido.items.length === 1 ? "" : "s"} (aprox. ${formatoDinero(sugerido.total)}). Revisa el pedido sugerido.`,
                url: "/dueno"
            });
            avisados++;
        } catch (error) {
            console.warn("[pedido-sugerido] No se pudo avisar del proveedor", proveedor.id, error.message);
        }
    }

    return avisados;
}

function instalar(app, pool, requerirAccesoNegocio) {
    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    async function proveedorDelNegocio(id, proveedorId) {
        const numero = Number(proveedorId);
        if (!Number.isInteger(numero) || numero <= 0) return null;

        return (await pool.query(
            `SELECT id, negocio_id, nombre, telefono, dia_visita, frecuencia_dias FROM public.proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true`,
            [numero, id]
        )).rows[0] || null;
    }

    // Lista de proveedores con su dia de visita y lo que conviene pedir en cada uno.
    app.get("/pedido-sugerido", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const proveedores = (await pool.query(
                `SELECT id, negocio_id, nombre, telefono, dia_visita, frecuencia_dias FROM public.proveedores
                 WHERE negocio_id = $1 AND activo = true ORDER BY nombre ASC`,
                [id]
            )).rows;

            const resultado = [];
            for (const proveedor of proveedores) {
                const sugerido = await sugeridoDeProveedor(pool, id, proveedor);
                resultado.push({ ...sugerido, items: undefined, productosSugeridos: sugerido.items.length });
            }

            // Primero los que vienen antes; los que no tienen dia, al final.
            resultado.sort((a, b) => (a.diasHastaVisita ?? 99) - (b.diasHastaVisita ?? 99) || a.proveedor.localeCompare(b.proveedor));
            res.json({ proveedores: resultado });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/pedido-sugerido/:proveedorId", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const proveedor = await proveedorDelNegocio(id, req.params.proveedorId);

            if (!proveedor) {
                res.status(404).json({ error: "Proveedor no encontrado" });
                return;
            }

            res.json(await sugeridoDeProveedor(pool, id, proveedor));
        } catch (error) {
            responderError(res, error);
        }
    });

    // Que dia viene el proveedor y cada cuantos dias.
    app.patch("/pedido-sugerido/:proveedorId/visita", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const proveedor = await proveedorDelNegocio(id, req.params.proveedorId);

            if (!proveedor) {
                res.status(404).json({ error: "Proveedor no encontrado" });
                return;
            }

            const cuerpo = req.body || {};
            let diaVisita = proveedor.dia_visita;
            let frecuencia = proveedor.frecuencia_dias;

            if (cuerpo.diaVisita !== undefined) {
                if (cuerpo.diaVisita === null || cuerpo.diaVisita === "") {
                    diaVisita = null;
                } else {
                    const dia = Number(cuerpo.diaVisita);

                    if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
                        res.status(400).json({ error: "Elige un dia de la semana" });
                        return;
                    }

                    diaVisita = dia;
                }
            }

            if (cuerpo.frecuenciaDias !== undefined) {
                const dias = Number(cuerpo.frecuenciaDias);

                if (!Number.isInteger(dias) || dias < 1 || dias > 60) {
                    res.status(400).json({ error: "La frecuencia va de 1 a 60 dias" });
                    return;
                }

                frecuencia = dias;
            }

            await pool.query(
                `UPDATE public.proveedores SET dia_visita = $1, frecuencia_dias = $2 WHERE id = $3 AND negocio_id = $4`,
                [diaVisita, frecuencia, proveedor.id, id]
            );

            res.json({ ok: true, diaVisita, frecuenciaDias: frecuencia });
        } catch (error) {
            responderError(res, error);
        }
    });

    async function revisarYCorrer() {
        try {
            await avisarVisitas(pool);
        } catch (error) {
            console.log("[pedido-sugerido] Error en el aviso de visitas:", error.message);
        }
    }

    setTimeout(revisarYCorrer, 45000);
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

module.exports = instalar;
module.exports.sugeridoDeProveedor = sugeridoDeProveedor;
module.exports.avisarVisitas = avisarVisitas;

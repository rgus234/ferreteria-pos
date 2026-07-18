const { DEFAULT_NEGOCIO_SLUG } = require("./tenant");
const { responderError } = require("./error-utils");

module.exports = (app, pool, requerirAccesoNegocio) => {
    let listo = false;

    const numero = valor => {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
    };

    // Resuelve el negocio a partir del token ya verificado por
    // requerirAccesoNegocio (server.js) -- ya no confia en un slug sin
    // autenticar. Misma forma de retorno que antes (id/slug/nombre/...).
    async function negocioActual(req) {
        const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!negocioId) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        const resultado = await pool.query(
            `SELECT id, slug, nombre, giro, estado, plan FROM public.negocios WHERE id = $1 LIMIT 1`,
            [negocioId]
        );

        if (resultado.rows.length === 0) {
            const error = new Error("Negocio no encontrado");
            error.httpStatus = 404;
            throw error;
        }

        return resultado.rows[0];
    }

    async function asegurarFinanzas() {
        if (listo) return;

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.cuentas_pagar (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                proveedor TEXT NOT NULL DEFAULT '',
                origen_tipo TEXT NOT NULL DEFAULT 'manual',
                origen_id INTEGER,
                concepto TEXT NOT NULL DEFAULT '',
                monto_total NUMERIC(12,2) NOT NULL DEFAULT 0,
                saldo NUMERIC(12,2) NOT NULL DEFAULT 0,
                vencimiento DATE,
                estado TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'cancelada')),
                notas TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.pagos_proveedor (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                cuenta_id INTEGER
                    REFERENCES public.cuentas_pagar(id)
                    ON DELETE SET NULL,
                proveedor TEXT NOT NULL DEFAULT '',
                monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
                metodo TEXT NOT NULL DEFAULT '',
                referencia TEXT NOT NULL DEFAULT '',
                notas TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.gastos_operativos (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                categoria TEXT NOT NULL DEFAULT '',
                concepto TEXT NOT NULL DEFAULT '',
                monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
                metodo TEXT NOT NULL DEFAULT '',
                referencia TEXT NOT NULL DEFAULT '',
                notas TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        for (const tabla of ["cuentas_pagar", "pagos_proveedor", "gastos_operativos"]) {
            await pool.query(`
                ALTER TABLE public.${tabla}
                ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
            `);
        }

        await pool.query(
            `
            UPDATE public.cuentas_pagar
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        await pool.query(`
            UPDATE public.pagos_proveedor p
            SET negocio_id = c.negocio_id
            FROM public.cuentas_pagar c
            WHERE p.cuenta_id = c.id
            AND p.negocio_id IS NULL
        `);

        await pool.query(
            `
            UPDATE public.pagos_proveedor
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        await pool.query(
            `
            UPDATE public.gastos_operativos
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        listo = true;
    }

    function rangoFechasFinanzas(req) {
        const periodo = String(req.query.periodo || "mes");
        const desde = req.query.desde ? new Date(String(req.query.desde)) : null;
        const hasta = req.query.hasta ? new Date(String(req.query.hasta)) : null;
        const usarRango = desde && !Number.isNaN(desde.getTime()) && hasta && !Number.isNaN(hasta.getTime());

        if (usarRango) {
            return {
                filtroCreatedAt: "AND created_at::date BETWEEN $2::date AND $3::date",
                filtroFecha: "AND fecha::date BETWEEN $2::date AND $3::date",
                params: [desde.toISOString().slice(0, 10), hasta.toISOString().slice(0, 10)]
            };
        }

        const desdeSql = periodo === "dia"
            ? "CURRENT_DATE"
            : periodo === "semana"
                ? "date_trunc('week', NOW())"
                : periodo === "anio"
                    ? "date_trunc('year', NOW())"
                    : "date_trunc('month', NOW())";

        return {
            filtroCreatedAt: `AND created_at >= ${desdeSql}`,
            filtroFecha: `AND fecha >= ${desdeSql}`,
            params: []
        };
    }

    function rangoFechasFinanzasAnterior(req) {
        const periodo = String(req.query.periodo || "mes");
        const desde = req.query.desde ? new Date(String(req.query.desde)) : null;
        const hasta = req.query.hasta ? new Date(String(req.query.hasta)) : null;
        const usarRango = desde && !Number.isNaN(desde.getTime()) && hasta && !Number.isNaN(hasta.getTime());

        if (usarRango) {
            const duracionDias = Math.max(1, Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1);
            const anteriorHasta = new Date(desde.getTime() - 86400000);
            const anteriorDesde = new Date(anteriorHasta.getTime() - (duracionDias - 1) * 86400000);
            return {
                filtroCreatedAt: "AND created_at::date BETWEEN $2::date AND $3::date",
                filtroFecha: "AND fecha::date BETWEEN $2::date AND $3::date",
                params: [anteriorDesde.toISOString().slice(0, 10), anteriorHasta.toISOString().slice(0, 10)]
            };
        }

        const condicion = periodo === "dia"
            ? "AND fecha >= CURRENT_DATE - INTERVAL '1 day' AND fecha < CURRENT_DATE"
            : periodo === "semana"
                ? "AND fecha >= date_trunc('week', NOW()) - INTERVAL '7 days' AND fecha < date_trunc('week', NOW())"
                : periodo === "anio"
                    ? "AND fecha >= date_trunc('year', NOW()) - INTERVAL '1 year' AND fecha < date_trunc('year', NOW())"
                    : "AND fecha >= date_trunc('month', NOW()) - INTERVAL '1 month' AND fecha < date_trunc('month', NOW())";

        return {
            filtroCreatedAt: condicion.replace(/fecha/g, "created_at"),
            filtroFecha: condicion,
            params: []
        };
    }

    app.get("/finanzas/resumen", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);
            const { filtroCreatedAt, filtroFecha, params } = rangoFechasFinanzas(req);
            const parametros = [negocio.id, ...params];

            const cuentas = await pool.query(`
                SELECT
                    COALESCE(SUM(saldo) FILTER (WHERE estado IN ('pendiente', 'parcial')), 0) AS por_pagar,
                    COUNT(*) FILTER (WHERE estado IN ('pendiente', 'parcial')) AS cuentas_abiertas,
                    COUNT(*) FILTER (
                        WHERE estado IN ('pendiente', 'parcial')
                        AND vencimiento IS NOT NULL
                        AND vencimiento < CURRENT_DATE
                    ) AS vencidas
                FROM public.cuentas_pagar
                WHERE negocio_id = $1
            `, [negocio.id]);

            const gastos = await pool.query(`
                SELECT COALESCE(SUM(monto), 0) AS gastos_mes
                FROM public.gastos_operativos
                WHERE negocio_id = $1
                ${filtroCreatedAt}
            `, parametros);

            const pagos = await pool.query(`
                SELECT COALESCE(SUM(monto), 0) AS pagos_mes
                FROM public.pagos_proveedor
                WHERE negocio_id = $1
                ${filtroCreatedAt}
            `, parametros);

            const ingresos = await pool.query(`
                SELECT COALESCE(SUM(total), 0) AS ingresos
                FROM public.historial_ventas
                WHERE negocio_id = $1
                ${filtroFecha}
            `, parametros);

            const { filtroCreatedAt: filtroCreatedAtAnterior, filtroFecha: filtroFechaAnterior, params: paramsAnterior } = rangoFechasFinanzasAnterior(req);
            const parametrosAnterior = [negocio.id, ...paramsAnterior];

            const ingresosAnterior = await pool.query(`
                SELECT COALESCE(SUM(total), 0) AS ingresos
                FROM public.historial_ventas
                WHERE negocio_id = $1
                ${filtroFechaAnterior}
            `, parametrosAnterior);

            const gastosAnterior = await pool.query(`
                SELECT COALESCE(SUM(monto), 0) AS gastos
                FROM public.gastos_operativos
                WHERE negocio_id = $1
                ${filtroCreatedAtAnterior}
            `, parametrosAnterior);

            const cuentasPorCobrar = await pool.query(`
                SELECT
                    COALESCE(SUM(saldo), 0) AS total,
                    COUNT(*) AS clientes
                FROM (
                    SELECT
                        COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN m.monto WHEN m.tipo = 'abono' THEN -m.monto ELSE 0 END), 0) AS saldo
                    FROM public.clientes_credito c
                    LEFT JOIN public.movimientos_credito m
                        ON m.cliente_id = c.id
                        AND m.negocio_id = c.negocio_id
                    WHERE c.activo = true
                    AND c.negocio_id = $1
                    GROUP BY c.id
                ) saldos
                WHERE saldo > 0
            `, [negocio.id]);

            const ingresosMonto = Number(ingresos.rows[0].ingresos || 0);
            const gastosMonto = Number(gastos.rows[0].gastos_mes || 0);
            const utilidadNeta = ingresosMonto - gastosMonto;
            const porPagarMonto = Number(cuentas.rows[0].por_pagar || 0);
            const ingresosAnteriorMonto = Number(ingresosAnterior.rows[0].ingresos || 0);
            const gastosAnteriorMonto = Number(gastosAnterior.rows[0].gastos || 0);

            res.json({
                ...cuentas.rows[0],
                ingresos: ingresosMonto,
                gastos_mes: gastosMonto,
                pagos_mes: pagos.rows[0].pagos_mes,
                utilidad_neta: utilidadNeta,
                balance_disponible: utilidadNeta - porPagarMonto,
                cuentas_por_cobrar: Number(cuentasPorCobrar.rows[0].total || 0),
                clientes_por_cobrar: Number(cuentasPorCobrar.rows[0].clientes || 0),
                anterior: {
                    ingresos: ingresosAnteriorMonto,
                    gastos: gastosAnteriorMonto,
                    utilidad_neta: ingresosAnteriorMonto - gastosAnteriorMonto
                }
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/finanzas/resumen-por-dia", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);
            const { filtroCreatedAt, filtroFecha, params } = rangoFechasFinanzas(req);
            const parametros = [negocio.id, ...params];

            const ingresosPorDia = await pool.query(`
                SELECT TO_CHAR(fecha, 'DD/MM') AS dia, DATE(fecha) AS fecha_orden, COALESCE(SUM(total), 0) AS total
                FROM public.historial_ventas
                WHERE negocio_id = $1
                ${filtroFecha}
                GROUP BY TO_CHAR(fecha, 'DD/MM'), DATE(fecha)
                ORDER BY DATE(fecha) ASC
                LIMIT 60
            `, parametros);

            const gastosPorDia = await pool.query(`
                SELECT TO_CHAR(created_at, 'DD/MM') AS dia, DATE(created_at) AS fecha_orden, COALESCE(SUM(monto), 0) AS total
                FROM public.gastos_operativos
                WHERE negocio_id = $1
                ${filtroCreatedAt}
                GROUP BY TO_CHAR(created_at, 'DD/MM'), DATE(created_at)
                ORDER BY DATE(created_at) ASC
                LIMIT 60
            `, parametros);

            const gastosPorCategoria = await pool.query(`
                SELECT COALESCE(NULLIF(categoria, ''), 'General') AS categoria, COALESCE(SUM(monto), 0) AS total
                FROM public.gastos_operativos
                WHERE negocio_id = $1
                ${filtroCreatedAt}
                GROUP BY 1
                ORDER BY total DESC
            `, parametros);

            const dias = new Map();
            ingresosPorDia.rows.forEach(fila => {
                dias.set(fila.fecha_orden.toISOString().slice(0, 10), { dia: fila.dia, ingresos: Number(fila.total), gastos: 0 });
            });
            gastosPorDia.rows.forEach(fila => {
                const clave = fila.fecha_orden.toISOString().slice(0, 10);
                const existente = dias.get(clave) || { dia: fila.dia, ingresos: 0, gastos: 0 };
                existente.gastos = Number(fila.total);
                dias.set(clave, existente);
            });

            const porDia = [...dias.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([, valor]) => ({
                    dia: valor.dia,
                    ingresos: valor.ingresos,
                    gastos: valor.gastos,
                    utilidad: valor.ingresos - valor.gastos
                }));

            res.json({
                porDia,
                gastosPorCategoria: gastosPorCategoria.rows
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/finanzas/cuentas-por-cobrar", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                SELECT
                    c.id,
                    c.nombre,
                    c.fecha_vencimiento,
                    COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN m.monto WHEN m.tipo = 'abono' THEN -m.monto ELSE 0 END), 0) AS saldo
                FROM public.clientes_credito c
                LEFT JOIN public.movimientos_credito m
                    ON m.cliente_id = c.id
                    AND m.negocio_id = c.negocio_id
                WHERE c.activo = true
                AND c.negocio_id = $1
                GROUP BY c.id
                HAVING COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN m.monto WHEN m.tipo = 'abono' THEN -m.monto ELSE 0 END), 0) > 0
                ORDER BY COALESCE(c.fecha_vencimiento, CURRENT_DATE + 9999) ASC, saldo DESC
                LIMIT 20
            `, [negocio.id]);

            res.json({ cuentas: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/cuentas-pagar", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                SELECT *
                FROM public.cuentas_pagar
                WHERE negocio_id = $1
                ORDER BY
                    CASE estado
                        WHEN 'pendiente' THEN 1
                        WHEN 'parcial' THEN 2
                        WHEN 'pagada' THEN 3
                        ELSE 4
                    END,
                    COALESCE(vencimiento, CURRENT_DATE + 9999) ASC,
                    created_at DESC
            `, [negocio.id]);

            res.json({ cuentas: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/cuentas-pagar", requerirAccesoNegocio, async (req, res) => {
        const {
            proveedor,
            origenTipo,
            origenId,
            concepto,
            montoTotal,
            vencimiento,
            notas
        } = req.body;

        const monto = numero(montoTotal);

        if (!proveedor || !concepto || monto <= 0) {
            res.status(400).json({
                error: "Proveedor, concepto y monto son obligatorios"
            });
            return;
        }

        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                INSERT INTO public.cuentas_pagar
                    (negocio_id, proveedor, origen_tipo, origen_id, concepto, monto_total, saldo, vencimiento, notas)
                VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)
                RETURNING *
            `, [
                negocio.id,
                proveedor,
                origenTipo || "manual",
                origenId || null,
                concepto,
                monto,
                vencimiento || null,
                notas || ""
            ]);

            res.json({ cuenta: resultado.rows[0] });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/cuentas-pagar/:id/pagos", requerirAccesoNegocio, async (req, res) => {
        const { monto, metodo, referencia, notas } = req.body;
        const pagoMonto = numero(monto);

        if (pagoMonto <= 0) {
            res.status(400).json({ error: "Monto invalido" });
            return;
        }

        const client = await pool.connect();

        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const cuenta = await client.query(`
                SELECT *
                FROM public.cuentas_pagar
                WHERE id = $1
                AND negocio_id = $2
                FOR UPDATE
            `, [req.params.id, negocio.id]);

            if (cuenta.rows.length === 0) {
                await client.query("ROLLBACK");
                res.status(404).json({ error: "Cuenta no encontrada" });
                return;
            }

            if (cuenta.rows[0].estado === "cancelada") {
                await client.query("ROLLBACK");
                res.status(400).json({ error: "La cuenta esta cancelada" });
                return;
            }

            const saldoActual = numero(cuenta.rows[0].saldo);
            const nuevoSaldo = Math.max(0, saldoActual - pagoMonto);
            const estado =
                nuevoSaldo <= 0
                    ? "pagada"
                    : nuevoSaldo < numero(cuenta.rows[0].monto_total)
                        ? "parcial"
                        : "pendiente";

            const pago = await client.query(`
                INSERT INTO public.pagos_proveedor
                    (negocio_id, cuenta_id, proveedor, monto, metodo, referencia, notas)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                RETURNING *
            `, [
                negocio.id,
                req.params.id,
                cuenta.rows[0].proveedor,
                pagoMonto,
                metodo || "",
                referencia || "",
                notas || ""
            ]);

            await client.query(`
                UPDATE public.cuentas_pagar
                SET saldo = $1, estado = $2, updated_at = NOW()
                WHERE id = $3
                AND negocio_id = $4
            `, [
                nuevoSaldo,
                estado,
                req.params.id,
                negocio.id
            ]);

            await client.query("COMMIT");
            res.json({ pago: pago.rows[0], saldo: nuevoSaldo, estado });
        } catch (error) {
            await client.query("ROLLBACK");
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    app.get("/pagos-proveedor", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                SELECT *
                FROM public.pagos_proveedor
                WHERE negocio_id = $1
                ORDER BY created_at DESC
                LIMIT 80
            `, [negocio.id]);

            res.json({ pagos: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/gastos-operativos", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                SELECT *
                FROM public.gastos_operativos
                WHERE negocio_id = $1
                ORDER BY created_at DESC
                LIMIT 80
            `, [negocio.id]);

            res.json({ gastos: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/gastos-operativos", requerirAccesoNegocio, async (req, res) => {
        const {
            categoria,
            concepto,
            monto,
            metodo,
            referencia,
            notas
        } = req.body;

        const gastoMonto = numero(monto);

        if (!concepto || gastoMonto <= 0) {
            res.status(400).json({
                error: "Concepto y monto son obligatorios"
            });
            return;
        }

        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                INSERT INTO public.gastos_operativos
                    (negocio_id, categoria, concepto, monto, metodo, referencia, notas)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                RETURNING *
            `, [
                negocio.id,
                categoria || "",
                concepto,
                gastoMonto,
                metodo || "",
                referencia || "",
                notas || ""
            ]);

            res.json({ gasto: resultado.rows[0] });
        } catch (error) {
            responderError(res, error);
        }
    });
};

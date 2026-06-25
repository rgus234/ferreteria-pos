const { DEFAULT_NEGOCIO_SLUG, asegurarNegocioActual } = require("./tenant");

module.exports = (app, pool) => {
    let listo = false;

    const numero = valor => {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
    };

    async function negocioActual(req) {
        return asegurarNegocioActual(pool, req);
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

    app.get("/finanzas/resumen", async (req, res) => {
        try {
            await asegurarFinanzas();
            const negocio = await negocioActual(req);

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
                AND created_at >= date_trunc('month', NOW())
            `, [negocio.id]);

            const pagos = await pool.query(`
                SELECT COALESCE(SUM(monto), 0) AS pagos_mes
                FROM public.pagos_proveedor
                WHERE negocio_id = $1
                AND created_at >= date_trunc('month', NOW())
            `, [negocio.id]);

            res.json({
                ...cuentas.rows[0],
                gastos_mes: gastos.rows[0].gastos_mes,
                pagos_mes: pagos.rows[0].pagos_mes
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/cuentas-pagar", async (req, res) => {
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
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/cuentas-pagar", async (req, res) => {
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
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/cuentas-pagar/:id/pagos", async (req, res) => {
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
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    app.get("/pagos-proveedor", async (req, res) => {
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
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/gastos-operativos", async (req, res) => {
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
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/gastos-operativos", async (req, res) => {
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
            res.status(500).json({ error: error.message });
        }
    });
};

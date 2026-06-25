const { DEFAULT_NEGOCIO_SLUG, asegurarNegocioActual } = require("./tenant");

module.exports = (app, pool) => {
    let listo = false;

    const n = valor => {
        const numero = Number(valor);
        return Number.isFinite(numero) ? numero : 0;
    };

    async function negocioActual(req) {
        return asegurarNegocioActual(pool, req);
    }

    async function asegurar() {
        if (listo) return;

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.turnos_caja (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                usuario TEXT NOT NULL DEFAULT '',
                fondo_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
                estado TEXT NOT NULL DEFAULT 'abierto'
                    CHECK (estado IN ('abierto','cerrado')),
                abierto_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                cerrado_at TIMESTAMPTZ,
                efectivo_contado NUMERIC(12,2),
                tarjeta_contado NUMERIC(12,2),
                transferencia_contado NUMERIC(12,2),
                credito_contado NUMERIC(12,2),
                ventas_calculadas NUMERIC(12,2) NOT NULL DEFAULT 0,
                entradas_calculadas NUMERIC(12,2) NOT NULL DEFAULT 0,
                salidas_calculadas NUMERIC(12,2) NOT NULL DEFAULT 0,
                esperado_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0,
                diferencia NUMERIC(12,2) NOT NULL DEFAULT 0,
                notas TEXT NOT NULL DEFAULT ''
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.movimientos_caja (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                turno_id INTEGER REFERENCES public.turnos_caja(id) ON DELETE SET NULL,
                tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida')),
                concepto TEXT NOT NULL DEFAULT '',
                monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
                metodo TEXT NOT NULL DEFAULT 'efectivo',
                referencia TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            ALTER TABLE public.turnos_caja
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
        `);

        await pool.query(`
            ALTER TABLE public.movimientos_caja
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
        `);

        await pool.query(
            `
            UPDATE public.turnos_caja
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        await pool.query(`
            UPDATE public.movimientos_caja m
            SET negocio_id = t.negocio_id
            FROM public.turnos_caja t
            WHERE m.turno_id = t.id
            AND m.negocio_id IS NULL
        `);

        await pool.query(
            `
            UPDATE public.movimientos_caja
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'efectivo'
        `);

        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0
        `);

        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_tarjeta NUMERIC(12,2) NOT NULL DEFAULT 0
        `);

        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_transferencia NUMERIC(12,2) NOT NULL DEFAULT 0
        `);

        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_credito NUMERIC(12,2) NOT NULL DEFAULT 0
        `);

        listo = true;
    }

    async function turnoAbierto(negocioId, client = pool) {
        await asegurar();

        const resultado = await client.query(`
            SELECT *
            FROM public.turnos_caja
            WHERE estado = 'abierto'
            AND negocio_id = $1
            ORDER BY abierto_at DESC
            LIMIT 1
        `, [negocioId]);

        return resultado.rows[0] || null;
    }

    async function resumenTurno(turno, client = pool) {
        const hasta = turno.cerrado_at || new Date();

        const ventas = await client.query(`
            SELECT
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones,
                COALESCE(SUM(
                    CASE
                        WHEN pago_efectivo > 0 THEN pago_efectivo
                        WHEN metodo_pago = 'efectivo' THEN total
                        ELSE 0
                    END
                ), 0) AS efectivo,
                COALESCE(SUM(pago_tarjeta), 0) AS tarjeta,
                COALESCE(SUM(pago_transferencia), 0) AS transferencia,
                COALESCE(SUM(pago_credito), 0) AS credito
            FROM public.historial_ventas
            WHERE negocio_id = $1
            AND fecha >= $2
            AND fecha <= $3
        `, [turno.negocio_id, turno.abierto_at, hasta]);

        const movimientos = await client.query(`
            SELECT
                COALESCE(SUM(monto) FILTER (WHERE tipo = 'entrada'), 0) AS entradas,
                COALESCE(SUM(monto) FILTER (WHERE tipo = 'salida'), 0) AS salidas
            FROM public.movimientos_caja
            WHERE turno_id = $1
            AND negocio_id = $2
        `, [turno.id, turno.negocio_id]);

        const venta = ventas.rows[0];
        const entradas = n(movimientos.rows[0].entradas);
        const salidas = n(movimientos.rows[0].salidas);
        const esperado = n(turno.fondo_inicial) + n(venta.efectivo) + entradas - salidas;

        return {
            turno,
            ventas: n(venta.total),
            transacciones: Number(venta.transacciones || 0),
            efectivo: n(venta.efectivo),
            tarjeta: n(venta.tarjeta),
            transferencia: n(venta.transferencia),
            credito: n(venta.credito),
            entradas,
            salidas,
            esperado_efectivo: esperado
        };
    }

    app.get("/caja/turno-activo", async (req, res) => {
        try {
            const negocio = await negocioActual(req);
            const turno = await turnoAbierto(negocio.id);

            res.json({
                turno,
                resumen: turno ? await resumenTurno(turno) : null
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/caja/abrir", async (req, res) => {
        const { usuario, fondoInicial, notas } = req.body;

        try {
            await asegurar();
            const negocio = await negocioActual(req);
            const abierto = await turnoAbierto(negocio.id);

            if (abierto) {
                res.status(400).json({
                    error: "Ya hay un turno abierto",
                    turno: abierto
                });
                return;
            }

            const resultado = await pool.query(`
                INSERT INTO public.turnos_caja
                    (negocio_id, usuario, fondo_inicial, notas)
                VALUES ($1,$2,$3,$4)
                RETURNING *
            `, [
                negocio.id,
                usuario || "",
                n(fondoInicial),
                notas || ""
            ]);

            res.json({ turno: resultado.rows[0] });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/caja/movimientos", async (req, res) => {
        try {
            await asegurar();
            const negocio = await negocioActual(req);
            const turno = await turnoAbierto(negocio.id);

            const params = [negocio.id];
            let where = "WHERE negocio_id = $1";

            if (req.query.turnoId || turno?.id) {
                params.push(req.query.turnoId || turno.id);
                where += " AND turno_id = $2";
            }

            const resultado = await pool.query(`
                SELECT *
                FROM public.movimientos_caja
                ${where}
                ORDER BY created_at DESC
                LIMIT 80
            `, params);

            res.json({ movimientos: resultado.rows });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/caja/movimientos", async (req, res) => {
        const { tipo, concepto, monto, metodo, referencia } = req.body;

        if (!["entrada", "salida"].includes(tipo) || n(monto) <= 0) {
            res.status(400).json({ error: "Tipo y monto validos requeridos" });
            return;
        }

        try {
            await asegurar();
            const negocio = await negocioActual(req);
            const turno = await turnoAbierto(negocio.id);

            if (!turno) {
                res.status(400).json({ error: "Abre turno antes de registrar movimientos" });
                return;
            }

            const resultado = await pool.query(`
                INSERT INTO public.movimientos_caja
                    (negocio_id, turno_id, tipo, concepto, monto, metodo, referencia)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                RETURNING *
            `, [
                negocio.id,
                turno.id,
                tipo,
                concepto || "",
                n(monto),
                metodo || "efectivo",
                referencia || ""
            ]);

            res.json({
                movimiento: resultado.rows[0],
                resumen: await resumenTurno(turno)
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/caja/cerrar", async (req, res) => {
        const {
            efectivoContado,
            tarjetaContado,
            transferenciaContado,
            creditoContado,
            notas
        } = req.body;

        const client = await pool.connect();

        try {
            await asegurar();
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const turno = await client.query(`
                SELECT *
                FROM public.turnos_caja
                WHERE estado = 'abierto'
                AND negocio_id = $1
                ORDER BY abierto_at DESC
                LIMIT 1
                FOR UPDATE
            `, [negocio.id]);

            if (!turno.rows.length) {
                await client.query("ROLLBACK");
                res.status(400).json({ error: "No hay turno abierto" });
                return;
            }

            const actual = turno.rows[0];
            const resumen = await resumenTurno(actual, client);
            const efectivo = n(efectivoContado);
            const diferencia = efectivo - n(resumen.esperado_efectivo);

            const resultado = await client.query(`
                UPDATE public.turnos_caja
                SET
                    estado = 'cerrado',
                    cerrado_at = NOW(),
                    efectivo_contado = $1,
                    tarjeta_contado = $2,
                    transferencia_contado = $3,
                    credito_contado = $4,
                    ventas_calculadas = $5,
                    entradas_calculadas = $6,
                    salidas_calculadas = $7,
                    esperado_efectivo = $8,
                    diferencia = $9,
                    notas = $10
                WHERE id = $11
                AND negocio_id = $12
                RETURNING *
            `, [
                efectivo,
                n(tarjetaContado),
                n(transferenciaContado),
                n(creditoContado),
                n(resumen.ventas),
                n(resumen.entradas),
                n(resumen.salidas),
                n(resumen.esperado_efectivo),
                diferencia,
                notas || actual.notas || "",
                actual.id,
                negocio.id
            ]);

            await client.query("COMMIT");

            res.json({
                turno: resultado.rows[0],
                resumen
            });
        } catch (error) {
            await client.query("ROLLBACK");
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    app.get("/caja/cortes", async (req, res) => {
        try {
            await asegurar();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                SELECT *
                FROM public.turnos_caja
                WHERE negocio_id = $1
                ORDER BY abierto_at DESC
                LIMIT 50
            `, [negocio.id]);

            res.json({ cortes: resultado.rows });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
};

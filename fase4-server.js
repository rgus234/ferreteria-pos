const { DEFAULT_NEGOCIO_SLUG, asegurarNegocioActual } = require("./tenant");

module.exports = (app, pool, normalizarCodigo) => {
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
            CREATE TABLE IF NOT EXISTS public.pedidos_proveedor (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                proveedor TEXT NOT NULL DEFAULT '',
                estado TEXT NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','enviado','parcial','recibido','cancelado')),
                notas TEXT NOT NULL DEFAULT '',
                total_estimado NUMERIC(12,2) NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.pedidos_proveedor_items (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                pedido_id INTEGER NOT NULL
                    REFERENCES public.pedidos_proveedor(id)
                    ON DELETE CASCADE,
                producto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
                codigo TEXT NOT NULL DEFAULT '',
                nombre TEXT NOT NULL,
                proveedor TEXT NOT NULL DEFAULT '',
                cantidad NUMERIC(12,3) NOT NULL DEFAULT 0,
                recibido NUMERIC(12,3) NOT NULL DEFAULT 0,
                costo NUMERIC(12,2) NOT NULL DEFAULT 0,
                unidad TEXT NOT NULL DEFAULT 'pieza',
                notas TEXT NOT NULL DEFAULT ''
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.recepciones_mercancia (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                pedido_id INTEGER REFERENCES public.pedidos_proveedor(id) ON DELETE SET NULL,
                proveedor TEXT NOT NULL DEFAULT '',
                referencia TEXT NOT NULL DEFAULT '',
                notas TEXT NOT NULL DEFAULT '',
                total NUMERIC(12,2) NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.recepciones_mercancia_items (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                recepcion_id INTEGER NOT NULL
                    REFERENCES public.recepciones_mercancia(id)
                    ON DELETE CASCADE,
                pedido_item_id INTEGER REFERENCES public.pedidos_proveedor_items(id) ON DELETE SET NULL,
                producto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
                codigo TEXT NOT NULL DEFAULT '',
                nombre TEXT NOT NULL,
                cantidad NUMERIC(12,3) NOT NULL,
                costo NUMERIC(12,2) NOT NULL DEFAULT 0
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.ajustes_inventario (
                id SERIAL PRIMARY KEY,
                negocio_id INTEGER REFERENCES public.negocios(id),
                producto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
                producto_nombre TEXT NOT NULL,
                codigo TEXT NOT NULL DEFAULT '',
                tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida','conteo')),
                cantidad NUMERIC(12,3) NOT NULL,
                stock_anterior NUMERIC(12,3) NOT NULL DEFAULT 0,
                stock_nuevo NUMERIC(12,3) NOT NULL DEFAULT 0,
                motivo TEXT NOT NULL DEFAULT '',
                referencia TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        const tablas = [
            "pedidos_proveedor",
            "pedidos_proveedor_items",
            "recepciones_mercancia",
            "recepciones_mercancia_items",
            "ajustes_inventario"
        ];

        for (const tabla of tablas) {
            await pool.query(`
                ALTER TABLE public.${tabla}
                ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
            `);
        }

        await pool.query(
            `
            UPDATE public.pedidos_proveedor
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        await pool.query(`
            UPDATE public.pedidos_proveedor_items i
            SET negocio_id = p.negocio_id
            FROM public.pedidos_proveedor p
            WHERE i.pedido_id = p.id
            AND i.negocio_id IS NULL
        `);

        await pool.query(
            `
            UPDATE public.recepciones_mercancia
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        await pool.query(`
            UPDATE public.recepciones_mercancia_items i
            SET negocio_id = r.negocio_id
            FROM public.recepciones_mercancia r
            WHERE i.recepcion_id = r.id
            AND i.negocio_id IS NULL
        `);

        await pool.query(
            `
            UPDATE public.ajustes_inventario
            SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
            WHERE negocio_id IS NULL
            `,
            [DEFAULT_NEGOCIO_SLUG]
        );

        listo = true;
    }

    function estado(items) {
        if (items.length && items.every(item => n(item.recibido) >= n(item.cantidad))) {
            return "recibido";
        }

        return items.some(item => n(item.recibido) > 0)
            ? "parcial"
            : "enviado";
    }

    app.get("/pedidos-proveedor", async (req, res) => {
        try {
            await asegurar();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                SELECT
                    p.*,
                    COUNT(i.id) AS partidas,
                    COALESCE(SUM(i.cantidad), 0) AS piezas,
                    COALESCE(SUM(i.recibido), 0) AS recibido
                FROM public.pedidos_proveedor p
                LEFT JOIN public.pedidos_proveedor_items i
                    ON i.pedido_id = p.id
                    AND i.negocio_id = p.negocio_id
                WHERE p.negocio_id = $1
                GROUP BY p.id
                ORDER BY p.created_at DESC
            `, [negocio.id]);

            res.json({ pedidos: resultado.rows });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/pedidos-proveedor/:id", async (req, res) => {
        try {
            await asegurar();
            const negocio = await negocioActual(req);

            const pedido = await pool.query(`
                SELECT *
                FROM public.pedidos_proveedor
                WHERE id = $1
                AND negocio_id = $2
            `, [req.params.id, negocio.id]);

            if (!pedido.rows.length) {
                res.status(404).json({ error: "Pedido no encontrado" });
                return;
            }

            const items = await pool.query(`
                SELECT *
                FROM public.pedidos_proveedor_items
                WHERE pedido_id = $1
                AND negocio_id = $2
                ORDER BY id ASC
            `, [req.params.id, negocio.id]);

            res.json({
                pedido: pedido.rows[0],
                items: items.rows
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/pedidos-proveedor", async (req, res) => {
        const { proveedor, estado: estadoPedido, notas, items } = req.body;

        if (!Array.isArray(items) || !items.length) {
            res.status(400).json({ error: "Agrega al menos una partida" });
            return;
        }

        const client = await pool.connect();

        try {
            await asegurar();
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const total = items.reduce(
                (suma, item) => suma + n(item.cantidad) * n(item.costo),
                0
            );

            const pedido = await client.query(`
                INSERT INTO public.pedidos_proveedor
                    (negocio_id, proveedor, estado, notas, total_estimado)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `, [
                negocio.id,
                proveedor || items[0]?.proveedor || "",
                estadoPedido || "enviado",
                notas || "",
                total
            ]);

            for (const item of items) {
                await client.query(`
                    INSERT INTO public.pedidos_proveedor_items
                        (negocio_id, pedido_id, producto_id, codigo, nombre, proveedor, cantidad, costo, unidad, notas)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                `, [
                    negocio.id,
                    pedido.rows[0].id,
                    item.productoId || item.producto_id || null,
                    normalizarCodigo(item.codigo) || item.codigo || "",
                    item.nombre,
                    item.proveedor || proveedor || "",
                    n(item.cantidad),
                    n(item.costo),
                    item.unidad || "pieza",
                    item.notas || ""
                ]);
            }

            await client.query("COMMIT");
            res.json({ pedido: pedido.rows[0] });
        } catch (error) {
            await client.query("ROLLBACK");
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    app.post("/pedidos-proveedor/:id/recepciones", async (req, res) => {
        const { proveedor, referencia, notas, items } = req.body;

        if (!Array.isArray(items) || !items.length) {
            res.status(400).json({ error: "Agrega partidas recibidas" });
            return;
        }

        const client = await pool.connect();

        try {
            await asegurar();
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const pedidoExiste = await client.query(`
                SELECT id
                FROM public.pedidos_proveedor
                WHERE id = $1
                AND negocio_id = $2
                FOR UPDATE
            `, [req.params.id, negocio.id]);

            if (!pedidoExiste.rows.length) {
                await client.query("ROLLBACK");
                res.status(404).json({ error: "Pedido no encontrado" });
                return;
            }

            const total = items.reduce(
                (suma, item) => suma + n(item.cantidad) * n(item.costo),
                0
            );

            const recepcion = await client.query(`
                INSERT INTO public.recepciones_mercancia
                    (negocio_id, pedido_id, proveedor, referencia, notas, total)
                VALUES ($1,$2,$3,$4,$5,$6)
                RETURNING *
            `, [
                negocio.id,
                req.params.id,
                proveedor || "",
                referencia || "",
                notas || "",
                total
            ]);

            for (const item of items) {
                const cantidad = n(item.cantidad);
                const costo = n(item.costo);
                const productoId = item.productoId || item.producto_id || null;
                const itemId = item.pedidoItemId || item.pedido_item_id || null;

                if (productoId && cantidad > 0) {
                    await client.query(`
                        UPDATE public.productos
                        SET
                            stock = stock + $1,
                            precio_distribuidor = COALESCE(NULLIF($2, 0), precio_distribuidor)
                        WHERE id = $3
                        AND negocio_id = $4
                    `, [cantidad, costo, productoId, negocio.id]);
                }

                await client.query(`
                    INSERT INTO public.recepciones_mercancia_items
                        (negocio_id, recepcion_id, pedido_item_id, producto_id, codigo, nombre, cantidad, costo)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                `, [
                    negocio.id,
                    recepcion.rows[0].id,
                    itemId,
                    productoId,
                    normalizarCodigo(item.codigo) || item.codigo || "",
                    item.nombre,
                    cantidad,
                    costo
                ]);

                if (itemId) {
                    await client.query(`
                        UPDATE public.pedidos_proveedor_items
                        SET recibido = recibido + $1
                        WHERE id = $2
                        AND negocio_id = $3
                    `, [cantidad, itemId, negocio.id]);
                }
            }

            const partidas = await client.query(`
                SELECT cantidad, recibido
                FROM public.pedidos_proveedor_items
                WHERE pedido_id = $1
                AND negocio_id = $2
            `, [req.params.id, negocio.id]);

            await client.query(`
                UPDATE public.pedidos_proveedor
                SET estado = $1, updated_at = NOW()
                WHERE id = $2
                AND negocio_id = $3
            `, [estado(partidas.rows), req.params.id, negocio.id]);

            await client.query("COMMIT");
            res.json({ recepcion: recepcion.rows[0] });
        } catch (error) {
            await client.query("ROLLBACK");
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    app.get("/ajustes-inventario", async (req, res) => {
        try {
            await asegurar();
            const negocio = await negocioActual(req);

            const resultado = await pool.query(`
                SELECT *
                FROM public.ajustes_inventario
                WHERE negocio_id = $1
                ORDER BY created_at DESC
                LIMIT 80
            `, [negocio.id]);

            res.json({ ajustes: resultado.rows });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/ajustes-inventario", async (req, res) => {
        const { productoId, tipo, cantidad, motivo, referencia } = req.body;

        if (!productoId || !["entrada", "salida", "conteo"].includes(tipo)) {
            res.status(400).json({ error: "Producto y tipo requeridos" });
            return;
        }

        const cantidadAjuste = n(cantidad);
        const client = await pool.connect();

        try {
            await asegurar();
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const producto = await client.query(`
                SELECT id, nombre, codigo, stock
                FROM public.productos
                WHERE id = $1
                AND negocio_id = $2
                FOR UPDATE
            `, [productoId, negocio.id]);

            if (!producto.rows.length) {
                await client.query("ROLLBACK");
                res.status(404).json({ error: "Producto no encontrado" });
                return;
            }

            const actual = n(producto.rows[0].stock);
            const nuevo =
                tipo === "entrada"
                    ? actual + cantidadAjuste
                    : tipo === "salida"
                        ? actual - cantidadAjuste
                        : cantidadAjuste;

            if (nuevo < 0) {
                await client.query("ROLLBACK");
                res.status(400).json({ error: "El ajuste deja stock negativo" });
                return;
            }

            await client.query(`
                UPDATE public.productos
                SET stock = $1
                WHERE id = $2
                AND negocio_id = $3
            `, [nuevo, productoId, negocio.id]);

            const ajuste = await client.query(`
                INSERT INTO public.ajustes_inventario
                    (negocio_id, producto_id, producto_nombre, codigo, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                RETURNING *
            `, [
                negocio.id,
                productoId,
                producto.rows[0].nombre,
                producto.rows[0].codigo || "",
                tipo,
                cantidadAjuste,
                actual,
                nuevo,
                motivo || "",
                referencia || ""
            ]);

            await client.query("COMMIT");
            res.json({ ajuste: ajuste.rows[0] });
        } catch (error) {
            await client.query("ROLLBACK");
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });
};

const { responderError } = require("./error-utils");

// Listas de productos reutilizables (ej. "Lista utiles 3er grado -
// Agosto 2026", "Despensa basica") -- el dueño arma la lista una vez
// y despues, temporada tras temporada, la agrega completa al carrito
// con un click en vez de buscar producto por producto. A proposito NO
// guarda una copia de nombre/precio del producto (a diferencia de
// encargos_clientes_items, que si es un registro historico) -- una
// lista siempre debe reflejar el precio y stock actuales al momento
// de venderla, asi que cada lectura resuelve los items en vivo contra
// productos.
module.exports = (app, pool, requerirAccesoNegocio) => {
    async function negocioActual(req) {
        const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!negocioId) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return { id: negocioId };
    }

    async function listaConItems(negocioId, id) {
        const lista = await pool.query(
            `SELECT * FROM public.listas_producto WHERE id = $1 AND negocio_id = $2`,
            [id, negocioId]
        );

        if (lista.rows.length === 0) return null;

        const items = await pool.query(
            `SELECT li.id, li.producto_id, li.cantidad, li.orden,
                    p.nombre, p.codigo, p.precio, p.stock, p.unidad_venta
             FROM public.listas_producto_items li
             JOIN public.productos p ON p.id = li.producto_id
             WHERE li.lista_id = $1
             ORDER BY li.orden ASC, li.id ASC`,
            [id]
        );

        return {
            id: lista.rows[0].id,
            nombre: lista.rows[0].nombre,
            descripcion: lista.rows[0].descripcion,
            activa: lista.rows[0].activa,
            createdAt: lista.rows[0].created_at,
            updatedAt: lista.rows[0].updated_at,
            items: items.rows.map(item => ({
                id: item.id,
                productoId: item.producto_id,
                nombre: item.nombre,
                codigo: item.codigo,
                precio: Number(item.precio),
                stock: Number(item.stock),
                unidadVenta: item.unidad_venta,
                cantidad: Number(item.cantidad)
            }))
        };
    }

    app.post("/listas-producto", requerirAccesoNegocio, async (req, res) => {
        const nombre = String(req.body?.nombre || "").trim().slice(0, 140);
        const descripcion = String(req.body?.descripcion || "").trim().slice(0, 500);
        const items = Array.isArray(req.body?.items) ? req.body.items : [];

        if (!nombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre de la lista." });
            return;
        }

        const client = await pool.connect();

        try {
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const lista = await client.query(
                `INSERT INTO public.listas_producto (negocio_id, nombre, descripcion)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [negocio.id, nombre, descripcion]
            );

            const listaId = lista.rows[0].id;

            const productoIds = [...new Set(
                items.map(item => Number(item.productoId || 0)).filter(Boolean)
            )];

            const productosValidos = productoIds.length
                ? await client.query(
                    `SELECT id FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[])`,
                    [negocio.id, productoIds]
                )
                : { rows: [] };

            const idsValidos = new Set(productosValidos.rows.map(fila => fila.id));

            let orden = 0;

            for (const item of items) {
                const productoId = Number(item.productoId || 0);
                if (!productoId || !idsValidos.has(productoId)) continue;

                const cantidad = Number(item.cantidad || 1);

                await client.query(
                    `INSERT INTO public.listas_producto_items (negocio_id, lista_id, producto_id, cantidad, orden)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [negocio.id, listaId, productoId, cantidad > 0 ? cantidad : 1, orden++]
                );
            }

            await client.query("COMMIT");
            const creada = await listaConItems(negocio.id, listaId);
            res.json({ ok: true, lista: creada });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    app.get("/listas-producto", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const listas = await pool.query(
                `SELECT l.id, l.nombre, l.descripcion, l.activa, l.created_at, l.updated_at,
                        COUNT(li.id)::int AS total_items
                 FROM public.listas_producto l
                 LEFT JOIN public.listas_producto_items li ON li.lista_id = l.id
                 WHERE l.negocio_id = $1
                 GROUP BY l.id
                 ORDER BY l.activa DESC, l.updated_at DESC
                 LIMIT 200`,
                [negocio.id]
            );

            res.json({
                ok: true,
                listas: listas.rows.map(fila => ({
                    id: fila.id,
                    nombre: fila.nombre,
                    descripcion: fila.descripcion,
                    activa: fila.activa,
                    totalItems: fila.total_items,
                    createdAt: fila.created_at,
                    updatedAt: fila.updated_at
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/listas-producto/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);
            const lista = await listaConItems(negocio.id, req.params.id);

            if (!lista) {
                res.status(404).json({ ok: false, error: "Lista no encontrada." });
                return;
            }

            res.json({ ok: true, lista });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/listas-producto/:id", requerirAccesoNegocio, async (req, res) => {
        const campos = [];
        const valores = [];
        let indice = 1;

        if (req.body?.nombre !== undefined) {
            const nombre = String(req.body.nombre || "").trim().slice(0, 140);

            if (!nombre) {
                res.status(400).json({ ok: false, error: "El nombre no puede quedar vacio." });
                return;
            }

            campos.push(`nombre = $${indice++}`);
            valores.push(nombre);
        }

        if (req.body?.descripcion !== undefined) {
            campos.push(`descripcion = $${indice++}`);
            valores.push(String(req.body.descripcion || "").trim().slice(0, 500));
        }

        if (req.body?.activa !== undefined) {
            campos.push(`activa = $${indice++}`);
            valores.push(Boolean(req.body.activa));
        }

        if (campos.length === 0) {
            res.status(400).json({ ok: false, error: "Nada que actualizar." });
            return;
        }

        try {
            const negocio = await negocioActual(req);
            campos.push("updated_at = NOW()");
            valores.push(req.params.id, negocio.id);

            const resultado = await pool.query(
                `UPDATE public.listas_producto
                 SET ${campos.join(", ")}
                 WHERE id = $${indice++} AND negocio_id = $${indice}
                 RETURNING id`,
                valores
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Lista no encontrada." });
                return;
            }

            const actualizada = await listaConItems(negocio.id, req.params.id);
            res.json({ ok: true, lista: actualizada });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/listas-producto/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(
                `DELETE FROM public.listas_producto WHERE id = $1 AND negocio_id = $2 RETURNING id`,
                [req.params.id, negocio.id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Lista no encontrada." });
                return;
            }

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/listas-producto/:id/items", requerirAccesoNegocio, async (req, res) => {
        const productoId = Number(req.body?.productoId || 0);
        const cantidad = Number(req.body?.cantidad || 1);

        if (!productoId) {
            res.status(400).json({ ok: false, error: "Elige un producto." });
            return;
        }

        try {
            const negocio = await negocioActual(req);

            const lista = await pool.query(
                `SELECT id FROM public.listas_producto WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );

            if (lista.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Lista no encontrada." });
                return;
            }

            const producto = await pool.query(
                `SELECT id FROM public.productos WHERE id = $1 AND negocio_id = $2`,
                [productoId, negocio.id]
            );

            if (producto.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Producto no encontrado." });
                return;
            }

            const existente = await pool.query(
                `SELECT id, cantidad FROM public.listas_producto_items WHERE lista_id = $1 AND producto_id = $2`,
                [req.params.id, productoId]
            );

            if (existente.rows.length > 0) {
                await pool.query(
                    `UPDATE public.listas_producto_items SET cantidad = $1 WHERE id = $2`,
                    [Number(existente.rows[0].cantidad) + (cantidad > 0 ? cantidad : 1), existente.rows[0].id]
                );
            } else {
                const siguienteOrden = await pool.query(
                    `SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente FROM public.listas_producto_items WHERE lista_id = $1`,
                    [req.params.id]
                );

                await pool.query(
                    `INSERT INTO public.listas_producto_items (negocio_id, lista_id, producto_id, cantidad, orden)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [negocio.id, req.params.id, productoId, cantidad > 0 ? cantidad : 1, siguienteOrden.rows[0].siguiente]
                );
            }

            await pool.query(`UPDATE public.listas_producto SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

            const actualizada = await listaConItems(negocio.id, req.params.id);
            res.json({ ok: true, lista: actualizada });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/listas-producto/:id/items/:itemId", requerirAccesoNegocio, async (req, res) => {
        const cantidad = Number(req.body?.cantidad);

        if (!(cantidad > 0)) {
            res.status(400).json({ ok: false, error: "Cantidad invalida." });
            return;
        }

        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(
                `UPDATE public.listas_producto_items
                 SET cantidad = $1
                 WHERE id = $2 AND lista_id = $3 AND negocio_id = $4
                 RETURNING id`,
                [cantidad, req.params.itemId, req.params.id, negocio.id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Articulo no encontrado." });
                return;
            }

            await pool.query(`UPDATE public.listas_producto SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

            const actualizada = await listaConItems(negocio.id, req.params.id);
            res.json({ ok: true, lista: actualizada });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/listas-producto/:id/items/:itemId", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(
                `DELETE FROM public.listas_producto_items
                 WHERE id = $1 AND lista_id = $2 AND negocio_id = $3
                 RETURNING id`,
                [req.params.itemId, req.params.id, negocio.id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Articulo no encontrado." });
                return;
            }

            await pool.query(`UPDATE public.listas_producto SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

            const actualizada = await listaConItems(negocio.id, req.params.id);
            res.json({ ok: true, lista: actualizada });
        } catch (error) {
            responderError(res, error);
        }
    });
};

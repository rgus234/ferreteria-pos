const { responderError } = require("./error-utils");

// Encargos de clientes: productos que un cliente pidio que se le
// encargue con el proveedor (Diprofer/Truper/etc) porque no estan en
// inventario. Distinto de "Pedidos a proveedor" (fase4-server.js),
// que es reabastecimiento del propio negocio sin concepto de cliente.
// El cliente puede ser uno de credito ya existente (clienteId) o
// alguien sin cuenta -- clienteNombre siempre se guarda como texto
// libre, igual que ya hace cotizaciones_pendientes.
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

    async function encargoConItems(negocioId, id) {
        const encargo = await pool.query(
            `SELECT * FROM public.encargos_clientes WHERE id = $1 AND negocio_id = $2`,
            [id, negocioId]
        );

        if (encargo.rows.length === 0) return null;

        const items = await pool.query(
            `SELECT id, producto_id, codigo, nombre, cantidad, precio_estimado
             FROM public.encargos_clientes_items
             WHERE encargo_id = $1
             ORDER BY id ASC`,
            [id]
        );

        return {
            id: encargo.rows[0].id,
            clienteId: encargo.rows[0].cliente_id,
            clienteNombre: encargo.rows[0].cliente_nombre,
            clienteTelefono: encargo.rows[0].cliente_telefono,
            anticipo: Number(encargo.rows[0].anticipo),
            fechaEntregaEsperada: encargo.rows[0].fecha_entrega_esperada,
            estado: encargo.rows[0].estado,
            notas: encargo.rows[0].notas,
            createdAt: encargo.rows[0].created_at,
            updatedAt: encargo.rows[0].updated_at,
            items: items.rows.map(item => ({
                id: item.id,
                productoId: item.producto_id,
                codigo: item.codigo,
                nombre: item.nombre,
                cantidad: Number(item.cantidad),
                precioEstimado: Number(item.precio_estimado)
            }))
        };
    }

    app.post("/encargos-clientes", requerirAccesoNegocio, async (req, res) => {
        const clienteNombre = String(req.body?.clienteNombre || "").trim().slice(0, 140);
        const clienteTelefono = String(req.body?.clienteTelefono || "").trim().slice(0, 40);
        const clienteId = req.body?.clienteId ? Number(req.body.clienteId) : null;
        const anticipo = Number(req.body?.anticipo || 0);
        const fechaEntregaEsperada = req.body?.fechaEntregaEsperada || null;
        const notas = String(req.body?.notas || "").trim().slice(0, 500);
        const items = Array.isArray(req.body?.items) ? req.body.items : [];

        if (!clienteNombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre del cliente." });
            return;
        }

        if (items.length === 0) {
            res.status(400).json({ ok: false, error: "Agrega al menos un producto." });
            return;
        }

        const client = await pool.connect();

        try {
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const encargo = await client.query(
                `INSERT INTO public.encargos_clientes
                    (negocio_id, cliente_id, cliente_nombre, cliente_telefono, anticipo, fecha_entrega_esperada, notas)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [negocio.id, clienteId, clienteNombre, clienteTelefono, anticipo, fechaEntregaEsperada, notas]
            );

            const encargoId = encargo.rows[0].id;

            for (const item of items) {
                const nombre = String(item.nombre || "").trim().slice(0, 200);
                if (!nombre) continue;

                await client.query(
                    `INSERT INTO public.encargos_clientes_items
                        (negocio_id, encargo_id, producto_id, codigo, nombre, cantidad, precio_estimado)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        negocio.id,
                        encargoId,
                        item.productoId || null,
                        String(item.codigo || "").slice(0, 80),
                        nombre,
                        Number(item.cantidad || 1),
                        Number(item.precioEstimado || 0)
                    ]
                );
            }

            await client.query("COMMIT");
            res.json({ ok: true, id: encargoId });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    app.get("/encargos-clientes", requerirAccesoNegocio, async (req, res) => {
        const estado = String(req.query?.estado || "").trim();

        try {
            const negocio = await negocioActual(req);
            const filtroEstado = estado ? " AND e.estado = $2" : "";
            const parametros = estado ? [negocio.id, estado] : [negocio.id];

            const encargos = await pool.query(
                `SELECT e.id, e.cliente_id, e.cliente_nombre, e.cliente_telefono, e.anticipo,
                        e.fecha_entrega_esperada, e.estado, e.notas, e.created_at, e.updated_at,
                        COUNT(i.id)::int AS total_items,
                        COALESCE(SUM(i.cantidad * i.precio_estimado), 0) AS total_estimado
                 FROM public.encargos_clientes e
                 LEFT JOIN public.encargos_clientes_items i ON i.encargo_id = e.id
                 WHERE e.negocio_id = $1${filtroEstado}
                 GROUP BY e.id
                 ORDER BY
                    CASE WHEN e.fecha_entrega_esperada IS NULL THEN 1 ELSE 0 END,
                    e.fecha_entrega_esperada ASC,
                    e.created_at DESC
                 LIMIT 200`,
                parametros
            );

            res.json({
                ok: true,
                encargos: encargos.rows.map(fila => ({
                    id: fila.id,
                    clienteId: fila.cliente_id,
                    clienteNombre: fila.cliente_nombre,
                    clienteTelefono: fila.cliente_telefono,
                    anticipo: Number(fila.anticipo),
                    fechaEntregaEsperada: fila.fecha_entrega_esperada,
                    estado: fila.estado,
                    notas: fila.notas,
                    totalItems: fila.total_items,
                    totalEstimado: Number(fila.total_estimado),
                    createdAt: fila.created_at,
                    updatedAt: fila.updated_at
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/encargos-clientes/pendientes-hoy", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const encargos = await pool.query(
                `SELECT id, cliente_nombre, fecha_entrega_esperada
                 FROM public.encargos_clientes
                 WHERE negocio_id = $1
                 AND estado IN ('pendiente', 'listo')
                 AND fecha_entrega_esperada IS NOT NULL
                 AND fecha_entrega_esperada <= CURRENT_DATE
                 ORDER BY fecha_entrega_esperada ASC
                 LIMIT 20`,
                [negocio.id]
            );

            res.json({
                ok: true,
                encargos: encargos.rows.map(fila => ({
                    id: fila.id,
                    clienteNombre: fila.cliente_nombre,
                    fechaEntregaEsperada: fila.fecha_entrega_esperada
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/encargos-clientes/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);
            const encargo = await encargoConItems(negocio.id, req.params.id);

            if (!encargo) {
                res.status(404).json({ ok: false, error: "Encargo no encontrado." });
                return;
            }

            res.json({ ok: true, encargo });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/encargos-clientes/:id/items", requerirAccesoNegocio, async (req, res) => {
        const nombre = String(req.body?.nombre || "").trim().slice(0, 200);

        if (!nombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre del producto." });
            return;
        }

        try {
            const negocio = await negocioActual(req);

            const encargo = await pool.query(
                `SELECT id FROM public.encargos_clientes WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );

            if (encargo.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Encargo no encontrado." });
                return;
            }

            await pool.query(
                `INSERT INTO public.encargos_clientes_items
                    (negocio_id, encargo_id, producto_id, codigo, nombre, cantidad, precio_estimado)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    negocio.id,
                    req.params.id,
                    req.body?.productoId || null,
                    String(req.body?.codigo || "").slice(0, 80),
                    nombre,
                    Number(req.body?.cantidad || 1),
                    Number(req.body?.precioEstimado || 0)
                ]
            );

            await pool.query(
                `UPDATE public.encargos_clientes SET updated_at = NOW() WHERE id = $1`,
                [req.params.id]
            );

            const actualizado = await encargoConItems(negocio.id, req.params.id);
            res.json({ ok: true, encargo: actualizado });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/encargos-clientes/:id/items/:itemId", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(
                `DELETE FROM public.encargos_clientes_items
                 WHERE id = $1 AND encargo_id = $2 AND negocio_id = $3
                 RETURNING id`,
                [req.params.itemId, req.params.id, negocio.id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Articulo no encontrado." });
                return;
            }

            await pool.query(
                `UPDATE public.encargos_clientes SET updated_at = NOW() WHERE id = $1`,
                [req.params.id]
            );

            const actualizado = await encargoConItems(negocio.id, req.params.id);
            res.json({ ok: true, encargo: actualizado });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/encargos-clientes/:id", requerirAccesoNegocio, async (req, res) => {
        const campos = [];
        const valores = [];
        let indice = 1;

        if (req.body?.estado !== undefined) {
            if (!["pendiente", "listo", "entregado", "cancelado"].includes(req.body.estado)) {
                res.status(400).json({ ok: false, error: "Estado invalido." });
                return;
            }
            campos.push(`estado = $${indice++}`);
            valores.push(req.body.estado);
        }

        if (req.body?.anticipo !== undefined) {
            campos.push(`anticipo = $${indice++}`);
            valores.push(Number(req.body.anticipo || 0));
        }

        if (req.body?.fechaEntregaEsperada !== undefined) {
            campos.push(`fecha_entrega_esperada = $${indice++}`);
            valores.push(req.body.fechaEntregaEsperada || null);
        }

        if (req.body?.notas !== undefined) {
            campos.push(`notas = $${indice++}`);
            valores.push(String(req.body.notas || "").trim().slice(0, 500));
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
                `UPDATE public.encargos_clientes
                 SET ${campos.join(", ")}
                 WHERE id = $${indice++} AND negocio_id = $${indice}
                 RETURNING id`,
                valores
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Encargo no encontrado." });
                return;
            }

            const actualizado = await encargoConItems(negocio.id, req.params.id);
            res.json({ ok: true, encargo: actualizado });
        } catch (error) {
            responderError(res, error);
        }
    });
};

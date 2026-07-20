const { responderError } = require("./error-utils");

// Cotizaciones/pedidos que el dueño toma sin internet desde /dueno.
// Todas las rutas usan requerirSesionCuenta (solo login de correo +
// contraseña del dueño) -- a diferencia de requerirAccesoNegocio, que
// tambien acepta el token de cualquier caja vinculada. Estas
// cotizaciones nunca se vuelven ventas automaticamente: quedan en
// 'pendiente' hasta que el dueño las confirme o descarte a mano.
module.exports = (app, pool, requerirSesionCuenta) => {
    app.post("/dueno/cotizaciones", requerirSesionCuenta, async (req, res) => {
        const negocioId = req.negocioAutenticado.negocio_id;

        const clienteNombre = String(req.body?.clienteNombre || "").trim().slice(0, 140);
        const clienteTelefono = String(req.body?.clienteTelefono || "").trim().slice(0, 40);
        const notas = String(req.body?.notas || "").trim().slice(0, 500);
        const eventId = String(req.body?.eventId || "").trim().slice(0, 80);
        const items = Array.isArray(req.body?.items) ? req.body.items : [];

        if (!clienteNombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre del cliente." });
            return;
        }

        if (!eventId) {
            res.status(400).json({ ok: false, error: "Falta el identificador del pedido." });
            return;
        }

        if (items.length === 0) {
            res.status(400).json({ ok: false, error: "Agrega al menos un producto." });
            return;
        }

        const totalEstimado = items.reduce(
            (suma, item) => suma + Number(item.precioUnitario || 0) * Number(item.cantidad || 0),
            0
        );

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const existente = await client.query(
                `SELECT id FROM public.cotizaciones_pendientes WHERE negocio_id = $1 AND event_id = $2`,
                [negocioId, eventId]
            );

            if (existente.rows.length > 0) {
                await client.query("COMMIT");
                res.json({ ok: true, id: existente.rows[0].id, repetido: true });
                return;
            }

            const cotizacion = await client.query(
                `INSERT INTO public.cotizaciones_pendientes
                    (negocio_id, event_id, cliente_nombre, cliente_telefono, notas, total_estimado)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
                [negocioId, eventId, clienteNombre, clienteTelefono, notas, totalEstimado]
            );

            const cotizacionId = cotizacion.rows[0].id;

            for (const item of items) {
                await client.query(
                    `INSERT INTO public.cotizaciones_pendientes_items
                        (negocio_id, cotizacion_id, producto_id, codigo, nombre, precio_unitario, cantidad)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        negocioId,
                        cotizacionId,
                        item.productoId || null,
                        String(item.codigo || "").slice(0, 80),
                        String(item.nombre || "").slice(0, 200),
                        Number(item.precioUnitario || 0),
                        Number(item.cantidad || 0)
                    ]
                );
            }

            await client.query("COMMIT");
            res.json({ ok: true, id: cotizacionId });
        } catch (error) {
            await client.query("ROLLBACK");
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    app.get("/dueno/cotizaciones", requerirSesionCuenta, async (req, res) => {
        const negocioId = req.negocioAutenticado.negocio_id;
        const estado = String(req.query?.estado || "").trim();

        try {
            const filtroEstado = estado ? " AND estado = $2" : "";
            const parametros = estado ? [negocioId, estado] : [negocioId];

            const cotizaciones = await pool.query(
                `SELECT id, cliente_nombre, cliente_telefono, notas, estado, total_estimado, creada_offline, created_at, updated_at
                 FROM public.cotizaciones_pendientes
                 WHERE negocio_id = $1${filtroEstado}
                 ORDER BY created_at DESC
                 LIMIT 100`,
                parametros
            );

            const ids = cotizaciones.rows.map(fila => fila.id);
            let itemsPorCotizacion = {};

            if (ids.length > 0) {
                const items = await pool.query(
                    `SELECT cotizacion_id, codigo, nombre, precio_unitario, cantidad
                     FROM public.cotizaciones_pendientes_items
                     WHERE cotizacion_id = ANY($1::int[])`,
                    [ids]
                );

                itemsPorCotizacion = items.rows.reduce((mapa, item) => {
                    (mapa[item.cotizacion_id] = mapa[item.cotizacion_id] || []).push({
                        codigo: item.codigo,
                        nombre: item.nombre,
                        precioUnitario: Number(item.precio_unitario),
                        cantidad: Number(item.cantidad)
                    });
                    return mapa;
                }, {});
            }

            res.json({
                ok: true,
                cotizaciones: cotizaciones.rows.map(fila => ({
                    id: fila.id,
                    clienteNombre: fila.cliente_nombre,
                    clienteTelefono: fila.cliente_telefono,
                    notas: fila.notas,
                    estado: fila.estado,
                    totalEstimado: Number(fila.total_estimado),
                    creadaOffline: fila.creada_offline,
                    createdAt: fila.created_at,
                    items: itemsPorCotizacion[fila.id] || []
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/dueno/cotizaciones/:id/estado", requerirSesionCuenta, async (req, res) => {
        const negocioId = req.negocioAutenticado.negocio_id;
        const estado = String(req.body?.estado || "").trim();

        if (!["confirmada", "descartada"].includes(estado)) {
            res.status(400).json({ ok: false, error: "Estado invalido." });
            return;
        }

        try {
            const resultado = await pool.query(
                `UPDATE public.cotizaciones_pendientes
                 SET estado = $1, updated_at = NOW()
                 WHERE id = $2 AND negocio_id = $3
                 RETURNING id`,
                [estado, req.params.id, negocioId]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Cotizacion no encontrada." });
                return;
            }

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};

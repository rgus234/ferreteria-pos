const { responderError } = require("./error-utils");

// Exhibidores: muebles/displays de la tienda (despachador de brocas, exhibidor
// de lijas...) que agrupan productos YA existentes en "espacios". Sirven para
// vender con tarjetas visuales, recibir mercancia por exhibidor y surtir lo que
// falta. Igual que las listas de productos, NO guardan copia de nombre/precio/
// stock: cada lectura resuelve los espacios en vivo contra productos, y no
// tocan el inventario.
const COLORES_VALIDOS = ["azul", "naranja", "verde", "rojo", "morado", "negro"];

function colorValido(valor) {
    const color = String(valor || "").trim().toLowerCase();
    return COLORES_VALIDOS.includes(color) ? color : "azul";
}

function cantidadValida(valor, porDefecto = 0) {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= 0 ? Math.min(numero, 999999) : porDefecto;
}

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

    function idValido(valor) {
        const numero = Number(valor);
        return Number.isInteger(numero) && numero > 0 ? numero : null;
    }

    async function exhibidorConEspacios(negocioId, id) {
        const exhibidor = await pool.query(
            `SELECT * FROM public.exhibidores WHERE id = $1 AND negocio_id = $2`,
            [id, negocioId]
        );

        if (exhibidor.rows.length === 0) return null;

        const espacios = await pool.query(
            `SELECT e.id, e.producto_id, e.etiqueta, e.capacidad, e.orden,
                    p.nombre, p.codigo, p.precio, p.stock, p.stock_resto, p.unidad_venta
             FROM public.exhibidor_espacios e
             JOIN public.productos p ON p.id = e.producto_id
             WHERE e.exhibidor_id = $1 AND e.negocio_id = $2
             ORDER BY e.orden ASC, e.id ASC`,
            [id, negocioId]
        );

        const fila = exhibidor.rows[0];

        return {
            id: fila.id,
            nombre: fila.nombre,
            descripcion: fila.descripcion,
            color: fila.color,
            activo: fila.activo,
            createdAt: fila.created_at,
            updatedAt: fila.updated_at,
            espacios: espacios.rows.map(espacio => {
                const existencia = Number(espacio.stock) + Number(espacio.stock_resto || 0);
                const capacidad = Number(espacio.capacidad);

                return {
                    id: espacio.id,
                    productoId: espacio.producto_id,
                    etiqueta: espacio.etiqueta,
                    capacidad,
                    nombre: espacio.nombre,
                    codigo: espacio.codigo,
                    precio: Number(espacio.precio),
                    stock: Number(espacio.stock),
                    existencia,
                    unidadVenta: espacio.unidad_venta,
                    faltan: capacidad > 0 ? Math.max(0, Number((capacidad - existencia).toFixed(3))) : 0
                };
            })
        };
    }

    async function productosDelNegocio(client, negocioId, ids) {
        if (ids.length === 0) return new Set();

        const resultado = await client.query(
            `SELECT id FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[])`,
            [negocioId, ids]
        );

        return new Set(resultado.rows.map(fila => fila.id));
    }

    app.get("/exhibidores", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const exhibidores = await pool.query(
                `SELECT x.id, x.nombre, x.descripcion, x.color, x.activo, x.updated_at,
                        COUNT(e.id)::int AS total_espacios,
                        COUNT(e.id) FILTER (WHERE p.stock + p.stock_resto <= 0)::int AS agotados,
                        COALESCE(
                            (ARRAY_AGG(e.producto_id ORDER BY e.orden, e.id) FILTER (WHERE e.id IS NOT NULL))[1:4],
                            ARRAY[]::int[]
                        ) AS vista_previa
                 FROM public.exhibidores x
                 LEFT JOIN public.exhibidor_espacios e ON e.exhibidor_id = x.id
                 LEFT JOIN public.productos p ON p.id = e.producto_id
                 WHERE x.negocio_id = $1
                 GROUP BY x.id
                 ORDER BY x.activo DESC, x.updated_at DESC
                 LIMIT 200`,
                [negocio.id]
            );

            res.json({
                ok: true,
                exhibidores: exhibidores.rows.map(fila => ({
                    id: fila.id,
                    nombre: fila.nombre,
                    descripcion: fila.descripcion,
                    color: fila.color,
                    activo: fila.activo,
                    totalEspacios: fila.total_espacios,
                    agotados: fila.agotados,
                    vistaPrevia: fila.vista_previa,
                    updatedAt: fila.updated_at
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Busca en los catalogos de proveedor del negocio (el de Diprofer trae
    // Truper, por ejemplo) por codigo o por nombre, para meter al exhibidor un
    // producto que aun no esta en el inventario. SOLO LEE: crear el producto lo
    // hace la ruta ya probada de catalogo-proveedor/.../crear-producto.
    //
    // Mismo criterio de confianza que /catalogo-proveedor/buscar-codigo: una
    // fila sin ningun precio es basura de un catalogo mal leido (GAFI) y no se
    // ofrece; si el mismo codigo esta en varios catalogos gana el que trae mas
    // niveles de precio y, a igualdad, el catalogo mas nuevo. Debe ir ANTES de
    // /exhibidores/:id para que "buscar-catalogo" no se tome como un id.
    app.get("/exhibidores/buscar-catalogo", requerirAccesoNegocio, async (req, res) => {
        const consulta = String(req.query.q || "").trim().slice(0, 80);

        if (consulta.length < 2) {
            res.json({ ok: true, resultados: [] });
            return;
        }

        try {
            const negocio = await negocioActual(req);
            const palabras = consulta.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
                .map(palabra => `%${palabra.replace(/[\\%_]/g, "\\$&")}%`);

            const filas = await pool.query(
                `
                SELECT * FROM (
                    SELECT DISTINCT ON (COALESCE(NULLIF(cp.codigo_interno, ''), cp.codigo_proveedor))
                           cp.id, cp.catalogo_id, cp.codigo_proveedor, cp.codigo_interno, cp.nombre_proveedor, cp.marca,
                           cp.precio_medio_mayoreo, cp.precio_publico, cat.proveedor,
                           COALESCE(cp.producto_id, (
                               SELECT p.id FROM public.productos p
                               WHERE p.negocio_id = $1
                                 AND p.codigo IN (cp.codigo_interno, cp.codigo_proveedor, NULLIF(cp.codigo_barras, ''))
                               LIMIT 1
                           )) AS producto_id,
                           (cp.codigo_proveedor = $2 OR NULLIF(cp.codigo_interno, '') = $2 OR NULLIF(cp.clave_proveedor, '') = $2 OR NULLIF(cp.codigo_barras, '') = $2) AS por_codigo
                    FROM public.catalogo_productos cp
                    JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id
                    WHERE cp.negocio_id = $1
                      AND (COALESCE(cp.precio_medio_mayoreo, 0) > 0 OR COALESCE(cp.precio_publico, 0) > 0 OR COALESCE(cp.precio_distribuidor, 0) > 0)
                      AND (
                          cp.codigo_proveedor = $2 OR NULLIF(cp.codigo_interno, '') = $2
                          OR NULLIF(cp.clave_proveedor, '') = $2 OR NULLIF(cp.codigo_barras, '') = $2
                          OR cp.codigo_proveedor ILIKE $4 OR NULLIF(cp.codigo_interno, '') ILIKE $4
                          OR cp.nombre_proveedor ILIKE ALL($3::text[])
                      )
                    ORDER BY COALESCE(NULLIF(cp.codigo_interno, ''), cp.codigo_proveedor),
                             (CASE WHEN COALESCE(cp.precio_medio_mayoreo, 0) > 0 THEN 1 ELSE 0 END
                              + CASE WHEN COALESCE(cp.precio_publico, 0) > 0 THEN 1 ELSE 0 END
                              + CASE WHEN COALESCE(cp.precio_distribuidor, 0) > 0 THEN 1 ELSE 0 END) DESC,
                             cp.catalogo_id DESC, cp.id ASC
                ) mejores
                ORDER BY por_codigo DESC, nombre_proveedor ASC
                LIMIT 8
                `,
                // $4: "empieza con" para el codigo (desde 3 caracteres), asi al
                // teclear 1111 ya aparecen 11110, 11111... sin esperar el codigo completo.
                [negocio.id, consulta, palabras, consulta.length >= 3 ? `${consulta.replace(/[\\%_]/g, "\\$&")}%` : null]
            );

            res.json({
                ok: true,
                resultados: filas.rows.map(fila => ({
                    catalogoId: fila.catalogo_id,
                    catalogoProductoId: fila.id,
                    codigo: fila.codigo_interno || fila.codigo_proveedor,
                    nombre: fila.nombre_proveedor,
                    marca: fila.marca || "",
                    proveedor: fila.proveedor || "",
                    precio: Number(fila.precio_medio_mayoreo) || Number(fila.precio_publico) || 0,
                    productoId: fila.producto_id || null
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/exhibidores", requerirAccesoNegocio, async (req, res) => {
        const nombre = String(req.body?.nombre || "").trim().slice(0, 140);
        const descripcion = String(req.body?.descripcion || "").trim().slice(0, 500);
        const espacios = Array.isArray(req.body?.espacios) ? req.body.espacios.slice(0, 500) : [];

        if (!nombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre del exhibidor." });
            return;
        }

        const client = await pool.connect();

        try {
            const negocio = await negocioActual(req);
            await client.query("BEGIN");

            const creado = await client.query(
                `INSERT INTO public.exhibidores (negocio_id, nombre, descripcion, color)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [negocio.id, nombre, descripcion, colorValido(req.body?.color)]
            );

            const exhibidorId = creado.rows[0].id;

            const ids = [...new Set(espacios.map(item => idValido(item?.productoId)).filter(Boolean))];
            const validos = await productosDelNegocio(client, negocio.id, ids);
            const yaPuestos = new Set();
            let orden = 0;

            for (const item of espacios) {
                const productoId = idValido(item?.productoId);
                if (!productoId || !validos.has(productoId) || yaPuestos.has(productoId)) continue;
                yaPuestos.add(productoId);

                await client.query(
                    `INSERT INTO public.exhibidor_espacios (negocio_id, exhibidor_id, producto_id, etiqueta, capacidad, orden)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [negocio.id, exhibidorId, productoId, String(item.etiqueta || "").trim().slice(0, 80), cantidadValida(item.capacidad), orden++]
                );
            }

            await client.query("COMMIT");
            res.status(201).json({ ok: true, exhibidor: await exhibidorConEspacios(negocio.id, exhibidorId) });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    app.get("/exhibidores/:id", requerirAccesoNegocio, async (req, res) => {
        const id = idValido(req.params.id);

        if (!id) {
            res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
            return;
        }

        try {
            const negocio = await negocioActual(req);
            const exhibidor = await exhibidorConEspacios(negocio.id, id);

            if (!exhibidor) {
                res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
                return;
            }

            res.json({ ok: true, exhibidor });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/exhibidores/:id", requerirAccesoNegocio, async (req, res) => {
        const id = idValido(req.params.id);
        const campos = [];
        const valores = [];
        let indice = 1;

        if (!id) {
            res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
            return;
        }

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

        if (req.body?.color !== undefined) {
            campos.push(`color = $${indice++}`);
            valores.push(colorValido(req.body.color));
        }

        if (req.body?.activo !== undefined) {
            campos.push(`activo = $${indice++}`);
            valores.push(Boolean(req.body.activo));
        }

        if (campos.length === 0) {
            res.status(400).json({ ok: false, error: "Nada que actualizar." });
            return;
        }

        try {
            const negocio = await negocioActual(req);
            campos.push("updated_at = NOW()");
            valores.push(id, negocio.id);

            const resultado = await pool.query(
                `UPDATE public.exhibidores
                 SET ${campos.join(", ")}
                 WHERE id = $${indice++} AND negocio_id = $${indice}
                 RETURNING id`,
                valores
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
                return;
            }

            res.json({ ok: true, exhibidor: await exhibidorConEspacios(negocio.id, id) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/exhibidores/:id", requerirAccesoNegocio, async (req, res) => {
        const id = idValido(req.params.id);

        if (!id) {
            res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
            return;
        }

        try {
            const negocio = await negocioActual(req);

            // Solo borra el exhibidor y sus espacios (ON DELETE CASCADE): los
            // productos y su inventario no se tocan.
            const resultado = await pool.query(
                `DELETE FROM public.exhibidores WHERE id = $1 AND negocio_id = $2 RETURNING id`,
                [id, negocio.id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
                return;
            }

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/exhibidores/:id/espacios", requerirAccesoNegocio, async (req, res) => {
        const id = idValido(req.params.id);
        const productoId = idValido(req.body?.productoId);

        if (!id) {
            res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
            return;
        }

        if (!productoId) {
            res.status(400).json({ ok: false, error: "Elige un producto." });
            return;
        }

        try {
            const negocio = await negocioActual(req);

            const exhibidor = await pool.query(
                `SELECT id FROM public.exhibidores WHERE id = $1 AND negocio_id = $2`,
                [id, negocio.id]
            );

            if (exhibidor.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Exhibidor no encontrado." });
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
                `SELECT id FROM public.exhibidor_espacios WHERE exhibidor_id = $1 AND producto_id = $2`,
                [id, productoId]
            );

            if (existente.rows.length > 0) {
                res.status(409).json({ ok: false, error: "Ese producto ya esta en este exhibidor." });
                return;
            }

            const siguienteOrden = await pool.query(
                `SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente FROM public.exhibidor_espacios WHERE exhibidor_id = $1`,
                [id]
            );

            await pool.query(
                `INSERT INTO public.exhibidor_espacios (negocio_id, exhibidor_id, producto_id, etiqueta, capacidad, orden)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    negocio.id,
                    id,
                    productoId,
                    String(req.body?.etiqueta || "").trim().slice(0, 80),
                    cantidadValida(req.body?.capacidad),
                    siguienteOrden.rows[0].siguiente
                ]
            );

            await pool.query(`UPDATE public.exhibidores SET updated_at = NOW() WHERE id = $1`, [id]);

            res.json({ ok: true, exhibidor: await exhibidorConEspacios(negocio.id, id) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/exhibidores/:id/espacios/:espacioId", requerirAccesoNegocio, async (req, res) => {
        const id = idValido(req.params.id);
        const espacioId = idValido(req.params.espacioId);
        const campos = [];
        const valores = [];
        let indice = 1;

        if (!id || !espacioId) {
            res.status(404).json({ ok: false, error: "Espacio no encontrado." });
            return;
        }

        if (req.body?.etiqueta !== undefined) {
            campos.push(`etiqueta = $${indice++}`);
            valores.push(String(req.body.etiqueta || "").trim().slice(0, 80));
        }

        if (req.body?.capacidad !== undefined) {
            campos.push(`capacidad = $${indice++}`);
            valores.push(cantidadValida(req.body.capacidad));
        }

        if (campos.length === 0) {
            res.status(400).json({ ok: false, error: "Nada que actualizar." });
            return;
        }

        try {
            const negocio = await negocioActual(req);
            valores.push(espacioId, id, negocio.id);

            const resultado = await pool.query(
                `UPDATE public.exhibidor_espacios
                 SET ${campos.join(", ")}
                 WHERE id = $${indice++} AND exhibidor_id = $${indice++} AND negocio_id = $${indice}
                 RETURNING id`,
                valores
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Espacio no encontrado." });
                return;
            }

            await pool.query(`UPDATE public.exhibidores SET updated_at = NOW() WHERE id = $1`, [id]);

            res.json({ ok: true, exhibidor: await exhibidorConEspacios(negocio.id, id) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/exhibidores/:id/espacios/:espacioId", requerirAccesoNegocio, async (req, res) => {
        const id = idValido(req.params.id);
        const espacioId = idValido(req.params.espacioId);

        if (!id || !espacioId) {
            res.status(404).json({ ok: false, error: "Espacio no encontrado." });
            return;
        }

        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(
                `DELETE FROM public.exhibidor_espacios
                 WHERE id = $1 AND exhibidor_id = $2 AND negocio_id = $3
                 RETURNING id`,
                [espacioId, id, negocio.id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Espacio no encontrado." });
                return;
            }

            await pool.query(`UPDATE public.exhibidores SET updated_at = NOW() WHERE id = $1`, [id]);

            res.json({ ok: true, exhibidor: await exhibidorConEspacios(negocio.id, id) });
        } catch (error) {
            responderError(res, error);
        }
    });
};

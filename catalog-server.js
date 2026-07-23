const { responderError } = require("./error-utils");

async function negocioActual(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(`SELECT id FROM public.negocios WHERE id = $1 LIMIT 1`, [negocioId]);

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

// Umbrales de similitud de texto (pg_trgm) para decidir el estado de
// vinculacion automatica -- se ajustan aqui si la precision real
// contra un catalogo grande resulta muy floja o muy estricta.
const UMBRAL_VINCULADO = 0.70;
const UMBRAL_COINCIDENCIA_PARCIAL = 0.45;

// Corre el algoritmo de vinculacion para todo un catalogo:
// 1) match exacto por codigo (codigo_interno o codigo_proveedor contra
//    productos.codigo), 2) similitud de nombre via pg_trgm para lo que
//    no matcheo exacto, 3) nunca sobreescribe una vinculacion manual --
//    si el algoritmo sugiere algo distinto a lo que el humano ya fijo,
//    se marca "conflicto" en vez de pisarlo en silencio.
async function vincularCatalogoProductos(pool, negocioId, catalogoId) {
    // Paso 1: match exacto por codigo, solo sobre filas que no estan
    // vinculadas manualmente (una vinculacion manual nunca se toca aqui).
    await pool.query(
        `
        UPDATE public.catalogo_productos cp
        SET producto_id = p.id,
            estado = 'vinculado',
            porcentaje_coincidencia = 100,
            updated_at = NOW()
        FROM public.productos p
        WHERE cp.catalogo_id = $1
          AND cp.negocio_id = $2
          AND cp.vinculado_manualmente = false
          AND p.negocio_id = $2
          AND p.codigo <> ''
          AND (p.codigo = NULLIF(cp.codigo_interno, '') OR p.codigo = cp.codigo_proveedor)
        `,
        [catalogoId, negocioId]
    );

    // Paso 2: para lo que sigue sin vincular (y no es manual), buscar
    // el mejor candidato por similitud de nombre con pg_trgm.
    const candidatos = await pool.query(
        `
        SELECT cp.id AS catalogo_producto_id, mejor.producto_id, mejor.similitud
        FROM public.catalogo_productos cp
        JOIN LATERAL (
            SELECT p.id AS producto_id, similarity(p.nombre, cp.nombre_proveedor) AS similitud
            FROM public.productos p
            WHERE p.negocio_id = $2
            ORDER BY similitud DESC
            LIMIT 1
        ) mejor ON true
        WHERE cp.catalogo_id = $1
          AND cp.negocio_id = $2
          AND cp.vinculado_manualmente = false
          AND cp.estado <> 'vinculado'
        `,
        [catalogoId, negocioId]
    );

    for (const fila of candidatos.rows) {
        const similitud = Number(fila.similitud);
        let estado = "sin_vincular";
        let productoId = null;
        let porcentaje = null;

        if (similitud >= UMBRAL_VINCULADO) {
            estado = "vinculado";
            productoId = fila.producto_id;
            porcentaje = Math.round(similitud * 100);
        } else if (similitud >= UMBRAL_COINCIDENCIA_PARCIAL) {
            estado = "coincidencia_parcial";
            productoId = fila.producto_id;
            porcentaje = Math.round(similitud * 100);
        }

        await pool.query(
            `UPDATE public.catalogo_productos SET producto_id = $2, estado = $3, porcentaje_coincidencia = $4, updated_at = NOW() WHERE id = $1`,
            [fila.catalogo_producto_id, productoId, estado, porcentaje]
        );
    }

    // Paso 3: conflicto -- una fila vinculada manualmente cuyo
    // producto ya no existe pierde su ancla y se marca para que un
    // humano decida, nunca se re-vincula sola. Dos casos: el FK
    // (ON DELETE SET NULL) ya puso producto_id en NULL cuando el
    // producto se borro por otro lado (ej. Inventario), o -- por si
    // algun dia cambia esa politica -- el producto_id sigue apuntando
    // a un id que ya no existe.
    await pool.query(
        `
        UPDATE public.catalogo_productos cp
        SET estado = 'conflicto', updated_at = NOW()
        WHERE cp.catalogo_id = $1
          AND cp.negocio_id = $2
          AND cp.vinculado_manualmente = true
          AND (
              (cp.producto_id IS NULL AND cp.estado = 'vinculado')
              OR (cp.producto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.productos p WHERE p.id = cp.producto_id))
          )
        `,
        [catalogoId, negocioId]
    );

    await actualizarContadoresCatalogo(pool, negocioId, catalogoId);
}

async function actualizarContadoresCatalogo(pool, negocioId, catalogoId) {
    await pool.query(
        `
        UPDATE public.catalogos_proveedor c
        SET total_productos = sub.total,
            productos_vinculados = sub.vinculados,
            productos_conflicto = sub.conflictos,
            updated_at = NOW()
        FROM (
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE estado = 'vinculado') AS vinculados,
                COUNT(*) FILTER (WHERE estado = 'conflicto') AS conflictos
            FROM public.catalogo_productos
            WHERE catalogo_id = $1 AND negocio_id = $2
        ) sub
        WHERE c.id = $1 AND c.negocio_id = $2
        `,
        [catalogoId, negocioId]
    );
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    // Sidebar + header contextual: lista de catalogos del negocio con
    // sus contadores ya calculados (nunca se cuentan en el cliente).
    app.get("/catalogo-proveedor", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `
                SELECT id, proveedor, total_productos, productos_vinculados, productos_conflicto, updated_at
                FROM public.catalogos_proveedor
                WHERE negocio_id = $1
                ORDER BY proveedor ASC
                `,
                [negocio.id]
            );
            res.json({ ok: true, catalogos: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Sube (o re-sube) un catalogo ya parseado por catalog-parsers.js en
    // el cliente -- este endpoint solo recibe el arreglo final, nunca
    // procesa el archivo original. Body grande permitido solo aqui
    // (catalogos de miles de filas), sin tocar el limite global de la app.
    app.post(
        "/catalogo-proveedor/:proveedor/subir",
        require("express").json({ limit: "25mb" }),
        requerirAccesoNegocio,
        async (req, res) => {
            const proveedor = String(req.params.proveedor || "").trim();
            const productos = Array.isArray(req.body?.productos) ? req.body.productos : [];

            if (!proveedor) { res.status(400).json({ ok: false, error: "Falta el nombre del proveedor" }); return; }
            if (productos.length === 0) { res.status(400).json({ ok: false, error: "El catalogo esta vacio" }); return; }

            const cliente = await pool.connect();

            try {
                const negocio = await negocioActual(req, pool);

                await cliente.query("BEGIN");

                const catalogo = await cliente.query(
                    `
                    INSERT INTO public.catalogos_proveedor (negocio_id, proveedor)
                    VALUES ($1, $2)
                    ON CONFLICT (negocio_id, proveedor) DO UPDATE SET updated_at = NOW()
                    RETURNING id
                    `,
                    [negocio.id, proveedor]
                );
                const catalogoId = catalogo.rows[0].id;

                let nuevos = 0;
                let cambiosPrecio = 0;

                for (const p of productos) {
                    const codigoProveedor = String(p.codigo || "").trim();
                    if (!codigoProveedor) continue;

                    const precioPublico = Number.isFinite(Number(p.publico)) ? Number(p.publico) : null;

                    const anterior = await cliente.query(
                        `SELECT precio_publico FROM public.catalogo_productos WHERE catalogo_id = $1 AND codigo_proveedor = $2`,
                        [catalogoId, codigoProveedor]
                    );
                    const precioAnterior = anterior.rows[0]?.precio_publico ?? null;
                    if (anterior.rows.length === 0) nuevos++;
                    else if (precioAnterior !== null && precioPublico !== null && Number(precioAnterior) !== precioPublico) cambiosPrecio++;

                    await cliente.query(
                        `
                        INSERT INTO public.catalogo_productos
                            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, descripcion, marca, categoria,
                             codigo_interno, precio_distribuidor, precio_medio_mayoreo, precio_publico, precio_publico_anterior)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                        ON CONFLICT (catalogo_id, codigo_proveedor) DO UPDATE SET
                            nombre_proveedor = EXCLUDED.nombre_proveedor,
                            descripcion = EXCLUDED.descripcion,
                            marca = EXCLUDED.marca,
                            categoria = EXCLUDED.categoria,
                            codigo_interno = EXCLUDED.codigo_interno,
                            precio_distribuidor = EXCLUDED.precio_distribuidor,
                            precio_medio_mayoreo = EXCLUDED.precio_medio_mayoreo,
                            precio_publico_anterior = public.catalogo_productos.precio_publico,
                            precio_publico = EXCLUDED.precio_publico,
                            updated_at = NOW()
                        `,
                        [
                            negocio.id, catalogoId, codigoProveedor, String(p.nombre || ""), String(p.descripcion || ""),
                            String(p.marca || ""), String(p.categoria || ""), String(p.codigoInterno || ""),
                            Number.isFinite(Number(p.distribuidor)) ? Number(p.distribuidor) : null,
                            Number.isFinite(Number(p.medioMayoreo)) ? Number(p.medioMayoreo) : null,
                            precioPublico,
                            null
                        ]
                    );
                }

                await cliente.query("COMMIT");

                await vincularCatalogoProductos(pool, negocio.id, catalogoId);

                const resumen = await pool.query(
                    `SELECT total_productos, productos_vinculados, productos_conflicto FROM public.catalogos_proveedor WHERE id = $1`,
                    [catalogoId]
                );

                res.json({
                    ok: true,
                    catalogoId,
                    resumen: resumen.rows[0],
                    insight: { nuevos, cambiosPrecio, coincidenciasAutomaticas: resumen.rows[0].productos_vinculados }
                });
            } catch (error) {
                await cliente.query("ROLLBACK").catch(() => {});
                responderError(res, error);
            } finally {
                cliente.release();
            }
        }
    );

    app.get("/catalogo-proveedor/:id/productos", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const catalogoId = Number(req.params.id);
            const estado = String(req.query.estado || "").trim();
            const buscar = String(req.query.buscar || "").trim();
            const pagina = Math.max(1, Number(req.query.pagina) || 1);
            const porPagina = 50;

            const condiciones = ["cp.catalogo_id = $1", "cp.negocio_id = $2"];
            const valores = [catalogoId, negocio.id];

            if (estado && ["vinculado", "coincidencia_parcial", "sin_vincular", "conflicto"].includes(estado)) {
                valores.push(estado);
                condiciones.push(`cp.estado = $${valores.length}`);
            }
            if (buscar) {
                valores.push(`%${buscar}%`);
                condiciones.push(`(cp.nombre_proveedor ILIKE $${valores.length} OR cp.codigo_proveedor ILIKE $${valores.length})`);
            }

            valores.push(porPagina, (pagina - 1) * porPagina);

            const resultado = await pool.query(
                `
                SELECT cp.id, cp.codigo_proveedor, cp.nombre_proveedor, cp.marca, cp.precio_publico, cp.estado,
                       cp.porcentaje_coincidencia, cp.producto_id, p.nombre AS producto_nombre, p.codigo AS producto_codigo
                FROM public.catalogo_productos cp
                LEFT JOIN public.productos p ON p.id = cp.producto_id
                WHERE ${condiciones.join(" AND ")}
                ORDER BY cp.nombre_proveedor ASC
                LIMIT $${valores.length - 1} OFFSET $${valores.length}
                `,
                valores
            );

            const total = await pool.query(
                `SELECT COUNT(*) FROM public.catalogo_productos cp WHERE ${condiciones.join(" AND ")}`,
                valores.slice(0, -2)
            );

            res.json({ ok: true, productos: resultado.rows, total: Number(total.rows[0].count), pagina, porPagina });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/catalogo-proveedor/:id/productos/:catalogoProductoId", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `
                SELECT cp.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.precio AS producto_precio, p.stock AS producto_stock
                FROM public.catalogo_productos cp
                LEFT JOIN public.productos p ON p.id = cp.producto_id
                WHERE cp.id = $1 AND cp.catalogo_id = $2 AND cp.negocio_id = $3
                `,
                [req.params.catalogoProductoId, req.params.id, negocio.id]
            );
            if (resultado.rows.length === 0) { res.status(404).json({ ok: false, error: "No encontrado" }); return; }
            res.json({ ok: true, producto: resultado.rows[0] });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Vinculacion manual -- siempre gana sobre lo automatico, marca
    // vinculado_manualmente para que el algoritmo nunca la pise en
    // una re-vinculacion futura.
    app.post("/catalogo-proveedor/:id/productos/:catalogoProductoId/vincular", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const productoId = Number(req.body?.productoId);
            if (!productoId) { res.status(400).json({ ok: false, error: "Falta el producto a vincular" }); return; }

            const producto = await pool.query(`SELECT id FROM public.productos WHERE id = $1 AND negocio_id = $2`, [productoId, negocio.id]);
            if (producto.rows.length === 0) { res.status(404).json({ ok: false, error: "Producto no encontrado" }); return; }

            await pool.query(
                `
                UPDATE public.catalogo_productos
                SET producto_id = $1, estado = 'vinculado', porcentaje_coincidencia = 100, vinculado_manualmente = true, updated_at = NOW()
                WHERE id = $2 AND catalogo_id = $3 AND negocio_id = $4
                `,
                [productoId, req.params.catalogoProductoId, req.params.id, negocio.id]
            );

            await actualizarContadoresCatalogo(pool, negocio.id, Number(req.params.id));
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Crea el producto interno a partir de la fila del catalogo y lo
    // vincula de una vez -- insercion minima y autocontenida (no
    // reusa /agregar-producto porque esa ruta vive en server.js con
    // helpers propios de ese archivo; mismo patron ya usado en otros
    // modulos de este proyecto para evitar importar entre archivos).
    app.post("/catalogo-proveedor/:id/productos/:catalogoProductoId/crear-producto", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const fila = await pool.query(
                `SELECT * FROM public.catalogo_productos WHERE id = $1 AND catalogo_id = $2 AND negocio_id = $3`,
                [req.params.catalogoProductoId, req.params.id, negocio.id]
            );
            if (fila.rows.length === 0) { res.status(404).json({ ok: false, error: "No encontrado" }); return; }
            const cp = fila.rows[0];

            const nuevoProducto = await pool.query(
                `
                INSERT INTO public.productos
                    (negocio_id, nombre, precio, stock, codigo, proveedor, categoria, marca, descripcion,
                     precio_distribuidor, precio_mayoreo, precio_publico, tipo_producto)
                VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10,$11,'catalogo')
                RETURNING id
                `,
                [
                    negocio.id, cp.nombre_proveedor, cp.precio_publico || 0,
                    cp.codigo_interno || cp.codigo_proveedor, "", cp.categoria, cp.marca, cp.descripcion,
                    cp.precio_distribuidor, cp.precio_medio_mayoreo, cp.precio_publico
                ]
            );
            const productoId = nuevoProducto.rows[0].id;

            await pool.query(
                `
                UPDATE public.catalogo_productos
                SET producto_id = $1, estado = 'vinculado', porcentaje_coincidencia = 100, vinculado_manualmente = true, updated_at = NOW()
                WHERE id = $2
                `,
                [productoId, cp.id]
            );

            await actualizarContadoresCatalogo(pool, negocio.id, Number(req.params.id));
            res.json({ ok: true, productoId });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/catalogo-proveedor/:id/re-vincular", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            await vincularCatalogoProductos(pool, negocio.id, Number(req.params.id));
            const resumen = await pool.query(
                `SELECT total_productos, productos_vinculados, productos_conflicto FROM public.catalogos_proveedor WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );
            res.json({ ok: true, resumen: resumen.rows[0] });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/catalogo-proveedor/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            await pool.query(`DELETE FROM public.catalogos_proveedor WHERE id = $1 AND negocio_id = $2`, [req.params.id, negocio.id]);
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};

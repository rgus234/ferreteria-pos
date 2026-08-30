const { responderError } = require("./error-utils");
const { requerirFuncionPlan } = require("./plan-enforcement");
const { resolverOcrearProveedorId } = require("./proveedor-resolver");
const { contribuirOEnlazarCatalogoMaestro } = require("./catalogo-maestro-resolver");

async function negocioActual(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(`SELECT id, slug FROM public.negocios WHERE id = $1 LIMIT 1`, [negocioId]);

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
    // el mejor candidato por similitud de nombre con pg_trgm. El
    // operador `%` (a diferencia de llamar similarity() directo en el
    // ORDER BY) SI usa el indice GIN de productos.nombre para acotar
    // los candidatos antes de ordenar -- sin esto, cada fila del
    // catalogo compara contra TODO el inventario (lento y hasta
    // agotaba el tiempo de espera con catalogos de miles de filas,
    // bug real encontrado al probar con el catalogo de Diprofer del
    // negocio real). El umbral por defecto de `%` (0.3) es mas laxo
    // que UMBRAL_COINCIDENCIA_PARCIAL (0.45) a proposito -- deja pasar
    // algunos candidatos de mas, pero esos se clasifican igual como
    // sin_vincular abajo, sin riesgo de perder un match real.
    const candidatos = await pool.query(
        `
        SELECT cp.id AS catalogo_producto_id, mejor.producto_id, mejor.similitud
        FROM public.catalogo_productos cp
        JOIN LATERAL (
            SELECT p.id AS producto_id, similarity(p.nombre, cp.nombre_proveedor) AS similitud
            FROM public.productos p
            WHERE p.negocio_id = $2 AND p.nombre % cp.nombre_proveedor
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

    // Bulk update en lotes -- con catalogos de miles de filas, un
    // UPDATE por fila (miles de round-trips secuenciales) es lo que
    // hacia que subir un catalogo grande se sintiera colgado.
    const actualizaciones = candidatos.rows.map(fila => {
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

        return { id: fila.catalogo_producto_id, productoId, estado, porcentaje };
    });

    const TAMANO_LOTE_VINCULACION = 500;
    for (let inicio = 0; inicio < actualizaciones.length; inicio += TAMANO_LOTE_VINCULACION) {
        const lote = actualizaciones.slice(inicio, inicio + TAMANO_LOTE_VINCULACION);
        const valoresSQL = [];
        const parametros = [];

        lote.forEach((fila, indice) => {
            const base = indice * 4;
            valoresSQL.push(`($${base + 1}::int,$${base + 2}::int,$${base + 3}::text,$${base + 4}::numeric)`);
            parametros.push(fila.id, fila.productoId, fila.estado, fila.porcentaje);
        });

        await pool.query(
            `
            UPDATE public.catalogo_productos AS cp
            SET producto_id = v.producto_id, estado = v.estado, porcentaje_coincidencia = v.porcentaje, updated_at = NOW()
            FROM (VALUES ${valoresSQL.join(",")}) AS v(id, producto_id, estado, porcentaje)
            WHERE cp.id = v.id
            `,
            parametros
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

module.exports = (app, pool, requerirAccesoNegocio, firmarTokenImagen, firmarTokenImagenCatalogoPdf) => {
    // Sidebar + header contextual: lista de catalogos del negocio con
    // sus contadores ya calculados (nunca se cuentan en el cliente).
    app.get("/catalogo-proveedor", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `
                SELECT c.id, c.proveedor, c.total_productos, c.productos_vinculados, c.productos_conflicto, c.updated_at,
                       EXISTS(SELECT 1 FROM public.catalogo_productos cp WHERE cp.catalogo_id = c.id AND cp.origen = 'pdf') AS tiene_origen_pdf
                FROM public.catalogos_proveedor c
                WHERE c.negocio_id = $1
                ORDER BY c.proveedor ASC
                `,
                [negocio.id]
            );
            res.json({ ok: true, catalogos: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Busqueda por codigo cruzando TODOS los catalogos del negocio --
    // Fase 5 del plan "Catalogo Maestro Nexo". Antes, el autocompletado
    // de "Agregar producto" (productoDesdeCatalogo en product-inventory.js)
    // buscaba solo en catalogosProveedor de localStorage; este motor
    // server-side ya existia para vinculacion pero nunca tenia una ruta
    // de "busca este codigo en cualquiera de mis catalogos" -- las demas
    // rutas de abajo estan todas scoped a un :id de catalogo especifico.
    // Match exacto (mismo criterio que vincularCatalogoProductos), nunca
    // pg_trgm aqui -- es una busqueda por codigo, no por nombre.
    app.get("/catalogo-proveedor/buscar-codigo", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const codigo = String(req.query.codigo || "").trim();

            if (!codigo) {
                res.json({ ok: true, producto: null });
                return;
            }

            const fila = await pool.query(
                `
                SELECT cp.codigo_proveedor, cp.codigo_interno, cp.codigo_barras, cp.nombre_proveedor, cp.descripcion, cp.marca, cp.categoria,
                       cp.precio_distribuidor, cp.precio_medio_mayoreo, cp.precio_publico, cat.proveedor AS proveedor_nombre
                FROM public.catalogo_productos cp
                JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id
                WHERE cp.negocio_id = $1
                  AND (cp.codigo_proveedor = $2 OR NULLIF(cp.codigo_interno, '') = $2 OR NULLIF(cp.codigo_barras, '') = $2)
                ORDER BY cp.catalogo_id ASC, cp.id ASC
                LIMIT 1
                `,
                [negocio.id, codigo]
            );

            if (fila.rows.length === 0) {
                res.json({ ok: true, producto: null });
                return;
            }

            const cp = fila.rows[0];
            res.json({
                ok: true,
                producto: {
                    codigo: cp.codigo_interno || cp.codigo_proveedor,
                    nombre: cp.nombre_proveedor || "",
                    descripcion: cp.descripcion || "",
                    marca: cp.marca || "",
                    categoria: cp.categoria || "",
                    unidadVenta: "pieza",
                    codigoInterno: cp.codigo_interno || "",
                    codigoBarras: cp.codigo_barras || "",
                    distribuidor: cp.precio_distribuidor,
                    medioMayoreo: cp.precio_medio_mayoreo,
                    publico: cp.precio_publico,
                    proveedor: cp.proveedor_nombre || "",
                    stockMinimo: 3,
                    altaRotacion: "",
                    precioDetectado: "medio mayoreo",
                    codigosRelacionados: [cp.codigo_proveedor, cp.codigo_interno, cp.codigo_barras]
                        .filter(c => c && c !== codigo)
                }
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Sube (o re-sube) un catalogo ya parseado por catalog-parsers.js en
    // el cliente -- este endpoint solo recibe el arreglo final, nunca
    // procesa el archivo original. El limite de tamano de body (25mb,
    // para catalogos de miles de filas) se fija en el middleware
    // global de server.js -- uno puesto solo aqui nunca alcanzaria a
    // aplicarse, porque express.json() global ya corre antes.
    app.post(
        "/catalogo-proveedor/:proveedor/subir",
        requerirAccesoNegocio,
        requerirFuncionPlan("catalogo.importacion_listas", "Importar listas de proveedor esta disponible desde el plan Plus."),
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

                // Filas validas y ya normalizadas -- se preparan todas
                // en JS primero para poder subirlas en lotes (varios
                // cientos de filas por INSERT) en vez de un
                // round-trip a la base por fila, que con catalogos de
                // miles de productos se vuelve lentisimo o hasta
                // agota el tiempo de espera de la peticion HTTP.
                const filas = productos
                    .map(p => ({
                        codigoProveedor: String(p.codigo || "").trim(),
                        nombre: String(p.nombre || ""),
                        descripcion: String(p.descripcion || ""),
                        marca: String(p.marca || ""),
                        categoria: String(p.categoria || ""),
                        codigoInterno: String(p.codigoInterno || ""),
                        codigoBarras: String(p.codigoBarras || ""),
                        distribuidor: Number.isFinite(Number(p.distribuidor)) ? Number(p.distribuidor) : null,
                        medioMayoreo: Number.isFinite(Number(p.medioMayoreo)) ? Number(p.medioMayoreo) : null,
                        precioPublico: Number.isFinite(Number(p.publico)) ? Number(p.publico) : null
                    }))
                    .filter(f => f.codigoProveedor);

                const existentes = await cliente.query(
                    `SELECT codigo_proveedor, precio_publico FROM public.catalogo_productos WHERE catalogo_id = $1`,
                    [catalogoId]
                );
                const precioAnteriorPorCodigo = new Map(existentes.rows.map(r => [r.codigo_proveedor, r.precio_publico]));

                let nuevos = 0;
                let cambiosPrecio = 0;

                for (const fila of filas) {
                    if (!precioAnteriorPorCodigo.has(fila.codigoProveedor)) {
                        nuevos++;
                    } else {
                        const anterior = precioAnteriorPorCodigo.get(fila.codigoProveedor);
                        if (anterior !== null && fila.precioPublico !== null && Number(anterior) !== fila.precioPublico) cambiosPrecio++;
                    }
                }

                const TAMANO_LOTE = 400;
                for (let inicio = 0; inicio < filas.length; inicio += TAMANO_LOTE) {
                    const lote = filas.slice(inicio, inicio + TAMANO_LOTE);
                    const columnasPorFila = 10; // codigoProveedor..precioPublico (negocio_id/catalogo_id van fijos en $1/$2, precio_publico_anterior es NULL literal)
                    const valoresSQL = [];
                    const parametros = [];

                    lote.forEach((fila, indice) => {
                        const base = indice * columnasPorFila;
                        valoresSQL.push(`($1,$2,$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},NULL)`);
                        parametros.push(
                            fila.codigoProveedor, fila.nombre, fila.descripcion, fila.marca, fila.categoria,
                            fila.codigoInterno, fila.codigoBarras, fila.distribuidor, fila.medioMayoreo, fila.precioPublico
                        );
                    });

                    await cliente.query(
                        `
                        INSERT INTO public.catalogo_productos
                            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, descripcion, marca, categoria,
                             codigo_interno, codigo_barras, precio_distribuidor, precio_medio_mayoreo, precio_publico, precio_publico_anterior)
                        VALUES ${valoresSQL.join(",")}
                        ON CONFLICT (catalogo_id, codigo_proveedor) DO UPDATE SET
                            nombre_proveedor = EXCLUDED.nombre_proveedor,
                            descripcion = EXCLUDED.descripcion,
                            marca = EXCLUDED.marca,
                            categoria = EXCLUDED.categoria,
                            codigo_interno = EXCLUDED.codigo_interno,
                            codigo_barras = EXCLUDED.codigo_barras,
                            precio_distribuidor = EXCLUDED.precio_distribuidor,
                            precio_medio_mayoreo = EXCLUDED.precio_medio_mayoreo,
                            precio_publico_anterior = public.catalogo_productos.precio_publico,
                            precio_publico = EXCLUDED.precio_publico,
                            updated_at = NOW()
                        `,
                        [negocio.id, catalogoId, ...parametros]
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
            const estadoExtraccion = String(req.query.estadoExtraccion || "").trim();
            const buscar = String(req.query.buscar || "").trim();
            const pagina = Math.max(1, Number(req.query.pagina) || 1);
            const porPagina = 50;

            const condiciones = ["cp.catalogo_id = $1", "cp.negocio_id = $2"];
            const valores = [catalogoId, negocio.id];

            if (estado && ["vinculado", "coincidencia_parcial", "sin_vincular", "conflicto"].includes(estado)) {
                valores.push(estado);
                condiciones.push(`cp.estado = $${valores.length}`);
            }
            if (estadoExtraccion && ["completo", "revision", "no_identificado"].includes(estadoExtraccion)) {
                valores.push(estadoExtraccion);
                condiciones.push(`cp.estado_extraccion = $${valores.length}`);
            }
            if (buscar) {
                valores.push(`%${buscar}%`);
                condiciones.push(`(cp.nombre_proveedor ILIKE $${valores.length} OR cp.codigo_proveedor ILIKE $${valores.length})`);
            }

            valores.push(porPagina, (pagina - 1) * porPagina);

            const resultado = await pool.query(
                `
                SELECT cp.id, cp.codigo_proveedor, cp.nombre_proveedor, cp.marca, cp.precio_publico, cp.estado,
                       cp.porcentaje_coincidencia, cp.producto_id, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
                       cp.origen, cp.estado_extraccion, (cp.imagen IS NOT NULL) AS tiene_imagen
                FROM public.catalogo_productos cp
                LEFT JOIN public.productos p ON p.id = cp.producto_id
                WHERE ${condiciones.join(" AND ")}
                ORDER BY cp.nombre_proveedor ASC
                LIMIT $${valores.length - 1} OFFSET $${valores.length}
                `,
                valores
            );

            const filas = resultado.rows.map(fila => {
                if (fila.tiene_imagen && typeof firmarTokenImagenCatalogoPdf === "function") {
                    fila.imagenPropuestaUrl = `/catalogo-proveedor/${catalogoId}/productos/${fila.id}/imagen-propuesta?token=${firmarTokenImagenCatalogoPdf(fila.id)}`;
                }
                delete fila.tiene_imagen;
                return fila;
            });

            const total = await pool.query(
                `SELECT COUNT(*) FROM public.catalogo_productos cp WHERE ${condiciones.join(" AND ")}`,
                valores.slice(0, -2)
            );

            res.json({ ok: true, productos: filas, total: Number(total.rows[0].count), pagina, porPagina });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/catalogo-proveedor/:id/productos/:catalogoProductoId", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `
                SELECT cp.id, cp.catalogo_id, cp.codigo_proveedor, cp.nombre_proveedor, cp.descripcion, cp.marca,
                       cp.categoria, cp.codigo_interno, cp.precio_distribuidor, cp.precio_medio_mayoreo,
                       cp.precio_publico, cp.precio_publico_anterior, cp.producto_id, cp.estado,
                       cp.porcentaje_coincidencia, cp.vinculado_manualmente, cp.origen, cp.pagina_pdf,
                       cp.confianza_codigo, cp.confianza_descripcion, cp.confianza_precio, cp.confianza_imagen,
                       cp.estado_extraccion, (cp.imagen IS NOT NULL) AS tiene_imagen,
                       p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.precio AS producto_precio, p.stock AS producto_stock
                FROM public.catalogo_productos cp
                LEFT JOIN public.productos p ON p.id = cp.producto_id
                WHERE cp.id = $1 AND cp.catalogo_id = $2 AND cp.negocio_id = $3
                `,
                [req.params.catalogoProductoId, req.params.id, negocio.id]
            );
            if (resultado.rows.length === 0) { res.status(404).json({ ok: false, error: "No encontrado" }); return; }

            const producto = resultado.rows[0];

            // Un <img src> no puede mandar el header Authorization --
            // por eso las fotos de producto en toda la app se sirven
            // con un token firmado en la URL (mismo patron ya usado
            // en /productos y /fotos-producto-lista, server.js).
            if (producto.producto_codigo && typeof firmarTokenImagen === "function") {
                producto.imagenUrl = `/fotos-producto/${encodeURIComponent(producto.producto_codigo)}/principal?negocio=${negocio.slug}&token=${firmarTokenImagen(negocio.id, producto.producto_codigo)}`;
            }
            if (producto.tiene_imagen && typeof firmarTokenImagenCatalogoPdf === "function") {
                producto.imagenPropuestaUrl = `/catalogo-proveedor/${producto.catalogo_id}/productos/${producto.id}/imagen-propuesta?token=${firmarTokenImagenCatalogoPdf(producto.id)}`;
            }
            delete producto.tiene_imagen;

            res.json({ ok: true, producto });
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

            // Intenta clasificar el producto de una vez si el catalogo
            // trae una categoria de texto -- match exacto de
            // departamento, acotado a los giros activos del negocio
            // (Fase 3 del plan "Catalogo Maestro Nexo"). Sin coincidencia
            // clara se deja NULL, igual que antes -- nunca se adivina.
            let categoriaNexoId = null;
            if (cp.categoria) {
                const girosFila = await pool.query(
                    `SELECT giro FROM public.negocio_giros WHERE negocio_id = $1 AND activo = true`,
                    [negocio.id]
                );
                const girosActivos = girosFila.rows.length ? girosFila.rows.map(f => f.giro) : ["ferreteria"];
                const coincidencia = await pool.query(
                    `SELECT id FROM public.categorias_nexo WHERE giro = ANY($1::text[]) AND LOWER(departamento) = LOWER($2) LIMIT 1`,
                    [girosActivos, cp.categoria]
                );
                categoriaNexoId = coincidencia.rows[0]?.id || null;
            }

            // Fase 6: el producto nace ya vinculado a un proveedor real
            // en vez de quedar con proveedor="" hardcodeado -- se
            // resuelve/crea desde el nombre del proveedor dueño de este
            // catalogo, mismo criterio de normalizacion que el backfill.
            const catalogoInfo = await pool.query(
                `SELECT proveedor FROM public.catalogos_proveedor WHERE id = $1`,
                [req.params.id]
            );
            const nombreProveedorCatalogo = catalogoInfo.rows[0]?.proveedor || "";
            const proveedorId = await resolverOcrearProveedorId(pool, negocio.id, nombreProveedorCatalogo);

            const nuevoProducto = await pool.query(
                `
                INSERT INTO public.productos
                    (negocio_id, nombre, precio, stock, codigo, proveedor, proveedor_id, categoria, categoria_nexo_id, marca, descripcion,
                     precio_distribuidor, precio_mayoreo, precio_publico, tipo_producto)
                VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'catalogo')
                RETURNING id
                `,
                [
                    // Precio de venta: medio mayoreo por regla del
                    // negocio (ver ruta aplicar-precio-mayoreo arriba);
                    // precio_publico solo como respaldo si el catalogo
                    // no trae medio mayoreo para esta fila.
                    negocio.id, cp.nombre_proveedor, cp.precio_medio_mayoreo || cp.precio_publico || 0,
                    cp.codigo_barras || cp.codigo_interno || cp.codigo_proveedor, nombreProveedorCatalogo, proveedorId, cp.categoria, categoriaNexoId, cp.marca, cp.descripcion,
                    cp.precio_distribuidor, cp.precio_medio_mayoreo, cp.precio_publico
                ]
            );
            const productoId = nuevoProducto.rows[0].id;

            // Si la fila viene de un catalogo PDF y trae una imagen
            // candidata (catalog-pdf-extractor.js ya la recorto y
            // comprimio), se copia a fotos_producto de una vez -- sin
            // esto, la imagen que el extractor SI encontro se perderia
            // en silencio al crear el producto por esta ruta individual
            // (crear-productos-lote, la ruta de confirmacion en lote,
            // ya hace lo mismo -- misma logica en los dos caminos).
            if (cp.imagen) {
                await pool.query(
                    `
                    INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (negocio_id, codigo) DO UPDATE SET
                        imagen_principal = EXCLUDED.imagen_principal, imagen_principal_tipo = EXCLUDED.imagen_principal_tipo, actualizado_at = NOW()
                    `,
                    [negocio.id, cp.codigo_interno || cp.codigo_proveedor, cp.imagen, cp.imagen_tipo || "image/jpeg"]
                );
            }

            await pool.query(
                `
                UPDATE public.catalogo_productos
                SET producto_id = $1, estado = 'vinculado', porcentaje_coincidencia = 100, vinculado_manualmente = true, updated_at = NOW()
                WHERE id = $2
                `,
                [productoId, cp.id]
            );

            // Fase 7 del plan "Catalogo Maestro Nexo": confirmar un
            // producto desde el catalogo de proveedor ya es la accion
            // afirmativa del dueño de traerlo a su inventario -- de
            // paso aporta (o simplemente enlaza, si ya lo trajo otro
            // negocio antes) su identidad general al Catalogo Maestro.
            // Nunca se comparte precio/costo/stock, solo marca/nombre/
            // categoria/imagen. No bloquea el alta si falla.
            try {
                const catalogoMaestroId = await contribuirOEnlazarCatalogoMaestro(pool, negocio.id, {
                    codigo: cp.codigo_interno || cp.codigo_proveedor,
                    marca: cp.marca,
                    nombre: cp.nombre_proveedor,
                    descripcion: cp.descripcion,
                    categoriaNexoId,
                    imagen: cp.imagen,
                    imagenTipo: cp.imagen_tipo
                });
                if (catalogoMaestroId) {
                    await pool.query(`UPDATE public.productos SET catalogo_maestro_id = $1 WHERE id = $2`, [catalogoMaestroId, productoId]);
                }
            } catch (errorCatalogoMaestro) {
                console.error("No se pudo aportar/enlazar al Catalogo Maestro", errorCatalogoMaestro);
            }

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

    // Sincronizar precio (medio mayoreo -- regla del negocio: se vende
    // siempre al medio mayoreo del proveedor) y datos de referencia
    // (nombre, categoria, marca) del catalogo hacia el inventario real.
    // Solo mira filas de ESTE catalogo (catalogo_id) que ya estan
    // vinculadas a un producto -- nunca toca productos de otro
    // proveedor, aunque compartan codigo o nombre. Nombre/categoria/marca
    // solo se pisan cuando el catalogo trae un valor no vacio -- una
    // columna vacia en el archivo del proveedor nunca borra un dato que
    // el dueno ya tenia. Vista previa de solo lectura antes de aplicar,
    // para que el dueno vea cuantos productos cambiarian y en que antes
    // de confirmar (decision explicita del usuario: con confirmacion,
    // nunca automatico).
    const CONDICION_CAMBIOS_CATALOGO = `
        cp.precio_medio_mayoreo IS NOT NULL AND (
            cp.precio_medio_mayoreo <> p.precio
            OR (NULLIF(cp.nombre_proveedor, '') IS NOT NULL AND cp.nombre_proveedor <> p.nombre)
            OR (NULLIF(cp.categoria, '') IS NOT NULL AND cp.categoria <> p.categoria)
            OR (NULLIF(cp.marca, '') IS NOT NULL AND cp.marca <> p.marca)
        )
    `;

    app.get("/catalogo-proveedor/:id/vista-previa-precio-mayoreo", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `
                SELECT p.id AS producto_id,
                       p.nombre AS nombre_actual, cp.nombre_proveedor AS nombre_nuevo,
                       p.precio AS precio_actual, cp.precio_medio_mayoreo AS precio_nuevo,
                       p.categoria AS categoria_actual, cp.categoria AS categoria_nuevo,
                       p.marca AS marca_actual, cp.marca AS marca_nuevo
                FROM public.catalogo_productos cp
                JOIN public.productos p ON p.id = cp.producto_id
                WHERE cp.catalogo_id = $1 AND cp.negocio_id = $2
                  AND cp.producto_id IS NOT NULL
                  AND cp.porcentaje_coincidencia = 100
                  AND ${CONDICION_CAMBIOS_CATALOGO}
                ORDER BY p.nombre ASC
                `,
                [req.params.id, negocio.id]
            );
            res.json({
                ok: true,
                cambios: resultado.rows.map(f => {
                    const campos = [];
                    if (Number(f.precio_nuevo) !== Number(f.precio_actual)) campos.push("precio");
                    if (f.nombre_nuevo && f.nombre_nuevo !== f.nombre_actual) campos.push("nombre");
                    if (f.categoria_nuevo && f.categoria_nuevo !== f.categoria_actual) campos.push("categoria");
                    if (f.marca_nuevo && f.marca_nuevo !== f.marca_actual) campos.push("marca");
                    return {
                        productoId: f.producto_id,
                        nombre: f.nombre_actual,
                        precioActual: Number(f.precio_actual),
                        precioNuevo: Number(f.precio_nuevo),
                        nombreNuevo: f.nombre_nuevo || null,
                        categoriaActual: f.categoria_actual,
                        categoriaNuevo: f.categoria_nuevo || null,
                        marcaActual: f.marca_actual,
                        marcaNuevo: f.marca_nuevo || null,
                        campos
                    };
                })
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/catalogo-proveedor/:id/aplicar-precio-mayoreo", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            // categoria_nexo_id solo se limpia cuando el catalogo trae
            // una categoria propia que de verdad reemplaza el texto
            // (COALESCE cae en cp.categoria) -- si cp.categoria viene
            // vacio, la categoria del producto no cambia y no hay
            // razon para tirar un id estructurado valido (Fase 3 del
            // plan "Catalogo Maestro Nexo").
            //
            // porcentaje_coincidencia = 100 es a proposito: solo es 100
            // en un match exacto de codigo (Paso 1 de
            // vincularCatalogoProductos) o en una vinculacion manual
            // (el humano ya lo confirmo) -- nunca en un match de
            // similitud de nombre via pg_trgm, ni siquiera los que
            // pasan el umbral "vinculado" (>=70%). Bug real encontrado
            // en vivo: un match de 70%+ por nombre ("Carda de copa
            // 1-3/4 alambre FINO" vs "...alambre GRUESO", o dos
            // productos con la misma familia de nombre pero medida
            // distinta) puede estar completamente equivocado -- antes
            // este endpoint aplicaba precio/nombre/categoria/marca a
            // CUALQUIER fila vinculada sin importar que tan floja fuera
            // la coincidencia, verificado que asi corrompio datos
            // silenciosamente en produccion.
            const resultado = await pool.query(
                `
                UPDATE public.productos p
                SET precio = cp.precio_medio_mayoreo,
                    nombre = COALESCE(NULLIF(cp.nombre_proveedor, ''), p.nombre),
                    categoria = COALESCE(NULLIF(cp.categoria, ''), p.categoria),
                    categoria_nexo_id = CASE WHEN NULLIF(cp.categoria, '') IS NOT NULL THEN NULL ELSE p.categoria_nexo_id END,
                    marca = COALESCE(NULLIF(cp.marca, ''), p.marca)
                FROM public.catalogo_productos cp
                WHERE cp.catalogo_id = $1 AND cp.negocio_id = $2
                  AND cp.producto_id = p.id
                  AND p.negocio_id = $2
                  AND cp.porcentaje_coincidencia = 100
                  AND ${CONDICION_CAMBIOS_CATALOGO}
                `,
                [req.params.id, negocio.id]
            );
            res.json({ ok: true, actualizados: resultado.rowCount });
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

    // Plantillas de mapeo de columnas por proveedor -- antes vivian
    // solo en localStorage (por navegador, no por negocio). El
    // cliente ya normaliza el nombre del proveedor con la misma
    // funcion que usa para todo lo demas (normalizarEncabezadoCatalogo)
    // y la manda explicita; el servidor solo guarda/compara ese valor.
    // formato='csv' explicito: desde que existe tambien plantilla de
    // layout PDF (mismo proveedor_normalizado, formato='pdf'), esta
    // ruta -- la unica que existia antes de PDF -- solo lee/escribe el
    // lado CSV, nunca toca ni pisa la plantilla de PDF del proveedor.
    app.get("/catalogo-proveedor/plantillas", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `SELECT proveedor, proveedor_normalizado, parser, mapeo, updated_at FROM public.plantillas_catalogo WHERE negocio_id = $1 AND formato = 'csv' ORDER BY proveedor ASC`,
                [negocio.id]
            );
            res.json({ ok: true, plantillas: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/catalogo-proveedor/plantillas", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const proveedor = String(req.body?.proveedor || "").trim();
            const proveedorNormalizado = String(req.body?.proveedorNormalizado || "").trim();
            const parser = String(req.body?.parser || "generico").trim();
            const mapeo = req.body?.mapeo && typeof req.body.mapeo === "object" ? req.body.mapeo : {};

            if (!proveedor || !proveedorNormalizado) {
                res.status(400).json({ ok: false, error: "Falta el nombre del proveedor" });
                return;
            }

            await pool.query(
                `
                INSERT INTO public.plantillas_catalogo (negocio_id, proveedor, proveedor_normalizado, parser, mapeo, formato)
                VALUES ($1, $2, $3, $4, $5, 'csv')
                ON CONFLICT (negocio_id, proveedor_normalizado, formato) DO UPDATE SET
                    proveedor = EXCLUDED.proveedor,
                    parser = EXCLUDED.parser,
                    mapeo = EXCLUDED.mapeo,
                    updated_at = NOW()
                `,
                [negocio.id, proveedor, proveedorNormalizado, parser, JSON.stringify(mapeo)]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/catalogo-proveedor/plantillas/:proveedorNormalizado", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            await pool.query(
                `DELETE FROM public.plantillas_catalogo WHERE negocio_id = $1 AND proveedor_normalizado = $2 AND formato = 'csv'`,
                [negocio.id, req.params.proveedorNormalizado]
            );
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};

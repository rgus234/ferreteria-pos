// Importacion de catalogos PDF de proveedor -- sube el PDF, lo procesa
// en segundo plano (catalog-pdf-extractor.js hace el trabajo pesado) y
// deja los productos candidatos en catalogo_productos (mismo staging
// que ya usa el catalogo CSV/Excel), con imagen/confianzas/estado de
// extraccion. El dueno revisa y confirma antes de crear productos --
// nunca se crea nada automaticamente.
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { responderError } = require("./error-utils");
const { requerirFuncionPlan } = require("./plan-enforcement");
const { extraerCatalogoPDF } = require("./catalog-pdf-extractor");
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

// Un catalogo PDF de cientos de paginas con imagenes puede pesar mas
// que un ZIP de fotos ya comprimidas -- mismo criterio de margen
// generoso que uploadZipsBancoImagenes/uploadZipsFotosProducto, un
// escalon mas arriba porque aqui es un solo archivo, no muchos.
const uploadPdfCatalogo = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 300 * 1024 * 1024, files: 1 }
});

function manejarSubidaPdfCatalogo(req, res, next) {
    uploadPdfCatalogo.single("pdf")(req, res, error => {
        if (error) {
            const esMuyPesado = error.code === "LIMIT_FILE_SIZE";
            res.status(400).json({
                ok: false,
                error: esMuyPesado
                    ? "Este PDF pesa mas de 300MB. Divide el catalogo en partes mas chicas e intenta de nuevo."
                    : (error.message || "No se pudo procesar el archivo subido")
            });
            return;
        }
        next();
    });
}

// Token firmado independiente (igual criterio que banco-imagenes-server.js:
// aqui no hay un negocio "dueno" de la firma per se, la imagen candidata
// vive en catalogo_productos.id, que ya esta acotado por negocio_id en
// cada query -- el token solo evita que cualquiera adivine el id y pida
// la imagen sin pasar por la sesion del negocio al menos una vez).
const SECRETO_TOKEN_IMAGEN_PDF = crypto.randomBytes(32);
const DURACION_TOKEN_IMAGEN_PDF_MS = 15 * 60 * 1000;

function firmarTokenImagenCatalogoPdf(catalogoProductoId) {
    const expiraEn = Date.now() + DURACION_TOKEN_IMAGEN_PDF_MS;
    const payload = `${catalogoProductoId}:${expiraEn}`;
    const firma = crypto.createHmac("sha256", SECRETO_TOKEN_IMAGEN_PDF).update(payload).digest("hex");
    return `${expiraEn}.${firma}`;
}

function verificarTokenImagenCatalogoPdf(token, catalogoProductoId) {
    if (typeof token !== "string" || !token.includes(".")) return false;
    const [expiraEnTexto, firma] = token.split(".");
    const expiraEn = Number(expiraEnTexto);
    if (!Number.isFinite(expiraEn) || Date.now() > expiraEn || !firma) return false;

    const payload = `${catalogoProductoId}:${expiraEn}`;
    const esperada = crypto.createHmac("sha256", SECRETO_TOKEN_IMAGEN_PDF).update(payload).digest("hex");
    const bufferFirma = Buffer.from(firma);
    const bufferEsperada = Buffer.from(esperada);
    return bufferFirma.length === bufferEsperada.length && crypto.timingSafeEqual(bufferFirma, bufferEsperada);
}

// Tope duro de llamadas de IA por importacion -- limite real de gasto
// independiente del gate de plan (ver ia-server.js patron "gateado pero
// no medido"): al llegar aqui, las celdas restantes ambiguas se marcan
// para revision sin gastar mas, sin importar el tamano del catalogo.
const TOPE_LLAMADAS_IA_POR_TRABAJO = 60;

// Convierte una lista de codigos ya confirmados por el dueno en un
// regex generalizado simple (mismo prefijo + rango de digitos) para
// guardarlo como aprendizaje del proveedor. Heuristica deliberadamente
// simple -- si los codigos no comparten un patron claro, no se guarda
// regex (null) y solo se cuenta la muestra; nunca se fuerza un patron
// que no es real.
function generalizarRegexDeCodigos(codigos) {
    const partes = codigos
        .map(c => String(c || "").trim())
        .filter(Boolean)
        .map(c => {
            const m = c.match(/^([A-Za-z]*[-_]?)(\d+)$/);
            return m ? { prefijo: m[1].toUpperCase(), digitos: m[2].length } : null;
        })
        .filter(Boolean);

    if (partes.length < 3) return null;

    const prefijos = new Set(partes.map(p => p.prefijo));
    if (prefijos.size !== 1) return null;

    const prefijo = [...prefijos][0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const minDigitos = Math.min(...partes.map(p => p.digitos));
    const maxDigitos = Math.max(...partes.map(p => p.digitos));

    return `^${prefijo}\\d{${minDigitos},${maxDigitos}}$`;
}

async function obtenerPlantillaPdf(pool, negocioId, proveedorNormalizado) {
    if (!proveedorNormalizado) return null;
    const fila = await pool.query(
        `SELECT mapeo FROM public.plantillas_catalogo WHERE negocio_id = $1 AND proveedor_normalizado = $2 AND formato = 'pdf'`,
        [negocioId, proveedorNormalizado]
    );
    const mapeo = fila.rows[0]?.mapeo;
    if (!mapeo || typeof mapeo !== "object") return null;
    if ((mapeo.muestrasConfirmadas || 0) < 20) return null; // no confiar en plantillas con pocas muestras
    return mapeo;
}

async function guardarAprendizajePdf(pool, negocioId, proveedor, proveedorNormalizado, codigosConfirmados) {
    if (!proveedorNormalizado || codigosConfirmados.length === 0) return;

    const existente = await pool.query(
        `SELECT mapeo FROM public.plantillas_catalogo WHERE negocio_id = $1 AND proveedor_normalizado = $2 AND formato = 'pdf'`,
        [negocioId, proveedorNormalizado]
    );
    const previo = existente.rows[0]?.mapeo || {};
    const muestrasPrevias = Number(previo.muestrasConfirmadas) || 0;

    const regexCodigo = generalizarRegexDeCodigos(codigosConfirmados) || previo.regexCodigo || null;
    const mapeo = {
        ...previo,
        regexCodigo,
        muestrasConfirmadas: muestrasPrevias + codigosConfirmados.length
    };

    await pool.query(
        `
        INSERT INTO public.plantillas_catalogo (negocio_id, proveedor, proveedor_normalizado, parser, mapeo, formato)
        VALUES ($1, $2, $3, 'generico', $4, 'pdf')
        ON CONFLICT (negocio_id, proveedor_normalizado, formato) DO UPDATE SET
            proveedor = EXCLUDED.proveedor,
            mapeo = EXCLUDED.mapeo,
            updated_at = NOW()
        `,
        [negocioId, proveedor, proveedorNormalizado, JSON.stringify(mapeo)]
    );
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
            SELECT COUNT(*) AS total,
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

// Un mismo codigo puede aparecer 2+ veces en un catalogo real de
// cientos de paginas (reimpreso en otra seccion, actualizado de precio
// mas adelante, etc.) -- confirmado corriendo el catalogo real de GAFI
// (636 paginas): "ON CONFLICT DO UPDATE command cannot affect row a
// second time", porque Postgres no permite que el mismo (catalogo_id,
// codigo_proveedor) aparezca 2 veces DENTRO del mismo INSERT ... ON
// CONFLICT. Se usa un Map para quedarse con la ultima aparicion de cada
// codigo -- mismo resultado que tendria upsertear fila por fila en orden.
function filasUnicasPorCodigo(productos) {
    const filasPorCodigo = new Map();

    productos.forEach((p, indice) => {
        const codigoProveedor = p.codigo || `SIN-CODIGO-P${p.paginaPdf}-${indice}`;
        filasPorCodigo.set(codigoProveedor, {
            codigoProveedor,
            nombre: p.descripcion || "",
            descripcion: p.descripcion || "",
            precioPublico: Number.isFinite(p.precio) ? p.precio : null,
            imagen: p.imagenBuffer,
            imagenTipo: p.imagenTipo,
            paginaPdf: p.paginaPdf,
            confianzaCodigo: p.confianzaCodigo,
            confianzaDescripcion: p.confianzaDescripcion,
            confianzaPrecio: p.confianzaPrecio,
            confianzaImagen: p.confianzaImagen,
            estadoExtraccion: p.estadoExtraccion
        });
    });

    return [...filasPorCodigo.values()];
}

async function procesarTrabajoPdf(pool, trabajo) {
    // El cliente transaccional solo se reserva del pool justo antes de la
    // transaccion (mas abajo) -- reservarlo desde aqui arriba lo dejaba
    // detenido, sin usarse, durante los varios minutos que tarda
    // extraerCatalogoPDF en un catalogo real grande (confirmado con el
    // catalogo real de GAFI, 636 paginas, ~9 minutos): el proveedor de la
    // base de datos cierra conexiones inactivas por su cuenta, y al volver
    // a usarla para el BEGIN tronaba "Client has encountered a connection
    // error and is not queryable". El progreso (onProgreso) y el update
    // inicial de estado ya usaban `pool.query` normal, sin este problema.
    let cliente = null;

    try {
        await pool.query(
            `UPDATE public.catalogo_pdf_trabajos SET estado = 'procesando', updated_at = NOW() WHERE id = $1`,
            [trabajo.id]
        );

        const plantilla = await obtenerPlantillaPdf(pool, trabajo.negocio_id, trabajo.proveedor_normalizado);

        const resultado = await extraerCatalogoPDF(trabajo.ruta_temporal, {
            plantilla,
            limiteLlamadasIA: TOPE_LLAMADAS_IA_POR_TRABAJO,
            onProgreso: async (paginaActual, totalPaginas) => {
                await pool.query(
                    `UPDATE public.catalogo_pdf_trabajos SET pagina_actual = $1, total_paginas = $2, updated_at = NOW() WHERE id = $3`,
                    [paginaActual, totalPaginas, trabajo.id]
                ).catch(() => {});
            }
        });

        cliente = await pool.connect();
        await cliente.query("BEGIN");

        const catalogo = await cliente.query(
            `
            INSERT INTO public.catalogos_proveedor (negocio_id, proveedor)
            VALUES ($1, $2)
            ON CONFLICT (negocio_id, proveedor) DO UPDATE SET updated_at = NOW()
            RETURNING id
            `,
            [trabajo.negocio_id, trabajo.proveedor]
        );
        const catalogoId = catalogo.rows[0].id;

        const filas = filasUnicasPorCodigo(resultado.productos);

        const TAMANO_LOTE = 200; // mas chico que el lote CSV (400): cada fila trae una imagen BYTEA
        for (let inicio = 0; inicio < filas.length; inicio += TAMANO_LOTE) {
            const lote = filas.slice(inicio, inicio + TAMANO_LOTE);
            const columnasPorFila = 12;
            const valoresSQL = [];
            const parametros = [];

            lote.forEach((fila, indice) => {
                const base = indice * columnasPorFila;
                valoresSQL.push(
                    `($1,$2,$${base + 3},$${base + 4},$${base + 5},$${base + 6},'pdf',$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`
                );
                parametros.push(
                    fila.codigoProveedor, fila.nombre, fila.descripcion, fila.precioPublico,
                    fila.imagen, fila.imagenTipo, fila.paginaPdf,
                    fila.confianzaCodigo, fila.confianzaDescripcion, fila.confianzaPrecio, fila.confianzaImagen,
                    fila.estadoExtraccion
                );
            });

            await cliente.query(
                `
                INSERT INTO public.catalogo_productos
                    (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, descripcion, precio_publico,
                     origen, imagen, imagen_tipo, pagina_pdf,
                     confianza_codigo, confianza_descripcion, confianza_precio, confianza_imagen, estado_extraccion)
                VALUES ${valoresSQL.join(",")}
                ON CONFLICT (catalogo_id, codigo_proveedor) DO UPDATE SET
                    nombre_proveedor = EXCLUDED.nombre_proveedor,
                    descripcion = EXCLUDED.descripcion,
                    precio_publico_anterior = public.catalogo_productos.precio_publico,
                    precio_publico = EXCLUDED.precio_publico,
                    origen = 'pdf',
                    imagen = EXCLUDED.imagen,
                    imagen_tipo = EXCLUDED.imagen_tipo,
                    pagina_pdf = EXCLUDED.pagina_pdf,
                    confianza_codigo = EXCLUDED.confianza_codigo,
                    confianza_descripcion = EXCLUDED.confianza_descripcion,
                    confianza_precio = EXCLUDED.confianza_precio,
                    confianza_imagen = EXCLUDED.confianza_imagen,
                    estado_extraccion = EXCLUDED.estado_extraccion,
                    updated_at = NOW()
                `,
                [trabajo.negocio_id, catalogoId, ...parametros]
            );
        }

        await cliente.query("COMMIT");
        await actualizarContadoresCatalogo(pool, trabajo.negocio_id, catalogoId);

        const productosCompletos = filas.filter(f => f.estadoExtraccion === "completo").length;
        const productosRevision = filas.filter(f => f.estadoExtraccion === "revision").length;
        const productosNoIdentificados = filas.filter(f => f.estadoExtraccion === "no_identificado").length;

        await pool.query(
            `
            UPDATE public.catalogo_pdf_trabajos
            SET estado = 'listo', catalogo_id = $1, total_productos = $2,
                productos_completos = $3, productos_revision = $4, productos_no_identificados = $5,
                llamadas_ia = $6, updated_at = NOW()
            WHERE id = $7
            `,
            [catalogoId, filas.length, productosCompletos, productosRevision, productosNoIdentificados, resultado.llamadasIA, trabajo.id]
        );
    } catch (error) {
        if (cliente) await cliente.query("ROLLBACK").catch(() => {});
        await pool.query(
            `UPDATE public.catalogo_pdf_trabajos SET estado = 'error', mensaje_error = $1, updated_at = NOW() WHERE id = $2`,
            [error.message || "Error desconocido procesando el PDF", trabajo.id]
        ).catch(() => {});
    } finally {
        if (cliente) cliente.release();
        fs.unlink(trabajo.ruta_temporal, () => {});
    }
}

const INTERVALO_REVISION_MS = 4000;
let procesandoAhora = false;

function iniciarProcesadorCatalogoPDF(pool) {
    async function revisarYCorrer() {
        // La bandera se prende ANTES del primer await (sin nada async en
        // medio) -- confirmado con carga real: si el SELECT de abajo se
        // tarda (ej. la base ocupada por otra cosa al mismo tiempo, como
        // una corrida de pruebas), el intervalo de 4s puede volver a
        // disparar `revisarYCorrer` mientras el primero sigue esperando,
        // y con la bandera prendiendose DESPUES del SELECT ambas llamadas
        // pasaban el "if (procesandoAhora) return" y procesaban el MISMO
        // trabajo en paralelo -- una copia borraba el PDF (fs.unlink al
        // terminar) mientras la otra todavia lo estaba leyendo, tronando
        // con ENOENT. JS es de un solo hilo: sin await entre el check y
        // el set, ninguna otra llamada puede colarse en esa ventana.
        if (procesandoAhora) return;
        procesandoAhora = true;

        try {
            const pendiente = await pool.query(
                `SELECT * FROM public.catalogo_pdf_trabajos WHERE estado = 'pendiente' ORDER BY created_at ASC LIMIT 1`
            );
            if (pendiente.rows.length === 0) return;

            await procesarTrabajoPdf(pool, pendiente.rows[0]);
        } catch (error) {
            console.log("[catalogo-pdf] Error en el poller:", error.message);
        } finally {
            procesandoAhora = false;
        }
    }

    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    iniciarProcesadorCatalogoPDF(pool);

    app.post(
        "/catalogo-proveedor-pdf/:proveedor/subir",
        requerirAccesoNegocio,
        requerirFuncionPlan("catalogo.importacion_pdf", "Importar catalogos PDF esta disponible desde el plan Plus."),
        manejarSubidaPdfCatalogo,
        async (req, res) => {
            const proveedor = String(req.params.proveedor || "").trim();
            const proveedorNormalizado = String(req.body?.proveedorNormalizado || "").trim();

            if (!proveedor) { res.status(400).json({ ok: false, error: "Falta el nombre del proveedor" }); return; }
            if (!req.file) { res.status(400).json({ ok: false, error: "Falta el archivo PDF" }); return; }
            if (req.file.mimetype !== "application/pdf" && !req.file.originalname.toLowerCase().endsWith(".pdf")) {
                fs.unlink(req.file.path, () => {});
                res.status(400).json({ ok: false, error: "El archivo debe ser un PDF" });
                return;
            }

            try {
                const negocio = await negocioActual(req, pool);

                const trabajo = await pool.query(
                    `
                    INSERT INTO public.catalogo_pdf_trabajos
                        (negocio_id, proveedor, nombre_archivo, ruta_temporal, estado)
                    VALUES ($1, $2, $3, $4, 'pendiente')
                    RETURNING id
                    `,
                    [negocio.id, proveedor, req.file.originalname, req.file.path]
                );

                // proveedor_normalizado se guarda aparte (no hay columna
                // en catalogo_pdf_trabajos) -- se recalcula al procesar
                // via el mismo valor que ya trae este body, guardado en
                // una tabla efimera no hace falta: se pasa de nuevo al
                // buscar/guardar la plantilla usando el proveedor tal
                // cual, normalizado otra vez del lado del cliente en la
                // siguiente pantalla (confirmar importacion).
                res.json({ ok: true, trabajoId: trabajo.rows[0].id, proveedorNormalizado });
            } catch (error) {
                if (req.file) fs.unlink(req.file.path, () => {});
                responderError(res, error);
            }
        }
    );

    app.get("/catalogo-proveedor-pdf/trabajos/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `
                SELECT id, estado, total_paginas, pagina_actual, total_productos,
                       productos_completos, productos_revision, productos_no_identificados,
                       llamadas_ia, mensaje_error, catalogo_id
                FROM public.catalogo_pdf_trabajos
                WHERE id = $1 AND negocio_id = $2
                `,
                [req.params.id, negocio.id]
            );
            if (resultado.rows.length === 0) { res.status(404).json({ ok: false, error: "No encontrado" }); return; }
            res.json({ ok: true, trabajo: resultado.rows[0] });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/catalogo-proveedor-pdf/trabajos/:id/resumen", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const resultado = await pool.query(
                `
                SELECT estado, total_productos, productos_completos, productos_revision, productos_no_identificados, catalogo_id
                FROM public.catalogo_pdf_trabajos
                WHERE id = $1 AND negocio_id = $2
                `,
                [req.params.id, negocio.id]
            );
            if (resultado.rows.length === 0) { res.status(404).json({ ok: false, error: "No encontrado" }); return; }
            const trabajo = resultado.rows[0];

            if (trabajo.estado !== "listo") {
                res.json({ ok: true, listo: false, estado: trabajo.estado });
                return;
            }

            res.json({
                ok: true,
                listo: true,
                catalogoId: trabajo.catalogo_id,
                resumen: {
                    total: trabajo.total_productos,
                    completos: trabajo.productos_completos,
                    revision: trabajo.productos_revision,
                    noIdentificados: trabajo.productos_no_identificados
                }
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Imagen candidata de una fila de catalogo (PDF o CSV -- CSV no
    // trae imagen propia hoy, pero la ruta no distingue origen a
    // proposito, por si algun dia se agrega). Sirve el BYTEA directo,
    // token firmado en la URL igual que el resto de imagenes del
    // sistema (un <img src> no puede mandar Authorization).
    app.get("/catalogo-proveedor/:id/productos/:catalogoProductoId/imagen-propuesta", async (req, res) => {
        const token = String(req.query.token || "");
        if (!verificarTokenImagenCatalogoPdf(token, req.params.catalogoProductoId)) {
            res.status(401).json({ ok: false, error: "Enlace de imagen invalido o vencido" });
            return;
        }

        try {
            const resultado = await pool.query(
                `SELECT imagen, imagen_tipo FROM public.catalogo_productos WHERE id = $1 AND catalogo_id = $2`,
                [req.params.catalogoProductoId, req.params.id]
            );
            const fila = resultado.rows[0];
            if (!fila || !fila.imagen) { res.status(404).end(); return; }

            res.setHeader("Content-Type", fila.imagen_tipo || "image/jpeg");
            res.setHeader("Cache-Control", "private, max-age=300");
            res.send(fila.imagen);
        } catch (error) {
            responderError(res, error);
        }
    });

    // Bug real reportado por el dueño: al usar "Agregar producto" con un
    // codigo real de un catalogo ya importado (ej. GAFI), no aparecia
    // ninguna foto -- ese formulario solo consultaba fotos_producto (lo
    // que el negocio ya tiene guardado) y el Banco de Nexo, nunca el
    // catalogo de proveedor recien importado (staging, catalogo_productos).
    // Mismo criterio de exposicion que /fotos-producto-existe: solo dice
    // si existe y da una URL firmada, nunca el bytea directo aqui.
    app.get("/catalogo-proveedor-foto-existe/:codigo", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const codigo = String(req.params.codigo || "").trim();

            if (!codigo) { res.json({ ok: true, existe: false }); return; }

            const resultado = await pool.query(
                `
                SELECT cp.id, cp.catalogo_id, cat.proveedor
                FROM public.catalogo_productos cp
                JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id
                WHERE cp.negocio_id = $1
                  AND (cp.codigo_proveedor = $2 OR NULLIF(cp.codigo_interno, '') = $2 OR NULLIF(cp.codigo_barras, '') = $2)
                  AND cp.imagen IS NOT NULL
                ORDER BY cp.updated_at DESC LIMIT 1
                `,
                [negocio.id, codigo]
            );

            const fila = resultado.rows[0];
            if (!fila) { res.json({ ok: true, existe: false }); return; }

            res.json({
                ok: true,
                existe: true,
                proveedor: fila.proveedor,
                imagenUrl: `/catalogo-proveedor/${fila.catalogo_id}/productos/${fila.id}/imagen-propuesta?token=${firmarTokenImagenCatalogoPdf(fila.id)}`
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Copia esa misma imagen candidata a fotos_producto (lo que de verdad
    // usa el POS/ticket/Market) -- mismo patron que /banco-imagenes/:codigo/usar,
    // nunca se copia sola sin que el dueño le de "Usar esta imagen".
    app.post("/catalogo-proveedor-foto/:codigo/usar", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const codigo = String(req.params.codigo || "").trim();

            if (!codigo) { res.status(400).json({ ok: false, error: "Falta el codigo" }); return; }

            const resultado = await pool.query(
                `SELECT imagen, imagen_tipo FROM public.catalogo_productos
                 WHERE negocio_id = $1
                   AND (codigo_proveedor = $2 OR NULLIF(codigo_interno, '') = $2 OR NULLIF(codigo_barras, '') = $2)
                   AND imagen IS NOT NULL
                 ORDER BY updated_at DESC LIMIT 1`,
                [negocio.id, codigo]
            );

            const fila = resultado.rows[0];
            if (!fila) { res.status(404).json({ ok: false, error: "No se encontro esa imagen" }); return; }

            await pool.query(
                `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (negocio_id, codigo) DO UPDATE SET
                     imagen_principal = EXCLUDED.imagen_principal, imagen_principal_tipo = EXCLUDED.imagen_principal_tipo, actualizado_at = NOW()`,
                [negocio.id, codigo, fila.imagen, fila.imagen_tipo || "image/jpeg"]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Confirma la importacion: crea productos reales a partir de las
    // filas seleccionadas (normalmente las verdes + las amarillas ya
    // corregidas por el dueno) en un solo round-trip, en vez de una
    // llamada por producto. Las filas no incluidas (las rojas) se
    // quedan en staging para completarse despues, nunca se crean solas.
    app.post("/catalogo-proveedor/:id/crear-productos-lote", requerirAccesoNegocio, async (req, res) => {
        const catalogoProductoIds = Array.isArray(req.body?.catalogoProductoIds)
            ? req.body.catalogoProductoIds.map(Number).filter(Number.isFinite)
            : [];

        if (catalogoProductoIds.length === 0) {
            res.status(400).json({ ok: false, error: "No se selecciono ningun producto" });
            return;
        }

        try {
            const negocio = await negocioActual(req, pool);

            const filas = await pool.query(
                `
                SELECT * FROM public.catalogo_productos
                WHERE id = ANY($1::int[]) AND catalogo_id = $2 AND negocio_id = $3 AND producto_id IS NULL
                `,
                [catalogoProductoIds, req.params.id, negocio.id]
            );

            let creados = 0;
            const codigosConfirmados = [];
            let proveedorParaAprendizaje = null;
            let proveedorNormalizadoParaAprendizaje = null;

            // Fase 6 del plan "Catalogo Maestro Nexo": se resuelve una
            // sola vez para todo el lote (todas las filas vienen del
            // mismo catalogo, mismo proveedor) en vez de repetir la
            // consulta por producto.
            const catalogoInfo = await pool.query(`SELECT proveedor FROM public.catalogos_proveedor WHERE id = $1`, [req.params.id]);
            const nombreProveedorCatalogo = catalogoInfo.rows[0]?.proveedor || "";
            const proveedorId = await resolverOcrearProveedorId(pool, negocio.id, nombreProveedorCatalogo);

            for (const cp of filas.rows) {
                const nuevoProducto = await pool.query(
                    `
                    INSERT INTO public.productos
                        (negocio_id, nombre, precio, stock, codigo, proveedor, proveedor_id, descripcion, precio_publico, tipo_producto)
                    VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,'catalogo')
                    RETURNING id
                    `,
                    [
                        negocio.id, cp.nombre_proveedor || cp.codigo_proveedor, cp.precio_publico || 0,
                        cp.codigo_barras || cp.codigo_interno || cp.codigo_proveedor, nombreProveedorCatalogo, proveedorId, cp.descripcion, cp.precio_publico
                    ]
                );
                const productoId = nuevoProducto.rows[0].id;

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
                    `UPDATE public.catalogo_productos SET producto_id = $1, estado = 'vinculado', porcentaje_coincidencia = 100, vinculado_manualmente = true, updated_at = NOW() WHERE id = $2`,
                    [productoId, cp.id]
                );

                // Fase 7 del plan "Catalogo Maestro Nexo" -- mismo
                // criterio que crear-producto (catalog-server.js): solo
                // identidad de producto, nunca precio/costo. No bloquea
                // la creacion en lote si falla.
                try {
                    const catalogoMaestroId = await contribuirOEnlazarCatalogoMaestro(pool, negocio.id, {
                        codigo: cp.codigo_interno || cp.codigo_proveedor,
                        codigoFabricante: cp.clave_proveedor,
                        ean: cp.codigo_barras,
                        marca: cp.marca,
                        nombre: cp.nombre_proveedor || cp.codigo_proveedor,
                        descripcion: cp.descripcion,
                        categoriaNexoId: null,
                        imagen: cp.imagen,
                        imagenTipo: cp.imagen_tipo,
                        imagenConfianza: cp.confianza_imagen,
                        fuente: nombreProveedorCatalogo
                    });
                    if (catalogoMaestroId) {
                        await pool.query(`UPDATE public.productos SET catalogo_maestro_id = $1 WHERE id = $2`, [catalogoMaestroId, productoId]);
                    }
                } catch (errorCatalogoMaestro) {
                    console.error("No se pudo aportar/enlazar al Catalogo Maestro", errorCatalogoMaestro);
                }

                creados++;
                if (!/^SIN-CODIGO-/.test(cp.codigo_proveedor)) codigosConfirmados.push(cp.codigo_proveedor);
            }

            if (filas.rows.length > 0) {
                const catalogo = await pool.query(`SELECT proveedor FROM public.catalogos_proveedor WHERE id = $1`, [req.params.id]);
                proveedorParaAprendizaje = catalogo.rows[0]?.proveedor || null;
                proveedorNormalizadoParaAprendizaje = String(req.body?.proveedorNormalizado || "").trim() || null;
            }

            await actualizarContadoresCatalogo(pool, negocio.id, Number(req.params.id));

            if (proveedorParaAprendizaje && proveedorNormalizadoParaAprendizaje) {
                await guardarAprendizajePdf(pool, negocio.id, proveedorParaAprendizaje, proveedorNormalizadoParaAprendizaje, codigosConfirmados).catch(() => {});
            }

            res.json({ ok: true, creados });
        } catch (error) {
            responderError(res, error);
        }
    });
};

module.exports.firmarTokenImagenCatalogoPdf = firmarTokenImagenCatalogoPdf;
module.exports.filasUnicasPorCodigo = filasUnicasPorCodigo;

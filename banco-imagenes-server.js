const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const sharp = require("sharp");
const { responderError } = require("./error-utils");

// Banco de imagenes global ("Banco de Nexo") -- Pro-only, curado por el
// admin. Espejo de fotos_producto/fotos_producto_galeria (server.js) pero
// SIN negocio_id: una sola foto por codigo, compartida entre todos los
// negocios en plan Pro. Coexiste como una segunda fuente de imagen
// distinta -- este modulo nunca lee ni escribe fotos_producto salvo en
// /banco-imagenes/:codigo/usar, que copia (no mueve) hacia la ficha
// propia del negocio que la pide.

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

function normalizarCodigoFoto(codigo) {
    return String(codigo || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

async function comprimirImagen(buffer, anchoMax = 320) {
    const { data, info } = await sharp(buffer)
        .resize({ width: anchoMax, withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer({ resolveWithObject: true });

    return { buffer: data, ancho: info.width, alto: info.height };
}

// Lee plan directo de licencias (no de negocios) -- es la fuente que de
// verdad sincroniza con Stripe, mismo criterio ya usado para gatear la
// busqueda web de Nexo IA (ia-server.js). demo se trata igual que pro.
async function planPermiteBancoImagenes(pool, negocioId) {
    const fila = await pool.query(
        `SELECT plan FROM public.licencias WHERE negocio_id = $1`,
        [negocioId]
    );
    const plan = (fila.rows[0]?.plan || "demo").toLowerCase();
    return plan === "pro" || plan === "demo";
}

// Firma independiente de la de fotos_producto (firmarTokenImagen en
// server.js): esa lleva el negocio_id horneado en el HMAC, y aqui no
// existe un negocio "dueno" de la imagen -- inventar un id sentinela
// mezclaria dos dominios de auth distintos sin necesidad real.
const SECRETO_TOKEN_BANCO_IMAGENES = crypto.randomBytes(32);
const DURACION_TOKEN_BANCO_IMAGENES_MS = 15 * 60 * 1000;

function firmarTokenBancoImagen(codigo) {
    const expiraEn = Date.now() + DURACION_TOKEN_BANCO_IMAGENES_MS;
    const payload = `${codigo}:${expiraEn}`;
    const firma = crypto.createHmac("sha256", SECRETO_TOKEN_BANCO_IMAGENES).update(payload).digest("hex");
    return `${expiraEn}.${firma}`;
}

function verificarTokenBancoImagen(token, codigo) {
    if (typeof token !== "string" || !token.includes(".")) return false;

    const [expiraEnTexto, firma] = token.split(".");
    const expiraEn = Number(expiraEnTexto);

    if (!Number.isFinite(expiraEn) || Date.now() > expiraEn) return false;

    const payload = `${codigo}:${expiraEn}`;
    const firmaEsperada = crypto.createHmac("sha256", SECRETO_TOKEN_BANCO_IMAGENES).update(payload).digest("hex");

    if (firma.length !== firmaEsperada.length) return false;

    return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(firmaEsperada));
}

// Un zip de varias paginas del Banco de Contenido Digital de Truper puede
// pesar bastante -- el margen de 200MB usado originalmente (mismo que
// uploadZipsFotosProducto en server.js) se quedaba corto con paginas muy
// pobladas de fotos (hasta ~236MB observado en el catalogo real), asi que
// aqui se sube a 300MB con el mismo limite de 30 archivos por lote.
const uploadZipsBancoImagenes = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 300 * 1024 * 1024, files: 30 }
});

// Envuelto a mano (no como middleware directo) para que un error de
// subida siempre regrese JSON en vez de la pagina HTML de error de
// Express -- mismo motivo que manejarSubidaFotosProducto en server.js.
function manejarSubidaBancoImagenes(req, res, next) {
    uploadZipsBancoImagenes.array("zips", 30)(req, res, error => {
        if (error) {
            const esMuyPesado = error.code === "LIMIT_FILE_SIZE";

            res.status(400).json({
                ok: false,
                error: esMuyPesado
                    ? "Este archivo pesa mas de 200MB. Sube menos paginas juntas o en menor resolucion e intenta de nuevo."
                    : (error.message || "No se pudo procesar el archivo subido")
            });
            return;
        }
        next();
    });
}

// Copia casi literal de procesarZipFotosProducto (server.js) sin
// negocio_id: una carpeta por producto, primera foto = principal, resto
// = galeria, hasta 2 codigos derivados por carpeta (nombre de archivo +
// nombre de carpeta, por el caso conocido de Diprofer reusando el ID
// numerico de Truper).
async function procesarZipBancoImagenes(pool, rutaZip, marca, origen) {
    const resumen = { fotosGuardadas: 0, solicitudesResueltas: 0, errores: [] };

    let zip;
    try {
        zip = new AdmZip(rutaZip);
    } catch (error) {
        resumen.errores.push(`Zip invalido: ${error.message}`);
        return resumen;
    }

    const carpetas = new Map();

    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;

        const partes = entry.entryName.split("/").filter(Boolean);
        if (partes.length < 2) continue;

        const carpeta = partes[0];
        const nombreArchivo = partes[partes.length - 1];

        if (!/\.(jpg|jpeg|png|webp)$/i.test(nombreArchivo)) continue;

        if (!carpetas.has(carpeta)) carpetas.set(carpeta, []);
        carpetas.get(carpeta).push({ nombreArchivo, entry });
    }

    for (const [carpeta, archivos] of carpetas) {
        try {
            const principal = archivos[0];
            const resto = archivos.slice(1);

            const codigoArchivo = principal.nombreArchivo
                .replace(/\.(jpg|jpeg|png|webp)$/i, "")
                .split("+")[0];

            const codigos = [...new Set([
                normalizarCodigoFoto(codigoArchivo),
                normalizarCodigoFoto(carpeta)
            ])].filter(Boolean);

            if (codigos.length === 0) continue;

            const principalComprimida = await comprimirImagen(principal.entry.getData(), 320);
            const buffersGaleria = [];

            for (const item of resto) {
                buffersGaleria.push(await comprimirImagen(item.entry.getData(), 480));
            }

            for (const codigo of codigos) {
                const upsert = await pool.query(
                    `
                    INSERT INTO public.banco_imagenes_producto
                        (codigo, marca, imagen_principal, imagen_principal_tipo, imagen_principal_ancho, imagen_principal_alto, origen, actualizado_at)
                    VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6, NOW())
                    ON CONFLICT (codigo)
                    DO UPDATE SET
                        marca = COALESCE($2, public.banco_imagenes_producto.marca),
                        imagen_principal = $3,
                        imagen_principal_tipo = 'image/jpeg',
                        imagen_principal_ancho = $4,
                        imagen_principal_alto = $5,
                        origen = COALESCE($6, public.banco_imagenes_producto.origen),
                        actualizado_at = NOW()
                    RETURNING id
                    `,
                    [codigo, marca, principalComprimida.buffer, principalComprimida.ancho, principalComprimida.alto, origen || null]
                );

                const bancoImagenId = upsert.rows[0].id;

                // Si algun negocio Pro habia pedido esta foto, se marca
                // resuelta -- el indice unico parcial en (codigo, negocio_id)
                // WHERE estado='pendiente' asegura que esto solo toque
                // solicitudes activas, sin duplicar resoluciones.
                const resueltas = await pool.query(
                    `
                    UPDATE public.banco_imagenes_solicitudes
                    SET estado = 'resuelta', banco_imagen_id = $1, resuelta_at = NOW()
                    WHERE codigo = $2 AND estado = 'pendiente'
                    RETURNING id
                    `,
                    [bancoImagenId, codigo]
                );
                resumen.solicitudesResueltas += resueltas.rows.length;

                await pool.query(
                    `DELETE FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1`,
                    [bancoImagenId]
                );

                let orden = 0;
                for (const item of buffersGaleria) {
                    await pool.query(
                        `
                        INSERT INTO public.banco_imagenes_producto_galeria (banco_imagen_id, orden, imagen, tipo, ancho, alto)
                        VALUES ($1, $2, $3, 'image/jpeg', $4, $5)
                        `,
                        [bancoImagenId, orden, item.buffer, item.ancho, item.alto]
                    );

                    orden += 1;
                }
            }

            resumen.fotosGuardadas += 1;
        } catch (error) {
            resumen.errores.push(error.message);
        }
    }

    return resumen;
}

// Un zip grande (muchas fotos) puede tardar minutos en comprimirse una
// por una -- eso ya superaba el timeout del proxy de produccion cuando
// se procesaba dentro de la misma peticion HTTP (la subida se veia como
// 502/520 aunque el archivo hubiera llegado bien). Mismo patron que
// catalogo_pdf_trabajos (catalog-pdf-server.js): la ruta de subida solo
// guarda el archivo y encola un trabajo; este poller lo procesa aparte,
// fuera del ciclo de la peticion HTTP que lo subio.
async function procesarTrabajoImportacionBanco(pool, trabajo) {
    try {
        await pool.query(
            `UPDATE public.banco_imagenes_importacion_trabajos SET estado = 'procesando', updated_at = NOW() WHERE id = $1`,
            [trabajo.id]
        );

        const resultado = await procesarZipBancoImagenes(pool, trabajo.ruta_temporal, trabajo.marca, trabajo.nombre_archivo);

        await pool.query(
            `
            UPDATE public.banco_imagenes_importacion_trabajos
            SET estado = 'listo', fotos_guardadas = $1, solicitudes_resueltas = $2, errores = $3, updated_at = NOW()
            WHERE id = $4
            `,
            [resultado.fotosGuardadas, resultado.solicitudesResueltas, JSON.stringify(resultado.errores), trabajo.id]
        );
    } catch (error) {
        await pool.query(
            `UPDATE public.banco_imagenes_importacion_trabajos SET estado = 'error', mensaje_error = $1, updated_at = NOW() WHERE id = $2`,
            [error.message || "Error desconocido procesando el zip", trabajo.id]
        );
    } finally {
        fs.unlink(trabajo.ruta_temporal, () => {});
    }
}

const INTERVALO_REVISION_IMPORTACION_BANCO_MS = 4000;
let procesandoImportacionBancoAhora = false;

function iniciarProcesadorImportacionBanco(pool) {
    async function revisarYCorrer() {
        if (procesandoImportacionBancoAhora) return;

        try {
            const pendiente = await pool.query(
                `SELECT * FROM public.banco_imagenes_importacion_trabajos WHERE estado = 'pendiente' ORDER BY created_at ASC LIMIT 1`
            );
            if (pendiente.rows.length === 0) return;

            procesandoImportacionBancoAhora = true;
            await procesarTrabajoImportacionBanco(pool, pendiente.rows[0]);
        } catch (error) {
            console.log("[banco-imagenes] Error en el poller de importacion:", error.message);
        } finally {
            procesandoImportacionBancoAhora = false;
        }
    }

    setInterval(revisarYCorrer, INTERVALO_REVISION_IMPORTACION_BANCO_MS);
}

function registrarRutasBancoImagenes(app, pool, requerirAccesoNegocio) {
    iniciarProcesadorImportacionBanco(pool);

    // ---- Rutas de Admin -- protegidas globalmente por validarAdminKey,
    // montado en server.js sobre todo el prefijo /admin/api antes de que
    // cargarModulosPOS() cargue este modulo. ----

    // No procesa el zip aqui -- solo lo guarda y encola un trabajo por
    // archivo (iniciarProcesadorImportacionBanco lo recoge aparte). Asi
    // la peticion HTTP responde en cuanto el archivo termina de subir,
    // sin esperar a que se compriman todas las fotos adentro.
    app.post("/admin/api/banco-imagenes/importar-lote", manejarSubidaBancoImagenes, async (req, res) => {
        const archivos = req.files || [];

        try {
            if (archivos.length === 0) {
                res.status(400).json({ ok: false, error: "No se recibio ningun archivo .zip" });
                return;
            }

            const marca = String(req.body?.marca || "").trim() || null;
            const trabajoIds = [];

            for (const archivo of archivos) {
                const trabajo = await pool.query(
                    `
                    INSERT INTO public.banco_imagenes_importacion_trabajos (nombre_archivo, ruta_temporal, marca, estado)
                    VALUES ($1, $2, $3, 'pendiente')
                    RETURNING id
                    `,
                    [archivo.originalname, archivo.path, marca]
                );
                trabajoIds.push(trabajo.rows[0].id);
            }

            res.json({ ok: true, trabajoIds });
        } catch (error) {
            for (const archivo of archivos) {
                fs.unlink(archivo.path, () => {});
            }
            responderError(res, error);
        }
    });

    // Consultado por el navegador cada pocos segundos hasta que todos
    // los trabajos pedidos queden en 'listo' o 'error'.
    app.get("/admin/api/banco-imagenes/importar-lote/trabajos", async (req, res) => {
        try {
            const ids = String(req.query?.ids || "")
                .split(",")
                .map(id => Number(id.trim()))
                .filter(id => Number.isInteger(id) && id > 0);

            if (ids.length === 0) {
                res.json({ ok: true, trabajos: [] });
                return;
            }

            const resultado = await pool.query(
                `
                SELECT id, nombre_archivo, estado, fotos_guardadas, solicitudes_resueltas, errores, mensaje_error
                FROM public.banco_imagenes_importacion_trabajos
                WHERE id = ANY($1::int[])
                `,
                [ids]
            );

            res.json({ ok: true, trabajos: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/admin/api/banco-imagenes", async (req, res) => {
        try {
            const buscar = String(req.query.buscar || "").trim();
            const marcaFiltro = String(req.query.marca || "").trim();
            const pagina = Math.max(1, Number(req.query.pagina) || 1);
            const porPagina = 40;
            const offset = (pagina - 1) * porPagina;
            const filtro = buscar ? `%${buscar}%` : null;

            const ordenSQL = {
                recientes: "b.actualizado_at DESC",
                codigo: "b.codigo ASC",
                marca: "b.marca ASC NULLS LAST, b.codigo ASC"
            }[req.query.orden] || "b.actualizado_at DESC";

            const filas = await pool.query(
                `
                SELECT b.codigo, b.marca, b.origen, b.actualizado_at,
                    b.imagen_principal_ancho, b.imagen_principal_alto,
                    octet_length(b.imagen_principal) AS tamano_principal,
                    (SELECT COUNT(*) FROM public.banco_imagenes_producto_galeria g WHERE g.banco_imagen_id = b.id) AS total_galeria,
                    (SELECT COALESCE(SUM(octet_length(g.imagen)), 0) FROM public.banco_imagenes_producto_galeria g WHERE g.banco_imagen_id = b.id) AS tamano_galeria
                FROM public.banco_imagenes_producto b
                WHERE ($1::text IS NULL OR b.codigo ILIKE $1 OR b.marca ILIKE $1)
                    AND ($4::text IS NULL OR b.marca = $4)
                ORDER BY ${ordenSQL}
                LIMIT $2 OFFSET $3
                `,
                [filtro, porPagina, offset, marcaFiltro || null]
            );

            const total = await pool.query(
                `
                SELECT COUNT(*)::int AS total FROM public.banco_imagenes_producto b
                WHERE ($1::text IS NULL OR b.codigo ILIKE $1 OR b.marca ILIKE $1)
                    AND ($2::text IS NULL OR b.marca = $2)
                `,
                [filtro, marcaFiltro || null]
            );

            res.json({
                ok: true,
                items: filas.rows.map(fila => ({
                    codigo: fila.codigo,
                    marca: fila.marca,
                    origen: fila.origen,
                    actualizadoAt: fila.actualizado_at,
                    ancho: fila.imagen_principal_ancho,
                    alto: fila.imagen_principal_alto,
                    totalGaleria: Number(fila.total_galeria),
                    tamanoBytes: Number(fila.tamano_principal || 0) + Number(fila.tamano_galeria || 0)
                })),
                total: total.rows[0].total,
                pagina,
                porPagina
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Totales globales + tiles de proveedor (agrupados por marca, dinamico
    // -- marca es texto libre, no un catalogo fijo de proveedores).
    app.get("/admin/api/banco-imagenes/resumen", async (req, res) => {
        try {
            const totales = await pool.query(`
                SELECT COUNT(*)::int AS total_codigos,
                    COALESCE(SUM(octet_length(imagen_principal)), 0)::bigint AS tamano_principal,
                    COUNT(DISTINCT marca)::int AS total_marcas,
                    MAX(actualizado_at) AS actualizado_reciente
                FROM public.banco_imagenes_producto
            `);

            const galeriaTotales = await pool.query(`
                SELECT COUNT(*)::int AS total_galeria,
                    COALESCE(SUM(octet_length(imagen)), 0)::bigint AS tamano_galeria
                FROM public.banco_imagenes_producto_galeria
            `);

            const porMarca = await pool.query(`
                SELECT COALESCE(b.marca, 'Sin marca') AS marca,
                    COUNT(*)::int AS total_codigos,
                    COUNT(g.id)::int AS total_galeria,
                    MAX(b.actualizado_at) AS actualizado_at
                FROM public.banco_imagenes_producto b
                LEFT JOIN public.banco_imagenes_producto_galeria g ON g.banco_imagen_id = b.id
                GROUP BY COALESCE(b.marca, 'Sin marca')
                ORDER BY total_codigos DESC
            `);

            const t = totales.rows[0];
            const g = galeriaTotales.rows[0];

            res.json({
                ok: true,
                totalCodigos: t.total_codigos,
                totalFotos: t.total_codigos + g.total_galeria,
                totalMarcas: t.total_marcas,
                tamanoTotalBytes: Number(t.tamano_principal) + Number(g.tamano_galeria),
                actualizadoRecienteAt: t.actualizado_reciente,
                marcas: porMarca.rows.map(fila => ({
                    marca: fila.marca,
                    totalCodigos: fila.total_codigos,
                    totalFotos: fila.total_codigos + fila.total_galeria
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Metadata completa de un codigo + conteo de usos + historial reciente
    // -- alimenta el panel de detalle del Admin (pestanas Informacion/Usos/Historial).
    app.get("/admin/api/banco-imagenes/:codigo/detalle", async (req, res) => {
        try {
            const codigo = normalizarCodigoFoto(req.params.codigo);

            const banco = await pool.query(
                `
                SELECT id, codigo, marca, origen, creado_at, actualizado_at,
                    imagen_principal_ancho, imagen_principal_alto, octet_length(imagen_principal) AS tamano_principal
                FROM public.banco_imagenes_producto WHERE codigo = $1
                `,
                [codigo]
            );

            const filaBanco = banco.rows[0];

            if (!filaBanco) {
                res.status(404).json({ ok: false, error: "No hay una imagen en el banco para este codigo." });
                return;
            }

            const galeria = await pool.query(
                `SELECT id, orden, ancho, alto, octet_length(imagen) AS tamano
                 FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1 ORDER BY orden ASC`,
                [filaBanco.id]
            );

            const usos = await pool.query(
                `SELECT COUNT(*)::int AS total FROM public.banco_imagenes_uso WHERE banco_imagen_id = $1`,
                [filaBanco.id]
            );

            const historial = await pool.query(
                `
                SELECT u.created_at, u.galeria_id, n.nombre AS negocio_nombre
                FROM public.banco_imagenes_uso u
                JOIN public.negocios n ON n.id = u.negocio_id
                WHERE u.banco_imagen_id = $1
                ORDER BY u.created_at DESC
                LIMIT 50
                `,
                [filaBanco.id]
            );

            res.json({
                ok: true,
                codigo: filaBanco.codigo,
                marca: filaBanco.marca,
                origen: filaBanco.origen,
                creadoAt: filaBanco.creado_at,
                actualizadoAt: filaBanco.actualizado_at,
                principal: {
                    ancho: filaBanco.imagen_principal_ancho,
                    alto: filaBanco.imagen_principal_alto,
                    tamanoBytes: Number(filaBanco.tamano_principal || 0)
                },
                galeria: galeria.rows.map(fila => ({
                    id: fila.id,
                    ancho: fila.ancho,
                    alto: fila.alto,
                    tamanoBytes: Number(fila.tamano || 0)
                })),
                usos: usos.rows[0].total,
                historial: historial.rows.map(fila => ({
                    fecha: fila.created_at,
                    negocioNombre: fila.negocio_nombre,
                    fotoGaleria: fila.galeria_id != null
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Bytes crudos de una foto de galeria para el panel de detalle de Admin
    // -- mismo chequeo anti-suplantacion que /usar (el id debe pertenecer
    // al banco_imagen_id resuelto desde :codigo).
    app.get("/admin/api/banco-imagenes/:codigo/galeria/:id", async (req, res) => {
        try {
            const codigo = normalizarCodigoFoto(req.params.codigo);
            const id = Number(req.params.id);

            const resultado = await pool.query(
                `
                SELECT g.imagen, g.tipo
                FROM public.banco_imagenes_producto_galeria g
                JOIN public.banco_imagenes_producto b ON b.id = g.banco_imagen_id
                WHERE g.id = $1 AND b.codigo = $2
                `,
                [id, codigo]
            );

            const fila = resultado.rows[0];

            if (!fila) {
                res.status(404).end();
                return;
            }

            res.set("Content-Type", fila.tipo || "image/jpeg");
            res.send(fila.imagen);
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/admin/api/banco-imagenes/:codigo", async (req, res) => {
        try {
            const codigo = normalizarCodigoFoto(req.params.codigo);
            await pool.query(`DELETE FROM public.banco_imagenes_producto WHERE codigo = $1`, [codigo]);
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Solicitudes de fotografia pendientes/resueltas -- lista paginada
    // para la tabla del panel de Admin, con el nombre real del negocio
    // (JOIN en el momento, sin denormalizar en la tabla de solicitudes).
    app.get("/admin/api/banco-imagenes/solicitudes", async (req, res) => {
        try {
            const estado = ["pendiente", "resuelta"].includes(req.query.estado) ? req.query.estado : "pendiente";
            const pagina = Math.max(1, Number(req.query.pagina) || 1);
            const porPagina = 30;
            const offset = (pagina - 1) * porPagina;

            const filas = await pool.query(
                `
                SELECT s.id, s.codigo, s.marca, s.estado, s.created_at, s.resuelta_at,
                    n.id AS negocio_id, n.nombre AS negocio_nombre
                FROM public.banco_imagenes_solicitudes s
                JOIN public.negocios n ON n.id = s.negocio_id
                WHERE s.estado = $1
                ORDER BY s.created_at DESC
                LIMIT $2 OFFSET $3
                `,
                [estado, porPagina, offset]
            );

            const total = await pool.query(
                `SELECT COUNT(*)::int AS total FROM public.banco_imagenes_solicitudes WHERE estado = $1`,
                [estado]
            );

            res.json({
                ok: true,
                items: filas.rows.map(fila => ({
                    id: fila.id,
                    codigo: fila.codigo,
                    marca: fila.marca,
                    estado: fila.estado,
                    createdAt: fila.created_at,
                    resueltaAt: fila.resuelta_at,
                    negocioId: fila.negocio_id,
                    negocioNombre: fila.negocio_nombre
                })),
                total: total.rows[0].total,
                pagina,
                porPagina
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Conteo de pendientes -- alimenta el badge del nav lateral y el pill
    // del encabezado, sin cargar el listado completo.
    app.get("/admin/api/banco-imagenes/solicitudes/conteo", async (req, res) => {
        try {
            const resultado = await pool.query(
                `SELECT COUNT(*)::int AS total FROM public.banco_imagenes_solicitudes WHERE estado = 'pendiente'`
            );
            res.json({ ok: true, pendientes: resultado.rows[0].total });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Descartar una solicitud sin foto (ej. producto descontinuado) -- la
    // resolucion automatica via ZIP sigue siendo el camino normal, esto es
    // solo para limpiar pedidos que nunca se van a poder cumplir.
    app.patch("/admin/api/banco-imagenes/solicitudes/:id/descartar", async (req, res) => {
        try {
            const id = Number(req.params.id);
            const resultado = await pool.query(
                `
                UPDATE public.banco_imagenes_solicitudes
                SET estado = 'resuelta', banco_imagen_id = NULL, resuelta_at = NOW()
                WHERE id = $1 AND estado = 'pendiente'
                RETURNING id
                `,
                [id]
            );
            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Solicitud no encontrada o ya resuelta." });
                return;
            }
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/admin/api/banco-imagenes/:codigo/principal", async (req, res) => {
        try {
            const codigo = normalizarCodigoFoto(req.params.codigo);

            const resultado = await pool.query(
                `SELECT imagen_principal, imagen_principal_tipo FROM public.banco_imagenes_producto WHERE codigo = $1`,
                [codigo]
            );

            const fila = resultado.rows[0];

            if (!fila) {
                res.status(404).end();
                return;
            }

            res.set("Content-Type", fila.imagen_principal_tipo || "image/jpeg");
            res.send(fila.imagen_principal);
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---- Rutas para negocios (Pro-only) ----

    app.get("/banco-imagenes-existe/:codigo", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const permitido = await planPermiteBancoImagenes(pool, negocio.id);

            if (!permitido) {
                res.json({ ok: true, existe: false });
                return;
            }

            const codigo = normalizarCodigoFoto(req.params.codigo);

            const resultado = await pool.query(
                `
                SELECT b.marca, b.actualizado_at, b.imagen_principal_ancho, b.imagen_principal_alto,
                    (SELECT COUNT(*) FROM public.banco_imagenes_producto_galeria g WHERE g.banco_imagen_id = b.id) AS total_galeria
                FROM public.banco_imagenes_producto b
                WHERE b.codigo = $1
                `,
                [codigo]
            );

            const fila = resultado.rows[0];

            if (!fila) {
                res.json({ ok: true, existe: false });
                return;
            }

            const version = new Date(fila.actualizado_at).getTime();
            res.json({
                ok: true,
                existe: true,
                imagenUrl: `/banco-imagenes/${codigo}/principal?v=${version}&token=${firmarTokenBancoImagen(codigo)}`,
                marca: fila.marca,
                ancho: fila.imagen_principal_ancho,
                alto: fila.imagen_principal_alto,
                totalFotos: 1 + Number(fila.total_galeria)
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Registra que un negocio Pro no encontro foto para este codigo y la
    // pidio -- se resuelve sola cuando el admin importe un ZIP que trae
    // ese codigo (ver procesarZipBancoImagenes). El boton siempre se
    // muestra del lado del cliente; el servidor decide el plan aqui,
    // mismo criterio fail-closed que el resto de este modulo.
    app.post("/banco-imagenes/solicitar/:codigo", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const permitido = await planPermiteBancoImagenes(pool, negocio.id);

            if (!permitido) {
                res.status(403).json({ ok: false, error: "Esta funcion esta disponible desde el plan Pro." });
                return;
            }

            const codigo = normalizarCodigoFoto(req.params.codigo);
            if (!codigo) {
                res.status(400).json({ ok: false, error: "Codigo invalido." });
                return;
            }

            const marca = String(req.body?.marca || "").trim() || null;

            const insertado = await pool.query(
                `
                INSERT INTO public.banco_imagenes_solicitudes (codigo, marca, negocio_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (codigo, negocio_id) WHERE estado = 'pendiente' DO NOTHING
                RETURNING id
                `,
                [codigo, marca, negocio.id]
            );

            res.json({ ok: true, creada: insertado.rows.length > 0 });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Datos completos de la galeria para el modal "Ver galeria" -- Pro-gated
    // igual que /banco-imagenes-existe, cada foto lleva su propia URL
    // firmada (mismo truco de firmarTokenBancoImagen que ya usa la
    // principal, aqui firmando el id de la fila de galeria como string).
    app.get("/banco-imagenes/:codigo/galeria", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const permitido = await planPermiteBancoImagenes(pool, negocio.id);

            if (!permitido) {
                res.status(403).json({ ok: false, error: "Esta funcion esta disponible desde el plan Pro." });
                return;
            }

            const codigo = normalizarCodigoFoto(req.params.codigo);

            const banco = await pool.query(
                `SELECT id, marca, imagen_principal_ancho, imagen_principal_alto, actualizado_at
                 FROM public.banco_imagenes_producto WHERE codigo = $1`,
                [codigo]
            );

            const filaBanco = banco.rows[0];

            if (!filaBanco) {
                res.status(404).json({ ok: false, error: "No hay una imagen en el banco para este codigo." });
                return;
            }

            const galeria = await pool.query(
                `SELECT id, orden, ancho, alto FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1 ORDER BY orden ASC`,
                [filaBanco.id]
            );

            const version = new Date(filaBanco.actualizado_at).getTime();

            res.json({
                ok: true,
                marca: filaBanco.marca,
                totalFotos: 1 + galeria.rows.length,
                principal: {
                    ancho: filaBanco.imagen_principal_ancho,
                    alto: filaBanco.imagen_principal_alto,
                    url: `/banco-imagenes/${codigo}/principal?v=${version}&token=${firmarTokenBancoImagen(codigo)}`
                },
                galeria: galeria.rows.map(fila => ({
                    id: fila.id,
                    ancho: fila.ancho,
                    alto: fila.alto,
                    url: `/banco-imagenes-galeria/${fila.id}?token=${firmarTokenBancoImagen(String(fila.id))}`
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Bytes crudos de una foto de galeria del banco -- mismo criterio que
    // /banco-imagenes/:codigo/principal: solo token, sin requerirAccesoNegocio
    // (un <img src> no puede llevar headers).
    app.get("/banco-imagenes-galeria/:id", async (req, res) => {
        try {
            const id = Number(req.params.id);
            const token = String(req.query.token || "");

            if (!Number.isFinite(id) || !verificarTokenBancoImagen(token, String(id))) {
                res.status(401).end();
                return;
            }

            const resultado = await pool.query(
                `SELECT imagen, tipo FROM public.banco_imagenes_producto_galeria WHERE id = $1`,
                [id]
            );

            const fila = resultado.rows[0];

            if (!fila) {
                res.status(404).end();
                return;
            }

            res.set("Content-Type", fila.tipo || "image/jpeg");
            res.set("Cache-Control", "public, max-age=2592000, immutable");
            res.send(fila.imagen);
        } catch (error) {
            responderError(res, error);
        }
    });

    // Sin requerirAccesoNegocio -- un <img src> no puede llevar el header
    // de auth, la firma del token es la unica proteccion aqui, mismo
    // criterio que requerirAccesoNegocioImagen usa para fotos_producto.
    app.get("/banco-imagenes/:codigo/principal", async (req, res) => {
        try {
            const codigo = normalizarCodigoFoto(req.params.codigo);
            const token = String(req.query.token || "");

            if (!verificarTokenBancoImagen(token, codigo)) {
                res.status(401).end();
                return;
            }

            const resultado = await pool.query(
                `SELECT imagen_principal, imagen_principal_tipo FROM public.banco_imagenes_producto WHERE codigo = $1`,
                [codigo]
            );

            const fila = resultado.rows[0];

            if (!fila) {
                res.status(404).end();
                return;
            }

            res.set("Content-Type", fila.imagen_principal_tipo || "image/jpeg");
            res.set("Cache-Control", "public, max-age=2592000, immutable");
            res.send(fila.imagen_principal);
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/banco-imagenes/:codigo/usar", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const permitido = await planPermiteBancoImagenes(pool, negocio.id);

            if (!permitido) {
                res.status(403).json({ ok: false, error: "Esta funcion esta disponible desde el plan Pro." });
                return;
            }

            const codigo = normalizarCodigoFoto(req.params.codigo);
            const galeriaIdSeleccionado = req.body?.galeriaId != null ? Number(req.body.galeriaId) : null;

            const banco = await pool.query(
                `SELECT id, imagen_principal, imagen_principal_tipo FROM public.banco_imagenes_producto WHERE codigo = $1`,
                [codigo]
            );

            const filaBanco = banco.rows[0];

            if (!filaBanco) {
                res.status(404).json({ ok: false, error: "No hay una imagen en el banco para este codigo." });
                return;
            }

            const galeria = await pool.query(
                `SELECT id, imagen, tipo FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1 ORDER BY orden ASC`,
                [filaBanco.id]
            );

            let nuevoPrincipal = { imagen: filaBanco.imagen_principal, tipo: filaBanco.imagen_principal_tipo };
            let filasParaGaleria = galeria.rows;

            // galeriaId opcional (viene de "Ver galeria"): promueve esa foto
            // a principal. Se busca DENTRO de la galeria ya cargada de este
            // mismo banco_imagen_id -- nunca un WHERE id=$1 suelto sobre toda
            // la tabla, para que no se pueda mandar el id de la foto de OTRO
            // producto del banco.
            if (galeriaIdSeleccionado != null) {
                const indice = galeria.rows.findIndex(fila => fila.id === galeriaIdSeleccionado);

                if (indice === -1) {
                    res.status(400).json({ ok: false, error: "La foto elegida ya no esta disponible en el banco." });
                    return;
                }

                const elegida = galeria.rows[indice];
                nuevoPrincipal = { imagen: elegida.imagen, tipo: elegida.tipo };

                filasParaGaleria = [
                    { imagen: filaBanco.imagen_principal, tipo: filaBanco.imagen_principal_tipo },
                    ...galeria.rows.filter((_, i) => i !== indice)
                ];
            }

            const upsert = await pool.query(
                `
                INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (negocio_id, codigo)
                DO UPDATE SET imagen_principal = $3, imagen_principal_tipo = $4, actualizado_at = NOW()
                RETURNING id
                `,
                [negocio.id, codigo, nuevoPrincipal.imagen, nuevoPrincipal.tipo]
            );

            const fotoProductoId = upsert.rows[0].id;

            await pool.query(
                `DELETE FROM public.fotos_producto_galeria WHERE foto_producto_id = $1`,
                [fotoProductoId]
            );

            let orden = 0;
            for (const item of filasParaGaleria) {
                await pool.query(
                    `
                    INSERT INTO public.fotos_producto_galeria (foto_producto_id, orden, imagen, tipo)
                    VALUES ($1, $2, $3, $4)
                    `,
                    [fotoProductoId, orden, item.imagen, item.tipo]
                );

                orden += 1;
            }

            // Log de solo apendizado -- alimenta "Usos (N)" e "Historial"
            // en el panel de detalle de Admin.
            await pool.query(
                `INSERT INTO public.banco_imagenes_uso (banco_imagen_id, negocio_id, galeria_id)
                 VALUES ($1, $2, $3)`,
                [filaBanco.id, negocio.id, galeriaIdSeleccionado]
            );

            res.json({ ok: true, codigo });
        } catch (error) {
            responderError(res, error);
        }
    });
}

// server-modules.js sigue llamando esto directo como funcion
// (require("./banco-imagenes-server")(app, pool, requerirAccesoNegocio)) --
// los helpers se cuelgan como propiedades de esa misma funcion en vez de
// cambiar la forma del export, para no tocar ese call site. Los usa
// public-site-server.js (ficha de producto publica) para mostrar fotos
// reales del Banco de Nexo cuando la tienda no tiene su propia galeria
// para ese codigo -- mismo gate de plan Pro y mismo firmado de token que
// ya usan las rutas de este archivo.
registrarRutasBancoImagenes.normalizarCodigoFoto = normalizarCodigoFoto;
registrarRutasBancoImagenes.planPermiteBancoImagenes = planPermiteBancoImagenes;
registrarRutasBancoImagenes.firmarTokenBancoImagen = firmarTokenBancoImagen;

module.exports = registrarRutasBancoImagenes;

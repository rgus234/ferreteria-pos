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
    return sharp(buffer)
        .resize({ width: anchoMax, withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer();
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
// pesar bastante -- mismo margen de 200MB/30 archivos ya usado por el
// importador por-negocio (server.js, uploadZipsFotosProducto).
const uploadZipsBancoImagenes = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 200 * 1024 * 1024, files: 30 }
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
async function procesarZipBancoImagenes(pool, rutaZip, marca) {
    const resumen = { fotosGuardadas: 0, errores: [] };

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

            const bufferPrincipal = await comprimirImagen(principal.entry.getData(), 320);
            const buffersGaleria = [];

            for (const item of resto) {
                buffersGaleria.push(await comprimirImagen(item.entry.getData(), 480));
            }

            for (const codigo of codigos) {
                const upsert = await pool.query(
                    `
                    INSERT INTO public.banco_imagenes_producto (codigo, marca, imagen_principal, imagen_principal_tipo, actualizado_at)
                    VALUES ($1, $2, $3, 'image/jpeg', NOW())
                    ON CONFLICT (codigo)
                    DO UPDATE SET
                        marca = COALESCE($2, public.banco_imagenes_producto.marca),
                        imagen_principal = $3,
                        imagen_principal_tipo = 'image/jpeg',
                        actualizado_at = NOW()
                    RETURNING id
                    `,
                    [codigo, marca, bufferPrincipal]
                );

                const bancoImagenId = upsert.rows[0].id;

                await pool.query(
                    `DELETE FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1`,
                    [bancoImagenId]
                );

                let orden = 0;
                for (const bufferGaleria of buffersGaleria) {
                    await pool.query(
                        `
                        INSERT INTO public.banco_imagenes_producto_galeria (banco_imagen_id, orden, imagen, tipo)
                        VALUES ($1, $2, $3, 'image/jpeg')
                        `,
                        [bancoImagenId, orden, bufferGaleria]
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

module.exports = (app, pool, requerirAccesoNegocio) => {
    // ---- Rutas de Admin -- protegidas globalmente por validarAdminKey,
    // montado en server.js sobre todo el prefijo /admin/api antes de que
    // cargarModulosPOS() cargue este modulo. ----

    app.post("/admin/api/banco-imagenes/importar-lote", manejarSubidaBancoImagenes, async (req, res) => {
        const archivos = req.files || [];

        try {
            if (archivos.length === 0) {
                res.status(400).json({ ok: false, error: "No se recibio ningun archivo .zip" });
                return;
            }

            const marca = String(req.body?.marca || "").trim() || null;
            const resumen = { zipsProcesados: 0, fotosGuardadas: 0, errores: [] };

            for (const archivo of archivos) {
                const resultadoZip = await procesarZipBancoImagenes(pool, archivo.path, marca);
                resumen.zipsProcesados += 1;
                resumen.fotosGuardadas += resultadoZip.fotosGuardadas;
                if (resultadoZip.errores.length) {
                    resumen.errores.push(`${archivo.originalname}: ${resultadoZip.errores.join("; ")}`);
                }
            }

            res.json({ ok: true, ...resumen });
        } catch (error) {
            responderError(res, error);
        } finally {
            for (const archivo of archivos) {
                fs.unlink(archivo.path, () => {});
            }
        }
    });

    app.get("/admin/api/banco-imagenes", async (req, res) => {
        try {
            const buscar = String(req.query.buscar || "").trim();
            const pagina = Math.max(1, Number(req.query.pagina) || 1);
            const porPagina = 40;
            const offset = (pagina - 1) * porPagina;
            const filtro = buscar ? `%${buscar}%` : null;

            const filas = await pool.query(
                `
                SELECT b.codigo, b.marca, b.origen, b.actualizado_at,
                    (SELECT COUNT(*) FROM public.banco_imagenes_producto_galeria g WHERE g.banco_imagen_id = b.id) AS total_galeria
                FROM public.banco_imagenes_producto b
                WHERE $1::text IS NULL OR b.codigo ILIKE $1 OR b.marca ILIKE $1
                ORDER BY b.actualizado_at DESC
                LIMIT $2 OFFSET $3
                `,
                [filtro, porPagina, offset]
            );

            const total = await pool.query(
                `SELECT COUNT(*)::int AS total FROM public.banco_imagenes_producto b WHERE $1::text IS NULL OR b.codigo ILIKE $1 OR b.marca ILIKE $1`,
                [filtro]
            );

            res.json({
                ok: true,
                items: filas.rows.map(fila => ({
                    codigo: fila.codigo,
                    marca: fila.marca,
                    origen: fila.origen,
                    actualizadoAt: fila.actualizado_at,
                    totalGaleria: Number(fila.total_galeria)
                })),
                total: total.rows[0].total,
                pagina,
                porPagina
            });
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
                `SELECT actualizado_at FROM public.banco_imagenes_producto WHERE codigo = $1`,
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
                imagenUrl: `/banco-imagenes/${codigo}/principal?v=${version}&token=${firmarTokenBancoImagen(codigo)}`
            });
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
                `SELECT imagen, tipo FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1 ORDER BY orden ASC`,
                [filaBanco.id]
            );

            const upsert = await pool.query(
                `
                INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (negocio_id, codigo)
                DO UPDATE SET imagen_principal = $3, imagen_principal_tipo = $4, actualizado_at = NOW()
                RETURNING id
                `,
                [negocio.id, codigo, filaBanco.imagen_principal, filaBanco.imagen_principal_tipo]
            );

            const fotoProductoId = upsert.rows[0].id;

            await pool.query(
                `DELETE FROM public.fotos_producto_galeria WHERE foto_producto_id = $1`,
                [fotoProductoId]
            );

            let orden = 0;
            for (const item of galeria.rows) {
                await pool.query(
                    `
                    INSERT INTO public.fotos_producto_galeria (foto_producto_id, orden, imagen, tipo)
                    VALUES ($1, $2, $3, $4)
                    `,
                    [fotoProductoId, orden, item.imagen, item.tipo]
                );

                orden += 1;
            }

            res.json({ ok: true, codigo });
        } catch (error) {
            responderError(res, error);
        }
    });
};

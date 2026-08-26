const multer = require("multer");
const sharp = require("sharp");
const { responderError } = require("./error-utils");

// Banners de Nexo Market (Fase "Ofertas destacadas", ver plan): promos
// generales del marketplace (ej. "Hasta 50% en herramientas"), creados
// por el equipo de Nexo desde /admin -- no ligados a un negocio. Sin
// disco persistente entre deploys (mismo motivo documentado en
// migrations/20260712_fotos_producto.sql), la imagen se guarda como
// BYTEA. Distinto del banner de "Promocion" por-tienda que ya existe en
// sitio_web_config (public-site-server.js) -- ese es el que cada dueno
// configura para su propia tienda.

const uploadImagenBanner = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 }
});

// Mismo patron que comprimirImagen en banco-imagenes-server.js, pero con
// fit:"cover" en vez de solo limitar el ancho -- el dueno sube cualquier
// foto y el servidor la recorta a una proporcion fija en vez de dejar
// que el cliente tenga que encuadrarla el mismo.
//
// quitarFondo (opcional, nunca automatico): recorta a transparente los
// pixeles casi blancos -- funciona bien en fotos de catalogo de
// producto sobre fondo blanco de estudio (Truper/Hermex etc.), que es
// el caso real de estos banners. No es reconocimiento de objeto real:
// si la foto trae partes blancas o muy claras EN el producto (un cable
// blanco, metal muy brillante), esas partes tambien pueden perforarse.
// Por eso es opt-in por banner (checkbox en /admin), nunca forzado.
const UMBRAL_BLANCO_FONDO = 235;
const ZONA_SUAVE_FONDO = 25;

function recortarFondoBlanco(data, channels) {
    for (let i = 0; i < data.length; i += channels) {
        const minCanal = Math.min(data[i], data[i + 1], data[i + 2]);

        if (minCanal >= UMBRAL_BLANCO_FONDO) {
            data[i + 3] = 0;
        } else if (minCanal >= UMBRAL_BLANCO_FONDO - ZONA_SUAVE_FONDO) {
            const factor = (minCanal - (UMBRAL_BLANCO_FONDO - ZONA_SUAVE_FONDO)) / ZONA_SUAVE_FONDO;
            data[i + 3] = Math.round(data[i + 3] * (1 - factor));
        }
    }

    return data;
}

async function procesarImagenBanner(buffer, quitarFondo) {
    const recortada = sharp(buffer).resize({ width: 1200, height: 500, fit: "cover" });

    if (!quitarFondo) {
        const { data, info } = await recortada.jpeg({ quality: 78 }).toBuffer({ resolveWithObject: true });
        return { buffer: data, ancho: info.width, alto: info.height, mime: "image/jpeg" };
    }

    const { data, info } = await recortada.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const conAlpha = recortarFondoBlanco(data, info.channels);

    const { data: png, info: infoFinal } = await sharp(conAlpha, {
        raw: { width: info.width, height: info.height, channels: info.channels }
    }).png({ quality: 90 }).toBuffer({ resolveWithObject: true });

    return { buffer: png, ancho: infoFinal.width, alto: infoFinal.height, mime: "image/png" };
}

function manejarSubidaImagenBanner(req, res, next) {
    uploadImagenBanner.single("imagen")(req, res, error => {
        if (error) {
            const esMuyPesado = error.code === "LIMIT_FILE_SIZE";
            res.status(400).json({
                ok: false,
                error: esMuyPesado
                    ? "La imagen pesa mas de 8MB. Usa una mas chica e intenta de nuevo."
                    : (error.message || "No se pudo procesar la imagen")
            });
            return;
        }
        next();
    });
}

const TEMAS_COLOR_VALIDOS = ["azul", "negro", "rojo", "verde", "morado", "naranja"];

function normalizarTemaColor(valor) {
    const tema = String(valor || "").trim().toLowerCase();
    return TEMAS_COLOR_VALIDOS.includes(tema) ? tema : "azul";
}

function mapearBanner(fila) {
    return {
        id: fila.id,
        titulo: fila.titulo,
        subtitulo: fila.subtitulo,
        textoBoton: fila.texto_boton,
        enlace: fila.enlace,
        temaColor: fila.tema_color,
        activo: fila.activo,
        orden: fila.orden,
        tieneImagen: fila.tiene_imagen,
        quitarFondo: fila.quitar_fondo,
        actualizadoAt: fila.actualizado_at
    };
}

function registrarRutasBannersMarket(app, pool) {
    // ---- Rutas de Admin -- protegidas globalmente por validarAdminKey,
    // montado en server.js sobre todo el prefijo /admin/api antes de que
    // cargarModulosPOS() cargue este modulo. ----

    app.get("/admin/api/banners-market", async (req, res) => {
        try {
            const filas = await pool.query(
                `SELECT id, titulo, subtitulo, texto_boton, enlace, tema_color, activo, orden, actualizado_at, quitar_fondo,
                        (imagen IS NOT NULL) AS tiene_imagen
                 FROM public.banners_market
                 ORDER BY orden ASC, id ASC`
            );
            res.json({ ok: true, banners: filas.rows.map(mapearBanner) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/admin/api/banners-market", manejarSubidaImagenBanner, async (req, res) => {
        try {
            const titulo = String(req.body?.titulo || "").trim().slice(0, 140);
            if (!titulo) { res.status(400).json({ ok: false, error: "El titulo es obligatorio" }); return; }

            const subtitulo = String(req.body?.subtitulo || "").trim().slice(0, 200);
            const textoBoton = String(req.body?.textoBoton || "").trim().slice(0, 40) || "Ver ofertas";
            const enlace = String(req.body?.enlace || "").trim().slice(0, 300) || "/market";
            const temaColor = normalizarTemaColor(req.body?.temaColor);
            const activo = req.body?.activo !== "false";
            const orden = Number.isFinite(Number(req.body?.orden)) ? Math.trunc(Number(req.body.orden)) : 0;
            const quitarFondo = req.body?.quitarFondo === "true";

            let imagenBuffer = null;
            if (req.file) {
                const procesada = await procesarImagenBanner(req.file.buffer, quitarFondo);
                imagenBuffer = procesada.buffer;
            }

            const insertado = await pool.query(
                `INSERT INTO public.banners_market (titulo, subtitulo, texto_boton, enlace, tema_color, imagen, activo, orden, quitar_fondo, actualizado_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                 RETURNING id`,
                [titulo, subtitulo, textoBoton, enlace, temaColor, imagenBuffer, activo, orden, quitarFondo]
            );

            res.json({ ok: true, id: insertado.rows[0].id });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/admin/api/banners-market/:id", manejarSubidaImagenBanner, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id)) { res.status(400).json({ ok: false, error: "Id invalido" }); return; }

            const existente = await pool.query(`SELECT quitar_fondo, imagen FROM public.banners_market WHERE id = $1`, [id]);
            if (existente.rows.length === 0) { res.status(404).json({ ok: false, error: "Banner no encontrado" }); return; }

            const titulo = String(req.body?.titulo || "").trim().slice(0, 140);
            if (!titulo) { res.status(400).json({ ok: false, error: "El titulo es obligatorio" }); return; }

            const subtitulo = String(req.body?.subtitulo || "").trim().slice(0, 200);
            const textoBoton = String(req.body?.textoBoton || "").trim().slice(0, 40) || "Ver ofertas";
            const enlace = String(req.body?.enlace || "").trim().slice(0, 300) || "/market";
            const temaColor = normalizarTemaColor(req.body?.temaColor);
            const activo = req.body?.activo !== "false";
            const orden = Number.isFinite(Number(req.body?.orden)) ? Math.trunc(Number(req.body.orden)) : 0;
            const quitarFondo = req.body?.quitarFondo === "true";

            let imagenBuffer = null;
            if (req.file) {
                const procesada = await procesarImagenBanner(req.file.buffer, quitarFondo);
                imagenBuffer = procesada.buffer;
            } else if (quitarFondo !== existente.rows[0].quitar_fondo && existente.rows[0].imagen) {
                // Cambio el checkbox pero no subio una foto nueva -- se
                // reprocesa la imagen que ya estaba guardada (recorte a
                // 1200x500 es idempotente) en vez de pedirle al dueno que
                // vuelva a subirla solo para activar/desactivar esto.
                const procesada = await procesarImagenBanner(existente.rows[0].imagen, quitarFondo);
                imagenBuffer = procesada.buffer;
            }

            await pool.query(
                `UPDATE public.banners_market
                 SET titulo = $1, subtitulo = $2, texto_boton = $3, enlace = $4, tema_color = $5,
                     imagen = CASE WHEN $6::bytea IS NOT NULL THEN $6 ELSE imagen END,
                     activo = $7, orden = $8, quitar_fondo = $9, actualizado_at = NOW()
                 WHERE id = $10`,
                [titulo, subtitulo, textoBoton, enlace, temaColor, imagenBuffer, activo, orden, quitarFondo, id]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/admin/api/banners-market/:id", async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id)) { res.status(400).json({ ok: false, error: "Id invalido" }); return; }
            await pool.query(`DELETE FROM public.banners_market WHERE id = $1`, [id]);
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---- Rutas publicas (contenido de marketing, sin token -- mismo
    // criterio que el resto de assets publicos del sitio) ----

    app.get("/market/banners-json", async (req, res) => {
        try {
            const filas = await pool.query(
                `SELECT id, titulo, subtitulo, texto_boton, enlace, tema_color, activo, orden, actualizado_at, quitar_fondo,
                        (imagen IS NOT NULL) AS tiene_imagen
                 FROM public.banners_market
                 WHERE activo = true
                 ORDER BY orden ASC, id ASC`
            );
            res.json({ ok: true, banners: filas.rows.map(mapearBanner) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/banners-market/:id/imagen", async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id)) { res.status(404).end(); return; }

            const resultado = await pool.query(`SELECT imagen, quitar_fondo FROM public.banners_market WHERE id = $1`, [id]);
            const fila = resultado.rows[0];

            if (!fila || !fila.imagen) { res.status(404).end(); return; }

            res.set("Content-Type", fila.quitar_fondo ? "image/png" : "image/jpeg");
            res.send(fila.imagen);
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = registrarRutasBannersMarket;

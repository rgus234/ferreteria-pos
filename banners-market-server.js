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
async function procesarImagenBanner(buffer) {
    const { data, info } = await sharp(buffer)
        .resize({ width: 1200, height: 500, fit: "cover" })
        .jpeg({ quality: 78 })
        .toBuffer({ resolveWithObject: true });

    return { buffer: data, ancho: info.width, alto: info.height };
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
                `SELECT id, titulo, subtitulo, texto_boton, enlace, tema_color, activo, orden, actualizado_at,
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

            let imagenBuffer = null;
            if (req.file) {
                const procesada = await procesarImagenBanner(req.file.buffer);
                imagenBuffer = procesada.buffer;
            }

            const insertado = await pool.query(
                `INSERT INTO public.banners_market (titulo, subtitulo, texto_boton, enlace, tema_color, imagen, activo, orden, actualizado_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 RETURNING id`,
                [titulo, subtitulo, textoBoton, enlace, temaColor, imagenBuffer, activo, orden]
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

            const existente = await pool.query(`SELECT id FROM public.banners_market WHERE id = $1`, [id]);
            if (existente.rows.length === 0) { res.status(404).json({ ok: false, error: "Banner no encontrado" }); return; }

            const titulo = String(req.body?.titulo || "").trim().slice(0, 140);
            if (!titulo) { res.status(400).json({ ok: false, error: "El titulo es obligatorio" }); return; }

            const subtitulo = String(req.body?.subtitulo || "").trim().slice(0, 200);
            const textoBoton = String(req.body?.textoBoton || "").trim().slice(0, 40) || "Ver ofertas";
            const enlace = String(req.body?.enlace || "").trim().slice(0, 300) || "/market";
            const temaColor = normalizarTemaColor(req.body?.temaColor);
            const activo = req.body?.activo !== "false";
            const orden = Number.isFinite(Number(req.body?.orden)) ? Math.trunc(Number(req.body.orden)) : 0;

            let imagenBuffer = null;
            if (req.file) {
                const procesada = await procesarImagenBanner(req.file.buffer);
                imagenBuffer = procesada.buffer;
            }

            await pool.query(
                `UPDATE public.banners_market
                 SET titulo = $1, subtitulo = $2, texto_boton = $3, enlace = $4, tema_color = $5,
                     imagen = CASE WHEN $6::bytea IS NOT NULL THEN $6 ELSE imagen END,
                     activo = $7, orden = $8, actualizado_at = NOW()
                 WHERE id = $9`,
                [titulo, subtitulo, textoBoton, enlace, temaColor, imagenBuffer, activo, orden, id]
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
                `SELECT id, titulo, subtitulo, texto_boton, enlace, tema_color, activo, orden, actualizado_at,
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

            const resultado = await pool.query(`SELECT imagen FROM public.banners_market WHERE id = $1`, [id]);
            const fila = resultado.rows[0];

            if (!fila || !fila.imagen) { res.status(404).end(); return; }

            res.set("Content-Type", "image/jpeg");
            res.send(fila.imagen);
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = registrarRutasBannersMarket;

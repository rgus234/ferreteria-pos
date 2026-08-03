// Sitio web publico por negocio (Fase 1: pagina informativa, sin
// catalogo todavia) -- servido en {slug}.nexoposoficial.com.
//
// A diferencia del resto de modulos de server-modules.js, este archivo
// expone 2 cosas distintas:
//   - registrarRutas(app, pool, requerirAccesoNegocio): las 2 rutas
//     autenticadas de configuracion (GET/PUT /negocio-actual/sitio-web),
//     registradas igual que cualquier otro modulo.
//   - servirSitioNegocio(pool, req, res, slug): llamada directo desde
//     el handler GET / que ya existe en server.js (no se puede mover
//     ahi porque ese mismo handler decide entre landing comercial / POS
//     / sitio de negocio segun el host).

const { funcionDelPlan } = require("./plan-enforcement");

const CLAVE_FUNCION_SITIO_WEB = "sitio_web.pagina";
const TAMANO_MAXIMO_PORTADA = 3 * 1024 * 1024;

function escaparHtml(valor) {
    return String(valor || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizarTelefonoWhatsApp(telefono) {
    const digitos = String(telefono || "").replace(/\D/g, "");
    if (!digitos) return null;
    if (digitos.length === 10) return `52${digitos}`;
    return digitos.length >= 10 ? digitos : null;
}

async function negocioActual(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(
        `SELECT id, slug, nombre FROM public.negocios WHERE id = $1 LIMIT 1`,
        [negocioId]
    );

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

function renderizarPaginaNegocio(datos) {
    const nombre = escaparHtml(datos.nombre);
    const descripcion = escaparHtml(datos.descripcion);
    const direccion = escaparHtml(datos.direccion);
    const telefono = escaparHtml(datos.telefono);
    const horarioTexto = escaparHtml(datos.horarioTexto);
    const color = /^#[0-9a-fA-F]{6}$/.test(datos.color || "") ? datos.color : "#1067e8";
    const urlPublica = `https://${datos.slug}.nexoposoficial.com`;
    const imagenMeta = datos.portada || datos.logo || "";

    const whatsappNumero = normalizarTelefonoWhatsApp(datos.whatsapp);
    const whatsappHtml = whatsappNumero
        ? `<a class="tenant-boton-whatsapp" href="https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, vi ${datos.nombre} en su pagina y quiero mas informacion.`)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>`
        : "";

    const redesHtml = [
        datos.facebook ? `<a href="${escaparHtml(datos.facebook)}" target="_blank" rel="noopener">Facebook</a>` : "",
        datos.instagram ? `<a href="${escaparHtml(datos.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""
    ].filter(Boolean).join("");

    const datosFilas = [
        direccion ? `<div><strong>Direccion</strong><span>${direccion}</span></div>` : "",
        telefono ? `<div><strong>Telefono</strong><span>${telefono}</span></div>` : "",
        horarioTexto ? `<div><strong>Horario</strong><span>${horarioTexto}</span></div>` : ""
    ].filter(Boolean).join("");

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${nombre}</title>
<meta name="description" content="${descripcion || `${nombre} -- informacion, contacto y ubicacion.`}">
<meta property="og:title" content="${nombre}">
<meta property="og:description" content="${descripcion || `${nombre} -- informacion, contacto y ubicacion.`}">
${imagenMeta ? `<meta property="og:image" content="${escaparHtml(imagenMeta)}">` : ""}
<meta property="og:url" content="${urlPublica}">
<meta property="og:type" content="business.business">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>
:root{ --blue:${color}; --blue-dark:${color}; }
.tenant-header{ display:flex; align-items:center; gap:12px; padding:20px clamp(20px,5vw,64px); }
.tenant-header img{ width:44px; height:44px; border-radius:12px; object-fit:cover; }
.tenant-header strong{ font-size:19px; }
.tenant-portada{ margin:0 clamp(20px,5vw,64px); border-radius:20px; height:clamp(160px,30vw,260px); overflow:hidden; background:linear-gradient(135deg, ${color}, var(--ink)); }
.tenant-portada img{ width:100%; height:100%; object-fit:cover; display:block; }
.tenant-main{ max-width:820px; margin:0 auto; padding:32px clamp(20px,5vw,64px) 64px; }
.tenant-main p{ color:var(--muted); font-size:16px; line-height:1.7; }
.tenant-datos{ display:grid; gap:14px; margin:28px 0; padding:20px; border:1px solid var(--line); border-radius:16px; background:var(--glass); }
.tenant-datos div{ display:flex; justify-content:space-between; gap:16px; font-size:14px; }
.tenant-datos strong{ color:var(--ink); }
.tenant-datos span{ color:var(--muted); text-align:right; }
.tenant-acciones{ display:flex; flex-wrap:wrap; gap:12px; margin-top:24px; }
.tenant-boton-whatsapp{ display:inline-flex; align-items:center; padding:12px 22px; border-radius:999px; background:var(--mint); color:#fff; font-weight:700; }
.tenant-redes{ display:flex; gap:16px; margin-top:8px; }
.tenant-redes a{ color:var(--blue); font-weight:600; }
.tenant-footer{ text-align:center; padding:32px; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<header class="tenant-header">
${datos.logo ? `<img src="${escaparHtml(datos.logo)}" alt="Logo ${nombre}">` : ""}
<strong>${nombre}</strong>
</header>
<div class="tenant-portada">${datos.portada ? `<img src="${escaparHtml(datos.portada)}" alt="">` : ""}</div>
<main class="tenant-main">
${descripcion ? `<p>${descripcion}</p>` : ""}
${datosFilas ? `<div class="tenant-datos">${datosFilas}</div>` : ""}
<div class="tenant-acciones">${whatsappHtml}</div>
${redesHtml ? `<div class="tenant-redes">${redesHtml}</div>` : ""}
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo POS</footer>
</body>
</html>`;
}

async function servirSitioNegocio(pool, req, res, slug) {
    try {
        const resultado = await pool.query(
            `
            SELECT
                n.id, n.slug, n.nombre, n.telefono, n.direccion, n.logo, n.color, n.estado,
                c.activo, c.descripcion, c.portada, c.horario_texto, c.whatsapp, c.facebook, c.instagram
            FROM public.negocios n
            LEFT JOIN public.sitio_web_config c ON c.negocio_id = n.id
            WHERE n.slug = $1
            LIMIT 1
            `,
            [slug]
        );

        const fila = resultado.rows[0];

        if (!fila || fila.estado !== "activo" || !fila.activo) {
            res.status(404).send("No encontrado");
            return;
        }

        const acceso = await funcionDelPlan(fila.id, CLAVE_FUNCION_SITIO_WEB);

        if (!acceso.incluido) {
            res.status(404).send("No encontrado");
            return;
        }

        const html = renderizarPaginaNegocio({
            slug: fila.slug,
            nombre: fila.nombre,
            telefono: fila.telefono,
            direccion: fila.direccion,
            logo: fila.logo,
            color: fila.color,
            descripcion: fila.descripcion,
            portada: fila.portada,
            horarioTexto: fila.horario_texto,
            whatsapp: fila.whatsapp,
            facebook: fila.facebook,
            instagram: fila.instagram
        });

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo sitio de negocio:", error.message);
        res.status(500).send("Error");
    }
}

function registrarRutas(app, pool, requerirAccesoNegocio) {
    app.get("/negocio-actual/sitio-web", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);

            const resultado = await pool.query(
                `SELECT activo, descripcion, portada, horario_texto, whatsapp, facebook, instagram FROM public.sitio_web_config WHERE negocio_id = $1`,
                [negocio.id]
            );

            const config = resultado.rows[0] || {
                activo: false, descripcion: "", portada: null,
                horario_texto: "", whatsapp: "", facebook: "", instagram: ""
            };

            res.json({
                ok: true,
                incluido: acceso.incluido,
                slug: negocio.slug,
                urlPublica: `https://${negocio.slug}.nexoposoficial.com`,
                activo: config.activo,
                descripcion: config.descripcion,
                portada: config.portada,
                horarioTexto: config.horario_texto,
                whatsapp: config.whatsapp,
                facebook: config.facebook,
                instagram: config.instagram
            });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    app.put("/negocio-actual/sitio-web", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);

            if (!acceso.incluido) {
                res.status(403).json({
                    ok: false,
                    error: "El sitio web propio esta disponible desde el plan Plus.",
                    requiereUpgrade: true
                });
                return;
            }

            const activo = Boolean(req.body?.activo);
            const descripcion = String(req.body?.descripcion || "").slice(0, 2000);
            const horarioTexto = String(req.body?.horarioTexto || "").slice(0, 500);
            const whatsapp = String(req.body?.whatsapp || "").slice(0, 40);
            const facebook = String(req.body?.facebook || "").slice(0, 300);
            const instagram = String(req.body?.instagram || "").slice(0, 300);

            // "portada" solo viene en el body cuando el usuario de verdad
            // subio/quito una imagen (ver sitio-web-view.js) -- si la clave
            // no viene, se conserva la que ya estaba guardada en vez de
            // borrarla en cada guardado del resto del formulario.
            const tocaPortada = Object.prototype.hasOwnProperty.call(req.body || {}, "portada");
            const portada = tocaPortada
                ? (req.body.portada === null || req.body.portada === "" ? null : String(req.body.portada || ""))
                : null;

            if (tocaPortada && portada && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(portada)) {
                res.status(400).json({ ok: false, error: "La portada debe ser una imagen valida" });
                return;
            }

            if (tocaPortada && portada && portada.length > TAMANO_MAXIMO_PORTADA) {
                res.status(400).json({ ok: false, error: "La portada es demasiado grande. Usa una imagen mas chica." });
                return;
            }

            await pool.query(
                `
                INSERT INTO public.sitio_web_config
                    (negocio_id, activo, descripcion, portada, horario_texto, whatsapp, facebook, instagram, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (negocio_id) DO UPDATE SET
                    activo = $2, descripcion = $3,
                    portada = CASE WHEN $9 THEN $4 ELSE sitio_web_config.portada END,
                    horario_texto = $5, whatsapp = $6, facebook = $7, instagram = $8, updated_at = NOW()
                `,
                [negocio.id, activo, descripcion, portada, horarioTexto, whatsapp, facebook, instagram, tocaPortada]
            );

            res.json({ ok: true });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = { registrarRutas, servirSitioNegocio };

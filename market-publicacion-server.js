// Publicar una tienda en Nexo Market (negocios con la funcion "Vender en Market", vendedor_market).
//
//   GET  /negocio-actual/market-publicacion            estado de la tienda y los requisitos (datos, productos, tienda en linea)
//   POST /negocio-actual/market-publicacion/solicitar   el dueño pide que Nexo revise su tienda
//   GET  /admin/market/revisar                          (enlace del correo, firmado) pagina para aprobar o rechazar
//   POST /admin/market/decidir                          aplica la decision (firmada y con vencimiento)
//
// Estados (negocios.market_estado): NULL = negocio de siempre (no aplica), borrador, en_revision, aprobado, rechazado.
// Una tienda vendedora NO aparece en Market hasta que queda aprobada (la puerta es tiendasPermitidasMarket en market-server.js).
// El enlace del correo pide un clic de confirmacion (formulario POST): los programas que abren los enlaces de los correos no aprueban solos.
const crypto = require("crypto");
const express = require("express");
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { enviarCorreoSolicitudMarket, enviarCorreoDecisionMarket } = require("./email");

const MINIMO_PRODUCTOS = 5;
const VIGENCIA_ENLACE_MS = 7 * 24 * 60 * 60 * 1000;

function secreto() { return process.env.ADMIN_KEY || ""; }

function firmar(negocioId, accion, expira) {
    return crypto.createHmac("sha256", secreto()).update(`${negocioId}.${accion}.${expira}`).digest("hex");
}

function firmaValida(negocioId, accion, expira, firma) {
    if (!secreto() || !firma || Number(expira) < Date.now()) return false;
    const esperada = Buffer.from(firmar(negocioId, accion, expira));
    const recibida = Buffer.from(String(firma));
    return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

const esc = valor => String(valor == null ? "" : valor).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function paginaAdmin(titulo, cuerpo) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#eef2f7;color:#0f172a;margin:0;padding:24px 16px}main{max-width:520px;margin:0 auto;background:#fff;border-radius:18px;padding:26px;box-shadow:0 12px 40px -24px rgba(15,23,42,.4)}h1{font-size:22px;margin:0 0 12px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:14px 0}dt{color:#64748b}dd{margin:0;font-weight:600}button{border:0;border-radius:12px;padding:13px 20px;font-size:16px;font-weight:800;cursor:pointer;color:#fff}.ok{background:#0f766e}.no{background:#b3261e}textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit;margin:8px 0}form{margin-top:14px}</style></head><body><main>${cuerpo}</main></body></html>`;
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    const negocioIdDe = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
    let columnasListas = false;

    async function asegurarColumnas() {
        if (columnasListas) return;
        await pool.query(`ALTER TABLE public.negocios
            ADD COLUMN IF NOT EXISTS market_estado TEXT,
            ADD COLUMN IF NOT EXISTS market_solicitud_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS market_decision_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS market_nota TEXT`);
        columnasListas = true;
    }

    async function leerNegocio(id) {
        await asegurarColumnas();
        const fila = (await pool.query(
            `SELECT id, slug, nombre, telefono, direccion, correo, market_estado, market_nota, funciones_beta
               FROM public.negocios WHERE id = $1`, [id])).rows[0];
        return fila || null;
    }

    const esVendedor = negocio => Boolean(negocio && negocio.funciones_beta && negocio.funciones_beta.vendedor_market === true);

    async function requisitos(negocio) {
        const productos = Number((await pool.query(
            `SELECT COUNT(*)::int AS n FROM public.productos
              WHERE negocio_id = $1 AND visible_market = true AND COALESCE(NULLIF(precio_publico, 0), precio, 0) > 0`,
            [negocio.id])).rows[0].n);

        let tienda = false;
        try { tienda = Boolean((await pool.query(`SELECT activo FROM public.sitio_web_config WHERE negocio_id = $1`, [negocio.id])).rows[0]?.activo); } catch (error) { tienda = false; }

        return {
            datos: Boolean(negocio.nombre && negocio.telefono && negocio.direccion),
            productos: productos >= MINIMO_PRODUCTOS,
            totalProductos: productos,
            minimoProductos: MINIMO_PRODUCTOS,
            tienda
        };
    }

    app.get("/negocio-actual/market-publicacion", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await leerNegocio(negocioIdDe(req));
            if (!negocio) { res.status(404).json({ ok: false, error: "Negocio no encontrado" }); return; }

            if (!esVendedor(negocio)) { res.json({ ok: true, aplica: false }); return; }

            const req2 = await requisitos(negocio);
            const estado = negocio.market_estado || "borrador";

            res.json({
                ok: true, aplica: true, estado, nota: negocio.market_nota || "", slug: negocio.slug,
                requisitos: req2,
                puedeSolicitar: (estado === "borrador" || estado === "rechazado") && req2.datos && req2.productos && req2.tienda
            });
        } catch (error) { responderError(res, error); }
    });

    app.post("/negocio-actual/market-publicacion/solicitar", requerirAccesoNegocio, requerirPermiso(PERMISOS.ADMINISTRAR_USUARIOS), async (req, res) => {
        try {
            const negocio = await leerNegocio(negocioIdDe(req));
            if (!negocio || !esVendedor(negocio)) { res.status(404).json({ ok: false, error: "Esta cuenta no vende en Market." }); return; }

            const estado = negocio.market_estado || "borrador";
            if (estado === "en_revision") { res.json({ ok: true, estado, repetida: true }); return; }
            if (estado === "aprobado") { res.status(409).json({ ok: false, error: "Tu tienda ya esta publicada en Market." }); return; }

            const r = await requisitos(negocio);
            if (!r.datos) { res.status(400).json({ ok: false, error: "Completa el nombre, telefono y direccion de tu tienda." }); return; }
            if (!r.productos) { res.status(400).json({ ok: false, error: `Sube al menos ${MINIMO_PRODUCTOS} productos con precio.` }); return; }
            if (!r.tienda) { res.status(400).json({ ok: false, error: "Prende tu tienda en linea." }); return; }

            await pool.query(`UPDATE public.negocios SET market_estado = 'en_revision', market_solicitud_at = NOW(), market_nota = NULL, updated_at = NOW() WHERE id = $1`, [negocio.id]);

            // Aviso a Nexo con los enlaces firmados para revisar (si no hay llave de administrador, el correo avisa sin enlace).
            const expira = Date.now() + VIGENCIA_ENLACE_MS;
            const enlace = secreto() ? `/admin/market/revisar?n=${negocio.id}&e=${expira}&fa=${firmar(negocio.id, "aprobar", expira)}&fr=${firmar(negocio.id, "rechazar", expira)}` : null;

            enviarCorreoSolicitudMarket({
                nombreNegocio: negocio.nombre, slug: negocio.slug, correoNegocio: negocio.correo, telefono: negocio.telefono,
                direccion: negocio.direccion, totalProductos: r.totalProductos, enlace
            }).catch(error => console.warn("No se pudo avisar la solicitud de Market:", error.message));

            res.json({ ok: true, estado: "en_revision" });
        } catch (error) { responderError(res, error); }
    });

    // ---- Revision de Nexo (enlace del correo) ----
    app.get("/admin/market/revisar", async (req, res) => {
        try {
            const id = Number(req.query.n);
            const expira = Number(req.query.e);

            if (!Number.isInteger(id) || !firmaValida(id, "aprobar", expira, req.query.fa) || !firmaValida(id, "rechazar", expira, req.query.fr)) {
                res.status(403).send(paginaAdmin("Enlace no valido", "<h1>Enlace no valido o vencido</h1><p>Pide la solicitud otra vez desde el panel del vendedor.</p>"));
                return;
            }

            const negocio = await leerNegocio(id);
            if (!negocio) { res.status(404).send(paginaAdmin("No encontrada", "<h1>Tienda no encontrada</h1>")); return; }

            const r = await requisitos(negocio);
            const campos = `<input type="hidden" name="n" value="${id}"><input type="hidden" name="e" value="${expira}">`;

            res.send(paginaAdmin("Revisar tienda", `
                <h1>Revisar tienda para Market</h1>
                <dl><dt>Tienda</dt><dd>${esc(negocio.nombre)}</dd><dt>Dirección</dt><dd>${esc(negocio.direccion || "—")}</dd><dt>Teléfono</dt><dd>${esc(negocio.telefono || "—")}</dd><dt>Correo</dt><dd>${esc(negocio.correo || "—")}</dd><dt>Productos</dt><dd>${r.totalProductos}</dd><dt>Estado</dt><dd>${esc(negocio.market_estado || "borrador")}</dd></dl>
                <p><a href="/market/tienda/${encodeURIComponent(negocio.slug)}" target="_blank" rel="noopener">Ver su tienda en Market</a></p>
                <form method="post" action="/admin/market/decidir">${campos}<input type="hidden" name="accion" value="aprobar"><input type="hidden" name="f" value="${esc(req.query.fa)}"><button class="ok" type="submit">Aprobar y publicar</button></form>
                <form method="post" action="/admin/market/decidir">${campos}<input type="hidden" name="accion" value="rechazar"><input type="hidden" name="f" value="${esc(req.query.fr)}"><label>Motivo (se lo mandamos al dueño)<textarea name="nota" rows="3" maxlength="400" placeholder="Ej. Faltan fotos y precios de tus productos"></textarea></label><button class="no" type="submit">Rechazar</button></form>`));
        } catch (error) { res.status(500).send(paginaAdmin("Error", "<h1>No se pudo abrir la solicitud</h1>")); }
    });

    app.post("/admin/market/decidir", express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
        try {
            const id = Number(req.body.n);
            const accion = req.body.accion === "aprobar" ? "aprobar" : req.body.accion === "rechazar" ? "rechazar" : "";
            const expira = Number(req.body.e);

            if (!Number.isInteger(id) || !accion || !firmaValida(id, accion, expira, req.body.f)) {
                res.status(403).send(paginaAdmin("Enlace no valido", "<h1>Enlace no valido o vencido</h1>"));
                return;
            }

            const negocio = await leerNegocio(id);
            if (!negocio || !esVendedor(negocio)) { res.status(404).send(paginaAdmin("No encontrada", "<h1>Esa tienda ya no vende en Market</h1>")); return; }

            const aprobar = accion === "aprobar";
            const nota = aprobar ? null : String(req.body.nota || "").trim().slice(0, 400) || null;

            await pool.query(
                `UPDATE public.negocios
                    SET market_estado = $2, market_decision_at = NOW(), market_nota = $3, visible_en_market = $4, updated_at = NOW()
                  WHERE id = $1`,
                [id, aprobar ? "aprobado" : "rechazado", nota, aprobar ? true : false]
            );

            if (negocio.correo) {
                enviarCorreoDecisionMarket(negocio.correo, negocio.nombre, { aprobado: aprobar, nota, slug: negocio.slug })
                    .catch(error => console.warn("No se pudo avisar la decision de Market:", error.message));
            }

            res.send(paginaAdmin("Listo", `<h1>${aprobar ? "Tienda aprobada" : "Tienda rechazada"}</h1><p>${esc(negocio.nombre)} ${aprobar ? "ya sale en Market (puede tardar un minuto)." : "no sale en Market. Le avisamos al dueño."}</p>`));
        } catch (error) { res.status(500).send(paginaAdmin("Error", "<h1>No se pudo guardar la decision</h1>")); }
    });
};

module.exports.firmar = firmar;
module.exports.firmaValida = firmaValida;
module.exports.MINIMO_PRODUCTOS = MINIMO_PRODUCTOS;

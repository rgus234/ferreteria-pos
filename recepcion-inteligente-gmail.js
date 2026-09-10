// Recepcion Inteligente, Fase 2: la factura llega sola por Gmail en vez
// de subirse a mano (Fase 1, recepcion-inteligente-server.js). El
// pipeline que interpreta el XML es EXACTAMENTE el mismo de esa fase
// (procesarFacturaXml, reexportado desde ahi) -- este archivo solo se
// encarga de 3 cosas nuevas: conectar un buzon de Gmail via OAuth,
// buscar en el correos con un XML adjunto desde la ultima revision, y
// entregarle cada uno a ese mismo pipeline.
//
// Requiere 2 pasos manuales en Google Cloud Console que ningun codigo
// puede hacer por si solo (ver README de este modulo mas abajo,
// funcion googleGmailConfigurado):
//   1) Habilitar la Gmail API para el proyecto.
//   2) Agregar el scope https://www.googleapis.com/auth/gmail.readonly
//      en OAuth consent screen > Scopes, y agregar como "Test user" la
//      cuenta de Gmail que se vaya a conectar (mientras la app no este
//      verificada por Google -- suficiente para un solo negocio real).
//   3) Registrar config.googleGmailRedirectUri en "Authorized redirect
//      URIs" (URL nueva, NO la misma que ya usa "Continuar con
//      Google" -- ver comentario en config.js).
const crypto = require("crypto");
const { config } = require("./config");
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { procesarFacturaXml } = require("./recepcion-inteligente-server");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPE_GMAIL_LECTURA = "https://www.googleapis.com/auth/gmail.readonly";

// Maximos mensajes por cada "Buscar facturas nuevas": un lote acotado,
// no toda la bandeja de golpe -- si sobran, la siguiente busqueda (el
// cursor ultima_revision_en no avanza hasta terminar el lote completo)
// recoge el resto.
const MAX_MENSAJES_POR_BUSQUEDA = 25;

function googleGmailConfigurado() {
    return Boolean(config.googleClientId && config.googleClientSecret && config.googleGmailRedirectUri);
}

// --- state firmado: negocioId viaja en la URL de ida y vuelta a Google
// sin necesitar cookie ni tabla temporal. HMAC con el mismo secreto que
// ya protege a este servidor frente a Google (googleClientSecret) --
// nunca se expone al cliente, y usarlo aqui no debilita su proposito
// original (Google jamas ve ni valida este state, solo lo hace rebotar
// tal cual). Vencimiento corto (10 min) porque este viaje de ida y
// vuelta es cosa de segundos en uso normal. ------------------------
const VIGENCIA_STATE_MS = 10 * 60 * 1000;

function firmarState(negocioId) {
    const payload = `${negocioId}.${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
    const firma = crypto.createHmac("sha256", config.googleClientSecret).update(payload).digest("hex").slice(0, 32);
    return `${payload}.${firma}`;
}

function verificarState(state) {
    const partes = String(state || "").split(".");
    if (partes.length !== 4) return null;

    const [negocioIdTexto, timestampTexto, nonce, firmaRecibida] = partes;
    const payload = `${negocioIdTexto}.${timestampTexto}.${nonce}`;
    const firmaEsperada = crypto.createHmac("sha256", config.googleClientSecret).update(payload).digest("hex").slice(0, 32);

    const bufferRecibido = Buffer.from(firmaRecibida, "utf8");
    const bufferEsperado = Buffer.from(firmaEsperada, "utf8");
    if (bufferRecibido.length !== bufferEsperado.length || !crypto.timingSafeEqual(bufferRecibido, bufferEsperado)) {
        return null;
    }

    const negocioId = Number(negocioIdTexto);
    const timestamp = Number(timestampTexto);
    if (!Number.isInteger(negocioId) || negocioId <= 0) return null;
    if (!Number.isFinite(timestamp) || Date.now() - timestamp > VIGENCIA_STATE_MS) return null;

    return { negocioId };
}

function construirUrlAutorizacionGmail(state) {
    const parametros = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: config.googleGmailRedirectUri,
        response_type: "code",
        scope: SCOPE_GMAIL_LECTURA,
        state,
        access_type: "offline",
        // Fuerza a Google a regresar un refresh_token SIEMPRE, incluso
        // si esta cuenta ya habia autorizado antes -- sin esto, una
        // reconexion (ej. tras desconectar y volver a conectar) puede
        // quedarse sin refresh_token nuevo y romper la conexion.
        prompt: "consent"
    });
    return `${GOOGLE_AUTH_URL}?${parametros.toString()}`;
}

async function intercambiarCodigoPorTokens(code) {
    const respuesta = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: config.googleClientId,
            client_secret: config.googleClientSecret,
            redirect_uri: config.googleGmailRedirectUri,
            grant_type: "authorization_code"
        })
    });

    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !datos?.access_token) {
        throw new Error(datos?.error_description || datos?.error || "Google no devolvio un token valido");
    }
    return datos;
}

async function refrescarAccessToken(refreshToken) {
    const respuesta = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: config.googleClientId,
            client_secret: config.googleClientSecret,
            grant_type: "refresh_token"
        })
    });

    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !datos?.access_token) {
        const error = new Error(datos?.error_description || datos?.error || "No se pudo renovar el acceso a Gmail");
        error.gmailDesconectado = datos?.error === "invalid_grant";
        throw error;
    }
    return datos.access_token;
}

async function obtenerCorreoConectado(accessToken) {
    const respuesta = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    const perfil = await respuesta.json().catch(() => null);
    return perfil?.email || "";
}

// --- MIME: encontrar los adjuntos que parecen un CFDI -------------
//
// Un XML de factura llega como parte de un mensaje multipart (a veces
// anidado: multipart/mixed > multipart/alternative > ...). Se filtra
// por NOMBRE de archivo (".xml", sin importar mayusculas) antes que por
// mimeType -- muchos sistemas de facturacion mandan el adjunto como
// application/octet-stream generico y solo el nombre delata que es un
// XML. Pura, sin red: testeable con un payload de Gmail armado a mano.
function listarAdjuntosXml(parte, acumulado = []) {
    if (!parte) return acumulado;

    const nombre = parte.filename || "";
    const pareceXml = /\.xml$/i.test(nombre) || parte.mimeType === "text/xml" || parte.mimeType === "application/xml";

    if (pareceXml && (parte.body?.attachmentId || parte.body?.data)) {
        acumulado.push({
            filename: nombre || "factura.xml",
            attachmentId: parte.body.attachmentId || null,
            dataInline: parte.body.data || null
        });
    }

    for (const hija of parte.parts || []) {
        listarAdjuntosXml(hija, acumulado);
    }

    return acumulado;
}

function decodificarBase64Url(data) {
    return Buffer.from(data, "base64url").toString("utf8");
}

// Gmail solo manda el "after:" en dias completos si se usa fecha
// (YYYY/MM/DD) -- para no reprocesar todo el dia de la ultima revision
// una y otra vez, se usa la variante en segundos epoch, que si soporta
// precision de segundo. "has:attachment filename:xml" ya descarta la
// gran mayoria de correos que no traen factura sin gastar cuota de la
// API en mensajes irrelevantes.
function construirQueryBusqueda(ultimaRevisionEn) {
    const segundos = Math.floor(new Date(ultimaRevisionEn).getTime() / 1000);
    return `has:attachment filename:xml after:${segundos}`;
}

async function listarMensajesCandidatos(accessToken, ultimaRevisionEn) {
    const parametros = new URLSearchParams({
        q: construirQueryBusqueda(ultimaRevisionEn),
        maxResults: String(MAX_MENSAJES_POR_BUSQUEDA)
    });
    const respuesta = await fetch(`${GMAIL_API_URL}/messages?${parametros.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok) throw new Error(datos?.error?.message || "No se pudo buscar en Gmail");
    return datos?.messages || [];
}

async function obtenerMensajeCompleto(accessToken, mensajeId) {
    const respuesta = await fetch(`${GMAIL_API_URL}/messages/${mensajeId}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok) throw new Error(datos?.error?.message || "No se pudo leer un mensaje de Gmail");
    return datos;
}

async function obtenerAdjunto(accessToken, mensajeId, attachmentId) {
    const respuesta = await fetch(`${GMAIL_API_URL}/messages/${mensajeId}/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !datos?.data) throw new Error("No se pudo descargar un adjunto de Gmail");
    return datos.data;
}

// Junta MIME-walk + descarga (si hizo falta) + decodificacion. Regresa
// el texto de cada XML adjunto encontrado en el mensaje -- puede ser
// mas de uno (poco comun, pero un correo con 2 facturas adjuntas no
// debe perder la segunda).
async function extraerXmlsDelMensaje(accessToken, mensaje) {
    const adjuntos = listarAdjuntosXml(mensaje.payload);
    const xmls = [];

    for (const adjunto of adjuntos) {
        const data = adjunto.dataInline || await obtenerAdjunto(accessToken, mensaje.id, adjunto.attachmentId);
        xmls.push(decodificarBase64Url(data));
    }

    return xmls;
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    async function negocioIdDeRequest(req) {
        const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
        if (!negocioId) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }
        return negocioId;
    }

    app.get("/recepcion-inteligente/gmail/estado", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = await negocioIdDeRequest(req);
            const fila = await pool.query(
                `SELECT correo_conectado, ultima_revision_en, conectado_en
                   FROM public.recepcion_inteligente_gmail
                  WHERE negocio_id = $1 AND activo = true`,
                [negocioId]
            );

            if (!fila.rows.length) {
                res.json({ ok: true, conectado: false, configurado: googleGmailConfigurado() });
                return;
            }

            res.json({
                ok: true,
                conectado: true,
                correo: fila.rows[0].correo_conectado,
                conectadoEn: fila.rows[0].conectado_en,
                ultimaRevisionEn: fila.rows[0].ultima_revision_en
            });
        } catch (error) {
            if (error.httpStatus) { res.status(error.httpStatus).json({ ok: false, error: error.message }); return; }
            responderError(res, error);
        }
    });

    app.post(
        "/recepcion-inteligente/gmail/iniciar",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                if (!googleGmailConfigurado()) {
                    res.status(503).json({ ok: false, error: "Conectar Gmail no esta configurado todavia en este servidor." });
                    return;
                }
                const negocioId = await negocioIdDeRequest(req);
                const url = construirUrlAutorizacionGmail(firmarState(negocioId));
                res.json({ ok: true, url });
            } catch (error) {
                if (error.httpStatus) { res.status(error.httpStatus).json({ ok: false, error: error.message }); return; }
                responderError(res, error);
            }
        }
    );

    // Sin requerirAccesoNegocio a proposito: esto lo llama Google con
    // una navegacion normal del navegador (redirect de vuelta), nunca
    // trae el header x-dispositivo-token -- la identidad del negocio
    // viaja en el state firmado (ver arriba), no en un header.
    app.get("/recepcion-inteligente/gmail/callback", async (req, res) => {
        const paginaResultado = (titulo, mensaje) => `<!doctype html><html><head><meta charset="utf-8">
            <title>${titulo}</title>
            <style>body{font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;text-align:center;color:#1f2937}
            a{color:#2563eb}</style></head><body><h2>${titulo}</h2><p>${mensaje}</p>
            <p><a href="/">Volver a Nexo</a></p></body></html>`;

        try {
            if (!googleGmailConfigurado()) {
                res.status(503).send(paginaResultado("No disponible", "Conectar Gmail no esta configurado todavia en este servidor."));
                return;
            }

            const { code, state, error: errorGoogle } = req.query;
            if (errorGoogle) {
                res.send(paginaResultado("Conexion cancelada", "No se conecto ningun correo de Gmail."));
                return;
            }

            const stateVerificado = verificarState(state);
            if (!stateVerificado || !code) {
                res.status(400).send(paginaResultado("Enlace invalido o vencido", "Vuelve a intentar conectar Gmail desde Recepcion Inteligente."));
                return;
            }

            const tokens = await intercambiarCodigoPorTokens(code);
            if (!tokens.refresh_token) {
                res.status(400).send(paginaResultado(
                    "No se pudo completar la conexion",
                    "Google no entrego permiso permanente. Si ya habias conectado esta cuenta antes, revocala en myaccount.google.com/permissions e intenta de nuevo."
                ));
                return;
            }

            const correo = await obtenerCorreoConectado(tokens.access_token);

            await pool.query(
                `INSERT INTO public.recepcion_inteligente_gmail (negocio_id, correo_conectado, refresh_token, activo, conectado_en, desconectado_en, ultima_revision_en)
                 VALUES ($1, $2, $3, true, NOW(), NULL, NOW())
                 ON CONFLICT (negocio_id) DO UPDATE
                    SET correo_conectado = EXCLUDED.correo_conectado,
                        refresh_token = EXCLUDED.refresh_token,
                        activo = true,
                        conectado_en = NOW(),
                        desconectado_en = NULL,
                        ultima_revision_en = NOW()`,
                [stateVerificado.negocioId, correo, tokens.refresh_token]
            );

            res.send(paginaResultado("Gmail conectado", `Se conecto ${correo || "tu correo"}. Nexo va a revisar los correos nuevos con factura adjunta cuando toques "Buscar facturas nuevas".`));
        } catch (error) {
            console.error(error);
            res.status(500).send(paginaResultado("Ocurrio un error", "No se pudo completar la conexion con Gmail. Intenta de nuevo."));
        }
    });

    app.post(
        "/recepcion-inteligente/gmail/desconectar",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocioId = await negocioIdDeRequest(req);
                const fila = await pool.query(
                    `SELECT refresh_token FROM public.recepcion_inteligente_gmail WHERE negocio_id = $1 AND activo = true`,
                    [negocioId]
                );

                if (fila.rows.length) {
                    // Revocacion con Google: best-effort, nunca bloquea la
                    // desconexion local si Google no responde.
                    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(fila.rows[0].refresh_token)}`, { method: "POST" }).catch(() => {});
                }

                await pool.query(
                    `UPDATE public.recepcion_inteligente_gmail
                        SET activo = false, refresh_token = '', desconectado_en = NOW()
                      WHERE negocio_id = $1`,
                    [negocioId]
                );

                res.json({ ok: true });
            } catch (error) {
                if (error.httpStatus) { res.status(error.httpStatus).json({ ok: false, error: error.message }); return; }
                responderError(res, error);
            }
        }
    );

    app.post(
        "/recepcion-inteligente/gmail/buscar",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocioId = await negocioIdDeRequest(req);
                const conexion = await pool.query(
                    `SELECT refresh_token, ultima_revision_en FROM public.recepcion_inteligente_gmail WHERE negocio_id = $1 AND activo = true`,
                    [negocioId]
                );

                if (!conexion.rows.length) {
                    res.status(400).json({ ok: false, error: "Todavia no conectas ningun Gmail en Recepcion Inteligente." });
                    return;
                }

                let accessToken;
                try {
                    accessToken = await refrescarAccessToken(conexion.rows[0].refresh_token);
                } catch (error) {
                    if (error.gmailDesconectado) {
                        // La cuenta revoco el permiso desde fuera de Nexo
                        // (myaccount.google.com/permissions) -- se refleja
                        // aqui en vez de seguir fallando en silencio cada
                        // vez que alguien toque "Buscar facturas nuevas".
                        await pool.query(
                            `UPDATE public.recepcion_inteligente_gmail SET activo = false, refresh_token = '', desconectado_en = NOW() WHERE negocio_id = $1`,
                            [negocioId]
                        );
                        res.status(400).json({ ok: false, error: "El acceso a Gmail fue revocado. Vuelve a conectarlo." });
                        return;
                    }
                    throw error;
                }

                const mensajes = await listarMensajesCandidatos(accessToken, conexion.rows[0].ultima_revision_en);

                let nuevas = 0, repetidas = 0, fallidas = 0;
                for (const referencia of mensajes) {
                    try {
                        const mensaje = await obtenerMensajeCompleto(accessToken, referencia.id);
                        const xmls = await extraerXmlsDelMensaje(accessToken, mensaje);

                        for (const xml of xmls) {
                            const resultado = await procesarFacturaXml(pool, negocioId, xml, { origen: "gmail" });
                            if (resultado.repetida) repetidas++; else nuevas++;
                        }

                        if (!xmls.length) fallidas++;
                    } catch (error) {
                        // Un mensaje raro (XML que no es un CFDI, un
                        // adjunto corrupto) no debe tumbar el lote
                        // completo -- se cuenta como fallido y se sigue
                        // con el siguiente mensaje.
                        console.error("Recepcion Inteligente / Gmail: fallo un mensaje", referencia.id, error.message);
                        fallidas++;
                    }
                }

                await pool.query(`UPDATE public.recepcion_inteligente_gmail SET ultima_revision_en = NOW() WHERE negocio_id = $1`, [negocioId]);

                res.json({ ok: true, mensajesRevisados: mensajes.length, nuevas, repetidas, fallidas });
            } catch (error) {
                if (error.httpStatus) { res.status(error.httpStatus).json({ ok: false, error: error.message }); return; }
                responderError(res, error);
            }
        }
    );
};

module.exports.listarAdjuntosXml = listarAdjuntosXml;
module.exports.decodificarBase64Url = decodificarBase64Url;
module.exports.construirQueryBusqueda = construirQueryBusqueda;
module.exports.firmarState = firmarState;
module.exports.verificarState = verificarState;
module.exports.extraerXmlsDelMensaje = extraerXmlsDelMensaje;

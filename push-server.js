// Notificaciones push (Web Push/VAPID) -- dos publicos distintos en la
// misma tabla push_subscriptions: tipo='admin' (dueno/empleados del
// POS, ligado a negocio_id) avisa de pedidos nuevos; tipo='cliente'
// (persona logueada en Nexo Market) avisa de cambios de estado de su
// pedido. Sin RESEND_API_KEY-like: si no hay claves VAPID configuradas,
// las rutas responden que no esta disponible en vez de tronar -- mismo
// criterio "degrada, no truena" que el resto del proyecto.

const webpush = require("web-push");
const { config } = require("./config");
const { crearRequerirSesionPersona } = require("./personas-server");

const VAPID_CONFIGURADO = Boolean(config.vapidPublicKey && config.vapidPrivateKey);

if (VAPID_CONFIGURADO) {
    webpush.setVapidDetails(config.vapidSubject || "mailto:soporte@nexoposoficial.com", config.vapidPublicKey, config.vapidPrivateKey);
}

// Envia a todas las suscripciones que hagan match con el filtro dado
// (negocio_id o persona_id) -- una suscripcion muerta (410/404, el
// navegador la revoco) se borra sola, el resto de errores solo se
// registran para no tumbar el flujo que dispara el push (aceptar
// pedido, marcar listo, etc.).
async function enviarPushAFilas(pool, filas, payload) {
    if (!VAPID_CONFIGURADO || filas.length === 0) return;

    const cuerpo = JSON.stringify(payload);

    await Promise.all(filas.map(async fila => {
        try {
            await webpush.sendNotification(
                { endpoint: fila.endpoint, keys: { p256dh: fila.p256dh, auth: fila.auth } },
                cuerpo
            );
        } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) {
                pool.query(`DELETE FROM public.push_subscriptions WHERE id = $1`, [fila.id]).catch(() => {});
            } else {
                console.warn("No se pudo enviar push:", error.message);
            }
        }
    }));
}

async function enviarPushANegocio(pool, negocioId, payload) {
    if (!VAPID_CONFIGURADO) return;
    const resultado = await pool.query(
        `SELECT id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE tipo = 'admin' AND negocio_id = $1`,
        [negocioId]
    );
    await enviarPushAFilas(pool, resultado.rows, payload);
}

// Igual que enviarPushANegocio pero excluye a los empleados -- para
// avisos de dinero (venta, abono, cargo a credito) que el dueño pidio
// explicitamente que solo el viera. rol IS NULL cubre las
// suscripciones creadas antes de que existiera esta columna (se
// tratan como dueño, no se les deja de avisar).
async function enviarPushADuenoDelNegocio(pool, negocioId, payload) {
    if (!VAPID_CONFIGURADO) return;
    const resultado = await pool.query(
        `SELECT id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE tipo = 'admin' AND negocio_id = $1 AND (rol IS NULL OR rol = 'owner')`,
        [negocioId]
    );
    await enviarPushAFilas(pool, resultado.rows, payload);
}

async function enviarPushAPersona(pool, personaId, payload) {
    if (!VAPID_CONFIGURADO || !personaId) return;
    const resultado = await pool.query(
        `SELECT id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE tipo = 'cliente' AND persona_id = $1`,
        [personaId]
    );
    await enviarPushAFilas(pool, resultado.rows, payload);
}

function negocioIdDesdeRequest(req) {
    return req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id ?? null;
}

// Una sesion de cuenta (rbac.js) trae rol='employee' o NULL (sesion
// clasica de dueño). Una sesion de dispositivo (equipo compartido, sin
// el header x-empleado-id que hoy ningun frontend manda) no distingue
// quien esta sentado ahi -- se trata como dueño, mismo criterio "sin
// restriccion" que ya usa el resto del RBAC para ese caso.
function rolDesdeRequest(req) {
    if (req.negocioAutenticado) {
        return req.negocioAutenticado.rol === "employee" ? "employee" : "owner";
    }
    return "owner";
}

function datosSuscripcionValidos(body) {
    const endpoint = String(body?.endpoint || "").trim();
    const p256dh = String(body?.keys?.p256dh || "").trim();
    const auth = String(body?.keys?.auth || "").trim();
    return endpoint && p256dh && auth ? { endpoint, p256dh, auth } : null;
}

function registrarRutas(app, pool, requerirAccesoNegocio) {
    const requerirSesionPersona = crearRequerirSesionPersona(pool);

    app.get("/push/vapid-public-key", (req, res) => {
        res.json({ ok: VAPID_CONFIGURADO, publicKey: VAPID_CONFIGURADO ? config.vapidPublicKey : null });
    });

    app.post("/negocio-actual/push/suscribir", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDesdeRequest(req);
            if (!negocioId) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }

            const datos = datosSuscripcionValidos(req.body);
            if (!datos) { res.status(400).json({ ok: false, error: "Suscripcion invalida" }); return; }

            const rol = rolDesdeRequest(req);

            await pool.query(
                `INSERT INTO public.push_subscriptions (tipo, negocio_id, rol, endpoint, p256dh, auth, user_agent, ultimo_uso_at)
                 VALUES ('admin', $1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (endpoint) DO UPDATE SET tipo = 'admin', negocio_id = $1, rol = $2, persona_id = NULL, p256dh = $4, auth = $5, user_agent = $6, ultimo_uso_at = NOW()`,
                [negocioId, rol, datos.endpoint, datos.p256dh, datos.auth, String(req.headers["user-agent"] || "").slice(0, 200)]
            );

            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post("/negocio-actual/push/desuscribir", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDesdeRequest(req);
            const endpoint = String(req.body?.endpoint || "").trim();
            if (!endpoint) { res.status(400).json({ ok: false, error: "Endpoint requerido" }); return; }

            await pool.query(`DELETE FROM public.push_subscriptions WHERE endpoint = $1 AND tipo = 'admin' AND negocio_id = $2`, [endpoint, negocioId]);
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post("/personas/push/suscribir", requerirSesionPersona, async (req, res) => {
        try {
            const datos = datosSuscripcionValidos(req.body);
            if (!datos) { res.status(400).json({ ok: false, error: "Suscripcion invalida" }); return; }

            await pool.query(
                `INSERT INTO public.push_subscriptions (tipo, persona_id, endpoint, p256dh, auth, user_agent, ultimo_uso_at)
                 VALUES ('cliente', $1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (endpoint) DO UPDATE SET tipo = 'cliente', persona_id = $1, negocio_id = NULL, p256dh = $3, auth = $4, user_agent = $5, ultimo_uso_at = NOW()`,
                [req.persona.id, datos.endpoint, datos.p256dh, datos.auth, String(req.headers["user-agent"] || "").slice(0, 200)]
            );

            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post("/personas/push/desuscribir", requerirSesionPersona, async (req, res) => {
        try {
            const endpoint = String(req.body?.endpoint || "").trim();
            if (!endpoint) { res.status(400).json({ ok: false, error: "Endpoint requerido" }); return; }

            await pool.query(`DELETE FROM public.push_subscriptions WHERE endpoint = $1 AND tipo = 'cliente' AND persona_id = $2`, [endpoint, req.persona.id]);
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = {
    registrarRutas,
    enviarPushANegocio,
    enviarPushADuenoDelNegocio,
    enviarPushAPersona,
    VAPID_CONFIGURADO
};

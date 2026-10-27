// Escaner remoto: el celular (camara) manda los codigos que lee a la computadora, que los recibe como si vinieran de un lector USB.
//   PC:      POST /escaner-remoto/sesion   -> crea una sesion de emparejamiento (codigo corto + QR para el celular)
//            GET  /escaner-remoto/esperar  -> long-poll: espera hasta ~20 s a que lleguen codigos nuevos
//   Celular: POST /escaner-remoto/unir     -> se une con el codigo de la sesion
//            POST /escaner-remoto/codigo   -> manda un codigo leido
//   Ambos:   POST /escaner-remoto/cerrar
// Todo va por requerirAccesoNegocio y la sesion queda amarrada al negocio: otro negocio no puede unirse ni mandar codigos.
// Las sesiones viven en memoria (son de unas horas y se vuelven a crear con un toque); si el servidor se reinicia, la compu
// vuelve a emparejar solo.
const crypto = require("crypto");
const QRCode = require("qrcode");
const { responderError } = require("./error-utils");

const TTL_INACTIVIDAD_MS = 4 * 60 * 60 * 1000;
const LATIDO_VIVO_MS = 30 * 1000;
const ESPERA_MAXIMA_MS = 25 * 1000;
const MAX_SESIONES_POR_NEGOCIO = 3;
const MAX_CODIGOS_GUARDADOS = 200;
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const sesiones = new Map(); // codigo -> sesion

function nuevoCodigoSesion() {
    for (let intento = 0; intento < 20; intento++) {
        const bytes = crypto.randomBytes(6);
        const codigo = Array.from(bytes, b => ALFABETO[b % ALFABETO.length]).join("");
        if (!sesiones.has(codigo)) return codigo;
    }

    throw new Error("No se pudo generar un codigo de sesion");
}

// Solo letras, numeros y guiones: lo que traen los codigos de barras y de producto.
function limpiarCodigo(texto) {
    return String(texto ?? "").trim().replace(/[^A-Za-z0-9._\-\/]/g, "").slice(0, 64);
}

function limpiarSesiones(ahora = Date.now()) {
    for (const [codigo, s] of sesiones) {
        if (ahora - s.ultimaActividad > TTL_INACTIVIDAD_MS) { avisarEspera(s); sesiones.delete(codigo); }
    }
}

function avisarEspera(s) {
    const pendientes = [...s.esperando];
    s.esperando.clear();
    pendientes.forEach(resolver => resolver());
}

function instalar(app, pool, requerirAccesoNegocio) {
    const limpieza = setInterval(limpiarSesiones, 60 * 1000);
    if (limpieza.unref) limpieza.unref();

    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    function sesionDe(req, res) {
        const id = negocioId(req);
        const codigo = String(req.body?.sesion || req.query?.sesion || "").trim().toUpperCase();
        const s = sesiones.get(codigo);

        if (!s || s.negocioId !== id) { res.status(404).json({ ok: false, error: "Esa sesion no existe o ya se cerro. Genera otro codigo en la computadora." }); return null; }

        s.ultimaActividad = Date.now();
        return s;
    }

    const vivo = marca => Date.now() - marca < LATIDO_VIVO_MS;
    const estado = s => ({ pcConectada: vivo(s.latidoPc), celularConectado: vivo(s.latidoCelular) });

    app.post("/escaner-remoto/sesion", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const propias = [...sesiones.entries()].filter(([, s]) => s.negocioId === id).sort((a, b) => a[1].creada - b[1].creada);

            // Una sesion nueva reemplaza a las mas viejas del mismo negocio (la compu que reinicia no deja basura).
            while (propias.length >= MAX_SESIONES_POR_NEGOCIO) { const [codigo, s] = propias.shift(); avisarEspera(s); sesiones.delete(codigo); }

            const codigo = nuevoCodigoSesion();
            const ahora = Date.now();
            sesiones.set(codigo, { negocioId: id, creada: ahora, ultimaActividad: ahora, latidoPc: ahora, latidoCelular: 0, codigos: [], contador: 0, esperando: new Set() });

            const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
            const base = process.env.PUBLIC_BASE_URL || `${proto}://${req.get("host")}`;
            const urlCelular = `${base.replace(/\/$/, "")}/dueno?escaner=${codigo}`;
            const qr = await QRCode.toDataURL(urlCelular, { margin: 1, width: 300, errorCorrectionLevel: "M" });

            res.status(201).json({ ok: true, sesion: codigo, urlCelular, qr, expiraEnHoras: TTL_INACTIVIDAD_MS / 3600000 });
        } catch (error) {
            responderError(res, error);
        }
    });

    // La compu pregunta "¿llego algo despues de n?"; si no hay nada espera hasta que llegue o se acabe el tiempo.
    app.get("/escaner-remoto/esperar", requerirAccesoNegocio, async (req, res) => {
        try {
            const s = sesionDe(req, res);
            if (!s) return;

            const desde = Number(req.query.desde) || 0;
            const espera = Math.min(Math.max(Number(req.query.ms) || 20000, 0), ESPERA_MAXIMA_MS);
            s.latidoPc = Date.now();

            const nuevos = () => s.codigos.filter(c => c.n > desde);

            if (!nuevos().length && espera > 0) {
                await new Promise(resolve => {
                    const resolver = () => { clearTimeout(temporizador); s.esperando.delete(resolver); resolve(); };
                    const temporizador = setTimeout(resolver, espera);
                    s.esperando.add(resolver);
                    req.on("close", resolver);
                });
            }

            s.latidoPc = Date.now();
            res.json({ ok: true, codigos: nuevos().map(c => ({ n: c.n, codigo: c.codigo })), ultimo: s.contador, ...estado(s) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/escaner-remoto/unir", requerirAccesoNegocio, (req, res) => {
        try {
            const s = sesionDe(req, res);
            if (!s) return;

            s.latidoCelular = Date.now();
            res.json({ ok: true, ...estado(s) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/escaner-remoto/codigo", requerirAccesoNegocio, (req, res) => {
        try {
            const s = sesionDe(req, res);
            if (!s) return;

            const codigo = limpiarCodigo(req.body?.codigo);

            if (codigo.length < 2) { res.status(400).json({ ok: false, error: "Codigo vacio o no valido." }); return; }

            s.latidoCelular = Date.now();
            s.contador += 1;
            s.codigos.push({ n: s.contador, codigo, t: Date.now() });
            if (s.codigos.length > MAX_CODIGOS_GUARDADOS) s.codigos.splice(0, s.codigos.length - MAX_CODIGOS_GUARDADOS);

            avisarEspera(s);
            res.json({ ok: true, n: s.contador, ...estado(s) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/escaner-remoto/cerrar", requerirAccesoNegocio, (req, res) => {
        try {
            const s = sesionDe(req, res);
            if (!s) return;

            avisarEspera(s);
            sesiones.delete(String(req.body?.sesion || "").trim().toUpperCase());
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.limpiarCodigo = limpiarCodigo;
module.exports.nuevoCodigoSesion = nuevoCodigoSesion;

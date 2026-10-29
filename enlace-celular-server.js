// Enlazar el celular con un QR (o un codigo corto) desde la computadora, sin escribir correo ni contraseña en el telefono.
//
//   Computadora (dueño)  POST /enlace-celular/crear        -> QR + codigo corto que vencen a los 2 minutos y sirven UNA sola vez
//                        GET  /enlace-celular/:id/estado   -> "esperando" | "enlazado" | "vencido" (la pantalla lo consulta cada par de segundos)
//                        GET  /enlace-celular/celulares    -> celulares enlazados con este QR
//                        POST /enlace-celular/celulares/:id/quitar -> le quita el acceso a ese celular
//   Celular (sin sesion) POST /enlace-celular/canjear      -> cambia el QR / codigo por una sesion de dueño, como si hubiera iniciado sesion
//
// Seguridad: el QR da acceso a todo el negocio, por eso (1) nunca se guarda en claro (solo su hash), (2) vence en 2 minutos, (3) se puede usar una sola vez
// (el canje es una sola sentencia atomica), (4) el codigo corto tiene limite de intentos por IP y (5) solo el dueño puede crearlos y quitar celulares.
// La tabla se crea sola la primera vez (CREATE TABLE IF NOT EXISTS); si algo falla, nada cambia para nadie.
const crypto = require("crypto");
const QRCode = require("qrcode");
const { responderError } = require("./error-utils");
const { resolverIdentidadNexo } = require("./rbac");

const VIGENCIA_SEGUNDOS = 120;
const ETIQUETA_CELULAR = "Celular enlazado por QR";
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O, I, 0, 1 para no confundir al escribirlo
const INTENTOS_POR_VENTANA = 10;
const VENTANA_MS = 10 * 60 * 1000;

const sha256 = valor => crypto.createHash("sha256").update(String(valor)).digest("hex");
const tokenAleatorio = () => crypto.randomBytes(32).toString("hex");
const codigoCortoAleatorio = () => Array.from(crypto.randomBytes(8), b => ALFABETO[b % ALFABETO.length]).join("");
const normalizarCodigo = texto => String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const formatoCodigo = codigo => codigo.slice(0, 4) + "-" + codigo.slice(4);

// Limite de intentos fallidos por IP (en memoria: basta para frenar adivinar el codigo corto).
const intentos = new Map();
function bloqueada(ip) {
    const ahora = Date.now();
    const lista = (intentos.get(ip) || []).filter(t => ahora - t < VENTANA_MS);
    intentos.set(ip, lista);
    return lista.length >= INTENTOS_POR_VENTANA;
}
function registrarFallo(ip) { intentos.set(ip, [...(intentos.get(ip) || []), Date.now()]); }

let tablaLista = false;
async function asegurarTabla(pool) {
    if (tablaLista) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS public.enlaces_celular (
        id SERIAL PRIMARY KEY,
        negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        codigo_hash TEXT NOT NULL,
        expira_at TIMESTAMPTZ NOT NULL,
        usado_at TIMESTAMPTZ,
        sesion_id INTEGER,
        creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS enlaces_celular_codigo_idx ON public.enlaces_celular (codigo_hash) WHERE usado_at IS NULL`);
    tablaLista = true;
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    async function soloDueno(req, res) {
        const identidad = await resolverIdentidadNexo(req);

        if (!(identidad.rol === "owner" || identidad.permisos === null)) {
            res.status(403).json({ ok: false, error: "Solo el dueño puede enlazar celulares." });
            return false;
        }

        return true;
    }

    function urlBase(req) {
        const protocolo = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
        return `${protocolo}://${req.get("host")}`;
    }

    app.post("/enlace-celular/crear", requerirAccesoNegocio, async (req, res) => {
        try {
            if (!(await soloDueno(req, res))) return;
            await asegurarTabla(pool);

            const id = negocioId(req);
            // Un solo codigo vigente por negocio: al pedir uno nuevo el anterior deja de servir.
            await pool.query(`UPDATE public.enlaces_celular SET expira_at = NOW() WHERE negocio_id = $1 AND usado_at IS NULL AND expira_at > NOW()`, [id]);

            const token = tokenAleatorio();
            const codigo = codigoCortoAleatorio();
            const fila = (await pool.query(
                `INSERT INTO public.enlaces_celular (negocio_id, token_hash, codigo_hash, expira_at) VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval) RETURNING id`,
                [id, sha256(token), sha256(codigo), String(VIGENCIA_SEGUNDOS)]
            )).rows[0];

            const url = `${urlBase(req)}/dueno?enlace=${token}`;
            const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b1b3a", light: "#ffffff" } });

            res.json({ ok: true, id: fila.id, url, codigoCorto: formatoCodigo(codigo), expiraEnSegundos: VIGENCIA_SEGUNDOS, qrSvg });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/enlace-celular/celulares", requerirAccesoNegocio, async (req, res) => {
        try {
            if (!(await soloDueno(req, res))) return;
            const filas = (await pool.query(
                `SELECT id, dispositivo, creado_at, ultimo_uso_at FROM public.sesiones_cuenta
                 WHERE negocio_id = $1 AND revocado_at IS NULL AND dispositivo LIKE $2 ORDER BY creado_at DESC LIMIT 30`,
                [negocioId(req), ETIQUETA_CELULAR + "%"]
            )).rows;

            res.json({ ok: true, celulares: filas.map(f => ({ id: f.id, nombre: String(f.dispositivo).replace(ETIQUETA_CELULAR, "").replace(/^\s*·\s*/, "") || "Celular", enlazadoEn: f.creado_at, ultimoUso: f.ultimo_uso_at })) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/enlace-celular/celulares/:id/quitar", requerirAccesoNegocio, async (req, res) => {
        try {
            if (!(await soloDueno(req, res))) return;
            const r = await pool.query(
                `UPDATE public.sesiones_cuenta SET revocado_at = NOW() WHERE id = $1 AND negocio_id = $2 AND revocado_at IS NULL AND dispositivo LIKE $3`,
                [Number(req.params.id), negocioId(req), ETIQUETA_CELULAR + "%"]
            );

            if (!r.rowCount) { res.status(404).json({ ok: false, error: "Ese celular ya no está enlazado." }); return; }
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/enlace-celular/:id/estado", requerirAccesoNegocio, async (req, res) => {
        try {
            if (!(await soloDueno(req, res))) return;
            await asegurarTabla(pool);

            const fila = (await pool.query(
                `SELECT e.usado_at, e.expira_at, e.expira_at <= NOW() AS vencido, s.dispositivo
                 FROM public.enlaces_celular e LEFT JOIN public.sesiones_cuenta s ON s.id = e.sesion_id
                 WHERE e.id = $1 AND e.negocio_id = $2`,
                [Number(req.params.id), negocioId(req)]
            )).rows[0];

            if (!fila) { res.status(404).json({ ok: false, error: "Ese código no existe." }); return; }

            if (fila.usado_at) {
                res.json({ ok: true, estado: "enlazado", celular: String(fila.dispositivo || "").replace(ETIQUETA_CELULAR, "").replace(/^\s*·\s*/, "") || "Celular" });
                return;
            }

            res.json({ ok: true, estado: fila.vencido ? "vencido" : "esperando", segundosRestantes: Math.max(0, Math.round((new Date(fila.expira_at) - Date.now()) / 1000)) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Publico: el celular todavia no tiene sesion. Ver el limite de intentos y el canje atomico.
    app.post("/enlace-celular/canjear", async (req, res) => {
        try {
            if (bloqueada(req.ip)) { res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos y pide un código nuevo en la computadora." }); return; }

            const token = String(req.body?.token || "").trim();
            const codigo = normalizarCodigo(req.body?.codigo);

            if (!/^[a-f0-9]{64}$/.test(token) && codigo.length !== 8) {
                registrarFallo(req.ip);
                res.status(400).json({ ok: false, error: "Ese código no es válido." });
                return;
            }

            await asegurarTabla(pool);

            // Una sola sentencia: marca el enlace como usado SOLO si sigue vigente y sin usar. Dos celulares al mismo tiempo: gana uno, el otro falla.
            const enlace = (await pool.query(
                token
                    ? `UPDATE public.enlaces_celular SET usado_at = NOW() WHERE token_hash = $1 AND usado_at IS NULL AND expira_at > NOW() RETURNING id, negocio_id`
                    : `UPDATE public.enlaces_celular SET usado_at = NOW() WHERE id = (SELECT id FROM public.enlaces_celular WHERE codigo_hash = $1 AND usado_at IS NULL AND expira_at > NOW() ORDER BY id DESC LIMIT 1) AND usado_at IS NULL RETURNING id, negocio_id`,
                [token ? sha256(token) : sha256(codigo)]
            )).rows[0];

            if (!enlace) {
                registrarFallo(req.ip);
                res.status(400).json({ ok: false, error: "Ese código ya se usó o venció. Pide uno nuevo en la computadora." });
                return;
            }

            const negocio = (await pool.query(`SELECT id, slug, nombre, correo, correo_verificado, giro FROM public.negocios WHERE id = $1`, [enlace.negocio_id])).rows[0];
            const sesionToken = tokenAleatorio();
            const agente = String(req.headers["user-agent"] || "").replace(/\s+/g, " ").slice(0, 80);
            const sesion = (await pool.query(
                `INSERT INTO public.sesiones_cuenta (negocio_id, token_hash, dispositivo, ip) VALUES ($1, $2, $3, $4) RETURNING id`,
                [negocio.id, sha256(sesionToken), `${ETIQUETA_CELULAR} · ${agente || "celular"}`, req.ip]
            )).rows[0];

            await pool.query(`UPDATE public.enlaces_celular SET sesion_id = $2 WHERE id = $1`, [enlace.id, sesion.id]);

            res.json({ ok: true, token: sesionToken, negocio: { slug: negocio.slug, nombre: negocio.nombre, correo: negocio.correo, correoVerificado: negocio.correo_verificado, giro: negocio.giro } });
        } catch (error) {
            responderError(res, error);
        }
    });
};

module.exports.VIGENCIA_SEGUNDOS = VIGENCIA_SEGUNDOS;

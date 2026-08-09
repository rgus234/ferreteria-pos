// Capa de identidad "persona" global, desacoplada de negocios --
// permite una sola cuenta Nexo con selector Comprar/Administrar, sin
// tocar el login existente de negocios (sesiones_cuenta) ni el de
// clientes de credito (sesiones_cliente_credito). Ver plan
// "Nexo -- identidad unificada" para el contexto completo.
const crypto = require("crypto");
const { hashPassword, verificarPassword } = require("./password-utils");
const { responderError } = require("./error-utils");
const { config } = require("./config");
const { OFICIOS_PERSONA } = require("./oficios-persona");

const CLAVES_OFICIO_VALIDAS = new Set(OFICIOS_PERSONA.map(o => o.clave));
const DOMINIO_RAIZ_NEXO = "nexoposoficial.com";
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOMBRE_COOKIE_PERSONA = "nexo_persona_token";

function limpiarTexto(valor, max = 160) {
    return String(valor || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function generarTokenSeguro() {
    return crypto.randomBytes(32).toString("hex");
}

function hashTokenSeguro(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

function crearLimitadorPorIp(maxIntentos, ventanaMs) {
    const registro = new Map();

    return {
        bloqueado(ip) {
            const entrada = registro.get(ip);
            return Boolean(entrada?.bloqueadoHasta && entrada.bloqueadoHasta > Date.now());
        },
        registrarFallo(ip) {
            const entrada = registro.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
            entrada.fallos += 1;

            if (entrada.fallos >= maxIntentos) {
                entrada.bloqueadoHasta = Date.now() + ventanaMs;
            }

            registro.set(ip, entrada);
        },
        registrarExito(ip) {
            registro.delete(ip);
        }
    };
}

const limitadorLoginPersona = crearLimitadorPorIp(8, 15 * 60 * 1000);
const limitadorRegistroPersona = crearLimitadorPorIp(5, 60 * 60 * 1000);

// req.cookies no existe sin cookie-parser -- se evita esa dependencia
// nueva parseando a mano el unico header de cookie que este modulo
// necesita leer.
function parsearCookies(req) {
    const encabezado = req.headers.cookie;
    if (!encabezado) return {};

    const cookies = {};
    for (const parte of encabezado.split(";")) {
        const indice = parte.indexOf("=");
        if (indice === -1) continue;
        const nombre = parte.slice(0, indice).trim();
        const valor = parte.slice(indice + 1).trim();
        if (nombre) cookies[nombre] = decodeURIComponent(valor);
    }
    return cookies;
}

function fijarCookiePersona(res, tokenPlano) {
    res.cookie(NOMBRE_COOKIE_PERSONA, tokenPlano, {
        domain: `.${DOMINIO_RAIZ_NEXO}`,
        httpOnly: true,
        secure: config.isProduction,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 90
    });
}

function tokenDeSesionPersona(req) {
    const cookies = parsearCookies(req);
    return cookies[NOMBRE_COOKIE_PERSONA] || req.headers["x-persona-token"] || null;
}

// Compartido por crearRequerirSesionPersona (obligatorio, 401 si no
// hay sesion) y crearResolverSesionPersonaOpcional (nunca 401) -- una
// sola consulta, un solo lugar que decide que columnas trae una
// persona resuelta por token.
async function buscarPersonaPorToken(pool, token) {
    if (!token) return null;

    const resultado = await pool.query(
        `SELECT p.id, p.nombre, p.correo, p.telefono, p.oficio
         FROM public.sesiones_persona s
         JOIN public.personas p ON p.id = s.persona_id
         WHERE s.token_hash = $1 AND s.revocado_at IS NULL
         LIMIT 1`,
        [hashTokenSeguro(token)]
    );

    if (resultado.rows.length === 0) return null;

    pool.query(
        `UPDATE public.sesiones_persona SET ultimo_uso_at = NOW() WHERE token_hash = $1`,
        [hashTokenSeguro(token)]
    ).catch(() => {});

    return resultado.rows[0];
}

// Reusable desde otros modulos (ej. public-site-server.js para
// /portal-cliente/vincular-persona) -- cada modulo que la necesite
// llama crearRequerirSesionPersona(pool) con su propio pool inyectado,
// mismo criterio de este proyecto de no compartir estado entre
// modulos mas alla de lo que ya se pasa por parametro.
function crearRequerirSesionPersona(pool) {
    return async function requerirSesionPersona(req, res, next) {
        const token = tokenDeSesionPersona(req);

        if (!token) {
            res.status(401).json({ ok: false, error: "Inicia sesion en tu cuenta Nexo" });
            return;
        }

        try {
            const persona = await buscarPersonaPorToken(pool, token);

            if (!persona) {
                res.status(401).json({ ok: false, error: "Sesion invalida, inicia sesion de nuevo" });
                return;
            }

            req.persona = persona;
            next();
        } catch (error) {
            responderError(res, error);
        }
    };
}

// Version "opcional" para superficies que sirven tanto a visitantes
// anonimos como a personas logueadas (ej. Nexo Market) -- nunca
// responde 401, solo deja req.persona en null si no hay sesion
// valida, y sigue al siguiente handler de todas formas.
function crearResolverSesionPersonaOpcional(pool) {
    return async function resolverSesionPersonaOpcional(req, res, next) {
        const token = tokenDeSesionPersona(req);

        try {
            req.persona = token ? await buscarPersonaPorToken(pool, token) : null;
        } catch (error) {
            req.persona = null;
        }

        next();
    };
}

async function mintearSesionPersona(pool, res, personaId, req) {
    const tokenPlano = generarTokenSeguro();
    const dispositivo = limpiarTexto(req.headers["user-agent"], 200) || "Dispositivo desconocido";

    await pool.query(
        `INSERT INTO public.sesiones_persona (persona_id, token_hash, dispositivo, ip) VALUES ($1, $2, $3, $4)`,
        [personaId, hashTokenSeguro(tokenPlano), dispositivo, req.ip]
    );

    fijarCookiePersona(res, tokenPlano);
    return tokenPlano;
}

function registrarRutas(app, pool, requerirAccesoNegocio) {
    const requerirSesionPersona = crearRequerirSesionPersona(pool);

    app.post("/personas/registro", async (req, res) => {
        const nombre = limpiarTexto(req.body?.nombre, 140);
        const correo = limpiarTexto(req.body?.correo, 140).toLowerCase() || null;
        const telefono = limpiarTexto(req.body?.telefono, 20) || null;
        const password = String(req.body?.password || "");
        const oficioBruto = limpiarTexto(req.body?.oficio, 20);
        const oficio = CLAVES_OFICIO_VALIDAS.has(oficioBruto) ? oficioBruto : null;

        if (!nombre || !password || password.length < 8) {
            res.status(400).json({ ok: false, error: "Nombre y una contrasena de al menos 8 caracteres son requeridos" });
            return;
        }

        if (!correo && !telefono) {
            res.status(400).json({ ok: false, error: "Escribe tu correo o tu telefono" });
            return;
        }

        if (correo && !REGEX_CORREO.test(correo)) {
            res.status(400).json({ ok: false, error: "Correo invalido" });
            return;
        }

        if (limitadorRegistroPersona.bloqueado(req.ip)) {
            res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." });
            return;
        }

        try {
            const existente = await pool.query(
                `SELECT id FROM public.personas WHERE (correo IS NOT NULL AND LOWER(correo) = $1) OR (telefono IS NOT NULL AND telefono = $2) LIMIT 1`,
                [correo, telefono]
            );

            if (existente.rows.length > 0) {
                limitadorRegistroPersona.registrarFallo(req.ip);
                res.status(409).json({ ok: false, error: "Ya existe una cuenta Nexo con ese correo o telefono" });
                return;
            }

            const nueva = await pool.query(
                `INSERT INTO public.personas (nombre, correo, telefono, password_hash, oficio) VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, correo, telefono, oficio`,
                [nombre, correo, telefono, hashPassword(password), oficio]
            );

            const persona = nueva.rows[0];
            const token = await mintearSesionPersona(pool, res, persona.id, req);

            res.json({ ok: true, token, persona });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/personas/login", async (req, res) => {
        const identificador = limpiarTexto(req.body?.identificador, 140).toLowerCase();
        const password = String(req.body?.password || "");

        if (!identificador || !password) {
            res.status(400).json({ ok: false, error: "Correo/telefono y contrasena son requeridos" });
            return;
        }

        if (limitadorLoginPersona.bloqueado(req.ip) || limitadorLoginPersona.bloqueado(identificador)) {
            res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." });
            return;
        }

        try {
            const fila = await pool.query(
                `SELECT id, nombre, correo, telefono, password_hash, oficio FROM public.personas WHERE LOWER(correo) = $1 OR telefono = $1 LIMIT 1`,
                [identificador]
            );

            const persona = fila.rows[0] || null;
            const valido = Boolean(persona && verificarPassword(password, persona.password_hash));

            if (!valido) {
                limitadorLoginPersona.registrarFallo(req.ip);
                limitadorLoginPersona.registrarFallo(identificador);
                res.status(401).json({ ok: false, error: "Correo/telefono o contrasena incorrectos" });
                return;
            }

            limitadorLoginPersona.registrarExito(req.ip);
            limitadorLoginPersona.registrarExito(identificador);

            const token = await mintearSesionPersona(pool, res, persona.id, req);

            res.json({
                ok: true,
                token,
                persona: { id: persona.id, nombre: persona.nombre, correo: persona.correo, telefono: persona.telefono, oficio: persona.oficio }
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/personas/logout", requerirSesionPersona, async (req, res) => {
        try {
            const token = tokenDeSesionPersona(req);

            await pool.query(
                `UPDATE public.sesiones_persona SET revocado_at = NOW() WHERE token_hash = $1`,
                [hashTokenSeguro(token)]
            );

            res.clearCookie(NOMBRE_COOKIE_PERSONA, { domain: `.${DOMINIO_RAIZ_NEXO}` });
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/personas/estado", requerirSesionPersona, (req, res) => {
        res.json({ ok: true, persona: req.persona });
    });

    // Lado "Administrar": negocios donde esta persona ya es el dueño
    // vinculado (negocios.persona_id), mas el endpoint que le permite
    // "entrar" a uno vinculado sin re-escribir su contrasena.
    app.get("/personas/negocios", requerirSesionPersona, async (req, res) => {
        try {
            const resultado = await pool.query(
                `SELECT id, slug, nombre FROM public.negocios WHERE persona_id = $1 ORDER BY nombre`,
                [req.persona.id]
            );
            res.json({ ok: true, negocios: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/personas/negocios/:negocioId/entrar", requerirSesionPersona, async (req, res) => {
        try {
            const negocio = await pool.query(
                `SELECT id, slug, nombre FROM public.negocios WHERE id = $1 AND persona_id = $2 LIMIT 1`,
                [req.params.negocioId, req.persona.id]
            );

            if (negocio.rows.length === 0) {
                res.status(404).json({ ok: false, error: "No administras ese negocio" });
                return;
            }

            const fila = negocio.rows[0];
            const tokenPlano = generarTokenSeguro();
            const dispositivo = limpiarTexto(req.headers["user-agent"], 200) || "Dispositivo desconocido";

            await pool.query(
                `INSERT INTO public.sesiones_cuenta (negocio_id, token_hash, dispositivo, ip) VALUES ($1, $2, $3, $4)`,
                [fila.id, hashTokenSeguro(tokenPlano), dispositivo, req.ip]
            );

            res.json({ ok: true, token: tokenPlano, negocio: { slug: fila.slug, nombre: fila.nombre } });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/personas/oficio", requerirSesionPersona, async (req, res) => {
        const oficioBruto = limpiarTexto(req.body?.oficio, 20);
        const oficio = oficioBruto ? oficioBruto : null;

        if (oficio && !CLAVES_OFICIO_VALIDAS.has(oficio)) {
            res.status(400).json({ ok: false, error: "Oficio invalido" });
            return;
        }

        try {
            const resultado = await pool.query(
                `UPDATE public.personas SET oficio = $1 WHERE id = $2 RETURNING oficio`,
                [oficio, req.persona.id]
            );

            res.json({ ok: true, oficio: resultado.rows[0].oficio });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Cambio de contrasena de autoservicio -- a diferencia de
    // vincular-persona (que cruza dos sesiones ya probadas), aqui solo
    // hay una sesion, por eso si se repite la contrasena actual.
    app.patch("/personas/password", requerirSesionPersona, async (req, res) => {
        const passwordActual = String(req.body?.passwordActual || "");
        const passwordNueva = String(req.body?.passwordNueva || "");

        if (!passwordNueva || passwordNueva.length < 8) {
            res.status(400).json({ ok: false, error: "La nueva contrasena debe tener al menos 8 caracteres" });
            return;
        }

        try {
            const fila = await pool.query(`SELECT password_hash FROM public.personas WHERE id = $1`, [req.persona.id]);

            if (!verificarPassword(passwordActual, fila.rows[0]?.password_hash)) {
                res.status(401).json({ ok: false, error: "Tu contrasena actual no es correcta" });
                return;
            }

            await pool.query(`UPDATE public.personas SET password_hash = $1 WHERE id = $2`, [hashPassword(passwordNueva), req.persona.id]);

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Vincular el negocio con el que ya se inicio sesion (requerirAccesoNegocio,
    // sesion real de dueño) a la persona ya logueada -- ambos lados ya
    // probaron su identidad por separado, no se pide contrasena de nuevo.
    app.post("/negocio-actual/vincular-persona", requerirAccesoNegocio, requerirSesionPersona, async (req, res) => {
        try {
            const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

            const actual = await pool.query(`SELECT persona_id FROM public.negocios WHERE id = $1`, [negocioId]);

            if (actual.rows[0]?.persona_id) {
                res.status(409).json({ ok: false, error: "Este negocio ya esta vinculado a una cuenta Nexo" });
                return;
            }

            await pool.query(`UPDATE public.negocios SET persona_id = $1 WHERE id = $2`, [req.persona.id, negocioId]);

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = { registrarRutas, crearRequerirSesionPersona, crearResolverSesionPersonaOpcional };

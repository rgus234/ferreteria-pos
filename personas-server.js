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
const { enviarCorreoRecuperacion, enviarCorreoVerificacionPersona } = require("./email");

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

function generarCodigoNumerico() {
    return String(crypto.randomInt(100000, 1000000));
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
const limitadorOlvidePasswordPersona = crearLimitadorPorIp(5, 60 * 60 * 1000);
const limitadorVerificarCodigoPersona = crearLimitadorPorIp(8, 15 * 60 * 1000);
const limitadorReenviarVerificacionPersona = crearLimitadorPorIp(5, 60 * 60 * 1000);

// Mismo criterio que server.js:urlBase -- APP_BASE_URL manda siempre
// para que los enlaces de correo usen el dominio propio.
function urlBasePersona(req) {
    return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

// Mismo patron exacto que crearVerificacionCorreo de server.js
// (negocios), adaptado a verificaciones_correo_persona.
async function crearVerificacionCorreoPersona(pool, personaId, correo) {
    const tokenPlano = generarTokenSeguro();

    await pool.query(
        `INSERT INTO public.verificaciones_correo_persona (persona_id, correo, token_hash, expira_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
        [personaId, correo, hashTokenSeguro(tokenPlano)]
    );

    return tokenPlano;
}

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
        `SELECT p.id, p.nombre, p.correo, p.telefono, p.oficio, p.correo_verificado
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

    const fila = resultado.rows[0];

    return {
        id: fila.id,
        nombre: fila.nombre,
        correo: fila.correo,
        telefono: fila.telefono,
        oficio: fila.oficio,
        correoVerificado: fila.correo_verificado
    };
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

// Lista los negocios que administra una persona (negocios.persona_id) --
// misma consulta que ya usa GET /personas/negocios abajo, expuesta como
// funcion para que market-cuenta-server.js pueda decidir server-side si
// una persona es puramente administradora sin pasar por HTTP.
async function listarNegociosAdministrados(pool, personaId) {
    const resultado = await pool.query(
        `SELECT id, slug, nombre FROM public.negocios WHERE persona_id = $1 ORDER BY nombre`,
        [personaId]
    );
    return resultado.rows;
}

// Mintea una sesion de negocio real (mismo INSERT que usa el login
// normal de dueño) para una persona que ya administra ese negocio, sin
// pedirle contrasena de nuevo -- ambos ya probaron su identidad por
// separado. Regresa null si esa persona no administra ese negocio
// (nunca mintea para un negocio ajeno). Reusado tanto por la ruta
// POST /personas/negocios/:negocioId/entrar (boton manual) como por el
// auto-redirect de cuentas puramente administradoras en
// market-cuenta-server.js.
async function mintearSesionParaNegocioDePersona(pool, personaId, negocioId, req) {
    const negocio = await pool.query(
        `SELECT id, slug, nombre FROM public.negocios WHERE id = $1 AND persona_id = $2 LIMIT 1`,
        [negocioId, personaId]
    );

    if (negocio.rows.length === 0) return null;

    const fila = negocio.rows[0];
    const tokenPlano = generarTokenSeguro();
    const dispositivo = limpiarTexto(req.headers["user-agent"], 200) || "Dispositivo desconocido";

    await pool.query(
        `INSERT INTO public.sesiones_cuenta (negocio_id, token_hash, dispositivo, ip) VALUES ($1, $2, $3, $4)`,
        [fila.id, hashTokenSeguro(tokenPlano), dispositivo, req.ip]
    );

    return { token: tokenPlano, negocio: { id: fila.id, slug: fila.slug, nombre: fila.nombre } };
}

// Fase 1 del ecosistema Nexo: mismo espiritu que listarNegociosAdministrados,
// pero mirando negocio_miembros (rol='employee') en vez de
// negocios.persona_id -- para que /dueno pueda ofrecer un login de
// empleado que resuelva a que negocio(s) entrar.
async function listarNegociosDeEmpleado(pool, personaId) {
    const resultado = await pool.query(
        `
        SELECT n.id, n.slug, n.nombre
        FROM public.negocio_miembros m
        JOIN public.negocios n ON n.id = m.negocio_id
        WHERE m.persona_id = $1 AND m.rol = 'employee' AND m.activo = true
        ORDER BY n.nombre
        `,
        [personaId]
    );
    return resultado.rows;
}

// Variante de mintearSesionParaNegocioDePersona para empleados: en vez
// de filtrar por negocios.persona_id (dueño), verifica la membresia en
// negocio_miembros. Mismo INSERT/formato de token que la sesion de
// dueño, solo que ahora con persona_id+rol puestos para que rbac.js
// pueda resolver permisos reales en vez de acceso total.
async function mintearSesionEmpleadoDePersona(pool, personaId, negocioId, req) {
    const miembro = await pool.query(
        `
        SELECT n.id, n.slug, n.nombre
        FROM public.negocio_miembros m
        JOIN public.negocios n ON n.id = m.negocio_id
        WHERE m.negocio_id = $1 AND m.persona_id = $2 AND m.rol = 'employee' AND m.activo = true
        LIMIT 1
        `,
        [negocioId, personaId]
    );

    if (miembro.rows.length === 0) return null;

    const fila = miembro.rows[0];
    const tokenPlano = generarTokenSeguro();
    const dispositivo = limpiarTexto(req.headers["user-agent"], 200) || "Dispositivo desconocido";

    await pool.query(
        `INSERT INTO public.sesiones_cuenta (negocio_id, token_hash, dispositivo, ip, persona_id, rol) VALUES ($1, $2, $3, $4, $5, 'employee')`,
        [fila.id, hashTokenSeguro(tokenPlano), dispositivo, req.ip, personaId]
    );

    return { token: tokenPlano, negocio: { id: fila.id, slug: fila.slug, nombre: fila.nombre } };
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

            if (correo) {
                const tokenVerificacion = await crearVerificacionCorreoPersona(pool, persona.id, correo);
                const enlace = `${urlBasePersona(req)}/personas/verificar-correo/${tokenVerificacion}`;
                enviarCorreoVerificacionPersona(correo, nombre, enlace).catch(() => {});
            }

            res.json({ ok: true, token, persona, requiereVerificacionCorreo: Boolean(correo) });
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
                `SELECT id, nombre, correo, telefono, password_hash, oficio, correo_verificado FROM public.personas WHERE LOWER(correo) = $1 OR telefono = $1 LIMIT 1`,
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

            if (persona.correo && !persona.correo_verificado) {
                // Contrasena correcta pero correo sin verificar -- no
                // cuenta como fallo (son credenciales validas), pero
                // tampoco se crea sesion. Cuentas de solo-telefono
                // (persona.correo === null) nunca entran aqui.
                res.status(403).json({
                    ok: false,
                    error: "Verifica tu correo antes de iniciar sesion. Revisa tu bandeja de entrada o pide que te reenviemos el correo.",
                    correoSinVerificar: true
                });
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

    // Se abre desde el enlace del correo (fuera del wizard), asi que
    // responde una pagina HTML sencilla en vez de JSON -- mismo patron
    // que paginaCorreoHtml de server.js (negocios).
    function paginaCorreoPersonaHtml(titulo, mensaje, exito) {
        return `
        <!doctype html>
        <html lang="es">
        <head>
            <meta charset="utf-8">
            <title>${titulo} -- Nexo</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
            <div style="max-width:420px;margin:24px;background:#fff;border-radius:16px;padding:32px;text-align:center;border:1px solid #e4e7ec;">
                <div style="width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px;background:${exito ? "#dcfce7" : "#fee2e2"};color:${exito ? "#16a34a" : "#dc2626"};">${exito ? "OK" : "!"}</div>
                <h1 style="font-size:20px;margin:0 0 8px;color:#101828;">${titulo}</h1>
                <p style="color:#667085;font-size:14px;line-height:1.5;margin:0;">${mensaje}</p>
            </div>
        </body>
        </html>
        `;
    }

    app.get("/personas/verificar-correo/:token", async (req, res) => {
        try {
            const tokenHash = hashTokenSeguro(req.params.token);

            const fila = await pool.query(
                `
                SELECT v.id, v.persona_id, v.correo
                FROM public.verificaciones_correo_persona v
                WHERE v.token_hash = $1 AND v.usado_at IS NULL AND v.expira_at > NOW()
                LIMIT 1
                `,
                [tokenHash]
            );

            if (fila.rows.length === 0) {
                res.status(400).send(paginaCorreoPersonaHtml(
                    "Enlace invalido o vencido",
                    "Pide que te reenvien el correo de verificacion e intenta de nuevo.",
                    false
                ));
                return;
            }

            const verificacion = fila.rows[0];

            await pool.query(
                `UPDATE public.personas SET correo_verificado = true WHERE id = $1`,
                [verificacion.persona_id]
            );

            await pool.query(
                `UPDATE public.verificaciones_correo_persona SET usado_at = NOW() WHERE id = $1`,
                [verificacion.id]
            );

            res.send(paginaCorreoPersonaHtml(
                "Correo verificado",
                "Tu correo quedo confirmado. Ya puedes cerrar esta ventana e iniciar sesion en Nexo.",
                true
            ));
        } catch (error) {
            console.error(error);
            res.status(500).send(paginaCorreoPersonaHtml("No se pudo verificar", "Ocurrio un error inesperado. Intenta de nuevo o pide un nuevo enlace.", false));
        }
    });

    // Publica (sin sesion) a proposito, mismo patron que
    // /cuenta/reenviar-verificacion (negocios) -- cubre tanto "acabo de
    // registrarme" (con sesion) como "intente loguear y me bloquearon
    // por correo sin verificar" (sin sesion todavia). Respuesta
    // identica exista o no la cuenta / ya este verificada, para no
    // revelar que correos estan registrados.
    app.post("/personas/reenviar-verificacion", async (req, res) => {
        const correo = limpiarTexto(req.body?.correo, 140).toLowerCase();

        if (!correo || !REGEX_CORREO.test(correo)) {
            res.status(400).json({ ok: false, error: "Escribe un correo valido" });
            return;
        }

        if (limitadorReenviarVerificacionPersona.bloqueado(req.ip)) {
            res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo mas tarde." });
            return;
        }

        limitadorReenviarVerificacionPersona.registrarFallo(req.ip);

        try {
            const persona = await pool.query(
                `SELECT id, nombre, correo_verificado FROM public.personas WHERE LOWER(correo) = $1 LIMIT 1`,
                [correo]
            );

            if (persona.rows.length === 0 || persona.rows[0].correo_verificado) {
                res.json({ ok: true });
                return;
            }

            const tokenVerificacion = await crearVerificacionCorreoPersona(pool, persona.rows[0].id, correo);
            const enlace = `${urlBasePersona(req)}/personas/verificar-correo/${tokenVerificacion}`;

            await enviarCorreoVerificacionPersona(correo, persona.rows[0].nombre, enlace);

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Cambiar correo antes de verificar (pantalla "Verifica tu correo"
    // del wizard) -- requiere sesion porque cambia un dato sensible de
    // la cuenta ya autenticada (a diferencia de reenviar-verificacion,
    // que es publico). Reinicia la verificacion con el correo nuevo.
    app.patch("/personas/correo", requerirSesionPersona, async (req, res) => {
        const correo = limpiarTexto(req.body?.correo, 140).toLowerCase();

        if (!correo || !REGEX_CORREO.test(correo)) {
            res.status(400).json({ ok: false, error: "Correo invalido" });
            return;
        }

        try {
            const existente = await pool.query(
                `SELECT id FROM public.personas WHERE LOWER(correo) = $1 AND id != $2 LIMIT 1`,
                [correo, req.persona.id]
            );

            if (existente.rows.length > 0) {
                res.status(409).json({ ok: false, error: "Ya existe una cuenta Nexo con ese correo" });
                return;
            }

            await pool.query(
                `UPDATE public.personas SET correo = $1, correo_verificado = false WHERE id = $2`,
                [correo, req.persona.id]
            );

            const tokenVerificacion = await crearVerificacionCorreoPersona(pool, req.persona.id, correo);
            const enlace = `${urlBasePersona(req)}/personas/verificar-correo/${tokenVerificacion}`;

            enviarCorreoVerificacionPersona(correo, req.persona.nombre, enlace).catch(() => {});

            res.json({ ok: true, correo });
        } catch (error) {
            responderError(res, error);
        }
    });

    // "Olvide mi contrasena" para personas -- mismo diseno exacto que
    // /cuenta/olvide-password (dueños de negocio), solo que ligado a
    // personas/restablecimientos_password_persona/sesiones_persona.
    app.post("/personas/olvide-password", async (req, res) => {
        const correo = limpiarTexto(req.body?.correo, 140).toLowerCase();

        if (!correo || !REGEX_CORREO.test(correo)) {
            res.status(400).json({ ok: false, error: "Escribe un correo valido" });
            return;
        }

        if (limitadorOlvidePasswordPersona.bloqueado(req.ip) || limitadorOlvidePasswordPersona.bloqueado(correo)) {
            res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo mas tarde." });
            return;
        }

        limitadorOlvidePasswordPersona.registrarFallo(req.ip);
        limitadorOlvidePasswordPersona.registrarFallo(correo);

        try {
            const persona = await pool.query(
                "SELECT id, nombre FROM public.personas WHERE LOWER(correo) = $1 LIMIT 1",
                [correo]
            );

            // Respuesta identica exista o no la cuenta, para no revelar
            // que correos estan registrados.
            if (persona.rows.length === 0) {
                res.json({ ok: true });
                return;
            }

            const codigo = generarCodigoNumerico();

            await pool.query(
                `INSERT INTO public.restablecimientos_password_persona (persona_id, codigo_hash, expira_at)
                 VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
                [persona.rows[0].id, hashTokenSeguro(codigo)]
            );

            await enviarCorreoRecuperacion(correo, persona.rows[0].nombre, codigo);

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/personas/verificar-codigo-reset", async (req, res) => {
        const correo = limpiarTexto(req.body?.correo, 140).toLowerCase();
        const codigo = limpiarTexto(req.body?.codigo, 10);

        if (!correo || !codigo) {
            res.status(400).json({ ok: false, error: "Correo y codigo son requeridos" });
            return;
        }

        if (limitadorVerificarCodigoPersona.bloqueado(req.ip) || limitadorVerificarCodigoPersona.bloqueado(correo)) {
            res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." });
            return;
        }

        try {
            const persona = await pool.query(
                "SELECT id FROM public.personas WHERE LOWER(correo) = $1 LIMIT 1",
                [correo]
            );

            if (persona.rows.length === 0) {
                limitadorVerificarCodigoPersona.registrarFallo(req.ip);
                limitadorVerificarCodigoPersona.registrarFallo(correo);
                res.status(400).json({ ok: false, error: "Codigo invalido o vencido" });
                return;
            }

            const fila = await pool.query(
                `
                SELECT id, codigo_hash, intentos
                FROM public.restablecimientos_password_persona
                WHERE persona_id = $1 AND usado_at IS NULL AND expira_at > NOW()
                ORDER BY creado_at DESC
                LIMIT 1
                `,
                [persona.rows[0].id]
            );

            if (fila.rows.length === 0) {
                limitadorVerificarCodigoPersona.registrarFallo(req.ip);
                limitadorVerificarCodigoPersona.registrarFallo(correo);
                res.status(400).json({ ok: false, error: "Codigo invalido o vencido" });
                return;
            }

            const solicitud = fila.rows[0];

            if (solicitud.intentos >= 5) {
                res.status(429).json({ ok: false, error: "Demasiados intentos. Solicita un codigo nuevo." });
                return;
            }

            if (hashTokenSeguro(codigo) !== solicitud.codigo_hash) {
                await pool.query(
                    `UPDATE public.restablecimientos_password_persona SET intentos = intentos + 1 WHERE id = $1`,
                    [solicitud.id]
                );
                limitadorVerificarCodigoPersona.registrarFallo(req.ip);
                limitadorVerificarCodigoPersona.registrarFallo(correo);
                res.status(400).json({ ok: false, error: "Codigo invalido o vencido" });
                return;
            }

            limitadorVerificarCodigoPersona.registrarExito(req.ip);
            limitadorVerificarCodigoPersona.registrarExito(correo);

            const tokenPlano = generarTokenSeguro();

            await pool.query(
                `UPDATE public.restablecimientos_password_persona SET codigo_hash = $1 WHERE id = $2`,
                [hashTokenSeguro(tokenPlano), solicitud.id]
            );

            res.json({ ok: true, tokenRestablecimiento: tokenPlano });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/personas/restablecer-password", async (req, res) => {
        const tokenRestablecimiento = limpiarTexto(req.body?.tokenRestablecimiento, 200);
        const password = String(req.body?.password || "");
        const confirmarPassword = String(req.body?.confirmarPassword || "");

        if (!tokenRestablecimiento) {
            res.status(400).json({ ok: false, error: "Solicitud invalida" });
            return;
        }

        if (password.length < 8) {
            res.status(400).json({ ok: false, error: "La contrasena debe tener al menos 8 caracteres" });
            return;
        }

        if (password !== confirmarPassword) {
            res.status(400).json({ ok: false, error: "Las contrasenas no coinciden" });
            return;
        }

        try {
            const fila = await pool.query(
                `
                SELECT id, persona_id
                FROM public.restablecimientos_password_persona
                WHERE codigo_hash = $1 AND usado_at IS NULL AND expira_at > NOW()
                LIMIT 1
                `,
                [hashTokenSeguro(tokenRestablecimiento)]
            );

            if (fila.rows.length === 0) {
                res.status(400).json({ ok: false, error: "Solicitud invalida o vencida" });
                return;
            }

            const solicitud = fila.rows[0];

            await pool.query(
                `UPDATE public.personas SET password_hash = $1 WHERE id = $2`,
                [hashPassword(password), solicitud.persona_id]
            );

            await pool.query(
                `UPDATE public.restablecimientos_password_persona SET usado_at = NOW() WHERE id = $1`,
                [solicitud.id]
            );

            // Si alguien recupero la contrasena, cualquier sesion robada
            // anterior se cierra sola.
            await pool.query(
                `UPDATE public.sesiones_persona SET revocado_at = NOW() WHERE persona_id = $1 AND revocado_at IS NULL`,
                [solicitud.persona_id]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
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
            const resultado = await mintearSesionParaNegocioDePersona(pool, req.persona.id, req.params.negocioId, req);

            if (!resultado) {
                res.status(404).json({ ok: false, error: "No administras ese negocio" });
                return;
            }

            res.json({ ok: true, token: resultado.token, negocio: resultado.negocio });
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

    // Fase 0 del ecosistema Nexo (RBAC2): la persona ya logueada canjea
    // el codigo que el dueño genero para SU empleado (POST /cuenta/
    // empleados/:id/generar-codigo-vinculo) -- a partir de aqui esa
    // persona puede entrar como empleado de ese negocio con su propia
    // cuenta Nexo, no solo con el PIN en un equipo ya vinculado.
    app.post("/personas/vincular-empleado", requerirSesionPersona, async (req, res) => {
        const codigo = limpiarTexto(req.body?.codigo, 20).toUpperCase();

        if (!codigo) {
            res.status(400).json({ ok: false, error: "Escribe el codigo que te dio tu jefe" });
            return;
        }

        try {
            const empleado = await pool.query(
                `SELECT id, negocio_id, nombre, rol, permisos FROM public.empleados WHERE codigo_vinculo_hash = $1 AND activo = true`,
                [hashTokenSeguro(codigo)]
            );

            if (empleado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Codigo invalido o ya usado" });
                return;
            }

            const fila = empleado.rows[0];

            await pool.query(
                `UPDATE public.empleados SET persona_id = $1, codigo_vinculo_hash = NULL WHERE id = $2`,
                [req.persona.id, fila.id]
            );

            const rolMiembro = fila.rol === "Administrador" ? "owner" : "employee";
            await pool.query(
                `
                INSERT INTO public.negocio_miembros (persona_id, negocio_id, rol, permisos, activo)
                VALUES ($1, $2, $3, $4, true)
                ON CONFLICT (persona_id, negocio_id) DO UPDATE SET rol = $3, permisos = $4, activo = true
                `,
                [req.persona.id, fila.negocio_id, rolMiembro, JSON.stringify(fila.permisos || {})]
            );

            const negocio = await pool.query(`SELECT slug, nombre FROM public.negocios WHERE id = $1`, [fila.negocio_id]);

            res.json({ ok: true, negocio: negocio.rows[0], rol: rolMiembro });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Fase 1 del ecosistema Nexo: el segundo camino de login de /dueno
    // (persona, no dueño) llega aqui despues de POST /personas/login --
    // si la persona es empleada de un solo negocio entra directo, si de
    // varios el frontend debe mandar negocioId (mismo patron que ya usa
    // market-cuenta-server.js para 2+ negocios administrados).
    app.post("/personas/entrar-como-empleado", requerirSesionPersona, async (req, res) => {
        const negocioIdSolicitado = req.body?.negocioId ? Number(req.body.negocioId) : null;

        try {
            if (negocioIdSolicitado) {
                const resultado = await mintearSesionEmpleadoDePersona(pool, req.persona.id, negocioIdSolicitado, req);

                if (!resultado) {
                    res.status(404).json({ ok: false, error: "No eres empleado de ese negocio" });
                    return;
                }

                res.json({ ok: true, token: resultado.token, negocio: resultado.negocio, rol: "employee" });
                return;
            }

            const negocios = await listarNegociosDeEmpleado(pool, req.persona.id);

            if (negocios.length === 0) {
                res.status(404).json({ ok: false, error: "No eres empleado de ningun negocio en Nexo" });
                return;
            }

            if (negocios.length > 1) {
                res.json({ ok: true, requiereSeleccion: true, negocios });
                return;
            }

            const resultado = await mintearSesionEmpleadoDePersona(pool, req.persona.id, negocios[0].id, req);
            res.json({ ok: true, token: resultado.token, negocio: resultado.negocio, rol: "employee" });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = {
    registrarRutas,
    listarNegociosDeEmpleado,
    mintearSesionEmpleadoDePersona,
    crearRequerirSesionPersona,
    crearResolverSesionPersonaOpcional,
    listarNegociosAdministrados,
    mintearSesionParaNegocioDePersona,
    tokenDeSesionPersona,
    buscarPersonaPorToken
};

// Enforcement real de plan (Basico vs Plus/Pro) para las funciones que
// de verdad difieren entre esos planes -- confirmado por diff directo
// contra plan_funciones (solo 10 funciones cambian entre basico y
// plus; el resto del catalogo es igual en todos los planes o sigue
// "planeado"). No se gatean esas otras funciones: hacerlo seria
// trabajo especulativo sin efecto real.
//
// Mismo patron ya probado en banco-imagenes-server.js/ia-server.js:
// lee licencias.plan (la fuente que de verdad sincroniza con Stripe,
// no negocios.plan), demo se trata igual que pro.

const pool = require("./db");
const { funcionesDelPlan } = require("./features");

const CACHE_FUNCIONES_PLAN = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function funcionesDelPlanCacheado(plan) {
    const enCache = CACHE_FUNCIONES_PLAN.get(plan);
    if (enCache && enCache.expiraEn > Date.now()) return enCache.funciones;

    const funciones = await funcionesDelPlan(plan);
    CACHE_FUNCIONES_PLAN.set(plan, { funciones, expiraEn: Date.now() + CACHE_TTL_MS });
    return funciones;
}

async function planDelNegocio(negocioId) {
    const fila = await pool.query(`SELECT plan FROM public.licencias WHERE negocio_id = $1`, [negocioId]);
    return (fila.rows[0]?.plan || "demo").toLowerCase();
}

// Regresa {incluido, limite, plan} para una funcion dada. pro/demo
// siempre pasan sin consultar el catalogo (los 10 diferenciadores
// reales son 100% incluidos, sin limite, en pro -- mismo atajo ya
// usado en banco-imagenes-server.js/ia-server.js).
async function funcionDelPlan(negocioId, claveFuncion) {
    const plan = await planDelNegocio(negocioId);

    if (plan === "pro" || plan === "demo") {
        return { incluido: true, limite: null, plan };
    }

    const funciones = await funcionesDelPlanCacheado(plan);
    const entrada = funciones.find(f => f.clave === claveFuncion);

    return { incluido: Boolean(entrada?.incluido), limite: entrada?.limite_numerico ?? null, plan };
}

function negocioIdDeRequest(req) {
    return req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id ?? null;
}

// Middleware generico para funciones binarias (incluida/no incluida).
// No sirve para las 2 funciones con limite_numerico (dispositivos.vincular,
// multiusuario.empleados_pin) -- esas necesitan un conteo previo, se
// resuelven inline en cada ruta con funcionDelPlan() directo.
function requerirFuncionPlan(claveFuncion, mensaje) {
    return async function (req, res, next) {
        try {
            const negocioId = negocioIdDeRequest(req);

            if (!negocioId) {
                res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
                return;
            }

            const { incluido } = await funcionDelPlan(negocioId, claveFuncion);

            if (!incluido) {
                res.status(403).json({
                    ok: false,
                    error: mensaje || "Esta funcion no esta incluida en tu plan actual. Mejora tu plan desde Cuenta para desbloquearla.",
                    requiereUpgrade: true,
                    funcion: claveFuncion
                });
                return;
            }

            next();
        } catch (error) {
            res.status(500).json({ ok: false, error: "No se pudo verificar tu plan. Intenta de nuevo." });
        }
    };
}

module.exports = { funcionDelPlan, planDelNegocio, negocioIdDeRequest, requerirFuncionPlan };

// Seguimiento de errores de produccion (ver plan "Alertas de errores en
// produccion + panel de administrador"). Dos piezas:
//   1. registrarYAlertarError() -- llamada desde error-utils.js SIN
//      esperar, DESPUES de que la respuesta real ya se mando. Nunca
//      puede tumbar ni retrasar esa respuesta.
//   2. Las 3 rutas de /admin/api/errores que consume el panel.
//
// Deliberadamente NO usa responderError() en sus propias rutas --
// seria reentrar la maquinaria de registro de errores por un error
// DENTRO de la maquinaria de registro de errores. Mismo espiritu que
// registrarBitacora(): el manejo de fallas aqui es autocontenido y
// tonto a proposito.

const crypto = require("crypto");
const pool = require("./db");
const { negocioIdDeRequest } = require("./plan-enforcement");
const { enviarCorreoAlertaError } = require("./email");

const COOLDOWN_REENVIO_MS = 2 * 60 * 60 * 1000; // 2 horas

function calcularHuella(ruta, mensaje) {
    return crypto.createHash("sha256").update(`${ruta}|${mensaje}`).digest("hex");
}

async function registrarYAlertarError(res, error) {
    const req = res.req;
    const ruta = req ? `${req.method} ${req.originalUrl}` : "desconocida";
    const negocioId = req ? negocioIdDeRequest(req) : null;
    const mensaje = error?.message || String(error);
    const stack = error?.stack || null;
    const huella = calcularHuella(ruta, mensaje);

    const { rows } = await pool.query(
        `INSERT INTO public.errores_sistema (huella, ruta, negocio_id, mensaje, stack)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (huella) DO UPDATE SET
             veces = errores_sistema.veces + 1,
             ultima_vez = NOW(),
             resuelto = false
         RETURNING id, veces, notificado_at, (xmax = 0) AS es_nuevo`,
        [huella, ruta, negocioId, mensaje, stack]
    );

    const fila = rows[0];
    const yaAvisadoReciente = fila.notificado_at &&
        (Date.now() - new Date(fila.notificado_at).getTime()) < COOLDOWN_REENVIO_MS;

    if (fila.es_nuevo || !yaAvisadoReciente) {
        await enviarCorreoAlertaError({
            esNuevo: fila.es_nuevo,
            veces: fila.veces,
            ruta,
            negocioId,
            mensaje,
            stack
        });
        await pool.query(`UPDATE public.errores_sistema SET notificado_at = NOW() WHERE id = $1`, [fila.id]);
    }
}

function registrarRutasErroresSistema(app) {
    app.get("/admin/api/errores", async (req, res) => {
        try {
            const resuelto = req.query.resuelto === "true" ? true
                : req.query.resuelto === "false" ? false : null;

            const { rows } = await pool.query(
                `SELECT e.*, COALESCE(n.nombre, 'Negocio eliminado') AS negocio_nombre
                 FROM public.errores_sistema e
                 LEFT JOIN public.negocios n ON n.id = e.negocio_id
                 WHERE ($1::boolean IS NULL OR e.resuelto = $1)
                 ORDER BY e.ultima_vez DESC
                 LIMIT 100`,
                [resuelto]
            );
            res.json({ ok: true, errores: rows });
        } catch (error) {
            console.error("No se pudo cargar errores_sistema:", error);
            res.status(500).json({ ok: false, error: "No se pudo cargar errores." });
        }
    });

    app.get("/admin/api/errores/conteo", async (_req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT COUNT(*)::int AS pendientes FROM public.errores_sistema WHERE resuelto = false`
            );
            res.json({ ok: true, pendientes: rows[0].pendientes });
        } catch (error) {
            console.error("No se pudo contar errores_sistema:", error);
            res.status(500).json({ ok: false, error: "No se pudo contar errores." });
        }
    });

    app.patch("/admin/api/errores/:id/resolver", async (req, res) => {
        try {
            await pool.query(`UPDATE public.errores_sistema SET resuelto = true WHERE id = $1`, [Number(req.params.id)]);
            res.json({ ok: true });
        } catch (error) {
            console.error("No se pudo marcar resuelto en errores_sistema:", error);
            res.status(500).json({ ok: false, error: "No se pudo marcar como resuelto." });
        }
    });
}

module.exports = { registrarRutasErroresSistema, registrarYAlertarError };

// Recepcion Inteligente, Fase 3: revision automatica. Fase 2 dejaba
// esto en manos de un boton ("Buscar facturas nuevas") -- este archivo
// hace exactamente lo mismo (revisarBuzonGmail, reexportado de
// recepcion-inteligente-gmail.js, la misma logica sin duplicar nada)
// pero solo, cada cierto tiempo, para todo negocio con un Gmail
// conectado. Mismo patron de programador que ya usa
// credito-recordatorios-server.js (setInterval simple, sin libreria de
// cron): corre al arrancar y luego cada INTERVALO_REVISION_MS.
//
// Un negocio se entera de que llegaron facturas nuevas por un push
// (enviarPushANegocio -- llega a dueño y empleados con notificaciones
// activas, no solo al dueño: revisar una recepcion pendiente es tarea
// operativa, no un aviso de dinero que deba quedarse solo para el
// dueño como los de credito/ventas).
const { revisarBuzonGmail } = require("./recepcion-inteligente-gmail");
const { enviarPushANegocio } = require("./push-server");

const INTERVALO_REVISION_MS = 30 * 60 * 1000; // cada 30 minutos

async function negociosConGmailConectado(pool) {
    const resultado = await pool.query(
        `SELECT negocio_id FROM public.recepcion_inteligente_gmail WHERE activo = true`
    );
    return resultado.rows.map(fila => fila.negocio_id);
}

async function revisarTodosLosBuzones(pool) {
    const negocioIds = await negociosConGmailConectado(pool);

    for (const negocioId of negocioIds) {
        try {
            const resultado = await revisarBuzonGmail(pool, negocioId);

            if (resultado.nuevas > 0) {
                await enviarPushANegocio(pool, negocioId, {
                    titulo: "Recepcion Inteligente",
                    cuerpo: `Nexo encontro ${resultado.nuevas} factura(s) nueva(s) en tu correo, pendiente(s) de revision.`,
                    url: "/"
                });
            }
        } catch (error) {
            // Un buzon con problemas (token revocado, Gmail caido un
            // momento) no debe detener la revision de los demas
            // negocios en el mismo ciclo.
            console.warn("[recepcion-inteligente-gmail-cron] Error revisando negocio", negocioId, error.message);
        }
    }
}

function iniciarProgramadorGmail(pool) {
    async function revisarYCorrer() {
        try {
            await revisarTodosLosBuzones(pool);
        } catch (error) {
            console.log("[recepcion-inteligente-gmail-cron] Error en la revision automatica:", error.message);
        }
    }

    revisarYCorrer();
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

function instalar(app, pool) {
    iniciarProgramadorGmail(pool);
}

module.exports = instalar;
module.exports.revisarTodosLosBuzones = revisarTodosLosBuzones;
module.exports.negociosConGmailConectado = negociosConGmailConectado;

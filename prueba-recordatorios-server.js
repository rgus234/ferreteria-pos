// Aviso de "tu prueba gratuita esta por terminar" -- antes de esto no
// existia ningun correo de este tipo (encontrado en la auditoria de
// lanzamiento, 2026-08-26): un negocio nuevo podia pasar de "prueba" a
// periodo de gracia/limitado sin ningun aviso anticipado. Mismo patron
// que credito-recordatorios-server.js: revision periodica + tabla de
// enfriamiento para no repetir el aviso.
//
// El enfriamiento (10 dias) es mas largo que la ventana de aviso (3
// dias antes de vencer) a proposito -- una prueba dura 15 dias, asi
// que esto garantiza como mucho un correo por negocio durante toda su
// prueba, nunca uno por dia mientras esta en la ventana.

const { enviarCorreoPruebaPorTerminar } = require("./email");

const INTERVALO_REVISION_MS = 60 * 60 * 1000; // revisa cada hora, igual que creditos vencidos
const DIAS_ANTES_DE_AVISAR = 3;
const DIAS_ENFRIAMIENTO = 10;
const ENLACE_PLANES = "https://nexoposoficial.com/#planes";

async function negociosEnPruebaPorTerminar(pool) {
    const resultado = await pool.query(
        `
        SELECT n.id AS negocio_id, n.correo, n.nombre,
               GREATEST(0, CEIL(EXTRACT(EPOCH FROM (l.fecha_vencimiento - NOW())) / 86400))::int AS dias_restantes
        FROM public.negocios n
        JOIN public.licencias l ON l.negocio_id = n.id
        WHERE l.plan = 'prueba'
        AND l.estado = 'activa'
        AND l.fecha_vencimiento IS NOT NULL
        AND l.fecha_vencimiento > NOW()
        AND l.fecha_vencimiento <= NOW() + INTERVAL '${DIAS_ANTES_DE_AVISAR} days'
        AND n.correo IS NOT NULL
        AND n.correo <> ''
        `
    );

    return resultado.rows;
}

async function yaSeAvisoRecientemente(pool, negocioId) {
    const resultado = await pool.query(
        `SELECT 1 FROM public.recordatorios_prueba_por_terminar
         WHERE negocio_id = $1 AND enviado_at > NOW() - INTERVAL '${DIAS_ENFRIAMIENTO} days'`,
        [negocioId]
    );
    return resultado.rows.length > 0;
}

async function revisarYEnviarRecordatorios(pool) {
    const negocios = await negociosEnPruebaPorTerminar(pool);

    for (const negocio of negocios) {
        try {
            if (await yaSeAvisoRecientemente(pool, negocio.negocio_id)) continue;

            await enviarCorreoPruebaPorTerminar(negocio.correo, negocio.nombre, {
                diasRestantes: negocio.dias_restantes,
                enlaceSuscripcion: ENLACE_PLANES
            });

            await pool.query(
                `INSERT INTO public.recordatorios_prueba_por_terminar (negocio_id) VALUES ($1)`,
                [negocio.negocio_id]
            );
        } catch (error) {
            console.warn("[recordatorios-prueba] Error avisando a negocio", negocio.negocio_id, error.message);
        }
    }
}

function iniciarProgramadorRecordatorios(pool) {
    async function revisarYCorrer() {
        try {
            await revisarYEnviarRecordatorios(pool);
        } catch (error) {
            console.log("[recordatorios-prueba] Error revisando pruebas por terminar:", error.message);
        }
    }

    revisarYCorrer();
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

function instalar(app, pool) {
    iniciarProgramadorRecordatorios(pool);
}

module.exports = instalar;
module.exports.revisarYEnviarRecordatorios = revisarYEnviarRecordatorios;

// Recordatorios automaticos de credito vencido ("no olvides pagar tu
// credito", idea original del dueño). Revisa periodicamente TODOS los
// negocios y le manda un push a cada cliente cuyo credito ya vencio --
// mismo calculo de "vencido" que ya usa GET /creditos
// (credit-aging.js), no se reinventa la regla aqui.
//
// Solo le puede llegar a un cliente que ya vinculo su cuenta Nexo
// personal (clientes_credito.persona_id -- via el boton "Vincular" del
// portal, o el autovinculo al iniciar sesion ahi, ver
// public-site-server.js). Un cliente sin vinculo se omite en
// silencio: no es un error, simplemente todavia no hay a donde
// mandarle el push.
//
// Enfriamiento de varios dias por cliente (recordatorios_credito_vencido)
// para no repetirle el mismo aviso cada vez que corre la revision.

const { calcularAntiguedadCredito } = require("./credit-aging");
const { enviarPushAPersona } = require("./push-server");

const INTERVALO_REVISION_MS = 60 * 60 * 1000; // revisa cada hora; el enfriamiento por cliente evita reenvios
const DIAS_ENFRIAMIENTO = 3;

async function clientesConCreditoVencido(pool) {
    const resultado = await pool.query(`
        SELECT c.id AS cliente_id, c.persona_id, c.nombre, n.slug,
               m.tipo, m.monto, m.fecha, m.fecha_vencimiento
        FROM public.clientes_credito c
        JOIN public.negocios n ON n.id = c.negocio_id
        JOIN public.movimientos_credito m
            ON m.cliente_id = c.id AND m.negocio_id = c.negocio_id
        WHERE c.activo = true
        AND c.es_visitante_sitio = false
        AND c.persona_id IS NOT NULL
        ORDER BY c.id, m.fecha ASC, m.id ASC
    `);

    const porCliente = new Map();
    for (const fila of resultado.rows) {
        if (!porCliente.has(fila.cliente_id)) {
            porCliente.set(fila.cliente_id, {
                personaId: fila.persona_id,
                nombre: fila.nombre,
                slug: fila.slug,
                movimientos: []
            });
        }
        porCliente.get(fila.cliente_id).movimientos.push(fila);
    }

    const vencidos = [];
    for (const [clienteId, datos] of porCliente) {
        const aging = calcularAntiguedadCredito(datos.movimientos);
        if (aging.vencido) {
            vencidos.push({
                clienteId,
                personaId: datos.personaId,
                slug: datos.slug,
                totalVencido: aging.totalVencido,
                diasVencidoMax: aging.diasVencidoMax
            });
        }
    }
    return vencidos;
}

async function yaSeAvisoRecientemente(pool, clienteId) {
    const resultado = await pool.query(
        `SELECT 1 FROM public.recordatorios_credito_vencido
         WHERE cliente_id = $1 AND enviado_at > NOW() - INTERVAL '${DIAS_ENFRIAMIENTO} days'`,
        [clienteId]
    );
    return resultado.rows.length > 0;
}

async function revisarYEnviarRecordatorios(pool) {
    const vencidos = await clientesConCreditoVencido(pool);

    for (const cliente of vencidos) {
        try {
            if (await yaSeAvisoRecientemente(pool, cliente.clienteId)) continue;

            const dias = cliente.diasVencidoMax > 0 ? ` (${cliente.diasVencidoMax} dia${cliente.diasVencidoMax === 1 ? "" : "s"})` : "";
            await enviarPushAPersona(pool, cliente.personaId, {
                titulo: "Recordatorio de credito",
                cuerpo: `Tienes ${cliente.totalVencido.toFixed(2)} vencido${dias}. No lo olvides.`,
                url: `https://${cliente.slug}.nexoposoficial.com/portal-cliente`
            });

            await pool.query(
                `INSERT INTO public.recordatorios_credito_vencido (cliente_id) VALUES ($1)`,
                [cliente.clienteId]
            );
        } catch (error) {
            console.warn("[recordatorios-credito] Error avisando a cliente", cliente.clienteId, error.message);
        }
    }
}

function iniciarProgramadorRecordatorios(pool) {
    async function revisarYCorrer() {
        try {
            await revisarYEnviarRecordatorios(pool);
        } catch (error) {
            console.log("[recordatorios-credito] Error revisando creditos vencidos:", error.message);
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

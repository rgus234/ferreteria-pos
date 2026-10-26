// Fin de turno con gracia y "sigo trabajando" (plan docs/plan-celular-inventario-y-venta.md, secciones S, X y Y).
//  - GRACIA: despues de la hora de salida de un empleado hay 15 minutos antes de pedirle PIN (no estorba el cambio de turno).
//  - EXTENDER: con SU PIN el empleado extiende su turno unas horas ("Sigo trabajando"); queda en la bitacora como tiempo extra,
//    con la hora de salida original y hasta cuando se extendio. Solo se registra: no hay que aprobarlo.
//  - El PIN de administrador sigue autorizando como antes (turno_vencido_autorizado).
const { verificarPassword } = require("./password-utils");

const GRACIA_MIN = 15;
const HORAS_POR_DEFECTO = 2;
const HORAS_MAXIMAS = 6;

function minutosDe(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// true cuando ya paso la hora de salida MAS la gracia.
function pasoLaGracia(horaFin, horaAhora, graciaMin = GRACIA_MIN) {
    const fin = minutosDe(horaFin);
    const ahora = minutosDe(horaAhora);

    if (fin === null || ahora === null) return false;

    return ahora >= fin + graciaMin;
}

// Ya se extendio hoy y todavia no vence la extension.
async function extensionVigente(client, negocioId, empleadoId) {
    const r = await client.query(
        `SELECT 1 FROM public.bitacora_acciones
         WHERE negocio_id = $1 AND empleado_id = $2 AND accion = 'turno_extendido'
           AND (detalle->>'hasta')::timestamptz > NOW()
         LIMIT 1`,
        [negocioId, empleadoId]
    );

    return r.rows.length > 0;
}

async function extenderTurno(client, { negocioId, empleadoId, horas, horarioFin }) {
    const cuantas = Math.min(HORAS_MAXIMAS, Math.max(1, Number(horas) || HORAS_POR_DEFECTO));
    const hasta = new Date(Date.now() + cuantas * 3600 * 1000);

    await client.query(
        `INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, $2, 'turno_extendido', $3::jsonb)`,
        [negocioId, empleadoId, JSON.stringify({ horas: cuantas, hasta: hasta.toISOString(), horarioFin: horarioFin || null })]
    );

    return { hasta, horas: cuantas };
}

// POST /turno/extender  { pin, horas? }  (empleado activo por x-empleado-id). Lo registra el servidor, no el navegador.
function instalar(app, pool, requerirAccesoNegocio, limitador) {
    app.post("/turno/extender", requerirAccesoNegocio, async (req, res) => {
        const empleadoId = Number(req.headers["x-empleado-id"]) || null;
        const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id ?? null;

        if (!empleadoId || !negocioId) {
            res.status(400).json({ ok: false, error: "Elige quien eres para extender tu turno." });
            return;
        }

        const clave = `extender:${negocioId}:${empleadoId}`;

        if (limitador && limitador.bloqueado(clave)) {
            res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." });
            return;
        }

        try {
            const fila = (await pool.query(`SELECT pin_hash, horario_laboral FROM public.empleados WHERE id = $1 AND negocio_id = $2 AND activo = true`, [empleadoId, negocioId])).rows[0];

            if (!fila || !fila.pin_hash || !verificarPassword(String(req.body?.pin || ""), fila.pin_hash)) {
                if (limitador) limitador.registrarFallo(clave);
                res.status(401).json({ ok: false, error: "PIN incorrecto" });
                return;
            }

            if (limitador) limitador.registrarExito(clave);

            const dia = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"][new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })).getDay()];
            const fin = fila.horario_laboral?.[dia]?.fin || null;
            const { hasta, horas } = await extenderTurno(pool, { negocioId, empleadoId, horas: req.body?.horas, horarioFin: fin });

            res.json({ ok: true, horas, hasta: hasta.toISOString() });
        } catch (error) {
            res.status(500).json({ ok: false, error: "No se pudo extender el turno." });
        }
    });
}

module.exports = instalar;
module.exports.GRACIA_MIN = GRACIA_MIN;
module.exports.HORAS_POR_DEFECTO = HORAS_POR_DEFECTO;
module.exports.HORAS_MAXIMAS = HORAS_MAXIMAS;
module.exports.minutosDe = minutosDe;
module.exports.pasoLaGracia = pasoLaGracia;
module.exports.extensionVigente = extensionVigente;
module.exports.extenderTurno = extenderTurno;

// Tareas del equipo: que le toca a la gente en un dia. Sin base de datos, para poder probarlo solo.
//   repite: "no" (una sola vez, en `fecha`), "diaria", "semanal" (diasSemana, 1=lunes ... 7=domingo) o "mensual" (diaMes).
//   Una tarea que se repite empieza en `fecha` (desde ahi en adelante).

const DIAS = ["", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const DIAS_ACENTO = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function partes(fechaISO) {
    const [a, m, d] = String(fechaISO).slice(0, 10).split("-").map(Number);
    return { a, m, d };
}

// 1 = lunes ... 7 = domingo
function diaSemanaISO(fechaISO) {
    const { a, m, d } = partes(fechaISO);
    const js = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
    return js === 0 ? 7 : js;
}

function ultimoDiaDelMes(fechaISO) {
    const { a, m } = partes(fechaISO);
    return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

function ocurreEnFecha(tarea, fechaISO) {
    const inicio = String(tarea.fecha || "").slice(0, 10);
    const hoy = String(fechaISO).slice(0, 10);
    if (!inicio || !hoy) return false;

    const repite = tarea.repite || "no";

    if (repite === "no") return inicio === hoy;
    if (hoy < inicio) return false;
    if (repite === "diaria") return true;
    if (repite === "semanal") return (tarea.diasSemana || []).map(Number).includes(diaSemanaISO(hoy));

    if (repite === "mensual") {
        const dia = Number(tarea.diaMes) || partes(inicio).d;
        // un 31 en un mes de 30 dias (o 28) se hace el ultimo dia del mes
        return partes(hoy).d === Math.min(dia, ultimoDiaDelMes(hoy));
    }

    return false;
}

function textoRepeticion(tarea) {
    const repite = tarea.repite || "no";

    if (repite === "diaria") return "Todos los días";
    if (repite === "mensual") return `Cada mes, el día ${Number(tarea.diaMes) || partes(tarea.fecha).d}`;

    if (repite === "semanal") {
        const dias = [...new Set((tarea.diasSemana || []).map(Number))].filter(n => n >= 1 && n <= 7).sort((a, b) => a - b);
        if (dias.length === 7) return "Todos los días";
        if (!dias.length) return "Cada semana";
        const nombres = dias.map(n => DIAS_ACENTO[n]);
        return dias.length === 1 ? `Cada ${nombres[0]}` : `Cada ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
    }

    return "Una sola vez";
}

// Limpia lo que llega del formulario; devuelve { error } o { tarea }
function normalizarTarea(cuerpo, hoy) {
    const titulo = String(cuerpo?.titulo || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!titulo) return { error: "Escribe qué hay que hacer." };

    const repite = ["no", "diaria", "semanal", "mensual"].includes(cuerpo?.repite) ? cuerpo.repite : "no";
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo?.fecha || "")) ? cuerpo.fecha : hoy;
    const hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(cuerpo?.hora || "")) ? cuerpo.hora : null;
    const detalle = String(cuerpo?.detalle || "").trim().slice(0, 500);
    const asignadoA = Number(cuerpo?.asignadoA) > 0 ? Number(cuerpo.asignadoA) : null;

    let diasSemana = [];
    if (repite === "semanal") {
        diasSemana = [...new Set((Array.isArray(cuerpo?.diasSemana) ? cuerpo.diasSemana : []).map(Number))].filter(n => n >= 1 && n <= 7).sort((a, b) => a - b);
        if (!diasSemana.length) return { error: "Elige al menos un día de la semana." };
    }

    let diaMes = null;
    if (repite === "mensual") {
        diaMes = Number(cuerpo?.diaMes);
        if (!(diaMes >= 1 && diaMes <= 31)) return { error: "Elige el día del mes (del 1 al 31)." };
    }

    return { tarea: { titulo, detalle, asignadoA, repite, diasSemana, diaMes, fecha, hora } };
}

module.exports = { ocurreEnFecha, textoRepeticion, normalizarTarea, diaSemanaISO, DIAS, DIAS_ACENTO };

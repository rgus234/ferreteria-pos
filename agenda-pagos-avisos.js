// Aviso diario de pagos a proveedores por vencer (Agenda de pagos): "Tienes 2 pagos vencidos y 1 que vence hoy".
// Una vez al dia (despues de las 9 am, hora de Mexico) y solo si hay algo que avisar: pagos ya vencidos, que vencen hoy o en los proximos
// 2 dias. Llega al celular y a la computadora (cualquier dispositivo del dueño con avisos activados). Solo negocios con la Agenda encendida.
const { enviarPushADuenoDelNegocio } = require("./push-server");
const { agendaActiva } = require("./pago-recepcion");

const HORA_AVISO = 9;
const DIAS_ANTICIPACION = 2;
const INTERVALO_REVISION_MS = 30 * 60 * 1000;
const ZONA = "America/Mexico_City";

const SQL_TABLA = `
    CREATE TABLE IF NOT EXISTS public.avisos_agenda_pagos (
        negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
        fecha DATE NOT NULL,
        cuantos INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (negocio_id, fecha)
    )
`;

const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fechaLocal(ahora = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(ahora);
}

function horaLocal(ahora = new Date()) {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hour12: false }).format(ahora)) % 24;
}

// Cuentas abiertas que ya vencieron, vencen hoy o vencen en los proximos dias: [{ proveedor, saldo, dias }] (dias < 0 = vencida).
async function pagosPorVencer(pool, negocioId, hoy) {
    const filas = await pool.query(
        `SELECT proveedor, saldo::float AS saldo, (vencimiento - $2::date)::int AS dias
         FROM public.cuentas_pagar
         WHERE negocio_id = $1
           AND estado IN ('pendiente', 'parcial')
           AND saldo > 0
           AND vencimiento IS NOT NULL
           AND vencimiento <= $2::date + $3::int
         ORDER BY vencimiento ASC, saldo DESC`,
        [negocioId, hoy, DIAS_ANTICIPACION]
    );

    return filas.rows;
}

function textoAviso(lista) {
    const vencidos = lista.filter(x => x.dias < 0);
    const hoy = lista.filter(x => x.dias === 0);
    const proximos = lista.filter(x => x.dias > 0);
    const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
    const partes = [];

    if (vencidos.length) partes.push(plural(vencidos.length, "vencido", "vencidos"));
    if (hoy.length) partes.push(`${plural(hoy.length, "vence", "vencen")} hoy`);
    if (proximos.length) partes.push(`${plural(proximos.length, "vence", "vencen")} en los próximos ${DIAS_ANTICIPACION} días`);

    const cuando = x => (x.dias < 0 ? "vencido" : (x.dias === 0 ? "vence hoy" : (x.dias === 1 ? "vence mañana" : `vence en ${x.dias} días`)));
    const detalle = lista.slice(0, 2).map(x => `${x.proveedor || "Proveedor"} ${dinero(x.saldo)} (${cuando(x)})`).join(", ");
    const total = lista.reduce((suma, x) => suma + x.saldo, 0);

    return {
        titulo: vencidos.length ? "Tienes pagos vencidos a proveedores" : "Pagos a proveedores por vencer",
        cuerpo: `${partes.join(", ")}. Total ${dinero(total)}. ${detalle}${lista.length > 2 ? " y más" : ""}.`
    };
}

// enviar se inyecta y soloNegocios acota a quien avisar: asi las pruebas no tocan a los negocios reales.
async function avisarPagosPorVencer(pool, { ahora = new Date(), enviar = enviarPushADuenoDelNegocio, soloNegocios = null } = {}) {
    if (horaLocal(ahora) < HORA_AVISO) return 0;

    const tabla = await pool.query(`SELECT to_regclass('public.cuentas_pagar') AS tabla`);
    if (!tabla.rows[0].tabla) return 0;

    await pool.query(SQL_TABLA);

    const hoy = fechaLocal(ahora);
    const negocios = await pool.query(
        `SELECT DISTINCT negocio_id AS id FROM public.cuentas_pagar
         WHERE estado IN ('pendiente', 'parcial') AND vencimiento IS NOT NULL AND negocio_id IS NOT NULL AND ($1::int[] IS NULL OR negocio_id = ANY($1::int[]))`,
        [soloNegocios]
    );
    let avisados = 0;

    for (const negocio of negocios.rows) {
        try {
            if (!(await agendaActiva(pool, negocio.id))) continue;

            const lista = await pagosPorVencer(pool, negocio.id, hoy);
            if (!lista.length) continue;

            const reservado = await pool.query(
                `INSERT INTO public.avisos_agenda_pagos (negocio_id, fecha, cuantos) VALUES ($1, $2, $3)
                 ON CONFLICT (negocio_id, fecha) DO NOTHING RETURNING negocio_id`,
                [negocio.id, hoy, lista.length]
            );
            if (!reservado.rows.length) continue;

            const { titulo, cuerpo } = textoAviso(lista);
            await enviar(pool, negocio.id, { titulo, cuerpo, pantalla: "agenda-pagos", url: "/" });
            avisados++;
        } catch (error) {
            console.warn("[agenda-pagos] No se pudo avisar al negocio", negocio.id, error.message);
        }
    }

    return avisados;
}

function instalar(app, pool) {
    // El servidor de pruebas automaticas comparte la base de datos real: ahi nunca se mandan avisos de verdad.
    if (process.env.NEXO_PRUEBAS) return;

    async function revisarYCorrer() {
        try {
            await avisarPagosPorVencer(pool);
        } catch (error) {
            console.log("[agenda-pagos] Error en el aviso diario:", error.message);
        }
    }

    setTimeout(revisarYCorrer, 60000);
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

module.exports = instalar;
module.exports.pagosPorVencer = pagosPorVencer;
module.exports.avisarPagosPorVencer = avisarPagosPorVencer;
module.exports.textoAviso = textoAviso;

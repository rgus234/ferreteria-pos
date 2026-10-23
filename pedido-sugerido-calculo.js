// Calculo del pedido sugerido (puro, sin base de datos).
//
// Idea: lo que se pide tiene que alcanzar hasta la siguiente visita del
// proveedor Y durante el periodo entre esa visita y la que sigue. Con lo que se
// vende al dia (ventas reales de los ultimos dias) se calcula cuanto hace falta
// y se resta lo que ya hay en la tienda.

const MS_DIA = 86400000;

function aNumero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
}

// Dia de la semana (0 = domingo) de una fecha AAAA-MM-DD.
function diaDeLaSemana(fecha) {
    return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

function sumarDias(fecha, dias) {
    return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10);
}

// Proxima visita: hoy mismo cuenta como visita (dias = 0).
function proximaVisita(hoy, diaVisita) {
    // Number(null) es 0 (domingo): sin dia de visita no hay proxima visita.
    if (diaVisita === null || diaVisita === undefined || diaVisita === "") return null;

    const dia = Number(diaVisita);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) return null;

    const dias = (dia - diaDeLaSemana(hoy) + 7) % 7;
    return { fecha: sumarDias(hoy, dias), dias };
}

// Cuanto pedir de un producto. Devuelve null si no hace falta pedir nada.
function sugerirProducto({ stock, stockMinimo = 0, vendido = 0, diasVentana = 28, diasHastaVisita = 0, frecuenciaDias = 7 }) {
    const existencia = Math.max(0, aNumero(stock));
    const minimo = Math.max(0, aNumero(stockMinimo));
    const porDia = diasVentana > 0 ? Math.max(0, aNumero(vendido)) / diasVentana : 0;

    const diasACubrir = Math.max(0, diasHastaVisita) + Math.max(1, frecuenciaDias);
    const porVentas = Math.ceil(porDia * diasACubrir - existencia - 1e-9);
    const porMinimo = minimo > existencia ? Math.ceil(minimo - existencia) : 0;

    const cantidad = Math.max(porVentas, porMinimo, 0);
    if (cantidad <= 0) return null;

    return {
        cantidad,
        porDia: Number(porDia.toFixed(2)),
        diasAlcanza: porDia > 0 ? Number((existencia / porDia).toFixed(1)) : null,
        motivo: porVentas >= porMinimo ? "ventas" : "minimo"
    };
}

function formatoDinero(valor) {
    return `$${aNumero(valor).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

module.exports = { proximaVisita, sugerirProducto, diaDeLaSemana, sumarDias, formatoDinero, DIAS_SEMANA };

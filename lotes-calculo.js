// Calculo de lotes vigentes (puro, sin base de datos).
//
// El stock real es productos.stock: lo mueven las ventas, ajustes y todo lo de
// siempre. Los lotes (producto_lotes) solo anotan lo que ENTRO y con que fecha de
// caducidad. Lo que sigue vigente de cada lote se calcula, sin tocar ninguna ruta
// de venta: se vende primero lo que vence primero, asi que el stock actual
// pertenece a los lotes que vencen MAS TARDE (los demas ya se vendieron o se tiraron).
//
// Si el stock es mayor que lo que suman los lotes (producto de antes, o entradas
// sin lote), el sobrante cuenta como un lote "sin lote" con la fecha de caducidad
// que el producto ya tuviera (la de siempre).

const MS_DIA = 86400000;

function aFecha(valor) {
    if (!valor) return null;
    const texto = valor instanceof Date ? valor.toISOString() : String(valor);
    const solo = texto.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(solo) ? solo : null;
}

function diasEntre(desde, hasta) {
    return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_DIA);
}

function sumarDiasFecha(fecha, dias) {
    return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10);
}

// Orden de venta: primero lo que vence primero; lo que no tiene fecha, al final.
function ordenDeVenta(a, b) {
    const fa = aFecha(a.fecha_caducidad);
    const fb = aFecha(b.fecha_caducidad);

    if (fa !== fb) {
        if (!fa) return 1;
        if (!fb) return -1;
        return fa < fb ? -1 : 1;
    }

    return (aFecha(a.fecha_entrada) || "") < (aFecha(b.fecha_entrada) || "") ? -1 : (Number(a.id) || 0) - (Number(b.id) || 0);
}

// stock: existencia actual; lotes: filas de producto_lotes; fechaProducto: caducidad
// que ya tenia el producto (para el sobrante sin lote).
function calcularLotesVigentes({ stock, lotes = [], fechaProducto = null }) {
    let restante = Math.max(0, Number(stock) || 0);
    const ordenados = lotes.slice().sort(ordenDeVenta);
    const vigentes = [];

    // De atras hacia adelante: el stock actual son los lotes que se venderan al final.
    for (let i = ordenados.length - 1; i >= 0 && restante > 0.0000001; i--) {
        const lote = ordenados[i];
        const cantidad = Math.min(Number(lote.cantidad) || 0, restante);

        if (cantidad > 0) {
            vigentes.push({
                id: lote.id,
                cantidad: Number(cantidad.toFixed(3)),
                fechaEntrada: aFecha(lote.fecha_entrada),
                fechaCaducidad: aFecha(lote.fecha_caducidad),
                origen: lote.origen || "entrada"
            });
            restante -= cantidad;
        }
    }

    // Lo que no se explica con lotes: existencias de antes de usar lotes.
    if (restante > 0.0001) {
        vigentes.push({
            id: null,
            cantidad: Number(restante.toFixed(3)),
            fechaEntrada: null,
            fechaCaducidad: aFecha(fechaProducto),
            origen: "sin_lote"
        });
    }

    return vigentes.sort((a, b) => ordenDeVenta(
        { fecha_caducidad: a.fechaCaducidad, fecha_entrada: a.fechaEntrada, id: a.id },
        { fecha_caducidad: b.fechaCaducidad, fecha_entrada: b.fechaEntrada, id: b.id }
    ));
}

// 'vencido' | 'hoy' | 'manana' | 'pronto' (<= 3 dias) | 'semana' (<= 7) | 'ok' | 'sin_fecha'
function estadoDeCaducidad(fechaCaducidad, hoy) {
    if (!fechaCaducidad) return { estado: "sin_fecha", dias: null };

    const dias = diasEntre(hoy, fechaCaducidad);
    const estado = dias < 0 ? "vencido" : dias === 0 ? "hoy" : dias === 1 ? "manana" : dias <= 3 ? "pronto" : dias <= 7 ? "semana" : "ok";

    return { estado, dias };
}

// Fecha de caducidad de una entrada: la que se dio, o hoy + vida util del producto.
function caducidadDeEntrada({ fechaCaducidad, vidaUtilDias, hoy }) {
    const dada = aFecha(fechaCaducidad);
    if (dada) return dada;

    const vida = Number(vidaUtilDias);
    return Number.isInteger(vida) && vida > 0 ? sumarDiasFecha(hoy, vida) : null;
}

// Fecha de hoy (AAAA-MM-DD) en hora de Mexico.
function hoyEnMexico(ahora = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

module.exports = { calcularLotesVigentes, estadoDeCaducidad, caducidadDeEntrada, diasEntre, sumarDiasFecha, aFecha, hoyEnMexico };

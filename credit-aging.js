// Motor puro de antiguedad de saldos de credito: dado el historial de
// movimientos de UN cliente (ventas + abonos), determina que ventas
// siguen sin pagarse, cuales ya vencieron (paso su fecha_vencimiento
// individual) y el total vencido. FIFO: los abonos se aplican primero
// a la venta impagada mas antigua.

function calcularAntiguedadCredito(movimientos = [], opciones = {}) {
    const ahora = opciones.ahora ? new Date(opciones.ahora) : new Date();

    const ventas = movimientos
        .filter(m => m.tipo === "venta")
        .slice()
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || Number(a.id) - Number(b.id))
        .map(m => ({
            id: m.id,
            fecha: m.fecha,
            fechaVencimiento: m.fecha_vencimiento || null,
            montoOriginal: Number(m.monto) || 0,
            montoRestante: Number(m.monto) || 0
        }));

    const totalAbonos = movimientos
        .filter(m => m.tipo === "abono")
        .reduce((suma, m) => suma + (Number(m.monto) || 0), 0);

    // Asignacion FIFO en cascada: el total de abonos se "escurre" sobre
    // las ventas en orden cronologico, saldando primero la mas antigua
    // -- equivalente matematico a aplicar cada abono uno por uno contra
    // la venta impagada mas vieja.
    let abonoDisponible = totalAbonos;
    for (const venta of ventas) {
        const aplicado = Math.min(venta.montoOriginal, abonoDisponible);
        venta.montoRestante = venta.montoOriginal - aplicado;
        abonoDisponible -= aplicado;
    }

    const ventasPendientes = ventas.filter(v => v.montoRestante > 0.0001);

    const ventasVencidas = ventasPendientes
        .filter(v => v.fechaVencimiento && new Date(v.fechaVencimiento) < ahora)
        .map(v => ({
            ...v,
            diasVencido: Math.floor((ahora - new Date(v.fechaVencimiento)) / 86400000)
        }));

    const totalVencido = ventasVencidas.reduce((suma, v) => suma + v.montoRestante, 0);
    const saldo = ventasPendientes.reduce((suma, v) => suma + v.montoRestante, 0);
    const ventaVencidaMasAntigua = ventasVencidas.length ? ventasVencidas[0] : null;

    return {
        saldo,
        ventasPendientes,
        ventasVencidas,
        totalVencido,
        vencido: totalVencido > 0.0001,
        ventaVencidaMasAntigua,
        diasVencidoMax: ventaVencidaMasAntigua ? ventaVencidaMasAntigua.diasVencido : 0
    };
}

module.exports = { calcularAntiguedadCredito };

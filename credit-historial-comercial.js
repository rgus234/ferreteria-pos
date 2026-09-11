// Historial comercial de un cliente de credito: metricas agregadas de
// su relacion de credito CON ESTE NEGOCIO -- nunca comparadas contra
// otros negocios (cada ferreteria conserva el control y el riesgo de
// su propio credito, Nexo solo da la plataforma). Pensado para que el
// dueno decida si sube un limite ("cliente desde hace 5 anos, 187
// compras, nunca se ha atrasado") sin tener que leer el estado de
// cuenta completo.
//
// Motor puro, mismo criterio que credit-aging.js: recibe los
// movimientos ya cargados (misma consulta que ya hace GET
// /creditos/clientes/:id), nunca vuelve a tocar la base.
function calcularHistorialComercial(movimientos = [], clienteCreadoEn = null, ahoraOpcional = null) {
    const ahora = ahoraOpcional ? new Date(ahoraOpcional) : new Date();

    const compras = movimientos.filter(m => m.tipo === "venta");
    const abonos = movimientos.filter(m => m.tipo === "abono");

    const totalCompras = compras.length;
    const montoTotalComprado = compras.reduce((suma, c) => suma + (Number(c.monto) || 0), 0);
    const promedioCompra = totalCompras ? montoTotalComprado / totalCompras : 0;

    const ultimoAbono = abonos.reduce((ultimo, abono) => {
        if (!ultimo || new Date(abono.fecha) > new Date(ultimo.fecha)) return abono;
        return ultimo;
    }, null);

    // dias_promedio_para_pagar y veces_atrasado solo cuentan las
    // compras con seguimiento completo (historial_id + liquidado_at,
    // ver 20260730_creditos_folio_liquidacion.sql) -- las de antes de
    // esa migracion nunca registraron cuando se pagaron, asi que
    // entrarian como "nunca liquidadas" y ensuciarian el promedio en
    // vez de quedar honestamente fuera de el.
    const comprasConSeguimiento = compras.filter(c => c.liquidado_at);

    const diasParaPagarPorCompra = comprasConSeguimiento.map(c =>
        (new Date(c.liquidado_at) - new Date(c.fecha)) / 86400000
    );

    const diasPromedioParaPagar = diasParaPagarPorCompra.length
        ? diasParaPagarPorCompra.reduce((suma, dias) => suma + dias, 0) / diasParaPagarPorCompra.length
        : null;

    const vecesAtrasado = comprasConSeguimiento.filter(c =>
        c.fecha_vencimiento && new Date(c.liquidado_at) > new Date(c.fecha_vencimiento)
    ).length;

    const diasComoCliente = clienteCreadoEn
        ? Math.floor((ahora - new Date(clienteCreadoEn)) / 86400000)
        : null;

    return {
        diasComoCliente,
        totalCompras,
        promedioCompra,
        ultimoPagoEn: ultimoAbono ? ultimoAbono.fecha : null,
        diasDesdeUltimoPago: ultimoAbono ? Math.floor((ahora - new Date(ultimoAbono.fecha)) / 86400000) : null,
        diasPromedioParaPagar,
        comprasConSeguimiento: comprasConSeguimiento.length,
        vecesAtrasado,
        nuncaSeHaAtrasado: comprasConSeguimiento.length > 0 && vecesAtrasado === 0
    };
}

module.exports = { calcularHistorialComercial };

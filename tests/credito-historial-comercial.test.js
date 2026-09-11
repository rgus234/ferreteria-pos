// Historial comercial del cliente de credito (calcularHistorialComercial,
// credit-historial-comercial.js): metricas agregadas de compras/pagos
// que el dueno usa para decidir si sube un limite -- pedido explicito
// del dueno ("cliente desde hace 5 anos, 187 compras, nunca se ha
// atrasado"). Corre contra la base real, aislado en un negocio
// sintetico que se borra al terminar.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, crearClienteCreditoActivo, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { calcularHistorialComercial } = require("../credit-historial-comercial");

let negocio;
let producto;

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function detalleCliente(clienteId) {
    const respuesta = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}`, { headers: headers() });
    return respuesta.json();
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("credito-historial-comercial");
    producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto historial comercial", precio: 100, stock: 50 });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("calcularHistorialComercial: sin movimientos, todo en null/cero -- nunca inventa un dato", () => {
    const historial = calcularHistorialComercial([], new Date().toISOString());

    assert.equal(historial.totalCompras, 0);
    assert.equal(historial.promedioCompra, 0);
    assert.equal(historial.ultimoPagoEn, null);
    assert.equal(historial.diasDesdeUltimoPago, null);
    assert.equal(historial.diasPromedioParaPagar, null);
    assert.equal(historial.comprasConSeguimiento, 0);
    assert.equal(historial.vecesAtrasado, 0);
    assert.equal(historial.nuncaSeHaAtrasado, false, "sin ninguna compra con seguimiento no se puede afirmar que nunca se ha atrasado");
});

test("calcularHistorialComercial: compras liquidadas a tiempo cuentan como 'nunca se ha atrasado'", () => {
    const ahora = new Date("2026-06-15T12:00:00Z");
    const movimientos = [
        { tipo: "venta", monto: 200, fecha: "2026-05-01T00:00:00Z", fecha_vencimiento: "2026-05-16T00:00:00Z", liquidado_at: "2026-05-10T00:00:00Z" },
        { tipo: "venta", monto: 400, fecha: "2026-05-05T00:00:00Z", fecha_vencimiento: "2026-05-20T00:00:00Z", liquidado_at: "2026-05-18T00:00:00Z" },
        { tipo: "abono", monto: 600, fecha: "2026-05-18T00:00:00Z" }
    ];

    const historial = calcularHistorialComercial(movimientos, "2020-01-01T00:00:00Z", ahora);

    assert.equal(historial.totalCompras, 2);
    assert.equal(historial.promedioCompra, 300);
    assert.equal(historial.comprasConSeguimiento, 2);
    assert.equal(historial.vecesAtrasado, 0);
    assert.equal(historial.nuncaSeHaAtrasado, true);
    assert.equal(historial.diasDesdeUltimoPago, 28, "del 18 de mayo al 15 de junio hay 28 dias");
    assert.equal(historial.diasPromedioParaPagar, 11, "9 dias la primera compra + 13 la segunda, promedio 11");
});

test("calcularHistorialComercial: una compra pagada despues de su vencimiento SI cuenta como atraso", () => {
    const movimientos = [
        { tipo: "venta", monto: 100, fecha: "2026-01-01T00:00:00Z", fecha_vencimiento: "2026-01-16T00:00:00Z", liquidado_at: "2026-01-10T00:00:00Z" },
        { tipo: "venta", monto: 100, fecha: "2026-01-01T00:00:00Z", fecha_vencimiento: "2026-01-16T00:00:00Z", liquidado_at: "2026-01-25T00:00:00Z" }
    ];

    const historial = calcularHistorialComercial(movimientos, "2020-01-01T00:00:00Z", new Date("2026-02-01T00:00:00Z"));

    assert.equal(historial.vecesAtrasado, 1);
    assert.equal(historial.nuncaSeHaAtrasado, false);
});

test("calcularHistorialComercial: una compra vieja sin historial_id/liquidado_at cuenta para el total pero no para el promedio de dias", () => {
    const movimientos = [
        { tipo: "venta", monto: 250, fecha: "2024-01-01T00:00:00Z", fecha_vencimiento: null, liquidado_at: null }
    ];

    const historial = calcularHistorialComercial(movimientos, "2024-01-01T00:00:00Z", new Date("2026-01-01T00:00:00Z"));

    assert.equal(historial.totalCompras, 1, "la compra vieja si cuenta para el total y el promedio de compra");
    assert.equal(historial.promedioCompra, 250);
    assert.equal(historial.comprasConSeguimiento, 0, "sin liquidado_at, no aporta al promedio de dias para pagar");
    assert.equal(historial.diasPromedioParaPagar, null);
    assert.equal(historial.nuncaSeHaAtrasado, false, "sin ninguna compra con seguimiento no se puede afirmar que nunca se ha atrasado");
});

test("GET /creditos/clientes/:id trae historialComercial real -- cargo + abono que satura, via la API de verdad", async () => {
    const clienteId = (await crearClienteCreditoActivo(negocio.negocioId, { nombre: "Cliente historial comercial", telefono: "5556667777", limiteCredito: 5000 })).id;

    const cargo = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            monto: 300,
            subtotal: 300,
            productos: [{ id: producto.id, nombre: producto.nombre, precio: 100, cantidad: 3, unidadVenta: "pieza", modoVenta: "bolsa", importe: 300 }]
        })
    });
    assert.equal(cargo.status, 200);

    const antesDePagar = await detalleCliente(clienteId);
    assert.equal(antesDePagar.historialComercial.totalCompras, 1);
    assert.equal(antesDePagar.historialComercial.promedioCompra, 300);
    assert.equal(antesDePagar.historialComercial.comprasConSeguimiento, 0, "todavia no se liquida, no cuenta para dias-para-pagar");
    assert.equal(antesDePagar.historialComercial.diasDesdeUltimoPago, null, "todavia no hay ningun abono");

    const abono = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/abonos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 300, concepto: "Paga toda la compra" })
    });
    assert.equal(abono.status, 200);

    const despuesDePagar = await detalleCliente(clienteId);
    assert.equal(despuesDePagar.historialComercial.comprasConSeguimiento, 1, "ya se liquido, ahora si cuenta");
    assert.equal(despuesDePagar.historialComercial.diasDesdeUltimoPago, 0, "se pago hoy mismo");
    assert.ok(despuesDePagar.historialComercial.diasPromedioParaPagar >= 0);
    assert.equal(despuesDePagar.historialComercial.nuncaSeHaAtrasado, true, "se pago mucho antes de los 15 dias de plazo de la prueba");
});

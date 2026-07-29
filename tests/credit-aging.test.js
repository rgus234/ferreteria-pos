// Pruebas puras del motor de antiguedad de credito (credit-aging.js) --
// sin servidor ni base de datos, solo entrada/salida de la funcion.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calcularAntiguedadCredito } = require("../credit-aging");

const AHORA = new Date("2026-07-29T00:00:00Z");

test("una venta sin abonos con vencimiento en el pasado queda vencida", () => {
    const r = calcularAntiguedadCredito([
        { id: 1, tipo: "venta", monto: 500, fecha: "2026-07-01T00:00:00Z", fecha_vencimiento: "2026-07-16T00:00:00Z" }
    ], { ahora: AHORA });

    assert.equal(r.vencido, true);
    assert.equal(r.totalVencido, 500);
    assert.equal(r.saldo, 500);
});

test("una venta con abono igual al monto queda saldada y no vencida", () => {
    const r = calcularAntiguedadCredito([
        { id: 1, tipo: "venta", monto: 500, fecha: "2026-07-01T00:00:00Z", fecha_vencimiento: "2026-07-16T00:00:00Z" },
        { id: 2, tipo: "abono", monto: 500, fecha: "2026-07-05T00:00:00Z" }
    ], { ahora: AHORA });

    assert.equal(r.vencido, false);
    assert.equal(r.saldo, 0);
    assert.equal(r.totalVencido, 0);
});

test("dos ventas vencidas + abono parcial: solo reduce la mas antigua (FIFO)", () => {
    const r = calcularAntiguedadCredito([
        { id: 1, tipo: "venta", monto: 500, fecha: "2026-07-01T00:00:00Z", fecha_vencimiento: "2026-07-16T00:00:00Z" },
        { id: 2, tipo: "venta", monto: 300, fecha: "2026-07-10T00:00:00Z", fecha_vencimiento: "2026-07-25T00:00:00Z" },
        { id: 3, tipo: "abono", monto: 200, fecha: "2026-07-20T00:00:00Z" }
    ], { ahora: AHORA });

    assert.equal(r.ventasVencidas.length, 2, "ambas ya vencieron para 'ahora'");
    const ventaMasVieja = r.ventasVencidas.find(v => v.id === 1);
    const ventaMasNueva = r.ventasVencidas.find(v => v.id === 2);
    assert.equal(ventaMasVieja.montoRestante, 300, "el abono de 200 solo reduce la venta 1 (500-200)");
    assert.equal(ventaMasNueva.montoRestante, 300, "la venta 2 queda intacta");
    assert.equal(r.ventaVencidaMasAntigua.id, 1);
});

test("abono mayor a la primera venta pero menor a la suma de ambas", () => {
    const r = calcularAntiguedadCredito([
        { id: 1, tipo: "venta", monto: 500, fecha: "2026-07-01T00:00:00Z", fecha_vencimiento: "2026-07-16T00:00:00Z" },
        { id: 2, tipo: "venta", monto: 300, fecha: "2026-07-10T00:00:00Z", fecha_vencimiento: "2026-07-25T00:00:00Z" },
        { id: 3, tipo: "abono", monto: 600, fecha: "2026-07-20T00:00:00Z" }
    ], { ahora: AHORA });

    assert.equal(r.ventasPendientes.length, 1, "la venta 1 quedo totalmente saldada");
    assert.equal(r.ventasPendientes[0].id, 2);
    assert.equal(r.ventasPendientes[0].montoRestante, 200, "300 - 100 restantes del abono");
});

test("venta con vencimiento en el futuro no aparece como vencida aunque tenga saldo", () => {
    const r = calcularAntiguedadCredito([
        { id: 1, tipo: "venta", monto: 500, fecha: "2026-07-28T00:00:00Z", fecha_vencimiento: "2026-08-12T00:00:00Z" }
    ], { ahora: AHORA });

    assert.equal(r.vencido, false);
    assert.equal(r.saldo, 500);
    assert.equal(r.ventasVencidas.length, 0);
});

test("sin movimientos: saldo y vencido en cero/false", () => {
    const r = calcularAntiguedadCredito([], { ahora: AHORA });
    assert.equal(r.vencido, false);
    assert.equal(r.saldo, 0);
});

test("abono registrado antes de cualquier venta no truena y se aplica igual", () => {
    const r = calcularAntiguedadCredito([
        { id: 1, tipo: "abono", monto: 100, fecha: "2026-06-01T00:00:00Z" },
        { id: 2, tipo: "venta", monto: 400, fecha: "2026-07-01T00:00:00Z", fecha_vencimiento: "2026-07-16T00:00:00Z" }
    ], { ahora: AHORA });

    assert.equal(r.saldo, 300);
    assert.equal(r.vencido, true);
});

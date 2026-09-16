// Fase 7 del plan de identidad multi-proveedor: tramo de descuento por
// monto de factura, exclusivo de GAFI (nunca de TRUPER ni de ningun otro
// proveedor a menos que el dueño lo configure a proposito). Funciones
// puras, sin base de datos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolverDescuentoPorMonto, costoNetoConDescuento } = require("../descuento-proveedor");

// Tramos reales de GAFI, tal cual los dio el dueño.
const TRAMOS_GAFI = [
    { desde: 5000, hasta: 7999, porcentaje: 10 },
    { desde: 8000, hasta: 11999, porcentaje: 12 },
    { desde: 12000, hasta: null, porcentaje: 20 }
];

test("sin tramos configurados, nunca hay descuento (comportamiento de siempre para TRUPER/Diprofer)", () => {
    assert.equal(resolverDescuentoPorMonto([], 50000), null);
    assert.equal(resolverDescuentoPorMonto(null, 50000), null);
    assert.equal(resolverDescuentoPorMonto(undefined, 50000), null);
});

test("monto por debajo del primer tramo no aplica ningun descuento", () => {
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 4999), null);
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 0), null);
});

test("cada tramo real de GAFI resuelve su propio porcentaje", () => {
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 5000).porcentaje, 10);
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 7999).porcentaje, 10);
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 8000).porcentaje, 12);
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 11999).porcentaje, 12);
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 12000).porcentaje, 20);
});

test("el ultimo tramo (hasta=null) nunca tiene techo -- un monto enorme sigue calificando", () => {
    assert.equal(resolverDescuentoPorMonto(TRAMOS_GAFI, 1000000).porcentaje, 20);
});

test("si dos tramos se traslapan (mal configurados), gana el de mayor porcentaje, no el primero de la lista", () => {
    const traslapados = [
        { desde: 5000, hasta: 20000, porcentaje: 10 },
        { desde: 10000, hasta: 15000, porcentaje: 12 }
    ];
    assert.equal(resolverDescuentoPorMonto(traslapados, 12000).porcentaje, 12);
});

test("costoNetoConDescuento aplica el porcentaje del tramo sobre el costo de lista", () => {
    const resultado = costoNetoConDescuento(143, TRAMOS_GAFI, 15000);
    assert.equal(resultado.tramoAplicado.porcentaje, 20);
    assert.equal(resultado.costoNeto, 143 * 0.8);
});

test("costoNetoConDescuento sin tramo aplicable regresa el costo de lista sin tocar", () => {
    const resultado = costoNetoConDescuento(143, TRAMOS_GAFI, 100);
    assert.equal(resultado.tramoAplicado, null);
    assert.equal(resultado.costoNeto, 143);
});

test("costoNetoConDescuento nunca da un costo negativo aunque el porcentaje sea invalido", () => {
    const resultado = costoNetoConDescuento(100, [{ desde: 0, hasta: null, porcentaje: 150 }], 100);
    assert.equal(resultado.costoNeto, 0);
});

// Ventas con descuento: el descuento (sobre el total con IVA) se reparte entre los renglones y la factura
// debe sumar exactamente lo que se cobro, al centavo, sin importar lo raros que sean los importes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { armarConceptosFactura } = require("../facturacion-server");

const r2 = n => Math.round(n * 100) / 100;
const suma = (items, campo) => r2(items.reduce((a, i) => a + i[campo], 0));

function revisar(productos, descuento) {
    const subtotalVenta = r2(productos.reduce((a, p) => a + p.importe, 0));
    const cobrado = r2(subtotalVenta - descuento);
    const items = armarConceptosFactura(productos, "01010101", "H87", descuento);
    assert.equal(suma(items, "Total"), cobrado, `la factura suma lo cobrado (${cobrado}) con descuento ${descuento}: ${JSON.stringify(productos.map(p => p.importe))}`);
    for (const i of items) {
        const desc = i.Discount || 0;
        assert.equal(r2(i.Subtotal - desc + i.Taxes[0].Total), i.Total, "Subtotal - Descuento + IVA = Total del renglon");
        assert.equal(i.Taxes[0].Base, r2(i.Subtotal - desc), "el IVA se calcula sobre lo descontado");
        assert.ok(desc >= 0 && i.Total >= 0);
    }
    return items;
}

test("sin descuento todo queda como siempre (sin campo Descuento)", () => {
    const productos = [{ nombre: "A", cantidad: 2, importe: 232 }, { nombre: "B", cantidad: 1, importe: 58.5 }];
    const items = armarConceptosFactura(productos, "01010101", "H87");
    assert.equal(items.some(i => "Discount" in i), false);
    assert.equal(suma(items, "Total"), 290.5);
});

test("descuento de 10% reparte y cuadra al centavo", () => {
    const productos = [{ nombre: "Martillo", cantidad: 1, importe: 150 }, { nombre: "Cinta", cantidad: 2, importe: 82 }];
    const items = revisar(productos, 23.2);
    assert.ok(items.every(i => i.Discount > 0));
});

test("descuentos y importes raros: 400 combinaciones siempre cuadran", () => {
    let semilla = 12345;
    const azar = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 400; n++) {
        const renglones = 1 + Math.floor(azar() * 6);
        const productos = Array.from({ length: renglones }, (_, k) => ({ nombre: `P${k}`, cantidad: 1 + Math.floor(azar() * 5), importe: r2(0.5 + azar() * 900) }));
        const subtotal = r2(productos.reduce((a, p) => a + p.importe, 0));
        const descuento = r2(azar() < 0.2 ? 0.01 : azar() * subtotal * 0.9);
        revisar(productos, descuento);
    }
});

test("descuento total (100%) y descuento de un centavo no rompen", () => {
    const productos = [{ nombre: "A", cantidad: 1, importe: 116 }, { nombre: "B", cantidad: 3, importe: 34.8 }];
    revisar(productos, 150.8);
    revisar(productos, 0.01);
});

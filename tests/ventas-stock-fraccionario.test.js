// Ventas con cantidades fraccionarias (0.96 kg, 0.715 m) sobre productos con
// stock entero. Antes: POST /ventas -> 500 y la venta no se guardaba, porque
// productos.stock es INTEGER. Ahora la fraccion vive en stock_resto.
//
// Lo que se protege:
//  - cantidades enteras se comportan EXACTAMENTE como siempre (stock_resto 0);
//  - una cantidad con decimales cobra bien y deja stock + stock_resto correcto;
//  - vender de mas deja la existencia en 0 (nunca negativa);
//  - cancelar una venta con decimales regresa la existencia exacta.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");

let negocio;
const PIN_ADMIN = "581204";

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function nuevoProducto(overrides) {
    const fila = await crearProductoPrueba(negocio.negocioId, overrides);
    return { ...fila, nombre: overrides.nombre, precio: overrides.precio };
}

async function vender(producto, cantidad) {
    const importe = Number((producto.precio * cantidad).toFixed(2));
    const resp = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            total: importe,
            subtotal: importe,
            productos: [{ id: producto.id, nombre: producto.nombre, precio: producto.precio, cantidad, unidadVenta: "metro", modoVenta: "bolsa", importe }],
            metodoPago: "efectivo",
            pagos: { efectivo: importe },
            recibido: importe,
            cambio: 0
        })
    });
    return { status: resp.status, cuerpo: await resp.json() };
}

async function existencia(productoId) {
    const r = await pool.query(`SELECT stock, stock_resto FROM public.productos WHERE id = $1`, [productoId]);
    return { stock: Number(r.rows[0].stock), resto: Number(r.rows[0].stock_resto), total: Number(r.rows[0].stock) + Number(r.rows[0].stock_resto) };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("ventas-stock-fraccionario");
    await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash) VALUES ($1, 'Admin de prueba', 'Administrador', $2)`,
        [negocio.negocioId, hashPassword(PIN_ADMIN)]
    );
    await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 500, notas: "" })
    });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("cantidades enteras: mismo resultado de siempre y stock_resto sigue en 0", async () => {
    const p = await nuevoProducto({ nombre: "Entero de prueba", precio: 50, stock: 10 });

    const { status } = await vender(p, 3);
    assert.equal(status, 200);

    const e = await existencia(p.id);
    assert.equal(e.stock, 7);
    assert.equal(e.resto, 0);
});

test("cantidad con decimales: la venta se guarda y la existencia queda exacta", async () => {
    const p = await nuevoProducto({ nombre: "Cable por metro de prueba", precio: 20, stock: 10 });

    const { status, cuerpo } = await vender(p, 0.96);
    assert.equal(status, 200, JSON.stringify(cuerpo));
    assert.ok(cuerpo.historialId);

    const e = await existencia(p.id);
    assert.equal(e.stock, 9);
    assert.equal(e.resto, 0.04);
    assert.equal(Number(e.total.toFixed(3)), 9.04);

    // Una segunda venta fraccionaria acumula bien: 9.04 - 0.715 = 8.325
    const otra = await vender(p, 0.715);
    assert.equal(otra.status, 200);
    const e2 = await existencia(p.id);
    assert.equal(e2.stock, 8);
    assert.equal(Number(e2.resto.toFixed(3)), 0.325);
});

test("vender de mas deja la existencia en 0, nunca negativa", async () => {
    const p = await nuevoProducto({ nombre: "Poco stock de prueba", precio: 10, stock: 1 });

    const { status } = await vender(p, 1.5);
    assert.equal(status, 200);

    const e = await existencia(p.id);
    assert.equal(e.stock, 0);
    assert.equal(e.resto, 0);
});

test("cancelar una venta con decimales regresa la existencia exacta", async () => {
    const p = await nuevoProducto({ nombre: "Cancelable fraccionario", precio: 30, stock: 5 });

    const { status, cuerpo } = await vender(p, 0.715);
    assert.equal(status, 200);

    const antes = await existencia(p.id);
    assert.equal(Number(antes.total.toFixed(3)), 4.285);

    const resp = await fetch(`${BASE_URL}/ventas/${cuerpo.historialId}/cancelar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ motivo: "Prueba fraccionaria", adminPin: PIN_ADMIN })
    });
    assert.equal(resp.status, 200);

    const despues = await existencia(p.id);
    assert.equal(despues.stock, 5);
    assert.equal(despues.resto, 0);
});

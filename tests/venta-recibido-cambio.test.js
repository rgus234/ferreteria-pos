// El cobro en efectivo guarda con cuanto pago el cliente y el cambio: el ticket que se vuelve a abrir del historial los usa.
// (La computadora no los mandaba al cobrar y quedaban en $0.00; ver pos-sales.js.)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let producto;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("venta-recibido-cambio");
    producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto recibido cambio prueba", precio: 62, stock: 10 });
    await fetch(`${BASE_URL}/caja/abrir`, { method: "POST", headers: headers(), body: JSON.stringify({ usuario: "prueba", fondoInicial: 500, notas: "" }) });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

const vender = cuerpo => fetch(`${BASE_URL}/ventas`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ total: 62, subtotal: 62, metodoPago: "efectivo", pagos: { efectivo: 62, tarjeta: 0, transferencia: 0, credito: 0 }, productos: [{ id: producto.id, nombre: "Producto recibido cambio prueba", precio: 62, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 62 }], ...cuerpo })
});

test("una venta en efectivo guarda lo recibido y el cambio que manda la computadora", async () => {
    const r = await vender({ recibido: 100, cambio: 38, idempotencyKey: "recibido-cambio-1" });
    assert.equal(r.status, 200);
    const datos = await r.json();
    const fila = (await pool.query(`SELECT pago_efectivo, pago_recibido, cambio FROM public.historial_ventas WHERE id = $1`, [datos.historialId])).rows[0];
    assert.equal(Number(fila.pago_recibido), 100);
    assert.equal(Number(fila.cambio), 38);
    assert.equal(Number(fila.pago_efectivo), 62, "lo cobrado en efectivo es el total, no lo recibido");
});

// Corre contra la base de datos real (no hay una de pruebas separada
// en este proyecto) -- todo queda aislado en un negocio sintetico
// propio y se borra al terminar. Ver tests/helpers/negocio-prueba.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("ventas");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("una venta descuenta el stock exacto y queda en el historial", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 150 });

    const respuesta = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-dispositivo-token": negocio.token
        },
        body: JSON.stringify({
            total: 300,
            subtotal: 300,
            productos: [{ id: producto.id, cantidad: 2, modoVenta: "bolsa" }],
            metodoPago: "efectivo",
            pagos: { efectivo: 300 },
            recibido: 300,
            cambio: 0,
            cajeroUsuario: "prueba",
            cajeroNombre: "Prueba automatizada"
        })
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.success, true);
    assert.ok(datos.ventaId, "debe regresar un ventaId");

    const productoActualizado = await pool.query(
        "SELECT stock FROM public.productos WHERE id = $1",
        [producto.id]
    );

    assert.equal(Number(productoActualizado.rows[0].stock), 8, "el stock debe bajar exactamente 2");

    const historial = await pool.query(
        "SELECT total, metodo_pago FROM public.historial_ventas WHERE venta_id = $1",
        [datos.ventaId]
    );

    assert.equal(historial.rows.length, 1, "debe quedar exactamente una fila en historial_ventas");
    assert.equal(Number(historial.rows[0].total), 300);
    assert.equal(historial.rows[0].metodo_pago, "efectivo");
});

test("una venta sin token de dispositivo se rechaza", async () => {
    const respuesta = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total: 100, productos: [] })
    });

    assert.equal(respuesta.status, 401);
});

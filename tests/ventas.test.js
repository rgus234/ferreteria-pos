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

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

test("una venta sin turno de caja abierto se rechaza", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 150 });

    const respuesta = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productos: [{ id: producto.id, precio: 150, cantidad: 1, modoVenta: "bolsa" }],
            metodoPago: "efectivo",
            pagos: { efectivo: 150 },
            recibido: 150,
            cambio: 0,
            cajeroUsuario: "prueba",
            cajeroNombre: "Prueba automatizada"
        })
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 400);
    assert.equal(datos.requiereAbrirTurno, true);

    const productoSinCambios = await pool.query(
        "SELECT stock FROM public.productos WHERE id = $1",
        [producto.id]
    );
    assert.equal(Number(productoSinCambios.rows[0].stock), 10, "el stock no debe bajar si la venta se rechazo");
});

test("una venta descuenta el stock exacto y queda en el historial", async () => {
    const apertura = await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 500, notas: "" })
    });
    assert.equal(apertura.status, 200);

    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 150 });

    const respuesta = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-dispositivo-token": negocio.token
        },
        body: JSON.stringify({
            productos: [{ id: producto.id, precio: 150, cantidad: 2, modoVenta: "bolsa" }],
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

test("revision de cobro: rechaza cantidades negativas, pagos que no cubren el total y credito sin cliente; acepta lo de siempre", async () => {
    const a = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 100 });
    const b = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 50 });
    const vender = async cuerpo => {
        const r = await fetch(`${BASE_URL}/ventas`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) });
        return { estado: r.status, datos: await r.json().catch(() => ({})) };
    };

    const negativa = await vender({ productos: [{ id: a.id, precio: 100, cantidad: 1 }, { id: b.id, precio: 50, cantidad: -1 }], metodoPago: "efectivo", pagos: { efectivo: 50 } });
    assert.equal(negativa.estado, 400);
    assert.match(negativa.datos.error, /cantidad/i);

    const corto = await vender({ productos: [{ id: a.id, precio: 100, cantidad: 1 }], metodoPago: "efectivo", pagos: { efectivo: 10 } });
    assert.equal(corto.estado, 400);
    assert.match(corto.datos.error, /no cubren/i);

    const creditoSinCliente = await vender({ productos: [{ id: a.id, precio: 100, cantidad: 1 }], metodoPago: "credito", pagos: { credito: 100 } });
    assert.equal(creditoSinCliente.estado, 400);
    assert.match(creditoSinCliente.datos.error, /cliente/i);

    // Nada de lo rechazado movio inventario
    assert.equal(Number((await pool.query("SELECT stock FROM public.productos WHERE id = $1", [a.id])).rows[0].stock), 10);

    // Lo de siempre sigue pasando: pago exacto, con cambio (efectivo mayor) y sin desglose de pagos
    const exacto = await vender({ productos: [{ id: a.id, precio: 100, cantidad: 1 }], metodoPago: "efectivo", pagos: { efectivo: 100 } });
    const conCambio = await vender({ productos: [{ id: a.id, precio: 100, cantidad: 1 }], metodoPago: "efectivo", pagos: { efectivo: 200 }, recibido: 200, cambio: 100 });
    const sinDesglose = await vender({ productos: [{ id: a.id, precio: 100, cantidad: 1 }], metodoPago: "efectivo" });
    assert.equal(exacto.estado, 200);
    assert.equal(conCambio.estado, 200);
    assert.equal(sinDesglose.estado, 200);
});

test("revision de cobro: un precio menor al mas bajo registrado queda marcado en la venta, sin bloquearla", async () => {
    const p = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 100 });
    const respuesta = await fetch(`${BASE_URL}/ventas`, { method: "POST", headers: headers(), body: JSON.stringify({ productos: [{ id: p.id, precio: 40, cantidad: 1 }, { id: -5, precio: 30, cantidad: 1, nombre: "Servicio" }], metodoPago: "efectivo", pagos: { efectivo: 70 } }) });
    assert.equal(respuesta.status, 200, "la venta no se bloquea");
    const datos = await respuesta.json();

    const fila = (await pool.query("SELECT productos FROM public.historial_ventas WHERE id = $1", [datos.historialId])).rows[0];
    const bajo = fila.productos.find(x => Number(x.id) === p.id);
    const servicio = fila.productos.find(x => Number(x.id) === -5);
    assert.ok(Number(bajo.precioBajoBase) >= 40 && Number(bajo.precioBajoBase) <= 100, "marcado: " + JSON.stringify(bajo));
    assert.equal(servicio.precioBajoBase, undefined, "un articulo rapido no se revisa");
});

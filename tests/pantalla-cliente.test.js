// Pantalla del cliente: estado en memoria (ver pantalla-cliente-server.js)
// que Explorar Nexo / Punto de venta / Inventario usan para "proyectar"
// lo que se esta viendo hacia una segunda pantalla. Sin base de datos --
// las pruebas solo verifican el contrato HTTP y el aislamiento por
// negocio, ya que la vigencia de 10 minutos no es practica de probar
// en tiempo real sin mockear el reloj.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocioA;
let negocioB;

function headers(negocio) {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

before(async () => {
    await iniciarServidorPrueba();
    negocioA = await crearNegocioPrueba("pantalla-cliente-a");
    negocioB = await crearNegocioPrueba("pantalla-cliente-b");
});

after(async () => {
    if (negocioA) await borrarNegocioPrueba(negocioA.negocioId);
    if (negocioB) await borrarNegocioPrueba(negocioB.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("GET /pantalla-cliente/actual sin nada mostrado responde producto null", async () => {
    const respuesta = await fetch(`${BASE_URL}/pantalla-cliente/actual`, { headers: headers(negocioA) });
    assert.equal(respuesta.status, 200);
    const datos = await respuesta.json();
    assert.equal(datos.ok, true);
    assert.equal(datos.producto, null);
});

test("las 3 rutas exigen un equipo vinculado", async () => {
    const mostrar = await fetch(`${BASE_URL}/pantalla-cliente/mostrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Producto sin token" })
    });
    assert.equal(mostrar.status, 401);

    const actual = await fetch(`${BASE_URL}/pantalla-cliente/actual`);
    assert.equal(actual.status, 401);

    const limpiar = await fetch(`${BASE_URL}/pantalla-cliente/limpiar`, { method: "POST" });
    assert.equal(limpiar.status, 401);
});

test("POST /pantalla-cliente/mostrar sin nombre se rechaza", async () => {
    const respuesta = await fetch(`${BASE_URL}/pantalla-cliente/mostrar`, {
        method: "POST",
        headers: headers(negocioA),
        body: JSON.stringify({ foto: "https://ejemplo.com/foto.jpg", precio: 50 })
    });
    assert.equal(respuesta.status, 400);
    const datos = await respuesta.json();
    assert.equal(datos.ok, false);
});

test("mostrar un producto y despues leerlo de vuelta trae los mismos datos", async () => {
    const mostrar = await fetch(`${BASE_URL}/pantalla-cliente/mostrar`, {
        method: "POST",
        headers: headers(negocioA),
        body: JSON.stringify({
            nombre: "Lubricante seco PTFE en aerosol 240 ml, Truper",
            foto: "https://ejemplo.com/lubricante.jpg",
            precio: 105,
            marca: "Truper",
            origen: "explorar-nexo"
        })
    });
    assert.equal(mostrar.status, 200);
    assert.equal((await mostrar.json()).ok, true);

    const actual = await fetch(`${BASE_URL}/pantalla-cliente/actual`, { headers: headers(negocioA) });
    const datos = await actual.json();
    assert.equal(datos.ok, true);
    assert.equal(datos.producto.nombre, "Lubricante seco PTFE en aerosol 240 ml, Truper");
    assert.equal(datos.producto.foto, "https://ejemplo.com/lubricante.jpg");
    assert.equal(datos.producto.precio, 105);
    assert.equal(datos.producto.marca, "Truper");
    assert.equal(datos.producto.origen, "explorar-nexo");
    assert.ok(Number.isFinite(datos.producto.actualizadoEn));
});

test("cada negocio ve solo lo suyo -- nunca lo que proyecta otro negocio", async () => {
    await fetch(`${BASE_URL}/pantalla-cliente/mostrar`, {
        method: "POST",
        headers: headers(negocioA),
        body: JSON.stringify({ nombre: "Producto exclusivo del negocio A" })
    });

    const vistaDesdeB = await fetch(`${BASE_URL}/pantalla-cliente/actual`, { headers: headers(negocioB) });
    const datos = await vistaDesdeB.json();
    assert.equal(datos.ok, true);
    assert.equal(datos.producto, null);
});

test("POST /pantalla-cliente/limpiar borra lo que se estaba mostrando", async () => {
    await fetch(`${BASE_URL}/pantalla-cliente/mostrar`, {
        method: "POST",
        headers: headers(negocioA),
        body: JSON.stringify({ nombre: "Producto que se va a limpiar" })
    });

    const limpiar = await fetch(`${BASE_URL}/pantalla-cliente/limpiar`, { method: "POST", headers: headers(negocioA) });
    assert.equal(limpiar.status, 200);

    const actual = await fetch(`${BASE_URL}/pantalla-cliente/actual`, { headers: headers(negocioA) });
    assert.equal((await actual.json()).producto, null);
});

test("foto y marca son opcionales -- null cuando no se mandan", async () => {
    await fetch(`${BASE_URL}/pantalla-cliente/mostrar`, {
        method: "POST",
        headers: headers(negocioA),
        body: JSON.stringify({ nombre: "Articulo rapido sin foto ni marca" })
    });

    const actual = await fetch(`${BASE_URL}/pantalla-cliente/actual`, { headers: headers(negocioA) });
    const datos = await actual.json();
    assert.equal(datos.producto.foto, null);
    assert.equal(datos.producto.marca, null);
    assert.equal(datos.producto.precio, null);
});

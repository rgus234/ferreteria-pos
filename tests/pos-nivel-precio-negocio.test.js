// Con que nivel de precio arranca cada venta en el punto de venta.
//
// Antes el carrito empezaba en "mayoreo" fijo, y al seleccionar "Publico
// general" saltaba a publico. Un negocio que vende casi todo a otro
// nivel --Ferreteria Olimpico vende los productos de Diprofer a medio
// mayoreo-- tenia que cambiarlo a mano en cada venta, o cobrar de mas
// sin darse cuenta.
//
// Ahora sale de la configuracion del NEGOCIO. Es un ajuste de negocio y
// no de dispositivo a proposito: si viviera en el localStorage de cada
// caja habria que ponerlo una por una, y una caja nueva empezaria
// cobrando publico sin que nadie lo note.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("nivel-precio");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function ponerNivel(nivel) {
    const respuesta = await fetch(`${BASE_URL}/negocio-actual/nivel-precio`, {
        method: "POST", headers: headers(), body: JSON.stringify({ nivel })
    });
    return { estado: respuesta.status, datos: await respuesta.json().catch(() => null) };
}

test("un negocio nuevo arranca en publico", async () => {
    const respuesta = await fetch(`${BASE_URL}/negocio-actual`, { headers: headers() });
    const datos = await respuesta.json();

    assert.equal(datos.ok, true);
    assert.equal(datos.negocio.nivel_precio_por_defecto, "publico");
});

test("se puede cambiar a medio mayoreo y queda guardado", async () => {
    const r = await ponerNivel("mayoreo");
    assert.equal(r.datos.ok, true);

    const respuesta = await fetch(`${BASE_URL}/negocio-actual`, { headers: headers() });
    const datos = await respuesta.json();
    assert.equal(datos.negocio.nivel_precio_por_defecto, "mayoreo");
});

test("un nivel inventado se rechaza", async () => {
    // Sin esto, un valor cualquiera reventaria contra el CHECK de la base
    // a media venta en vez de devolver un error claro aqui.
    const r = await ponerNivel("regalado");
    assert.equal(r.estado, 400);

    // Y no cambio lo que ya estaba.
    const respuesta = await fetch(`${BASE_URL}/negocio-actual`, { headers: headers() });
    const datos = await respuesta.json();
    assert.equal(datos.negocio.nivel_precio_por_defecto, "mayoreo");
});

test("los tres niveles del POS son los que acepta la base", async () => {
    // Mismo cuidado que con motivo_revision: agregar un nivel al codigo
    // sin agregarlo al CHECK revienta en produccion, no en las pruebas.
    for (const nivel of ["publico", "mayoreo", "distribuidor"]) {
        const r = await ponerNivel(nivel);
        assert.equal(r.datos?.ok, true, `la base deberia aceptar '${nivel}'`);
    }
});

// Margen de ganancia por categoria, independiente de proveedor -- ver
// migrations/20261009_margenes_categoria_negocio.sql. Caso real
// pedido por el dueño: agregar un producto sin factura (costo dado de
// palabra) y que Nexo sugiera el precio de venta con solo costo +
// categoria, sin depender de una regla configurada para un proveedor
// exacto.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("margenes-categoria");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
});

test("sin configurar nada, GET regresa un mapa vacio y redondeo por default", async () => {
    const respuesta = await fetch(`${BASE_URL}/margenes-categoria`, { headers: headers() });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.deepEqual(datos.margenesCategoria, {});
    assert.equal(datos.redondeo, "ninguno");
});

test("guardar margenes por categoria y releerlos de vuelta", async () => {
    const guardar = await fetch(`${BASE_URL}/margenes-categoria`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            margenesCategoria: { "tornilleria y fijacion": 40, electrico: 25 },
            redondeo: "multiplo5"
        })
    });
    const datosGuardar = await guardar.json();
    assert.equal(guardar.status, 200, JSON.stringify(datosGuardar));
    assert.equal(datosGuardar.margenesCategoria["tornilleria y fijacion"], 40);

    const leer = await fetch(`${BASE_URL}/margenes-categoria`, { headers: headers() });
    const datosLeer = await leer.json();
    assert.equal(datosLeer.redondeo, "multiplo5");
    assert.equal(datosLeer.margenesCategoria.electrico, 25);
});

test("guardar de nuevo reemplaza el mapa completo (no lo fusiona)", async () => {
    await fetch(`${BASE_URL}/margenes-categoria`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ margenesCategoria: { plomeria: 30 }, redondeo: "ninguno" })
    });

    const leer = await fetch(`${BASE_URL}/margenes-categoria`, { headers: headers() });
    const datos = await leer.json();

    assert.deepEqual(datos.margenesCategoria, { plomeria: 30 }, "las categorias del guardado anterior ya no deben seguir ahi");
});

test("dos negocios distintos nunca comparten margenes (aislados por negocio_id)", async () => {
    const otroNegocio = await crearNegocioPrueba("margenes-categoria-otro");
    try {
        await fetch(`${BASE_URL}/margenes-categoria`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-dispositivo-token": otroNegocio.token },
            body: JSON.stringify({ margenesCategoria: { pintura: 55 }, redondeo: "ninguno" })
        });

        const propio = await (await fetch(`${BASE_URL}/margenes-categoria`, { headers: headers() })).json();
        assert.ok(!("pintura" in propio.margenesCategoria), "el margen del otro negocio no debe aparecer aqui");
    } finally {
        await borrarNegocioPrueba(otroNegocio.negocioId);
    }
});

// Corre contra la base de datos real (no hay una de pruebas separada
// en este proyecto) -- todo queda aislado en negocios sinteticos
// propios y se borra al terminar. Ver tests/helpers/negocio-prueba.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otroNegocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("barcode-labels");
    otroNegocio = await crearNegocioPrueba("barcode-labels-otro");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otroNegocio) await borrarNegocioPrueba(otroNegocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function headersNegocio(token) {
    return { "Content-Type": "application/json", "x-dispositivo-token": token };
}

// crearProductoPrueba usa "overrides.codigo || TEST-xxxx" -- pasar
// codigo:"" no sirve para forzar "sin codigo" porque "" es falsy y
// cae en el default. Se limpia directo en la base despues de crear.
async function crearProductoSinCodigoPrueba(negocioId, overrides = {}) {
    const producto = await crearProductoPrueba(negocioId, overrides);
    await pool.query("UPDATE public.productos SET codigo = '' WHERE id = $1", [producto.id]);
    return producto;
}

test("genera un codigo interno NX-{id} para un producto sin codigo", async () => {
    const producto = await crearProductoSinCodigoPrueba(negocio.negocioId);

    const respuesta = await fetch(`${BASE_URL}/productos/${producto.id}/generar-codigo`, {
        method: "POST",
        headers: headersNegocio(negocio.token)
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.ok, true);
    assert.equal(datos.codigo, `NX-${producto.id}`);

    const fila = await pool.query("SELECT codigo, codigo_generado FROM public.productos WHERE id = $1", [producto.id]);
    assert.equal(fila.rows[0].codigo, `NX-${producto.id}`);
    assert.equal(fila.rows[0].codigo_generado, true);
});

test("el codigo generado se puede escanear -- GET /producto-codigo/:codigo lo encuentra", async () => {
    const producto = await crearProductoSinCodigoPrueba(negocio.negocioId, { nombre: "Producto escaneable" });

    await fetch(`${BASE_URL}/productos/${producto.id}/generar-codigo`, {
        method: "POST",
        headers: headersNegocio(negocio.token)
    });

    const respuesta = await fetch(`${BASE_URL}/producto-codigo/NX-${producto.id}`, {
        headers: headersNegocio(negocio.token)
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.ok(datos, "debe encontrar el producto por su codigo generado");
    assert.equal(datos.id, producto.id);
});

test("rechaza generar codigo a un producto que ya tiene uno", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId);

    const respuesta = await fetch(`${BASE_URL}/productos/${producto.id}/generar-codigo`, {
        method: "POST",
        headers: headersNegocio(negocio.token)
    });

    assert.equal(respuesta.status, 400);
});

test("un negocio no puede generar codigo a un producto de otro negocio", async () => {
    const productoAjeno = await crearProductoSinCodigoPrueba(otroNegocio.negocioId);

    const respuesta = await fetch(`${BASE_URL}/productos/${productoAjeno.id}/generar-codigo`, {
        method: "POST",
        headers: headersNegocio(negocio.token)
    });

    assert.equal(respuesta.status, 404);
});

test("crea una plantilla de etiquetas y la refleja en GET con los mismos valores", async () => {
    const respuesta = await fetch(`${BASE_URL}/etiquetas-plantillas`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({
            nombre: "Plantilla grande",
            diseno: {
                anchoMm: 70, altoMm: 40, columnas: 2, margenMm: 8, espaciadoMm: 4,
                mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true,
                mostrarPrecio: true, mostrarMarca: true, mostrarCategoria: true
            }
        })
    });

    const creada = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(creada.ok, true);
    assert.ok(creada.id);

    const listado = await (await fetch(`${BASE_URL}/etiquetas-plantillas`, { headers: headersNegocio(negocio.token) })).json();
    const plantilla = listado.plantillas.find(p => p.id === creada.id);

    assert.ok(plantilla, "la plantilla recien creada debe aparecer en el listado");
    assert.equal(plantilla.nombre, "Plantilla grande");
    assert.equal(Number(plantilla.anchoMm), 70);
    assert.equal(Number(plantilla.altoMm), 40);
    assert.equal(plantilla.columnas, 2);
    assert.equal(plantilla.mostrarMarca, true);
    assert.equal(plantilla.mostrarCategoria, true);
});

test("guardar una plantilla con diseno incompleto usa los valores por defecto de la migracion", async () => {
    const respuesta = await fetch(`${BASE_URL}/etiquetas-plantillas`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Plantilla minima", diseno: {} })
    });

    const creada = await respuesta.json();
    const listado = await (await fetch(`${BASE_URL}/etiquetas-plantillas`, { headers: headersNegocio(negocio.token) })).json();
    const plantilla = listado.plantillas.find(p => p.id === creada.id);

    assert.equal(Number(plantilla.anchoMm), 50);
    assert.equal(Number(plantilla.altoMm), 25);
    assert.equal(plantilla.columnas, 3);
    assert.equal(Number(plantilla.margenMm), 5);
    assert.equal(Number(plantilla.espaciadoMm), 3);
    assert.equal(plantilla.mostrarMarca, false);
    assert.equal(plantilla.mostrarCategoria, false);
});

test("rechaza guardar una plantilla sin nombre", async () => {
    const respuesta = await fetch(`${BASE_URL}/etiquetas-plantillas`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ diseno: {} })
    });

    assert.equal(respuesta.status, 400);
});

test("DELETE borra una plantilla y un negocio no puede borrar la de otro", async () => {
    const creada = await (await fetch(`${BASE_URL}/etiquetas-plantillas`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Plantilla a borrar", diseno: {} })
    })).json();

    const respuestaAjena = await fetch(`${BASE_URL}/etiquetas-plantillas/${creada.id}`, {
        method: "DELETE",
        headers: headersNegocio(otroNegocio.token)
    });

    assert.equal(respuestaAjena.status, 404, "otro negocio no debe poder borrar esta plantilla");

    const respuesta = await fetch(`${BASE_URL}/etiquetas-plantillas/${creada.id}`, {
        method: "DELETE",
        headers: headersNegocio(negocio.token)
    });

    assert.equal(respuesta.status, 200);

    const listado = await (await fetch(`${BASE_URL}/etiquetas-plantillas`, { headers: headersNegocio(negocio.token) })).json();
    assert.ok(!listado.plantillas.some(p => p.id === creada.id), "la plantilla borrada no debe seguir apareciendo");
});

test("las rutas de codigos de barras rechazan peticiones sin token de dispositivo", async () => {
    const respuesta = await fetch(`${BASE_URL}/etiquetas-plantillas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Sin token", diseno: {} })
    });

    assert.equal(respuesta.status, 401);
});

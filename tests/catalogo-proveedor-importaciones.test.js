// Historial de importaciones de catalogo, contra el servidor real.
//
// Lo que antes se decia en una linea que desaparecia al recargar ahora se
// puede volver a consultar. Un catalogo de proveedor se actualiza una o
// dos veces al año, y "que cambio" es la pregunta que uno se hace
// despues, no en el momento de subirlo.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;
let otroNegocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("cat-import");
    otroNegocio = await crearNegocioPrueba("cat-import-ajeno");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otroNegocio) await borrarNegocioPrueba(otroNegocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function headers(quien = negocio) {
    return { "Content-Type": "application/json", "x-dispositivo-token": quien.token };
}

const PROVEEDOR = "Proveedor de prueba";

async function importar(productos, quien = negocio) {
    const respuesta = await fetch(
        `${BASE_URL}/catalogo-proveedor/${encodeURIComponent(PROVEEDOR)}/subir`,
        { method: "POST", headers: headers(quien), body: JSON.stringify({ productos }) }
    );
    return respuesta.json();
}

test("la primera importacion reporta todo como nuevo", async () => {
    const datos = await importar([
        { codigo: "P-1", nombre: "Martillo de prueba", distribuidor: 100, medioMayoreo: 120, publico: 140 },
        { codigo: "P-2", nombre: "Pinzas de prueba", distribuidor: 200, medioMayoreo: 230, publico: 260 }
    ]);

    assert.equal(datos.ok, true);
    assert.equal(datos.insight.nuevos, 2);
    assert.ok(datos.insight.importacionId, "devuelve a que reporte ir");
});

test("la segunda importacion detecta subida, alta y baja a la vez", async () => {
    const datos = await importar([
        // P-1 sube de precio en dos niveles.
        { codigo: "P-1", nombre: "Martillo de prueba", distribuidor: 110, medioMayoreo: 120, publico: 150 },
        // P-2 desaparece del archivo.
        // P-3 es nuevo.
        { codigo: "P-3", nombre: "Desarmador de prueba", distribuidor: 50, medioMayoreo: 60, publico: 70 }
    ]);

    assert.equal(datos.insight.nuevos, 1);
    assert.equal(datos.insight.cambiosPrecio, 1, "un producto modificado");
    assert.equal(datos.insight.descontinuados, 1);

    const reporte = await (await fetch(
        `${BASE_URL}/catalogo-proveedor/importaciones/${datos.insight.importacionId}`,
        { headers: headers() }
    )).json();

    assert.equal(reporte.ok, true);

    const deP1 = reporte.cambios.filter(c => c.codigo_proveedor === "P-1");
    assert.deepEqual(deP1.map(c => c.campo).sort(), ["Distribuidor", "Publico"],
        "los dos precios que cambiaron, no solo el publico");

    const subida = deP1.find(c => c.campo === "Publico");
    assert.equal(subida.valor_anterior, "$140.00");
    assert.equal(subida.valor_nuevo, "$150.00");

    const baja = reporte.cambios.find(c => c.tipo === "descontinuado");
    assert.equal(baja.codigo_proveedor, "P-2");
    assert.equal(baja.nombre, "Pinzas de prueba", "el nombre queda guardado para leerlo despues");
});

test("el historial se puede consultar cuando quieras", async () => {
    const datos = await (await fetch(
        `${BASE_URL}/catalogo-proveedor/importaciones`, { headers: headers() }
    )).json();

    assert.equal(datos.ok, true);
    assert.ok(datos.importaciones.length >= 2, "las dos importaciones quedaron registradas");
    // La mas reciente primero: es la que uno quiere ver.
    assert.ok(
        new Date(datos.importaciones[0].creado_en) >= new Date(datos.importaciones[1].creado_en)
    );
});

test("se puede filtrar por tipo de cambio", async () => {
    const lista = await (await fetch(
        `${BASE_URL}/catalogo-proveedor/importaciones`, { headers: headers() }
    )).json();
    const ultima = lista.importaciones[0].id;

    const soloBajas = await (await fetch(
        `${BASE_URL}/catalogo-proveedor/importaciones/${ultima}?tipo=descontinuado`,
        { headers: headers() }
    )).json();

    assert.ok(soloBajas.cambios.length > 0);
    assert.ok(soloBajas.cambios.every(c => c.tipo === "descontinuado"));
});

test("un negocio NO puede leer el reporte de otro", async () => {
    // El negocio_id va en el WHERE, no solo el id: sin eso bastaria con
    // cambiar el numero de la URL para ver los precios de otro negocio.
    const lista = await (await fetch(
        `${BASE_URL}/catalogo-proveedor/importaciones`, { headers: headers() }
    )).json();
    const ajena = lista.importaciones[0].id;

    const respuesta = await fetch(
        `${BASE_URL}/catalogo-proveedor/importaciones/${ajena}`,
        { headers: headers(otroNegocio) }
    );

    assert.equal(respuesta.status, 404, "no existe para quien no es su dueno");
});

test("reimportar el MISMO archivo no inventa cambios", async () => {
    // Los precios vuelven de Postgres como "150.00" y del archivo como
    // 150. Sin normalizar, cada reimportacion gritaria que todo cambio.
    const mismo = [
        { codigo: "P-1", nombre: "Martillo de prueba", distribuidor: 110, medioMayoreo: 120, publico: 150 },
        { codigo: "P-3", nombre: "Desarmador de prueba", distribuidor: 50, medioMayoreo: 60, publico: 70 }
    ];
    await importar(mismo);
    const otraVez = await importar(mismo);

    assert.equal(otraVez.insight.cambiosPrecio, 0, "nada cambio, nada se reporta");
    assert.equal(otraVez.insight.nuevos, 0);
    assert.equal(otraVez.insight.sinCambio, 2, "y queda claro que la importacion SI corrio");
});

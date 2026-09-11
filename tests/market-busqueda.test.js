// Nexo Market GET /market/buscar-json: buscarProductosMarket() ahora
// reusa el mismo motor de busqueda por intencion que Explorar Nexo
// (busqueda-inteligente.js) -- este archivo no repite sus pruebas de
// unidad (ver tests/explorar-nexo.test.js), solo confirma que la
// integracion real en Market (que ademas mezcla codigo/marca exactos y
// hace JOIN con sitio_web_config) funciona igual para un comprador de
// verdad. Antes de este cambio, buscarProductosMarket() era una version
// mas simple sin el filtro por palabra ni el normalizado de acentos --
// exactamente los mismos falsos positivos ya encontrados con el
// personal (candado/dado, llave de paso/cruz) tambien afectaban a
// clientes reales en produccion.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

// tiendasPermitidasMarket() cachea 60s en memoria del proceso -- crear
// el negocio y su sitio_web_config ANTES de la primera busqueda basta
// para que esa primera llamada ya lo incluya en la cache.
async function activarEnMarket(negocioId) {
    await pool.query(
        `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias)
         VALUES ($1, true, true, true)`,
        [negocioId]
    );
}

async function buscar(termino) {
    const respuesta = await fetch(`${BASE_URL}/market/buscar-json?buscar=${encodeURIComponent(termino)}&giro=ferreteria`);
    return respuesta.json();
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("market-busqueda");
    await activarEnMarket(negocio.negocioId);

    await crearProductoPrueba(negocio.negocioId, { nombre: "Candado de laton 40mm gancho corto, MB", codigo: "MB-CANDADO-1" });
    await crearProductoPrueba(negocio.negocioId, { nombre: "Dado cuadro 1/2 de impacto, MB", codigo: "MB-DADO-1" });
    await crearProductoPrueba(negocio.negocioId, { nombre: "Llave de paso 1/2 pulgada, MB", codigo: "MB-LLAVEPASO-1" });
    await crearProductoPrueba(negocio.negocioId, { nombre: "Llave de cruz 14 pulgadas plegable, MB", codigo: "MB-LLAVECRUZ-1" });
    await crearProductoPrueba(negocio.negocioId, { nombre: "Bomba SUMÉRGIBLE 1/2 HP para pozo, MB", codigo: "MB-SUMERGIBLE-1" });
    await crearProductoPrueba(negocio.negocioId, { nombre: "Articulo generico sin relacion, MB", codigo: "MB-GENERICO-1" });
    // crearProductoPrueba no acepta marca -- se fija aparte, directo por SQL.
    await pool.query(`UPDATE public.productos SET marca = 'ZorroXYZ' WHERE negocio_id = $1 AND codigo = 'MB-GENERICO-1'`, [negocio.negocioId]);
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("una palabra corta no sugiere un producto sin relacion solo por compartir letras (candado/dado)", async () => {
    const resultado = await buscar("candado");

    assert.ok(resultado.productos.some(p => p.codigo === "MB-CANDADO-1"), "debe encontrar el candado real");
    assert.ok(!resultado.productos.some(p => p.codigo === "MB-DADO-1"), "un dado de impacto no debe salir al buscar candado, aunque comparta letras");
});

test("una palabra generica compartida no basta -- debe coincidir tambien la que distingue el producto (llave de paso/cruz)", async () => {
    const resultado = await buscar("llave de paso");

    assert.ok(resultado.productos.some(p => p.codigo === "MB-LLAVEPASO-1"), "debe encontrar la llave de paso real");
    assert.ok(!resultado.productos.some(p => p.codigo === "MB-LLAVECRUZ-1"), "una llave de cruz no debe salir al buscar llave de paso, solo por compartir la palabra 'llave'");
});

test("una busqueda sin acentos encuentra un nombre con acentos", async () => {
    const resultado = await buscar("sumergible");

    assert.ok(resultado.productos.some(p => p.codigo === "MB-SUMERGIBLE-1"), "'sumergible' (sin acento) debe encontrar 'SUMÉRGIBLE'");
});

test("una marca exacta encuentra el producto aunque el nombre no comparta ninguna palabra con la busqueda", async () => {
    const resultado = await buscar("ZorroXYZ");

    assert.ok(resultado.productos.some(p => p.codigo === "MB-GENERICO-1"), "una marca exacta es una senal fuerte por si sola, no debe depender del filtro de palabras del nombre");
});

test("una busqueda sin coincidencias reales no revienta ni cuelga -- regresa vacio", async () => {
    const resultado = await buscar("xilofonoinexistente9999");

    assert.equal(resultado.ok, true);
    assert.equal(resultado.total, 0);
    assert.deepEqual(resultado.productos, []);
});

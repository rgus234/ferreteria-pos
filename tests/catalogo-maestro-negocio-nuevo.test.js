// La prueba que el dueno pidio: un negocio NUEVO, sin catalogo privado,
// escanea el codigo de barras de un producto TRUPER que nunca ha estado
// en ese negocio, y Nexo recupera su identidad desde el Catalogo Maestro.
//
// Es la demostracion de que la identidad dejo de depender de que cada
// negocio cargue su propio catalogo.
//
// IMPORTANTE: esta prueba NO toca el flujo real de ventas ni de "Agregar
// producto", y no cambia precios de nadie. Solo comprueba que la
// identidad se puede recuperar; conectarla al flujo es un paso aparte que
// el dueno todavia no autorizo.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { identidadPorCodigo } = require("../catalogo-maestro-reconciliacion");

// Negocio sintetico: existe solo durante la prueba y se borra al final.
let negocioId = null;
const SLUG = "test-maestro-negocio-nuevo-" + process.pid;

before(async () => {
    const r = await pool.query(
        `INSERT INTO public.negocios (nombre, slug) VALUES ($1, $2) RETURNING id`,
        ["Negocio nuevo sin catalogo (prueba)", SLUG]
    );
    negocioId = r.rows[0].id;
});

after(async () => {
    if (negocioId) {
        await pool.query(`DELETE FROM public.productos WHERE negocio_id = $1`, [negocioId]);
        await pool.query(`DELETE FROM public.negocios WHERE id = $1`, [negocioId]);
    }
    await pool.end();
});

test("el negocio nuevo arranca sin productos y sin catalogo propio", async () => {
    const productos = await pool.query(
        `SELECT COUNT(*)::int n FROM public.productos WHERE negocio_id = $1`, [negocioId]
    );
    const catalogos = await pool.query(
        `SELECT COUNT(*)::int n FROM public.catalogos_proveedor WHERE negocio_id = $1`, [negocioId]
    );

    assert.equal(productos.rows[0].n, 0, "no tiene inventario");
    assert.equal(catalogos.rows[0].n, 0, "no ha cargado ningun catalogo de proveedor");
});

test("con la busqueda ACTUAL (por negocio) ese negocio no encuentra nada", async () => {
    // Reproduce la consulta real de /catalogo-proveedor/buscar-codigo:
    // esta atada a negocio_id, por eso un negocio nuevo no encuentra nada.
    const ean = await unEanDelMaestro();
    if (!ean) return; // sin datos cargados no hay nada que comprobar

    const r = await pool.query(
        `SELECT cp.codigo_proveedor
         FROM public.catalogo_productos cp
         WHERE cp.negocio_id = $1
           AND (cp.codigo_proveedor = $2 OR NULLIF(cp.codigo_barras,'') = $2)
         LIMIT 1`,
        [negocioId, ean]
    );

    assert.equal(r.rows.length, 0, "el catalogo de proveedor es por negocio: aqui no hay nada");
});

test("PERO el Catalogo Maestro SI lo identifica sin haber cargado nada", async () => {
    const ean = await unEanDelMaestro();
    if (!ean) {
        console.log("    (Catalogo Maestro vacio: correr scripts/reconciliar-catalogo-maestro.js --aplicar)");
        return;
    }

    const identidad = await identidadPorCodigo(pool, ean);

    assert.ok(identidad, `el EAN ${ean} deberia resolverse desde el Catalogo Maestro`);
    assert.ok(identidad.nombre && identidad.nombre.length > 3, "trae nombre de producto");
    assert.ok(identidad.marca, "trae marca");
    assert.equal(identidad.ean, ean, "el EAN corresponde");

    // La identidad es GLOBAL: no depende del negocio que consulta.
    assert.ok(identidad.codigo_fabricante, "trae el codigo del fabricante");
});

test("la identidad recuperada NO trae datos comerciales de otro negocio", async () => {
    const ean = await unEanDelMaestro();
    if (!ean) return;

    const identidad = await identidadPorCodigo(pool, ean);
    assert.ok(identidad);

    // Lo que se recupera es identidad y, si existe, el precio de LISTA del
    // fabricante. Nunca el costo, el stock ni el precio de venta de
    // Ferreteria Olimpico ni de ningun otro negocio.
    for (const campoProhibido of ["costo", "stock", "precio_venta", "proveedor_id", "negocio_id"]) {
        assert.equal(identidad[campoProhibido], undefined,
            `la identidad global no debe exponer "${campoProhibido}"`);
    }
});

test("un codigo que no existe no inventa un producto", async () => {
    const identidad = await identidadPorCodigo(pool, "0000000000000");
    assert.equal(identidad, null);
});

test("el Maestro tambien resuelve por codigo de fabricante, no solo por EAN", async () => {
    const r = await pool.query(
        `SELECT valor FROM public.catalogo_maestro_identificadores
         WHERE tipo = 'fabricante' LIMIT 1`
    );
    if (r.rows.length === 0) return;

    const identidad = await identidadPorCodigo(pool, r.rows[0].valor);
    assert.ok(identidad, "un producto se encuentra por cualquiera de sus identificadores");
});

// Un EAN cualquiera que ya este en el Maestro, para no depender de un
// producto concreto que podria cambiar.
async function unEanDelMaestro() {
    const r = await pool.query(
        `SELECT valor FROM public.catalogo_maestro_identificadores
         WHERE tipo = 'ean' ORDER BY id LIMIT 1`
    );
    return r.rows[0]?.valor || null;
}

// Escaneo conectado al Catalogo Maestro.
//
// La regla que se prueba aqui, y que es la que protege a los negocios que
// ya trabajan: el catalogo de proveedor PROPIO manda siempre. El Maestro
// solo entra cuando el negocio no tiene nada suyo para ese codigo.
//
// Sin eso, un negocio que cargo el catalogo de su proveedor y negocio sus
// precios veria de pronto precios de lista del fabricante al escanear.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;
// EAN real que existe en el Catalogo Maestro (se resuelve en before).
let eanDelMaestro = null;
let datosMaestro = null;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("escaneo-maestro");

    const r = await pool.query(
        `SELECT i.valor, m.nombre, m.marca, m.codigo_fabricante
         FROM public.catalogo_maestro_identificadores i
         JOIN public.catalogo_maestro_productos m ON m.id = i.producto_maestro_id
         WHERE i.tipo = 'ean' AND COALESCE(m.nombre,'') <> '' AND NOT m.necesita_revision
         ORDER BY i.id LIMIT 1`
    );
    if (r.rows[0]) {
        eanDelMaestro = r.rows[0].valor;
        datosMaestro = r.rows[0];
    }
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function buscarCodigo(codigo) {
    const respuesta = await fetch(
        `${BASE_URL}/catalogo-proveedor/buscar-codigo?codigo=${encodeURIComponent(codigo)}`,
        { headers: headers() }
    );
    return respuesta.json();
}

test("un negocio sin catalogo propio ahora SI reconoce lo que escanea", async () => {
    if (!eanDelMaestro) {
        console.log("    (Catalogo Maestro vacio: correr scripts/reconciliar-catalogo-maestro.js --aplicar)");
        return;
    }

    const datos = await buscarCodigo(eanDelMaestro);

    assert.equal(datos.ok, true);
    assert.ok(datos.producto, "deberia encontrarlo en el Catalogo Maestro");
    assert.equal(datos.producto.origen, "catalogo_nexo");
    assert.ok(datos.producto.nombre.length > 3, "trae nombre de producto");
    assert.equal(datos.producto.codigoBarras, eanDelMaestro);
});

test("tambien lo encuentra por el codigo del fabricante", async () => {
    if (!datosMaestro?.codigo_fabricante) return;

    const datos = await buscarCodigo(datosMaestro.codigo_fabricante);
    assert.ok(datos.producto, "un producto se encuentra por cualquiera de sus identificadores");
    assert.equal(datos.producto.origen, "catalogo_nexo");
});

test("REGLA: el catalogo propio del negocio MANDA sobre el Maestro", async () => {
    if (!eanDelMaestro) return;

    // Se le carga al negocio un catalogo propio con ESE mismo codigo de
    // barras, pero con su nombre y sus precios negociados.
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos)
         VALUES ($1, 'Proveedor de prueba', 1) RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos
            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, marca,
             codigo_barras, precio_distribuidor, precio_medio_mayoreo, precio_publico)
         VALUES ($1, $2, 'PROP-1', 'Nombre que puso el proveedor del negocio', 'MARCA PROPIA',
                 $3, 11.11, 22.22, 33.33)`,
        [negocio.negocioId, catalogo.rows[0].id, eanDelMaestro]
    );

    try {
        const datos = await buscarCodigo(eanDelMaestro);

        assert.ok(datos.producto);
        assert.equal(datos.producto.origen, undefined,
            "al venir del catalogo propio no lleva marca de origen");
        assert.equal(datos.producto.nombre, "Nombre que puso el proveedor del negocio");
        assert.equal(Number(datos.producto.publico), 33.33,
            "manda el precio que el negocio negocio con SU proveedor, no el de lista");
        assert.equal(datos.producto.proveedor, "Proveedor de prueba");
    } finally {
        await pool.query(`DELETE FROM public.catalogo_productos WHERE catalogo_id = $1`, [catalogo.rows[0].id]);
        await pool.query(`DELETE FROM public.catalogos_proveedor WHERE id = $1`, [catalogo.rows[0].id]);
    }
});

test("un codigo que no existe en ningun lado sigue devolviendo null", async () => {
    const datos = await buscarCodigo("0000000000000");
    assert.equal(datos.ok, true);
    assert.equal(datos.producto, null, "no se inventa un producto");
});

test("lo que viene del Maestro no trae proveedor: no viene de ninguno", async () => {
    if (!eanDelMaestro) return;

    const datos = await buscarCodigo(eanDelMaestro);
    assert.ok(datos.producto);
    assert.equal(datos.producto.proveedor, "",
        "el dato es del fabricante; el proveedor lo pone el dueno");
});

test("un producto marcado para revision no se ofrece", async () => {
    if (!datosMaestro?.codigo_fabricante) return;

    await pool.query(
        `UPDATE public.catalogo_maestro_productos
         SET necesita_revision = true, revision_motivo = 'prueba'
         WHERE codigo_fabricante = $1`,
        [datosMaestro.codigo_fabricante]
    );

    try {
        const datos = await buscarCodigo(eanDelMaestro);
        assert.equal(datos.producto, null,
            "con un conflicto sin resolver es mejor no sugerir nada");
    } finally {
        await pool.query(
            `UPDATE public.catalogo_maestro_productos
             SET necesita_revision = false, revision_motivo = ''
             WHERE codigo_fabricante = $1`,
            [datosMaestro.codigo_fabricante]
        );
    }
});

// Agregar producto: el proveedor elegido (Diprofer, Gafi, Truper) manda y la busqueda se queda en SU catalogo.
// Sin proveedor elegido todo sigue como siempre (se busca en todos los catalogos del negocio).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;
const CODIGO = "T-CHOQUE-14957";

const buscar = async (codigo, proveedor) => {
    const url = `${BASE_URL}/catalogo-proveedor/buscar-codigo?codigo=${encodeURIComponent(codigo)}${proveedor ? `&proveedor=${proveedor}` : ""}`;
    return (await fetch(url, { headers: { "x-dispositivo-token": negocio.token } })).json();
};

async function crearCatalogo(nombre, filas) {
    const c = await pool.query(`INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos) VALUES ($1, $2, $3) RETURNING id`, [negocio.negocioId, nombre, filas.length]);

    for (const f of filas) {
        await pool.query(
            `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, precio_publico, precio_distribuidor, precio_medio_mayoreo)
             VALUES ($1, $2, $3, $4, $5, $5, $5)`,
            [negocio.negocioId, c.rows[0].id, f.codigo, f.nombre, f.precio]
        );
    }

    return c.rows[0].id;
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("catalogo-por-proveedor");
    await crearCatalogo("Diprofer", [{ codigo: CODIGO, nombre: "Gato hidraulico botella 2 ton", precio: 450 }, { codigo: "T-SOLO-DIPROFER", nombre: "Cinta aislante negra", precio: 20 }]);
    await crearCatalogo("004BE Durango   Lista de precio    01 Diciembre 2025", [{ codigo: CODIGO, nombre: "Llave de manguera 1/2 laton", precio: 95 }, { codigo: "T-SOLO-GAFI", nombre: "Pinza de presion 10 pulgadas", precio: 180 }]);
});

after(async () => {
    if (negocio) {
        await pool.query(`DELETE FROM public.catalogo_productos WHERE negocio_id = $1`, [negocio.negocioId]);
        await pool.query(`DELETE FROM public.catalogos_proveedor WHERE negocio_id = $1`, [negocio.negocioId]);
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("sin proveedor elegido todo sigue igual: busca en todos y avisa que el codigo es varios productos", async () => {
    const datos = await buscar(CODIGO);
    assert.ok(datos.producto);
    assert.equal(datos.alternativas?.length, 1, "el mismo codigo en dos catalogos con nombres distintos");
    assert.equal(datos.soloProveedor, undefined);
});

test("con Gafi elegido solo sale el producto de Gafi: el choque de codigos ya no se cruza", async () => {
    const datos = await buscar(CODIGO, "gafi");
    assert.equal(datos.producto.nombre, "Llave de manguera 1/2 laton");
    assert.equal(datos.alternativas, undefined, "no hay a quien preguntar: solo existe el de Gafi");
});

test("con Diprofer elegido solo sale el de Diprofer", async () => {
    const datos = await buscar(CODIGO, "diprofer");
    assert.equal(datos.producto.nombre, "Gato hidraulico botella 2 ton");
});

test("un codigo que es de otro proveedor NO se encuentra en el elegido (y se dice cual era)", async () => {
    const datos = await buscar("T-SOLO-DIPROFER", "gafi");
    assert.equal(datos.ok, true);
    assert.equal(datos.producto, null);
    assert.equal(datos.soloProveedor, "Gafi");

    assert.ok((await buscar("T-SOLO-GAFI", "gafi")).producto, "el suyo si");
    assert.equal((await buscar("T-SOLO-GAFI", "diprofer")).producto, null);
});

test("con Truper elegido solo salen productos de Truper: un codigo de otro proveedor no", async () => {
    assert.equal((await buscar("T-SOLO-GAFI", "truper")).producto, null);
    assert.equal((await buscar("T-SOLO-GAFI", "truper")).soloProveedor, "Truper");
});

test("un proveedor que no existe se ignora (se busca en todos, como antes)", async () => {
    const datos = await buscar("T-SOLO-GAFI", "inventado");
    assert.ok(datos.producto);
});

test("no esta en la lista del proveedor pero es un producto conocido: se ofrece su identidad SIN precio", async () => {
    const m = (await pool.query(
        `SELECT codigo_fabricante FROM public.catalogo_maestro_productos
          WHERE fabricante = 'Truper' AND COALESCE(codigo_fabricante,'') <> '' AND NOT necesita_revision
          ORDER BY id LIMIT 1`
    )).rows[0];

    if (!m) { console.log("    (sin productos Truper en el Maestro)"); return; }

    const datos = await buscar(m.codigo_fabricante, "gafi");
    assert.equal(datos.producto, null, "no se mezcla con el catalogo de Gafi");
    assert.ok(datos.sugerencia, "se ofrece la identidad del Maestro");
    assert.equal(datos.sugerenciaFabricante, "Truper");
    assert.equal(datos.sugerencia.publico, null, "el precio de lista de Truper no es el de Gafi");
    assert.equal(datos.sugerencia.medioMayoreo, null);
    assert.equal(datos.sugerencia.distribuidor, null);

    assert.equal((await buscar("T-NO-EXISTE-NI-EN-EL-MAESTRO", "gafi")).sugerencia, undefined, "un codigo desconocido no sugiere nada");
});

test("pantalla: solo manda con la funcion encendida y se reinicia al cerrar el formulario", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
    const js = leer("public/js/product-inventory.js");

    assert.match(js, /funcionBeta\("catalogo_por_proveedor"\)/, "apagada, el selector se comporta como siempre");
    assert.match(js, /&proveedor=\$\{encodeURIComponent\(soloProveedor\)\}/);
    assert.match(js, /proveedorElegidoNombre \|\|\s+producto\.proveedor/, "el proveedor elegido gana sobre el nombre del archivo de la lista");
    assert.match(js, /Agregar sin precio/);
    assert.match(js, /proveedorCatalogoElegido = null;\r?\n\r?\n aplicarModoCapturaProducto\("barras"\)/, "se reinicia con el formulario");
});

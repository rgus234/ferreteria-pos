// Bug real encontrado auditando Ferreteria Olimpico (negocio_id 1): el
// paso de vinculacion automatica por nombre (vincularCatalogoProductos,
// catalog-server.js) no impedia que VARIAS filas del catalogo de un
// proveedor quedaran "vinculadas" al MISMO producto -- nombres con un
// patron de texto muy repetitivo (ej. "Bolsa con 50 tornillos 3/8' x
// 2-1/4' tipo coche, FIERO" vs decenas de variantes de tornillos con la
// misma forma) pasaban el umbral de similitud contra el mismo producto
// una y otra vez. Con eso, "Actualizar precios" no tiene forma de saber
// cual fila es la de verdad: el precio que termina en productos.precio
// es el ultimo que se proceso, no el correcto. Auditoria real: 476
// productos con mas de una fila de catalogo apuntandoles, uno con 222.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("cat-vinc-unica");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function importar(proveedor, productos) {
    const respuesta = await fetch(
        `${BASE_URL}/catalogo-proveedor/${encodeURIComponent(proveedor)}/subir`,
        { method: "POST", headers: headers(), body: JSON.stringify({ productos }) }
    );
    return respuesta.json();
}

async function filaCatalogo(codigo) {
    const fila = await pool.query(
        `SELECT producto_id, estado FROM public.catalogo_productos WHERE negocio_id = $1 AND codigo_proveedor = $2`,
        [negocio.negocioId, codigo]
    );
    return fila.rows[0];
}

test("dos filas de nombre parecido al mismo producto: solo la de mayor similitud queda vinculada", async () => {
    const nombreProducto = "Bolsa con 50 tornillos 3/8' x 2-1/4' tipo coche, FIERO";
    const producto = await crearProductoPrueba(negocio.negocioId, { nombre: nombreProducto, codigo: "TORN-VINC-A" });

    const datos = await importar("Proveedor vinculacion A", [
        // Coincidencia perfecta de nombre (sin codigo en comun con el producto).
        { codigo: "CAT-V1", nombre: nombreProducto, distribuidor: 100, medioMayoreo: 130, publico: 150 },
        // Mismo patron de texto ("Bolsa con N tornillos .../..., FIERO"), pero
        // OTRO producto -- antes del fix, esto tambien terminaba vinculado.
        { codigo: "CAT-V2", nombre: "Bolsa con 100 tornillos 1/4' x 1-1/4' tipo máquina, FIERO", distribuidor: 80, medioMayoreo: 107, publico: 118 }
    ]);
    assert.equal(datos.ok, true);

    const fila1 = await filaCatalogo("CAT-V1");
    const fila2 = await filaCatalogo("CAT-V2");

    assert.equal(fila1.producto_id, producto.id, "la coincidencia perfecta si se vincula");
    assert.notEqual(fila2.producto_id, producto.id, "la coincidencia mas debil NO se queda con el mismo producto");
});

test("codigo exacto (Paso 1) nunca pierde el producto ante un nombre identico de otra fila (Paso 2)", async () => {
    const nombreProducto = "Llave inglesa ajustable 10 pulgadas cromada, prueba";
    const producto = await crearProductoPrueba(negocio.negocioId, { nombre: nombreProducto, codigo: "LLAVE-VINC-EXACTA" });

    const datos = await importar("Proveedor vinculacion B", [
        // Codigo identico al del producto, pero nombre que NO se parece --
        // solo deberia vincularse por Paso 1 (codigo), nunca por nombre.
        { codigo: "LLAVE-VINC-EXACTA", nombre: "Herramienta ajustable importada, ref distinta", distribuidor: 90, medioMayoreo: 120, publico: 135 },
        // Nombre IDENTICO al del producto, codigo distinto -- si el fix no
        // funcionara, esta fila tambien terminaria "vinculada" al mismo
        // producto que la de arriba.
        { codigo: "LLAVE-VINC-OTRA", nombre: nombreProducto, distribuidor: 60, medioMayoreo: 80, publico: 95 }
    ]);
    assert.equal(datos.ok, true);

    const porCodigo = await filaCatalogo("LLAVE-VINC-EXACTA");
    const porNombre = await filaCatalogo("LLAVE-VINC-OTRA");

    assert.equal(porCodigo.producto_id, producto.id, "el match por codigo exacto se queda con el producto");
    assert.notEqual(porNombre.producto_id, producto.id, "el match por nombre no puede quitarselo ni duplicarlo");
});

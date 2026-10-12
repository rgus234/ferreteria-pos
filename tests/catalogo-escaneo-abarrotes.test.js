// Escanear un producto de abarrotes que el negocio no tiene: el Catalogo
// Maestro lo reconoce y entrega todo lo que la pantalla de Agregar producto
// necesita para autollenarse (nombre con su tamano, marca, categoria Nexo).
//
// Las reglas que protegen a lo existente: el catalogo de proveedor PROPIO del
// negocio sigue mandando, y los productos de ferreteria no cambian de forma.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { cargarMasivo } = require("../catalogo-maestro-carga-masiva");
const { revertir, eanValido } = require("../catalogo-maestro-reconciliacion");

let negocio;
let corrida;
let ean;
let eanSinCategoria;
let categoriaRefrescos;

function eanSintetico() {
    const base = "99" + String(Math.floor(Math.random() * 1e10)).padStart(10, "0");
    const digitos = base.split("").map(Number).reverse();
    const suma = digitos.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
    const codigo = base + ((10 - (suma % 10)) % 10);
    assert.ok(eanValido(codigo));
    return codigo;
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("escaneo-abarrotes");

    ean = eanSintetico();
    eanSinCategoria = eanSintetico();
    categoriaRefrescos = (await pool.query(`SELECT id FROM public.categorias_nexo WHERE giro = 'abarrotes' AND nombre = 'Refrescos'`)).rows[0].id;

    const r = await cargarMasivo(pool, [
        { ean, nombre: "Refresco de cola prueba", marca: "Marca Prueba", fabricante: "Marca Prueba", presentacion: "600ml",
          categoriaNexoId: categoriaRefrescos, fuente: "Open Food Facts", fuenteFecha: new Date(), origen: "open_food_facts" },
        { ean: eanSinCategoria, nombre: "Producto sin clasificar prueba", marca: "", fabricante: "", presentacion: "",
          categoriaNexoId: null, fuente: "Open Food Facts", fuenteFecha: new Date(), origen: "open_food_facts" }
    ], { fuente: "Open Food Facts" });
    corrida = r.reconciliacionId;
});

after(async () => {
    if (corrida) await revertir(pool, corrida).catch(() => {});
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

async function escanear(codigo) {
    const respuesta = await fetch(`${BASE_URL}/catalogo-proveedor/buscar-codigo?codigo=${encodeURIComponent(codigo)}`, {
        headers: { "x-dispositivo-token": negocio.token }
    });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

test("un abarrote desconocido por el negocio llega con nombre y tamano, marca y categoria Nexo", async () => {
    const { status, cuerpo } = await escanear(ean);

    assert.equal(status, 200);
    const p = cuerpo.producto;
    assert.ok(p, "el Maestro lo reconoce");
    assert.equal(p.nombre, "Refresco de cola prueba 600 ml", "el tamano se suma al nombre");
    assert.equal(p.nombreOriginal, "Refresco de cola prueba");
    assert.equal(p.presentacion, "600 ml");
    assert.equal(p.marca, "Marca Prueba");
    assert.equal(p.codigoBarras, ean);
    assert.equal(p.categoriaNexoId, categoriaRefrescos);
    assert.equal(p.categoriaNexoNombre, "Refrescos");
    assert.equal(p.categoriaNexoDepartamento, "Bebidas");
    assert.equal(p.origen, "catalogo_nexo");
    assert.equal(p.origenMaestro, "open_food_facts");
    assert.ok(Number.isInteger(p.catalogoMaestroId) && p.catalogoMaestroId > 0, "queda enlazado al Maestro al guardar");
});

test("no se inventan precios: Open Food Facts no los trae", async () => {
    const { cuerpo } = await escanear(ean);
    const p = cuerpo.producto;
    assert.ok(!p.publico && !p.medioMayoreo && !p.distribuidor && !p.mayoreo);
});

test("un producto sin clasificar llega sin categoria, no con una inventada", async () => {
    const { cuerpo } = await escanear(eanSinCategoria);
    const p = cuerpo.producto;
    assert.equal(p.nombre, "Producto sin clasificar prueba");
    assert.equal(p.categoriaNexoId, null);
    assert.equal(p.categoriaNexoNombre, "");
});

test("el catalogo de proveedor PROPIO del negocio sigue mandando sobre el Maestro", async () => {
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor) VALUES ($1, 'Mayorista de prueba') RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, codigo_barras, nombre_proveedor, marca, precio_publico)
         VALUES ($1, $2, 'MP-1', $3, 'Refresco de cola del mayorista', 'Marca Mayorista', 21.5)`,
        [negocio.negocioId, catalogo.rows[0].id, ean]
    );

    const { cuerpo } = await escanear(ean);

    assert.equal(cuerpo.producto.nombre, "Refresco de cola del mayorista");
    assert.equal(Number(cuerpo.producto.publico), 21.5);
    assert.notEqual(cuerpo.producto.origenMaestro, "open_food_facts", "no es la respuesta del Maestro");
});

test("un codigo que nadie conoce no devuelve nada", async () => {
    const { cuerpo } = await escanear(eanSintetico());
    assert.equal(cuerpo.producto, null);
});

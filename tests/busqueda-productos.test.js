// Busqueda del POS por palabras sueltas: los casos reales de Ferreteria Olimpico (catalogos con nombres muy largos).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { productoCoincidePalabras, puntajeBusquedaProducto, normalizarBusquedaProducto } = require("../public/js/busqueda-productos.js");

const productos = [
    { nombre: "Codo 90° de cobre 3/4', FOSET BASIC", marca: "Foset", codigo: "77506240627349" },
    { nombre: "Codo humo 160mm 6 galvanizado s/m", marca: "SIN MARCA", codigo: "450" },
    { nombre: "CODO PVC 3\"", codigo: "PROD-7200" },
    { nombre: "Codo reducción 90° de CPVC de 3/4' x 1/2', Foset", marca: "Foset", codigo: "45082" },
    { nombre: "Codo 90° PPR, 3/4', FOSET", marca: "Foset", codigo: "7506240628439" },
    { nombre: "Codo pvc 45° 4\"", marca: "Amanco", codigo: "GEN593199" },
    { nombre: "Tubo PPR 3/4 x 4 m", marca: "Foset", codigo: "111", categoria: "Plomería" },
    { nombre: "Pintura vinílica blanca 19 L", marca: "Comex", codigo: "222", codigos_relacionados: [{ codigo: "7501234567890" }] }
];

const buscar = texto => productos.filter(p => productoCoincidePalabras(p, texto)).map(p => p.nombre);

test("las palabras se buscan por separado: 'codo 45' encuentra el codo pvc 45", () => {
    assert.deepEqual(buscar("codo 45"), ["Codo pvc 45° 4\""]);
});

test("'codo 3/4' encuentra todos los codos de 3/4 aunque lleven comillas, grados o palabras en medio", () => {
    const r = buscar("codo 3/4");
    assert.equal(r.length, 3);
    assert.ok(r.every(n => /codo/i.test(n) && n.includes("3/4")));
});

test("'ppr' trae todo lo que dice PPR, en el nombre de cualquier producto", () => {
    assert.deepEqual(buscar("ppr"), ["Codo 90° PPR, 3/4', FOSET", "Tubo PPR 3/4 x 4 m"]);
    assert.deepEqual(buscar("codo ppr 3/4"), ["Codo 90° PPR, 3/4', FOSET"]);
});

test("no importan mayusculas, acentos, comillas de pulgada ni el orden", () => {
    assert.equal(buscar("REDUCCION cpvc").length, 1);
    assert.deepEqual(buscar("3/4' codo ppr"), buscar("ppr codo 3/4"));
    assert.equal(normalizarBusquedaProducto("  3/4\"  Codo "), "3/4 codo");
});

test("tambien busca por marca, categoria, codigo y codigos relacionados", () => {
    assert.equal(buscar("foset").length, 4);
    assert.deepEqual(buscar("plomeria"), ["Tubo PPR 3/4 x 4 m"]);
    assert.deepEqual(buscar("7506240628439"), ["Codo 90° PPR, 3/4', FOSET"]);
    assert.deepEqual(buscar("7501234567890"), ["Pintura vinílica blanca 19 L"]);
});

test("una palabra que no esta en ningun lado deja la lista vacia y una busqueda vacia trae todo", () => {
    assert.deepEqual(buscar("codo martillo"), []);
    assert.equal(buscar("").length, productos.length);
});

test("el orden pone primero lo que empieza con lo escrito", () => {
    const orden = productos.filter(p => productoCoincidePalabras(p, "ppr")).sort((a, b) => puntajeBusquedaProducto(b, "ppr") - puntajeBusquedaProducto(a, "ppr"));
    assert.ok(puntajeBusquedaProducto(productos[4], "codo 90") >= puntajeBusquedaProducto(productos[5], "codo 90"));
    assert.equal(orden.length, 2);
});

test("el POS usa la busqueda por palabras y la carga antes del inventario", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    const inventario = fs.readFileSync(path.join(__dirname, "..", "public", "js", "product-inventory.js"), "utf8");

    assert.ok(html.indexOf("js/busqueda-productos.js") > 0 && html.indexOf("js/busqueda-productos.js") < html.indexOf("js/product-inventory.js"));
    assert.match(inventario, /return productoCoincidePalabras\(producto, texto\)/);
});

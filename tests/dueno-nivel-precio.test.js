// El celular cobra al mismo nivel de precio que la computadora (caso real: "Mouse y Rat" $30 en el mostrador y $45 en el celular).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

// dueno-offline.js se ejecuta tal cual, con un navegador de mentira (solo se usan las funciones de precio)
function cargarOffline(nivel, guardado) {
    const contexto = { window: { duenoNivelPrecio: nivel }, localStorage: { getItem: () => guardado ?? null, setItem() {} }, indexedDB: {}, console, navigator: {} };
    vm.createContext(contexto);
    vm.runInContext(leer("dueno-offline.js") + "\n;this.__f = { precioSegunNivelDueno, nivelPrecioDueno, conNivelPrecioDueno };", contexto);
    return contexto.__f;
}

const mouse = { id: 1, nombre: "Mouse y Rat", precio: 45, precioPublico: 45, precioMayoreo: 30, precioDistribuidor: 22 };

test("Ferreteria Olimpico (medio mayoreo): el celular cobra $30, igual que el mostrador, y no los $45 del precio publico", () => {
    assert.equal(cargarOffline("mayoreo").precioSegunNivelDueno(mouse), 30);
});

test("nivel publico cobra el publico; distribuidor cobra el de distribuidor", () => {
    assert.equal(cargarOffline("publico").precioSegunNivelDueno(mouse), 45);
    assert.equal(cargarOffline("distribuidor").precioSegunNivelDueno(mouse), 22);
});

test("si el producto no tiene precio para ese nivel se cae al publico (igual que el POS de escritorio), nunca a cero", () => {
    const sinMayoreo = { ...mouse, precioMayoreo: null };
    assert.equal(cargarOffline("mayoreo").precioSegunNivelDueno(sinMayoreo), 45);
    assert.equal(cargarOffline("mayoreo").precioSegunNivelDueno({ precio: 18 }), 18, "catalogo guardado antes de este cambio: sigue cobrando lo que cobraba");
});

test("sin saber el nivel (sin internet y nunca abierto) se queda en publico; con el nivel guardado lo usa", () => {
    assert.equal(cargarOffline(undefined, null).nivelPrecioDueno(), "publico");
    assert.equal(cargarOffline(undefined, "mayoreo").nivelPrecioDueno(), "mayoreo");
    assert.equal(cargarOffline(undefined, "basura").nivelPrecioDueno(), "publico");
});

test("el catalogo que lee el celular trae el precio de venta del nivel, para listas, favoritos y carrito", () => {
    const f = cargarOffline("mayoreo");
    assert.deepEqual(f.conNivelPrecioDueno([mouse]).map(p => p.precio), [30]);
    assert.equal(mouse.precio, 45, "no se altera el producto guardado");

    const js = leer("dueno-offline.js");
    assert.match(js, /precioMayoreo: producto\.precio_mayoreo != null/, "se guarda el precio de medio mayoreo");
    assert.equal((js.match(/conNivelPrecioDueno\(/g) || []).length >= 3, true, "buscar y listar devuelven el precio del nivel");
    assert.match(leer("dueno-ventas-offline.js"), /conNivelPrecioDueno\(todos\)/, "tambien el catalogo completo (Tus productos)");
    assert.match(leer("dueno-inventario.js"), /precioSegunNivelDueno\(producto\)/, "tambien lo que se busca por codigo alterno en el servidor");
});

test("el nivel sale de /negocio-actual: abarrotes siempre publico, los demas el que configuro el negocio y, si no hay, medio mayoreo como la computadora", () => {
    const js = leer("dueno-giro.js");
    assert.match(js, /window\.duenoNivelPrecio = giro\.abarrotesSolo \? "publico"/);
    assert.match(js, /\? nivelConfigurado : "mayoreo"/);
    assert.match(js, /localStorage\.setItem\("nexoDuenoNivelPrecio"/, "se guarda para arrancar sin internet");
    assert.match(leer("dueno-sw.js"), /nivel-20261101-01/);
});

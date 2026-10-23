// "Mi tienda" en /dueno: solo se carga si esta cableada en la pagina y en el service worker.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

test("Mi tienda esta enlazada en dueno.html y cacheada por el service worker", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");

    assert.match(html, /dueno-tienda\.js\?v=/);
    assert.match(html, /dueno-tienda\.css\?v=/);
    assert.match(sw, /\/dueno-tienda\.js\?v=/);
    assert.match(sw, /\/dueno-tienda\.css\?v=/);
});

test("Mi tienda usa los endpoints existentes y solo aparece con abarrotes", () => {
    const js = leer("dueno-tienda.js");

    for (const ruta of ["/abarrotes/inicio", "/lotes/por-revisar", "/pedido-sugerido", "/pedidos-proveedor", "/merma", "/entrada"]) assert.ok(js.includes(ruta), ruta);
    assert.match(js, /girosActivos/);
    assert.match(js, /fetchAutenticado/);
});

test("el pedido sugerido abre el WhatsApp del proveedor y los favoritos se pueden reordenar", () => {
    const servidor = fs.readFileSync(path.join(__dirname, "..", "pedido-sugerido-server.js"), "utf8");
    const pedido = leer("js/pedido-sugerido.js");
    const favoritos = leer("js/favoritos-pos.js");

    assert.match(servidor, /telefono: proveedor\.telefono/);
    assert.match(pedido, /"52" \+ digitos/);
    assert.match(pedido, /pedSugEnviar/);
    assert.match(leer("dueno-tienda.js"), /"52" \+ digitos/);
    assert.match(favoritos, /async function favMover/);
    assert.match(favoritos, /favMover\(\$\{producto\.id\}, -1\)/);
});

// Computadora: todos los scripts que carga index.html compilan (un error de sintaxis tumba el archivo entero en silencio) y
// las funciones nuevas (Mapa de la tienda, Funciones nuevas) vienen conectadas pero APAGADAS por defecto.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const publico = ruta => path.join(__dirname, "..", "public", ruta);
const html = fs.readFileSync(publico("index.html"), "utf8");

test("todos los scripts de la computadora compilan", () => {
    const scripts = [...html.matchAll(/<script[^>]+src="(js\/[^"?]+)/g)].map(m => m[1]);
    assert.ok(scripts.length > 40, "se leyeron los scripts de index.html");

    for (const ruta of scripts) {
        const codigo = fs.readFileSync(publico(ruta), "utf8");
        assert.doesNotThrow(() => new vm.Script(codigo, { filename: ruta }), `error de sintaxis en ${ruta}`);
    }
});

test("Mapa de la tienda y Funciones nuevas estan conectados y el mapa nace oculto", () => {
    assert.match(html, /data-shell-module="mapa-tienda" data-beta="mapa_tienda" hidden onclick="mostrarMapaTienda\(\)"/, "el boton del mapa empieza oculto");
    assert.match(html, /onclick="mostrarFuncionesBeta\(\)"/, "Funciones nuevas siempre se puede abrir (ahi se enciende)");
    assert.match(html, /id="pantallaMapaTienda"/);
    assert.match(html, /id="pantallaFuncionesBeta"/);
    assert.match(html, /js\/funciones-beta\.js/);
    assert.match(html, /js\/mapa-tienda-view\.js/);
    assert.match(html, /css\/components\/mapa-tienda\.css/);

    const ocultar = fs.readFileSync(publico("js/config-auth.js"), "utf8");
    assert.match(ocultar, /"pantallaMapaTienda"/, "al cambiar de pantalla el mapa se esconde");
    assert.match(ocultar, /"pantallaFuncionesBeta"/);
});

test("la funcion beta responde false hasta que el negocio la enciende", () => {
    const codigo = fs.readFileSync(publico("js/funciones-beta.js"), "utf8");
    const contexto = { window: {}, document: { addEventListener() {}, readyState: "loading", querySelectorAll: () => [], documentElement: { classList: { toggle() {} } }, dispatchEvent() {} }, CustomEvent: function () {}, fetch: async () => ({ ok: false }), setTimeout() {} };
    vm.runInNewContext(codigo, contexto);

    assert.equal(contexto.window.funcionBeta("mapa_tienda"), false);
    assert.equal(contexto.window.funcionBeta("cualquier_cosa"), false);
});

test("el mapa usa las mismas rutas del servidor que el celular", () => {
    const codigo = fs.readFileSync(publico("js/mapa-tienda-view.js"), "utf8");

    for (const ruta of ["/ubicaciones/resumen", "/ubicaciones/buscar", "/ubicaciones/plantilla", "/resurtir", "/conteos"]) {
        assert.ok(codigo.includes(ruta), "usa " + ruta);
    }

    assert.match(codigo, /\/conteos\/\$\{c\.id\}\/\$\{accion\}/, "aprueba o rechaza los conteos que se hacen en el celular");
});

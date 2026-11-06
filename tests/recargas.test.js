// Recargas (tiempo aire): pantalla en modo demostracion detras de la funcion "recargas". Hoy no mueve dinero de verdad.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");

test("la pantalla esta cableada detras de su funcion y nace oculta", () => {
    const html = leer("public/index.html");
    assert.match(html, /data-shell-module="recargas" data-beta="recargas" hidden onclick="mostrarRecargas\(\)"/);
    assert.match(html, /id="pantallaRecargas"/);
    assert.match(html, /js\/recargas-view\.js/);
    assert.match(html, /css\/components\/recargas\.css/);
    assert.match(leer("public/js/config-auth.js"), /"pantallaRecargas"/, "la pantalla se oculta al cambiar de seccion");
    assert.match(leer("funciones-beta-server.js"), /recargas: "Recargas"/);
});

test("modo demostracion por defecto: avisa en pantalla, no llama a ningun servidor y todo pasa por UN adaptador (el real solo con el servidor configurado)", () => {
    const js = leer("public/js/recargas-view.js");
    assert.match(js, /Modo demostración/, "se ve que no es dinero de verdad");
    assert.match(js, /no se recarga ni se cobra nada de verdad/i);
    assert.match(js, /let adaptador = ADAPTADOR_DEMO;/, "arranca siempre en demostracion");
    assert.ok(js.includes('fetch("/recargas/modo")'), "el servidor decide si hay recargas reales");
    assert.ok(js.includes('modoPantalla === "demostracion" ? ADAPTADOR_DEMO : ADAPTADOR_REAL'));

    const demo = js.slice(js.indexOf("const ADAPTADOR_DEMO"), js.indexOf("const ADAPTADOR_REAL"));
    assert.ok(demo.length > 200 && !demo.includes("fetch("), "el adaptador de demostracion no llama a ningun servidor: nada sale de este equipo");
    ["estado()", "recargar({", "agregarSaldo(monto)"].forEach(m => assert.ok(demo.includes(m), `el adaptador ofrece ${m}`));
});

test("reglas de la pantalla: 10 digitos, monto desde $10 con tope, saldo suficiente", () => {
    const js = leer("public/js/recargas-view.js");
    assert.match(js, /eleg\.numero\.length !== 10/);
    assert.match(js, /monto < 10/);
    assert.match(js, /monto > TOPE_MONTO/);
    assert.match(js, /monto > datos\.saldo/);
    assert.match(js, /Saldo insuficiente/);
});

test("tiene modo oscuro y respeta el movimiento reducido", () => {
    const css = leer("public/css/components/recargas.css");
    assert.match(css, /body\.oscuro \.rc-paso/);
    assert.match(css, /prefers-reduced-motion/);
});

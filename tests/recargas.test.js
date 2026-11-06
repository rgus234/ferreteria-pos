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

test("modo demostracion: avisa en pantalla y todo pasa por UN adaptador que se cambia al conectar el proveedor", () => {
    const js = leer("public/js/recargas-view.js");
    assert.match(js, /Modo demostración/, "se ve que no es dinero de verdad");
    assert.match(js, /no se recarga ni se cobra nada de verdad/i);
    assert.match(js, /const adaptador = ADAPTADOR_DEMO;/, "un solo punto para conectar el proveedor");
    ["estado()", "recargar({", "agregarSaldo(monto)"].forEach(m => assert.ok(js.includes(m), `el adaptador ofrece ${m}`));
    assert.ok(!/fetch\(/.test(js), "no llama a ningun servidor: nada sale de este equipo");
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

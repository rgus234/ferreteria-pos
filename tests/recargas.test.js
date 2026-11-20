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

test("celular: tarjeta en el Inicio solo con la funcion encendida, mismo servidor y mismas reglas que la computadora, cache del celular renovado", () => {
    const js = leer("public/dueno-recargas.js");
    assert.ok(js.includes('funciones?.recargas === true'), "sin la funcion no hay tarjeta");
    assert.ok(js.includes("#duenoApp .dueno-kpis"), "la tarjeta va en el Inicio");
    ["/recargas/modo", "/recargas/saldo", "/recargas/historial", "/recargas/recargar", "/recargas/productos"].forEach(ruta => assert.ok(js.includes(ruta), "usa " + ruta));
    assert.ok(js.includes('LLAVE = "nexoRecargasDemo"'), "comparte el historial de demostracion con la computadora");
    assert.ok(js.includes("let adaptador = ADAPTADOR_DEMO;"), "arranca en demostracion");
    assert.ok(!/TAECEL_KEY|TAECEL_NIP|process\.env/.test(js), "el celular nunca conoce las claves");
    assert.ok(js.includes("fetchAutenticado"), "usa la sesion del celular");

    const demo = js.slice(js.indexOf("const ADAPTADOR_DEMO"), js.indexOf("const ADAPTADOR_REAL"));
    assert.ok(demo.length > 200 && !demo.includes("fetch"), "la demostracion no llama a ningun servidor");

    const html = leer("public/dueno.html");
    const sw = leer("public/dueno-sw.js");
    const version = /dueno-recargas\.js\?v=([\w-]+)/.exec(html)[1];
    const css = /dueno-recargas\.css\?v=([\w-]+)/.exec(html)[1];
    assert.ok(sw.includes("/dueno-recargas.js?v=" + version) && sw.includes("/dueno-recargas.css?v=" + css), "el celular guarda los archivos nuevos");
    assert.match(leer("public/dueno-recargas.css"), /:root\.oscuro \.drc-paso/, "tiene modo oscuro");
});

test("logos de marca: las compañías principales, los servicios y tarjetas del catalogo tienen su archivo propio (sin depender de Taecel)", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = path.join(__dirname, "..", "public", "img", "marcas");
    const js = leer("public/js/recargas-view.js");
    // ids de Taecel: Telcel, Movistar, AT&T, Unefon, BAIT, Virgin, Weex, CFE, Telmex, SKY, Izzi, Megacable, Gas Natural, Google Play, Netflix, Amazon, Roblox, Xbox, Nintendo, Uber
    ["1", "2", "5", "4", "239", "11", "93", "7", "6", "10", "43", "18", "64", "211", "87", "166", "294", "155", "80", "147"].forEach(id => {
        const archivo = path.join(dir, `${id}.png`);
        assert.ok(fs.existsSync(archivo), `falta el logo ${id}.png`);
        assert.ok(fs.statSync(archivo).size < 60 * 1024, `el logo ${id}.png pesa demasiado`);
        assert.deepEqual([...fs.readFileSync(archivo).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${id}.png es un PNG de verdad`);
    });
    assert.ok(js.includes("/img/marcas/"), "la pantalla usa los logos propios");
    assert.ok(!/cdn\.(taecel|pagomex)\.com/.test(js), "la pantalla no carga imagenes de los servidores de Taecel");
});

test("servicios y tarjetas: los celulares y referencias recientes se pueden tocar pero siguen pidiendo confirmar", () => {
    const js = leer("public/js/recargas-view.js");
    assert.ok(js.includes("htmlRecientesSvc") && js.includes('data-rc="svc-reciente"'), "hay lista de recientes");
    const accion = js.slice(js.indexOf('accion === "svc-reciente"'), js.indexOf('accion === "svc-reciente"') + 260);
    assert.ok(accion.includes("abrirConfirmacion()"), "un reciente abre la confirmacion, no paga directo");
    assert.ok(js.includes("recibidoHoy(s.id, n)"), "en las marcas con tope se ve cuanto lleva ya el celular hoy");
});

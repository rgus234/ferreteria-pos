// Lector de codigos del celular: todas las pantallas usan el lector compartido (nativo si existe, ZXing bien configurado si no).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

test("Vender, Inventario, Captura y Pedidos usan el lector compartido y ninguno vuelve a la configuracion por defecto de ZXing", () => {
    for (const archivo of ["dueno.js", "dueno-inventario.js", "dueno-captura.js"]) {
        const js = leer(archivo);
        assert.match(js, /iniciarLectorCodigosDueno\(/, `${archivo} usa el lector compartido`);
        assert.doesNotMatch(js, /decodeFromVideoDevice\(undefined/, `${archivo} no usa la configuracion por defecto (un intento cada 500 ms)`);
    }

    assert.equal((leer("dueno.js").match(/iniciarLectorCodigosDueno\(/g) || []).length, 2, "Pedidos y Vender");
    assert.match(leer("dueno-inventario.js"), /iniciarLectorCodigosDueno\(video,[\s\S]*?\{ qr: true \}/, "el escaner de Inventario tambien lee el QR para enlazar el celular");
});

test("el lector prueba primero el nativo del celular y si no, ZXing solo con formatos de producto, mas rapido y con enfoque continuo", () => {
    const js = leer("dueno-lector.js");
    assert.match(js, /"BarcodeDetector" in window/, "lector nativo cuando existe");
    assert.match(js, /BrowserMultiFormatOneDReader/, "ZXing solo de codigos de barras (sin QR, Aztec ni PDF417) salvo que se pida el QR");
    assert.match(js, /delayBetweenScanAttempts: 80/, "un intento cada 80 ms en vez de cada 500");
    assert.match(js, /width: \{ ideal: 1280 \}/, "camara de 1280x720");
    assert.match(js, /focusMode: "continuous"/, "enfoque continuo");
    for (const formato of ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39"]) assert.ok(js.includes(formato), formato);
    assert.match(js, /torch/, "linterna cuando el celular la tiene");
    assert.match(js, /NotAllowedError/, "sin permiso de camara se avisa en vez de intentar de nuevo");
});

test("Vender encuentra el producto aunque el codigo traiga el cero inicial del UPC, guiones o mayusculas, y pregunta al servidor por codigos alternos", () => {
    const js = leer("dueno.js");
    assert.match(js, /const claveCodigo = c =>/);
    assert.match(js, /replace\(\/\^0\+\/, ""\)/, "UPC-A de 12 y EAN-13 con 0 son el mismo codigo");
    assert.match(js, /buscarProductoPorCodigoDueno\(codigoLimpio\)/, "codigos alternos y de proveedor por el servidor");
});

test("el lector esta en la pagina y en el service worker, y el cache del celular se renovo", () => {
    assert.match(leer("dueno.html"), /dueno-lector\.js\?v=/);
    assert.match(leer("dueno-sw.js"), /\/dueno-lector\.js\?v=/);
    assert.doesNotMatch(leer("dueno-sw.js"), /nexo-dueno-shell-v12[0-3]"/);
});

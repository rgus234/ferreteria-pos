// Placeholders que no caben en la casilla: se ajustan en todo el sistema (public/js/placeholder-ajuste.js).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

test("el ajuste de placeholders se carga antes que el resto de la app y baja la letra antes de cortar", () => {
    const indice = leer("index.html");
    const js = leer("js/placeholder-ajuste.js");

    assert.ok(indice.indexOf("js/placeholder-ajuste.js") < indice.indexOf("js/product-inventory.js"));
    assert.match(js, /TAMANO_MINIMO = 11/);
    assert.match(js, /measureText/, "mide el texto contra el ancho real de la casilla");
    assert.match(js, /new MutationObserver/, "alcanza a los campos que aparecen despues o cambian de pista");
    assert.match(js, /new ResizeObserver/, "revisa los campos que estaban ocultos cuando se mostraron");
    assert.match(js, /puestoAqui/, "no borra un globito puesto a proposito por el codigo");
});

test("el formulario de producto usa pistas cortas y deja la aclaracion larga como globito", () => {
    const indice = leer("index.html");
    const inventario = leer("js/product-inventory.js");

    assert.match(indice, /id="factorConversion"[^>]*placeholder="Ej\. 100"[^>]*title="Equivalencia de compra/);
    assert.match(inventario, /campoStock\.title = /);
    assert.doesNotMatch(inventario, /placeholder = `\$\{etiquetaContenedor\.plural\} \$\{cerrados\} \(0 si solo tienes sueltas\)`/);

    // La vida util lleva etiqueta como los demas campos y solo la ve abarrotes.
    assert.match(indice, /<label class="campo-ficha campo-vida-util">\s*<span>Vida util \(dias\)<\/span>/);
    assert.match(leer("css/components/perfil-negocio.css"), /body:not\(\.perfil-con-abarrotes\) \.campo-vida-util \{ display: none !important; \}/);
});

test("las tarjetas de exhibidores no se salen: botones que bajan de fila y fotos con ancho flexible", () => {
    const css = leer("css/components/exhibidores.css");

    assert.match(css, /\.exh-card-acciones \{[^}]*flex-wrap: wrap/);
    assert.match(css, /\.exh-card-fotos \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
});

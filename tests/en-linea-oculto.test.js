// "En linea" (Mi sitio web y Nexo Market) esta oculto mientras se termina: no se promete en la app ni en la pagina oficial.
// Es reversible: los datos y las rutas siguen intactos, solo se esconde la entrada.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
const sinComentarios = html => html.replace(/<!--[\s\S]*?-->/g, "");

test("escritorio: Pedidos y Sitio web no aparecen en el menu y el formulario no habla de Market", () => {
    const html = leer("index.html");
    assert.match(html, /data-shell-module="pedidos-market" data-en-linea-oculto hidden/);
    assert.match(html, /data-shell-module="sitio-web" data-en-linea-oculto hidden/);
    assert.match(html, /css\/components\/en-linea-oculto\.css/);
    assert.match(html, /<h2>Visibilidad<\/h2>/, "la seccion ya no se llama Market y pedidos");

    const css = leer("css/components/en-linea-oculto.css");
    assert.match(css, /\[data-en-linea-oculto\] \{ display: none !important; \}/);
    assert.match(css, /@layer nexo-product-form/, "gana a la regla de display del formulario");
    for (const id of ["nuevoVisibleMarket", "nuevoDisponiblePedidos", "nuevoDestacado", "nuevoPrecioOferta"]) assert.match(css, new RegExp(`:has\\(#${id}\\)`));
    assert.doesNotMatch(css, /nuevoVisiblePos/, "Visible en el punto de venta se queda");
});

test("celular: sin 'Comprar en Nexo Market' ni la pestaña Pedidos, y se sube la version del cache", () => {
    const html = leer("dueno.html");
    assert.match(html, /data-en-linea-oculto hidden onclick="mostrarPromptMarketDueno\(\)/);
    assert.match(html, /data-tab="pedidos" data-en-linea-oculto hidden/);
    assert.doesNotMatch(html, /compra en negocios Nexo cerca de ti/);
    assert.match(leer("dueno.css"), /\[data-en-linea-oculto\] \{ display: none !important; \}/);
    assert.match(leer("dueno-sw.js"), /nexo-dueno-shell-v13[5-9]|nexo-dueno-shell-v1[4-9]\d/);
});

test("pagina oficial: sin menu, tarjeta ni seccion de Nexo Market (quedan comentadas con su marca para volver a mostrarlas)", () => {
    for (const pagina of ["site/index.html", "site/nexo-ia.html"]) {
        const html = leer(pagina);
        assert.doesNotMatch(sinComentarios(html), /Nexo Market/, `${pagina}: no debe prometer Nexo Market`);
        assert.doesNotMatch(sinComentarios(html), /href="\/market"/);
        assert.match(html, /EN-LINEA-OCULTO/, `${pagina}: queda la marca para restaurarlo`);
    }

    const index = sinComentarios(leer("site/index.html"));
    assert.doesNotMatch(index, /id="market"/);
    assert.doesNotMatch(index, /href="#market"/);
});

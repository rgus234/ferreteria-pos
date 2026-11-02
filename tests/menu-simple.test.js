// Menu simplificado: funcion nueva, apagada por defecto, que no quita ninguna pantalla (cada tarjeta le da clic al boton de siempre).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

test("es una funcion nueva por negocio, apagada hasta que el dueño la enciende", () => {
    assert.match(fs.readFileSync(path.join(__dirname, "..", "funciones-beta-server.js"), "utf8"), /menu_simplificado: "Menú simplificado"/);
    assert.match(leer("js/funciones-beta.js"), /menu_simplificado: "Un menú más corto/);
    assert.match(leer("js/menu-simple.js"), /evento\.detail\.menu_simplificado/);
});

test("el CSS solo actua con body.menu-simple (apagado no cambia nada)", () => {
    const css = leer("css/components/menu-simple.css");
    assert.match(css, /body\.menu-simple \.sidebar > :not\(#marcaSidebar\)/);
    assert.match(css, /\.ms-nav \{ display: none; \}/);
});

test("cada tarjeta apunta a un boton real del menu de siempre y la pantalla esta registrada", () => {
    const js = leer("js/menu-simple.js");
    const html = leer("index.html");
    const modulos = [...js.matchAll(/modulo: "([a-z-]+)"/g)].map(m => m[1]);
    assert.ok(modulos.length >= 25);

    // estos botones los crea shell-topbar.js al arrancar (asegurarBotonSidebarPOS), no estan en el HTML
    const shell = leer("js/shell-topbar.js");

    for (const modulo of new Set(modulos)) {
        const existe = html.includes(`data-shell-module="${modulo}"`) || shell.includes(`"${modulo}"`); // creditos se deduce de su etiqueta
        assert.ok(existe, `no existe el boton ${modulo}`);
    }
    assert.match(html, /<section id="pantallaHubMenu"/);
    assert.match(leer("js/config-auth.js"), /"pantallaHubMenu"/);
    assert.match(html, /js\/menu-simple\.js/);
    assert.match(html, /css\/components\/menu-simple\.css/);
});

test("respeta permisos y perfil: usa el boton original para decidir que tarjetas aparecen", () => {
    const js = leer("js/menu-simple.js");
    assert.match(js, /boton\.style\.display === "none"/);
    assert.match(js, /perfilOculto === "1"/);
    assert.match(js, /solo-perfil-simple/);
});

test("celular: 'Más' se agrupa en secciones solo si el negocio encendio el menu simplificado", () => {
    const js = leer("dueno.js");
    assert.match(js, /if \(!window\.duenoMenuSimple\) \{\s*contenedor\.innerHTML = categorias\.map\(htmlFila\)\.join\(""\);/, "apagado: la lista de siempre");
    assert.match(js, /SECCIONES_MAS_DUENO/);
    const giro = leer("dueno-giro.js");
    assert.match(giro, /datos\?\.funciones\?\.menu_simplificado === true/);
    assert.match(giro, /nexoDuenoMenuSimple/);
    assert.match(leer("dueno.css"), /\.dueno-mas-seccion/);
});

test("abarrotes (perfil simple) siempre cobra a precio publico: sin selector de niveles ni con 'Mas herramientas'", () => {
    const js = leer("js/pos-sales.js");
    assert.match(js, /perfilEsSimple\(\)\) \? "publico" : \(nivel \|\| "mayoreo"\)/);
    assert.match(js, /perfilEsSimple\(\)\) \? "publico" : \(venta\.nivelPrecioActual/);
    assert.match(leer("css/components/perfil-negocio.css"), /^body\.perfil-simple \.resumen-precio-aplicado,/m);
});

test("Inventario bajo: con el menu simplificado se ve en tarjetas con foto y Editar; apagado sigue la tabla de siempre", () => {
    const js = leer("js/low-stock.js");
    assert.match(js, /body\.classList\.contains\("menu-simple"\)\) \{\s*renderInventarioBajoTarjetas\(bajos\);/);
    assert.match(js, /editarProducto\(\$\{producto\.id\}\)/);
    assert.match(leer("css/components/menu-simple.css"), /body\.menu-simple #pantallaInventarioBajo \.tabla-bajo \{ display: none; \}/);
});

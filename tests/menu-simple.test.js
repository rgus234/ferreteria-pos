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

test("dentro de una pantalla abierta desde un grupo hay una flecha para regresar a sus tarjetas", () => {
    const js = leer("js/menu-simple.js");
    assert.match(js, /id = "msVolver"/);
    assert.match(js, /abrirHub\(barra\.dataset\.hub\)/);
    assert.match(leer("css/components/menu-simple.css"), /body\.menu-simple \.ms-volver:not\(\[hidden\]\)/);
});

test("animaciones: la tarjeta responde y la pantalla sale; toda pantalla entra animada; respeta 'menos movimiento'", () => {
    const js = leer("js/menu-simple.js");
    assert.match(js, /classList\.add\("ms-pulsada"\)/);
    assert.match(js, /await salidaAnimada\(pantalla\)/);
    assert.match(js, /nx-entra-adelante/);
    assert.match(js, /direccion = "atras"/);
    assert.match(js, /prefers-reduced-motion: reduce/);

    const css = leer("css/components/menu-simple.css");
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\/\* toda pantalla/);
    assert.match(css, /@keyframes nxEntraAdelante/);
    assert.match(css, /@keyframes msPulsada/);
});

test("buscador del punto de venta: flechas recorren los resultados, la elegida se pinta y Enter la agrega (sin flechas, Enter como siempre)", () => {
    const js = leer("js/pos-search-flyout.js");
    assert.match(js, /event\.key !== "ArrowDown" && event\.key !== "ArrowUp" && event\.key !== "Enter"/);
    assert.match(js, /if \(actual < 0\) return;/, "Enter sin fila elegida no se intercepta (escaner / un solo resultado)");
    assert.match(js, /agregarDesdeFlyoutPOS\(Number\(filas\[actual\]\.dataset\.flyoutId\)\)/);
    assert.match(js, /\}, true\);/, "se escucha en captura para ganarle al Enter de siempre");
    assert.match(leer("css/components/pos-sale-redesign.css"), /\.pos-flyout-row\.activa \{/);
});

test("botones de accion de las tablas: un solo estilo para Inventario, Inventario bajo, Por revisar, Clientes y Proveedores", () => {
    const css = leer("css/components/acciones-tabla.css");
    for (const clase of ["acciones-inventario", "acciones-bajo", "acciones-clientes", "acciones-proveedores"]) {
        assert.ok(css.includes(`td.${clase} button:not(.ac-x)`), clase);
    }
    assert.match(css, /display: table-cell !important/, "la celda ya no es flex");
    assert.match(css, /height: 36px/);
    assert.match(css, /body\.oscuro td\.acciones-inventario/);
    assert.match(leer("index.html"), /css\/components\/acciones-tabla\.css/);
    assert.match(leer("js/credit-customers.js"), /class="accion-peligro" onclick="desactivarClienteCredito/);
    assert.match(leer("js/lotes-ui.js"), /class="accion-peligro" onclick="lotesTirar/);
});

test("abarrotes: Cargar inventario no mezcla el catalogo de fabricantes de ferreteria en sus resultados", () => {
    assert.match(leer("js/carga-inventario.js"), /const fabricantes = typeof perfilEsSimple === "function" && perfilEsSimple\(\) \? \[\] : \(datos\.fabricante \|\| \[\]\)/);
});

test("ticket sin impresora: QR grande en la computadora al terminar la venta y boton 'Mostrar QR' en el celular", () => {
    const vista = leer("js/ticket-qr-view.js");
    assert.match(vista, /nexoposoficial\.com\/ticket\//);
    assert.match(vista, /imprimirAutomatico === false/, "solo sale si la caja no imprime");
    assert.match(vista, /evento\.key === "Escape" \|\| evento\.key === "Enter"/);

    const ventas = leer("js/pos-sales.js");
    assert.match(ventas, /debeMostrarQrTicketPOS\(negocio\) && codigoPublico\) \{\s*await mostrarQrTicketPOS\(/);
    assert.ok(ventas.indexOf("mostrarQrTicketPOS({ codigoPublico") < ventas.indexOf("await imprimirTicketPOS(ticket);"), "el QR sale antes de intentar imprimir");

    const html = leer("index.html");
    assert.match(html, /js\/ticket-qr-view\.js/);
    assert.match(html, /css\/components\/ticket-qr\.css/);

    const celular = leer("dueno-ticket.js");
    assert.match(celular, /mostrarQrTicketVentaDueno\('\$\{esc\(codigoPublico\)\}'\)/);
    assert.match(celular, /<b>Mostrar QR<\/b>/);
});

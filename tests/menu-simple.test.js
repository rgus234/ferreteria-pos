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

test("Por revisar (abarrotes) y Por vencer (ferreteria): tarjetas con foto, urgencia por grupos, fichas filtro y acciones, con el menu simplificado", () => {
    const js = leer("js/por-vencer-tarjetas.js");
    assert.match(js, /id: "vencido", titulo: "Ya vencidos"/);
    assert.match(js, /Venció hace/);
    assert.match(js, /lotesTirar\(/);
    assert.match(js, /lotesEntrada\(/);
    assert.match(js, /miniaturaProducto\(producto, "pv-foto-img"\)/, "usa la miniatura de siempre (con su icono si la foto falla)");

    assert.match(leer("js/lotes-ui.js"), /renderPorVencerTarjetas\(\{\s*modo: "lotes"/);
    assert.match(leer("js/expiring-products.js"), /renderPorVencerTarjetas\(\{\s*modo: "producto"/);
    assert.match(leer("css/components/por-vencer.css"), /body\.menu-simple #pantallaPorVencer \.tabla-bajo/);
    assert.match(leer("index.html"), /js\/por-vencer-tarjetas\.js/);
});

test("Ponerle fecha / Llego mercancia: buscador con lista (palabras en cualquier orden, foto, flechas + Enter) en vez de pedir el nombre exacto", () => {
    const js = leer("js/lotes-ui.js");
    assert.match(js, /function lotesElegirProducto\(titulo, ayuda\)/);
    assert.match(js, /palabras\.every\(w => texto\.includes\(w\)\)/);
    assert.match(js, /await lotesElegirProducto\("¿A qué producto le pones fecha\?"/);
    assert.match(js, /await lotesElegirProducto\("¿Qué producto llegó\?"/);
    assert.match(js, /evento\.key === "ArrowDown" \|\| evento\.key === "ArrowUp"/);
    assert.match(leer("css/components/por-vencer.css"), /\.le-fila\.activa/);
});

test("Practica con Nexo: productos de ejemplo en memoria (nada llega al servidor), guia con mascota y se ofrece al terminar el asistente de inicio", () => {
    const js = leer("js/practica-nexo.js");
    assert.match(js, /ruta === "\/productos"\) return respuestaJson\(estado\.productos\)/);
    assert.match(js, /cualquier otra escritura: "ok", sin tocar el servidor/);
    assert.match(js, /ruta === "\/ventas" && metodo === "POST"/);
    assert.match(js, /window\.imprimirTicketPOS = async \(\) => true/, "sin impresion durante la practica");
    assert.match(js, /busquedas: \[\{ id: 9001, escribe: "dori"/);
    assert.match(js, /busquedas: \[\{ id: 9001, escribe: "marti"/, "set de ferreteria");
    assert.match(js, /await restaurar\(\)/);
    assert.match(js, /\/img\/nexo-ia\/\$\{pose\}-hd\.webp/);

    const asistente = leer("js/asistente-inicio.js");
    assert.match(asistente, /window\.practicaNexo\.debeOfrecerse\(\) && primerPaso !== "primera_venta"/);
    assert.match(asistente, /async function asistenteSeguirDespuesDeTerminar\(primerPaso\)/);
    assert.match(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"), /practica: \["hecha", "saltada"\]/);

    const html = leer("index.html");
    assert.match(html, /js\/practica-nexo\.js/);
    assert.match(html, /css\/components\/practica-nexo\.css/);
    assert.match(html, /data-shell-module="practica" data-beta="menu_simplificado" onclick="practicaNexo\.iniciar\(\)"/);
    for (const pose of ["feliz", "pensando", "celebrando", "neutral", "alerta"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "public", "img", "nexo-ia", `${pose}-hd.webp`)), pose);
});

test("Practica con Nexo: capitulos 2 (resultados con ventas de ejemplo) y 3 (agregar producto) y limpieza al terminar", () => {
    const js = leer("js/practica-nexo.js");
    assert.match(js, /ruta === "\/reportes\/ventas"\) return respuestaJson\(construirReporte\(\)\)/);
    assert.match(js, /ruta === "\/agregar-producto" && metodo === "POST"/);
    assert.match(js, /id: "resultados", titulo: "Ver tus resultados"/);
    assert.match(js, /id: "producto", titulo: "Agregar un producto"/);
    assert.match(js, /LLAVES_VENTA = \["hojasVentaFerreteriaPOS", "ultimaVentaPOS"\]/, "la practica no deja ultima venta ni hojas");
    assert.match(js, /window\.nexoIaTourAutoModulo = \(\) => \{\}/, "sin mini-tours viejos encima");
    assert.match(js, /soloVer: true/);
    assert.match(leer("css/components/practica-nexo.css"), /body\.practica-activa #modalDialogoPOS/);
});

test("Practica con Nexo: capitulo 4 (recorrido por las tarjetas del programa) y 5 (celular como escaner con codigo EAN-13 valido de prueba)", () => {
    const js = leer("js/practica-nexo.js");
    assert.match(js, /id: "recorrido", titulo: "Conoce tu programa"/);
    assert.match(js, /id: "celular", titulo: "Tu celular como escáner"/);
    assert.match(js, /ruta\.startsWith\("\/escaner-remoto"\)\) return estado\.fetchOriginal/, "el escaner del celular es real (solo los productos son de ejemplo)");
    assert.match(js, /function ean13\(cuerpo12\)/);
    assert.match(js, /function barrasEan13\(codigo\)/);
    assert.match(js, /secundario: \{ texto: "Lo hago después"/);
    assert.match(js, /aplica: \(\) => document\.body\.classList\.contains\("menu-simple"\)/);

    // el digito verificador EAN-13 de los productos de ejemplo es valido
    const suma = c => { const d = c.slice(0, 12).split("").map(Number); return (10 - (d.reduce((s, n, i) => s + n * (i % 2 ? 3 : 1), 0) % 10)) % 10; };
    assert.equal(suma("750100000001"), 2, "Doritos: 7501000000012");
});

test("Practica con Nexo en el celular: productos y servidor de ejemplo (nada del catalogo ni de las ventas reales), guia con mascota y entradas en Mas e Inicio", () => {
    const js = leer("dueno-practica.js");
    assert.match(js, /window\.guardarCatalogoLocal = async \(\) => \{\}/, "no se pisa el catalogo guardado del telefono");
    assert.match(js, /if \(ruta === "\/ventas" && metodo === "POST"\)/);
    assert.match(js, /window\.fetchAutenticado = g\.fetchAutenticado/, "se restaura al terminar");
    assert.match(js, /id: "vender", titulo: "Cobrar una venta"/);
    assert.match(js, /id: "escaner", titulo: "El escáner de la cámara"/);
    assert.match(js, /window\.practicaCelular = /);
    assert.match(leer("dueno.html"), /dueno-practica\.js/);
    assert.match(leer("dueno.html"), /dueno-practica\.css/);
    assert.match(leer("dueno-sw.js"), /dueno-practica\.js/);
    assert.match(leer("dueno.js"), /id: "practica", titulo: "Practicar con Nexo"/);
    assert.match(leer("dueno.js"), /practicaCelular\.iniciar\(\)/);
});

test("la practica usa fotos reales precargadas de los productos de ejemplo", () => {
    for (const slug of ["doritos", "cocacola", "sabritas", "marias", "leche", "martillo", "pinzas", "taladro", "flexometro", "cinta"]) {
        assert.ok(fs.existsSync(path.join(__dirname, "..", "public", "img", "practica", slug + ".webp")), slug);
        assert.match(leer("dueno-sw.js"), new RegExp("/img/practica/" + slug + "\.webp"));
    }
    assert.match(leer("js/practica-nexo.js"), /precargarFotos\(estado\.productos\)/);
    assert.match(leer("dueno-practica.js"), /precargarFotos\(estado\.productos\)/);
});

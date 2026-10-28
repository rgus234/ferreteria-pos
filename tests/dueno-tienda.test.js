// "Mi tienda" en /dueno: solo se carga si esta cableada en la pagina y en el service worker.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

test("Mi tienda esta enlazada en dueno.html y cacheada por el service worker", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");

    assert.match(html, /dueno-tienda\.js\?v=/);
    assert.match(html, /dueno-tienda\.css\?v=/);
    assert.match(sw, /\/dueno-tienda\.js\?v=/);
    assert.match(sw, /\/dueno-tienda\.css\?v=/);
});

test("Mi tienda usa los endpoints existentes y solo aparece con abarrotes", () => {
    const js = leer("dueno-tienda.js");

    for (const ruta of ["/abarrotes/inicio", "/lotes/por-revisar", "/pedido-sugerido", "/pedidos-proveedor", "/merma", "/entrada"]) assert.ok(js.includes(ruta), ruta);
    assert.match(js, /girosActivos/);
    assert.match(js, /fetchAutenticado/);
});

test("el pedido sugerido abre el WhatsApp del proveedor y los favoritos se pueden reordenar", () => {
    const servidor = fs.readFileSync(path.join(__dirname, "..", "pedido-sugerido-server.js"), "utf8");
    const pedido = leer("js/pedido-sugerido.js");
    const favoritos = leer("js/favoritos-pos.js");

    assert.match(servidor, /telefono: proveedor\.telefono/);
    assert.match(pedido, /"52" \+ digitos/);
    assert.match(pedido, /pedSugEnviar/);
    assert.match(leer("dueno-tienda.js"), /"52" \+ digitos/);
    assert.match(favoritos, /async function favMover/);
    assert.match(favoritos, /favMover\(\$\{producto\.id\}, -1\)/);
});

test("Exhibidores en el celular: cableados en la pagina y el service worker, con el carrito de siempre", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-exhibidores.js");

    assert.match(html, /dueno-exhibidores\.js\?v=/);
    assert.match(html, /dueno-exhibidores\.css\?v=/);
    assert.match(sw, /\/dueno-exhibidores\.js\?v=/);
    assert.match(sw, /\/dueno-exhibidores\.css\?v=/);
    assert.match(js, /\/exhibidores/);
    assert.match(js, /duenoCarrito/);
    assert.match(js, /cambiarTabDueno\("vender"\)/);
});

test("Venta movil (Fase A): barra fija, tarjeta de confirmacion, pitido y lista del escaner con lo nuevo primero, cableado y sin tocar las reglas de venta", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-venta-movil.js");

    assert.match(html, /dueno-venta-movil\.js\?v=/);
    assert.match(html, /dueno-venta-movil\.css\?v=/);
    assert.match(sw, /\/dueno-venta-movil\.js\?v=/);
    assert.match(sw, /\/dueno-venta-movil\.css\?v=/);

    for (const funcion of ["renderCarritoVenderDueno", "agregarAlCarritoVenderDueno", "duenoVenderIntentarAgregarPorCodigo", "abrirEscanerVenderDueno", "cambiarTabDueno"]) {
        assert.ok(js.includes(`envolver("${funcion}"`), `envuelve ${funcion}`);
    }

    assert.match(js, /visualViewport/, "la barra sigue a la pantalla visible cuando sale el teclado");
    assert.match(js, /createOscillator/, "pitido al agregar");
    assert.match(js, /slice\(\)\.reverse\(\)/, "en el escaner lo nuevo sale primero");
    assert.doesNotMatch(js, /fetchAutenticado|POST|precio\s*=\s*/, "no cambia ventas ni precios: solo muestra");
});

test("Cambio rapido de usuario en el celular: cableado y con PIN, sin cerrar sesion", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-usuarios.js");

    assert.match(html, /dueno-usuarios\.js\?v=/);
    assert.match(html, /dueno-usuarios\.css\?v=/);
    assert.match(sw, /\/dueno-usuarios\.js\?v=/);
    assert.match(sw, /\/dueno-usuarios\.css\?v=/);
    assert.match(js, /\/dispositivo\/empleados\/verificar-pin/, "usa el mismo PIN de siempre");
    assert.match(js, /guardarEmpleadoActivo\(datos\.empleado\)/, "el usuario activo cambia sin cerrar sesion");
    assert.match(js, /\/turno\/extender/, "Sigo trabajando extiende el turno con el PIN propio");
    assert.match(js, /x-empleado-id/);
    assert.doesNotMatch(js, /cerrarSesionDuenoApp\(\)/, "no cierra la sesion para cambiar");
});

test("Actividad del equipo en el celular: cableada, con respaldo a 'mi actividad' y solo lectura", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-actividad.js");

    assert.match(html, /dueno-actividad\.js\?v=/);
    assert.match(html, /dueno-actividad\.css\?v=/);
    assert.match(sw, /\/dueno-actividad\.js\?v=/);
    assert.match(sw, /\/dueno-actividad\.css\?v=/);
    assert.match(js, /\/actividad\/equipo/);
    assert.match(js, /\/actividad\/mia/);
    assert.doesNotMatch(js, /method:\s*"(POST|PUT|PATCH|DELETE)"/, "solo lee");
});

test("Alta efectiva en el celular: configuracion de compra y venta con sugerencia, y viaja en el alta de siempre", () => {
    const vm = require("node:vm");
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-alta.js");
    const inventario = leer("dueno-inventario.js");

    assert.match(html, /dueno-alta\.js\?v=/);
    assert.match(sw, /\/dueno-alta\.js\?v=/);
    assert.match(sw, /dueno-inventario\.js\?v=celular-plan-b-\d+-\d+/);
    assert.match(inventario, /Object\.assign\(cuerpo, configuracionAltaDueno\(\)\)/, "el alta de siempre incluye lo elegido");
    assert.match(js, /\/sugerencia-alta\?nombre=/);
    assert.match(js, /daiUsarSugerencia/);
    assert.match(js, /asignarLugarNuevoDueno/, "al crear el producto tambien se puede elegir su lugar");
    assert.match(inventario, /asignarLugarNuevoDueno\(productoId, stock\)/);
    assert.match(js, /configuracionCompletarDueno/, "tambien se puede completar la ficha de un producto recien creado");
    assert.match(inventario, /configuracionCompletarDueno()/);

    // La funcion que arma lo que se manda se prueba sin pantalla.
    const contexto = { window: {}, document: {}, fetchAutenticado: async () => ({}) };
    vm.runInNewContext(js, contexto);
    const armar = (...a) => JSON.parse(JSON.stringify(contexto.window.construirConfiguracionAlta(...a))); // JSON: el objeto nace en otro contexto de vm

    assert.deepEqual(armar({ presentacion_compra: "bolsa", factor_conversion: 100, unidad_venta: "kilo", permite_venta_pieza: true, bascula_digital: "si" }),
        { unidadVenta: "kilo", presentacionCompra: "BOLSA", basculaDigital: "si", permiteVentaPieza: true, factorConversion: 100, piezasPorBolsa: 100 });
    assert.deepEqual(armar({}), { unidadVenta: "pieza", presentacionCompra: "", basculaDigital: "no", permiteVentaPieza: false }, "sin elegir nada: como siempre");
    assert.deepEqual(armar({ presentacion_compra: "", factor_conversion: 50, permite_venta_pieza: true }), { unidadVenta: "pieza", presentacionCompra: "", basculaDigital: "no", permiteVentaPieza: true }, "sin presentacion no hay factor");

    const conSugerencia = armar({ presentacion_compra: "COSTAL", factor_conversion: 1000 }, { categoria: "Tornilleria", subcategoria: "Pijas", categoria_nexo_id: 25, proveedor_id: 7 });
    assert.deepEqual([conSugerencia.categoria, conSugerencia.subcategoria, conSugerencia.categoriaNexoId, conSugerencia.proveedorId], ["Tornilleria", "Pijas", 25, 7]);
    assert.equal(conSugerencia.permiteVentaPieza, false);
    assert.equal(conSugerencia.piezasPorBolsa, undefined, "solo se manda piezas por bolsa si tambien se vende suelta");
});

test("Caja cerrada en el celular: aviso en Inicio/Vender y abrir el turno desde el cobro (antes solo decia 'abre un turno' sin como)", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-caja-aviso.js");
    const dueno = leer("dueno.js");

    assert.match(html, /dueno-caja-aviso\.js\?v=/);
    assert.match(sw, /\/dueno-caja-aviso\.js\?v=/);
    assert.match(js, /requiereAbrirTurno/, "reconoce la respuesta del servidor");
    assert.match(js, /\/caja\/turno-activo/, "revisa el turno antes de cobrar");
    assert.match(js, /\/caja\/abrir/, "abre el turno ahi mismo");
    assert.match(js, /dvmAbrirCajaYCobrar/);
    assert.equal((dueno.match(/manejarFaltaDeTurnoDueno\(error\)/g) || []).length, 2, "las dos rutas de cobro (contado y credito) lo manejan");
});

test("Venta movil completa: peso a mano ('dame $20 de jitomate'), pasos de 1/4 kg y cobro en 1 toque, apoyados en las funciones de siempre", () => {
    const vm = require("node:vm");
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-venta-completa.js");

    assert.match(html, /dueno-venta-completa\.js\?v=/);
    assert.match(sw, /\/dueno-venta-completa\.js\?v=/);
    assert.ok(html.indexOf("dueno-venta-movil.js") < html.indexOf("dueno-venta-completa.js"), "se carga despues de la venta movil");

    for (const f of ["agregarAlCarritoVenderDueno", "cambiarCantidadCarritoVenderDueno", "filaCarritoVenderDuenoHtml", "renderCobroVenderDueno"]) assert.match(js, new RegExp(`window\.${f}`), `envuelve ${f}`);

    assert.match(js, /elegirMetodoPagoVenderDueno\(metodo\)/);
    assert.match(js, /aplicarMontoRapidoVenderDueno\(total\)/);
    assert.match(js, /confirmarCobroVenderDueno\(\)/);

    const contexto = { window: {}, document: { addEventListener() {}, createElement() { return {}; } } };
    vm.runInNewContext(js, contexto);

    assert.equal(contexto.window.dvcCantidadPorPesos(20, 28), 0.714, "$20 de jitomate a $28 el kilo");
    assert.equal(contexto.window.dvcCantidadPorPesos(0, 28), 0);
    assert.equal(contexto.window.dvcCantidadPorPesos(20, 0), 0);
    assert.equal(contexto.window.dvcEsDecimal({ unidadVenta: "kilo" }), true);
    assert.equal(contexto.window.dvcEsDecimal({ unidad_venta: "litro" }), true);
    assert.equal(contexto.window.dvcEsDecimal({ unidadVenta: "pieza" }), false);
});

test("Dile a Nexo en el celular: tarjetas de confirmacion para crear un producto o mover uno de lugar; Nexo nunca guarda solo", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");
    const js = leer("dueno-nexo-dile.js");
    const alta = leer("dueno-alta.js");

    assert.match(html, /dueno-nexo-dile\.js\?v=/);
    assert.match(sw, /\/dueno-nexo-dile\.js\?v=/);
    assert.match(js, /preparar_movimiento/);
    assert.match(js, /preparar_creacion/);
    assert.match(js, /data-a="si"/, "hay boton de confirmar");
    assert.match(js, /\/ubicaciones\/\$\{d\.lugarId\}\/asignar/, "mover usa la ruta de asignar del mapa");
    assert.match(js, /\/agregar-producto/, "crear usa el alta de siempre");
    assert.match(js, /webkitSpeechRecognition/, "dictado donde el navegador lo permite");
    assert.match(alta, /daiPonerLugar/, "Revisar deja elegido el lugar en el formulario");

    // Nada se guarda al llegar la respuesta: los POST solo viven dentro de los clics de confirmar.
    const antesDeTarjetas = js.slice(js.indexOf("(function"), js.indexOf("function pintarTarjeta"));
    assert.doesNotMatch(antesDeTarjetas, /agregar-producto|\/asignar|\/bodega|creditos\/clientes/, "recibir la respuesta no escribe nada de inventario");
});

test("El chat de Nexo en el celular lee la respuesta en vivo (NDJSON); antes las preguntas que pasaban por el modelo salian como error", () => {
    const vm = require("node:vm");
    const js = leer("dueno-nexo-dile.js");

    assert.match(js, /getReader\(\)/);
    assert.match(js, /ndjson/);
    assert.match(js, /tipo === "final"/);
    assert.match(js, /window\.enviarMensajeNexoDueno = async function/);
    assert.doesNotMatch(js, /fetchAutenticado\("\/ia\/chat"/, "ya no depende del lector de JSON que no entiende el stream");

    // lineaDeStream se prueba con un stream simulado.
    const mensajes = [];
    const contexto = {
        window: {}, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, createElement: () => ({}) },
        agregarMensajeNexoDueno: texto => { const m = { textContent: texto, remove() {} }; mensajes.push(m); return m; }
    };
    vm.runInNewContext(js, contexto);
    assert.equal(typeof contexto.window.enviarMensajeNexoDueno, "function");
});

test("Producto nuevo sin codigo: busca en el catalogo de Nexo por nombre y al tocar una coincidencia se llena como al escanear", () => {
    const js = leer("dueno-alta.js");
    const css = leer("dueno-alta.css");

    assert.match(js, /\/explorar-nexo\/buscar\?q=/, "reusa el buscador del catalogo que ya existe");
    assert.match(js, /\/explorar-nexo\/foto\//, "cada coincidencia muestra su foto");
    assert.match(js, /window\.daiElegirCatalogo = async function/);
    assert.match(js, /window\.autollenarDesdeMaestroDueno\(elegido\.codigo\)/, "llena igual que al escanear");
    assert.match(js, /f\.modo !== "nuevo" \|\| f\.maestroCodigo \|\| codigo/, "no busca por nombre si ya hay codigo o producto elegido ni en edicion");
    assert.match(css, /\.dai-cat-fila/);
});

test("Venta cobrada en el celular: pantalla rediseñada con Imprimir (Bluetooth ESC/POS o menu de imprimir) y el ticket se arma bien", () => {
    const vm = require("node:vm");
    const js = leer("dueno-ticket.js");

    assert.match(js, /navigator\.bluetooth\.requestDevice/);
    assert.match(js, /marco\.contentWindow\.print\(\)/, "plan B universal: menu de imprimir del telefono");
    assert.match(leer("dueno.html"), /dueno-ticket\.js\?v=/);
    assert.match(leer("dueno-sw.js"), /\/dueno-ticket\.js\?v=/);

    const contexto = { window: {}, document: { getElementById: () => null }, navigator: {}, TextEncoder };
    vm.runInNewContext(js, contexto);

    const venta = { negocio: "Abarrotes Díaz", folio: "V-12", fecha: "07/11/26 10:00", total: 28, descuento: 0, metodo: "efectivo", recibido: 50, cliente: "", enlace: "https://nexoposoficial.com/ticket/ABC",
        items: [{ nombre: "Galletas Marías con chispas de chocolate extra grandes", cantidad: 2, precio: 10 }, { nombre: "Chicle", cantidad: 1, precio: 8 }] };
    const lineas = contexto.window.lineasTicketVentaDueno(venta);

    assert.ok(lineas.every(l => l.length <= 32), "ninguna linea pasa de 32 caracteres (papel de 58 mm)");
    assert.ok(lineas.some(l => /TOTAL\s+\$28\.00$/.test(l)));
    assert.ok(lineas.some(l => /Cambio\s+\$22\.00$/.test(l)));
    assert.ok(lineas.join("").includes("Abarrotes Diaz"), "sin acentos para la impresora");

    const bytes = contexto.window.bytesTicketVentaDueno(venta);
    assert.equal(bytes[0], 0x1b);
    assert.equal(bytes[1], 0x40, "empieza con ESC @ (inicializar)");
});

test("Vender rediseñado: accesos con nombre, 'Lo que mas vendes' con un toque y conteo al cobrar (no al agregar)", () => {
    const js = leer("dueno-vender-inicio.js");

    assert.match(js, /Lo que más vendes/);
    assert.match(js, /agregarAlCarritoVenderDueno\(\$\{Number\(p\.id\)\}\)/, "un toque agrega con la misma funcion de siempre");
    assert.match(js, /window\.mostrarVentaCobradaVenderDueno = function/, "se cuenta al cobrar");
    assert.doesNotMatch(js, /fetchAutenticado/, "no toca el servidor");
    assert.match(leer("dueno.html"), /dueno-vender-inicio\.js\?v=/);
    assert.match(leer("dueno-sw.js"), /\/dueno-vender-inicio\.js\?v=/);
    assert.match(leer("dueno-venta-movil.css"), /\.dvi-grid/);
});

test("Textos de ejemplo segun el giro: un negocio solo de abarrotes ya no ve martillos ni Diprofer, y uno con ferreteria los conserva", () => {
    const vm = require("node:vm");
    const js = leer("dueno-giro.js");

    assert.match(leer("dueno.html"), /dueno-giro\.js\?v=/);
    assert.match(leer("dueno-sw.js"), /\/dueno-giro\.js\?v=/);
    assert.doesNotMatch(js.slice(js.indexOf("(function")), /martillo|Diprofer|pija/i, "los ejemplos de abarrotes no mencionan ferreteria");
    assert.match(leer("dueno-nexo-dile.js"), /EJEMPLOS_ABARROTES/);

    const campos = { duenoRecBuscar: { placeholder: "Ej. martillo" } };
    let observador = null;
    const contexto = {
        window: {}, document: { body: {}, getElementById: id => campos[id] || null, dispatchEvent() {} }, CustomEvent: function () {},
        MutationObserver: function (fn) { observador = fn; this.observe = () => {}; },
        tokenGuardado: () => "t", setTimeout: fn => fn(), clearTimeout() {},
        fetchAutenticado: async () => ({ negocio: { giro: "abarrotes", girosActivos: [] } })
    };
    vm.runInNewContext(js, contexto);

    return new Promise(resolve => setImmediate(() => {
        assert.equal(contexto.window.duenoGiro.abarrotesSolo, true);
        assert.equal(campos.duenoRecBuscar.placeholder, "Ej. galletas");
        resolve();
    }));
});

test("Producto nuevo por nombre: cada giro ve lo suyo (un abarrotes no recibe brocas al buscar 'coca-cola')", () => {
    const alta = leer("dueno-alta.js");

    assert.match(alta, /giro\.abarrotesSolo \? r\.origen !== "fabricante"/, "abarrotes excluye los productos de fabricante (ferreteria)");
    assert.match(alta, /giro\.ferreteriaSolo \? r\.origen !== "negocio"/, "ferreteria excluye lo escaneado en abarrotes");
    assert.match(fs.readFileSync(path.join(__dirname, "..", "explorar-nexo-server.js"), "utf8"), /origen: fila\.origen/, "el servidor manda el origen");
    assert.match(leer("dueno-giro.js"), /ferreteriaSolo/);
});

test("Recibir por marca: agrupa los productos por marca y manda las cantidades por la recepcion rapida de siempre", () => {
    const vm = require("node:vm");
    const js = leer("dueno-recibir-marca.js");

    assert.match(js, /\/recepciones-mercancia\/rapida/, "mismo camino que Recibir mercancia");
    assert.match(js, /idempotencyKey: estado\.llave/, "la misma llave al reintentar: no suma dos veces");
    assert.match(leer("dueno.html"), /dueno-recibir-marca\.js\?v=/);
    assert.match(leer("dueno-sw.js"), /\/dueno-recibir-marca\.css\?v=/);

    const contexto = { window: {}, document: { querySelector: () => null, getElementById: () => null }, escaparDueno: String };
    vm.runInNewContext(js, contexto);

    const marca = n => contexto.window.marcaDeRecibirDueno(n).marca;
    assert.equal(marca("DORITOS NACHO ROJOS 58g"), "Sabritas");
    assert.equal(marca("FANTA NARANJA 600 ml"), "Coca-Cola");
    assert.equal(marca("MARIAS GAMESA 185g"), "Gamesa");
    assert.equal(marca("GANSITO 50g"), "Marinela");
    assert.equal(marca("MEDIAS NOCHES BIMBO 340g"), "Bimbo");
    assert.equal(marca("PEÑAFIEL TWIST 600ml"), "Peñafiel", "marca desconocida: la primera palabra del nombre");

    const grupos = contexto.window.agruparMarcasRecibirDueno([{ id: 1, nombre: "SABRITAS ORIGINAL" }, { id: 2, nombre: "DORITOS NACHO" }, { id: 3, nombre: "TAJÍN CLÁSICO" }]);
    assert.equal(grupos[0].marca, "Sabritas");
    assert.equal(grupos[0].productos.length, 2);
    assert.equal(grupos.at(-1).marca, "Otros", "las marcas con un solo producto y desconocidas se juntan en Otros");
});

test("Recibir por marca: buscador (nombre o codigo), escaner con tarjetita y resumen a pantalla completa", () => {
    const js = leer("dueno-recibir-marca.js");

    assert.match(js, /id="drmBuscar"/, "buscador arriba");
    assert.match(js, /window\.escanearRecibirDueno = function/);
    assert.match(js, /abrirEscanerCodigoDueno\(\{ titulo: "Escanear mercancía", continuo: true/, "usa el escaner de siempre, continuo");
    assert.match(js, /window\.codigoRecibirDueno = function/, "un codigo escrito o de lector suma uno");
    assert.match(js, /mostrarTarjetaEscaneo\(p, `Llevas/, "tarjetita corta al escanear");
    assert.match(js, /window\.abrirResumenRecibirDueno = function/);
    assert.match(js, /Seguir recibiendo/, "el resumen se baja para seguir");
    assert.match(js, /class="drm-resumen-abrir"/, "el total del pie abre el resumen");
    assert.match(leer("dueno-recibir-marca.css"), /\.drm-resumen \{ position: fixed; inset: 0;/);
});

test("Recibir por marca: lineas dentro de cada marca (Doritos, Cheetos, Bolzaza...; Aguas, Fanta...) para encontrar mas rapido", () => {
    const vm = require("node:vm");
    const js = leer("dueno-recibir-marca.js");
    const contexto = { window: {}, document: { querySelector: () => null, getElementById: () => null }, escaparDueno: String };
    vm.runInNewContext(js, contexto);

    const linea = n => contexto.window.lineaDeRecibirDueno(n);
    assert.equal(linea("Doritos Nacho Rojos 58 g"), "Doritos");
    assert.equal(linea("Cheetos Torciditos Bolzaza 115 g"), "Bolzaza", "Bolzaza es un tamaño que se busca aparte");
    assert.equal(linea("Ciel Purificada 600 ml"), "Aguas");
    assert.equal(linea("Power Ade Morado 1 L"), "Powerade");
    assert.equal(linea("Topo-Chico Limonada 600 ml"), "Topo Chico");
    assert.equal(linea("Fuzetea Sabor Durazno 600 ml"), "Fuze Tea");

    const nombres = ["Cheetos A", "Cheetos B", "Doritos A", "Doritos B", "Rancheritos Original", "Ruffles Queso", "Sabritas Adobadas", "Sabritas Limón"].map(nombre => ({ nombre }));
    const lineas = contexto.window.lineasDeRecibirDueno(nombres);
    assert.deepEqual(Array.from(lineas.map(x => x.linea)).sort(), ["Cheetos", "Doritos", "Rancheritos", "Ruffles", "Sabritas"], "pocas lineas: cada una con su chip");
    assert.equal(contexto.window.lineasDeRecibirDueno(nombres.slice(0, 3)).length, 0, "con pocos productos no hacen falta lineas");
    assert.match(js, /id="drmLineas"/);
    assert.match(js, /window\.elegirLineaRecibirDueno = function/);
});

test("Ferreteria: Recibir por marca usa la marca y la categoria del producto, y hay plantilla de lugares de ferreteria", () => {
    const vm = require("node:vm");
    const js = leer("dueno-recibir-marca.js");
    const contexto = { window: { duenoGiro: { ferreteriaSolo: true } }, document: { querySelector: () => null, getElementById: () => null }, escaparDueno: String };
    vm.runInNewContext(js, contexto);

    const productos = [
        ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, nombre: `Martillo ${i}`, marca: "Truper", categoria: "Herramienta manual" })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: i + 10, nombre: `Pija ${i}`, marca: "Fiero", categoria: "Tornillería" })),
        { id: 99, nombre: "Algo suelto", marca: "Pretul", categoria: "Pintura" }
    ];
    const grupos = Array.from(contexto.window.agruparMarcasRecibirDueno(productos));
    assert.deepEqual(grupos.map(g => g.marca).sort(), ["Fiero", "Otros", "Truper"], "grupos por la marca real; las de un solo producto se juntan");
    assert.equal(grupos.find(g => g.marca === "Truper").productos.length, 5);

    const lineas = Array.from(contexto.window.lineasDeRecibirDueno(productos));
    assert.deepEqual(lineas.map(x => x.linea).sort(), ["Herramienta manual", "Pintura", "Tornillería"], "lineas por categoria");

    // El servidor trae la plantilla de ferreteria y el celular ofrece el boton segun el giro.
    const servidor = fs.readFileSync(path.join(__dirname, "..", "ubicaciones-server.js"), "utf8");
    assert.match(servidor, /ferreteria: \[/);
    assert.match(servidor, /Pasillo 1 · Tornillería/);
    assert.match(leer("dueno-mapa.js"), /dmPlantilla\('ferreteria'\)/);
});

test("Recibir por marca conectado con Recepcion inteligente: proveedor 'sin factura', facturas por recibir con 'Esperado' y conciliacion en el celular", () => {
    const vm = require("node:vm");
    const js = leer("dueno-recibir-marca.js");
    const contexto = { window: {}, document: { querySelector: () => null, getElementById: () => null }, escaparDueno: String };
    vm.runInNewContext(js, contexto);

    const repartir = (ids, esperados, contado) => Object.assign({}, contexto.window.repartirRecibidoRecibirDueno(ids, esperados, contado));
    assert.deepEqual(repartir([10], [12], 9), { 10: 9 });
    assert.deepEqual(repartir([10, 11], [5, 5], 7), { 10: 5, 11: 2 }, "un producto en dos renglones: llena el primero y el resto va al segundo");
    assert.deepEqual(repartir([10, 11], [5, 5], 12), { 10: 5, 11: 7 }, "lo que sobra va al ultimo");
    assert.deepEqual(repartir([10, 11], [5, 5], 0), { 10: 0, 11: 0 });

    assert.match(js, /\/recepcion-inteligente\/facturas/, "lista las facturas pendientes");
    assert.match(js, /sinFactura: Boolean\(proveedorElegido\)/, "con proveedor la recepcion queda sin factura");
    assert.match(js, /confirmarFacturaMovil/, "confirma la factura por la misma ayuda que Recibir factura");
    assert.match(js, /Esperado/, "tarjetas con lo que dice la factura");

    const factura = leer("dueno-factura.js");
    assert.match(factura, /window\.confirmarFacturaMovil = async function/);
    assert.match(factura, /conciliarConRecepcionMercanciaId: p\.recepcionMercanciaId/, "el celular concilia sin mandar a la computadora");
    assert.doesNotMatch(factura, /Confírmala en la computadora para conciliarlas/, "ya no manda a la computadora");
});

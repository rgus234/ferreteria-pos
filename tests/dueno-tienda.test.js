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

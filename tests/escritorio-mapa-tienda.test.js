// Computadora: todos los scripts que carga index.html compilan (un error de sintaxis tumba el archivo entero en silencio) y
// las funciones nuevas (Mapa de la tienda, Funciones nuevas) vienen conectadas pero APAGADAS por defecto.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const publico = ruta => path.join(__dirname, "..", "public", ruta);
const html = fs.readFileSync(publico("index.html"), "utf8");

test("todos los scripts de la computadora compilan", () => {
    const scripts = [...html.matchAll(/<script[^>]+src="(js\/[^"?]+)/g)].map(m => m[1]);
    assert.ok(scripts.length > 40, "se leyeron los scripts de index.html");

    for (const ruta of scripts) {
        const codigo = fs.readFileSync(publico(ruta), "utf8");
        assert.doesNotThrow(() => new vm.Script(codigo, { filename: ruta }), `error de sintaxis en ${ruta}`);
    }
});

test("Mapa de la tienda y Funciones nuevas estan conectados y el mapa nace oculto", () => {
    assert.match(html, /data-shell-module="mapa-tienda" data-beta="mapa_tienda" hidden onclick="mostrarMapaTienda\(\)"/, "el boton del mapa empieza oculto");
    assert.match(html, /onclick="mostrarFuncionesBeta\(\)"/, "Funciones nuevas siempre se puede abrir (ahi se enciende)");
    assert.match(html, /id="pantallaMapaTienda"/);
    assert.match(html, /id="pantallaFuncionesBeta"/);
    assert.match(html, /js\/funciones-beta\.js/);
    assert.match(html, /js\/mapa-tienda-view\.js/);
    assert.match(html, /css\/components\/mapa-tienda\.css/);

    const ocultar = fs.readFileSync(publico("js/config-auth.js"), "utf8");
    assert.match(ocultar, /"pantallaMapaTienda"/, "al cambiar de pantalla el mapa se esconde");
    assert.match(ocultar, /"pantallaFuncionesBeta"/);
});

test("la funcion beta responde false hasta que el negocio la enciende", () => {
    const codigo = fs.readFileSync(publico("js/funciones-beta.js"), "utf8");
    const contexto = { window: {}, document: { addEventListener() {}, readyState: "loading", querySelectorAll: () => [], documentElement: { classList: { toggle() {} } }, dispatchEvent() {} }, CustomEvent: function () {}, fetch: async () => ({ ok: false }), setTimeout() {} };
    vm.runInNewContext(codigo, contexto);

    assert.equal(contexto.window.funcionBeta("mapa_tienda"), false);
    assert.equal(contexto.window.funcionBeta("cualquier_cosa"), false);
});

test("el mapa usa las mismas rutas del servidor que el celular", () => {
    const codigo = fs.readFileSync(publico("js/mapa-tienda-view.js"), "utf8");

    for (const ruta of ["/ubicaciones/resumen", "/ubicaciones/buscar", "/ubicaciones/plantilla", "/resurtir", "/conteos"]) {
        assert.ok(codigo.includes(ruta), "usa " + ruta);
    }

    assert.match(codigo, /\/conteos\/\$\{c\.id\}\/\$\{accion\}/, "aprueba o rechaza los conteos que se hacen en el celular");
});

test("Recibir por marca en la computadora: conectado, apagado por defecto, y con la misma logica de factura y proveedor que el celular", () => {
    assert.match(html, /data-shell-module="recibir-marca" data-beta="recibir_por_marca" hidden onclick="mostrarRecibirMarca\(\)"/);
    assert.match(html, /id="pantallaRecibirMarca"/);
    assert.match(html, /js\/recibir-marca-view\.js/);
    assert.match(html, /css\/components\/recibir-marca\.css/);
    assert.match(fs.readFileSync(publico("js/config-auth.js"), "utf8"), /"pantallaRecibirMarca"/);

    const codigo = fs.readFileSync(publico("js/recibir-marca-view.js"), "utf8");
    assert.match(codigo, /sinFactura: Boolean\(proveedor\)/, "con proveedor la recepcion queda sin factura");
    assert.match(codigo, /\/recepciones-mercancia\/rapida/, "misma ruta que Recibir mercancia del celular");
    assert.match(codigo, /requiereConciliacion/, "pregunta si es la misma mercancia en vez de sumarla dos veces");
    assert.match(codigo, /conciliarConRecepcionMercanciaId: p\.recepcionMercanciaId/);
    assert.match(codigo, /cantidadesRecibidas/, "confirma lo que de verdad llego");
    assert.match(codigo, /Esperado/, "tarjetas con lo que dice la factura");
    assert.match(codigo, /marcasQueCoinciden/, "el buscador tambien filtra las marcas");
});

test("Computadora: grupos del menu abren en ventana angosta, modo oscuro de las pantallas con blanco fijo y Explora Nexo por giro", () => {
    const shell = fs.readFileSync(publico("css/components/app-shell.css"), "utf8");
    const angosto = shell.slice(shell.indexOf("@media (max-width: 980px)"));
    assert.match(angosto, /\.submenu-sidebar\.abierto \{\s*display: flex !important;/, "un grupo abierto se ve aunque la ventana sea angosta");

    const oscuro = fs.readFileSync(publico("css/components/modo-oscuro-escritorio.css"), "utf8");
    for (const clase of [".inicio-ab-kpi", ".inicio-ab-tarjeta", ".fav-franja", ".svc-card", ".pedsug-card", ".pmk-tarjeta", ".rm-tarjeta", ".mt-kpi"]) {
        assert.ok(oscuro.includes("body.oscuro " + clase), "modo oscuro para " + clase);
    }
    assert.match(html, /modo-oscuro-escritorio\.css/);

    const explora = fs.readFileSync(publico("js/explorar-nexo-view.js"), "utf8");
    assert.match(explora, /datos\.fabricante = \[\]/, "abarrotes no ve el catalogo de fabricante");
    assert.match(explora, /origen !== "fabricante"/);
    assert.match(explora, /galletas marías/, "el ejemplo del buscador es de abarrotes");
});

test("App del dueño con QR: pantalla de la computadora conectada y apagada por defecto, y el celular canjea el enlace o el codigo", () => {
    assert.match(html, /id="pantallaEnlaceCelular"/);
    assert.match(html, /js\/enlace-celular-view\.js/);
    assert.match(html, /css\/components\/enlace-celular\.css/);
    assert.match(fs.readFileSync(publico("js/config-auth.js"), "utf8"), /"pantallaEnlaceCelular"/);

    // apagada: el boton sigue abriendo la app en otra pestaña; encendida: abre la pantalla del QR
    const beta = fs.readFileSync(publico("js/funciones-beta.js"), "utf8");
    assert.match(beta, /funcionBeta\("enlace_celular"\) \? \(\) => window\.mostrarEnlaceCelular\(\) : \(\) => window\.open\("\/dueno", "_blank"\)/);

    const vista = fs.readFileSync(publico("js/enlace-celular-view.js"), "utf8");
    for (const ruta of ["/enlace-celular/crear", "/enlace-celular/celulares", "/estado"]) assert.ok(vista.includes(ruta), "usa " + ruta);
    assert.match(vista, /clearInterval\(st\.relojId\)/, "deja de preguntar al salir de la pantalla");

    const dueno = fs.readFileSync(publico("dueno.js"), "utf8");
    assert.match(dueno, /new URLSearchParams\(location\.search\)\.get\("enlace"\)/, "abre el enlace del QR");
    assert.match(dueno, /history\.replaceState\(null, "", location\.pathname\)/, "el codigo no se queda en la barra de direcciones");
    assert.match(dueno, /async function enlazarConCodigoDueno/, "tambien acepta el codigo escrito");
    assert.match(fs.readFileSync(publico("dueno.html"), "utf8"), /Tengo un código de la computadora/);
});

test("Pendientes en el Inicio de la computadora: conectados, apagados por defecto, y Fiado solo en abarrotes; el celular oculta Encargos en abarrotes", () => {
    assert.match(html, /js\/inicio-pendientes\.js/);
    assert.match(html, /css\/components\/inicio-pendientes\.css/);

    const codigo = fs.readFileSync(publico("js/inicio-pendientes.js"), "utf8");
    assert.match(codigo, /window\.funcionBeta\("inicio_pendientes"\)/, "solo si el dueño lo enciende");
    assert.match(codigo, /mostrarInventarioBajo\(\)/, "stock critico lleva a Inventario bajo");
    assert.match(codigo, /abrirCreditos\(\)/, "creditos lleva a la pantalla de creditos");
    assert.match(codigo, /mostrarRecibirMarca\(\)/, "facturas llevan a Recibir por marca cuando esta encendido");
    assert.match(codigo, /mostrarRecepcionInteligente\(\)/);
    assert.match(codigo, /Fiado pendiente/);
    assert.match(codigo, /if \(!activa\(\) \|\| !esAbarrotes\(\)\) return;/, "Fiado solo con la funcion encendida y en abarrotes");

    assert.match(fs.readFileSync(publico("dueno.js"), "utf8"), /categoria\.id === "encargos-gestion" && window\.duenoGiro\?\.abarrotesSolo/);
});

test("Diseño nuevo de la computadora: solo existe bajo html.diseno-nuevo (apagado no cambia nada)", () => {
    const css = fs.readFileSync(publico("css/components/diseno-nuevo.css"), "utf8");
    assert.match(html, /css\/components\/diseno-nuevo\.css/);

    // toda regla (fuera de comentarios) empieza con html.diseno-nuevo: ninguna toca el diseño de siempre
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectores = [...sinComentarios.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map(m => m[2].trim()).filter(Boolean);
    assert.ok(selectores.length > 15, "se leyeron las reglas");
    for (const lista of selectores) {
        for (const sel of lista.split(",").map(s => s.trim()).filter(Boolean)) {
            assert.ok(sel.startsWith("html.diseno-nuevo"), "regla sin el prefijo del diseño nuevo: " + sel);
        }
    }

    assert.match(fs.readFileSync(publico("js/funciones-beta.js"), "utf8"), /classList\.toggle\("diseno-nuevo", window\.funcionBeta\("diseno_nuevo"\)\)/);
});

// Bascula digital y venta por importe (funcion nueva "bascula"): lectura del peso, barra de color, cuentas del importe y cableado.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const bascula = require("../public/js/bascula-pos");
const { FUNCIONES } = require("../funciones-beta-server");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");

test("el lector entiende los formatos mas comunes de bascula", () => {
    assert.deepEqual(bascula.parsearLinea("ST,GS,+000.278kg"), { kg: 0.278, estable: true });
    assert.deepEqual(bascula.parsearLinea("US,GS,+000.250kg"), { kg: 0.25, estable: false });
    assert.deepEqual(bascula.parsearLinea("  0.278 kg"), { kg: 0.278, estable: null });
    assert.deepEqual(bascula.parsearLinea("W 1,250kg"), { kg: 1.25, estable: null });
    assert.deepEqual(bascula.parsearLinea("278 g"), { kg: 0.278, estable: null });
    assert.equal(bascula.parsearLinea("1 lb").kg, 0.454);
    assert.equal(bascula.parsearLinea("-000.010kg").kg, 0, "un peso negativo se toma como cero");
    assert.equal(bascula.parsearLinea("sin numero"), null);
    assert.equal(bascula.parsearLinea(""), null);
});

test("meta por importe: $50 de jamon a $180 el kilo son 0.278 kg, al gramo", () => {
    assert.equal(bascula.metaDesdeImporte(50, 180), 0.278);
    assert.equal(bascula.metaDesdeImporte("100", 25), 4);
    assert.equal(bascula.metaDesdeImporte(0, 180), null);
    assert.equal(bascula.metaDesdeImporte(50, 0), null);
    assert.equal(bascula.metaDesdeImporte("", 180), null);
});

test("la barra va de rojo a ambar a verde y se pasa a azul", () => {
    const meta = 0.278;

    assert.equal(bascula.estadoBarra(0, meta).color, "rojo");
    assert.equal(bascula.estadoBarra(0, meta).texto, "Pon el producto en la báscula");

    const falta = bascula.estadoBarra(0.1, meta);
    assert.equal(falta.color, "rojo");
    assert.equal(falta.texto, "Faltan 178 g");

    const casi = bascula.estadoBarra(0.25, meta);
    assert.equal(casi.color, "ambar");
    assert.match(casi.texto, /^Casi, faltan 28 g$/);

    const listo = bascula.estadoBarra(0.278, meta, true);
    assert.equal(listo.color, "verde");
    assert.equal(listo.texto, "Listo");
    assert.equal(listo.listo, true);

    const estabilizando = bascula.estadoBarra(0.278, meta, false);
    assert.equal(estabilizando.color, "verde");
    assert.equal(estabilizando.listo, false, "no se marca Listo mientras el peso se mueve");

    const pasado = bascula.estadoBarra(0.29, meta);
    assert.equal(pasado.color, "azul");
    assert.equal(pasado.texto, "Te pasaste 12 g");
    assert.equal(pasado.porcentaje, 100);

    assert.equal(bascula.estadoBarra(0.2, 0).color, "gris", "sin meta no hay barra");
});

test("el color nunca llega solo: siempre trae texto, y las bandas respetan 80 % y 97 %", () => {
    const meta = 1;
    assert.equal(bascula.estadoBarra(0.79, meta).color, "rojo");
    assert.equal(bascula.estadoBarra(0.8, meta).color, "ambar");
    assert.equal(bascula.estadoBarra(0.96, meta).color, "ambar");
    assert.equal(bascula.estadoBarra(0.97, meta).color, "verde");
    assert.equal(bascula.estadoBarra(1.03, meta).color, "verde");
    assert.equal(bascula.estadoBarra(1.04, meta).color, "azul");
    [0.1, 0.9, 1, 1.5].forEach(peso => assert.ok(bascula.estadoBarra(peso, meta).texto.length > 0));
});

test("en modo importe se cobra lo pedido dentro del 3 %, y lo que pesó si se alejo mas", () => {
    assert.equal(bascula.cantidadImporte(0.278, 0, false), 0.278, "sin bascula: la meta");
    assert.equal(bascula.cantidadImporte(0.278, 0, true), 0.278, "bascula sin peso: la meta");
    assert.equal(bascula.cantidadImporte(0.278, 0.283, true), 0.278, "5 g de mas: se cobra lo pedido");
    assert.equal(bascula.cantidadImporte(0.278, 0.3, true), 0.3, "se paso de verdad: se cobra lo que pesó");
    assert.equal(bascula.cantidadImporte(0.278, 0.2, true), 0.2, "se quedo corto: se cobra lo que pesó");
    assert.equal(bascula.cantidadImporte(0, 0.2, true), null);
});

test("el peso se muestra en gramos debajo de un kilo y en kilos de ahi en adelante", () => {
    assert.equal(bascula.formatoPeso(0.278), "278 g");
    assert.equal(bascula.formatoPeso(1.25), "1.25 kg");
    assert.equal(bascula.formatoPeso(0), "0 g");
});

test("una bascula simulada avisa a quien escucha y se puede quitar", () => {
    const lecturas = [];
    const quitar = bascula.suscribir(dato => lecturas.push(dato));

    assert.equal(bascula.conectada(), false);
    bascula.simular(0.25, false);
    assert.equal(bascula.conectada(), true);
    assert.equal(bascula.pesoKg(), 0.25);
    assert.equal(bascula.estable(), false);

    bascula.simular(0.25, true);
    assert.equal(bascula.estable(), true);

    bascula.simular(null);
    assert.equal(bascula.conectada(), false);

    quitar();
    const antes = lecturas.length;
    bascula.simular(1, true);
    assert.equal(lecturas.length, antes, "ya no escucha despues de quitarse");
    bascula.simular(null);
});

test("la funcion nueva existe y la ventana de peso solo cambia con ella encendida", () => {
    assert.ok(FUNCIONES.bascula, "esta registrada en el servidor");
    assert.match(leer("public/js/funciones-beta.js"), /bascula: "/, "tiene descripcion en la pantalla de funciones");

    const modal = leer("public/js/pos-weight-modal.js");
    assert.match(modal, /window\.funcionBeta\("bascula"\)/, "se pregunta por la funcion antes de mostrar nada nuevo");
    assert.match(modal, /let modo = conBascula \? modoGuardado : "cantidad"/, "sin la funcion el modo es el de siempre");
    assert.match(modal, /<span>Cuantos \$\{etiqueta\.pregunta\} lleva\?<\/span>|Cuantos \$\{etiqueta\.pregunta\} lleva\?/, "la pregunta de kilos sigue igual");
    assert.match(modal, /conBascula \? `<div id="modalPesoBascula"/, "el panel de bascula solo se arma con la funcion");
    assert.match(modal, /if \(quitarEscucha\) quitarEscucha\(\)/, "al cerrar deja de escuchar la bascula");

    const html = leer("public/index.html");
    assert.match(html, /js\/bascula-pos\.js/);
    assert.ok(html.indexOf("js/bascula-pos.js") < html.indexOf("js/pos-weight-modal.js"));
});

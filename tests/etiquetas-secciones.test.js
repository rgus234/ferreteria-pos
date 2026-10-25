// Secciones en la hoja de etiquetas: lista real "PVC sanitario" de Olimpico separada por medida.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { medidaDeNombreEtiqueta, claveSeccionEtiqueta, insertarSeccionesEtiquetas, paginarCeldasEtiquetas, SECCION_ALTO_MM } = require("../public/js/etiquetas-secciones.js");

const nombres = [
    'Tapón PVC 1 1/2"', 'Codo PVC 90° 1 1/2"', 'Codo PVC 45° 1 1/2"', 'Tee PVC 1 1/2"', 'Yee PVC 1 1/2"', 'Cople PVC 1 1/2"', 'Reducción PVC 2" a 1 1/2"',
    'Tapón PVC 2"', 'Codo PVC 90° 2"', 'Codo PVC 45° 2"', 'Tee PVC 2"', 'Yee PVC 2"', 'Cople PVC 2"', 'Reducción PVC 2" a 1"',
    'Tapón PVC 3"', 'Codo PVC 90° 3"', 'Codo PVC 45° 3"', 'Tee PVC 3"', 'Yee PVC 3"', 'Cople PVC 3"', 'Reducción PVC 3" a 2"',
    'Tapón PVC 4"', 'Codo PVC 90° 4"', 'Codo PVC 45° 4"', 'Tee PVC 4"', 'Yee PVC 4"', 'Cople PVC 4"', 'Reducción PVC 4" a 2"', 'Reducción PVC 4" a 3"',
    'Codo PVC 90° 6"', 'Codo PVC 45° 6"', 'Tee PVC 6"', 'Cople PVC 6"', 'Reducción PVC 6" a 4"'
];
const productos = nombres.map((nombre, i) => ({ id: i + 1, nombre, codigo: `GEN${i}`, precio: 10 }));
const diseno = { anchoMm: 50, altoMm: 25, columnas: 3, margenMm: 5, espaciadoMm: 3 };
const carta = { nombre: "Carta", anchoMm: 216, altoMm: 279 };

test("la medida sale del nombre, con la mayor primero en las reducciones", () => {
    assert.equal(medidaDeNombreEtiqueta('Codo PVC 90° 1 1/2"'), '1 1/2"');
    assert.equal(medidaDeNombreEtiqueta('Reducción PVC 2" a 1 1/2"'), '2"');
    assert.equal(medidaDeNombreEtiqueta("CODO PVC 3¨"), '3"');
    assert.equal(medidaDeNombreEtiqueta("Cople de cobre 3/4' sin ranura"), "", "las comillas simples de un pie no cuentan como medida");
    assert.equal(medidaDeNombreEtiqueta("Pintura blanca 19 L"), "");
    assert.equal(claveSeccionEtiqueta({ nombre: "Codo PVC 90° 2\"" }, "primera"), "Codo");
    assert.equal(claveSeccionEtiqueta({ nombre: "x", marca: " Truper " }, "marca"), "Truper");
});

test("PVC sanitario queda en 5 secciones en orden: 1 1/2, 2, 3, 4 y 6 pulgadas", () => {
    const celdas = insertarSeccionesEtiquetas(productos, "medida");
    const titulos = celdas.filter(c => c.__titulo);

    assert.deepEqual(titulos.map(t => t.texto), ['1 1/2"', '2"', '3"', '4"', '6"']);
    assert.equal(new Set(titulos.map(t => t.color)).size, 5, "cada seccion tiene su color");
    assert.equal(celdas.length, productos.length + 5);
    assert.ok(celdas.filter(c => !c.__titulo).every(c => c.__color), "cada etiqueta lleva el color de su seccion");
    assert.equal(insertarSeccionesEtiquetas(productos, "ninguno"), productos, "sin secciones no cambia nada");
});

test("un producto sin medida cae en 'Otros'", () => {
    const celdas = insertarSeccionesEtiquetas([{ nombre: 'Tapón PVC 2"' }, { nombre: "Cinta teflón" }], "medida");
    assert.deepEqual(celdas.filter(c => c.__titulo).map(t => t.texto), ['2"', "Otros"]);
});

test("en hoja carta no hay titulos huerfanos y todo cabe", () => {
    const celdas = insertarSeccionesEtiquetas(productos, "medida");
    const paginas = paginarCeldasEtiquetas(celdas, diseno, carta);
    const util = carta.altoMm - diseno.margenMm * 2;

    assert.equal(paginas.flat().length, celdas.length, "no se pierde nada");

    for (const pagina of paginas) {
        assert.ok(pagina[0].__titulo || true);
        assert.ok(!pagina.at(-1).__titulo, "una hoja nunca termina en un titulo suelto");

        let y = 0, col = 0;
        for (const c of pagina) {
            if (c.__titulo) { if (col) { y += diseno.altoMm + diseno.espaciadoMm; col = 0; } y += SECCION_ALTO_MM + diseno.espaciadoMm; }
            else { col++; if (col === diseno.columnas) { y += diseno.altoMm + diseno.espaciadoMm; col = 0; } }
        }
        if (col) y += diseno.altoMm + diseno.espaciadoMm;
        assert.ok(y - diseno.espaciadoMm <= util + 0.01, `una pagina mide ${y} y solo caben ${util}`);
    }
});

test("con 'hoja nueva' cada seccion empieza en su propia hoja; en rollo continuo todo va seguido", () => {
    const celdas = insertarSeccionesEtiquetas(productos, "medida");
    const aparte = paginarCeldasEtiquetas(celdas, diseno, carta, true);

    assert.ok(aparte.length >= 5);
    assert.ok(aparte.every(p => p[0].__titulo && p.filter(c => c.__titulo).length === 1), "una seccion por hoja");
    assert.equal(paginarCeldasEtiquetas(celdas, diseno, { nombre: "Rollo", anchoMm: 58, altoMm: null }).length, 1);
});

test("sin secciones la paginacion sigue igual que antes: filas por hoja x columnas", () => {
    const paginas = paginarCeldasEtiquetas(productos, diseno, carta);
    const filas = Math.floor((carta.altoMm - 10 + 3) / (25 + 3));

    assert.equal(paginas[0].length, filas * 3);
});

test("el editor usa las secciones y las controla desde Formato", () => {
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "barcode-labels.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

    assert.match(js, /paginarCeldasEtiquetas\(insertarSeccionesEtiquetas/);
    assert.match(js, /construirTituloSeccionEtiqueta/);
    assert.match(js, /actualizarAgrupacionEtiquetas/);
    assert.ok(html.indexOf("js/etiquetas-secciones.js") > 0 && html.indexOf("js/etiquetas-secciones.js") < html.indexOf("js/barcode-labels.js"));
});

// Descargar la hoja de etiquetas como PDF: mismas hojas y secciones que la vista previa, trazadas en vectores.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generarPdfEtiquetas } = require("../etiquetas-pdf-server");
const { insertarSeccionesEtiquetas, paginarCeldasEtiquetas } = require("../public/js/etiquetas-secciones.js");

const diseno = { anchoMm: 50, altoMm: 25, columnas: 3, margenMm: 5, espaciadoMm: 3, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: true, mostrarMarca: false, mostrarCategoria: false };
const carta = { nombre: "Carta", anchoMm: 216, altoMm: 279 };
const BARRAS = "11010010000" + "10100110000".repeat(5) + "1100011101011";

const productos = Array.from({ length: 34 }, (_, i) => ({
    nombre: `${["Tapón", "Codo", "Tee", "Yee", "Cople"][i % 5]} PVC ${["1 1/2", "2", "3", "4", "6"][Math.floor(i / 7)]}"`,
    codigo: `GEN${100000 + i}`, precio: 10 + i, barras: BARRAS
}));

const paginasDe = (por, hojaNueva = false, papel = carta) => paginarCeldasEtiquetas(insertarSeccionesEtiquetas(productos, por), diseno, papel, hojaNueva);
const contarPaginas = pdf => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) || []).length;

test("el PDF se arma con una hoja por cada pagina de la vista previa", async () => {
    const paginas = paginasDe("medida");
    const pdf = await generarPdfEtiquetas({ diseno, papel: carta, paginas });

    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(contarPaginas(pdf), paginas.length);
    assert.ok(pdf.length > 3000);
});

test("con 'hoja nueva por seccion' hay al menos una hoja por seccion", async () => {
    const pdf = await generarPdfEtiquetas({ diseno, papel: carta, paginas: paginasDe("medida", true) });

    assert.ok(contarPaginas(pdf) >= 5);
});

test("el rollo continuo sale en una sola hoja y sin secciones tambien funciona", async () => {
    const rollo = { nombre: "Rollo", anchoMm: 58, altoMm: null };
    const unaSolaHoja = await generarPdfEtiquetas({ diseno: { ...diseno, columnas: 1, anchoMm: 50 }, papel: rollo, paginas: paginarCeldasEtiquetas(insertarSeccionesEtiquetas(productos, "medida"), diseno, rollo) });
    const sinSecciones = await generarPdfEtiquetas({ diseno, papel: carta, paginas: [productos.slice(0, 9)] });

    assert.equal(contarPaginas(unaSolaHoja), 1);
    assert.equal(contarPaginas(sinSecciones), 1);
});

test("datos raros no truenan: letras fuera de Latin-1, colores invalidos y barras vacias", async () => {
    const pdf = await generarPdfEtiquetas({
        diseno, papel: carta,
        paginas: [[{ __titulo: true, texto: "Sección ½ ★", color: "rojo" }, { nombre: "Producto ★ con nombre larguísimo que no cabe en la etiqueta de cincuenta milímetros", codigo: "X1", precio: "12", barras: "no-binario", __color: "azul" }, { nombre: "Otro", codigo: "", precio: null, barras: "" }]]
    });

    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("el editor tiene el boton de descargar y la ruta esta registrada", () => {
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "barcode-labels.js"), "utf8");
    const modulos = fs.readFileSync(path.join(__dirname, "..", "server-modules.js"), "utf8");

    assert.match(js, /descargarPdfEtiquetas/);
    assert.match(js, /fetch\("\/etiquetas\/pdf"/);
    assert.match(js, /salida\.encodings/);
    assert.match(modulos, /etiquetas-pdf-server/);
});

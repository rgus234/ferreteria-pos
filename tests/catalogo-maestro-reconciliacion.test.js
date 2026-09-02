// Pruebas de la Fase 1: convertir catalogos de proveedor en identidad
// global de producto.
//
// Lo que se prueba aqui son las REGLAS que fijo el dueno, no el feliz
// camino: que un EAN valga por un solo producto, que ante conflicto NO se
// fusione nada, y que del proveedor solo se tome identidad y jamas sus
// precios.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const rec = require("../catalogo-maestro-reconciliacion");

// ---------------------------------------------------------------------
// Digito verificador: la prueba de que un codigo de barras es real
// ---------------------------------------------------------------------

test("eanValido acepta codigos de barras reales del catalogo", () => {
    // EAN reales verificados contra el catalogo de Diprofer.
    assert.equal(rec.eanValido("7501206665510"), true);
    assert.equal(rec.eanValido("7506610200760"), true);
    assert.equal(rec.eanValido("7506240618935"), true);
});

test("eanValido rechaza numeros inventados y basura", () => {
    // Mismo largo, digito verificador equivocado.
    assert.equal(rec.eanValido("7501206665511"), false);
    assert.equal(rec.eanValido("1234567890123"), false);
    assert.equal(rec.eanValido("123"), false);
    assert.equal(rec.eanValido(""), false);
    assert.equal(rec.eanValido("750120666551X"), false);
});

test("pareceCodigoFabricante distingue el codigo TRUPER del interno del proveedor", () => {
    assert.equal(rec.pareceCodigoFabricante("103013"), true);
    assert.equal(rec.pareceCodigoFabricante("17545"), true);
    // Codigo con letras = codigo interno de un proveedor, no sirve como
    // identidad global.
    assert.equal(rec.pareceCodigoFabricante("WT300GL"), false);
    assert.equal(rec.pareceCodigoFabricante(""), false);
});

// ---------------------------------------------------------------------
// Reglas de reconciliacion
// ---------------------------------------------------------------------

const FILA = {
    ean: "7506610200760",
    codigoFabricante: "103013",
    nombre: "Pinza multiuso 8\" punta larga, comfort grip",
    marca: "TRUPER EXPERT",
    fuente: "Diprofer"
};

test("una fila con identidad completa crea un producto maestro", () => {
    assert.deepEqual(rec.decidirReconciliacion(FILA, null), { accion: "crear" });
});

test("sin codigo de barras no entra al Maestro", () => {
    const d = rec.decidirReconciliacion({ ...FILA, ean: "" }, null);
    assert.equal(d.accion, "descartar");
    assert.equal(d.tipo, "sin_ean");
});

test("un codigo de barras que no pasa el digito verificador no entra", () => {
    const d = rec.decidirReconciliacion({ ...FILA, ean: "7506610200761" }, null);
    assert.equal(d.accion, "descartar");
    assert.equal(d.tipo, "ean_invalido");
});

test("sin nombre no entra: seria una ficha hueca", () => {
    const d = rec.decidirReconciliacion({ ...FILA, nombre: "" }, null);
    assert.equal(d.accion, "descartar");
});

test("REGLA: un EAN corresponde a un unico producto maestro", () => {
    // El mismo producto visto otra vez (otro catalogo, misma identidad)
    // se enlaza; no se crea un segundo maestro.
    const existente = {
        id: 7, nombre: "Pinza multiuso 8\" punta larga, comfort grip",
        marca: "TRUPER EXPERT", codigo_fabricante: "103013"
    };
    assert.deepEqual(rec.decidirReconciliacion(FILA, existente), { accion: "enlazar" });
});

test("REGLA: ante codigo de fabricante distinto NO se fusiona", () => {
    const existente = {
        id: 7, nombre: "Pinza multiuso 8\" punta larga",
        marca: "TRUPER EXPERT", codigo_fabricante: "999999"
    };
    const d = rec.decidirReconciliacion(FILA, existente);
    assert.equal(d.accion, "conflicto");
    assert.equal(d.tipo, "codigo_distinto");
});

test("REGLA: ante marca distinta NO se fusiona", () => {
    const existente = {
        id: 7, nombre: "Pinza multiuso 8\" punta larga",
        marca: "URREA", codigo_fabricante: "103013"
    };
    const d = rec.decidirReconciliacion(FILA, existente);
    assert.equal(d.accion, "conflicto");
    assert.equal(d.tipo, "marca_distinta");
});

test("REGLA: ante descripcion incompatible NO se fusiona", () => {
    // Este es el caso real del cautin: un EAN pegado a un producto que no
    // le corresponde. Fusionarlos mezclaria dos articulos distintos.
    const existente = {
        id: 7, nombre: "Cautin 30 W tipo lapiz para trabajo ligero",
        marca: "TRUPER EXPERT", codigo_fabricante: "103013"
    };
    const d = rec.decidirReconciliacion(FILA, existente);
    assert.equal(d.accion, "conflicto");
    assert.equal(d.tipo, "descripcion_distinta");
});

test("diferencias de redaccion NO son conflicto", () => {
    // "Bolsa con 100 pijas #8 x 1' multiusos" vs "100 pijas #8 x 1'
    // cabeza plana": es el mismo producto escrito distinto.
    const existente = {
        id: 7, nombre: "Pinza multiuso 8 pulgadas punta larga comfort grip TRUPER",
        marca: "TRUPER EXPERT", codigo_fabricante: "103013"
    };
    assert.equal(rec.decidirReconciliacion(FILA, existente).accion, "enlazar");
});

test("parecidoDescripcion tolera acentos, comillas y mayusculas", () => {
    assert.ok(rec.parecidoDescripcion(
        "Cautín 30 W tipo lápiz para trabajo ligero",
        "CAUTIN 30 W TIPO LAPIZ PARA TRABAJO LIGERO"
    ) > 0.9);
    assert.ok(rec.parecidoDescripcion(
        "Cautin 30 W tipo lapiz",
        "Juego de manerales para regadera"
    ) < rec.PARECIDO_MINIMO);
});

// ---------------------------------------------------------------------
// Lo que NUNCA debe cruzar del proveedor al Maestro global
// ---------------------------------------------------------------------

test("el Maestro no recibe precios ni datos comerciales del proveedor", () => {
    // Se revisa el codigo fuente: es la unica forma de garantizar que
    // nadie agregue mañana un precio del proveedor "de paso". Los precios
    // de referencia se LEEN del catalogo del fabricante en la consulta,
    // pero no se copian al Maestro.
    const fuente = fs.readFileSync(
        path.join(__dirname, "..", "catalogo-maestro-reconciliacion.js"), "utf8"
    );

    // Se aisla el bloque que escribe en el Maestro.
    const inicio = fuente.indexOf("async function crearProductoMaestro");
    const fin = fuente.indexOf("async function crearIdentificadores");
    const bloqueEscritura = fuente.slice(inicio, fin);

    for (const prohibido of ["precio_distribuidor", "precio_medio_mayoreo", "precio_publico", "precio_mayoreo", "costo", "stock"]) {
        assert.ok(
            !bloqueEscritura.includes(prohibido),
            `crearProductoMaestro no debe escribir "${prohibido}" en el Catalogo Maestro`
        );
    }
});

test("el INSERT al Maestro solo lleva campos de identidad", () => {
    const fuente = fs.readFileSync(
        path.join(__dirname, "..", "catalogo-maestro-reconciliacion.js"), "utf8"
    );
    const match = fuente.match(/INSERT INTO public\.catalogo_maestro_productos\s*\(([^)]+)\)/);
    assert.ok(match, "deberia existir un INSERT al Catalogo Maestro");

    const columnas = match[1].split(",").map(c => c.trim());
    const permitidas = new Set([
        "codigo", "marca", "nombre", "clave", "unidad", "ean", "fabricante",
        "codigo_fabricante", "origen", "reconciliacion_id", "fuente_identidad", "fuente_fecha"
    ]);

    for (const columna of columnas) {
        assert.ok(permitidas.has(columna), `columna inesperada en el Maestro: ${columna}`);
    }
});

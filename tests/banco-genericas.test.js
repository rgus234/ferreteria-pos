// Banco de fotos genericas: indice integro y sugerencia solo cuando el nombre EMPIEZA con un alias.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const carpeta = path.join(__dirname, "..", "public", "banco-genericas");
const indice = JSON.parse(fs.readFileSync(path.join(carpeta, "indice.json"), "utf8"));
const { bancoGenericasBuscar } = require("../public/js/banco-genericas.js");

test("cada concepto tiene su foto, alias unicos y datos completos", () => {
    const vistos = new Set();

    for (const c of indice.conceptos) {
        assert.ok(c.slug && c.nombre && c.categoria && c.alias.length, c.slug);
        assert.ok(fs.existsSync(path.join(carpeta, c.archivo)), `${c.slug}: falta la foto`);
        for (const a of c.alias) { assert.ok(!vistos.has(a), `alias repetido: ${a}`); vistos.add(a); }
    }
});

test("sugiere por alias al inicio del nombre y no en medio (salsa de tomate, jugo de naranja)", () => {
    const slug = nombre => bancoGenericasBuscar(nombre, indice)?.slug ?? null;

    assert.equal(slug("Plátano"), "platano");
    assert.equal(slug("platanos tabasco kg"), "platano");
    assert.equal(slug("JITOMATE saladette"), "tomate");
    assert.equal(slug("manzana verde"), "manzana-verde", "gana el alias mas largo");
    assert.equal(slug("Manzana gala"), "manzana");
    assert.equal(slug("salsa de tomate"), null);
    assert.equal(slug("jugo de naranja"), null);
    assert.equal(slug("naranja sabor refresco"), null);
    assert.equal(slug("pa"), null);
    assert.equal(slug("papaya"), "papaya", "no confunde papa con papaya");
    assert.equal(slug("papa blanca 1 kg"), "papa");
    assert.equal(slug("coliflor"), "coliflor", "col no atrapa coliflor");
});

test("el formulario carga el banco de genericas y la pagina lo sirve", () => {
    assert.match(fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8"), /js\/banco-genericas\.js\?v=/);
});

test("ningun alias nuevo del banco se confunde con ferreteria (clavo, mostaza en aderezo, anis licor)", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const indice = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "banco-genericas", "indice.json"), "utf8"));
    const alias = new Set(indice.conceptos.flatMap(c => c.alias));

    for (const ambiguo of ["clavo", "clavos", "mostaza", "anis"]) assert.ok(!alias.has(ambiguo), `"${ambiguo}" solo, sugeriria una foto equivocada`);
    assert.ok(alias.has("clavo de olor"), "el clavo de cocina se reconoce por su nombre completo");
});

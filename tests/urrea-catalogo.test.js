// Catalogo de Urrea para el Catalogo Maestro: marca y categoria salen de las categorias del sitio; nunca precio ni foto.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { marcaDe, categoriaDe, limpiarNombre, descripcionCorta } = require("../scripts/importar-urrea-al-maestro");

const cats = (...rutas) => rutas.map(([nombre, ruta]) => ({ nombre, ruta }));

test("la marca sale de la categoria de marca del producto (urrea, surtek, surtek/lock, foy)", () => {
    assert.equal(marcaDe({ categorias: cats(["Productos", "productos"], ["Torquímetros", "productos/herramientas-de-torque/torquimetros"], ["Urrea", "urrea"]) }), "Urrea");
    assert.equal(marcaDe({ categorias: cats(["Productos", "productos"], ["Lock", "surtek/lock"]) }), "Surtek");
    assert.equal(marcaDe({ categorias: cats(["Foy", "foy"]) }), "Foy");
    assert.equal(marcaDe({ categorias: cats(["Productos", "productos"]) }), "");
});

test("la categoria es la mas especifica dentro de Productos", () => {
    assert.equal(categoriaDe({ categorias: cats(["Productos", "productos"], ["Herramientas de  torque", "productos/herramientas-de-torque"], ["Torquímetros", "productos/herramientas-de-torque/torquimetros"], ["Urrea", "urrea"]) }), "Torquímetros");
    assert.equal(categoriaDe({ categorias: [] }), "");
});

test("el nombre y la descripcion se limpian y se acotan", () => {
    assert.equal(limpiarNombre("  Dado   cuadro 3/8\n punta torx  "), "Dado cuadro 3/8 punta torx");
    assert.equal(limpiarNombre("x".repeat(500)).length, 240);
    assert.equal(descripcionCorta("\n- Acero\n- Fosfatizado"), "• Acero • Fosfatizado");
});

test("el importador solo escribe identidad: nada de precios ni fotos", () => {
    const importador = fs.readFileSync(path.join(__dirname, "..", "scripts", "importar-urrea-al-maestro.js"), "utf8");
    const rastreador = fs.readFileSync(path.join(__dirname, "..", "scripts", "rastrear-urrea.js"), "utf8");
    const insert = importador.match(/INSERT INTO public\.catalogo_maestro_productos[\s\S]*?FROM unnest/)[0];

    assert.doesNotMatch(insert, /precio|imagen|foto/i);
    assert.doesNotMatch(rastreador, /pricing|price_range|regularPrice|small_image|\bimage\b/i, "el rastreador ni siquiera pide precios ni imagenes");
    assert.match(importador, /URREA-\$\{p\.sku\}/, "un codigo que ya es de otro fabricante entra con prefijo");
    assert.match(rastreador, /robots|PAUSA_MS/i);
});

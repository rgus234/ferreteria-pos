const test = require("node:test");
const assert = require("node:assert/strict");
const { clasificar, ARBOL, GIRO_ARBOL } = require("../categorias-ferreteria");

test("arbol: 3 niveles sin repetidos y cada subcategoria cuelga de una sola categoria", () => {
    assert.equal(GIRO_ARBOL, "ferreteria_v2");
    assert.ok(ARBOL.length > 150);

    const claves = new Set();
    const categoriaDeSub = new Map();
    for (const { departamento, categoria, nombre } of ARBOL) {
        assert.ok(departamento && categoria && nombre, "los tres niveles llenos");
        const clave = [departamento, categoria, nombre].join("|");
        assert.ok(!claves.has(clave), `repetida: ${clave}`);
        claves.add(clave);

        // categorias_nexo es unico por (giro, departamento, nombre): la subcategoria no puede estar en dos categorias.
        const previa = categoriaDeSub.get(`${departamento}|${nombre}`);
        assert.ok(previa === undefined || previa === categoria, `subcategoria en dos categorias: ${departamento} > ${nombre}`);
        categoriaDeSub.set(`${departamento}|${nombre}`, categoria);
    }
});

test("clasificador: lee el tipo de producto, no la marca", () => {
    const casos = [
        ["Pinza para electricista con mango rubber grip", "Pinzas y cortadores", "Pinzas"],
        ["Pinza de electricista, URREA", "Pinzas y cortadores", "Pinzas"],
        ["Carbones de repuesto para taladro, Truper", "Refacciones de herramienta", "Carbones"],
        ["Pintura en aerosol, gris claro, bote tradicional, 400 ml", "Pintura", "Pintura en aerosol"],
        ["Candado de hierro 50 mm gancho largo en blíster, HERMEX", "Candados", "Candados"],
        ["Juego de cinceles, 3 piezas", "Limas y cinceles", "Cinceles, formones y punzones"],
        ["Playera polo manga corta", "Ropa de trabajo", "Playeras y camisas"],
        ["Exhibidor con mezcladora F-319, FOSET", "Exhibidores", "Exhibidores con producto"],
        ["Dado largo de 1/2 x 19 mm", "Dados y matracas", "Dados"]
    ];

    for (const [nombre, categoria, sub] of casos) {
        const r = clasificar(nombre);
        assert.ok(r, nombre);
        assert.equal(r.cat, categoria, nombre);
        assert.equal(r.sub, sub, nombre);
        assert.ok(ARBOL.some(a => a.departamento === r.dep && a.categoria === r.cat && a.nombre === r.sub), `${nombre}: resultado fuera del arbol`);
    }
});

test("clasificador: sin pistas no adivina", () => {
    assert.equal(clasificar("Articulo especial 12345"), null);
    assert.equal(clasificar(""), null);
});

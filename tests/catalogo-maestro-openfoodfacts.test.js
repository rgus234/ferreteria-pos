// Identidad de abarrotes desde Open Food Facts: las reglas de entrada al
// Catalogo Maestro (solo identidad, EAN real, un EAN = un producto) y la
// clasificacion a las subcategorias Nexo de abarrotes. Sin red ni base de
// datos: son funciones puras.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const off = require("../catalogo-maestro-openfoodfacts");

// EAN reales con digito verificador valido.
const EAN_COCA = "7501055300075";
const EAN_VALIDO_2 = "7506610200760";

function registro(extra = {}) {
    return {
        code: EAN_COCA,
        product_name: "Coca-Cola Original",
        brands: "Coca-Cola, The Coca-Cola Company",
        quantity: "600 ml",
        categories_tags: "en:beverages,en:carbonated-drinks,en:sodas",
        last_modified_t: "1760000000",
        ...extra
    };
}

test("un registro completo se convierte en una fila de identidad, sin precio ni imagen", () => {
    const r = off.normalizarRegistroOff(registro());

    assert.equal(r.ok, true);
    assert.equal(r.fila.ean, EAN_COCA);
    assert.equal(r.fila.nombre, "Coca-Cola Original");
    assert.equal(r.fila.marca, "Coca-Cola", "solo la primera marca");
    assert.equal(r.fila.presentacion, "600 ml");
    assert.equal(r.fila.origen, "open_food_facts");
    assert.equal(r.fila.fuente, "Open Food Facts");
    assert.ok(r.fila.fuenteFecha instanceof Date);
    assert.equal(r.fila.codigoFabricante, "", "no inventa un codigo de fabricante");
    assert.ok(!("precio" in r.fila) && !("imagen" in r.fila), "solo identidad");
    assert.deepEqual(r.categoriasTags, ["en:beverages", "en:carbonated-drinks", "en:sodas"]);
});

test("un EAN invalido o inventado no entra", () => {
    assert.deepEqual(off.normalizarRegistroOff(registro({ code: "7501055300076" })), { ok: false, motivo: "ean_invalido" });
    assert.deepEqual(off.normalizarRegistroOff(registro({ code: "1234567890123" })), { ok: false, motivo: "ean_invalido" });
    assert.deepEqual(off.normalizarRegistroOff(registro({ code: "" })), { ok: false, motivo: "sin_ean" });
    assert.deepEqual(off.normalizarRegistroOff(registro({ code: "75010553X0075" })), { ok: false, motivo: "sin_ean" });
});

test("los codigos que cada tienda genera (empiezan con 2) no identifican un producto global", () => {
    // 2000000000008 es un EAN-13 con digito verificador correcto.
    assert.deepEqual(off.normalizarRegistroOff(registro({ code: "2000000000008" })), { ok: false, motivo: "codigo_interno_tienda" });
});

test("un GTIN-14 de caja no entra: no es lo que se escanea en el mostrador", () => {
    assert.deepEqual(off.normalizarRegistroOff(registro({ code: "17501055300072" })), { ok: false, motivo: "gtin14" });
});

test("un UPC-12 (producto americano que se vende en Mexico) si entra", () => {
    const r = off.normalizarRegistroOff(registro({ code: "041789001734", product_name: "Maruchan Instant Lunch", brands: "Maruchan" }));
    assert.equal(r.ok, true);
    assert.equal(r.fila.ean, "041789001734");
});

test("sin nombre util se descarta", () => {
    assert.equal(off.normalizarRegistroOff(registro({ product_name: "" })).motivo, "sin_nombre");
    assert.equal(off.normalizarRegistroOff(registro({ product_name: "  ab " })).motivo, "sin_nombre");
    assert.equal(off.normalizarRegistroOff(registro({ product_name: "1234 567 89" })).motivo, "nombre_sin_letras");
    assert.equal(off.normalizarRegistroOff(registro({ product_name: "test producto" })).motivo, "nombre_placeholder");
    assert.equal(off.normalizarRegistroOff(registro({ product_name: "x".repeat(200) })).motivo, "nombre_demasiado_largo");
});

test("prefiere el nombre en espanol y cae al generico si falta", () => {
    assert.equal(off.normalizarRegistroOff(registro({ product_name_es: "Refresco de cola" })).fila.nombre, "Refresco de cola");
    assert.equal(off.normalizarRegistroOff(registro({ product_name: "", generic_name: "Galletas surtidas" })).fila.nombre, "Galletas surtidas");
});

test("los nombres en un solo caso se acomodan; los mezclados se respetan", () => {
    assert.equal(off.titulo("PAN BLANCO GRANDE"), "Pan Blanco Grande");
    assert.equal(off.titulo("leche entera de vaca"), "Leche Entera de Vaca");
    assert.equal(off.titulo("coca-cola sin azucar"), "Coca-Cola sin Azucar", "las palabras menores (sin, de, la...) quedan en minuscula");
    assert.equal(off.titulo("Coca-Cola sin Azúcar"), "Coca-Cola sin Azúcar", "ya estaba mezclado: no se toca");
    assert.equal(off.titulo("  muchos   espacios "), "Muchos Espacios");
});

test("una marca absurdamente larga se descarta en vez de ensuciar el catalogo", () => {
    assert.equal(off.primeraMarca("a".repeat(80)), "");
    assert.equal(off.primeraMarca(""), "");
    assert.equal(off.primeraMarca(undefined), "");
});

// ---------------------------------------------------------------------
// Categoria Nexo
// ---------------------------------------------------------------------

const casos = [
    [["en:beverages", "en:carbonated-drinks", "en:sodas"], "Coca-Cola Original", "Refrescos"],
    [["en:beverages", "en:waters", "en:spring-waters"], "Ciel", "Aguas"],
    [["en:beverages", "en:fruit-juices"], "Jumex Mango", "Jugos y nectares"],
    [["en:beverages", "en:energy-drinks"], "Red Bull", "Bebidas energeticas"],
    [["en:snacks", "en:salty-snacks", "en:chips-and-fries", "en:potato-crisps"], "Sabritas Original", "Papas y frituras"],
    [["en:snacks", "en:sweet-snacks", "en:biscuits-and-cakes", "en:biscuits"], "Marias Gamesa", "Galletas"],
    [["en:snacks", "en:sweet-snacks", "en:cocoa-and-its-products", "en:chocolates"], "Carlos V", "Dulces y chocolates"],
    [["en:dairies", "en:milks"], "Lala Entera", "Leche"],
    [["en:dairies", "en:fermented-foods", "en:yogurts"], "Yoplait Fresa", "Yogurt"],
    [["en:breads", "en:sliced-breads"], "Bimbo Blanco Grande", "Pan de caja"],
    [["en:tortillas"], "Tortillas de maiz", "Tortillas"],
    [["en:plant-based-foods", "en:cereals-and-potatoes", "en:pastas"], "La Moderna Codito", "Pastas y sopas"],
    [["en:meals", "en:canned-foods", "en:fishes", "en:tunas"], "Dolores Atun", "Enlatados"],
    [["en:condiments", "en:sauces", "en:ketchup"], "Heinz Catsup", "Condimentos y especias"],
    [["en:alcoholic-beverages", "en:beers"], "Corona Extra", "Bebidas alcoholicas"]
];

for (const [tags, nombre, esperada] of casos) {
    test(`clasifica "${nombre}" como ${esperada}`, () => {
        assert.equal(off.subcategoriaNexoAbarrotes(tags, nombre, ""), esperada);
    });
}

test("sin pistas suficientes queda SIN categoria: mejor vacio que mal clasificado", () => {
    assert.equal(off.subcategoriaNexoAbarrotes([], "Producto raro", ""), null);
    assert.equal(off.subcategoriaNexoAbarrotes(["en:foods"], "Algo", ""), null);
});

test("las categorias de OFF mandan sobre el nombre", () => {
    // El nombre dice "agua" pero OFF lo ubica como jugo.
    assert.equal(off.subcategoriaNexoAbarrotes(["en:fruit-juices"], "Agua de jamaica", ""), "Jugos y nectares");
});

test("el nombre desempata cuando OFF no trae categorias", () => {
    assert.equal(off.subcategoriaNexoAbarrotes([], "Refresco de cola 2 litros", ""), "Refrescos");
    assert.equal(off.subcategoriaNexoAbarrotes([], "Atun en agua", ""), "Enlatados");
});

test("lo procesado con fruta no se clasifica como fruta fresca", () => {
    assert.notEqual(off.subcategoriaNexoAbarrotes(["en:fruits-and-vegetables-based-foods", "en:jams"], "Mermelada de fresa", ""), "Frutas");
    assert.equal(off.subcategoriaNexoAbarrotes(["en:fresh-fruits", "en:apples"], "Manzana roja", ""), "Frutas");
});

test("toda subcategoria que producen las reglas existe en el arbol de abarrotes", () => {
    // Nombres tal cual los siembra categorias-nexo.js para giro abarrotes.
    const { CATEGORIAS_NEXO_ABARROTES } = require("../categorias-nexo");
    const nombres = new Set(CATEGORIAS_NEXO_ABARROTES.map(c => c.nombre));

    for (const regla of off.REGLAS_CATEGORIA) {
        const normalizado = [...nombres].map(n => n.toLowerCase());
        assert.ok(normalizado.includes(regla.subcategoria.toLowerCase()), `la subcategoria "${regla.subcategoria}" no existe en el arbol de abarrotes`);
    }
});

// ---------------------------------------------------------------------
// Calidad de los datos
// ---------------------------------------------------------------------

test("un registro con solo un nombre suelto se descarta, salvo que el EAN sea mexicano (750)", () => {
    const suelto = { code: "0011848330037", product_name: "Chamoy", brands: "", quantity: "", categories_tags: "" };
    assert.deepEqual(off.normalizarRegistroOff(suelto), { ok: false, motivo: "sin_datos_utiles" });

    // 7501055300075: prefijo mexicano, aunque venga pobre es probable que sea real.
    const mexicano = { code: EAN_COCA, product_name: "Coca-Cola", brands: "", quantity: "", categories_tags: "" };
    assert.equal(off.normalizarRegistroOff(mexicano).ok, true);

    // Con cualquiera de marca / categoria / presentacion ya vale.
    assert.equal(off.normalizarRegistroOff({ ...suelto, brands: "La Anita" }).ok, true);
    assert.equal(off.normalizarRegistroOff({ ...suelto, quantity: "250 g" }).ok, true);
    assert.equal(off.normalizarRegistroOff({ ...suelto, categories_tags: "en:sauces" }).ok, true);
});

test("las variantes de una misma marca se unifican a la forma mas frecuente", () => {
    const filas = [
        { marca: "Nestle", fabricante: "Nestle" },
        { marca: "Nestlé", fabricante: "Nestlé" },
        { marca: "Nestlé", fabricante: "Nestlé" },
        { marca: "NESTLÉ", fabricante: "NESTLÉ" },
        { marca: "Great value", fabricante: "Great value" },
        { marca: "Great Value", fabricante: "Great Value" },
        { marca: "Lala", fabricante: "Lala" },
        { marca: "", fabricante: "" }
    ];

    const cambiadas = off.unificarMarcas(filas);

    assert.deepEqual(filas.map(f => f.marca), ["Nestlé", "Nestlé", "Nestlé", "Nestlé", "Great Value", "Great Value", "Lala", ""]);
    assert.deepEqual(filas.map(f => f.fabricante), filas.map(f => f.marca), "el fabricante sigue a la marca");
    assert.equal(cambiadas, 3);
});

test("las bebidas a base de fruta se clasifican como jugos", () => {
    assert.equal(off.subcategoriaNexoAbarrotes(["en:beverages", "en:fruit-based-beverages"], "Bebida de mango", ""), "Jugos y nectares");
});

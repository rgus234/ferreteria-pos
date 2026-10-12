// Identidad de productos de abarrotes para el Catalogo Maestro, tomada de
// Open Food Facts (base abierta, licencia ODbL: openfoodfacts.org).
//
// MISMAS REGLAS que el Maestro de ferreteria (ver
// catalogo-maestro-reconciliacion.js): aqui solo entra IDENTIDAD de producto
// -- EAN, nombre, marca, presentacion y categoria. NUNCA precios (Open Food
// Facts no los trae) ni fotos (las de OFF son CC-BY-SA y requieren
// atribucion; se decide aparte). Un EAN valido es un unico producto, y ante
// conflicto no se fusiona.
//
// Este modulo es puro (sin base de datos ni red): convierte un registro de
// Open Food Facts en una fila para `reconciliar()` o explica por que se
// descarta. Asi se puede probar sin tocar nada.

const { eanValido } = require("./catalogo-maestro-reconciliacion");

const FUENTE_OFF = "Open Food Facts";

// ---------------------------------------------------------------------
// Limpieza de texto
// ---------------------------------------------------------------------

const PALABRAS_MENORES = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "en", "con", "sin", "para", "por", "al", "a"]);

function colapsar(texto) {
    return String(texto ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// OFF trae nombres en MAYUSCULAS, en minusculas o mezclados. Solo se
// reescribe cuando todo esta en un solo caso: un nombre ya mezclado
// ("Coca-Cola Sin Azúcar") se respeta tal cual.
function titulo(texto) {
    const limpio = colapsar(texto);
    const letras = limpio.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
    if (!letras) return limpio;

    const todoMayus = letras === letras.toUpperCase();
    const todoMinus = letras === letras.toLowerCase();
    if (!todoMayus && !todoMinus) return limpio;

    return limpio
        .toLowerCase()
        .split(" ")
        .map((palabra, i) => {
            if (i > 0 && PALABRAS_MENORES.has(palabra)) return palabra;
            // "coca-cola" -> "Coca-Cola"; "7up" se queda "7up".
            return palabra.replace(/(^|[-/'(])([a-záéíóúüñ])/g, (m, pre, letra) => pre + letra.toUpperCase());
        })
        .join(" ");
}

function primeraMarca(brands) {
    // OFF separa varias marcas con coma ("Bimbo, Marinela"); la primera es la
    // que el producto lleva al frente.
    const primera = colapsar(String(brands ?? "").split(",")[0]);
    return primera.length > 60 ? "" : primera;
}

// ---------------------------------------------------------------------
// Normalizacion de un registro
// ---------------------------------------------------------------------

/**
 * @param {object} crudo registro de Open Food Facts
 *   ({code, product_name, product_name_es, generic_name, brands, quantity,
 *     categories_tags, last_modified_t})
 * @returns {{ok:true, fila:object, categoriasTags:string[]}|{ok:false, motivo:string}}
 */
function normalizarRegistroOff(crudo) {
    const ean = String(crudo?.code ?? "").trim();

    if (!/^[0-9]+$/.test(ean)) return { ok: false, motivo: "sin_ean" };
    // GTIN-14 (cajas) no es lo que se escanea en el mostrador.
    if (ean.length === 14) return { ok: false, motivo: "gtin14" };
    if (!eanValido(ean)) return { ok: false, motivo: "ean_invalido" };
    // 20-29: codigos que cada tienda genera para pesables y productos propios.
    // No identifican el mismo producto de una tienda a otra.
    if (ean.length === 13 && ean[0] === "2") return { ok: false, motivo: "codigo_interno_tienda" };

    const nombreCrudo = colapsar(crudo.product_name_es) || colapsar(crudo.product_name) || colapsar(crudo.generic_name_es) || colapsar(crudo.generic_name);
    if (nombreCrudo.length < 3) return { ok: false, motivo: "sin_nombre" };
    if (nombreCrudo.length > 140) return { ok: false, motivo: "nombre_demasiado_largo" };
    // Un "nombre" que es un numero o casi no tiene letras es basura.
    if ((nombreCrudo.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length < 3) return { ok: false, motivo: "nombre_sin_letras" };
    if (/^(test|prueba|producto|unknown|sin nombre)\b/i.test(nombreCrudo)) return { ok: false, motivo: "nombre_placeholder" };

    const marca = titulo(primeraMarca(crudo.brands));
    const presentacion = colapsar(crudo.quantity).slice(0, 40);
    const categoriasTags = String(crudo.categories_tags ?? "")
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

    // Un registro que solo trae un nombre suelto (sin marca, sin categoria y sin
    // presentacion) es casi siempre un alta a medias o basura capturada a mano
    // ("Luis Alejandro Sanchez Rodriguez"). Solo se acepta si el EAN es mexicano
    // (prefijo GS1 750): ahi hay buena probabilidad de que sea un producto local real.
    if (!marca && categoriasTags.length === 0 && !presentacion && !ean.startsWith("750")) {
        return { ok: false, motivo: "sin_datos_utiles" };
    }

    const fecha = Number(crudo.last_modified_t);

    return {
        ok: true,
        categoriasTags,
        fila: {
            ean,
            codigoFabricante: "",
            nombre: titulo(nombreCrudo),
            marca,
            fabricante: marca,
            clave: "",
            unidad: "",
            presentacion,
            fuente: FUENTE_OFF,
            fuenteFecha: Number.isFinite(fecha) && fecha > 0 ? new Date(fecha * 1000) : null,
            origen: "open_food_facts"
        }
    };
}

// ---------------------------------------------------------------------
// Categoria Nexo (abarrotes)
//
// Reglas deterministas, de lo mas especifico a lo mas general: la primera que
// coincide gana. Se apoyan primero en las categorias de OFF y, si no alcanzan,
// en el nombre. Lo que no coincide se queda SIN categoria (null) -- mejor
// vacio que mal clasificado; un paso posterior con IA puede completarlo.
//
// Los valores son NOMBRES de subcategoria de categorias_nexo (giro
// 'abarrotes'): el id se resuelve contra la base al importar, para no
// amarrar este archivo a ids que pueden cambiar entre ambientes.
// ---------------------------------------------------------------------

const REGLAS_CATEGORIA = [
    // --- Bebidas ---
    { subcategoria: "Bebidas energeticas", tags: [/energy-drink/, /bebidas-energeticas/], nombre: [/\b(energizante|energetica|energy)\b/i] },
    { subcategoria: "Bebidas alcoholicas", tags: [/alcoholic-beverages/, /\b(beers?|wines?|spirits|tequilas?|vodkas?|whisk(e)?ys?|rums?|liquors?)\b/, /cervezas?/, /vinos?/, /bebidas-alcoholicas/], nombre: [/\b(cerveza|tequila|vodka|whisky|ron|brandy|mezcal|vino)\b/i] },
    { subcategoria: "Refrescos", tags: [/carbonated-drinks/, /\bsodas?\b/, /\bcolas?\b/, /soft-drinks/, /refrescos/, /sweetened-beverages.*carbonated/], nombre: [/\b(refresco|cola|soda|sidral|fanta|sprite|7up|pepsi|coca)\b/i] },
    { subcategoria: "Jugos y nectares", tags: [/fruit-juices/, /fruit-nectars/, /fruit-based-beverages/, /\bjuices?\b/, /nectars?/, /jugos?/], nombre: [/\b(jugo|nectar|néctar)\b/i] },
    { subcategoria: "Aguas", tags: [/\bwaters?\b/, /mineral-waters?/, /spring-waters?/, /flavoured-waters?/, /aguas?\b/], nombre: [/^agua\b/i] },
    { subcategoria: "Cafe y te", tags: [/\bcoffees?\b/, /\bteas?\b/, /instant-coffee/, /cafe/, /infusions/], nombre: [/\b(cafe|café|te |té|infusion|infusión)\b/i] },

    // --- Lacteos ---
    { subcategoria: "Yogurt", tags: [/yogh?urts?/, /fermented-milk/, /yogures?/], nombre: [/\b(yogur|yogurt|yoghurt)\b/i] },
    { subcategoria: "Quesos", tags: [/\bcheeses?\b/, /quesos?/], nombre: [/\b(queso)\b/i] },
    { subcategoria: "Mantequilla y margarina", tags: [/\bbutters?\b/, /margarines?/, /mantequillas?/], nombre: [/\b(mantequilla|margarina)\b/i] },
    { subcategoria: "Crema", tags: [/\bcreams?\b/, /cremas?\b/], nombre: [/\b(crema)\b/i] },
    { subcategoria: "Leche", tags: [/\bmilks?\b/, /\bleches?\b/, /dairy-drinks/, /plant-based-milk/], nombre: [/\b(leche)\b/i] },

    // --- Congelados y refrigerados ---
    { subcategoria: "Helados", tags: [/ice-creams?/, /helados?/, /frozen-desserts/], nombre: [/\b(helado|paleta)\b/i] },
    { subcategoria: "Embutidos", tags: [/sausages?/, /\bhams?\b/, /cold-cuts/, /embutidos/, /salchichas?/, /jamon/], nombre: [/\b(salchicha|jamon|jamón|chorizo|salami|mortadela|tocino)\b/i] },
    { subcategoria: "Comida congelada", tags: [/frozen-/, /congelados?/], nombre: [/\b(congelad[oa])\b/i] },

    // --- Panaderia ---
    { subcategoria: "Tortillas", tags: [/tortillas?/, /wraps/], nombre: [/\b(tortilla)\b/i] },
    { subcategoria: "Pan de caja", tags: [/sliced-breads?/, /sandwich-breads?/, /pan-de-caja/, /pan-blanco/, /\bbreads?\b/], nombre: [/\b(pan blanco|pan integral|pan de caja|pan molido|bimbo)\b/i] },
    { subcategoria: "Pan dulce", tags: [/pastries/, /pan-dulce/, /sweet-breads/, /(^|,)[a-z]{2}:cakes?(,|$)/, /pastelitos/, /brioche/, /muffins?/, /donuts?/], nombre: [/\b(pan dulce|concha|pastelito|panque|pan[qk]ue|donas?|mantecada|gansito|submarino|medias noches)\b/i] },

    // --- Botanas y dulces ---
    { subcategoria: "Chicles", tags: [/chewing-gums?/, /\bgums?\b/, /chicles?/], nombre: [/\b(chicle)\b/i] },
    { subcategoria: "Dulces y chocolates", tags: [/chocolates?/, /candies/, /confectioneri/, /gummies/, /lollipops/, /dulces/, /cocoa-and-its-products/], nombre: [/\b(chocolate|dulce|caramelo|paleta|gomita|mazapan|mazapán|cajeta)\b/i] },
    { subcategoria: "Galletas", tags: [/biscuits?/, /cookies/, /crackers/, /galletas?/, /wafers?/], nombre: [/\b(galleta|galletas|cracker|crackers)\b/i] },
    { subcategoria: "Papas y frituras", tags: [/\bchips\b/, /crisps/, /salty-snacks/, /appetizers/, /\bsnacks\b/, /botanas/, /frituras/, /popcorn/, /puffed/, /extruded/, /tortilla-chips/, /nuts/, /peanuts/], nombre: [/\b(papas|frituras|botana|chicharron|chicharrón|cacahuate|palomitas|churrito|doritos|cheetos|ruffles|takis|sabritas)\b/i] },

    // --- Abarrotes secos ---
    { subcategoria: "Pastas y sopas", tags: [/\bpastas?\b/, /noodles/, /\bsoups?\b/, /sopas?/, /instant-noodles/, /vermicelli/], nombre: [/\b(pasta|spaghetti|espagueti|fideo|sopa|maruchan|coditos|codito)\b/i] },
    { subcategoria: "Granos y semillas", tags: [/\brices?\b/, /beans/, /legumes/, /lentils/, /\bgrains\b/, /cereals?/, /frijol/, /arroz/, /seeds/, /oats/, /avenas?/, /cereales/], nombre: [/\b(arroz|frijol|lenteja|garbanzo|avena|cereal|haba|semilla)\b/i] },
    { subcategoria: "Aceites y vinagres", tags: [/\boils?\b/, /vinegars?/, /aceites?/, /vinagres?/], nombre: [/\b(aceite|vinagre)\b/i] },
    { subcategoria: "Harinas y azucar", tags: [/\bflours?\b/, /\bsugars?\b/, /sweeteners?/, /harinas?/, /azucar/, /baking/, /honeys?/], nombre: [/\b(harina|azucar|azúcar|miel|splenda|edulcorante|hot cakes|hotcakes)\b/i] },
    { subcategoria: "Enlatados", tags: [/canned/, /enlatados/, /preserved-/, /tuna/, /sardines/, /jarred/, /conserves/], nombre: [/\b(atun|atún|sardina|lata|enlatado|chicharos|chícharos|elote en)\b/i] },
    { subcategoria: "Condimentos y especias", tags: [/spices/, /condiments/, /\bsauces?\b/, /salsas?/, /seasonings/, /ketchup/, /mayonnaise/, /mustard/, /mole/, /bouillon/, /\bsalts?\b/, /pepper/, /dressings/, /marinades/], nombre: [/\b(salsa|catsup|ketchup|mayonesa|mostaza|mole|consome|consomé|sal |pimienta|chile en|adobo|aderezo|especias?|condimento|caldo)\b/i] },

    // --- Frutas y verduras (frescas/en bolsa; lo procesado ya cayo arriba) ---
    // Solo "fresh-*": la etiqueta generica "fruits" tambien cubre mermeladas y
    // otros procesados que no son fruta fresca.
    { subcategoria: "Frutas", tags: [/fresh-fruits/], nombre: [] },
    { subcategoria: "Verduras", tags: [/fresh-vegetables/], nombre: [] }
];

function cumple(patrones, texto) {
    return patrones.some(re => re.test(texto));
}

/**
 * @returns {string|null} nombre de subcategoria Nexo (abarrotes), o null
 */
function subcategoriaNexoAbarrotes(categoriasTags, nombre, marca) {
    const tags = (categoriasTags || []).join(",");
    const texto = `${nombre || ""} ${marca || ""}`;

    for (const regla of REGLAS_CATEGORIA) {
        if (regla.tags.length && cumple(regla.tags, tags)) return regla.subcategoria;
    }
    // Las categorias de OFF mandan; el nombre solo desempata cuando OFF no dijo nada util.
    for (const regla of REGLAS_CATEGORIA) {
        if (regla.nombre.length && cumple(regla.nombre, texto)) return regla.subcategoria;
    }
    return null;
}

// ---------------------------------------------------------------------
// Como se le muestra el producto a quien lo escanea
// ---------------------------------------------------------------------

// "600ml" -> "600 ml", "1,5 L" -> "1.5 L". Lo que no se reconoce como
// cantidad con unidad se deja tal cual.
function normalizarPresentacion(presentacion) {
    const limpia = colapsar(presentacion);
    const m = limpia.match(/^(\d+(?:[.,]\d+)?)\s*(ml|l|lt|lts|litros?|g|gr|grs|kg|mg|oz|pz|pzas?|piezas?)$/i);
    if (!m) return limpia;

    const cantidad = m[1].replace(",", ".");
    const unidad = { lt: "L", lts: "L", l: "L", litro: "L", litros: "L", gr: "g", grs: "g", pza: "pz", pzas: "pz", pieza: "pz", piezas: "pz" }[m[2].toLowerCase()] || m[2].toLowerCase();
    return `${cantidad} ${unidad}`;
}

// En Open Food Facts es comun un nombre sin tamano ("Coca cola"), y una
// tienda tiene la de 355 ml, la de 600 ml y la de 3 L. Al escanear se le
// propone "Coca cola 600 ml", salvo que el nombre ya diga el tamano.
function nombreParaMostrar(nombre, presentacion) {
    const base = colapsar(nombre);
    const tamano = normalizarPresentacion(presentacion);
    if (!base || !tamano) return base;

    // Sin espacios ni mayusculas: "600ml" dentro del nombre cuenta como
    // "600 ml". Se compara solo la cantidad con su unidad.
    const compacto = texto => String(texto).toLowerCase().replace(/[\s.,]/g, "");
    if (compacto(base).includes(compacto(tamano))) return base;

    return `${base} ${tamano}`;
}

// "Nestle", "Nestlé" y "NESTLÉ" son la misma marca: sin unificarlas, el
// catalogo mostraria tres. Se elige la forma mas frecuente entre las filas
// (a igualdad, la que tiene acentos o mayusculas correctas).
function llaveMarca(marca) {
    return String(marca || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function unificarMarcas(filas) {
    const formas = new Map();
    for (const f of filas) {
        const llave = llaveMarca(f.marca);
        if (!llave) continue;
        const porForma = formas.get(llave) || new Map();
        porForma.set(f.marca, (porForma.get(f.marca) || 0) + 1);
        formas.set(llave, porForma);
    }

    const elegida = new Map();
    for (const [llave, porForma] of formas) {
        // Mas frecuente; a igualdad, la que lleva acentos; luego la que tiene
        // mayuscula inicial en cada palabra ("Great Value" antes que "Great value").
        const conAcentos = texto => (texto.match(/[^\u0000-\u007f]/g) || []).length;
        const palabrasConMayuscula = texto => (texto.match(/(^|\s)[A-ZÁÉÍÓÚÑ]/g) || []).length;
        const mejor = [...porForma.entries()].sort((a, b) =>
            b[1] - a[1] ||
            conAcentos(b[0]) - conAcentos(a[0]) ||
            palabrasConMayuscula(b[0]) - palabrasConMayuscula(a[0]) ||
            a[0].localeCompare(b[0])
        )[0][0];
        elegida.set(llave, mejor);
    }

    let unificadas = 0;
    for (const f of filas) {
        const llave = llaveMarca(f.marca);
        const canonica = elegida.get(llave);
        if (canonica && canonica !== f.marca) { f.marca = canonica; f.fabricante = canonica; unificadas++; }
    }
    return unificadas;
}

module.exports = {
    FUENTE_OFF,
    llaveMarca,
    unificarMarcas,
    normalizarPresentacion,
    nombreParaMostrar,
    REGLAS_CATEGORIA,
    colapsar,
    titulo,
    primeraMarca,
    normalizarRegistroOff,
    subcategoriaNexoAbarrotes
};

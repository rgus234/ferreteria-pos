// Pruebas del sincronizador de catalogos de fabricante. Todo lo que se
// prueba aqui es puro (sin red y sin base de datos): el parseo de la
// tabla, la validacion cruzada y las reglas de aplicacion de cambios.
//
// El caso central usa el TEXTO OCR REAL obtenido del modulo 29901 de
// TRUPER (pinzas Comfort Grip), con su tabla verificada a mano:
//   103013 PMU-8PX  $335 / $365 / $400
//   103012 PMU-8EX  $355 / $390 / $430

const { test } = require("node:test");
const assert = require("node:assert/strict");

const ocr = require("../catalogo-fabricante-ocr");
const truper = require("../fabricantes/truper");
const sync = require("../catalogo-fabricante-sync");

// Texto tal como lo devolvio tesseract sobre el modulo real, con sus
// imperfecciones incluidas (el "e" pegado a PMU-8EX viene del punto verde
// de la maqueta, el "*" del codigo es una nota al pie del catalogo).
const OCR_29901_PUB = `EXCEUEN (d NOM. ASME DIV I.DUU
Código — Clave Largo total — largo mordazas Mayoreo 1/2 Mayoreo Público NC E
Punta y corte "
103013  PMU-8PX 8” (20cm) 59mm $335 $365 $400 3
Electricista Et
103012* PMU-8EXe 9” (23cm) 53mm $355 $390 $430 3 y |
CAJA 3/ MÁSTER 36 / EXTINTO`;

const OCR_29901_DIS = `Código — Clave Largo total — largo mordazas Distribuidor NC
Punta y corte
103013  PMU-8PX 8” (20cm) 59mm $255 3
Electricista
103012* PMU-8EXe 9” (23cm) 53mm $275 3`;

// ---------------------------------------------------------------------
// Normalizacion
// ---------------------------------------------------------------------

test("normalizarCodigo quita el asterisco de nota al pie", () => {
    assert.equal(ocr.normalizarCodigo("103012*"), "103012");
    assert.equal(ocr.normalizarCodigo("  103013 "), "103013");
});

test("precioDeTexto acepta los formatos del catalogo y rechaza medidas", () => {
    assert.equal(ocr.precioDeTexto("$335"), 335);
    assert.equal(ocr.precioDeTexto("$1,234.50"), 1234.5);
    assert.equal(ocr.precioDeTexto("430"), 430);
    assert.equal(ocr.precioDeTexto("59mm"), null);
    assert.equal(ocr.precioDeTexto(""), null);
    assert.equal(ocr.precioDeTexto("$0"), null);
});

// ---------------------------------------------------------------------
// Deteccion de columnas -- el orden se lee del encabezado, no se asume
// ---------------------------------------------------------------------

test("detectarColumnasPrecio lee el orden real del encabezado", () => {
    const columnas = ocr.detectarColumnasPrecio(
        "Código — Clave Largo total Mayoreo 1/2 Mayoreo Público NC"
    );
    assert.deepEqual(columnas, ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"]);
});

test("detectarColumnasPrecio no confunde '1/2 Mayoreo' con 'Mayoreo'", () => {
    // Sin el filtro de solapamiento, "1/2 Mayoreo" generaria tambien una
    // columna "precio_mayoreo" fantasma y todo el mapeo saldria corrido.
    const columnas = ocr.detectarColumnasPrecio("Código Clave 1/2 Mayoreo Público");
    assert.deepEqual(columnas, ["precio_medio_mayoreo", "precio_publico"]);
});

test("detectarColumnasPrecio respeta un orden invertido", () => {
    const columnas = ocr.detectarColumnasPrecio("Código Clave Público Mayoreo");
    assert.deepEqual(columnas, ["precio_publico", "precio_mayoreo"]);
});

test("detectarColumnasPrecio reconoce la variante de distribuidor", () => {
    assert.deepEqual(
        ocr.detectarColumnasPrecio("Código Clave Distribuidor NC"),
        ["precio_distribuidor"]
    );
});

// ---------------------------------------------------------------------
// Parseo de la tabla real
// ---------------------------------------------------------------------

test("parsearTablaPrecios lee la tabla real del modulo 29901 (3 precios)", () => {
    const { columnas, filas } = ocr.parsearTablaPrecios(OCR_29901_PUB);

    assert.deepEqual(columnas, ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"]);
    assert.equal(filas.length, 2);

    const primera = filas[0];
    assert.equal(primera.codigo, "103013");
    assert.equal(primera.clave, "PMU-8PX");
    assert.equal(primera.completa, true);
    assert.deepEqual(primera.precios, {
        precio_mayoreo: 335,
        precio_medio_mayoreo: 365,
        precio_publico: 400
    });

    const segunda = filas[1];
    assert.equal(segunda.codigo, "103012", "el asterisco no forma parte del codigo");
    assert.deepEqual(segunda.precios, {
        precio_mayoreo: 355,
        precio_medio_mayoreo: 390,
        precio_publico: 430
    });
});

test("parsearTablaPrecios lee la variante de distribuidor", () => {
    const { columnas, filas } = ocr.parsearTablaPrecios(OCR_29901_DIS);

    assert.deepEqual(columnas, ["precio_distribuidor"]);
    assert.equal(filas.length, 2);
    assert.deepEqual(filas[0].precios, { precio_distribuidor: 255 });
    assert.deepEqual(filas[1].precios, { precio_distribuidor: 275 });
});

test("las medidas de la fila no se confunden con precios", () => {
    // "8 (20cm)" y "59mm" estan en la misma linea que los importes; si se
    // colaran, la fila tendria 5 precios y el mapeo saldria corrido.
    const { filas } = ocr.parsearTablaPrecios(OCR_29901_PUB);
    assert.equal(Object.keys(filas[0].precios).length, 3);
});

test("una fila con menos precios de los esperados se marca incompleta, no se adivina", () => {
    const texto = `Código Clave Mayoreo 1/2 Mayoreo Público
103013 PMU-8PX $335 $400`;
    const { filas } = ocr.parsearTablaPrecios(texto);

    assert.equal(filas[0].completa, false);
    assert.match(filas[0].motivo, /se esperaban 3 precios y se leyeron 2/);
    assert.deepEqual(filas[0].precios, {}, "no se guarda ningun precio de una fila ambigua");
});

// --- Casos reales que fallaron contra el catalogo en vivo ---

test("encabezado abreviado: 'May. /2May. Pub.' mapea las tres columnas", () => {
    // Texto OCR real del modulo 58101. El "½" sale como "/2" pegado a la
    // palabra siguiente; sin contemplarlo se detectaban 2 columnas de 3 y
    // el medio mayoreo se perdia.
    const texto = `Código | Clave Acabado largo May. /2May. Púb. NC
43034 GUP0-120A Aluminio 120cm $57 $62 $68 2`;
    const { columnas, filas } = ocr.parsearTablaPrecios(texto);

    assert.deepEqual(columnas, ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"]);
    assert.deepEqual(filas[0].precios, {
        precio_mayoreo: 57, precio_medio_mayoreo: 62, precio_publico: 68
    });
});

test("el asterisco de nota al pie leido como 'x' no borra la fila", () => {
    // Modulo 29901 real: el OCR devuelve "103012x" por "103012*". Con la
    // regex estricta esa fila no matcheaba y el producto desaparecia.
    const texto = `Código Clave Mayoreo 1/2 Mayoreo Público
103012x PMU-8EXe 9” (23cm) $355 $390 $430 3`;
    const { filas } = ocr.parsearTablaPrecios(texto);

    assert.equal(filas.length, 1);
    assert.equal(filas[0].codigo, "103012");
    assert.equal(filas[0].precios.precio_publico, 430);
});

test("una fila con icono delante se ancla por el codigo esperado", () => {
    // Modulo 43904 real: la maqueta antepone un icono de "destacado" a
    // algunas filas, asi que la linea no empieza por el numero.
    const texto = `Código Clave May. 1/2 May. Púb. NC
@ 49991* SL-14L 24 W $1,115 $1,230 $1,350 2`;
    const { filas } = ocr.parsearTablaPrecios(texto, { codigosEsperados: ["49991"] });

    assert.equal(filas.length, 1);
    assert.equal(filas[0].codigo, "49991");
    assert.equal(filas[0].precios.precio_mayoreo, 1115);
    assert.equal(filas[0].precios.precio_publico, 1350);
});

test("un '$' sin numero no se cuenta como precio usando el NC de al lado", () => {
    // Modulo 58101 real: cuando el OCR pierde el importe deja "$ " suelto
    // y el "2" de la columna NC quedaba guardado como precio publico.
    const texto = `Código Clave Acabado May. 1/2 May. Púb. NC
43030 GUPO-100A Aluminio $47 $52 $ 2`;
    const { filas } = ocr.parsearTablaPrecios(texto);

    assert.equal(filas[0].completa, false, "faltando un precio, la fila no se da por buena");
    assert.deepEqual(filas[0].precios, {});
});

test("tres precios iguales son validos (existen en el catalogo real)", () => {
    // Producto 50215 R-LLCR: $350 / $350 / $350, verificado en la imagen.
    const texto = `Código Clave May. ½ May. Púb. NC
50215 R-LLCR $350 $350 $350 0`;
    const { filas } = ocr.parsearTablaPrecios(texto);

    assert.equal(filas[0].completa, true);
    assert.deepEqual(filas[0].precios, {
        precio_mayoreo: 350, precio_medio_mayoreo: 350, precio_publico: 350
    });
});

// --- Tablas transpuestas (un producto por COLUMNA) ---

// Layout real del modulo 2201: la primera columna trae las etiquetas y
// cada producto ocupa una columna. Con el parseo por filas estos modulos
// devolvian cero productos.
const OCR_2201_TRANSPUESTA = [
    "Código: 18024 15481 15480 102634",
    "Clave: LLCR-20D LLCR-20 LLCR-18 LLCR-16",
    'Medida: 20" (50 cm) 20" (50 cm) 18" (45 cm) 16" (40 cm)',
    "Mayoreo: $255 NC 2 $255 NC 2 $235 NC 2 $225 NC 2",
    "1/2 Mayoreo: $280 $280 $255 $245",
    "Público: $310 $310 $280 $270"
].join("\n");

test("una tabla transpuesta se detecta y se lee por columnas", () => {
    const esperados = ["18024", "15481", "15480", "102634"];
    const { columnas, filas } = ocr.parsearTablaPrecios(OCR_2201_TRANSPUESTA, {
        codigosEsperados: esperados
    });

    assert.deepEqual(columnas, ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"]);
    assert.equal(filas.length, 4);
    assert.deepEqual(filas[0].precios, {
        precio_mayoreo: 255, precio_medio_mayoreo: 280, precio_publico: 310
    });
    assert.deepEqual(filas[3].precios, {
        precio_mayoreo: 225, precio_medio_mayoreo: 245, precio_publico: 270
    });
    assert.ok(filas.every(f => f.completa));
    assert.equal(ocr.validarContraFuenteTexto(filas, esperados).ok, true);
});

test("el 'NC 2' de la fila de mayoreo no se cuela como precio", () => {
    const { filas } = ocr.parsearTablaPrecios(OCR_2201_TRANSPUESTA, {
        codigosEsperados: ["18024", "15481", "15480", "102634"]
    });
    // Si el NC contara, habria 8 importes para 4 productos y el
    // emparejamiento por posicion saldria corrido.
    assert.equal(filas[1].precios.precio_mayoreo, 255);
});

test("si una fila de precios no trae un importe por producto, no se adivina", () => {
    const texto = [
        "Código: 18024 15481 15480",
        "Mayoreo: $255 $235",
        "Público: $310 $310 $280"
    ].join("\n");
    const { filas } = ocr.parsearTablaPrecios(texto, {
        codigosEsperados: ["18024", "15481", "15480"]
    });

    assert.ok(filas.every(f => !f.completa), "2 importes para 3 productos es ambiguo");
    assert.ok(filas.every(f => f.precios.precio_mayoreo === undefined));
});

test("el layout normal no se confunde con el transpuesto", () => {
    // Con un solo codigo por linea, pareceTablaTranspuesta debe decir que no.
    assert.equal(
        ocr.pareceTablaTranspuesta(OCR_29901_PUB.split("\n"), ["103013", "103012"]),
        false
    );
    const { filas } = ocr.parsearTablaPrecios(OCR_29901_PUB, {
        codigosEsperados: ["103013", "103012"]
    });
    assert.equal(filas.length, 2);
    assert.equal(filas[0].precios.precio_publico, 400);
});

// --- Precio comun por bloque (layout que NO debe leerse solo) ---

// Modulo 29801 real: 30 productos bajo "Colores estandar" y un unico
// renglon de precio al pie del bloque, ademas con excepciones marcadas
// ("Excepto: 19061"). Repartir ese precio entre los productos daria un
// catalogo lleno de precios plausibles y equivocados.
const OCR_29801_POR_BLOQUE = [
    "Código Clave Color Caja Máster",
    "19031* PA-NB Negro brillante 12 48",
    "19054* PA-NS Negro satín 8 48",
    "19033* PA-NM Negro mate 12 48",
    "19044 PA-GO Gris oscuro 4 48",
    "Mayoreo ½ Mayoreo Público MM NC",
    "$60 $66 $73 0 2"
].join("\n");

test("un modulo con precio comun por bloque no reparte ese precio", () => {
    const esperados = ["19031", "19054", "19033", "19044"];
    const { filas } = ocr.parsearTablaPrecios(OCR_29801_POR_BLOQUE, { codigosEsperados: esperados });

    assert.ok(filas.length > 0, "las filas de producto si se reconocen");
    assert.ok(
        filas.every(f => Object.keys(f.precios).length === 0),
        "pero ninguna se queda con el precio del bloque"
    );
    assert.ok(filas.every(f => !f.completa));
});

test("parecePrecioPorBloque distingue los tres layouts", () => {
    assert.equal(
        ocr.parecePrecioPorBloque(OCR_29801_POR_BLOQUE, ["19031", "19054", "19033", "19044"]),
        true
    );
    // Layout normal: cada fila trae sus importes.
    assert.equal(
        ocr.parecePrecioPorBloque(OCR_29901_PUB, ["103013", "103012"]),
        false
    );
    // Transpuesta: la linea de codigos no trae importes pero SI hay un
    // precio por producto, asi que no debe confundirse con precio por bloque.
    assert.equal(
        ocr.parecePrecioPorBloque(OCR_2201_TRANSPUESTA, ["18024", "15481", "15480", "102634"]),
        false
    );
});

// --- Columna de precio vacia en el catalogo ---

// Modulo 51101 real (tubos de cobre FOSET): el encabezado trae la columna
// "Distribuidor" pero viene EN BLANCO -- TRUPER no publica ese precio para
// esos productos. No es un fallo de lectura y el producto es valido.
const OCR_51101_COLUMNA_VACIA = [
    "Código Clave Ø Nominal Espesor Peso Atado Distribuidor NC",
    '41274* CC-001M ½" (13 mm) 0.63 mm 0.8 kg 15 1',
    '41275* CC-002M ¾" (19 mm) 0.73 mm 1.3 kg 10 1',
    '41276* CC-003M 1" (25 mm) 0.78 mm 1.8 kg 5 1'
].join("\n");

test("una columna de precio vacia no es un fallo: el producto vale, sin ese precio", async () => {
    const imagen = await moduloFalso();
    let llamadas = 0;
    const vision = { messages: { create: async () => { llamadas++; return { content: [] }; } } };

    const r = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["41274", "41275", "41276"],
        columnasForzadas: ["precio_distribuidor"],
        ocr: { recognize: async () => ({ texto: OCR_51101_COLUMNA_VACIA, confianza: 70 }) },
        anthropic: vision
    });

    assert.equal(r.confiable, true, "el modulo se acepta");
    assert.equal(r.origen, "sin_precios_publicados");
    assert.equal(llamadas, 0, "no hay nada que rescatar: no se gasta vision");
    assert.equal(r.filas.length, 3);
    assert.deepEqual(r.filas[0].precios, {}, "y no se inventa ningun precio");
});

test("un modulo de un solo producto sin importe NO se da por columna vacia", async () => {
    // Con una sola fila no hay forma de distinguir "el fabricante no lo
    // publica" de "al OCR se le escapo el unico precio": va a revision.
    const imagen = await moduloFalso();
    const r = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["41274"],
        columnasForzadas: ["precio_distribuidor"],
        ocr: { recognize: async () => ({ texto: "Código Clave Distribuidor NC\n41274* CC-001M 15 1", confianza: 70 }) }
    });

    assert.equal(r.confiable, false);
});

test("no se gasta vision en un modulo de precio por bloque", async () => {
    const imagen = await moduloFalso();
    let llamadas = 0;
    const vision = { messages: { create: async () => { llamadas++; return { content: [] }; } } };

    const r = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["19031", "19054", "19033", "19044"],
        columnasForzadas: ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"],
        ocr: { recognize: async () => ({ texto: OCR_29801_POR_BLOQUE, confianza: 70 }) },
        anthropic: vision
    });

    assert.equal(r.confiable, false, "va a revision manual");
    assert.equal(llamadas, 0, "y sin gastar una llamada de vision que ademas podria inventar el reparto");
    assert.ok(r.avisos.some(a => /precio comun por bloque/.test(a)));
});

test("sin encabezado legible se usan las columnas declaradas por el adaptador", () => {
    const texto = "103013 PMU-8PX $255 3";
    const { filas, avisos } = ocr.parsearTablaPrecios(texto, {
        columnasForzadas: ["precio_distribuidor"]
    });

    assert.deepEqual(filas[0].precios, { precio_distribuidor: 255 });
    assert.equal(avisos.length, 1);
});

// ---------------------------------------------------------------------
// Validacion cruzada contra la fuente en texto
// ---------------------------------------------------------------------

test("validarContraFuenteTexto acepta cuando el OCR concuerda", () => {
    const { filas } = ocr.parsearTablaPrecios(OCR_29901_PUB);
    const resultado = ocr.validarContraFuenteTexto(filas, ["103013", "103012"]);

    assert.equal(resultado.ok, true);
});

test("validarContraFuenteTexto rechaza si el OCR invento o perdio un codigo", () => {
    const { filas } = ocr.parsearTablaPrecios(OCR_29901_PUB);

    const faltante = ocr.validarContraFuenteTexto(filas, ["103013", "103012", "999999"]);
    assert.equal(faltante.ok, false);
    assert.deepEqual(faltante.faltantes, ["999999"]);

    const sobrante = ocr.validarContraFuenteTexto(filas, ["103013"]);
    assert.equal(sobrante.ok, false);
    assert.deepEqual(sobrante.sobrantes, ["103012"]);
});

test("validarContraFuenteTexto rechaza si la fuente en texto no dio codigos", () => {
    const { filas } = ocr.parsearTablaPrecios(OCR_29901_PUB);
    assert.equal(ocr.validarContraFuenteTexto(filas, []).ok, false);
});

test("revisarCoherenciaPrecios detecta columnas leidas al reves", () => {
    assert.deepEqual(
        ocr.revisarCoherenciaPrecios({ precio_mayoreo: 335, precio_medio_mayoreo: 365, precio_publico: 400 }),
        []
    );

    const problemas = ocr.revisarCoherenciaPrecios({
        precio_mayoreo: 400, precio_medio_mayoreo: 365, precio_publico: 335
    });
    assert.ok(problemas.length > 0, "un mayoreo mas caro que el publico debe reportarse");
});

// ---------------------------------------------------------------------
// Pipeline completo con OCR inyectado (sin red, sin tesseract)
// ---------------------------------------------------------------------

const sharp = require("sharp");

// Modulo sintetico: fondo blanco con una o dos barras negras solidas a la
// misma altura, que es lo que la maqueta real usa como encabezado de tabla.
async function moduloFalso({ ancho = 400, alto = 300, barras = [[20, 380]], filaBarra = 200 } = {}) {
    const franjas = barras.map(([x0, x1]) => ({
        input: {
            create: {
                width: x1 - x0, height: 14, channels: 3,
                background: { r: 0, g: 0, b: 0 }
            }
        },
        left: x0,
        top: filaBarra
    }));

    return sharp({
        create: { width: ancho, height: alto, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).composite(franjas).jpeg().toBuffer();
}

test("detectarBandasTabla toma la zona inferior completa cuando hay una sola tabla", async () => {
    // Se dejo de buscar la barra del encabezado a proposito: el catalogo
    // usa dos estilos de encabezado y las fotos oscuras daban falsos
    // positivos. Ahora se recorta la zona inferior, que es donde la tabla
    // esta siempre, y el parseo filtra el ruido.
    const imagen = await moduloFalso({ alto: 400, filaBarra: 250 });
    const bandas = await ocr.detectarBandasTabla(imagen);

    assert.equal(bandas.length, 1);
    assert.equal(bandas[0].top, 100, "arranca al 25% del alto");
    assert.equal(bandas[0].top + bandas[0].height, 400, "y llega al pie");
    assert.equal(bandas[0].left, 0, "sin una segunda tabla no se recorta de lado");
});

test("detectarBandasTabla separa las dos tablas de un modulo de doble ancho", async () => {
    // Dos barras a la misma altura con un pasillo blanco en medio, como el
    // modulo 21302 real (1666x464, tablas en 32..808 y 856..1632).
    const imagen = await moduloFalso({
        ancho: 1600, alto: 400, filaBarra: 120,
        barras: [[30, 780], [830, 1580]]
    });

    const bandas = await ocr.detectarBandasTabla(imagen);
    assert.equal(bandas.length, 2, "cada tabla debe leerse por separado");
    assert.ok(bandas[0].left < bandas[1].left);
    // Sin separarlas, el OCR juntaria la fila izquierda con la derecha.
    assert.ok(bandas[0].left + bandas[0].width < bandas[1].left + 10);
});

test("una imagen sin tabla no revienta: devuelve la franja y el parseo decide", async () => {
    const blanca = await sharp({
        create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).jpeg().toBuffer();

    const bandas = await ocr.detectarBandasTabla(blanca);
    assert.equal(bandas.length, 1);
    // No se escribe nada igualmente: sin codigos leidos, la validacion
    // contra la fuente en texto falla y el modulo va a revision manual.
    const r = await ocr.extraerTablaDeModulo(blanca, {
        codigosEsperados: ["103013"],
        ocr: { recognize: async () => ({ texto: "", confianza: 0 }) }
    });
    assert.equal(r.confiable, false);
});

test("la vision solo entra si el OCR fallo, y su lectura tambien se valida", async () => {
    const imagen = await moduloFalso();
    // OCR que pierde una fila -> no valida -> debe intentarse la vision.
    const ocrMalo = { recognize: async () => ({ texto: "Código Clave Mayoreo 1/2 Mayoreo Público\n103013 PMU-8PX $335 $365 $400 3", confianza: 40 }) };

    let llamadas = 0;
    const visionBuena = {
        messages: {
            create: async () => {
                llamadas++;
                return { content: [{ type: "text", text: JSON.stringify({ filas: [
                    { codigo: "103013", clave: "PMU-8PX", precios: { precio_mayoreo: 335, precio_medio_mayoreo: 365, precio_publico: 400 } },
                    { codigo: "103012", clave: "PMU-8EX", precios: { precio_mayoreo: 355, precio_medio_mayoreo: 390, precio_publico: 430 } }
                ] }) }] };
            }
        }
    };

    const rescatado = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["103013", "103012"],
        columnasForzadas: ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"],
        ocr: ocrMalo,
        anthropic: visionBuena
    });

    assert.equal(rescatado.confiable, true);
    assert.equal(rescatado.origen, "vision");
    assert.equal(llamadas, 1);

    // Si la vision devuelve una fila a la que le falta un precio de la
    // maqueta, NO se acepta: ese era el bug que guardaba productos con dos
    // de sus tres precios sin que nada lo notara.
    const visionIncompleta = {
        messages: {
            create: async () => ({ content: [{ type: "text", text: JSON.stringify({ filas: [
                { codigo: "103013", clave: "PMU-8PX", precios: { precio_mayoreo: 335, precio_publico: 400 } },
                { codigo: "103012", clave: "PMU-8EX", precios: { precio_mayoreo: 355, precio_publico: 430 } }
            ] }) }] })
        }
    };

    const rechazado = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["103013", "103012"],
        columnasForzadas: ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"],
        ocr: ocrMalo,
        anthropic: visionIncompleta
    });

    assert.equal(rechazado.confiable, false, "falta el medio mayoreo: no puede darse por bueno");
});

test("la vision no se llama cuando el OCR ya leyo bien", async () => {
    const imagen = await moduloFalso();
    let llamadas = 0;
    const vision = { messages: { create: async () => { llamadas++; return { content: [] }; } } };

    const r = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["103013", "103012"],
        ocr: { recognize: async () => ({ texto: OCR_29901_PUB, confianza: 68 }) },
        anthropic: vision
    });

    assert.equal(r.confiable, true);
    assert.equal(r.origen, "ocr");
    assert.equal(llamadas, 0, "no se gasta una llamada de vision si el OCR alcanzo");
});

test("extraerTablaDeModulo marca confiable solo si todo concuerda", async () => {
    const imagen = await moduloFalso();
    const ocrFalso = { recognize: async () => ({ texto: OCR_29901_PUB, confianza: 68 }) };

    const bueno = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["103013", "103012"],
        ocr: ocrFalso
    });
    assert.equal(bueno.confiable, true);
    assert.equal(bueno.filas.length, 2);
    assert.ok(bueno.hash, "el hash del recorte se calcula para poder saltar reextracciones");

    // Si la fuente en texto dice que el modulo tiene codigos que el OCR no
    // encontro, el modulo no escribe nada.
    const faltante = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["103013", "103012", "999999"],
        ocr: ocrFalso
    });
    assert.equal(faltante.confiable, false, "falta un producto de la lista: no se escribe nada");
    assert.deepEqual(faltante.validacion.faltantes, ["999999"]);
});

test("una fila fuera de la lista del fabricante se ignora, no invalida el modulo", async () => {
    const imagen = await moduloFalso();
    // El OCR ve dos filas pero la fuente en texto solo reconoce una: la
    // otra es ruido (un numero de otra columna o un digito mal leido).
    const r = await ocr.extraerTablaDeModulo(imagen, {
        codigosEsperados: ["103013"],
        ocr: { recognize: async () => ({ texto: OCR_29901_PUB, confianza: 68 }) }
    });

    assert.equal(r.filas.length, 1, "solo sobrevive el producto que el fabricante lista");
    assert.equal(r.filas[0].codigo, "103013");
    assert.equal(r.confiable, true);
});

// ---------------------------------------------------------------------
// Adaptador TRUPER (parseo de HTML, sin red)
// ---------------------------------------------------------------------

test("extraerModulosDePagina saca los modulos sin repetir", () => {
    const html = `<td data-modulo="1801"></td><td data-modulo="1802"></td><td data-modulo="1801"></td>`;
    assert.deepEqual(truper.extraerModulosDePagina(html), ["1801", "1802"]);
});

test("extraerSiguiente encuentra el encadenado de paginas", () => {
    const html = `<a href="./aceites-y-lubricantes-truper-18.html" class="nextSig">`;
    assert.equal(truper.extraerSiguiente(html), "aceites-y-lubricantes-truper-18.html");
    assert.equal(truper.extraerSiguiente("<a href='#'>fin</a>"), null);
});

test("paginaDeSlug lee el numero de pagina del slug", () => {
    assert.equal(truper.paginaDeSlug("pinzas-mango-comfort-grip-truper-expert-299.html"), 299);
    assert.equal(truper.paginaDeSlug("sin-numero.html"), null);
});

test("marcaDeDescripcion prefiere la marca mas especifica y no inventa", () => {
    assert.equal(truper.marcaDeDescripcion("Mezcladora eléctrica 1400W, TRUPER PRO"), "TRUPER PRO");
    assert.equal(truper.marcaDeDescripcion("Guardapolvo fijo de 120 cm, blanco, HERMEX"), "HERMEX");
    assert.equal(truper.marcaDeDescripcion("Producto sin marca reconocible"), "");
});

test("urlImagen arma la ruta de cada variante y rechaza variantes falsas", () => {
    assert.equal(
        truper.urlImagen("29901", "pub"),
        "https://www.truper.com/GestorCatalogos/img/sections/catalogo-mx/mx-pub/29901.jpg"
    );
    assert.equal(
        truper.urlImagen("29901", "dis"),
        "https://www.truper.com/GestorCatalogos/img/sections/catalogo-mx/mx-dis/29901.jpg"
    );
    assert.throws(() => truper.urlImagen("29901", "mayoreo"), /variante desconocida/);
});

// ---------------------------------------------------------------------
// Nucleo: comparacion y aplicacion
// ---------------------------------------------------------------------

test("mismoPrecio compara el string de Postgres contra el numero del OCR", () => {
    // Sin esta normalizacion cada corrida reportaria cambios falsos.
    assert.equal(sync.mismoPrecio("335.00", 335), true);
    assert.equal(sync.mismoPrecio(null, null), true);
    assert.equal(sync.mismoPrecio("335.00", 340), false);
    assert.equal(sync.mismoPrecio(null, 335), false);
});

test("trocear parte la lista en lotes", () => {
    assert.deepEqual(sync.trocear([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(sync.trocear([], 10), []);
});

// Cliente falso que registra las consultas para poder afirmar sobre ellas.
function clienteFalso() {
    const consultas = [];
    return {
        consultas,
        async query(texto, valores) {
            consultas.push({ texto, valores });
            return { rows: [] };
        }
    };
}

test("aplicarProducto da de alta un producto nuevo", async () => {
    const client = clienteFalso();
    const cambios = await sync.aplicarProducto(client, 1, "TRUPER", "103013", {
        clave: "PMU-8PX", descripcion: "Pinzas", marca: "TRUPER EXPERT",
        precio_mayoreo: 335, precio_medio_mayoreo: 365, precio_publico: 400
    }, null);

    assert.deepEqual(cambios, [{ codigo: "103013", tipo: "nuevo" }]);
    assert.match(client.consultas[0].texto, /INSERT INTO public\.catalogo_fabricante_productos/);
});

test("aplicarProducto solo actualiza los precios que cambiaron", async () => {
    const client = clienteFalso();
    const existente = {
        codigo: "103013", clave: "PMU-8PX", descripcion: "Pinzas", marca: "TRUPER EXPERT",
        modulo: "29901", estado: "activo",
        precio_mayoreo: "335.00", precio_medio_mayoreo: "365.00", precio_publico: "400.00",
        precio_distribuidor: "255.00"
    };

    // Solo sube el medio mayoreo: 365 -> 375
    const cambios = await sync.aplicarProducto(client, 1, "TRUPER", "103013", {
        precio_mayoreo: 335, precio_medio_mayoreo: 375, precio_publico: 400
    }, existente);

    assert.equal(cambios.length, 1, "solo se reporta el campo que cambio");
    assert.equal(cambios[0].campo, "precio_medio_mayoreo");
    assert.equal(cambios[0].valorAnterior, "$365.00");
    assert.equal(cambios[0].valorNuevo, "$375.00");

    const respaldo = client.consultas.find(c => /catalogo_fabricante_respaldos/.test(c.texto));
    assert.ok(respaldo, "la fila se respalda antes de tocarla");

    const update = client.consultas.find(c => /UPDATE public\.catalogo_fabricante_productos/.test(c.texto));
    assert.match(update.texto, /precio_medio_mayoreo = /);
    assert.doesNotMatch(update.texto, /precio_publico = /, "un precio sin cambio no se reescribe");
});

test("aplicarProducto no toca actualizado_en cuando nada cambio", async () => {
    const client = clienteFalso();
    const existente = {
        codigo: "103013", clave: "PMU-8PX", descripcion: "Pinzas", marca: "TRUPER",
        modulo: "29901", estado: "activo",
        precio_mayoreo: "335.00", precio_medio_mayoreo: "365.00", precio_publico: "400.00"
    };

    const cambios = await sync.aplicarProducto(client, 1, "TRUPER", "103013", {
        precio_mayoreo: 335, precio_medio_mayoreo: 365, precio_publico: 400
    }, existente);

    assert.deepEqual(cambios, []);
    const update = client.consultas.find(c => /UPDATE/.test(c.texto));
    assert.match(update.texto, /visto_en = NOW\(\)/);
    assert.doesNotMatch(update.texto, /actualizado_en/,
        "la fecha de actualizacion es la del ultimo cambio real, no la de la ultima revision");
});

test("aplicarProducto nunca pisa una descripcion ya guardada", async () => {
    const client = clienteFalso();
    const existente = {
        codigo: "103013", clave: "PMU-8PX", descripcion: "Descripcion buena",
        marca: "TRUPER", modulo: "29901", estado: "activo",
        precio_publico: "400.00"
    };

    await sync.aplicarProducto(client, 1, "TRUPER", "103013", {
        descripcion: "otra cosa", precio_publico: 430
    }, existente);

    const update = client.consultas.find(c => /UPDATE public\.catalogo_fabricante_productos/.test(c.texto));
    assert.doesNotMatch(update.texto, /descripcion = /);
});

test("aplicarProducto reactiva un producto que el fabricante volvio a listar", async () => {
    const client = clienteFalso();
    const existente = {
        codigo: "103013", clave: "PMU-8PX", descripcion: "Pinzas", marca: "TRUPER",
        modulo: "29901", estado: "descontinuado", precio_publico: "400.00"
    };

    const cambios = await sync.aplicarProducto(client, 1, "TRUPER", "103013", {
        precio_publico: 400
    }, existente);

    assert.ok(cambios.some(c => c.campo === "estado" && c.valorNuevo === "activo"));
});

// ---------------------------------------------------------------------
// Orquestacion: frenos que protegen el catalogo
// ---------------------------------------------------------------------

// Pool falso con respuestas por patron de SQL, suficiente para correr
// sincronizar() completo sin base de datos.
//
// Dos cosas que la version anterior no hacia y que hacen falta desde que
// la corrida se aplica por lotes:
//
//   1. RECUERDA lo que se inserta. Antes toda lectura devolvia la foto
//      inicial, asi que una fase que relee la tabla despues de escribirla
//      la veia vacia y volvia a dar de alta lo mismo.
//   2. Cada client de connect() tiene su PROPIO buffer: lo que escribe no
//      lo ve nadie hasta el COMMIT y un ROLLBACK lo tira. Sin eso la
//      prueba no puede distinguir "se guardo" de "se intento guardar",
//      que es justo lo unico que importa cuando un lote falla.
function poolFalso({ existentes = [], modulosGuardados = [], fallarEn = null } = {}) {
    const ejecutadas = [];
    const productos = existentes.map(f => ({ ...f })); // confirmados
    const firmas = [];                                  // unidades firmadas y confirmadas

    function leer(texto, valores, visibles) {
        if (/FROM public\.catalogo_fabricante_modulos/.test(texto)) {
            return { rows: modulosGuardados, rowCount: modulosGuardados.length };
        }
        if (/FROM public\.catalogo_fabricante_productos/.test(texto)) {
            let filas = visibles;
            if (/estado = 'activo'/.test(texto)) filas = filas.filter(f => f.estado === "activo");
            const lista = (valores || []).find(v => Array.isArray(v));
            if (lista) filas = filas.filter(f => lista.includes(f.codigo));
            return { rows: filas, rowCount: filas.length };
        }
        return { rows: [], rowCount: 0 };
    }

    async function query(texto, valores) {
        ejecutadas.push({ texto, valores });
        if (/INSERT INTO public\.catalogo_fabricante_sincronizaciones/.test(texto)) {
            return { rows: [{ id: 1 }], rowCount: 1 };
        }
        if (/INSERT INTO public\.catalogo_fabricante_productos/.test(texto)) {
            productos.push({ codigo: String(valores[1]), estado: "activo" });
            return { rows: [], rowCount: 1 };
        }
        return leer(texto, valores, productos);
    }

    async function connect() {
        let nuevos = [];
        let nuevasFirmas = [];
        return {
            async query(texto, valores) {
                ejecutadas.push({ texto, valores });

                if (/^\s*BEGIN/.test(texto)) { nuevos = []; nuevasFirmas = []; return { rows: [], rowCount: 0 }; }
                if (/^\s*COMMIT/.test(texto)) {
                    productos.push(...nuevos);
                    firmas.push(...nuevasFirmas);
                    nuevos = []; nuevasFirmas = [];
                    return { rows: [], rowCount: 0 };
                }
                if (/^\s*ROLLBACK/.test(texto)) { nuevos = []; nuevasFirmas = []; return { rows: [], rowCount: 0 }; }

                if (fallarEn && fallarEn(texto, valores)) throw new Error("fallo simulado de la base");

                if (/INSERT INTO public\.catalogo_fabricante_productos/.test(texto)) {
                    nuevos.push({ codigo: String(valores[1]), estado: "activo" });
                    return { rows: [], rowCount: 1 };
                }
                if (/INSERT INTO public\.catalogo_fabricante_modulos/.test(texto)) {
                    nuevasFirmas.push({ unidad: String(valores[1]), parte: String(valores[2]), estado: String(valores[6]) });
                    return { rows: [], rowCount: 1 };
                }
                return leer(texto, valores, productos.concat(nuevos));
            },
            release() {}
        };
    }

    return { ejecutadas, productos, firmas, query, connect };
}

// Adaptador falso: un catalogo que de pronto solo lista un producto.
// Adaptador minimo que cumple el contrato comun. Ni una linea de OCR:
// demuestra que el nucleo no depende del formato de la fuente.
function adaptadorFalso(codigosVigentes, opciones = {}) {
    return {
        nombre: "FALSO",
        formato: "prueba",
        claveIdentidad: "codigo",
        nivelesPrecio: ["precio_publico"],
        listarUniverso: async () => new Map(
            codigosVigentes.map(c => [c, { clave: "K-" + c, unidadId: "u1", referencia: null }])
        ),
        listarUnidades: async () => [{
            id: "u1", parte: "", firma: opciones.firma || "igual", productosEsperados: codigosVigentes.length
        }],
        extraerUnidad: async () => ({
            filas: opciones.filas || [],
            confiable: opciones.confiable !== false,
            origen: "prueba", layout: "prueba", confianza: "alta",
            firmaContenido: "h"
        })
    };
}

test("un recorrido incompleto no descontinua el catalogo entero", async () => {
    // 100 productos activos guardados, pero el fabricante solo lista 1:
    // eso no es un cambio de catalogo, es un recorrido que fallo.
    const existentes = Array.from({ length: 100 }, (_, i) => ({
        codigo: String(1000 + i), clave: "", descripcion: "", marca: "", modulo: "0101",
        pagina: 1, estado: "activo", precio_publico: "10.00"
    }));
    const pool = poolFalso({
        existentes,
        // Con ETag identico no se reextrae nada; el caso a probar es solo
        // la baja masiva.
        modulosGuardados: [{ modulo: "0101", variante: "pub", etag: "igual", hash_contenido: "h" }]
    });

    await assert.rejects(
        () => sync.sincronizar(pool, adaptadorFalso(["1000"]), {}),
        /lectura incompleta/,
        "debe abortar en vez de dar de baja 99 productos"
    );

    // Y no debe haber quedado ningun UPDATE de baja aplicado.
    const bajas = pool.ejecutadas.filter(c => /estado = 'descontinuado'/.test(c.texto));
    assert.equal(bajas.length, 0, "la transaccion se aborta sin escribir bajas");
});

test("una baja pequena si se aplica normalmente", async () => {
    const existentes = Array.from({ length: 100 }, (_, i) => ({
        codigo: String(1000 + i), clave: "", descripcion: "", marca: "", modulo: "0101",
        pagina: 1, estado: "activo", precio_publico: "10.00"
    }));
    const vigentes = existentes.slice(0, 95).map(f => f.codigo); // se van 5 de 100
    const pool = poolFalso({
        existentes,
        modulosGuardados: [{ modulo: "0101", variante: "pub", etag: "igual", hash_contenido: "h" }]
    });

    const resultado = await sync.sincronizar(pool, adaptadorFalso(vigentes), {});
    assert.equal(resultado.estado, "completada");
    assert.equal(resultado.contadores.descontinuados, 5);
});

test("la primera corrida no se bloquea por el freno de regeneracion masiva", async () => {
    // Sin estado previo TODO cuenta como cambiado; medir sobre el total
    // dejaba el arranque inicial esperando confirmacion para siempre.
    const pool = poolFalso({ existentes: [], modulosGuardados: [] });
    const resultado = await sync.sincronizar(pool, adaptadorFalso(["1000"]), {});

    assert.notEqual(resultado.estado, "esperando_confirmacion");
    assert.equal(resultado.estado, "completada");
});


// ---------------------------------------------------------------------
// Reanudabilidad: la corrida se aplica por lotes
//
// Una carga completa de TRUPER son ~4 horas. Aplicarla en una sola
// transaccion al final significaba que un apagon a las 3h50m tiraba TODO
// el trabajo. Con lotes, cada modulo se confirma por su cuenta.
//
// El invariante que sostiene el diseno: la firma de una unidad ("esto ya
// se leyo") se graba en la MISMA transaccion que los productos que
// salieron de ella. Una firma sin precios seria peor que no tener nada:
// hace que nadie vuelva a leer ese modulo hasta que el fabricante cambie
// la imagen, y ese precio se pierde para siempre.
// ---------------------------------------------------------------------

// Adaptador con varios modulos, cada uno con sus productos. Es lo minimo
// para poder hablar de lotes: con una sola unidad no hay nada que probar.
function adaptadorPorModulos(modulos, opciones = {}) {
    const universo = new Map();
    for (const m of modulos) {
        for (const codigo of m.codigos) {
            universo.set(codigo, { clave: "K-" + codigo, unidadId: m.id, referencia: null });
        }
    }

    return {
        nombre: opciones.nombre || "MULTI",
        formato: "prueba",
        claveIdentidad: "codigo",
        nivelesPrecio: ["precio_publico"],
        leidas: [],
        listarUniverso: async () => universo,
        listarUnidades: async () => modulos.flatMap(m =>
            (m.partes || ["pub"]).map(parte => ({
                id: m.id, parte, firma: `${m.id}-${parte}-v1`, productosEsperados: m.codigos.length
            }))
        ),
        async extraerUnidad(unidad) {
            this.leidas.push(`${unidad.id}/${unidad.parte}`);
            if (opciones.alLeer) opciones.alLeer(unidad);
            const m = modulos.find(x => x.id === unidad.id);
            return {
                filas: m.codigos.map(codigo => ({
                    codigo, clave: "K-" + codigo, descripcion: "Producto " + codigo,
                    precios: { precio_publico: 100 }
                })),
                confiable: true, origen: "prueba", layout: "prueba", confianza: "alta",
                firmaContenido: `${unidad.id}-${unidad.parte}-h`
            };
        }
    };
}

test("lo que un lote confirma sobrevive a que el siguiente reviente", async () => {
    // Esto es la razon de ser de todo el rediseno. Antes, un fallo en el
    // modulo 40 borraba los 39 anteriores porque todo vivia en una sola
    // transaccion que se aplicaba al final.
    const adaptador = adaptadorPorModulos([
        { id: "m1", codigos: ["1001"] },
        { id: "m2", codigos: ["1002"] },
        { id: "m3", codigos: ["1003"] }
    ]);

    const pool = poolFalso({
        // El segundo modulo no se puede escribir.
        fallarEn: (texto, valores) =>
            /INSERT INTO public\.catalogo_fabricante_productos/.test(texto) && valores[1] === "1002"
    });

    const resultado = await sync.sincronizar(pool, adaptador, { aportarAlMaestro: false });

    assert.equal(resultado.estado, "completada", "un modulo malo no tumba la corrida");
    assert.equal(resultado.contadores.lotesFallidos, 1);

    const guardados = pool.productos.map(p => p.codigo).sort();
    assert.deepEqual(guardados, ["1001", "1003"],
        "quedo guardado lo de los modulos que si se pudieron aplicar, y nada del que fallo");
});

test("un lote que falla NO deja firmada ninguna de sus unidades", async () => {
    // Si la firma se guardara igual, la siguiente corrida se saltaria ese
    // modulo por tener el etag al dia y esos precios no se recuperarian
    // nunca. Es el bug que motivo mover las firmas dentro del COMMIT.
    const adaptador = adaptadorPorModulos([
        { id: "m1", codigos: ["1001"] },
        { id: "m2", codigos: ["1002"] }
    ]);

    const pool = poolFalso({
        fallarEn: (texto, valores) =>
            /INSERT INTO public\.catalogo_fabricante_productos/.test(texto) && valores[1] === "1002"
    });

    await sync.sincronizar(pool, adaptador, { aportarAlMaestro: false });

    const firmadas = pool.firmas.map(f => f.unidad);
    assert.ok(firmadas.includes("m1"), "el modulo que se aplico si queda firmado");
    assert.ok(!firmadas.includes("m2"), "el que fallo NO: la proxima corrida tiene que releerlo");
});

test("un lote se reintenta una vez antes de darlo por perdido", async () => {
    // Un deadlock o un corte de red de un segundo no deberian costar la
    // relectura del modulo, que es la parte cara.
    let intentos = 0;
    const adaptador = adaptadorPorModulos([{ id: "m1", codigos: ["1001"] }]);
    const pool = poolFalso({
        fallarEn: texto => {
            if (!/INSERT INTO public\.catalogo_fabricante_productos/.test(texto)) return false;
            intentos++;
            return intentos === 1; // solo el primer intento falla
        }
    });

    const resultado = await sync.sincronizar(pool, adaptador, { aportarAlMaestro: false });

    assert.equal(intentos, 2, "se reintento");
    assert.equal(resultado.contadores.lotesFallidos, 0, "y el reintento salio bien");
    assert.deepEqual(pool.productos.map(p => p.codigo), ["1001"]);
    // Y el modulo se leyo UNA sola vez: el reintento es de la escritura,
    // no de la lectura.
    assert.equal(adaptador.leidas.length, 1);
});

test("varios lotes fallidos seguidos abortan la corrida", async () => {
    // Un CHECK que revienta con una fila rara no debe frenar a los 3.900
    // modulos que siguen; pero si fallan varios seguidos, lo que esta mal
    // es la base o el esquema y seguir solo quema lectura.
    const modulos = Array.from({ length: 10 }, (_, i) => ({ id: "m" + i, codigos: ["100" + i] }));
    const adaptador = adaptadorPorModulos(modulos);
    const pool = poolFalso({
        fallarEn: texto => /INSERT INTO public\.catalogo_fabricante_productos/.test(texto)
    });

    await assert.rejects(
        () => sync.sincronizar(pool, adaptador, { aportarAlMaestro: false }),
        /fallo simulado/
    );

    assert.equal(adaptador.leidas.length, sync.MAX_LOTES_FALLIDOS_SEGUIDOS,
        "se rinde tras los primeros lotes, no lee los 10 modulos");
});

test("un lote es un modulo entero: sus dos variantes viajan juntas", async () => {
    // No es un detalle de eficiencia. La revision de coherencia entre
    // niveles cruza el precio de distribuidor con el de publico, y cada
    // uno viene en una variante distinta del mismo modulo. Separados en
    // lotes distintos, un precio con un digito perdido dejaria de verse.
    const lotes = sync.agruparPorUnidad([
        { id: "29901", parte: "pub" },
        { id: "29901", parte: "dis" },
        { id: "30001", parte: "pub" }
    ]);

    assert.equal(lotes.length, 2);
    assert.deepEqual(lotes[0].map(u => u.parte), ["pub", "dis"]);
    assert.deepEqual(lotes[1].map(u => u.parte), ["pub"]);
});

test("el freno de baja masiva salta ANTES de gastar una sola lectura", async () => {
    // Antes vivia dentro de la transaccion final: se descubria a las 4
    // horas, despues de pagar todo el OCR. Y el mensaje "no se aplico
    // nada" dependia de que un ROLLBACK deshiciera la corrida entera, algo
    // que ya no existe con lotes.
    const existentes = Array.from({ length: 100 }, (_, i) => ({
        codigo: String(1000 + i), estado: "activo", precio_publico: "10.00"
    }));
    const adaptador = adaptadorPorModulos([{ id: "m1", codigos: ["1000"] }]);
    const pool = poolFalso({ existentes });

    await assert.rejects(
        () => sync.sincronizar(pool, adaptador, { aportarAlMaestro: false }),
        /lectura incompleta/
    );

    assert.equal(adaptador.leidas.length, 0, "no se leyo ni un modulo");
});

test("la confirmacion de regeneracion masiva se hereda de la corrida anterior", async () => {
    // Es una decision del operador sobre un evento de la fuente, no de un
    // proceso. Si la corrida que la traia murio a la hora 3, volver a
    // pedirla en cada reanudacion haria imposible terminar.
    const modulos = [{ id: "m1", codigos: ["1001"] }, { id: "m2", codigos: ["1002"] }];
    const adaptador = adaptadorPorModulos(modulos);
    const pool = poolFalso({
        // Las dos unidades ya conocidas, con firma vieja: todo "cambio".
        modulosGuardados: [
            { modulo: "m1", variante: "pub", etag: "viejo", hash_contenido: "x" },
            { modulo: "m2", variante: "pub", etag: "viejo", hash_contenido: "x" }
        ]
    });

    // Sin confirmar: se detiene y pregunta.
    const primera = await sync.sincronizar(pool, adaptador, { aportarAlMaestro: false });
    assert.equal(primera.estado, "esperando_confirmacion");

    // Ahora una corrida anterior que SI traia la confirmacion.
    const pool2 = poolFalso({
        modulosGuardados: [
            { modulo: "m1", variante: "pub", etag: "viejo", hash_contenido: "x" },
            { modulo: "m2", variante: "pub", etag: "viejo", hash_contenido: "x" }
        ]
    });
    const original = pool2.query;
    pool2.query = async (texto, valores) => {
        if (/SELECT confirmo_regeneracion/.test(texto)) {
            return { rows: [{ confirmo_regeneracion: true }], rowCount: 1 };
        }
        return original(texto, valores);
    };

    const segunda = await sync.sincronizar(pool2, adaptadorPorModulos(modulos), { aportarAlMaestro: false });
    assert.equal(segunda.estado, "completada", "hereda la confirmacion y sigue");
});

test("la confirmacion de BAJA masiva NUNCA se hereda", async () => {
    // Es la unica proteccion dura contra descontinuar media tienda por una
    // lectura incompleta del universo. Heredarla la volveria inutil justo
    // en el caso que importa: corridas que se cortan y se reanudan solas.
    const existentes = Array.from({ length: 100 }, (_, i) => ({
        codigo: String(1000 + i), estado: "activo", precio_publico: "10.00"
    }));
    const pool = poolFalso({ existentes });
    const original = pool.query;
    pool.query = async (texto, valores) => {
        // Aunque la corrida anterior hubiera confirmado TODO.
        if (/SELECT confirmo_regeneracion/.test(texto)) {
            return { rows: [{ confirmo_regeneracion: true }], rowCount: 1 };
        }
        return original(texto, valores);
    };

    await assert.rejects(
        () => sync.sincronizar(pool, adaptadorPorModulos([{ id: "m1", codigos: ["1000"] }]), { aportarAlMaestro: false }),
        /lectura incompleta/,
        "la confirmacion heredada es solo de regeneracion, no de bajas"
    );
});

test("dos corridas del mismo fabricante a la vez: la segunda se rechaza", async () => {
    // El indice unico parcial de Postgres es lo unico que protege contra
    // que el servidor y scripts/bootstrap-truper.js corran a la vez: la
    // variable en memoria del servidor no ve al script.
    const pool = {
        query: async () => {
            const choque = new Error("duplicate key value violates unique constraint");
            choque.code = "23505";
            throw choque;
        }
    };

    await assert.rejects(
        () => sync.crearSincronizacion(pool, "TRUPER"),
        error => error.httpStatus === 409 && /ya hay una sincronizacion/.test(error.message)
    );
});

test("si ninguna fila del lote cae en el universo, sus unidades quedan en revision", async () => {
    // Segundo cinturon: que el universo llegue vacio o mal parseado no
    // puede terminar en firmar modulos como leidos. Eso los quemaria hasta
    // que el fabricante regenere la imagen.
    const adaptador = adaptadorPorModulos([{ id: "m1", codigos: ["1001"] }]);
    // El universo dice que el vigente es otro producto, no el que trae el
    // modulo. Ninguna fila leida cae dentro.
    adaptador.listarUniverso = async () => new Map([["9999", { clave: "K-9999", unidadId: "m1" }]]);

    const pool = poolFalso();
    await sync.sincronizar(pool, adaptador, { aportarAlMaestro: false });

    assert.deepEqual(pool.firmas.map(f => f.estado), ["revision_manual"]);
    assert.ok(!pool.productos.some(p => p.codigo === "1001"),
        "y no se guardo el producto que no esta en el universo");
});

test("el latido cuelga del avance del adaptador, no de los cortes entre fases", async () => {
    // Latir solo entre fases dejaba ~35 minutos de silencio: listarUniverso
    // recorre ~600 paginas y listarUnidades pide la firma de 7.932 unidades.
    // En ese hueco una corrida sana se veia igual que un proceso muerto, y
    // la siguiente la habria cerrado por huerfana a los 30 minutos. Se
    // detecto midiendo la corrida de verdad: 169 segundos sin latir.
    const pool = poolFalso();
    const adaptador = adaptadorPorModulos([{ id: "m1", codigos: ["1001"] }]);

    let latidosDurante = 0;
    const universoOriginal = adaptador.listarUniverso;
    adaptador.listarUniverso = async ctx => {
        // El adaptador reporta avance a media fase, como hace el de TRUPER
        // pagina por pagina.
        ctx.onProgreso({ etapa: "universo", paginas: 1 });
        latidosDurante = pool.ejecutadas.filter(c => /SET latido_en = NOW\(\)/.test(c.texto)).length;
        return universoOriginal(ctx);
    };

    await sync.sincronizar(pool, adaptador, { aportarAlMaestro: false });

    assert.ok(latidosDurante > 0,
        "un adaptador que reporta avance mantiene viva la corrida sin esperar a que termine la fase");
});

test("cerrarCorridasHuerfanas se guia por el latido, no por la hora de arranque", async () => {
    // Una carga sana de TRUPER dura 4 horas. Mirando iniciada_en, la
    // siguiente corrida daba por muerta a una que estaba trabajando.
    const ejecutadas = [];
    const pool = { query: async (texto, valores) => { ejecutadas.push({ texto, valores }); return { rows: [] }; } };

    await sync.cerrarCorridasHuerfanas(pool, "TRUPER", 30);

    assert.match(ejecutadas[0].texto, /COALESCE\(latido_en, iniciada_en\)/);
});
// ---------------------------------------------------------------------
// El motor es UNIVERSAL: mismo nucleo, fuentes de formatos distintos
// ---------------------------------------------------------------------

const contrato = require("../catalogo-fabricante-contrato");
const { crearAdaptadorArchivo, parsearListaPrecios, partirLinea, mapearColumnas } =
    require("../fabricantes/lista-precios-archivo");

test("el contrato rechaza un adaptador incompleto antes de correr nada", () => {
    const problemas = contrato.validarAdaptador({ nombre: "X" });
    assert.ok(problemas.some(p => /formato/.test(p)));
    assert.ok(problemas.some(p => /claveIdentidad/.test(p)));
    assert.ok(problemas.some(p => /listarUniverso/.test(p)));

    // Vale mas fallar aqui con un mensaje claro que a mitad de una corrida.
    const pool = poolFalso();
    return assert.rejects(
        () => sync.sincronizar(pool, { nombre: "X" }, {}),
        /no cumple el contrato/
    );
});

test("normalizarFila lleva cualquier fuente al mismo formato", () => {
    const fila = contrato.normalizarFila({
        codigo: " 103013 ", ean: "7501206512345", descripcion: "Pinzas",
        precios: { precio_publico: "$1,234.50", precio_lista_especial: "99" }
    }, { nivelesPrecio: ["precio_publico"] });

    assert.equal(fila.codigo, "103013");
    assert.equal(fila.precios.precio_publico, 1234.5);
    // Un nivel de precio que no es de los cuatro estandar no se pierde:
    // se conserva aparte en vez de descartarlo.
    assert.equal(fila.preciosExtra.precio_lista_especial, 99);
    assert.equal(fila.completa, true);
});

test("la identidad puede ser el codigo (ferreteria) o el EAN (abarrote)", () => {
    const fila = { codigo: "103013", ean: "7501206512345" };
    assert.equal(contrato.identidadDeFila(fila, "codigo"), "103013");
    assert.equal(contrato.identidadDeFila(fila, "ean"), "7501206512345");
    // Sin identidad no hay producto: nunca se inventa una.
    assert.equal(contrato.identidadDeFila({ descripcion: "algo" }, "ean"), "");
});

test("la coherencia entre niveles atrapa un precio con digitos de menos", () => {
    // Caso real medido por doble lectura: el OCR leyo 1 donde decia 115.
    // Ninguna validacion de estructura lo ve -- el codigo coincide y la
    // fila esta completa -- pero la proporcion contra el publico si.
    const problemas = contrato.revisarCoherenciaNiveles({
        precio_distribuidor: 1, precio_publico: 115
    });
    assert.ok(problemas.some(p => /digitos de menos/.test(p)), problemas.join("; "));

    // Una relacion normal no molesta: distribuidor 255 contra publico 400.
    assert.deepEqual(
        contrato.revisarCoherenciaNiveles({ precio_distribuidor: 255, precio_publico: 400 }),
        []
    );
    // Ni el caso real de tres precios iguales.
    assert.deepEqual(
        contrato.revisarCoherenciaNiveles({
            precio_mayoreo: 350, precio_medio_mayoreo: 350, precio_publico: 350
        }),
        []
    );
});

test("partirLinea respeta las comillas de una descripcion con comas", () => {
    assert.deepEqual(
        partirLinea('103013,"Martillo, mango de fibra",335', ","),
        ["103013", "Martillo, mango de fibra", "335"]
    );
});

test("el lector de archivo detecta el separador y mapea columnas con acentos", () => {
    // El mismo proveedor manda ";" un mes y "," al siguiente, y escribe el
    // encabezado como "Precio Público", "PRECIO PUBLICO" o "precio_publico".
    const csv = [
        "Codigo;Clave;Descripcion;Precio Público",
        "103013;PMU-8PX;Pinzas multiuso;400"
    ].join("\n");

    const { filas, separador } = parsearListaPrecios(csv, {
        columnas: { codigo: "codigo", clave: "clave", descripcion: "descripcion", precio_publico: "precio publico" },
        nivelesPrecio: ["precio_publico"]
    });

    assert.equal(separador, ";");
    assert.equal(filas.length, 1);
    assert.equal(filas[0].codigo, "103013");
    assert.equal(filas[0].precios.precio_publico, 400);
});

test("una celda de precio vacia deja la fila incompleta, no se rellena", () => {
    const csv = "codigo,precio_publico\n103013,400\n103012,";
    const { filas } = parsearListaPrecios(csv, {
        columnas: { codigo: "codigo", precio_publico: "precio_publico" },
        nivelesPrecio: ["precio_publico"]
    });

    assert.equal(filas[0].completa, true);
    assert.equal(filas[1].completa, false);
    assert.equal(filas[1].precios.precio_publico, undefined);
});

test("las lineas sin identidad (totales, notas) se descartan", () => {
    const csv = "codigo,precio_publico\n103013,400\n,\nTOTAL,999";
    const { filas } = parsearListaPrecios(csv, {
        columnas: { codigo: "codigo", precio_publico: "precio_publico" },
        nivelesPrecio: ["precio_publico"]
    });
    // "TOTAL" tiene texto en la columna de codigo, asi que sobrevive como
    // fila; la vacia no. Lo que importa es que la linea en blanco no crea
    // un producto fantasma.
    assert.ok(filas.every(f => f.codigo !== ""));
});

test("EL MISMO NUCLEO corre una fuente de imagen y una de archivo", async () => {
    // Esta es la prueba de que el motor no depende de TRUPER. Se corre la
    // misma funcion sincronizar() con dos adaptadores que no comparten
    // NADA: uno declara formato 'prueba' y otro lee un CSV de abarrote
    // identificado por EAN.
    const csv = [
        "Codigo de barras,Producto,Precio",
        "7501000110017,Pan Blanco Grande,42.50",
        "7501000110024,Pan Integral,48.00"
    ].join("\n");

    const bimbo = crearAdaptadorArchivo({
        nombre: "BIMBO",
        claveIdentidad: "ean",
        leerContenido: async () => csv,
        columnas: { ean: "Codigo de barras", descripcion: "Producto", precio_publico: "Precio" }
    });

    assert.deepEqual(contrato.validarAdaptador(bimbo), [], "el adaptador de archivo cumple el contrato");

    const pool = poolFalso();
    const resultado = await sync.sincronizar(pool, bimbo, {});

    assert.equal(resultado.estado, "completada");
    assert.equal(resultado.contadores.nuevos, 2, "dio de alta los dos productos del CSV");

    // Y se guardaron identificados por EAN, con su precio del archivo.
    const inserts = pool.ejecutadas.filter(c => /INSERT INTO public\.catalogo_fabricante_productos/.test(c.texto));
    assert.equal(inserts.length, 2);
    assert.equal(inserts[0].valores[1], "7501000110017", "la identidad es el EAN, no un codigo de fabricante");
    assert.equal(inserts[0].valores[10], 42.5, "y trae el precio publico del archivo");
});

test("reenviar el mismo archivo no reprocesa nada", async () => {
    const csv = "codigo,precio_publico\n103013,400";
    const config = {
        nombre: "PROVEEDOR",
        leerContenido: async () => csv,
        columnas: { codigo: "codigo", precio_publico: "precio_publico" }
    };

    const primera = crearAdaptadorArchivo(config);
    const unidades = await primera.listarUnidades({});
    assert.equal(unidades.length, 1, "un archivo es una sola unidad");

    // La firma es el hash del contenido: si el proveedor reenvia el mismo
    // archivo, la unidad no cambia y el nucleo se la salta.
    const pool = poolFalso({ modulosGuardados: [{ modulo: "archivo", variante: "", etag: unidades[0].firma, hash_contenido: "" }] });
    const resultado = await sync.sincronizar(pool, crearAdaptadorArchivo(config), {});
    assert.equal(resultado.contadores.unidadesCambiadas, 0);
});

// ---------------------------------------------------------------------
// Aporte al Catalogo Maestro
//
// El Maestro guarda IDENTIDAD (que es el producto), nunca precio. Y lo
// que ya esta escrito no se pisa: un dato de fabrica no es
// automaticamente mejor que uno que alguien verifico con el producto en
// la mano.
// ---------------------------------------------------------------------

const maestro = require("../catalogo-maestro-fabricante");

test("un producto sin nombre no entra al Maestro", () => {
    const decision = maestro.decidirAporte(
        { codigo: "103013", descripcion: "", marca: "TRUPER", fabricante: "TRUPER" },
        null
    );
    assert.equal(decision.accion, "omitir");
    assert.match(decision.motivo, /sin nombre/);
});

test("un producto nuevo con identidad se inserta", () => {
    const decision = maestro.decidirAporte(
        { codigo: "103013", descripcion: "Pinza multiuso 8\"", marca: "TRUPER EXPERT", fabricante: "TRUPER" },
        null
    );
    assert.equal(decision.accion, "insertar");
});

test("no se pisa lo que un negocio ya habia aportado", () => {
    const decision = maestro.decidirAporte(
        { codigo: "103013", descripcion: "Pinza multiuso 8\"", marca: "TRUPER EXPERT", fabricante: "TRUPER" },
        { id: 7, nombre: "Pinza que el dueno nombro asi", marca: "TRUPER", ean: "", fabricante: "" }
    );

    assert.equal(decision.accion, "completar");
    assert.equal(decision.campos.nombre, undefined, "el nombre existente no se toca");
    assert.equal(decision.campos.marca, undefined, "la marca existente no se toca");
    // Pero dejar constancia del fabricante SI es informacion nueva.
    assert.equal(decision.campos.fabricante, "TRUPER");
});

test("solo se rellenan los huecos", () => {
    const decision = maestro.decidirAporte(
        { codigo: "103013", descripcion: "Pinza multiuso 8\"", marca: "TRUPER EXPERT", ean: "7501206512345", fabricante: "TRUPER" },
        { id: 7, nombre: "Pinza", marca: "", ean: "", fabricante: "TRUPER" }
    );

    assert.equal(decision.accion, "completar");
    assert.equal(decision.campos.nombre, undefined, "ya tenia nombre");
    assert.equal(decision.campos.marca, "TRUPER EXPERT", "la marca estaba vacia: se llena");
    assert.equal(decision.campos.ean, "7501206512345", "el EAN estaba vacio: se llena");
});

test("dos fabricantes con el mismo codigo NO se mezclan", () => {
    // `codigo` es UNIQUE global en el Maestro. El 103013 de TRUPER y un
    // 103013 de URREA son productos distintos; enlazarlos seria fundir dos
    // productos que no tienen nada que ver.
    const decision = maestro.decidirAporte(
        { codigo: "103013", descripcion: "Llave ajustable", marca: "URREA", fabricante: "URREA" },
        { id: 7, nombre: "Pinza multiuso", marca: "TRUPER EXPERT", ean: "", fabricante: "TRUPER" }
    );

    assert.equal(decision.accion, "omitir");
    assert.match(decision.motivo, /ya pertenece a TRUPER/);
});

test("si no hay nada que agregar, solo se enlaza", () => {
    const decision = maestro.decidirAporte(
        { codigo: "103013", descripcion: "Pinza", marca: "TRUPER", fabricante: "TRUPER" },
        { id: 7, nombre: "Pinza", marca: "TRUPER", ean: "", fabricante: "TRUPER" }
    );
    assert.equal(decision.accion, "enlazar");
});

test("el aporte al Maestro no toca ningun campo de precio", () => {
    // Regla de oro del Maestro: guarda que ES el producto, no cuanto
    // cuesta. Se comprueba sobre el codigo fuente para que nadie agregue
    // un precio aqui por descuido.
    const fuente = require("fs").readFileSync(
        require("path").join(__dirname, "..", "catalogo-maestro-fabricante.js"), "utf8"
    );
    const lineasConPrecio = fuente
        .split("\n")
        .filter(linea => /precio_(mayoreo|medio_mayoreo|publico|distribuidor)/.test(linea))
        .filter(linea => !linea.trim().startsWith("//"));

    assert.deepEqual(lineasConPrecio, [], "ninguna linea de codigo debe tocar un campo de precio");
});

test("una variante que no aporta un precio no lo borra", async () => {
    const client = clienteFalso();
    const existente = {
        codigo: "103013", clave: "PMU-8PX", descripcion: "Pinzas", marca: "TRUPER",
        modulo: "29901", estado: "activo",
        precio_mayoreo: "335.00", precio_publico: "400.00", precio_distribuidor: "255.00"
    };

    // El modulo de distribuidor cambio, el de publico no: solo llega ese precio.
    const cambios = await sync.aplicarProducto(client, 1, "TRUPER", "103013", {
        precio_distribuidor: 265
    }, existente);

    assert.equal(cambios.length, 1);
    assert.equal(cambios[0].campo, "precio_distribuidor");

    const update = client.consultas.find(c => /UPDATE public\.catalogo_fabricante_productos/.test(c.texto));
    assert.doesNotMatch(update.texto, /precio_mayoreo/, "los precios que esta corrida no leyo quedan intactos");
});

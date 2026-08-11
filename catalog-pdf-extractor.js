// Motor de extraccion de catalogos PDF de proveedor -- codigo,
// descripcion, imagen y precio por producto. Modulo puro (sin Express):
// toda la logica pesada vive aqui para poder probarla con `node --test`
// sin levantar el servidor. catalog-pdf-server.js orquesta el trabajo en
// segundo plano y hace los INSERT en catalogo_productos; este archivo
// solo lee el PDF y regresa productos candidatos ya resueltos.
//
// Filosofia (pedida explicitamente por el dueno): procesamiento
// tradicional primero -- texto/posicion via pdfjs, OCR via tesseract.js
// solo si la pagina no trae texto nativo, deteccion de imagenes por
// geometria real del PDF, regex para codigo/precio, asociacion por
// contencion espacial (nunca por orden del stream de texto). La IA
// (Claude Haiku con vision) solo entra para desambiguar candidatos que
// YA se encontraron pero son ambiguos entre si -- nunca para generar un
// valor desde cero, y siempre con un tope duro de llamadas por trabajo.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { config } = require("./config");

// Carpeta de fuentes sustitutas que ya trae pdfjs-dist (Foxit/Liberation)
// para fuentes estandar de PDF (Helvetica, Times, Courier) que no vienen
// embebidas en el archivo -- sin esto, pdfjs intenta resolver la fuente
// via el sistema operativo (useSystemFonts) y el render sale con glifos
// incorrectos/vacios cuando el SO no tiene esa familia exacta instalada.
const RUTA_FUENTES_ESTANDAR = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts").replace(/\\/g, "/") + "/";

// ---------------------------------------------------------------------
// Cliente de Anthropic -- mismo patron perezoso que ia-server.js
// (obtenerAnthropic), duplicado aqui porque ese archivo solo exporta la
// funcion de wiring de rutas, no sus helpers internos.
// ---------------------------------------------------------------------
let anthropicClient = null;
function obtenerAnthropicPdf() {
    if (!config.anthropicApiKey) return null;
    if (!anthropicClient) {
        const Anthropic = require("@anthropic-ai/sdk");
        anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
    }
    return anthropicClient;
}

// ---------------------------------------------------------------------
// pdfjs-dist v6 es ESM-only (solo .mjs) -- este proyecto es CommonJS,
// asi que se carga con import() dinamico y se cachea la promesa.
// ---------------------------------------------------------------------
let pdfjsLibPromise = null;
function cargarPdfjs() {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
    }
    return pdfjsLibPromise;
}

// Fabrica de canvas para pdfjs basada en @napi-rs/canvas (binarios
// prebuilt, sin toolchain nativo -- mismo perfil de riesgo que sharp,
// que ya esta en produccion). El paquete npm de pdfjs-dist no expone su
// NodeCanvasFactory interna, asi que se implementa aqui siguiendo la
// interfaz BaseCanvasFactory (create/reset/destroy).
function crearFabricaCanvasPdf() {
    const { createCanvas } = require("@napi-rs/canvas");
    return {
        create(width, height) {
            const canvas = createCanvas(width, height);
            return { canvas, context: canvas.getContext("2d") };
        },
        reset(canvasAndContext, width, height) {
            canvasAndContext.canvas.width = width;
            canvasAndContext.canvas.height = height;
        },
        destroy(canvasAndContext) {
            canvasAndContext.canvas.width = 0;
            canvasAndContext.canvas.height = 0;
            canvasAndContext.canvas = null;
            canvasAndContext.context = null;
        }
    };
}

// ---------------------------------------------------------------------
// Banco de regex generico -- se complementa (no se reemplaza) con el
// regex aprendido por proveedor via plantilla, cuando existe.
// ---------------------------------------------------------------------
const REGEX_CODIGO_GENERICOS = [
    /^[A-Z]{1,4}[-\s]?\d{3,8}[A-Z]?$/i,
    /^\d{4,10}$/,
    /^[A-Z0-9]{2,5}-[A-Z0-9]{2,10}$/i
];

const REGEX_PRECIO_FUERTE = /^\$\s?\d{1,3}(,\d{3})*(\.\d{1,2})?$/;
const REGEX_PRECIO_DEBIL = /^\d{1,3}(,\d{3})*\.\d{2}$/;

function pareceCodigo(texto, regexAprendido) {
    const limpio = String(texto || "").trim();
    if (!limpio || limpio.length > 20) return false;
    if (REGEX_PRECIO_FUERTE.test(limpio) || REGEX_PRECIO_DEBIL.test(limpio)) return false;
    if (regexAprendido) {
        try {
            if (new RegExp(regexAprendido, "i").test(limpio)) return true;
        } catch (error) {
            // regex aprendido invalido -- se ignora, cae a los genericos
        }
    }
    return REGEX_CODIGO_GENERICOS.some(regex => regex.test(limpio));
}

function precioDeTexto(texto) {
    const limpio = String(texto || "").trim();
    if (REGEX_PRECIO_FUERTE.test(limpio)) {
        return { numero: Number(limpio.replace(/[$,\s]/g, "")), fuerte: true };
    }
    if (REGEX_PRECIO_DEBIL.test(limpio)) {
        return { numero: Number(limpio.replace(/,/g, "")), fuerte: false };
    }
    return null;
}

// ---------------------------------------------------------------------
// Agrupar fragmentos de texto de pdfjs en lineas (mismo Y aproximado) --
// un catalogo real puede partir "GAF-10001" en varios fragmentos por
// kerning; agrupar por linea antes de aplicar regex es mas robusto que
// probar fragmento por fragmento.
// ---------------------------------------------------------------------
// Agrupa fragmentos {texto,x,y,alto,ancho} (x/y = esquina inferior
// izquierda del fragmento, espacio PDF) en "lineas". Primero por Y
// (misma fila visual), pero dentro de una fila un catalogo en grilla
// suele tener varios productos lado a lado a la MISMA altura (mismo
// codigo/descripcion/precio en Y, distinta columna) -- fusionar solo
// por Y los mezclaria en una sola linea y destruiria la separacion de
// columnas antes de que segmentarCeldas pueda actuar. Por eso, dentro
// de cada fila, se corta en una linea nueva cada vez que hay un salto
// grande en X. Compartida entre el pipeline de texto nativo y el de
// OCR para que ambos segmenten columnas de forma identica.
function agruparFragmentosEnLineas(candidatos, toleranciaY) {
    const ordenados = candidatos.slice().sort((a, b) => b.y - a.y || a.x - b.x);

    const filasPorY = [];
    for (const frag of ordenados) {
        let fila = filasPorY.find(f => Math.abs(f.yBase - frag.y) <= toleranciaY);
        if (!fila) {
            fila = { yBase: frag.y, fragmentos: [] };
            filasPorY.push(fila);
        }
        fila.fragmentos.push(frag);
    }

    const lineas = [];
    for (const fila of filasPorY) {
        const frags = fila.fragmentos.sort((a, b) => a.x - b.x);
        let actual = [];
        let finAnterior = null;

        for (const frag of frags) {
            const HUECO_X = Math.max(frag.alto * 3, 25);
            if (finAnterior !== null && (frag.x - finAnterior) > HUECO_X) {
                lineas.push(actual);
                actual = [];
            }
            actual.push(frag);
            finAnterior = frag.x + frag.ancho;
        }
        if (actual.length) lineas.push(actual);
    }

    return lineas.map(frags => {
        const texto = frags.map(f => f.texto).join(" ").replace(/\s+/g, " ").trim();
        const xMin = Math.min(...frags.map(f => f.x));
        const xMax = Math.max(...frags.map(f => f.x + f.ancho));
        const yMin = Math.min(...frags.map(f => f.y));
        const yMax = Math.max(...frags.map(f => f.y + f.alto));
        const altoMax = Math.max(...frags.map(f => f.alto));
        return { texto, xMin, xMax, yMin, yMax, alto: altoMax };
    }).filter(l => l.texto);
}

function agruparLineasDeTexto(items, toleranciaY = 3) {
    const candidatos = items
        .filter(item => item.str && item.str.trim())
        .map(item => {
            const [, , , , x, y] = item.transform;
            const alto = item.height || Math.abs(item.transform[3]) || 10;
            const ancho = item.width || (item.str.length * alto * 0.5);
            return { texto: item.str, x, y, alto, ancho };
        });

    return agruparFragmentosEnLineas(candidatos, toleranciaY);
}

// Umbral bajo de caracteres reales -> pagina se trata como escaneada.
function paginaPareceEscaneada(items) {
    const caracteres = items.reduce((total, item) => total + (item.str || "").replace(/\s/g, "").length, 0);
    return caracteres < 15;
}

// ---------------------------------------------------------------------
// Bbox de imagenes nativas via operator list -- recorre paintImageXObject
// acumulando la pila de matrices de transformacion (save/restore/transform),
// igual que se valido en el smoke test contra el PDF sintetico.
// ---------------------------------------------------------------------
async function extraerBboxImagenesNativas(page, pdfjsLib) {
    const opList = await page.getOperatorList();
    const { OPS } = pdfjsLib;
    const bboxes = [];
    let matrizActual = [1, 0, 0, 1, 0, 0];
    const pila = [];

    function multiplicar(m1, m2) {
        return [
            m1[0] * m2[0] + m1[1] * m2[2],
            m1[0] * m2[1] + m1[1] * m2[3],
            m1[2] * m2[0] + m1[3] * m2[2],
            m1[2] * m2[1] + m1[3] * m2[3],
            m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
            m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
        ];
    }

    for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];

        if (fn === OPS.save) {
            pila.push(matrizActual.slice());
        } else if (fn === OPS.restore) {
            matrizActual = pila.pop() || [1, 0, 0, 1, 0, 0];
        } else if (fn === OPS.transform) {
            matrizActual = multiplicar(args, matrizActual);
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
            const esquinas = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [
                matrizActual[0] * x + matrizActual[2] * y + matrizActual[4],
                matrizActual[1] * x + matrizActual[3] * y + matrizActual[5]
            ]);
            const xs = esquinas.map(p => p[0]);
            const ys = esquinas.map(p => p[1]);
            const xMin = Math.min(...xs), xMax = Math.max(...xs);
            const yMin = Math.min(...ys), yMax = Math.max(...ys);
            // Descarta imagenes minusculas (linea decorativa, icono de
            // fondo) -- una foto de producto real siempre ocupa una
            // region visible de la celda.
            if ((xMax - xMin) >= 15 && (yMax - yMin) >= 15) {
                bboxes.push({ xMin, xMax, yMin, yMax });
            }
        }
    }

    return bboxes;
}

// ---------------------------------------------------------------------
// OCR de pagina escaneada -- rasteriza y corre tesseract.js, normaliza
// las palabras devueltas (bbox en pixeles de imagen, eje Y hacia abajo)
// a la misma forma de "linea" que usa el pipeline de texto nativo
// (bbox en puntos PDF, eje Y hacia arriba) agrupando por fila.
// ---------------------------------------------------------------------
async function lineasPorOCR(worker, rasterBuffer, escala, altoPaginaPt) {
    // tesseract.js v7 solo llena data.blocks (bloque > parrafo > linea >
    // palabra) cuando se pide explicitamente -- por default data.words
    // no existe. Se piden bloques y se aplanan a nivel palabra.
    const { data } = await worker.recognize(rasterBuffer, {}, { blocks: true });

    const palabras = [];
    for (const bloque of data.blocks || []) {
        for (const parrafo of bloque.paragraphs || []) {
            for (const linea of parrafo.lines || []) {
                for (const palabra of linea.words || []) {
                    if (palabra.text && palabra.text.trim()) palabras.push(palabra);
                }
            }
        }
    }

    // Imagen: origen arriba-izq, Y crece hacia abajo. PDF: origen
    // abajo-izq, Y crece hacia arriba -- se convierte cada palabra a
    // espacio PDF ANTES de agrupar, para reusar el mismo agrupador
    // (y el mismo corte por salto de columna en X) que el texto nativo.
    const candidatos = palabras.map(p => ({
        texto: p.text,
        x: p.bbox.x0 / escala,
        y: altoPaginaPt - (p.bbox.y1 / escala),
        alto: (p.bbox.y1 - p.bbox.y0) / escala,
        ancho: (p.bbox.x1 - p.bbox.x0) / escala
    }));

    return agruparFragmentosEnLineas(candidatos, 6 / escala);
}

// ---------------------------------------------------------------------
// Segmentacion en celdas -- proyeccion por bandas: agrupa items (texto
// + imagenes) primero en filas (eje Y con hueco minimo entre bandas),
// luego cada fila en columnas (eje X). Cada interseccion es una celda
// candidata de producto -- el patron dominante en catalogos de
// ferreteria/tlapaleria es una grilla repetida por pagina.
// ---------------------------------------------------------------------
function agruparEnBandas(items, obtenerRango, hueco) {
    const ordenados = items.slice().sort((a, b) => obtenerRango(a).min - obtenerRango(b).min);
    const bandas = [];

    for (const item of ordenados) {
        const rango = obtenerRango(item);
        let banda = bandas.find(b => rango.min <= b.max + hueco && rango.max >= b.min - hueco);
        if (!banda) {
            banda = { min: rango.min, max: rango.max, items: [] };
            bandas.push(banda);
        }
        banda.min = Math.min(banda.min, rango.min);
        banda.max = Math.max(banda.max, rango.max);
        banda.items.push(item);
    }

    return bandas.sort((a, b) => b.max - a.max); // de arriba hacia abajo (Y mayor primero)
}

// Catalogos reales de proveedor (validado contra el catalogo real de
// GAFI) tienen texto MUY denso -- el hueco vertical entre la ultima
// linea de un producto y el titulo del siguiente puede ser menor que
// el hueco entre lineas de descripcion del MISMO producto, asi que
// agrupar filas por intervalos de texto encadena productos distintos
// en una sola celda gigante. Las imagenes, en cambio, casi siempre
// estan bien separadas (una foto por producto, con aire alrededor) --
// por eso, cuando hay suficientes imagenes en la pagina, se usan ELLAS
// como ancla de la grilla en vez del texto, y cada linea de texto se
// asigna a la celda de la imagen mas cercana (por punto medio entre
// imagenes vecinas). Paginas con pocas o ninguna imagen (texto puro,
// o el fallback de paginas escaneadas sin XObjects utilizables) siguen
// usando el agrupador por intervalos de texto de siempre.
const MIN_IMAGENES_PARA_ANCLAR_GRILLA = 2;

function segmentarCeldas(lineas, imagenes, anchoPagina) {
    if (imagenes.length >= MIN_IMAGENES_PARA_ANCLAR_GRILLA) {
        return segmentarCeldasPorImagenes(lineas, imagenes, anchoPagina);
    }
    return segmentarCeldasPorTexto(lineas, imagenes);
}

function segmentarCeldasPorImagenes(lineas, imagenesOriginales, anchoPagina) {
    // Un banner/logo de encabezado o pie de pagina puede pasar el filtro
    // de tamano minimo de extraerBboxImagenesNativas y abarcar casi todo
    // el ancho de la pagina -- no es la foto de un producto individual.
    // A diferencia del area, esto SI se puede descartar con seguridad
    // sin penalizar fotos de producto chicas (un catalogo real mezcla
    // fotos grandes y chicas del mismo tipo de articulo legitimamente).
    const ancho = anchoPagina || Math.max(1, ...imagenesOriginales.map(i => i.xMax), ...lineas.map(l => l.xMax));
    const imagenes = imagenesOriginales.filter(img => (img.xMax - img.xMin) < ancho * 0.6);

    if (imagenes.length < MIN_IMAGENES_PARA_ANCLAR_GRILLA) {
        return segmentarCeldasPorTexto(lineas, imagenesOriginales);
    }

    const alturaMediana = mediana(imagenes.map(img => img.yMax - img.yMin));
    const anchoMediano = mediana(imagenes.map(img => img.xMax - img.xMin));

    const filasImg = agruparEnBandas(
        imagenes.map(img => ({ tipo: "imagen", dato: img })),
        item => ({ min: item.dato.yMin, max: item.dato.yMax }),
        Math.max(alturaMediana * 0.5, 10)
    );

    // Limites de cada fila/columna = punto medio hacia la banda vecina
    // (o borde de pagina en los extremos) -- asi cada celda "hereda"
    // el aire alrededor de su imagen, incluyendo el titulo/tabla de
    // texto que le pertenece de verdad. En catalogos muy densos el
    // bloque de texto de un producto (titulo + descripcion + tabla de
    // codigo/precio) puede ser mas alto que el hueco entre una foto y
    // la siguiente, asi que parte del texto puede terminar en la celda
    // vecina -- por eso la resolucion final marca 🟡/🔴 en vez de 🟢
    // cuando el texto de una celda no arma un producto limpio.
    const filasOrdenadas = filasImg.slice().sort((a, b) => b.max - a.max);
    const limitesFila = calcularLimites(filasOrdenadas, 3000, -500);

    const celdas = [];
    filasOrdenadas.forEach((fila, indiceFila) => {
        const columnasImg = agruparEnBandas(
            fila.items,
            item => ({ min: item.dato.xMin, max: item.dato.xMax }),
            Math.max(anchoMediano * 0.5, 15)
        ).sort((a, b) => a.min - b.min);

        const limitesColumna = calcularLimites(columnasImg, -2000, ancho + 2000);

        columnasImg.forEach((columna, indiceColumna) => {
            celdas.push({
                yMin: limitesFila[indiceFila].min, yMax: limitesFila[indiceFila].max,
                xMin: limitesColumna[indiceColumna].min, xMax: limitesColumna[indiceColumna].max,
                lineas: [], imagenes: columna.items.map(i => i.dato)
            });
        });
    });

    // Cada linea de texto se asigna a la celda cuyo rectangulo contiene
    // su centro -- si por algun motivo no cae en ninguna (texto en un
    // margen sin imagenes cerca, ej. pie de pagina), se descarta en vez
    // de forzarla a una celda que no le corresponde.
    for (const linea of lineas) {
        const cx = (linea.xMin + linea.xMax) / 2;
        const cy = (linea.yMin + linea.yMax) / 2;
        const celda = celdas.find(c => cx >= c.xMin && cx <= c.xMax && cy >= c.yMin && cy <= c.yMax);
        if (celda) celda.lineas.push(linea);
    }

    return celdas.filter(c => c.lineas.length > 0 || c.imagenes.length > 0);
}

function mediana(valores) {
    const ordenados = valores.slice().sort((a, b) => a - b);
    const medio = Math.floor(ordenados.length / 2);
    return ordenados.length % 2 !== 0 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
}

// Convierte una lista de bandas (ordenadas de mayor a menor, o menor a
// mayor segun el eje) en limites que se tocan en el punto medio entre
// bandas vecinas, extendiendose hasta bordeExterior en los extremos.
function calcularLimites(bandas, bordeInicial, bordeFinal) {
    return bandas.map((banda, i) => {
        const anterior = i === 0 ? bordeInicial : (banda.min + bandas[i - 1].max) / 2;
        const siguiente = i === bandas.length - 1 ? bordeFinal : (banda.max + bandas[i + 1].min) / 2;
        return { min: Math.min(anterior, siguiente), max: Math.max(anterior, siguiente) };
    });
}

function segmentarCeldasPorTexto(lineas, imagenes) {
    const itemsTexto = lineas.map(l => ({ tipo: "texto", dato: l }));
    const itemsImagen = imagenes.map(img => ({ tipo: "imagen", dato: img }));
    const todos = [...itemsTexto, ...itemsImagen];

    if (todos.length === 0) return [];

    const alturaMedia = lineas.length
        ? lineas.reduce((s, l) => s + l.alto, 0) / lineas.length
        : 12;
    const HUECO_FILA = Math.max(alturaMedia * 1.8, 14);

    const rangoY = item => item.tipo === "texto"
        ? { min: item.dato.yMin, max: item.dato.yMax }
        : { min: item.dato.yMin, max: item.dato.yMax };

    const filas = agruparEnBandas(todos, rangoY, HUECO_FILA);

    const celdas = [];
    for (const fila of filas) {
        const HUECO_COL = 20;
        const rangoX = item => item.tipo === "texto"
            ? { min: item.dato.xMin, max: item.dato.xMax }
            : { min: item.dato.xMin, max: item.dato.xMax };

        const columnas = agruparEnBandas(fila.items, rangoX, HUECO_COL)
            .sort((a, b) => a.min - b.min);

        for (const columna of columnas) {
            const lineasCelda = columna.items.filter(i => i.tipo === "texto").map(i => i.dato);
            const imagenesCelda = columna.items.filter(i => i.tipo === "imagen").map(i => i.dato);
            if (lineasCelda.length === 0 && imagenesCelda.length === 0) continue;

            celdas.push({
                xMin: columna.min, xMax: columna.max,
                yMin: fila.min, yMax: fila.max,
                lineas: lineasCelda,
                imagenes: imagenesCelda
            });
        }
    }

    return celdas;
}

// ---------------------------------------------------------------------
// Resolucion de campos dentro de una celda -- nunca por orden de
// aparicion en el texto, siempre sobre las lineas ya asociadas a ESTA
// celda por contencion espacial.
// ---------------------------------------------------------------------
function resolverCelda(celda, plantilla) {
    const regexAprendido = plantilla?.regexCodigo || null;
    const bandaY = plantilla?.bandaYRelativa || null;
    const altoCelda = Math.max(celda.yMax - celda.yMin, 1);

    function posicionRelativa(linea) {
        // 0 = arriba de la celda, 1 = abajo (celda en espacio PDF: yMax=arriba)
        return (celda.yMax - linea.yMax) / altoCelda;
    }

    const candidatosCodigo = celda.lineas.filter(l => pareceCodigo(l.texto, regexAprendido));
    const candidatosPrecio = celda.lineas
        .map(l => ({ linea: l, precio: precioDeTexto(l.texto) }))
        .filter(c => c.precio);

    let codigo = null, confianzaCodigo = "baja";
    if (candidatosCodigo.length === 1) {
        codigo = candidatosCodigo[0].texto;
        confianzaCodigo = "alta";
    } else if (candidatosCodigo.length > 1) {
        let elegido = candidatosCodigo[0];
        if (bandaY?.codigo) {
            const [min, max] = bandaY.codigo;
            const enBanda = candidatosCodigo.find(l => {
                const pos = posicionRelativa(l);
                return pos >= min && pos <= max;
            });
            if (enBanda) elegido = enBanda;
        }
        codigo = elegido.texto;
        confianzaCodigo = "media";
    }

    let precioNumero = null, confianzaPrecio = "baja", precioTextoElegido = null;
    if (candidatosPrecio.length === 1) {
        precioNumero = candidatosPrecio[0].precio.numero;
        precioTextoElegido = candidatosPrecio[0].linea.texto;
        confianzaPrecio = candidatosPrecio[0].precio.fuerte ? "alta" : "media";
    } else if (candidatosPrecio.length > 1) {
        const fuertes = candidatosPrecio.filter(c => c.precio.fuerte);
        const pool = fuertes.length ? fuertes : candidatosPrecio;
        const elegido = pool.reduce((mayor, actual) =>
            (actual.linea.alto > mayor.linea.alto ? actual : mayor), pool[0]);
        precioNumero = elegido.precio.numero;
        precioTextoElegido = elegido.linea.texto;
        confianzaPrecio = "media";
    }

    const lineasUsadas = new Set([...candidatosCodigo.map(l => l.texto), ...candidatosPrecio.map(c => c.linea.texto)]);
    const lineasDescripcion = celda.lineas.filter(l => !lineasUsadas.has(l.texto));
    const descripcion = lineasDescripcion.map(l => l.texto).join(" ").trim();
    const confianzaDescripcion = descripcion ? (lineasDescripcion.length === 1 ? "alta" : "media") : "baja";

    let confianzaImagen = "baja";
    if (celda.imagenes.length === 1) confianzaImagen = "alta";
    else if (celda.imagenes.length > 1) confianzaImagen = "media";

    return {
        codigo, confianzaCodigo,
        descripcion, confianzaDescripcion,
        precioNumero, precioTexto: precioTextoElegido, confianzaPrecio,
        imagenesCandidatas: celda.imagenes, confianzaImagen,
        celda
    };
}

function estadoDeResolucion(resuelto) {
    if (!resuelto.codigo || !resuelto.descripcion) return "no_identificado";
    const confianzas = [resuelto.confianzaCodigo, resuelto.confianzaDescripcion, resuelto.confianzaPrecio, resuelto.confianzaImagen];
    if (confianzas.every(c => c === "alta")) return "completo";
    if (!resuelto.precioNumero && resuelto.imagenesCandidatas.length === 0) return "revision";
    return "revision";
}

// ---------------------------------------------------------------------
// Recorte + compresion de imagen -- mismo patron que comprimirImagen en
// banco-imagenes-server.js (resize + JPEG calidad 72), aplicado sobre
// el recorte extraido del raster de la pagina.
// ---------------------------------------------------------------------
async function recortarImagenCelda(rasterBuffer, bboxPdf, escala, altoPaginaPt, anchoRasterPx, altoRasterPx) {
    const left = Math.max(0, Math.round(bboxPdf.xMin * escala));
    const top = Math.max(0, Math.round((altoPaginaPt - bboxPdf.yMax) * escala));
    const width = Math.min(anchoRasterPx - left, Math.max(1, Math.round((bboxPdf.xMax - bboxPdf.xMin) * escala)));
    const height = Math.min(altoRasterPx - top, Math.max(1, Math.round((bboxPdf.yMax - bboxPdf.yMin) * escala)));

    if (width <= 0 || height <= 0) return null;

    const { data, info } = await sharp(rasterBuffer)
        .extract({ left, top, width, height })
        .resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer({ resolveWithObject: true });

    return { buffer: data, ancho: info.width, alto: info.height };
}

// ---------------------------------------------------------------------
// Desambiguacion con IA -- solo se llama cuando ya hay candidatos
// concretos y son ambiguos entre si. Respuesta validada estrictamente
// contra el rango de candidatos reales (mismo criterio que
// /ia/sugerir-mapeo-catalogo en ia-server.js): el modelo nunca puede
// inventar algo fuera de la lista.
// ---------------------------------------------------------------------
async function desambiguarImagenConIA(anthropic, candidatosBuffers, contextoTexto) {
    if (!anthropic || candidatosBuffers.length < 2) return -1;

    try {
        const bloquesImagen = candidatosBuffers.map((buffer, indice) => ([
            { type: "text", text: `Imagen ${indice}:` },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buffer.toString("base64") } }
        ])).flat();

        const respuesta = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 20,
            system: "Ayudas a identificar la foto de producto correcta en un catalogo de ferreteria. Se te da el texto (codigo/descripcion) de un producto y varias imagenes candidatas encontradas cerca de ese texto en la misma pagina. Responde UNICAMENTE con un JSON {\"indice\": N} donde N es el indice (empezando en 0) de la imagen que mejor corresponde a ese producto. Si ninguna corresponde con confianza, responde {\"indice\": -1}. Nunca inventes un indice fuera del rango dado.",
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: `Producto: ${contextoTexto || "(sin texto)"}` },
                    ...bloquesImagen
                ]
            }]
        });

        const texto = respuesta.content.filter(b => b.type === "text").map(b => b.text).join("");
        const coincidencia = texto.match(/-?\d+/);
        const indice = coincidencia ? Number(coincidencia[0]) : -1;

        return (Number.isInteger(indice) && indice >= 0 && indice < candidatosBuffers.length) ? indice : -1;
    } catch (error) {
        return -1;
    }
}

async function desambiguarTextoConIA(anthropic, candidatosTexto, campo, contexto) {
    if (!anthropic || candidatosTexto.length < 2) return -1;

    try {
        const respuesta = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 20,
            system: `Ayudas a identificar el ${campo} correcto de un producto en un catalogo de ferreteria. Se te dan varios candidatos de texto encontrados en la misma celda del catalogo. Responde UNICAMENTE con un JSON {"indice": N} (N empieza en 0) del candidato correcto, o {"indice": -1} si ninguno corresponde con confianza. Nunca inventes un indice fuera del rango dado.`,
            messages: [{
                role: "user",
                content: `Contexto: ${contexto || "(sin contexto)"}\n\nCandidatos:\n${candidatosTexto.map((c, i) => `${i}. ${c}`).join("\n")}`
            }]
        });

        const texto = respuesta.content.filter(b => b.type === "text").map(b => b.text).join("");
        const coincidencia = texto.match(/-?\d+/);
        const indice = coincidencia ? Number(coincidencia[0]) : -1;

        return (Number.isInteger(indice) && indice >= 0 && indice < candidatosTexto.length) ? indice : -1;
    } catch (error) {
        return -1;
    }
}

// ---------------------------------------------------------------------
// Orquestacion principal -- procesa el PDF pagina por pagina.
// ---------------------------------------------------------------------
async function extraerCatalogoPDF(rutaPdf, opciones = {}) {
    const {
        plantilla = null,
        limiteLlamadasIA = 60,
        onProgreso = null,
        anthropic: anthropicInyectado = null
    } = opciones;

    const anthropic = anthropicInyectado !== undefined ? anthropicInyectado : obtenerAnthropicPdf();
    const pdfjsLib = await cargarPdfjs();
    const fabricaCanvas = crearFabricaCanvasPdf();

    const datos = new Uint8Array(fs.readFileSync(rutaPdf));
    const doc = await pdfjsLib.getDocument({
        data: datos,
        CanvasFactory: function () { return fabricaCanvas; },
        disableFontFace: true,
        useSystemFonts: false,
        standardFontDataUrl: RUTA_FUENTES_ESTANDAR
    }).promise;

    const totalPaginas = doc.numPages;
    const productos = [];
    let llamadasIA = 0;
    let ocrWorker = null;

    const ESCALA = 2.0; // ~144dpi -- suficiente para OCR y recorte nitido sin gastar tiempo de mas

    try {
        for (let numeroPagina = 1; numeroPagina <= totalPaginas; numeroPagina++) {
            const page = await doc.getPage(numeroPagina);
            const viewport = page.getViewport({ scale: ESCALA });
            const altoPaginaPt = page.view[3] - page.view[1];

            const textContent = await page.getTextContent();
            const esEscaneada = paginaPareceEscaneada(textContent.items);

            const { canvas, context } = fabricaCanvas.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
            await page.render({ canvasContext: context, viewport, canvasFactory: fabricaCanvas }).promise;
            const rasterBuffer = canvas.toBuffer("image/png");
            const anchoRasterPx = canvas.width;
            const altoRasterPx = canvas.height;

            let lineas;
            if (esEscaneada) {
                if (!ocrWorker) {
                    const Tesseract = require("tesseract.js");
                    ocrWorker = await Tesseract.createWorker("spa");
                }
                lineas = await lineasPorOCR(ocrWorker, rasterBuffer, ESCALA, altoPaginaPt);
            } else {
                lineas = agruparLineasDeTexto(textContent.items);
            }

            const imagenesBbox = await extraerBboxImagenesNativas(page, pdfjsLib);
            const anchoPaginaPt = page.view[2] - page.view[0];
            const celdas = segmentarCeldas(lineas, imagenesBbox, anchoPaginaPt);

            for (const celda of celdas) {
                const resuelto = resolverCelda(celda, plantilla);
                if (!resuelto.codigo && !resuelto.descripcion && resuelto.imagenesCandidatas.length === 0) continue;

                let indiceImagenElegida = resuelto.imagenesCandidatas.length === 1 ? 0 : -1;

                if (resuelto.imagenesCandidatas.length >= 2 && llamadasIA < limiteLlamadasIA && anthropic) {
                    const buffersCandidatos = [];
                    for (const bbox of resuelto.imagenesCandidatas.slice(0, 3)) {
                        const recorte = await recortarImagenCelda(rasterBuffer, bbox, ESCALA, altoPaginaPt, anchoRasterPx, altoRasterPx);
                        if (recorte) buffersCandidatos.push(recorte.buffer);
                    }
                    if (buffersCandidatos.length >= 2) {
                        llamadasIA++;
                        const contextoTexto = [resuelto.codigo, resuelto.descripcion].filter(Boolean).join(" - ");
                        const indice = await desambiguarImagenConIA(anthropic, buffersCandidatos, contextoTexto);
                        if (indice >= 0) {
                            indiceImagenElegida = indice;
                            resuelto.confianzaImagen = "media";
                        }
                    }
                }

                let imagenBuffer = null, imagenAncho = null, imagenAlto = null;
                if (indiceImagenElegida >= 0) {
                    const bboxElegido = resuelto.imagenesCandidatas[indiceImagenElegida];
                    const recorte = await recortarImagenCelda(rasterBuffer, bboxElegido, ESCALA, altoPaginaPt, anchoRasterPx, altoRasterPx);
                    if (recorte) {
                        imagenBuffer = recorte.buffer;
                        imagenAncho = recorte.ancho;
                        imagenAlto = recorte.alto;
                    }
                }
                if (indiceImagenElegida < 0 && resuelto.imagenesCandidatas.length === 0) {
                    resuelto.confianzaImagen = "baja";
                }

                productos.push({
                    codigo: resuelto.codigo || "",
                    descripcion: resuelto.descripcion || "",
                    precio: resuelto.precioNumero,
                    imagenBuffer, imagenAncho, imagenAlto, imagenTipo: imagenBuffer ? "image/jpeg" : null,
                    paginaPdf: numeroPagina,
                    confianzaCodigo: resuelto.confianzaCodigo,
                    confianzaDescripcion: resuelto.confianzaDescripcion,
                    confianzaPrecio: resuelto.confianzaPrecio,
                    confianzaImagen: imagenBuffer ? resuelto.confianzaImagen : "baja",
                    estadoExtraccion: estadoDeResolucion(resuelto)
                });
            }

            fabricaCanvas.destroy({ canvas, context });

            if (typeof onProgreso === "function") {
                await onProgreso(numeroPagina, totalPaginas);
            }
        }
    } finally {
        if (ocrWorker) await ocrWorker.terminate();
    }

    return { totalPaginas, productos, llamadasIA };
}

module.exports = {
    extraerCatalogoPDF,
    agruparLineasDeTexto,
    paginaPareceEscaneada,
    extraerBboxImagenesNativas,
    segmentarCeldas,
    resolverCelda,
    estadoDeResolucion,
    pareceCodigo,
    precioDeTexto,
    desambiguarImagenConIA,
    desambiguarTextoConIA,
    obtenerAnthropicPdf
};

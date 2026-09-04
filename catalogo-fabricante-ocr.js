// Lectura de las tablas de precio de un catalogo de fabricante que se
// publica como imagen (TRUPER publica cada "modulo" del catalogo como un
// JPG con la tabla rasterizada -- no hay precios en texto en ninguna
// parte del sitio).
//
// Modulo puro (sin Express y sin red): recibe buffers y regresa filas,
// para poder probarlo con `node --test` sin salir a internet.
//
// Filosofia (la misma que catalog-pdf-extractor.js, pedida por el dueno):
// procesamiento tradicional primero. Aqui la imagen NUNCA trae texto
// nativo, asi que OCR (tesseract.js) es el camino primario -- y alcanza:
// probado contra el modulo 29901 real leyo "103013 PMU-8PX $335 $365
// $400" exacto. La IA no genera valores desde cero en ningun caso.
//
// La confiabilidad no viene del OCR sino del CRUCE: el llamador trae la
// lista de codigos esperados del modulo desde una fuente en texto (en
// TRUPER, el endpoint ficha/fichas) y esta capa rechaza el modulo
// completo si lo leido no concuerda.

const crypto = require("crypto");
const sharp = require("sharp");

// Tesseract lee bastante mejor con la imagen ampliada; x3 fue lo que dio
// lectura exacta en la prueba contra el modulo real.
const FACTOR_AMPLIACION = 3;

// --- Localizacion de la(s) tabla(s) del modulo ---
//
// Historia de dos intentos fallidos, para que nadie los repita:
//
// 1) Recortar una fraccion fija del pie. Falla porque los modulos no
//    tienen proporciones parecidas: 29901 es 840x784 con la tabla al 78%
//    de altura, 58101 es 833x524 al 44%, 21302 es 1666x464 al 30%.
//    Cortaba tablas enteras.
// 2) Buscar la barra negra del encabezado por pixeles. Falla porque el
//    catalogo usa DOS estilos de encabezado (barra negra completa, o solo
//    el rotulo "Codigo" en negro sobre fondo blanco) y porque las fotos
//    oscuras de producto disparan falsos positivos. Medido sobre 94
//    modulos reales: 27 quedaban sin localizar y el acierto era 24%.
//
// Lo que si funciona (41% con el mismo OCR): la tabla es SIEMPRE el pie
// del modulo, asi que se toma una zona inferior amplia y no se intenta
// afinar el borde superior. Lo unico que de verdad hace falta detectar es
// la division vertical: un modulo de doble ancho lleva dos tablas lado a
// lado separadas por un pasillo blanco, y sin separarlas el OCR junta la
// fila izquierda con la derecha y salen 6 precios donde van 3.
const UMBRAL_PIXEL_OSCURO = 100;
// Umbral mas permisivo para "hay algo aqui" (texto gris, bordes de celda)
// al proyectar el contenido de la tabla sobre el eje horizontal.
const UMBRAL_PIXEL_CLARO = 200;
// Fraccion minima de alto con contenido para que una columna de pixeles
// cuente como parte de una tabla y no como pasillo.
const FRACCION_MIN_CONTENIDO = 0.02;
// Ancho minimo para aceptar una region como tabla independiente.
const ANCHO_MIN_TABLA = 0.15;
// Desde que altura se considera "zona de tabla". La tabla es siempre el
// pie del modulo; se deja margen de sobra porque en los modulos apaisados
// puede empezar cerca del 30% y cortarla pierde el encabezado entero.
const FRACCION_ZONA_TABLA = 0.25;
// Cuanto texto se mira DESPUES de la palabra "Excepto" para encontrar los
// codigos excluidos. La maqueta parte el rotulo en dos renglones
// ("Excepto:" y debajo "19061"), asi que mirar solo el resto de la linea
// no encuentra nada. 60 caracteres cubren el rotulo sin alcanzar la
// primera fila de la tabla.
const VENTANA_EXCEPCION = 60;

// ---------------------------------------------------------------------
// Normalizacion de valores
// ---------------------------------------------------------------------

// TRUPER marca algunos codigos con "*" (nota al pie del catalogo). El
// asterisco no es parte de la identidad del producto.
function normalizarCodigo(texto) {
    return String(texto || "").trim().replace(/[*+]+$/, "").trim();
}

// El OCR pega al SKU los adornos de la maqueta (ej. el punto verde de
// "producto nuevo" sale como una "e" al final: PMU-8EX -> PMU-8EXe).
// Se limpia lo evidente, pero la clave AUTORITATIVA siempre es la que
// viene de la fuente en texto, no esta.
function normalizarClave(texto) {
    return String(texto || "")
        .trim()
        .replace(/[^A-Za-z0-9/.\-]+$/, "")
        .toUpperCase();
}

// "$1,234.50" -> 1234.5 | "$335" -> 335 | basura -> null
function precioDeTexto(texto) {
    const limpio = String(texto || "").replace(/\s+/g, "");
    const match = limpio.match(/^\$?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)$/);
    if (!match) return null;
    const valor = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(valor) || valor <= 0) return null;
    return valor;
}

// ---------------------------------------------------------------------
// Deteccion de columnas de precio desde el encabezado
//
// No se asume un orden fijo: se lee el encabezado real de la tabla y se
// arma el orden de columnas a partir de el. Si manana TRUPER invierte
// "Mayoreo" y "Publico", esto lo sigue leyendo bien en vez de guardar los
// precios cruzados en silencio.
// ---------------------------------------------------------------------

// El orden importa: los patrones mas especificos van primero para que
// "1/2 Mayoreo" no lo capture el patron de "Mayoreo".
//
// Los encabezados vienen completos en unos modulos ("Mayoreo", "1/2
// Mayoreo", "Publico") y abreviados en otros ("May.", "1/2 May.",
// "Pub."), asi que los patrones aceptan ambas formas.
const PATRONES_COLUMNA = [
    // El OCR representa "½" de muchas formas segun la resolucion:
    // "1/2 Mayoreo", "½ May.", "/2May." (se come el 1 y pega la palabra),
    // "V2 May", "Y2 May". Todas deben caer en medio mayoreo.
    { campo: "precio_medio_mayoreo", patron: /(?:1\s*\/\s*2|\/\s*2|½|\b[vy]2\b|\bmedio\b)\s*may/i },
    { campo: "precio_mayoreo", patron: /\bmay(?:oreo)?\b\.?/i },
    { campo: "precio_publico", patron: /\bp[uú]b(?:lico)?\b\.?/i },
    { campo: "precio_distribuidor", patron: /\bdistr(?:ibuidor)?\b\.?/i }
];

function detectarColumnasPrecio(lineaEncabezado) {
    const texto = String(lineaEncabezado || "");
    const encontrados = [];

    for (const { campo, patron } of PATRONES_COLUMNA) {
        const match = texto.match(patron);
        if (!match) continue;
        // Se ordenan por posicion horizontal en el encabezado, que es el
        // mismo orden en que apareceran los importes en cada fila.
        encontrados.push({ campo, indice: match.index });
    }

    // "1/2 Mayoreo" tambien hace match con /\bmayoreo\b/ en la MISMA
    // posicion del texto; se descarta el duplicado que cae dentro del
    // tramo ya reclamado por medio mayoreo.
    const medio = encontrados.find(c => c.campo === "precio_medio_mayoreo");
    const filtrados = encontrados.filter(c => {
        if (!medio || c.campo !== "precio_mayoreo") return true;
        return !(c.indice >= medio.indice && c.indice <= medio.indice + 12);
    });

    return filtrados.sort((a, b) => a.indice - b.indice).map(c => c.campo);
}

function esLineaEncabezado(linea) {
    return /c[oó]digo/i.test(linea) && /(\bmay|\bp[uú]b|\bdistr)/i.test(linea);
}

// ---------------------------------------------------------------------
// Parseo de la tabla ya convertida a texto
// ---------------------------------------------------------------------

// Una fila util empieza con el codigo del fabricante. En TRUPER el codigo
// es numerico de 4 a 8 digitos, a veces seguido de una marca de nota al
// pie. Esa marca es "*" en la maqueta, pero el OCR la devuelve como "x",
// "+", "." o similar segun la resolucion; se toleran hasta dos caracteres
// de ruido pegados. Sin esto, una fila real como "103012x PMU-8EX ..."
// simplemente no matcheaba y el producto desaparecia de la lectura.
const REGEX_INICIO_FILA = /^\s*(\d{4,8})[^\s\d]{0,2}\s+(\S+)?/;

/**
 * Parte un renglon que trae VARIOS productos.
 *
 * Hay modulos maquetados con dos o tres tablas lado a lado. Cuando los
 * pasillos entre ellas no son lo bastante blancos para separarlas por
 * pixeles --se midieron al 4% de contenido contra un umbral del 2%,
 * porque las franjas grises de las filas los cruzan-- el OCR entrega las
 * tres tablas juntas en la misma linea:
 *
 *   13182 D-1408-L $35 $38 $42 4  13156 D-1408 $25 $27 $30 4  100875 ...
 *
 * Antes se buscaba UNA sola ancla al principio del renglon: se encontraba
 * el primer codigo, se contaban 9 importes donde se esperaban 3, y la fila
 * salia incompleta. Los otros dos productos ni se buscaban. Son 188
 * modulos y ~1.100 productos.
 *
 * Se resuelve aqui y no en el recorte de la imagen a proposito: mover los
 * umbrales de deteccion de pasillos arriesga los 7.496 modulos que ya se
 * leen bien, y esto ademas sirve para dos, tres o las que sean.
 */
function partirEnProductos(linea, anclas) {
    // Sin lista autoritativa no hay nada que partir: el renglon se procesa
    // igual que siempre y el llamador usa REGEX_INICIO_FILA.
    if (!anclas || anclas.length === 0) return [{ codigo: "", texto: linea }];

    const encontradas = [];

    for (const codigo of anclas) {
        let desde = 0;
        let pos;
        while ((pos = linea.indexOf(codigo, desde)) >= 0) {
            desde = pos + 1;

            // Rodeado de digitos es un tramo de otro numero mas largo, no
            // el codigo: "13156" dentro de "131567".
            const antes = pos > 0 ? linea[pos - 1] : "";
            const despues = linea[pos + codigo.length] || "";
            if (/\d/.test(antes) || /\d/.test(despues)) continue;

            // Las anclas vienen de mayor a menor longitud, asi que si esta
            // posicion ya la reclamo un codigo mas largo, este es un
            // pedazo suyo.
            const solapa = encontradas.some(e =>
                pos < e.pos + e.codigo.length && e.pos < pos + codigo.length);
            if (solapa) continue;

            encontradas.push({ codigo, pos });
        }
    }

    if (encontradas.length === 0) return [{ codigo: "", texto: linea }];

    encontradas.sort((a, b) => a.pos - b.pos);

    // Un solo producto: se entrega el renglon COMPLETO, igual que antes de
    // este cambio. Recortarlo desde el codigo cambiaria el comportamiento
    // de los modulos que ya funcionan, y no hay razon para hacerlo.
    if (encontradas.length === 1) {
        return [{ codigo: encontradas[0].codigo, texto: linea, pos: encontradas[0].pos }];
    }

    // Varios: cada uno se queda con su tramo, desde su codigo hasta el
    // codigo del siguiente. Asi los importes de cada producto son los
    // suyos y no los de sus vecinos.
    return encontradas.map((e, i) => ({
        codigo: e.codigo,
        pos: e.pos,
        texto: linea.slice(e.pos, i + 1 < encontradas.length ? encontradas[i + 1].pos : undefined)
    }));
}

// ---------------------------------------------------------------------
// Tablas TRANSPUESTAS
//
// Una parte del catalogo no lista un producto por fila, sino un producto
// por COLUMNA: la primera columna trae las etiquetas y cada producto es
// una columna a la derecha.
//
//   Código:     18024   15481   15480   102634
//   Clave:      LLCR-20D LLCR-20 LLCR-18 LLCR-16
//   Mayoreo:    $255    $255    $235    $225
//   ½ Mayoreo:  $280    $280    $255    $245
//   Público:    $310    $310    $280    $270
//
// Con el parseo por filas estos modulos daban cero productos (la linea
// "Código:" tiene todos los codigos juntos y ninguna linea tiene un
// codigo seguido de sus tres precios).
// ---------------------------------------------------------------------

// Detecta el layout mirando si UNA sola linea concentra varios de los
// codigos que la fuente en texto dice que tiene el modulo.
function pareceTablaTranspuesta(lineas, codigosEsperados) {
    if (!codigosEsperados || codigosEsperados.length < 2) return false;

    return lineas.some(linea => {
        if (!/c[oó]digo/i.test(linea)) return false;
        const presentes = codigosEsperados.filter(c => linea.includes(c));
        return presentes.length >= 2;
    });
}

// Hay modulos donde un bloque entero de productos comparte UN solo
// renglon de precio al pie ("Colores estandar: 30 claves, Mayoreo $60 /
// ½ Mayoreo $66 / Publico $73"), a veces con excepciones marcadas
// ("Excepto: 19061"). Ahi no hay un precio por producto que leer, y
// repartir el del bloque daria un catalogo lleno de precios plausibles y
// equivocados. Se reconocen porque hay muchos codigos y muy pocos
// importes, y se mandan a revision manual sin gastar una llamada de
// vision (el modelo tiende a "razonar" que el precio aplica a todos).
function parecePrecioPorBloque(texto, codigosEsperados) {
    const codigos = (codigosEsperados || []).map(normalizarCodigo).filter(Boolean);
    if (codigos.length < 3) return false;

    // Sin NINGUN importe en todo el texto no hay "precio del bloque" que
    // repartir: eso es una columna de precio vacia en el catalogo (o un
    // OCR que no leyo nada), y se trata aparte. Lo que define a este
    // layout es que el precio existe, pero fuera de las filas de producto.
    if (!/\$\d/.test(texto)) return false;

    const lineas = String(texto || "").split(/\r?\n/);

    // La tabla transpuesta tampoco lleva importes en la linea de codigos,
    // pero si tiene un precio por producto: es otro layout y se parsea
    // aparte, asi que no debe caer aqui.
    if (pareceTablaTranspuesta(lineas, codigos)) return false;

    const lineasConCodigo = lineas.filter(linea => codigos.some(c => linea.includes(c)));
    if (lineasConCodigo.length < 3) return false;

    // La senal es tajante: si NINGUNA fila de producto trae un importe,
    // el precio no esta por producto. Basta con que una lo traiga para
    // asumir que el layout si es por fila y que al OCR solo se le
    // escaparon algunos.
    return lineasConCodigo.every(linea => !/\$\d/.test(linea));
}

// Importes de una linea, en orden de aparicion.
function importesDeLinea(linea) {
    return (linea.match(/\$\d[\d,]*(?:\.\d{1,2})?/g) || [])
        .map(precioDeTexto)
        .filter(valor => valor !== null);
}

function parsearTablaTranspuesta(lineas, opciones) {
    const esperados = [...(opciones.codigosEsperados || [])].map(normalizarCodigo).filter(Boolean);
    const avisos = [];

    // Fila de codigos: la que mas codigos esperados contiene.
    let lineaCodigos = null;
    let mejor = 0;
    for (const linea of lineas) {
        const n = esperados.filter(c => linea.includes(c)).length;
        if (n > mejor) {
            mejor = n;
            lineaCodigos = linea;
        }
    }
    if (!lineaCodigos) return { columnas: [], filas: [], avisos };

    // Orden real de los codigos, por su posicion horizontal en la linea.
    const codigos = esperados
        .filter(c => lineaCodigos.includes(c))
        .map(c => ({ codigo: c, posicion: lineaCodigos.indexOf(c) }))
        .sort((a, b) => a.posicion - b.posicion)
        .map(c => c.codigo);

    // Una linea de precio por nivel: "Mayoreo:", "½ Mayoreo:", "Público:".
    const columnas = [];
    const preciosPorCampo = new Map();

    for (const linea of lineas) {
        const importes = importesDeLinea(linea);
        if (importes.length === 0) continue;

        for (const { campo, patron } of PATRONES_COLUMNA) {
            if (preciosPorCampo.has(campo)) continue;
            if (!patron.test(linea)) continue;
            // "1/2 Mayoreo" tambien casa con el patron de "Mayoreo": si ya
            // se reconocio como medio mayoreo, no se reusa la misma linea.
            if (campo === "precio_mayoreo" && PATRONES_COLUMNA[0].patron.test(linea)) continue;

            preciosPorCampo.set(campo, importes);
            columnas.push(campo);
            break;
        }
    }

    const filas = codigos.map((codigo, indice) => {
        const precios = {};
        const faltantes = [];

        for (const campo of columnas) {
            const lista = preciosPorCampo.get(campo) || [];
            // Solo se acepta si la fila de precios tiene exactamente un
            // importe por producto; si no, el emparejamiento por posicion
            // seria adivinar.
            if (lista.length === codigos.length) precios[campo] = lista[indice];
            else faltantes.push(campo);
        }

        return {
            codigo,
            clave: "",
            precios,
            completa: columnas.length > 0 && faltantes.length === 0 && Object.keys(precios).length === columnas.length,
            motivo: faltantes.length
                ? `la fila de ${faltantes.join(", ")} no trae un importe por producto`
                : (columnas.length === 0 ? "no se encontro ninguna fila de precios" : "")
        };
    });

    return { columnas, filas, avisos, layout: "transpuesta" };
}

/**
 * Convierte el texto OCR de una tabla de modulo en filas normalizadas.
 * Reconoce los dos layouts del catalogo: un producto por fila (lo
 * habitual) y un producto por columna (tabla transpuesta).
 *
 * @param {string} textoOcr texto crudo devuelto por el OCR
 * @param {object} opciones
 * @param {string[]} [opciones.codigosEsperados] codigos de la fuente en texto
 * @param {string[]} [opciones.columnasForzadas] orden de columnas a usar
 *        si el encabezado no se pudo leer (ej. la variante que solo trae
 *        "Distribuidor" y a veces sale cortado)
 * @returns {{columnas: string[], filas: object[], avisos: string[]}}
 */
/**
 * Lee una tabla donde el precio va UNA VEZ por bloque, no por producto.
 *
 * Verificado a ojo contra el modulo 29801 (pinturas en aerosol): la pagina
 * trae cuatro bloques --estandar, metalicos, neon, altas temperaturas-- y
 * cada uno cierra con una barra de precio propia:
 *
 *     Colores metalicos
 *     Codigo  Clave     Color   Caja  Master
 *     12778   PAM-NE    Negro    4     48
 *     ...
 *     19061   PAM-VE    Verde    4     48
 *     ----------------------------------------
 *     Mayoreo    1/2 Mayoreo    Publico
 *     $78          $86            $96
 *
 * No tiene nada de ambiguo: los ocho colores metalicos cuestan eso.
 * Cualquiera que abra la pagina lo lee igual. Antes se mandaba el modulo
 * entero a revision manual por "estructura ambigua"; son 79 modulos y 501
 * productos, buena parte tornilleria, que es lo que mas rota en una
 * ferreteria.
 *
 * Reglas, en orden de importancia:
 *
 * 1. Un precio de mas es PEOR que un hueco, porque nadie lo nota hasta que
 *    cobras mal. Ante cualquier duda, el bloque se queda sin asignar.
 * 2. TRUPER marca las excepciones en la propia pagina ("Excepto: 19061").
 *    Esos codigos se excluyen del reparto y se quedan sin precio.
 * 3. Si un bloque termina sin barra de precio legible, sus productos NO
 *    heredan la barra del bloque siguiente: se descartan.
 */
function parsearPreciosPorBloque(textoOcr, opciones = {}) {
    const lineas = String(textoOcr || "").split(/\r?\n/);
    const avisos = [];

    const anclas = [...(opciones.codigosEsperados || [])]
        .map(normalizarCodigo)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    if (anclas.length === 0) {
        return { filas: [], avisos: ["sin codigos esperados no se puede repartir un precio por bloque"] };
    }

    const declaradas = Array.isArray(opciones.columnasForzadas) ? opciones.columnasForzadas : [];

    // Excepciones al precio del bloque. Vienen de dos sitios:
    //
    //  - opciones.excepcionesBloque, que el llamador saca de la zona
    //    grafica del modulo con leerExcepcionesDeBloque(). Ese es el
    //    camino BUENO: el rotulo "Excepto: 19061" se imprime arriba,
    //    junto al titulo del bloque, fuera del recorte de la tabla.
    //  - el propio texto de la tabla, por si el recorte alcanzo a
    //    incluirlo.
    //
    // Sin esto se asignaba $78 al 19061 del modulo 29801, que es justo el
    // producto que el catalogo excluye. Un precio de mas es peor que un
    // hueco: nadie lo nota hasta que cobras mal.
    const excluidos = new Set((opciones.excepcionesBloque || []).map(normalizarCodigo).filter(Boolean));
    for (const linea of lineas) {
        const marca = linea.match(/excep\w*\s*:?\s*(.+)$/i);
        if (!marca) continue;
        for (const numero of marca[1].match(/\d{4,8}/g) || []) {
            const codigo = normalizarCodigo(numero);
            if (anclas.includes(codigo)) excluidos.add(codigo);
        }
    }
    if (excluidos.size > 0) {
        avisos.push(`el catalogo marca ${excluidos.size} excepcion(es) al precio del bloque: ${[...excluidos].join(", ")}; se dejan sin precio`);
    }

    const filas = [];
    let columnas = declaradas.slice();
    let pendientes = [];

    const cerrarSinPrecio = motivo => {
        for (const codigo of pendientes) {
            filas.push({ codigo, clave: "", precios: {}, completa: false, motivo });
        }
        pendientes = [];
    };

    for (const linea of lineas) {
        const importes = (linea.match(/\$\d[\d,]*(?:\.\d{1,2})?/g) || [])
            .map(precioDeTexto)
            .filter(valor => valor !== null);

        const codigosAqui = [];
        for (const codigo of anclas) {
            const pos = linea.indexOf(codigo);
            if (pos < 0) continue;
            const antes = pos > 0 ? linea[pos - 1] : "";
            const despues = linea[pos + codigo.length] || "";
            if (/\d/.test(antes) || /\d/.test(despues)) continue;
            if (codigosAqui.includes(codigo)) continue;
            // Un codigo mas corto dentro de uno ya tomado es un pedazo suyo.
            if (codigosAqui.some(c => c.includes(codigo))) continue;
            codigosAqui.push(codigo);
        }

        // Aqui el encabezado va PARTIDO en dos lineas, y ninguna de las
        // dos es lo que esLineaEncabezado() reconoce (esa exige "Codigo" y
        // una palabra de precio en la MISMA linea):
        //
        //   Codigo  Clave  Color  Caja  Master      <- abre el bloque
        //   ...filas de producto, sin importes...
        //   Mayoreo  1/2 Mayoreo  Publico  MM  NC   <- rotulos de la barra
        //   $78        $86          $96      0   2  <- la barra
        //
        // La primera lleva "Codigo" y ninguna palabra de precio; la
        // segunda lleva las palabras de precio y ningun "Codigo".
        const abreBloque = codigosAqui.length === 0 && /c[oó]digo/i.test(linea);
        if (abreBloque) {
            // Un bloque nuevo con filas pendientes significa que no se
            // leyo la barra del anterior. Esos productos NO heredan el
            // precio del bloque que viene: se quedan sin precio.
            if (pendientes.length > 0) {
                avisos.push(`${pendientes.length} producto(s) quedaron sin barra de precio legible y no se les asigno ninguna`);
                cerrarSinPrecio("el bloque termino sin una barra de precio legible");
            }
            continue;
        }

        const rotulosBarra = codigosAqui.length === 0 && importes.length === 0
            ? detectarColumnasPrecio(linea)
            : [];
        if (rotulosBarra.length > 0) {
            columnas = rotulosBarra;
            continue;
        }

        // Fila de producto: en este layout NUNCA trae importe propio.
        if (codigosAqui.length > 0 && importes.length === 0) {
            pendientes.push(...codigosAqui);
            continue;
        }

        // Barra de precio del bloque: importes sin ningun codigo, y tantos
        // como columnas declaradas. Exigir el numero exacto evita tomar por
        // barra una nota al pie con un solo importe suelto.
        const esBarra = codigosAqui.length === 0
            && importes.length > 0
            && columnas.length > 0
            && importes.length === columnas.length;

        if (esBarra && pendientes.length > 0) {
            const precios = {};
            columnas.forEach((campo, indice) => { precios[campo] = importes[indice]; });

            for (const codigo of pendientes) {
                if (excluidos.has(codigo)) {
                    filas.push({
                        codigo, clave: "", precios: {}, completa: false,
                        motivo: "el catalogo lo marca como excepcion al precio del bloque"
                    });
                    continue;
                }
                filas.push({ codigo, clave: "", precios: { ...precios }, completa: true, motivo: "" });
            }
            pendientes = [];
        }
    }

    // Lo que quede al final no tuvo barra: sin precio.
    if (pendientes.length > 0) {
        avisos.push(`${pendientes.length} producto(s) quedaron sin barra de precio legible y no se les asigno ninguna`);
        cerrarSinPrecio("el bloque termino sin una barra de precio legible");
    }

    if (filas.some(f => f.completa)) {
        avisos.push("precios tomados de la barra comun de cada bloque, no de cada fila");
    }

    return { filas, avisos };
}

function parsearTablaPrecios(textoOcr, opciones = {}) {
    const lineas = String(textoOcr || "").split(/\r?\n/);
    const avisos = [];

    const esperadosNormalizados = [...(opciones.codigosEsperados || [])]
        .map(normalizarCodigo)
        .filter(Boolean);

    if (pareceTablaTranspuesta(lineas, esperadosNormalizados)) {
        return parsearTablaTranspuesta(lineas, { ...opciones, codigosEsperados: esperadosNormalizados });
    }

    const lineaEncabezado = lineas.find(esLineaEncabezado);
    let columnas = lineaEncabezado ? detectarColumnasPrecio(lineaEncabezado) : [];
    const declaradas = Array.isArray(opciones.columnasForzadas) ? opciones.columnasForzadas : [];

    if (columnas.length === 0 && declaradas.length) {
        columnas = declaradas.slice();
        avisos.push("encabezado no legible: se uso el orden de columnas declarado por el adaptador");
    }

    // El encabezado se lee mal mucho mas seguido que las filas: la
    // abreviatura "½ May." sale de formas que ningun patron cubre entero y
    // la columna de medio mayoreo se perdia, aunque el OCR SI hubiera
    // leido sus tres importes en cada fila (14 de 33 fallos medidos eran
    // exactamente esto). Si el encabezado da menos columnas de las que el
    // adaptador declara para esta variante, y las filas traen justo tantos
    // importes como columnas declaradas, se usan las declaradas: el conteo
    // de importes es la confirmacion de que no falta ninguna.
    if (declaradas.length > columnas.length) {
        const conteos = lineas
            .map(linea => (linea.match(/\$\d[\d,]*(?:\.\d{1,2})?/g) || []).length)
            .filter(n => n > 0);
        const cuadran = conteos.length > 0 && conteos.every(n => n === declaradas.length);

        if (cuadran) {
            avisos.push(
                `el encabezado solo dejo ver ${columnas.length} de ${declaradas.length} columnas; `
                + "se uso el orden declarado porque cada fila trae ese numero de importes"
            );
            columnas = declaradas.slice();
        }
    }

    const filas = [];
    // Cuantos productos compartieron precio en un mismo renglon, para
    // avisarlo una sola vez al final en vez de por cada fila.
    const avisosCompartidos = new Set();
    // Anclar por los codigos que la fuente en texto dice que tiene el
    // modulo es mucho mas robusto que confiar en que la linea empiece con
    // el numero: la maqueta antepone iconos a algunas filas (un ojo de
    // "producto destacado"), y con el regex esas filas se perdian enteras.
    // Se prueban de mayor a menor longitud para que un codigo que sea
    // prefijo de otro no gane primero.
    const anclas = [...(opciones.codigosEsperados || [])]
        .map(normalizarCodigo)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    for (const linea of lineas) {
        if (esLineaEncabezado(linea)) continue;

        const trozos = partirEnProductos(linea, anclas);

        // Renglon con VARIOS productos que comparten UN solo juego de
        // precios. Visto en el modulo 57906 (letras y numeros de laton):
        //
        //   Codigo Clave   | Codigo Clave    | Codigo Clave    | May. | 1/2May. | Pub.
        //   43292 NUCH-A   | 43268 NUCH-AS   | 43299 NUCH-AN   | $105 | $115    | $125
        //
        // Son tres acabados del mismo articulo --laton, niquel, negro-- y
        // cuestan lo mismo. Es el mismo principio del precio por bloque,
        // pero en horizontal.
        //
        // Se distingue del modulo de tres TABLAS lado a lado por el conteo
        // de importes, que es tajante:
        //   3 productos y 9 importes -> cada uno trae SU juego (tres tablas)
        //   3 productos y 3 importes -> UN juego compartido (este caso)
        // Por eso se exige el numero exacto de columnas: cualquier otra
        // cuenta no entra aqui y cae en el reparto normal por trozo.
        const importesLinea = (linea.match(/\$\d[\d,]*(?:\.\d{1,2})?/g) || [])
            .map(precioDeTexto)
            .filter(valor => valor !== null);

        // Los importes deben venir DESPUES del ultimo codigo del renglon.
        //
        // Sin esto, una linea como "40183 CUE-041K $22 3 ver 40184" --donde
        // el segundo numero es una mencion suelta, no un producto-- cumple
        // igual "varios codigos y un solo juego de precios", y el 40184
        // heredaba los $22 del 40183. Un precio EQUIVOCADO.
        //
        // En el compartido de verdad los importes cierran la fila, despues
        // de los tres codigos:
        //    43292 ... | 43268 ... | 43299 ... | $105 $115 $125
        const primerImporte = linea.search(/\$\d/);
        const ultimoCodigo = trozos.length > 0 ? trozos[trozos.length - 1].pos : -1;

        const precioCompartido = trozos.length > 1
            && columnas.length > 0
            && importesLinea.length === columnas.length
            && primerImporte > ultimoCodigo;

        if (precioCompartido) {
            avisosCompartidos.add(trozos.length);
        }

        for (const trozo of trozos) {

        let codigo = "";
        let resto = "";

        // Antes se exigia que el codigo estuviera en las primeras 6
        // posiciones del renglon. La intencion era buena --no confundir un
        // numero suelto de una columna mas a la derecha con el codigo del
        // producto-- pero descartaba filas legitimas: hay tablas con una
        // columna ANTES del codigo, como las cuerdas del modulo 54202:
        //
        //   Diametro    Codigo  Clave      Rendimiento  Capacidad
        //   4 mm (5/32) 40183   CUE-041K   125 m/kg     22 kg
        //
        // Ahi el codigo cae en la posicion 15 y la fila entera se perdia.
        //
        // La regla que si distingue los dos casos: lo que descalifica a un
        // codigo no es estar lejos del margen, es venir DESPUES de un
        // importe. Un "$" antes significa que ya se paso al territorio de
        // otro producto -- y ese caso lo resuelve partirEnProductos
        // partiendo el renglon, no esta comprobacion.
        const posicion = trozo.codigo ? trozo.texto.indexOf(trozo.codigo) : -1;
        const antesDelCodigo = posicion > 0 ? trozo.texto.slice(0, posicion) : "";
        const ancla = trozo.codigo && !/\$\d/.test(antesDelCodigo)
            ? trozo.codigo
            : "";

        if (ancla) {
            codigo = ancla;
            resto = trozo.texto.slice(trozo.texto.indexOf(ancla) + ancla.length);
        } else if (anclas.length > 0) {
            // Con la lista autoritativa del fabricante en la mano, una linea
            // que no corresponde a ninguno de sus codigos no es un producto:
            // es un numero de otra columna, o un codigo con un digito mal
            // leido. Inventarlo solo produce "codigos sobrantes" que tumban
            // la validacion del modulo entero. Si de verdad se perdiera un
            // producto, la validacion lo reporta igual como faltante.
            continue;
        } else {
            const inicio = linea.match(REGEX_INICIO_FILA);
            if (!inicio) continue;
            codigo = normalizarCodigo(inicio[1]);
            resto = linea.slice(inicio[0].length - (inicio[2] || "").length);
        }

        const clave = normalizarClave((resto.trim().split(/\s+/)[0] || ""));

        // Los importes siempre traen "$" pegado al numero en la maqueta;
        // exigirlo evita confundir medidas ("59 mm", "8 (20 cm)") y la
        // columna NC con precios. No se admite espacio despues del "$":
        // cuando el OCR pierde el importe deja "$ " suelto y el siguiente
        // numero de la fila (el NC) se colaria como precio.
        // Del TROZO, no del renglon: con tres tablas juntas, tomar los de
        // la linea entera daba 9 importes donde se esperaban 3.
        //
        // Salvo cuando el renglon trae UN solo juego de precios para todos
        // sus productos: ahi el juego es de la linea, no del trozo, y solo
        // el ultimo trozo lo tendria dentro.
        const importes = precioCompartido
            ? importesLinea
            : (trozo.texto.match(/\$\d[\d,]*(?:\.\d{1,2})?/g) || [])
                .map(precioDeTexto)
                .filter(valor => valor !== null);

        const fila = { codigo, clave, precios: {}, completa: true, motivo: "" };

        if (columnas.length === 0) {
            fila.completa = false;
            fila.motivo = "no se pudieron determinar las columnas de precio";
        } else if (importes.length !== columnas.length) {
            // Se prefiere marcar la fila incompleta a adivinar el mapeo:
            // un precio guardado en la columna equivocada es peor que un
            // precio faltante, porque nadie lo nota.
            fila.completa = false;
            fila.motivo = `se esperaban ${columnas.length} precios y se leyeron ${importes.length}`;
        } else {
            columnas.forEach((campo, indice) => {
                fila.precios[campo] = importes[indice];
            });
        }

        filas.push(fila);
        }
    }

    if (avisosCompartidos.size > 0) {
        const cuantos = [...avisosCompartidos].sort((a, b) => a - b).join("/");
        avisos.push(`hay renglones donde ${cuantos} productos comparten un mismo juego de precios`);
    }

    return { columnas, filas, avisos, layout: "filas" };
}

// ---------------------------------------------------------------------
// Validacion cruzada contra la fuente en texto
// ---------------------------------------------------------------------

/**
 * Compara lo leido por OCR contra los codigos que la fuente en texto dice
 * que tiene el modulo. Si no concuerdan, el modulo entero se rechaza: no
 * se escribe ni un solo precio.
 *
 * @param {object[]} filas salida de parsearTablaPrecios
 * @param {string[]} codigosEsperados codigos en texto (ficha/fichas)
 * @returns {{ok: boolean, motivo: string, faltantes: string[], sobrantes: string[]}}
 */
function validarContraFuenteTexto(filas, codigosEsperados) {
    const esperados = new Set((codigosEsperados || []).map(normalizarCodigo).filter(Boolean));
    const leidos = new Set(filas.map(f => f.codigo).filter(Boolean));

    if (esperados.size === 0) {
        return { ok: false, motivo: "la fuente en texto no devolvio codigos para este modulo", faltantes: [], sobrantes: [] };
    }

    const faltantes = [...esperados].filter(c => !leidos.has(c));
    const sobrantes = [...leidos].filter(c => !esperados.has(c));

    // SOBRAN codigos: el OCR leyo algo que no pertenece a este modulo.
    // Eso significa que la estructura se entendio mal, y una fila mal
    // partida puede haber pegado el precio de un producto al codigo de
    // otro. Se rechaza todo, como siempre.
    if (sobrantes.length > 0) {
        return {
            ok: false,
            parcial: false,
            motivo: `el OCR leyo ${sobrantes.length} codigo(s) que no son de este modulo`,
            faltantes,
            sobrantes
        };
    }

    // FALTAN codigos, pero ninguno sobra: se leyeron MENOS productos, no
    // productos equivocados. Cada fila que si se leyo tiene su codigo
    // confirmado contra la fuente en texto de TRUPER, asi que es tan de
    // fiar como la de un modulo completo.
    //
    // Antes esto tiraba el modulo entero. En la carga real eso costo 310
    // modulos, 113 de ellos por UN solo codigo faltante -- el 55301 leyo
    // 36 de 37 filas perfectas y se perdieron las 37.
    if (faltantes.length > 0) {
        return {
            ok: true,
            parcial: true,
            motivo: `se leyeron ${leidos.size} de ${esperados.size} productos del modulo`,
            faltantes,
            sobrantes: []
        };
    }

    return { ok: true, parcial: false, motivo: "", faltantes: [], sobrantes: [] };
}

// Coherencia interna de una fila: un mayoreo mas caro que el publico
// significa que las columnas se leyeron cruzadas. Se revisa aqui y no se
// "corrige" -- se reporta, porque corregirlo seria inventar.
function revisarCoherenciaPrecios(precios) {
    const { precio_mayoreo: may, precio_medio_mayoreo: medio, precio_publico: pub } = precios || {};
    const problemas = [];

    if (may != null && pub != null && may > pub) {
        problemas.push("mayoreo mayor que publico");
    }
    if (medio != null && pub != null && medio > pub) {
        problemas.push("medio mayoreo mayor que publico");
    }
    if (may != null && medio != null && may > medio) {
        problemas.push("mayoreo mayor que medio mayoreo");
    }

    return problemas;
}

// ---------------------------------------------------------------------
// Imagen -> texto
// ---------------------------------------------------------------------

// Hash del recorte YA normalizado (gris, ampliado, sin metadatos). Sirve
// para saltarse la reextraccion cuando el fabricante regenera el JPG sin
// cambiar la tabla -- caso real: TRUPER regenero todo mx-dis el 13-ago-2026
// y con solo mirar el ETag se habrian reextraido miles de modulos iguales.
function hashContenido(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Segmentos horizontales oscuros de una fila de pixeles, tolerando
// pequenos huecos (el texto blanco encima de la barra negra).
function segmentosOscuros(data, ancho, y, huecoMaximo) {
    const crudos = [];
    let inicio = null;
    let hueco = 0;

    for (let x = 0; x < ancho; x++) {
        if (data[y * ancho + x] < UMBRAL_PIXEL_OSCURO) {
            if (inicio === null) inicio = x;
            hueco = 0;
        } else if (inicio !== null) {
            hueco++;
            if (hueco > huecoMaximo) {
                crudos.push([inicio, x - hueco]);
                inicio = null;
                hueco = 0;
            }
        }
    }
    if (inicio !== null) crudos.push([inicio, ancho - 1]);

    return crudos.map(([ini, fin]) => {
        let oscuros = 0;
        for (let x = ini; x <= fin; x++) {
            if (data[y * ancho + x] < UMBRAL_PIXEL_OSCURO) oscuros++;
        }
        return {
            ini,
            fin,
            ancho: (fin - ini) / ancho,
            densidad: oscuros / (fin - ini + 1)
        };
    });
}

/**
 * Localiza la(s) tabla(s) del modulo buscando la barra negra del
 * encabezado. Devuelve una region por tabla; un modulo de doble ancho
 * devuelve dos.
 *
 * @returns {Promise<Array<{left:number, top:number, width:number, height:number}>>}
 */
// La zona de tabla sin dividir: un unico recorte del pie del modulo.
async function zonaTablaCompleta(bufferImagen) {
    const { width, height } = await sharp(bufferImagen).metadata();
    const top = Math.round(height * FRACCION_ZONA_TABLA);
    return [{ left: 0, top, width, height: height - top }];
}

async function detectarBandasTabla(bufferImagen) {
    const { data, info } = await sharp(bufferImagen).grayscale().raw()
        .toBuffer({ resolveWithObject: true });

    const ancho = info.width;
    const alto = info.height;
    if (!ancho || !alto) throw new Error("imagen de modulo ilegible");

    // Localizar la tabla buscando la barra negra del encabezado NO
    // funciona: el catalogo usa dos estilos (barra negra completa, o solo
    // el rotulo "Codigo" en negro sobre encabezado blanco) y ademas las
    // fotos oscuras de producto disparan falsos positivos. Medido sobre 94
    // modulos reales, ese metodo dejaba 27 sin localizar la tabla y
    // acertaba en el 24%; recortar sin mas la zona inferior sube al 41%.
    //
    // Asi que no se busca el encabezado: se toma una zona inferior amplia
    // (la tabla siempre es el pie del modulo) y se divide por pasillos
    // verticales blancos, que es lo unico que hace falta de verdad --
    // separar las dos tablas de un modulo de doble ancho para que el OCR
    // no junte la fila izquierda con la derecha.
    const filaBarra = Math.round(alto * FRACCION_ZONA_TABLA);
    const altoTabla = alto - filaBarra;
    const contenido = new Array(ancho).fill(0);
    for (let x = 0; x < ancho; x++) {
        let oscuros = 0;
        for (let y = filaBarra; y < alto; y++) {
            if (data[y * ancho + x] < UMBRAL_PIXEL_CLARO) oscuros++;
        }
        contenido[x] = oscuros / altoTabla;
    }

    const pasilloMinimo = Math.max(8, Math.round(ancho * 0.012));
    const regiones = [];
    let inicio = null;
    let blancos = 0;

    for (let x = 0; x < ancho; x++) {
        if (contenido[x] > FRACCION_MIN_CONTENIDO) {
            if (inicio === null) inicio = x;
            blancos = 0;
        } else if (inicio !== null) {
            blancos++;
            if (blancos > pasilloMinimo) {
                regiones.push([inicio, x - blancos]);
                inicio = null;
                blancos = 0;
            }
        }
    }
    if (inicio !== null) regiones.push([inicio, ancho - 1]);

    const anchas = regiones.filter(([ini, fin]) => (fin - ini) / ancho > ANCHO_MIN_TABLA);

    // Con una sola region no se gana nada recortando de lado: puede ser una
    // tabla que no llega al borde, o la zona de fotos. Se manda la franja
    // completa y el parseo filtra (se ancla en los codigos esperados y
    // exige "$" en los importes). Solo cuando hay DOS o mas regiones anchas
    // vale la pena separarlas, que es el caso del modulo de doble ancho.
    const tablas = anchas.length > 1 ? anchas : [[0, ancho - 1]];

    // Margen lateral para no comerse el primer/ultimo caracter de la
    // tabla al separar dos tablas contiguas. El corte de arriba no lleva
    // margen: ya es una zona amplia elegida con holgura.
    const margen = 3;
    return tablas.map(([ini, fin]) => {
        const left = Math.max(0, ini - margen);
        return {
            left,
            top: filaBarra,
            width: Math.min(ancho - left, fin - ini + 1 + margen * 2),
            height: alto - filaBarra
        };
    });
}

// Recorta y normaliza una region para que el OCR la lea lo mejor posible.
async function recortarRegion(bufferImagen, region, opciones = {}) {
    return sharp(bufferImagen)
        .extract(region)
        .resize({ width: region.width * (opciones.ampliacion ?? FACTOR_AMPLIACION) })
        .grayscale()
        .normalise()
        .sharpen()
        .png()
        .toBuffer();
}

/**
 * Devuelve un recorte listo para OCR por cada tabla del modulo.
 * @returns {Promise<Buffer[]>}
 */
async function recortarTablas(bufferImagen, opciones = {}) {
    // sinPartir: la zona de tabla entera, de un solo recorte. Es el
    // respaldo para cuando el pasillo detectado no separaba dos tablas
    // sino dos columnas de la misma.
    const regiones = opciones.sinPartir
        ? await zonaTablaCompleta(bufferImagen)
        : await detectarBandasTabla(bufferImagen);
    const recortes = [];
    for (const region of regiones) {
        recortes.push(await recortarRegion(bufferImagen, region, opciones));
    }
    return recortes;
}

// Workers de tesseract reutilizados entre modulos -- crearlos por cada
// imagen dominaria el tiempo total de una corrida de miles de modulos.
//
// Son VARIOS, y ese es el cambio que baja la carga de ~28 horas a unas
// pocas. Medido sobre modulos reales: bajar una imagen tarda 0.5s y
// leerla 1.8s, o sea que el 78% del tiempo es CPU. Con un solo worker,
// quince de los dieciseis nucleos miran.
//
// Por que 4 y no 16: cada worker de tesseract carga su propio motor y su
// diccionario. Cuatro caben de sobra; sesenta abririan la puerta a que la
// corrida muera por falta de memoria a las tres horas, que es peor que ir
// lento. Se puede subir con NEXO_OCR_WORKERS si la maquina da para mas.
const WORKERS_OCR = Math.max(1, Math.min(
    Number(process.env.NEXO_OCR_WORKERS) || 4,
    require("os").cpus().length
));

const libres = [];        // los que estan sin trabajo
const ocupados = new Set(); // los que alguien tiene ahora mismo
const enEspera = [];      // avisos para quien pidio uno y no habia
const retirados = new Set(); // marcados para morir en cuanto se devuelvan
let vivos = 0;            // creados y no terminados, incluidos los ocupados

function crearWorker() {
    vivos++; // se reserva el cupo YA, antes del await: si no, varias
             // tareas pasarian la comprobacion a la vez y crearian de mas
    const Tesseract = require("tesseract.js");
    return Tesseract.createWorker("spa").catch(error => {
        vivos--;
        throw error;
    });
}

function terminarWorker(worker) {
    retirados.delete(worker);
    vivos--;
    worker.terminate().catch(() => {});
}

function despertarUno() {
    const avisar = enEspera.shift();
    if (avisar) avisar();
}

// Se despierta al que espera SIN entregarle un worker: al despertar vuelve
// a mirar el estado. Entregarselo directo era mas corto, pero hacia
// imposible retirar un worker sin dejar colgado a quien lo esperaba.
async function tomarWorker() {
    for (;;) {
        while (libres.length > 0) {
            const worker = libres.pop();
            if (retirados.has(worker)) { terminarWorker(worker); continue; }
            ocupados.add(worker);
            return worker;
        }

        if (vivos < WORKERS_OCR) {
            const worker = await crearWorker();
            ocupados.add(worker);
            return worker;
        }

        await new Promise(resolve => enEspera.push(resolve));
    }
}

function devolverWorker(worker) {
    ocupados.delete(worker);
    if (retirados.has(worker)) terminarWorker(worker);
    else libres.push(worker);
    despertarUno();
}

/**
 * Recicla los workers para soltar la memoria que tesseract acumula, SIN
 * matar a los que estan leyendo ahora mismo.
 *
 * La version anterior de esto tumbaba la corrida. liberarWorkerOcr()
 * vaciaba la lista de espera, asi que las tareas que estaban formadas
 * esperando un worker se quedaban con una promesa que nadie iba a
 * resolver: nunca. Con un solo worker eso no existia (no habia fila);
 * el pool lo volvio mortal. Paso de verdad -- la carga se colgo a las
 * 3h30m con 4.998 de 7.574 unidades leidas, y el vigilante de los 15
 * minutos sin avance fue lo unico que la saco de ahi.
 *
 * Ahora se marcan y cada uno muere cuando lo devuelven.
 */
function reciclarWorkersOcr() {
    // Los que no estan haciendo nada mueren ya.
    for (const worker of libres.splice(0, libres.length)) terminarWorker(worker);
    // Los que estan leyendo se marcan y mueren cuando los devuelvan.
    for (const worker of ocupados) retirados.add(worker);
    // Y se despierta a los que esperaban: ahora hay cupo para nuevos.
    while (enEspera.length > 0) despertarUno();
}

// Compatibilidad: habia un unico worker y este era su nombre. Se conserva
// para no romper a nadie, pero toma uno del pool y hay que devolverlo.
async function obtenerWorkerOcr() {
    return tomarWorker();
}

// Apagado completo, para el final del proceso. A diferencia del reciclado,
// aqui si se tumba todo: ya no va a haber mas trabajo.
async function liberarWorkerOcr() {
    const aTerminar = libres.splice(0, libres.length);
    retirados.clear();
    vivos -= aTerminar.length;
    // A quien este esperando se le despierta para que no quede colgado.
    while (enEspera.length > 0) despertarUno();
    await Promise.all(aTerminar.map(w => w.terminate().catch(() => {})));
}

// ---------------------------------------------------------------------
// Respaldo con vision (solo cuando el OCR ya fallo)
//
// Mismo criterio que catalog-pdf-extractor.js: la IA NO genera valores
// desde cero ni reemplaza al OCR. Entra unicamente cuando la lectura
// tradicional ya no concuerda con la fuente en texto, se le dan los
// codigos que DEBE encontrar, y su resultado pasa por la misma validacion
// cruzada que el OCR. Si tampoco concuerda, el modulo va a revision
// manual igual. El tope de llamadas lo controla el llamador.
// ---------------------------------------------------------------------

const MODELO_VISION = "claude-haiku-4-5";

function construirPromptTabla(codigosEsperados, columnas) {
    return [
        "Esta imagen es la tabla de precios de un catalogo de ferreteria.",
        `Debe contener exactamente estos codigos: ${codigosEsperados.join(", ")}.`,
        columnas.length
            ? `Las columnas de precio, en orden, son: ${columnas.join(", ")}.`
            : "Identifica las columnas de precio por su encabezado.",
        "",
        "Devuelve SOLO un JSON con esta forma, sin texto alrededor:",
        '{"filas":[{"codigo":"103013","clave":"PMU-8PX","precios":{"precio_mayoreo":335,"precio_medio_mayoreo":365,"precio_publico":400}}]}',
        "",
        "Reglas estrictas:",
        "- Transcribe solo lo que se lee en la imagen. Si un precio no se distingue, omite ese campo.",
        "- No calcules, estimes ni completes precios que no esten impresos.",
        "- Ignora las columnas que no sean de precio (Caja, Master, NC, medidas).",
        "- Los importes llevan '$' en la imagen; devuelvelos como numero, sin simbolo.",
        // Hay modulos donde un bloque entero de productos comparte un unico
        // renglon de precio al pie, a veces con excepciones marcadas ("Excepto:
        // 19061"). Copiar ese precio a cada producto daria un catalogo lleno de
        // precios plausibles y equivocados, y pasaria la validacion porque los
        // codigos si coinciden. Preferimos no leer ese modulo.
        // Hay modulos con la tabla TRANSPUESTA: cada producto es una
        // COLUMNA y cada concepto un renglon. Sin decirselo, el modelo
        // obedecia al pie de la letra la regla de "misma fila" y devolvia
        // la tabla vacia -- verificado en el modulo 46603 (llaves de
        // bronce FOSET), donde la vision no rescataba ni un producto.
        "- La tabla puede venir TRANSPUESTA: cada producto en una COLUMNA, y cada concepto",
        "  (Codigo, Clave, Mayoreo, Publico) en un RENGLON. Ahi el precio de un producto es",
        "  el que cae en SU columna, en el renglon de ese precio.",
        "- En una tabla normal cada precio debe estar en la MISMA fila que su producto; en una",
        "  transpuesta, en la MISMA columna. Si un producto no tiene precio propio, omitelo",
        "  por completo.",
        "- Nunca copies el precio de otro producto, ni un precio que aparezca al pie de un",
        "  bloque como precio comun de varios productos."
    ].join("\n");
}

async function leerTablaConVision(anthropic, recortes, codigosEsperados, columnas) {
    const contenido = recortes.map(buffer => ({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: buffer.toString("base64") }
    }));
    contenido.push({ type: "text", text: construirPromptTabla(codigosEsperados, columnas) });

    const respuesta = await anthropic.messages.create({
        model: MODELO_VISION,
        max_tokens: 2000,
        messages: [{ role: "user", content: contenido }]
    });

    const texto = (respuesta.content || [])
        .filter(bloque => bloque.type === "text")
        .map(bloque => bloque.text)
        .join("");

    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) return [];

    let datos;
    try {
        datos = JSON.parse(match[0]);
    } catch (error) {
        return [];
    }

    return (datos.filas || []).map(fila => {
        const precios = {};
        for (const [campo, valor] of Object.entries(fila.precios || {})) {
            const numero = Number(valor);
            if (Number.isFinite(numero) && numero > 0) precios[campo] = numero;
        }

        // Una fila solo esta completa si trae TODAS las columnas de la
        // maqueta. Aceptar "al menos un precio" dejaba pasar lecturas a las
        // que les faltaba el medio mayoreo sin que nada lo notara: el
        // producto quedaba guardado con dos de sus tres precios y en el
        // reporte se veia perfecto.
        const faltantes = columnas.filter(campo => precios[campo] == null);

        return {
            codigo: normalizarCodigo(fila.codigo),
            clave: normalizarClave(fila.clave || ""),
            precios,
            completa: columnas.length > 0 && faltantes.length === 0,
            motivo: faltantes.length > 0
                ? `la lectura por vision no devolvio: ${faltantes.join(", ")}`
                : (columnas.length === 0 ? "no se sabe que columnas debia traer" : "")
        };
    });
}

/**
 * Pipeline completo de una imagen de modulo: recorte -> OCR -> parseo ->
 * validacion cruzada. No escribe nada; solo dice que se leyo y si es
 * confiable.
 *
 * @param {Buffer} bufferImagen JPG del modulo
 * @param {object} opciones
 * @param {string[]} opciones.codigosEsperados codigos de la fuente en texto
 * @param {string[]} [opciones.columnasForzadas] respaldo si no se lee el encabezado
 * @param {object} [opciones.ocr] inyeccion para pruebas: {recognize(buffer)}
 * @param {object} [opciones.anthropic] cliente de vision para el respaldo
 */
/**
 * Busca los avisos de excepcion al precio de bloque.
 *
 * TRUPER marca en la propia pagina que producto NO lleva el precio comun
 * ("Excepto: 19061", junto al titulo del bloque). Ese rotulo vive ARRIBA,
 * en la zona grafica del modulo, fuera del recorte de la tabla -- asi que
 * el OCR normal no lo ve nunca. Comprobado: el modulo 29801 asignaba $78
 * al 19061, que es justo el producto que el catalogo excluye.
 *
 * Se hace una lectura aparte de la imagen COMPLETA, y barata: no hay que
 * leer una tabla, solo cazar una palabra y unos numeros, asi que basta con
 * la mitad de la ampliacion normal. Solo corre en los modulos de precio
 * por bloque (79 de ~3.970), no en cada modulo del catalogo.
 */
async function leerExcepcionesDeBloque(bufferImagen, motor, codigosEsperados) {
    const anclas = (codigosEsperados || []).map(normalizarCodigo).filter(Boolean);
    if (anclas.length === 0) return { codigos: [], leido: false };

    const meta = await sharp(bufferImagen).metadata();
    const zona = await recortarRegion(
        bufferImagen,
        { left: 0, top: 0, width: meta.width, height: Math.round(meta.height * FRACCION_ZONA_TABLA) + 1 },
        { ampliacion: 2 }
    );

    const lectura = await motor.recognize(zona);
    const texto = String(lectura.texto || "");

    // El rotulo va en DOS renglones en la maqueta, no en uno:
    //
    //     Excepto:
    //     19061
    //
    // asi que no sirve mirar solo el resto de la linea. Se toma una
    // ventana del texto que sigue a la palabra y se sacan de ahi los
    // codigos que de verdad pertenecen a este modulo.
    const codigos = new Set();
    const patron = /excep\w*\s*:?/gi;
    let marca;
    while ((marca = patron.exec(texto)) !== null) {
        const ventana = texto.slice(marca.index + marca[0].length, marca.index + marca[0].length + VENTANA_EXCEPCION);
        for (const numero of ventana.match(/\d{4,8}/g) || []) {
            const codigo = normalizarCodigo(numero);
            if (anclas.includes(codigo)) codigos.add(codigo);
        }
    }

    return { codigos: [...codigos], leido: true };
}

async function extraerTablaDeModulo(bufferImagen, opciones = {}) {
    const recortes = await recortarTablas(bufferImagen, opciones);
    // El hash cubre todas las tablas del modulo: si cualquiera cambia, el
    // modulo se reprocesa.
    const hash = hashContenido(Buffer.concat(recortes));

    const motor = opciones.ocr || {
        recognize: async buffer => {
            // El worker se DEVUELVE pase lo que pase: si una imagen rara
            // hace fallar a tesseract y el worker se queda tomado, el pool
            // se va vaciando modulo a modulo hasta que la corrida se
            // cuelga esperando un turno que no llega.
            const worker = await tomarWorker();
            try {
                const { data } = await worker.recognize(buffer);
                return { texto: data.text, confianza: data.confidence };
            } finally {
                devolverWorker(worker);
            }
        }
    };

    // Cada tabla se lee por separado y se concatenan las filas. Leerlas
    // juntas mezclaria la fila izquierda con la derecha en un modulo de
    // doble ancho.
    const textos = [];
    const columnasVistas = [];
    const layoutsVistos = [];
    const filas = [];
    const avisos = [];
    let confianza = null;

    for (const recorte of recortes) {
        const lectura = await motor.recognize(recorte);
        textos.push(lectura.texto);
        if (lectura.confianza != null) {
            confianza = confianza === null ? lectura.confianza : Math.min(confianza, lectura.confianza);
        }

        const parseado = parsearTablaPrecios(lectura.texto, opciones);
        columnasVistas.push(parseado.columnas);
        layoutsVistos.push(parseado.layout);
        filas.push(...parseado.filas);
        avisos.push(...parseado.avisos);
    }

    let texto = textos.join("\n");
    // Se reportan las columnas de la primera tabla que las pudo determinar.
    let columnas = columnasVistas.find(c => c.length > 0) || [];

    // Respaldo: releer el modulo SIN partir en tablas.
    //
    // Partir por pasillos blancos es lo que salva a los modulos de doble
    // ancho, pero a veces el pasillo que encuentra no separa dos tablas
    // sino dos COLUMNAS de la misma. Visto en el 57906 (letras de laton):
    // se partia entre "May." y "1/2 May.", asi que un trozo se quedaba con
    // los codigos y un solo importe, y el otro con los dos importes
    // restantes y ningun codigo. Resultado: 0 de 39 productos, cuando sin
    // partir salen 30.
    //
    // Solo se intenta si la lectura partida NO alcanzo, y solo se adopta
    // si da mas filas completas. Un modulo que ya se lee bien no se toca.
    if (recortes.length > 1) {
        const completasPartido = filas.filter(f => f.completa).length;
        if (completasPartido < (opciones.codigosEsperados || []).length) {
            try {
                const [entera] = await recortarTablas(bufferImagen, { ...opciones, sinPartir: true });
                const lectura = await motor.recognize(entera);
                const parseado = parsearTablaPrecios(lectura.texto, opciones);
                const completasEntero = parseado.filas.filter(f => f.completa).length;

                if (completasEntero > completasPartido) {
                    avisos.push(
                        `el corte en ${recortes.length} tablas dejo ${completasPartido} filas completas; `
                        + `leido sin partir salen ${completasEntero}, se usa esa lectura`
                    );
                    filas.length = 0;
                    filas.push(...parseado.filas);
                    columnas = parseado.columnas.length > 0 ? parseado.columnas : columnas;
                    texto = lectura.texto;
                }
            } catch (error) {
                avisos.push(`no se pudo releer el modulo sin partir (${error.message})`);
            }
        }
    }


    function evaluar(filasEvaluadas) {
        for (const fila of filasEvaluadas) {
            const problemas = revisarCoherenciaPrecios(fila.precios);
            if (problemas.length > 0) {
                fila.completa = false;
                fila.motivo = problemas.join("; ");
            }
        }

        // Se valida sobre las filas COMPLETAS, no sobre todas.
        //
        // Antes bastaba UNA fila a la que le faltara un precio para tirar
        // el modulo entero: hay modulos reales donde se leyeron 52 de 54
        // filas perfectas y se perdieron las 54. Al validar solo las
        // completas, las incompletas caen solas del lado de "faltantes" y
        // el modulo queda parcial, que es lo que de verdad es.
        //
        // Cada fila que se acepta sigue teniendo su codigo confirmado
        // contra la fuente en texto y sus precios coherentes entre si. Que
        // OTRA fila del mismo modulo saliera mal no la contamina: el
        // parseo es por renglon, no arrastra de uno a otro.
        const completas = filasEvaluadas.filter(f => f.completa);
        const validacion = validarContraFuenteTexto(completas, opciones.codigosEsperados);

        return {
            validacion,
            // `utiles` es lo que se debe guardar. Puede ser menos que lo
            // leido, y esta bien: un hueco es mejor que un precio a medias.
            utiles: completas,
            confiable: validacion.ok && completas.length > 0
        };
    }

    let filasFinales = filas;
    let evaluacion = evaluar(filasFinales);
    let { validacion, confiable } = evaluacion;
    // Solo se guardan las filas completas: las que salieron a medias
    // cuentan como faltantes y dejan el modulo parcial.
    if (confiable) filasFinales = evaluacion.utiles;
    let origen = "ocr";

    // Respaldo con vision: solo si el OCR ya fallo y el llamador aporto un
    // cliente. El resultado pasa por la misma validacion; no se acepta por
    // venir de la IA.
    const precioPorBloque = parecePrecioPorBloque(texto, opciones.codigosEsperados);
    if (precioPorBloque) {
        avisos.push("el modulo parece traer un precio comun por bloque, no un precio por producto");

        // Antes se quedaba aqui y el modulo entero iba a revision manual.
        // Pero el layout no tiene nada de ambiguo: el precio esta impreso
        // una vez al pie de cada bloque y aplica a todos sus productos.
        // Son 79 modulos y 501 productos, buena parte tornilleria.
        //
        // Pasa por la MISMA evaluacion que cualquier otra lectura --
        // coherencia de precios y cruce contra la fuente en texto-- y solo
        // se acepta si mejora lo que habia.
        // El rotulo de excepcion vive fuera del recorte de la tabla, asi
        // que hace falta una lectura aparte de la zona grafica. Si esa
        // lectura falla no se reparte nada: sin poder ver las excepciones
        // no hay forma de saber a quien NO le toca el precio del bloque, y
        // asignarlo a ciegas es justo el error que se quiere evitar.
        let excepciones = [];
        try {
            const halladas = await leerExcepcionesDeBloque(bufferImagen, motor, opciones.codigosEsperados);
            excepciones = halladas.codigos;
            if (excepciones.length > 0) {
                avisos.push(`el catalogo marca como excepcion al precio del bloque: ${excepciones.join(", ")}; se dejan sin precio`);
            }
        } catch (error) {
            avisos.push(`no se pudo revisar si el modulo tiene excepciones al precio del bloque (${error.message}); no se reparte ninguno`);
            excepciones = null;
        }

        const porBloque = excepciones === null
            ? { filas: [], avisos: [] }
            : parsearPreciosPorBloque(texto, { ...opciones, excepcionesBloque: excepciones });

        if (porBloque.filas.length > 0) {
            const evaluacionBloque = evaluar(porBloque.filas);
            if (evaluacionBloque.utiles.length > filasFinales.filter(f => f.completa).length) {
                filasFinales = evaluacionBloque.utiles;
                validacion = evaluacionBloque.validacion;
                confiable = evaluacionBloque.confiable;
                avisos.push(...porBloque.avisos);
            }
        }
    }

    // Columna de precio VACIA en el catalogo: hay modulos donde el
    // fabricante imprime el encabezado ("Distribuidor") pero deja la
    // columna en blanco -- verificado a ojo en los tubos de cobre FOSET
    // (41274/41275/41276), que no traen precio distribuidor publicado.
    // Eso no es un fallo de lectura y no debe mandar el modulo a revision
    // ni gastar vision: el producto es valido, simplemente sin ese precio.
    //
    // La senal que lo distingue de un OCR que fallo del todo: los codigos
    // se leyeron TODOS bien (asi que el OCR si funciono sobre esta imagen)
    // y aun asi no hay un solo importe en el texto. Se piden dos filas
    // como minimo para no aceptar como "vacio" un modulo de un solo
    // producto al que se le pudo escapar su unico precio.
    const sinNingunImporte = !/\$\d/.test(texto);
    const sinPreciosPublicados = !confiable
        && !precioPorBloque
        && validacion.ok
        && sinNingunImporte
        && filasFinales.length >= 2;

    if (sinPreciosPublicados) {
        for (const fila of filasFinales) {
            fila.completa = true;
            fila.motivo = "";
        }
        confiable = true;
        origen = "sin_precios_publicados";
        avisos.push("el fabricante no publica precio para estos productos: la columna viene vacia");
    }

    // Se anota que se GASTO una llamada, no que salio bien: la cuenta es
    // de dinero y de cuota, y una llamada fallida cuesta igual.
    let intentoVision = false;

    // Una lectura PARCIAL tambien pide vision: es justo el caso donde
    // puede recuperar la fila que al OCR se le fue. Si la vision no lo
    // hace mejor, se conserva lo parcial en vez de perderlo.
    //
    // Salvo cuando el modulo ya se resolvio como "el fabricante no publica
    // este precio": ahi no falta nada que rescatar -- la columna esta
    // vacia en el catalogo impreso-- y gastar vision seria pagar por
    // confirmar un hueco que TRUPER dejo a proposito.
    const parcialOcr = Boolean(validacion?.parcial) && !sinPreciosPublicados;

    if ((!confiable || parcialOcr) && opciones.anthropic && !precioPorBloque) {
        intentoVision = true;
        try {
            // Se le dan al modelo las columnas DECLARADAS por el adaptador,
            // no las que dedujo el OCR: si el OCR fallo, su lectura del
            // encabezado tambien es sospechosa, y pasarsela lo induce a
            // devolver justo las columnas equivocadas (paso de verdad:
            // omitia el medio mayoreo porque el OCR no lo habia visto).
            const columnasEsperadas = (opciones.columnasForzadas && opciones.columnasForzadas.length)
                ? opciones.columnasForzadas
                : columnas;

            const filasIA = await leerTablaConVision(
                opciones.anthropic,
                recortes,
                (opciones.codigosEsperados || []).map(normalizarCodigo),
                columnasEsperadas
            );

            if (filasIA.length > 0) {
                const evaluacionIA = evaluar(filasIA);

                // Se queda con la lectura de la vision solo si MEJORA lo
                // que ya habia: sirve, y le faltan menos productos. Sin
                // esta comparacion, una vision que leyera menos filas que
                // el OCR reemplazaria una lectura buena por una peor.
                const faltabanAntes = confiable ? (validacion?.faltantes || []).length : Infinity;
                const faltanAhora = (evaluacionIA.validacion?.faltantes || []).length;

                if (evaluacionIA.confiable && faltanAhora < faltabanAntes) {
                    filasFinales = evaluacionIA.utiles;
                    validacion = evaluacionIA.validacion;
                    confiable = true;
                    origen = "vision";
                    if (columnas.length === 0) {
                        columnas = [...new Set(filasIA.flatMap(f => Object.keys(f.precios)))];
                    }
                }
            }
        } catch (error) {
            avisos.push(`el respaldo por vision fallo: ${error.message}`);
        }
    }

    // Layout realmente usado, para poder auditar despues por que salio
    // cada precio y detectar si el fabricante cambia su maqueta.
    let layout = layoutsVistos.find(l => l === "transpuesta") || layoutsVistos[0] || "desconocido";
    if (precioPorBloque) layout = "precio_por_bloque";
    if (sinPreciosPublicados) layout = "columna_vacia";

    // Confianza de la lectura, pensada para mostrarsela a una persona:
    //   alta  -> el OCR leyo y todo cuadro con la fuente en texto
    //   media -> hizo falta la vision para poder leerlo
    //   baja  -> no se acepto (va a revision manual)
    let nivelConfianza = "baja";
    if (confiable) nivelConfianza = origen === "ocr" || origen === "sin_precios_publicados" ? "alta" : "media";

    return {
        hash,
        texto,
        confianza: confianza ?? null,
        nivelConfianza,
        columnas,
        layout,
        tablas: recortes.length,
        filas: filasFinales,
        avisos,
        validacion,
        origen,
        // Si se llamo a la vision. El adaptador lleva la cuenta del tope por
        // corrida y solo puede hacerlo bien si sabe cuando se gasto de
        // verdad una llamada.
        intentoVision,
        // Solo un modulo confiable puede escribir precios en el catalogo.
        confiable
    };
}

module.exports = {
    normalizarCodigo,
    normalizarClave,
    precioDeTexto,
    detectarColumnasPrecio,
    parsearTablaPrecios,
    pareceTablaTranspuesta,
    parecePrecioPorBloque,
    parsearTablaTranspuesta,
    parsearPreciosPorBloque,
    leerExcepcionesDeBloque,
    validarContraFuenteTexto,
    revisarCoherenciaPrecios,
    hashContenido,
    segmentosOscuros,
    detectarBandasTabla,
    recortarTablas,
    leerTablaConVision,
    construirPromptTabla,
    extraerTablaDeModulo,
    liberarWorkerOcr,
    reciclarWorkersOcr,
    tomarWorker,
    devolverWorker,
    FACTOR_AMPLIACION,
    MODELO_VISION
};

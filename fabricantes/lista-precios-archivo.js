// Adaptador GENERICO de lista de precios en archivo (CSV / texto
// delimitado). Sirve para cualquier fabricante o proveedor que reparta su
// catalogo como archivo, que es la forma mas comun fuera de TRUPER:
// Diprofer, IUSA, Coflex, y practicamente todo abarrote (Bimbo,
// Coca-Cola, Sabritas) mandan lista de precios, no un catalogo web.
//
// Es la prueba de que el motor no depende de TRUPER: este archivo no sabe
// nada de OCR, ni de imagenes, ni de modulos, y aun asi el MISMO nucleo
// de sincronizacion lo corre igual -- con el mismo diff, el mismo
// respaldo previo, los mismos frenos y el mismo reporte de cambios.
//
// Se crea con una configuracion, no se exporta un objeto fijo:
//
//   const bimbo = crearAdaptadorArchivo({
//       nombre: "BIMBO",
//       claveIdentidad: "ean",            // abarrote se identifica por EAN
//       leerContenido: async () => fs.readFileSync("lista.csv", "utf8"),
//       columnas: { ean: "Codigo de barras", descripcion: "Producto",
//                   precio_publico: "PVP" }
//   });

const crypto = require("crypto");
const { numeroONulo, textoLimpio, NIVELES_PRECIO_ESTANDAR } = require("../catalogo-fabricante-contrato");

// Separador mas probable de una linea de encabezado: se elige el que
// produce mas columnas, en vez de asumir coma (los proveedores mexicanos
// mandan punto y coma o tabulador con la misma frecuencia).
function detectarSeparador(primeraLinea) {
    const candidatos = [",", ";", "\t", "|"];
    let mejor = ",";
    let maximo = 0;

    for (const separador of candidatos) {
        const n = partirLinea(primeraLinea, separador).length;
        if (n > maximo) {
            maximo = n;
            mejor = separador;
        }
    }
    return mejor;
}

// Partido respetando comillas: una descripcion como
// "Martillo, mango de fibra" no debe romperse en dos columnas.
function partirLinea(linea, separador) {
    const celdas = [];
    let actual = "";
    let entreComillas = false;

    for (let i = 0; i < linea.length; i++) {
        const caracter = linea[i];

        if (caracter === '"') {
            // Comilla doble escapada dentro de un campo entrecomillado.
            if (entreComillas && linea[i + 1] === '"') {
                actual += '"';
                i++;
            } else {
                entreComillas = !entreComillas;
            }
            continue;
        }

        if (caracter === separador && !entreComillas) {
            celdas.push(actual);
            actual = "";
            continue;
        }
        actual += caracter;
    }
    celdas.push(actual);

    return celdas.map(c => c.trim());
}

// Compara nombres de columna ignorando acentos, mayusculas y espacios:
// el mismo proveedor manda "Precio Público", "PRECIO PUBLICO" y
// "precio_publico" en tres envios distintos.
function normalizarEncabezado(texto) {
    return String(texto || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

/**
 * Localiza cada campo pedido dentro de los encabezados reales del
 * archivo. Devuelve el indice de columna por campo.
 */
function mapearColumnas(encabezados, columnas) {
    const normalizados = encabezados.map(normalizarEncabezado);
    const mapa = {};

    for (const [campo, nombreEsperado] of Object.entries(columnas || {})) {
        const objetivo = normalizarEncabezado(nombreEsperado);
        let indice = normalizados.indexOf(objetivo);
        // Si no hay coincidencia exacta se acepta que el encabezado real
        // contenga al esperado ("precio publico con iva").
        if (indice === -1) indice = normalizados.findIndex(h => h.includes(objetivo) && objetivo.length >= 4);
        if (indice !== -1) mapa[campo] = indice;
    }

    return mapa;
}

/**
 * Convierte el contenido de un archivo delimitado en filas normalizadas.
 * Modulo puro: recibe texto, devuelve filas. Se puede probar sin tocar
 * disco ni red.
 */
function parsearListaPrecios(contenido, opciones = {}) {
    const lineas = String(contenido || "")
        .split(/\r?\n/)
        .filter(linea => linea.trim() !== "");

    if (lineas.length < 2) {
        return { filas: [], columnasHalladas: {}, avisos: ["el archivo no tiene datos"] };
    }

    const separador = opciones.separador || detectarSeparador(lineas[0]);
    const encabezados = partirLinea(lineas[0], separador);
    const mapa = mapearColumnas(encabezados, opciones.columnas);
    const avisos = [];

    const faltantes = Object.keys(opciones.columnas || {}).filter(campo => mapa[campo] === undefined);
    if (faltantes.length > 0) {
        avisos.push(`no se encontraron las columnas: ${faltantes.join(", ")}`);
    }

    const niveles = (opciones.nivelesPrecio || NIVELES_PRECIO_ESTANDAR)
        .filter(campo => mapa[campo] !== undefined);

    const filas = [];
    for (let i = 1; i < lineas.length; i++) {
        const celdas = partirLinea(lineas[i], separador);
        const valor = campo => (mapa[campo] === undefined ? "" : textoLimpio(celdas[mapa[campo]]));

        const precios = {};
        const sinLeer = [];
        for (const campo of niveles) {
            const numero = numeroONulo(celdas[mapa[campo]]);
            if (numero === null) sinLeer.push(campo);
            else precios[campo] = numero;
        }

        const fila = {
            codigo: valor("codigo"),
            clave: valor("clave"),
            ean: valor("ean"),
            descripcion: valor("descripcion"),
            marca: valor("marca"),
            categoria: valor("categoria"),
            precios,
            // Una celda vacia en el archivo no se rellena ni se adivina:
            // la fila queda incompleta y el nucleo la manda a revision,
            // igual que una tabla mal leida por OCR.
            completa: sinLeer.length === 0 && niveles.length > 0,
            motivo: sinLeer.length ? `sin valor en: ${sinLeer.join(", ")}` : ""
        };

        // Una fila sin ninguna identidad no es un producto (lineas de
        // total, separadores, notas al pie del archivo).
        if (!fila.codigo && !fila.ean) continue;
        filas.push(fila);
    }

    return { filas, columnasHalladas: mapa, separador, avisos };
}

/**
 * Crea un adaptador que cumple el contrato comun a partir de un archivo.
 *
 * @param {object} config
 * @param {string} config.nombre
 * @param {'codigo'|'ean'} [config.claveIdentidad]
 * @param {function} config.leerContenido  async () => string
 * @param {object} config.columnas         campo -> nombre de columna en el archivo
 * @param {string[]} [config.nivelesPrecio]
 */
function crearAdaptadorArchivo(config) {
    const nivelesPrecio = config.nivelesPrecio
        || Object.keys(config.columnas || {}).filter(c => NIVELES_PRECIO_ESTANDAR.includes(c));

    // El archivo se lee una sola vez por corrida: listarUniverso() y
    // extraerUnidad() miran el mismo contenido.
    async function contenidoDeLaCorrida(ctx) {
        if (ctx._contenido === undefined) {
            ctx._contenido = await config.leerContenido(ctx);
        }
        return ctx._contenido;
    }

    async function filasDeLaCorrida(ctx) {
        if (!ctx._filas) {
            const contenido = await contenidoDeLaCorrida(ctx);
            ctx._filas = parsearListaPrecios(contenido, {
                columnas: config.columnas,
                separador: config.separador,
                nivelesPrecio
            });
        }
        return ctx._filas;
    }

    return {
        nombre: config.nombre,
        formato: "csv",
        claveIdentidad: config.claveIdentidad || "codigo",
        nivelesPrecio,

        async listarUniverso(ctx) {
            const { filas } = await filasDeLaCorrida(ctx);
            const clave = config.claveIdentidad || "codigo";
            const universo = new Map();

            for (const fila of filas) {
                const identidad = fila[clave];
                if (!identidad) continue;
                universo.set(identidad, { clave: fila.clave || "", unidadId: "archivo", referencia: null });
            }
            return universo;
        },

        // Un archivo es UNA sola unidad: no tiene sentido reprocesarlo por
        // partes. Su firma es el hash del contenido, asi que si el
        // proveedor reenvia el mismo archivo no se reprocesa nada.
        async listarUnidades(ctx) {
            const contenido = await contenidoDeLaCorrida(ctx);
            const { filas } = await filasDeLaCorrida(ctx);
            const firma = crypto.createHash("sha256").update(String(contenido)).digest("hex");

            return [{
                id: "archivo",
                parte: "",
                firma,
                referencia: null,
                productosEsperados: filas.length
            }];
        },

        async extraerUnidad(unidad, ctx) {
            const { filas, avisos, columnasHalladas } = await filasDeLaCorrida(ctx);

            // Sin columna de identidad no hay nada que hacer: mejor fallar
            // claro que importar un archivo entero mal mapeado.
            const clave = config.claveIdentidad || "codigo";
            if (columnasHalladas[clave] === undefined) {
                return {
                    filas: [], confiable: false, origen: "archivo", layout: "csv",
                    confianza: "baja", firmaContenido: unidad.firma,
                    detalle: `el archivo no trae la columna de ${clave}`
                };
            }

            const completas = filas.filter(f => f.completa).length;

            return {
                filas,
                // Un archivo es texto: si se mapearon las columnas y hay
                // filas completas, la lectura es exacta -- no hay
                // interpretacion de por medio como en una imagen.
                confiable: filas.length > 0 && completas === filas.length,
                origen: "archivo",
                layout: "csv",
                confianza: "alta",
                firmaContenido: unidad.firma,
                preciosSinPublicar: [],
                detalle: avisos.join("; ") || (completas === filas.length ? "" : `${filas.length - completas} filas sin todos los precios`)
            };
        }
    };
}

module.exports = {
    crearAdaptadorArchivo,
    parsearListaPrecios,
    detectarSeparador,
    partirLinea,
    normalizarEncabezado,
    mapearColumnas
};

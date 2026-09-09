// Parser de CFDI 4.0 en servidor, para Recepcion Inteligente. Version
// de servidor de public/js/factura-parser.js (que usa DOMParser del
// navegador y no puede correr en Node) -- misma logica de lectura, mas
// tres campos que ese parser NO extrae porque nadie los necesitaba
// todavia: UUID del timbre fiscal, RFC/nombre del receptor, y
// ClaveProdServ por separado de NoIdentificacion.
//
// Esa separacion es un hallazgo real de la auditoria: NoIdentificacion
// es el codigo con el que ESE PROVEEDOR nombra el producto (util para
// buscar). ClaveProdServ es la clasificacion generica del catalogo del
// SAT, compartida por miles de productos distintos -- usarla como
// identificador de producto produce falsos positivos masivos. Aqui se
// guardan aparte a proposito; el motor de matching
// (recepcion-inteligente-matching.js) solo debe usar `codigo`.
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true
});

function numero(valor) {
    const n = Number(String(valor ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

function textoLimpio(valor) {
    return String(valor ?? "").trim();
}

function comoArreglo(valor) {
    if (valor === undefined || valor === null) return [];
    return Array.isArray(valor) ? valor : [valor];
}

// Lanza si el XML no se puede interpretar o no es un CFDI real -- una
// factura ilegible nunca debe generar una recepcion a medias, debe
// rechazarse por completo y dejarse para revision manual (riesgo "XML
// invalido" de la auditoria).
function parsearCfdi(xmlTexto) {
    let doc;
    try {
        doc = parser.parse(String(xmlTexto || ""));
    } catch (error) {
        const invalido = new Error("XML invalido: no se pudo interpretar el documento");
        invalido.causa = error.message;
        throw invalido;
    }

    const comprobante = doc?.Comprobante;
    if (!comprobante || typeof comprobante !== "object") {
        throw new Error("XML invalido: no es un CFDI (falta el nodo Comprobante)");
    }

    const emisor = comprobante.Emisor || {};
    const receptor = comprobante.Receptor || {};
    const timbre = comprobante.Complemento?.TimbreFiscalDigital || {};

    // El nodo Impuestos de LA FACTURA (el que trae
    // TotalImpuestosTrasladados) es hijo DIRECTO de Comprobante. Cada
    // Concepto tambien puede traer su propio Impuestos anidado -- pero
    // aqui, al leer comprobante.Impuestos con el arbol ya parseado (no
    // un recorrido de nodos como en el navegador), nunca hay ambiguedad
    // con el de un concepto individual. Mismo bug real ya documentado
    // y corregido en public/js/factura-parser.js, evitado aqui por
    // construccion.
    const impuestos = comprobante.Impuestos || {};

    const conceptos = comoArreglo(comprobante.Conceptos?.Concepto).map(nodo => ({
        codigo: textoLimpio(nodo.NoIdentificacion),
        claveProdServ: textoLimpio(nodo.ClaveProdServ),
        descripcion: textoLimpio(nodo.Descripcion) || "Producto sin descripcion",
        cantidad: numero(nodo.Cantidad ?? 1),
        costo: numero(nodo.ValorUnitario ?? 0),
        importe: numero(nodo.Importe ?? 0),
        descuento: numero(nodo.Descuento ?? 0),
        unidad: textoLimpio(nodo.Unidad) || textoLimpio(nodo.ClaveUnidad) || "pieza"
    })).filter(item => item.descripcion || item.codigo);

    return {
        uuid: textoLimpio(timbre.UUID) || null,
        emisorRfc: textoLimpio(emisor.Rfc),
        emisorNombre: textoLimpio(emisor.Nombre),
        receptorRfc: textoLimpio(receptor.Rfc),
        receptorNombre: textoLimpio(receptor.Nombre),
        folio: textoLimpio(comprobante.Folio) || textoLimpio(comprobante.Serie),
        serie: textoLimpio(comprobante.Serie),
        fecha: textoLimpio(comprobante.Fecha).slice(0, 10) || null,
        subtotal: numero(comprobante.SubTotal ?? 0),
        iva: numero(impuestos.TotalImpuestosTrasladados ?? 0),
        total: numero(comprobante.Total ?? 0),
        conceptos
    };
}

module.exports = { parsearCfdi };

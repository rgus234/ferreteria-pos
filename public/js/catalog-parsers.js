/* Arquitectura de adaptadores de catalogo por proveedor.
   Cada parser sabe interpretar una fila ya separada en columnas (datos) y
   devolver el mismo objeto de producto que antes armaba productoDesdeCatalogo()
   inline. catalogo.parser identifica cual usar; si no existe (catalogos ya
   guardados antes de esta arquitectura) se usa "generico", que reproduce
   exactamente el comportamiento de siempre. */

function extraerProductoGenericoCatalogo(ctx) {
 const {
 datos,
 columnas,
 mapeoCatalogo,
 indiceCodigoProducto,
 codigoNormalizado,
 codigosAlternos,
 catalogoProveedor
 } = ctx;

 const nombreColumna =
 valorMapeoCatalogo(datos, mapeoCatalogo, "nombre") ||
 valorColumnaCatalogo(datos, columnas, "nombre");

 const descripcionColumna =
 valorMapeoCatalogo(datos, mapeoCatalogo, "nombre") ||
 valorColumnaCatalogo(datos, columnas, "descripcion");

 // "nombreLargo" adivina el nombre buscando el texto mas largo de toda
 // la fila -- solo debe usarse como ultimo recurso cuando no hay ninguna
 // columna de nombre/descripcion mapeada o detectada, porque si no puede
 // ganarle a la columna real con cualquier otro texto largo de la fila
 // (ej. el nombre del proveedor distribuidor, que en catalogos como el
 // de Gafi suele ser mas largo que el nombre corto del producto).
 const nombreLargo =
 nombreProductoDesdeFilaCatalogo(
 datos,
 indiceCodigoProducto
 );

 const nombreDetectado =
 [
 descripcionColumna,
 nombreColumna
 ]
 .map(limpiarTextoCatalogo)
 .filter(Boolean)
 .sort((a, b) => b.length - a.length)[0] ||
 limpiarTextoCatalogo(nombreLargo) ||
 "Producto sin nombre";

 const medioMayoreoIva =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "medioMayoreo") ||
 valorColumnaCatalogo(
 datos,
 columnas,
 "medioMayoreoIva"
 )
 );

 let medioMayoreo =
 medioMayoreoIva ||
 numeroCatalogo(
 valorColumnaCatalogo(
 datos,
 columnas,
 "medioMayoreo"
 )
 );

 const distribuidor =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "costo") ||
 valorColumnaCatalogo(
 datos,
 columnas,
 "distribuidor"
 )
 );

 const publico =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "publico") ||
 valorColumnaCatalogo(
 datos,
 columnas,
 "publico"
 )
 );

 if (
 medioMayoreo &&
 distribuidor &&
 medioMayoreo < distribuidor
 ) {
 medioMayoreo =
 publico && publico >= distribuidor
 ? publico
 : distribuidor;
 }

 return {
 codigo:
 normalizarCodigo(datos[indiceCodigoProducto]) ||
 codigoNormalizado,
 nombre: nombreDetectado,
 descripcion:
 descripcionColumna ||
 nombreLargo ||
 nombreColumna,
 marca:
 valorMapeoCatalogo(datos, mapeoCatalogo, "marca") ||
 valorColumnaCatalogo(datos, columnas, "marca") ||
 detectarMarcaDesdeFilaCatalogo(datos) ||
 inferirMarcaPorCodigo(datos[indiceCodigoProducto]),
 categoria:
 valorMapeoCatalogo(datos, mapeoCatalogo, "categoria") ||
 valorColumnaCatalogo(datos, columnas, "categoria") ||
 "",
 unidadVenta:
 valorMapeoCatalogo(datos, mapeoCatalogo, "unidadVenta") ||
 "pieza",
 codigoInterno:
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoInterno") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "claveProveedor") ||
 valorColumnaCatalogo(datos, columnas, "codigoInterno") ||
 codigoInternoDesdeFilaCatalogo(
 datos,
 datos[indiceCodigoProducto]
 ),
 distribuidor,
 medioMayoreo,
 publico,
 proveedor:
 catalogoProveedor.proveedor ||
 localStorage.getItem("ultimoProveedorCatalogo") ||
 ultimoProveedorCatalogo(),
 stockMinimo:
 numeroCatalogo(
 valorColumnaCatalogo(
 datos,
 columnas,
 "stockMinimo"
 )
 ) || 3,
 altaRotacion:
 valorColumnaCatalogo(
 datos,
 columnas,
 "altaRotacion"
 ) || datos[12] || "",
 precioDetectado:
 medioMayoreoIva
 ? "medio mayoreo con IVA"
 : "medio mayoreo",
 codigosRelacionados:
 [
 ...datos
 .map(normalizarCodigo)
 .filter(item =>
 item &&
 item !== codigoNormalizado &&
 /^\d{3,14}$/.test(item)
 ),
 ...codigosAlternos.filter(item =>
 item && item !== codigoNormalizado
 )
 ].filter((item, indice, lista) =>
 lista.indexOf(item) === indice
 )
 };
}

const CATALOGO_PARSERS = {
 generico: {
 id: "generico",
 label: "Otro proveedor",
 extraerProducto: extraerProductoGenericoCatalogo
 }
};

/* TruperParser: reusa la extraccion generica (que ya sabe leer la columna
   "Marca" cuando existe) y solo aplica "Truper" como respaldo si esa columna
   viniera vacia -- todo un catalogo de Truper es, por definicion, de esa
   marca. plantillaId apunta a la plantilla ya existente "global-truper-csv"
   (plantillasCatalogoBase() en supplier-catalog.js), que el selector de
   proveedor (Fase B4) usa para preseleccionar el mapeo de columnas al subir
   un catalogo de Truper. */
function extraerProductoTruperCatalogo(ctx) {
 const producto =
 extraerProductoGenericoCatalogo(ctx);

 return {
 ...producto,
 marca: producto.marca || "Truper"
 };
}

CATALOGO_PARSERS.truper = {
 id: "truper",
 label: "Truper",
 plantillaId: "global-truper-csv",
 extraerProducto: extraerProductoTruperCatalogo
};

/* DiproferParser y VolteckParser: por ahora son wrappers delgados que
   delegan en la extraccion generica -- mismo comportamiento de hoy, solo
   con identidad propia (id/nombre) para el selector de proveedor. No hay
   quejas concretas sobre como se leen estos catalogos reales todavia; si
   aparece un producto mal leido de alguno de estos proveedores, se ajusta
   su parser especifico sin tocar los demas.

   GafiParser: verificado con un catalogo real (004BE Durango). Su formato
   trae columnas "Corto,Alterno,Articulo,Precio Lista,Unidad,Emp,Linea,
   Familia,Marca,Proveedor Principal" -- SIN columna de codigo de barras,
   solo claves internas del distribuidor ("Corto") y del fabricante
   ("Alterno"). plantillaId apunta a la plantilla "global-gafi-csv"
   (plantillasCatalogoBase() en supplier-catalog.js) que corrige dos
   columnas que la deteccion automatica generica adivina mal para este
   encabezado especifico: "marca" (la regla generica confunde "Linea" con
   "marca" porque su patron acepta ambas palabras) y "costo" (la regla
   generica confunde "Proveedor Principal" con un campo de costo porque su
   patron acepta la palabra "proveedor"). */
CATALOGO_PARSERS.diprofer = {
 id: "diprofer",
 label: "Diprofer",
 extraerProducto: extraerProductoGenericoCatalogo
};

CATALOGO_PARSERS.gafi = {
 id: "gafi",
 label: "Gafi",
 plantillaId: "global-gafi-csv",
 extraerProducto: extraerProductoGenericoCatalogo
};

CATALOGO_PARSERS.volteck = {
 id: "volteck",
 label: "Volteck",
 extraerProducto: extraerProductoGenericoCatalogo
};

function parserCatalogoProveedor(catalogo) {
 const id =
 (catalogo && catalogo.parser) || "generico";

 return CATALOGO_PARSERS[id] || CATALOGO_PARSERS.generico;
}

window.CATALOGO_PARSERS = CATALOGO_PARSERS;
window.parserCatalogoProveedor = parserCatalogoProveedor;

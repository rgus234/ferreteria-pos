/* Utilidades de producto y catalogo */
function normalizarCodigo(codigo) {
 return String(codigo || "")
 .replace(/[="'\s]/g, "")
 .trim();
}

function limpiarTextoCatalogo(valor) {
 return String(valor || "")
 .replace(/^=+/, "")
 .replace(/^"+|"+$/g, "")
 .trim();
}

function separarFilaCatalogo(linea) {
 const partes = [];
 let actual = "";
 let enComillas = false;
 const textoLinea =
 String(linea || "");

 const contarSeparador = separador => {
 let total = 0;
 let dentroComillas = false;

 for (let i = 0; i < textoLinea.length; i++) {
 const caracter = textoLinea[i];
 const siguiente = textoLinea[i + 1];

 if (caracter === '"' && siguiente === '"') {
 i++;
 continue;
 }

 if (caracter === '"') {
 dentroComillas = !dentroComillas;
 continue;
 }

 if (caracter === separador && !dentroComillas) {
 total++;
 }
 }

 return total;
 };

 const separador =
 [
 ",",
 ";",
 "\t"
 ].sort((a, b) => contarSeparador(b) - contarSeparador(a))[0] || ",";

 for (let i = 0; i < textoLinea.length; i++) {
 const caracter = textoLinea[i];
 const siguiente = textoLinea[i + 1];

 if (caracter === '"' && siguiente === '"') {
 actual += '"';
 i++;
 continue;
 }

 if (caracter === '"') {
 enComillas = !enComillas;
 continue;
 }

 if (caracter === separador && !enComillas) {
 partes.push(actual);
 actual = "";
 continue;
 }

 actual += caracter;
 }

 partes.push(actual);
 return partes.map(limpiarTextoCatalogo);
}

function dividirLineasCatalogo(csv) {
 const texto =
 String(csv || "");

 const lineas = [];
 let actual = "";
 let enComillas = false;

 for (let i = 0; i < texto.length; i++) {
 const caracter = texto[i];

 if (caracter === '"') {
 enComillas = !enComillas;
 actual += caracter;
 continue;
 }

 if (caracter === "\r") continue;

 if (caracter === "\n" && !enComillas) {
 lineas.push(actual);
 actual = "";
 continue;
 }

 actual += caracter;
 }

 if (actual) lineas.push(actual);

 return lineas;
}

function normalizarEncabezadoCatalogo(valor) {
 return limpiarTextoCatalogo(valor)
 .toLowerCase()
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g, "")
 .replace(/[^a-z0-9]+/g, " ")
 .trim();
}

function numeroCatalogo(valor) {
 const limpio =
 limpiarTextoCatalogo(valor)
 .replace(/[^0-9.,-]/g, "")
 .replace(/,/g, "");

 const numero =
 Number(limpio);

 return Number.isFinite(numero) ? numero : "";
}

function detectarColumnasCatalogo(lineas) {
 const muestra =
 lineas.slice(0, 12);

 let mejor = {
 indice: -1,
 puntaje: 0,
 columnas: {}
 };

 const reglas = [
 {
 clave: "codigo",
 puntos: 5,
 prueba: texto => /\b(codigo|cod|clave|barcode|barra|barras|ean|upc)\b/.test(texto)
 },
 {
 clave: "nombre",
 puntos: 4,
 prueba: texto => /\b(producto|articulo|nombre|concepto|modelo)\b/.test(texto)
 },
 {
 clave: "descripcion",
 puntos: 5,
 prueba: texto => /\b(descripcion|desc|detalle|caracteristicas)\b/.test(texto)
 },
 {
 clave: "marca",
 puntos: 4,
 prueba: texto => /\b(marca|linea|fabricante)\b/.test(texto)
 },
 {
 clave: "codigoInterno",
 puntos: 4,
 prueba: texto => /\b(clave|sku|modelo|codigo interno|codigo proveedor|referencia|ref)\b/.test(texto)
 && !/\b(barra|barras|ean|upc)\b/.test(texto)
 },
 {
 clave: "categoria",
 puntos: 3,
 prueba: texto => /\b(categoria|familia|depto|departamento|grupo)\b/.test(texto)
 },
 {
 clave: "medioMayoreoIva",
 puntos: 8,
 prueba: texto =>
 /\b(mayoreo|may)\b/.test(texto) &&
 /(iva|impuesto|c iva|con iva)/.test(texto) &&
 !/\b(distribuidor|subdistribuidor|minimo|minima)\b/.test(texto)
 },
 {
 clave: "medioMayoreo",
 puntos: 6,
 prueba: texto =>
 /\b(mayoreo|may)\b/.test(texto) &&
 !/\b(distribuidor|subdistribuidor|minimo|minima|iva)\b/.test(texto)
 },
 {
 clave: "publico",
 puntos: 4,
 prueba: texto =>
 /\b(publico|pub|menudeo|lista)\b/.test(texto) &&
 !/\b(minimo|minima)\b/.test(texto)
 },
 {
 clave: "distribuidor",
 puntos: 4,
 prueba: texto =>
 /\b(distribuidor|costo|neto|proveedor)\b/.test(texto) &&
 !/\b(subdistribuidor)\b/.test(texto)
 },
 {
 clave: "stockMinimo",
 puntos: 3,
 prueba: texto => /stock/.test(texto) && /(minimo|min)/.test(texto)
 },
 {
 clave: "altaRotacion",
 puntos: 2,
 prueba: texto => /rotacion/.test(texto)
 }
 ];

 muestra.forEach((linea, indice) => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas = {};
 let puntaje = 0;

 datos.forEach((dato, columna) => {
 const texto =
 normalizarEncabezadoCatalogo(dato);

 reglas.forEach(regla => {
 if (columnas[regla.clave] === undefined && regla.prueba(texto)) {
 columnas[regla.clave] = columna;
 puntaje += regla.puntos;
 }
 });
 });

 if (puntaje > mejor.puntaje) {
 mejor = {
 indice,
 puntaje,
 columnas
 };
 }
 });

 return mejor.puntaje >= 6
 ? mejor
 : {
 indice: -1,
 puntaje: 0,
 columnas: {}
 };
}

function valorColumnaCatalogo(datos, columnas, clave) {
 const indice =
 columnas[clave];

 return indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
}

function valorMapeoCatalogo(datos, mapeo, clave) {
 const indice =
 mapeo?.[clave];

 return indice === "" || indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
}

const CAMPOS_CATALOGO_COMPACTO = [
 "codigoBarras",
 "codigoInterno",
 "claveProveedor",
 "codigosAlternos",
 "nombre",
 "unidadVenta",
 "costo",
 "medioMayoreo",
 "publico",
 "marca",
 "categoria"
];

const MAPEO_CATALOGO_COMPACTO =
 CAMPOS_CATALOGO_COMPACTO.reduce((mapa, campo, indice) => {
 mapa[campo] = indice;
 return mapa;
 }, {});

function escaparCsvCatalogo(valor) {
 const texto =
 limpiarTextoCatalogo(valor);

 return /[",\n\r]/.test(texto)
 ? `"${texto.replace(/"/g, '""')}"`
 : texto;
}

function esCatalogoCompacto(csv) {
 const primeraLinea =
 dividirLineasCatalogo(csv)
 .find(linea => linea.trim()) || "";

 return primeraLinea.includes("__pos_codigoBarras");
}

function valorCatalogoParaCompactar(datos, columnas, mapeo, campo) {
 if (campo === "codigosAlternos") {
 const codigos =
 datos
 .map(normalizarCodigo)
 .filter(codigo =>
 codigo &&
 /^\d{4,14}$/.test(codigo)
 );

 return [...new Set(codigos)].join("|");
 }

 const desdeMapeo =
 valorMapeoCatalogo(datos, mapeo, campo);

 if (desdeMapeo) return desdeMapeo;

 const equivalencias = {
 codigoBarras: "codigo",
 codigoInterno: "codigoInterno",
 claveProveedor: "codigoInterno",
 nombre: "nombre",
 costo: "distribuidor",
 medioMayoreo: "medioMayoreoIva",
 publico: "publico",
 marca: "marca",
 categoria: "categoria"
 };

 return valorColumnaCatalogo(
 datos,
 columnas,
 equivalencias[campo] || campo
 );
}

function compactarCsvCatalogo(csv, mapeo = {}) {
 if (esCatalogoCompacto(csv)) {
 const lineasCompactas =
 dividirLineasCatalogo(csv)
 .map(linea => linea.trim())
 .filter(Boolean);

 return {
 csv,
 mapeo: { ...MAPEO_CATALOGO_COMPACTO },
 productos: Math.max(0, lineasCompactas.length - 1)
 };
 }

 const lineas =
 dividirLineasCatalogo(csv)
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const encabezado =
 CAMPOS_CATALOGO_COMPACTO
 .map(campo => `__pos_${campo}`)
 .join(",");

 const filas =
 lineas
 .filter((linea, indice) => indice !== mapaColumnas.indice)
 .map(linea => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas =
 mapaColumnas.columnas || {};

 const valores =
 CAMPOS_CATALOGO_COMPACTO.map(campo =>
 valorCatalogoParaCompactar(
 datos,
 columnas,
 mapeo,
 campo
 )
 );

 const tieneIdentidad =
 valores[0] || valores[1] || valores[2] || valores[3];

 return tieneIdentidad
 ? valores.map(escaparCsvCatalogo).join(",")
 : "";
 })
 .filter(Boolean);

 return {
 csv: [encabezado, ...filas].join("\n"),
 mapeo: { ...MAPEO_CATALOGO_COMPACTO },
 productos: filas.length
 };
}

function prepararCatalogoParaGuardar(catalogo) {
 const compacto =
 compactarCsvCatalogo(
 catalogo.csv || "",
 catalogo.mapeo || {}
 );

 return {
 ...catalogo,
 csv: compacto.csv,
 mapeo: compacto.mapeo,
 productos: compacto.productos || catalogo.productos || 0
 };
}

function esValorNumericoCatalogo(valor) {
 const limpio =
 limpiarTextoCatalogo(valor)
 .replace(/[$,\s]/g, "");

 return limpio !== "" && !Number.isNaN(Number(limpio));
}

function pareceCodigoCatalogo(valor) {
 const compacto =
 String(valor || "").replace(/[^0-9a-zA-Z]/g, "");

 if (!compacto) return false;

 const digitos =
 (compacto.match(/[0-9]/g) || []).length;

 return digitos >= 6 && digitos / compacto.length >= 0.8;
}

function codigoInternoDeProducto(producto) {
 const alternos =
 Array.isArray(producto?.codigos_relacionados)
 ? producto.codigos_relacionados
 : [];

 const claveInterna =
 alternos.find(item =>
 item.tipo === "alterno" &&
 /^[0-9]{4,7}$/.test(String(item.codigo || "").trim())
 );

 return claveInterna?.codigo || producto?.codigo || "";
}

function nombreProductoDesdeFilaCatalogo(datos, indiceCodigo) {
 const candidatos =
 datos
 .map(limpiarTextoCatalogo)
 .filter((valor, indice) =>
 indice !== indiceCodigo
 &&
 valor.length >= 5
 &&
 !esValorNumericoCatalogo(valor)
 &&
 !/^\d{6,}$/.test(normalizarCodigo(valor))
 &&
 !pareceCodigoCatalogo(valor)
 )
 .sort((a, b) => b.length - a.length);

 return candidatos[0] || "Producto sin nombre";
}

function detectarMarcaDesdeFilaCatalogo(datos) {
 const marcas =
 [
 "Truper",
 "Volteck",
 "Fiero",
 "Pretul",
 "Foset",
 "Hermex",
 "Klintek",
 "Expert",
 "Diprofer"
 ];

 const texto =
 datos
 .map(limpiarTextoCatalogo)
 .join(" ")
 .toLowerCase();

 return marcas.find(marca =>
 texto.includes(marca.toLowerCase())
 ) || "";
}

function inferirMarcaPorCodigo(codigo) {
 const limpio =
 normalizarCodigo(codigo);

 if (
 limpio.startsWith("75012066") ||
 limpio.startsWith("7506240")
 ) {
 return "Truper";
 }

 return "";
}

function codigoInternoDesdeFilaCatalogo(datos, codigoPrincipal) {
 const principal =
 normalizarCodigo(codigoPrincipal);

 const candidatos =
 datos
 .map(limpiarTextoCatalogo)
 .map(normalizarCodigo)
 .filter(codigo =>
 codigo &&
 codigo !== principal &&
 /^[a-zA-Z0-9]{3,10}$/.test(codigo) &&
 !/^\d{11,14}$/.test(codigo)
 )
 .sort((a, b) => a.length - b.length);

 return candidatos[0] || "";
}

function esCodigoBarras(texto) {
 const codigo =
 normalizarCodigo(texto);

 return /^\d{8,14}$/.test(codigo);
}

function codigosProducto(producto) {
 const codigos = [];

 if (producto?.codigo) codigos.push(producto.codigo);

 if (Array.isArray(producto?.codigos_relacionados)) {
 producto.codigos_relacionados.forEach(item => {
 if (item?.codigo) codigos.push(item.codigo);
 });
 }

 return codigos
 .map(normalizarCodigo)
 .filter(Boolean);
}

function buscarProductoLocalPorCodigo(codigo) {
 const limpio =
 normalizarCodigo(codigo);

 if (!limpio) return null;

 return todosProductos.find(producto =>
 normalizarCodigo(producto.id) === limpio ||
 codigosProducto(producto).includes(limpio)
 ) || null;
}

function precioVentaProducto(producto) {
 return Number(
 producto?.precio ||
 producto?.precio_mayoreo ||
 producto?.precio_publico ||
 producto?.precio_distribuidor ||
 0
 );
}

function unidadProducto(producto = {}) {
 return String(
 producto.unidad_venta ||
 producto.unidadVenta ||
 "pieza"
 ).toLowerCase();
}

function esUnidadDecimal(unidad) {
 return [
 "kg",
 "kilo",
 "gramo",
 "metro",
 "litro"
 ].includes(String(unidad || "").toLowerCase());
}

function pasoUnidad(unidad) {
 return esUnidadDecimal(unidad) ? 0.1 : 1;
}

function formatearCantidad(cantidad, unidad = "pieza") {
 const numero =
 Number(cantidad || 0);

 const unidadLimpia =
 String(unidad || "pieza").toLowerCase();

 if (unidadLimpia === "metro" && numero > 0 && numero < 1) {
  return `${Number((numero * 100).toFixed(1))} cm`;
 }

 if ((unidadLimpia === "kg" || unidadLimpia === "kilo") && numero > 0 && numero < 1) {
  return `${Number((numero * 1000).toFixed(0))} g`;
 }

 if (unidadLimpia === "litro" && numero > 0 && numero < 1) {
  return `${Number((numero * 1000).toFixed(0))} ml`;
 }

 const decimales =
 esUnidadDecimal(unidad) ? 3 : 0;

 return `${Number(numero.toFixed(decimales))} ${unidad}`;
}

function generarCodigoInternoProducto(tipo = "manual", categoria = "") {
 const prefijoBase =
 tipo === "granel"
 ? "GR"
 : tipo === "servicio"
 ? "SRV"
 : "GEN";

 const categoriaLimpia =
 normalizarTexto(categoria)
 .replace(/[^a-z0-9]/g, "")
 .slice(0, 3)
 .toUpperCase();

 const prefijo =
 categoriaLimpia || prefijoBase;

 const consecutivo =
 String(Date.now()).slice(-6);

 return `${prefijo}-${consecutivo}`;
}

function esCodigoAutomaticoProducto(valor = "") {
 return /^(GEN|GR|[A-Z0-9]{1,3})-\d{6}$/.test(
 String(valor || "").trim().toUpperCase()
 );
}

function asignarCodigoAutomaticoProducto(tipoFinal) {
 const codigo =
 document.getElementById("nuevoCodigo");

 if (!codigo) return;

 const valorActual =
 codigo.value.trim();

 if (
 valorActual &&
 !codigo.dataset.codigoAutomatico &&
 !esCodigoAutomaticoProducto(valorActual)
 ) return;

 codigo.value =
 generarCodigoInternoProducto(
 tipoFinal,
 document.getElementById("nuevaCategoria")?.value || ""
 );

 codigo.dataset.codigoAutomatico =
 "1";
}

function seleccionarTipoProducto(tipo) {
 const tipoFinal =
 tipo || "catalogo";

 const campoTipo =
 document.getElementById("tipoProductoInventario");

 if (campoTipo) {
 campoTipo.value = tipoFinal;
 }

 document
 .querySelectorAll(".tipo-producto-card")
 .forEach(boton => {
 boton.classList.toggle(
 "activo",
 boton.dataset.tipoProducto === tipoFinal
 );
 });

 const codigo =
 document.getElementById("nuevoCodigo");

 const codigoInterno =
 document.getElementById("nuevoCodigoInterno");

 const unidad =
 document.getElementById("unidadVenta");

 const factor =
 document.getElementById("factorConversion");

 const bascula =
 document.getElementById("basculaDigital");

 if (tipoFinal === "manual") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico o codigo opcional";
 asignarCodigoAutomaticoProducto("manual");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave proveedor / modelo opcional";
 if (unidad && !unidad.value) unidad.value = "pieza";
 }

 if (tipoFinal === "granel") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico para granel";
 asignarCodigoAutomaticoProducto("granel");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave proveedor / referencia opcional";
 if (unidad) unidad.value = "kg";
 if (factor && !factor.value) factor.value = "1";
 if (bascula) bascula.value = "preparado";
 }

 if (tipoFinal === "servicio") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico del servicio";
 asignarCodigoAutomaticoProducto("servicio");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave interna opcional";
 if (unidad) unidad.value = "servicio";
 if (factor && !factor.value) factor.value = "1";
 if (bascula) bascula.value = "no";

 const stock =
 document.getElementById("nuevoStock");

 const stockMinimo =
 document.getElementById("stockMinimo");

 if (stock && !stock.value) stock.value = "1";
 if (stockMinimo && !stockMinimo.value) stockMinimo.value = "0";
 }

 if (tipoFinal === "catalogo" && codigo) {
 codigo.placeholder = "Codigo de barras";

 if (codigo.dataset.codigoAutomatico || esCodigoAutomaticoProducto(codigo.value)) {
 codigo.value = "";
 delete codigo.dataset.codigoAutomatico;
 }

 if (codigoInterno) {
 codigoInterno.placeholder = "Codigo interno / clave proveedor";
 }
 }
}

function programarLecturaCodigoBarras(texto) {
 clearTimeout(temporizadorCodigoBarras);

 if (!esCodigoBarras(texto)) return;

 temporizadorCodigoBarras =
 setTimeout(() => {
 procesarCodigoBarrasPos(
 normalizarCodigo(texto)
 );
 }, 220);
}

function productoDesdeCatalogo(codigo) {
 const codigoNormalizado =
 normalizarCodigo(codigo);

 const catalogos =
 catalogosGuardados();

 const fuentes =
 catalogos.length > 0
 ? catalogos
 : [
 {
 proveedor: "",
 csv: localStorage.getItem(
 "catalogoProveedorCsv"
 ) || ""
 }
 ];

 for (const catalogoProveedor of fuentes) {
 const catalogoGuardado =
 catalogoProveedor.csv || "";

 const lineas =
 dividirLineasCatalogo(catalogoGuardado)
 .map(linea => linea.trim())
 .filter(linea => linea);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const mapeoCatalogo =
 catalogoProveedor.mapeo || {};

 for (const linea of lineas) {
 const datos =
 separarFilaCatalogo(linea);

 const indicesCodigo =
 [
 mapeoCatalogo.codigoBarras,
 mapeoCatalogo.codigoInterno,
 mapeoCatalogo.claveProveedor,
 mapaColumnas.columnas.codigo,
 mapaColumnas.columnas.codigoInterno
 ]
 .filter(indice => indice !== "" && indice !== undefined);

 let indiceCodigo =
 indicesCodigo.find(indice =>
 normalizarCodigo(datos[indice]) === codigoNormalizado
 );

 const codigosAlternos =
 valorMapeoCatalogo(
 datos,
 mapeoCatalogo,
 "codigosAlternos"
 )
 .split("|")
 .map(normalizarCodigo)
 .filter(Boolean);

 const coincideCodigoAlterno =
 codigosAlternos.includes(codigoNormalizado);

 if (indiceCodigo === undefined) {
 indiceCodigo =
 datos.findIndex(
 dato =>
 normalizarCodigo(dato) ===
 codigoNormalizado
 );
 }

 if (indiceCodigo >= 0 || coincideCodigoAlterno) {
 const indiceCodigoProducto =
 indiceCodigo >= 0
 ? indiceCodigo
 : (
 mapeoCatalogo.codigoBarras ??
 mapeoCatalogo.codigoInterno ??
 mapeoCatalogo.claveProveedor ??
 0
 );

 const columnas =
 mapaColumnas.columnas || {};

 const parser =
 typeof parserCatalogoProveedor === "function"
 ? parserCatalogoProveedor(catalogoProveedor)
 : { extraerProducto: extraerProductoGenericoCatalogo };

 return parser.extraerProducto({
 datos,
 columnas,
 mapeoCatalogo,
 indiceCodigoProducto,
 codigoNormalizado,
 codigosAlternos,
 catalogoProveedor
 });
 }
 }
 }

 return catalogo.find(
 item =>
 normalizarCodigo(item.codigo) ===
 codigoNormalizado
 ) || null;
}

async function llenarFormularioConProductoCatalogo(producto) {
 mostrarInventario();
 mostrarFormularioAgregar();
 asegurarSelectorTipoPrecio();
 seleccionarTipoProducto("catalogo");

 if (!producto.proveedor) {
 producto.proveedor =
 localStorage.getItem("ultimoProveedorCatalogo") ||
 ultimoProveedorCatalogo() ||
 "Diprofer" ||
 "";
 }

 document.getElementById("nuevoCodigo").value =
 producto.codigo || "";

 document.getElementById("nuevoCodigo").setAttribute(
 "autocomplete",
 "off"
 );

 document.getElementById("nuevoStock").setAttribute(
 "autocomplete",
 "off"
 );

 document.getElementById("nuevoNombre").value =
 producto.nombre || "";

 document.getElementById("precioDistribuidor").value =
 producto.distribuidor || "";

 document.getElementById("precioMayoreo").value =
 producto.medioMayoreo || "";

 document.getElementById("precioPublico").value =
 producto.publico || "";

 const precioVenta =
 document.getElementById("nuevoPrecio");

 precioVenta.dataset.distribuidor =
 producto.distribuidor || "";

 precioVenta.dataset.medioMayoreo =
 producto.medioMayoreo || "";

 precioVenta.dataset.publico =
 producto.publico || "";

 precioVenta.dataset.precioDetectado =
 producto.precioDetectado || "medio mayoreo";

 document.getElementById("tipoPrecioVenta").value =
 "medioMayoreo";

 const opcionMedioMayoreo =
 document.querySelector("#tipoPrecioVenta option[value='medioMayoreo']");

 if (opcionMedioMayoreo) {
 opcionMedioMayoreo.textContent =
 producto.precioDetectado === "medio mayoreo con IVA"
 ? "Medio mayoreo con IVA"
 : "Medio mayoreo";
 }

 precioVenta.value =
 producto.medioMayoreo ||
 producto.publico ||
 producto.distribuidor ||
 "";

 document.getElementById("nuevoStock").value =
 "1";

 document.getElementById("nuevoProveedor").value =
 producto.proveedor || "";

 document.getElementById("nuevoCodigoInterno").value =
 producto.codigoInterno || "";

 document.getElementById("codigosRelacionados").value =
 (producto.codigosRelacionados || [])
 .join(", ");

 document.getElementById("nuevaCategoria").value =
 producto.categoria || "";

 document.getElementById("nuevaMarca").value =
 producto.marca || "";

 document.getElementById("nuevaDescripcion").value =
 producto.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto.unidadVenta || "pieza";

 document.getElementById("presentacionCompra").value =
 producto.presentacionCompra || "";

 document.getElementById("factorConversion").value =
 producto.factorConversion || "";

 document.getElementById("basculaDigital").value =
 producto.basculaDigital || "no";

 document.getElementById("stockMinimo").value =
 producto.stockMinimo || 3;

 document.getElementById("altaRotacion").value =
 producto.altaRotacion || "";

 await mostrarSugerenciaPrecioProveedor(producto);

 enfocarStockNuevoProducto();
}

function enfocarStockNuevoProducto() {
 [80, 250, 500, 900].forEach(tiempo => {
 setTimeout(() => {
 const codigo =
 document.getElementById("nuevoCodigo");

 const stock =
 document.getElementById("nuevoStock");

 codigo?.blur();
 stock?.focus();
 stock?.select();
 }, tiempo);
 });
}

function asegurarSelectorTipoPrecio() {
 if (document.getElementById("tipoPrecioVenta")) return;

 const precio =
 document.getElementById("nuevoPrecio");

 if (!precio) return;

 const selector =
 document.createElement("select");

 selector.id =
 "tipoPrecioVenta";

 selector.innerHTML = `
 <option value="medioMayoreo">Medio mayoreo</option>
 <option value="publico">Publico</option>
 <option value="distribuidor">Mayoreo / distribuidor</option>
 `;

 selector.addEventListener(
 "change",
 cambiarTipoPrecioVenta
 );

 precio.insertAdjacentElement(
 "afterend",
 selector
 );
}

function asegurarBotonSugerenciaPrecio() {
 let boton =
 document.getElementById("sugerenciaPrecioProveedor");

 if (boton) return boton;

 const referencia =
 document.getElementById("tipoPrecioVenta") ||
 document.getElementById("nuevoPrecio");

 if (!referencia) return null;

 boton =
 document.createElement("button");

 boton.type =
 "button";

 boton.id =
 "sugerenciaPrecioProveedor";

 boton.className =
 "btn-sugerencia-precio-proveedor";

 boton.style.display =
 "none";

 referencia.insertAdjacentElement("afterend", boton);

 return boton;
}

async function mostrarSugerenciaPrecioProveedor(producto) {
 const boton =
 asegurarBotonSugerenciaPrecio();

 if (!boton) return;

 boton.style.display = "none";
 boton.onclick = null;

 if (!producto?.proveedor || typeof obtenerReglasPrecioProveedor !== "function") return;

 let reglas = null;

 try {
 reglas = await obtenerReglasPrecioProveedor(producto.proveedor);
 } catch (error) {
 console.warn(error);
 return;
 }

 if (!reglas) return;

 const calculo =
 calcularPrecioSugerido(reglas, {
 publico: producto.publico || producto.medioMayoreo || producto.distribuidor || "",
 categoria: producto.categoria || "",
 codigo: producto.codigo || ""
 });

 if (!calculo) return;

 boton.textContent =
 `Usar precio sugerido: $${calculo.precioSugerido.toFixed(2)} (margen ${calculo.margen}%)`;

 boton.style.display = "inline-flex";

 boton.onclick = () => {
 const campoPrecio =
 document.getElementById("nuevoPrecio");

 if (campoPrecio) campoPrecio.value = calculo.precioSugerido;
 };
}

function asegurarEtiquetasFichaProducto() {
 const etiquetas = {
 nuevoCodigo: "Codigo de barras",
 nuevoNombre: "Nombre para vender",
 nuevoCodigoInterno: "Codigo interno / clave proveedor",
 codigosRelacionados: "Codigos alternos",
 nuevaCategoria: "Categoria",
 nuevaSubcategoria: "Subcategoria",
 nuevaMarca: "Marca",
 unidadVenta: "Unidad base de venta",
 presentacionCompra: "Presentacion de compra",
 factorConversion: "Equivalencia de compra",
 precioDistribuidor: "Precio proveedor / costo",
 precioMayoreo: "Precio medio mayoreo",
 precioPublico: "Precio publico",
 nuevoPrecio: "Precio que usara el carrito",
 tipoPrecioVenta: "Tipo de precio",
 nuevoStock: "Stock actual",
 stockMinimo: "Stock minimo",
 nuevoProveedor: "Proveedor principal",
 nuevaUbicacion: "Ubicacion",
 basculaDigital: "Bascula digital",
 nuevaDescripcion: "Descripcion / notas",
 altaRotacion: "Alta rotacion"
 };

 Object.entries(etiquetas).forEach(([id, texto]) => {
 const campo =
 document.getElementById(id);

 if (!campo || campo.closest(".campo-ficha")) return;

 const wrapper =
 document.createElement("label");

 wrapper.className =
 "campo-ficha";

 const etiqueta =
 document.createElement("span");

 etiqueta.textContent =
 texto;

 campo.parentNode.insertBefore(wrapper, campo);
 wrapper.appendChild(etiqueta);
 wrapper.appendChild(campo);
 });
}

function cambiarTipoPrecioVenta() {
 const precio =
 document.getElementById("nuevoPrecio");

 const selector =
 document.getElementById("tipoPrecioVenta");

 if (!precio || !selector) return;

 const mapa = {
 distribuidor: precio.dataset.distribuidor,
 medioMayoreo: precio.dataset.medioMayoreo,
 publico: precio.dataset.publico
 };

 precio.value =
 mapa[selector.value] ||
 precio.value ||
 "";
}

function enfocarCampoStockAhora() {
 const stock =
 document.getElementById("nuevoStock");

 stock?.focus();
 stock?.select();
}

function buscarCodigoEnter(event) {

 if (
 event.key !== "Enter"
 ) return;

 event.preventDefault();

 clearTimeout(temporizadorCodigoBarras);

 procesarCodigoBarrasPos();
 return;

 const input =
 document.getElementById(
 "busqueda"
 );

 const codigo =
 normalizarCodigo(input.value);

 // Si esta vacio:
 // pasar a dinero
 if (!codigo) {

 document
 .getElementById(
 "dinero"
 )
 ?.focus();

 return;
 }

 const producto =
 todosProductos.find(
 p =>

 normalizarCodigo(p.codigo) === codigo

 ||

 normalizarCodigo(p.id) === codigo
 );

 if (!producto) {
 const productoCatalogo =
 productoDesdeCatalogo(codigo);

 if (productoCatalogo) {
 llenarFormularioConProductoCatalogo(
 productoCatalogo
 );

 input.value = "";
 enfocarStockNuevoProducto();
 return;
 }

 alert(
 "Producto no encontrado en inventario ni catalogo"
 );

 return;
 }

 agregar(
 producto.id,
 producto.nombre,
 producto.precio
);

// limpiar buscador
input.value = "";

buscarProductos();

// regresar al buscador
setTimeout(() => {

 document
 .getElementById(
 "busqueda"
 )
 ?.focus();

}, 50);

return;
}

/* Alta, edicion y baja de producto */
async function agregarProductoNuevo(opciones = {}) {

 if (!(await validarOperacionLicenciaNexoPOS("guardar productos"))) return;

 const nombre =
 document.getElementById(
 "nuevoNombre"
 ).value;

 const precio =
 document.getElementById(
 "nuevoPrecio"
 ).value;

 const stock =
 document.getElementById(
 "nuevoStock"
 ).value;

 const codigo =
 document.getElementById(
 "nuevoCodigo"
 ).value;
const proveedor =
document.getElementById("nuevoProveedor").value;

const ubicacion =
document.getElementById("nuevaUbicacion").value;

const categoria =
document.getElementById("nuevaCategoria")?.value || "";

const subcategoria =
document.getElementById("nuevaSubcategoria")?.value || "";

const marca =
document.getElementById("nuevaMarca")?.value || "";

const descripcion =
document.getElementById("nuevaDescripcion")?.value || "";

const unidadVenta =
document.getElementById("unidadVenta")?.value || "pieza";

const precioDistribuidor =
document.getElementById("precioDistribuidor")?.value || "";

const precioMayoreo =
document.getElementById("precioMayoreo")?.value || "";

const precioPublico =
document.getElementById("precioPublico")?.value || "";

const stockMinimo =
document.getElementById("stockMinimo")?.value || 3;

const altaRotacion =
document.getElementById("altaRotacion")?.value || "";

const codigoInterno =
document.getElementById("nuevoCodigoInterno")?.value || "";

const tipoProducto =
document.getElementById("tipoProductoInventario")?.value || "catalogo";

const presentacionCompra =
document.getElementById("presentacionCompra")?.value || "";

const factorConversion =
document.getElementById("factorConversion")?.value || "";

const basculaDigital =
document.getElementById("basculaDigital")?.value || "no";

const codigosRelacionadosTexto =
document.getElementById("codigosRelacionados")?.value || "";

const codigoFinal =
normalizarCodigo(codigo) ||
(
 tipoProducto === "manual" ||
 tipoProducto === "granel" ||
 tipoProducto === "servicio"
 ? generarCodigoInternoProducto(tipoProducto, categoria)
 : normalizarCodigo(codigoInterno)
);

const codigosRelacionados =
[
 codigoInterno,
 ...codigosRelacionadosTexto.split(/[\n,; ]+/)
]
 .map(normalizarCodigo)
 .filter(Boolean);

if (codigoFinal && !normalizarCodigo(codigo)) {
 document.getElementById("nuevoCodigo").value =
 codigoFinal;
 document.getElementById("nuevoCodigo").dataset.codigoAutomatico =
 "1";
}
 if (!String(nombre || "").trim()) {
 await alertaPOS("Escribe el nombre del producto.", "Falta nombre", "alerta");
 document.getElementById("nuevoNombre")?.focus();
 return;
 }

 if (precio === "" || Number(precio) < 0) {
 await alertaPOS("Escribe un precio valido para vender.", "Falta precio", "alerta");
 document.getElementById("nuevoPrecio")?.focus();
 return;
 }

 if (stock === "" || Number(stock) < 0) {
 await alertaPOS("Escribe el stock actual. Puede ser 0 si no hay existencia.", "Falta stock", "alerta");
 document.getElementById("nuevoStock")?.focus();
 return;
 }

 const esEdicion =
 Boolean(productoEditandoId);

 const url =
 esEdicion
 ? `/editar-producto/${productoEditandoId}`
 : "/agregar-producto";

 const metodo =
 esEdicion
 ? "PUT"
 : "POST";

 const payloadProducto = {
 nombre,
 precio,
 stock,
 codigo: codigoFinal,
 proveedor,
 ubicacion,
 categoria,
 subcategoria,
 marca,
 descripcion,
 unidadVenta,
 precioDistribuidor,
 precioMayoreo,
 precioPublico,
 stockMinimo,
 altaRotacion,
 tipoProducto,
 presentacionCompra,
 factorConversion,
 basculaDigital,
 codigosRelacionados
 };

 let respuesta;
 let productoGuardado = null;
 let productoOffline = false;

 try {
 respuesta = await fetch(
 url,
 {
 method: metodo,

 headers: {
 "Content-Type":
 "application/json"
 },

 body: JSON.stringify(payloadProducto)
 }
 );
 } catch (error) {
 const idLocal =
 esEdicion
 ? productoEditandoId
 : -Date.now();

 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 esEdicion ? "producto_actualizado" : "producto_creado",
 "producto",
 esEdicion ? productoEditandoId : "",
 {
 ...payloadProducto,
 productoId: esEdicion ? productoEditandoId : null,
 localId: idLocal,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 await alertaPOS("No se pudo conectar con el servidor para guardar el producto.", "Producto no guardado", "peligro");
 return;
 }

 productoGuardado = {
 ...payloadProducto,
 id: idLocal,
 precio_publico: precioPublico || precio || 0,
 precio_mayoreo: precioMayoreo || 0,
 precio_distribuidor: precioDistribuidor || 0,
 stock_minimo: stockMinimo || 3,
 unidad_venta: unidadVenta,
 tipo_producto: tipoProducto,
 codigos_relacionados: codigosRelacionados,
 pendienteSync: true
 };
 productoOffline = true;
 }

 if (!productoOffline && !respuesta.ok) {
 await alertaPOS("El servidor no pudo guardar el producto. Revisa que el codigo no este repetido y vuelve a intentar.", "Producto no guardado", "peligro");
 return;
 }

 if (!productoGuardado) {
 const datosGuardado =
 await respuesta.json().catch(() => ({}));

 productoGuardado =
 datosGuardado.producto || {
 ...payloadProducto,
 id: datosGuardado.productoId || productoEditandoId,
 precio_publico: precioPublico || precio || 0,
 precio_mayoreo: precioMayoreo || 0,
 precio_distribuidor: precioDistribuidor || 0,
 stock_minimo: stockMinimo || 3,
 unidad_venta: unidadVenta,
 tipo_producto: tipoProducto,
 codigos_relacionados: codigosRelacionados
 };
 }

 const continuarCaptura =
 Boolean(opciones?.continuar) && !esEdicion;

 if (!continuarCaptura) {
 cerrarFormularioAgregar();
 }

 if (productoOffline) {
 if (esEdicion) {
 todosProductos =
 todosProductos.map(producto =>
 Number(producto.id) === Number(productoEditandoId)
 ? {
 ...producto,
 ...productoGuardado
 }
 : producto
 );
 } else {
 todosProductos = [
 productoGuardado,
 ...todosProductos
 ];
 }

 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
 await guardarCatalogosLocalesDesktopPOS();
 } else {
 await cargarProductos();
 }

 await alertaPOS(
 productoOffline
 ? "Producto guardado offline. Se sincronizara cuando vuelva el internet."
 : (esEdicion ? "Producto actualizado correctamente." : "Producto agregado correctamente."),
 productoOffline ? "Producto offline guardado" : (esEdicion ? "Producto actualizado" : "Producto agregado"),
 "exito"
 );

 if (continuarCaptura) {
  limpiarFormularioProductoParaSiguientePOS({
   categoria,
   subcategoria,
   proveedor,
   ubicacion,
   unidadVenta,
   tipoProducto
  });
 }
}

function limpiarFormularioProductoParaSiguientePOS(contexto = {}) {
 productoEditandoId = null;

 const limpiar = [
  "nuevoCodigo",
  "nuevoNombre",
  "nuevoCodigoInterno",
  "codigosRelacionados",
  "nuevaMarca",
  "nuevaDescripcion",
  "precioDistribuidor",
  "precioMayoreo",
  "nuevoPrecio",
  "precioPublico",
  "nuevoStock"
 ];

 limpiar.forEach(id => {
  const campo =
  document.getElementById(id);

  if (campo) {
   campo.value = "";
   delete campo.dataset.codigoAutomatico;
  }
 });

 const valoresConservados = {
  nuevaCategoria: contexto.categoria || "",
  nuevaSubcategoria: contexto.subcategoria || "",
  nuevoProveedor: contexto.proveedor || "",
  nuevaUbicacion: contexto.ubicacion || "",
  unidadVenta: contexto.unidadVenta || "pieza",
  tipoProductoInventario: contexto.tipoProducto || "catalogo"
 };

 Object.entries(valoresConservados).forEach(([id, valor]) => {
  const campo =
  document.getElementById(id);

  if (campo) campo.value = valor;
 });

 const stockMinimo =
 document.getElementById("stockMinimo");

 if (stockMinimo && !stockMinimo.value) {
  stockMinimo.value = "3";
 }

 const altaRotacion =
 document.getElementById("altaRotacion");

 if (altaRotacion) altaRotacion.value = "";

 const bascula =
 document.getElementById("basculaDigital");

 if (bascula) bascula.value = "no";

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (botonGuardar) botonGuardar.textContent = "Guardar producto";

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 if (tituloModal) tituloModal.textContent = "+ Nuevo producto";

 if (typeof seleccionarTipoProducto === "function") {
  seleccionarTipoProducto(contexto.tipoProducto || "catalogo");
 }

 if (typeof cambiarTabProductoPOS === "function") {
  cambiarTabProductoPOS("basico");
 }

 setTimeout(() => {
  const codigo =
  document.getElementById("nuevoCodigo");

  if (codigo) {
   codigo.focus();
   codigo.select();
  }
 }, 80);
}

function editarProducto(
 id,
 nombre,
 precio,
 stock,
 codigo
) {
 const producto =
 todosProductos.find(
 p =>
 Number(p.id) === Number(id)
 );

 nombre =
 nombre ?? producto?.nombre ?? "";

 precio =
 precio ?? producto?.precio ?? "";

 stock =
 stock ?? producto?.stock ?? "";

 codigo =
 codigo ?? producto?.codigo ?? "";

 productoEditandoId = id;

 mostrarFormularioAgregar();

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Editar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Actualizar producto";
 }

 document.getElementById(
 "nuevoNombre"
 ).value =
 nombre;

 document.getElementById(
 "nuevoPrecio"
 ).value =
 precio;

 document.getElementById(
 "nuevoStock"
 ).value =
 stock;

 document.getElementById(
 "nuevoCodigo"
 ).value =
 codigo || "";

 document.getElementById("nuevoProveedor").value =
 producto?.proveedor || "";

 document.getElementById("nuevaUbicacion").value =
 producto?.ubicacion || "";

 document.getElementById("nuevaCategoria").value =
 producto?.categoria || "";

 document.getElementById("nuevaSubcategoria").value =
 producto?.subcategoria || "";

 document.getElementById("nuevaMarca").value =
 producto?.marca || "";

 document.getElementById("nuevaDescripcion").value =
 producto?.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto?.unidad_venta || "pieza";

 document.getElementById("tipoProductoInventario").value =
 producto?.tipo_producto || "catalogo";

 seleccionarTipoProducto(
 producto?.tipo_producto || "catalogo"
 );

 document.getElementById("presentacionCompra").value =
 producto?.presentacion_compra || "";

 document.getElementById("factorConversion").value =
 producto?.factor_conversion || "";

 document.getElementById("basculaDigital").value =
 producto?.bascula_digital || "no";

 document.getElementById("unidadVenta").value =
 producto?.unidad_venta || "pieza";

 document.getElementById("precioDistribuidor").value =
 producto?.precio_distribuidor || "";

 document.getElementById("precioMayoreo").value =
 producto?.precio_mayoreo || "";

 document.getElementById("precioPublico").value =
 producto?.precio_publico || "";

 document.getElementById("stockMinimo").value =
 producto?.stock_minimo || 3;

 document.getElementById("altaRotacion").value =
 producto?.alta_rotacion || "";

 document.getElementById("codigosRelacionados").value =
 codigosProducto(producto)
 .filter(item => item !== normalizarCodigo(codigo || producto?.codigo))
 .join(", ");
}

async function eliminarProducto(id) {

 try {
 const respuesta =
 await fetch(
 `/eliminar-producto/${id}`,
 {
 method: "DELETE"
 }
 );

 if (!respuesta.ok) {
 await alertaPOS("No se pudo eliminar el producto.", "Producto no eliminado", "peligro");
 return;
 }

 await cargarProductos();
 return;
 } catch (error) {
 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "producto_eliminado",
 "producto",
 id,
 {
 productoId: id,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 await alertaPOS("No se pudo conectar con el servidor para eliminar el producto.", "Producto no eliminado", "peligro");
 return;
 }

 todosProductos =
 todosProductos.filter(producto => Number(producto.id) !== Number(id));

 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
 await guardarCatalogosLocalesDesktopPOS();

 await alertaPOS(
 "Producto dado de baja offline. Se sincronizara cuando vuelva el internet.",
 "Producto offline",
 "exito"
 );
 }
}

/* Inventario, categorias y formulario */
function mostrarInventario() {
 ocultarPantallasPrincipales();

 document.getElementById(
 "pantallaInventario"
 ).style.display = "block";

 abrirSubmenuInventario();
 actualizarDatalistCategorias();
 poblarFiltroCategoriaInventario();
 cargarTablaInventario();

}

function categoriasInventarioGuardadas() {
 try {
 const guardadas =
 JSON.parse(localStorage.getItem("categoriasInventario") || "[]");

 if (Array.isArray(guardadas) && guardadas.length > 0) {
 return guardadas;
 }
 } catch (error) {
 console.warn("No se pudieron leer categorias", error);
 }

 const desdeProductos =
 todosProductos
 .map(producto => String(producto.categoria || "").trim())
 .filter(Boolean);

 return [...new Set([
 ...plantillaGiroActual().categorias,
 ...desdeProductos
 ])].map((nombre, indice) => ({
 id: `cat-${normalizarTexto(nombre).replace(/[^a-z0-9]/g, "-") || indice}`,
 nombre,
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][indice % 6]
 }));
}

function guardarCategoriasInventario(categorias) {
 localStorage.setItem(
 "categoriasInventario",
 JSON.stringify(categorias)
 );

 actualizarDatalistCategorias();
}

function actualizarDatalistCategorias() {
 const lista =
 document.getElementById("listaCategoriasProducto");

 if (!lista) return;

 lista.innerHTML =
 categoriasInventarioGuardadas()
 .map(categoria => `<option value="${categoria.nombre}"></option>`)
 .join("");
}

function aplicarCategoriasDeGiro(giro = "ferreteria", reemplazar = false) {
 const plantilla =
 PLANTILLAS_GIRO_NEGOCIO[giro] || PLANTILLAS_GIRO_NEGOCIO.ferreteria;

 const existentes =
 reemplazar ? [] : categoriasInventarioGuardadas();

 const combinadas =
 [...existentes];

 plantilla.categorias.forEach((nombre, indice) => {
 const existe =
 combinadas.some(categoria =>
 normalizarTexto(categoria.nombre) === normalizarTexto(nombre)
 );

 if (!existe) {
 combinadas.push({
 id: `cat-${normalizarTexto(nombre).replace(/[^a-z0-9]/g, "-") || Date.now()}`,
 nombre,
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][indice % 6]
 });
 }
 });

 guardarCategoriasInventario(combinadas);
 return combinadas;
}

async function aplicarPlantillaGiroConfiguracion() {
 const giro =
 document.getElementById("configGiroNegocio")?.value || "ferreteria";

 const plantilla =
 PLANTILLAS_GIRO_NEGOCIO[giro] || PLANTILLAS_GIRO_NEGOCIO.ferreteria;

 const confirmar =
 await confirmarPOS(
 `Se agregaran categorias sugeridas para ${plantilla.nombre}. No se borran productos ni categorias existentes.`,
 "Aplicar plantilla",
 "info"
 );

 if (!confirmar) return;

 aplicarCategoriasDeGiro(giro, false);

 alertaPOS(
 `Categorias de ${plantilla.nombre} listas para usar.`,
 "Plantilla aplicada",
 "exito"
 );
}

function abrirSubmenuInventario() {
 const submenu =
 document.getElementById("submenuInventario");

 if (submenu) {
 submenu.classList.add("abierto");
 }
}

function toggleSubmenuInventario() {
 const submenu =
 document.getElementById("submenuInventario");

 if (!submenu) {
 mostrarInventario();
 return;
 }

 submenu.classList.toggle("abierto");
}

function mostrarCategoriasInventario() {
 ocultarPantallasPrincipales();
 abrirSubmenuInventario();
 actualizarDatalistCategorias();

 document.getElementById("pantallaCategoriasInventario").style.display =
 "block";

 const categorias = categoriasInventarioGuardadas();

 if (!categoriaSeleccionadaId || !categorias.some(categoria => categoria.id === categoriaSeleccionadaId)) {
 categoriaSeleccionadaId = categorias[0]?.id || null;
 }

 tabCategoriaActual = "productos";
 paginaCategoriaProductos = 1;

 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();
}

function productosPorCategoria(nombreCategoria) {
 const normalizada =
 normalizarTexto(nombreCategoria);

 return todosProductos.filter(producto =>
 normalizarTexto(producto.categoria || "") === normalizada
 );
}

function categoriaIconoPOS(nombre) {
 const texto = normalizarTexto(nombre || "");

 if (texto.includes("electr")) return "zap";
 if (texto.includes("herramient")) return "wrench";
 if (texto.includes("ferreter")) return "toolbox";
 if (texto.includes("plomer") || texto.includes("agua")) return "drop";
 if (texto.includes("pintura")) return "roller";
 if (texto.includes("segur")) return "shield";
 if (texto.includes("jardin")) return "leaf";
 if (texto.includes("construc")) return "building";
 return "tag";
}

function renderResumenCategorias() {
 const contenedor = document.getElementById("resumenCategoriasInventario");
 if (!contenedor) return;

 const categorias = categoriasInventarioGuardadas();
 const conProductos = categorias.filter(categoria => productosPorCategoria(categoria.nombre).length > 0);
 const productosCategorizados = todosProductos.filter(producto => String(producto.categoria || "").trim());

 contenedor.innerHTML = `
 <article class="categoria-resumen-blue">
 <span>${iconoUISVG("grid")}</span>
 <div>
 <small>Total categorias</small>
 <strong>${categorias.length}</strong>
 </div>
 </article>
 <article class="categoria-resumen-green">
 <span>${iconoUISVG("inventory")}</span>
 <div>
 <small>Productos en categorias</small>
 <strong>${productosCategorizados.length.toLocaleString("es-MX")}</strong>
 <em>Asignados a categorias</em>
 </div>
 </article>
 <article class="categoria-resumen-orange">
 <span>${iconoUISVG("tag")}</span>
 <div>
 <small>Categorias activas</small>
 <strong>${conProductos.length}</strong>
 <em>Con productos asignados</em>
 </div>
 </article>
 <article class="categoria-resumen-red">
 <span>${iconoUISVG("alert")}</span>
 <div>
 <small>Categorias sin productos</small>
 <strong>${categorias.length - conProductos.length}</strong>
 <em class="categoria-resumen-alerta">Requieren atencion</em>
 </div>
 </article>
 `;
}

function buscarCategoriasInventario() {
 renderListaCategorias();
}

function renderListaCategorias() {
 const contenedor =
 document.getElementById("listaCategoriasInventario");

 if (!contenedor) return;

 const texto = normalizarTexto(document.getElementById("buscarCategorias")?.value || "");
 const categorias = categoriasInventarioGuardadas()
 .filter(categoria => !texto || normalizarTexto(categoria.nombre).includes(texto));

 if (!categorias.length) {
 contenedor.innerHTML = `<div class="categoria-producto-vacio">No se encontraron categorias.</div>`;
 return;
 }

 contenedor.innerHTML =
 categorias.map(categoria => {
 const productos = productosPorCategoria(categoria.nombre);
 const color = categoria.color || "#0d6efd";
 const activa = categoria.id === categoriaSeleccionadaId;

 return `
 <button
 type="button"
 class="categoria-card ${activa ? "activa" : ""}"
 style="--categoria-color:${color}"
 onclick="seleccionarCategoriaInventario('${categoria.id}')"
 >
 <span class="categoria-card-icono">${iconoUISVG(categoriaIconoPOS(categoria.nombre))}</span>
 <span class="categoria-card-texto">
 <strong>${escaparPOS(categoria.nombre)}</strong>
 <small>${productos.length} productos</small>
 </span>
 </button>
 `;
 }).join("");
}

function seleccionarCategoriaInventario(id) {
 categoriaSeleccionadaId = id;
 tabCategoriaActual = "productos";
 paginaCategoriaProductos = 1;

 renderListaCategorias();
 renderDetalleCategoria();
}

function mostrarTabCategoria(tab) {
 tabCategoriaActual = tab;
 paginaCategoriaProductos = 1;
 renderDetalleCategoria();
}

function categoriaSeleccionadaActual() {
 return categoriasInventarioGuardadas().find(categoria => categoria.id === categoriaSeleccionadaId) || null;
}

function estadisticasCategoria(productos) {
 const stockTotal = productos.reduce((suma, producto) => suma + Number(producto.stock || 0), 0);
 const valorTotal = productos.reduce((suma, producto) => suma + (Number(producto.stock || 0) * Number(producto.precio || 0)), 0);
 const precioPromedio = productos.length ? productos.reduce((suma, producto) => suma + Number(producto.precio || 0), 0) / productos.length : 0;
 const sinStock = productos.filter(producto => Number(producto.stock) <= 0).length;

 return { stockTotal, valorTotal, precioPromedio, sinStock };
}

function productosCategoriaOrdenados(productos) {
 const orden = document.getElementById("ordenCategoriaProductos")?.value || ordenCategoriaProductos;
 const copia = [...productos];

 switch (orden) {
 case "nombre-desc":
 return copia.sort((a, b) => String(b.nombre || "").localeCompare(String(a.nombre || "")));
 case "stock-desc":
 return copia.sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0));
 case "stock-asc":
 return copia.sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));
 case "precio-desc":
 return copia.sort((a, b) => Number(b.precio || 0) - Number(a.precio || 0));
 case "precio-asc":
 return copia.sort((a, b) => Number(a.precio || 0) - Number(b.precio || 0));
 default:
 return copia.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")));
 }
}

function buscarProductosCategoria() {
 paginaCategoriaProductos = 1;
 renderProductosCategoriaTabla();
}

function cambiarOrdenCategoriaProductos(valor) {
 ordenCategoriaProductos = valor;
 paginaCategoriaProductos = 1;
 renderProductosCategoriaTabla();
}

function cambiarPaginaCategoriaProductos(pagina) {
 paginaCategoriaProductos = pagina;
 renderProductosCategoriaTabla();
}

function renderProductosCategoriaTabla() {
 const tabla = document.getElementById("tablaCategoriaProductos");
 if (!tabla) return;

 const categoria = categoriaSeleccionadaActual();
 if (!categoria) return;

 const texto = normalizarTexto(document.getElementById("buscarProductosCategoria")?.value || "");

 let productos = productosPorCategoria(categoria.nombre);

 if (texto) {
 productos = productos.filter(producto =>
 normalizarTexto(producto.nombre || "").includes(texto) ||
 normalizarTexto(producto.codigo || "").includes(texto)
 );
 }

 productos = productosCategoriaOrdenados(productos);

 const totalPaginas = Math.max(1, Math.ceil(productos.length / tamanoPaginaCategoriaProductos));
 paginaCategoriaProductos = Math.min(paginaCategoriaProductos, totalPaginas);

 const inicio = (paginaCategoriaProductos - 1) * tamanoPaginaCategoriaProductos;
 const productosPagina = productos.slice(inicio, inicio + tamanoPaginaCategoriaProductos);

 if (!productos.length) {
 tabla.innerHTML = `<tr><td colspan="6" class="inventario-vacio">No hay productos en esta categoria.</td></tr>`;
 } else {
 tabla.innerHTML = productosPagina.map(producto => {
 const unidad = unidadProducto(producto);
 const estado = estadoInventarioProducto(producto);

 return `
 <tr>
 <td>${producto.codigo || "-"}</td>
 <td>
 <div class="producto-inventario-celda">
 <span class="producto-inventario-icono">${iconoProducto(producto.nombre)}</span>
 <div><strong>${escaparPOS(producto.nombre || "")}</strong></div>
 </div>
 </td>
 <td>$${Number(producto.precio).toFixed(2)}</td>
 <td>${producto.stock} ${unidad}</td>
 <td><span class="estado-inventario ${estado.clase}">${estado.texto}</span></td>
 <td class="acciones-inventario">
 <button title="Editar" onclick="editarProducto(${producto.id})">${iconoUISVG("edit")}</button>
 <button title="Eliminar" class="accion-peligro" onclick="eliminarProducto(${producto.id})">${iconoUISVG("trash")}</button>
 </td>
 </tr>
 `;
 }).join("");
 }

 renderPaginacion("paginacionCategoriaProductos", productos.length, paginaCategoriaProductos, tamanoPaginaCategoriaProductos, "cambiarPaginaCategoriaProductos");

 const textoPaginacion = document.getElementById("categoriaProductosPaginacionTexto");
 if (textoPaginacion) {
 textoPaginacion.textContent = productos.length === 0
 ? "Sin productos para mostrar"
 : `Mostrando ${inicio + 1} a ${Math.min(inicio + productosPagina.length, productos.length)} de ${productos.length} productos`;
 }
}

function renderDetalleCategoria() {
 const panel = document.getElementById("detalleCategoriaInventario");
 if (!panel) return;

 const categoria = categoriaSeleccionadaActual();

 if (!categoria) {
 panel.innerHTML = `<div class="categoria-producto-vacio">Crea o selecciona una categoria para ver su detalle.</div>`;
 return;
 }

 const productos = productosPorCategoria(categoria.nombre);
 const activa = productos.length > 0;
 const stats = estadisticasCategoria(productos);
 const color = categoria.color || "#0d6efd";

 const tabs = [
 { id: "productos", etiqueta: `Productos (${productos.length})` },
 { id: "info", etiqueta: "Informacion" },
 { id: "stats", etiqueta: "Estadisticas" }
 ];

 const cuerpoTab = tabCategoriaActual === "info"
 ? `
 <div class="categoria-info-grid">
 <div><span>Nombre</span><strong>${escaparPOS(categoria.nombre)}</strong></div>
 <div><span>Color</span><strong class="categoria-info-color"><i style="background:${color}"></i>${color}</strong></div>
 <div><span>Productos asignados</span><strong>${productos.length}</strong></div>
 <div><span>Identificador</span><strong>${escaparPOS(categoria.id)}</strong></div>
 </div>
 `
 : tabCategoriaActual === "stats"
 ? `
 <div class="categoria-stats-grid">
 <div><span>Stock total</span><strong>${stats.stockTotal.toLocaleString("es-MX")}</strong></div>
 <div><span>Valor en inventario</span><strong>${dinero(stats.valorTotal)}</strong></div>
 <div><span>Precio promedio</span><strong>${dinero(stats.precioPromedio)}</strong></div>
 <div><span>Sin stock</span><strong>${stats.sinStock}</strong></div>
 </div>
 `
 : `
 <div class="categoria-productos-toolbar">
 <div class="buscador-con-limpiar">
 <input id="buscarProductosCategoria" type="text" placeholder="Buscar en productos..." oninput="buscarProductosCategoria()">
 </div>
 <label class="inventario-filtro-campo">
 <span>Ordenar</span>
 <select id="ordenCategoriaProductos" onchange="cambiarOrdenCategoriaProductos(this.value)">
 <option value="nombre-asc">A-Z</option>
 <option value="nombre-desc">Z-A</option>
 <option value="stock-desc">Stock: mayor a menor</option>
 <option value="stock-asc">Stock: menor a mayor</option>
 <option value="precio-desc">Precio: mayor a menor</option>
 <option value="precio-asc">Precio: menor a mayor</option>
 </select>
 </label>
 </div>
 <table class="tabla-inventario">
 <thead>
 <tr>
 <th>Codigo</th>
 <th>Producto</th>
 <th>Precio</th>
 <th>Stock</th>
 <th>Estado</th>
 <th>Acciones</th>
 </tr>
 </thead>
 <tbody id="tablaCategoriaProductos"></tbody>
 </table>
 <div class="inventario-paginacion-footer">
 <span id="categoriaProductosPaginacionTexto"></span>
 <div id="paginacionCategoriaProductos" class="paginacion-tabla"></div>
 </div>
 `;

 panel.innerHTML = `
 <div class="categoria-detalle-header" style="--categoria-color:${color}">
 <span class="categoria-detalle-icono">${iconoUISVG(categoriaIconoPOS(categoria.nombre))}</span>
 <div class="categoria-detalle-titulo">
 <div class="categoria-detalle-nombre">
 <h3>${escaparPOS(categoria.nombre)}</h3>
 <span class="categoria-badge ${activa ? "activa" : "vacia"}">${activa ? "Activa" : "Sin productos"}</span>
 </div>
 <small>${productos.length} productos asignados</small>
 </div>
 <div class="categoria-detalle-acciones">
 <button type="button" class="btn-categoria-editar" onclick="editarCategoriaInventario('${categoria.id}')">${iconoUISVG("edit")}<span>Editar</span></button>
 <button type="button" class="btn-categoria-eliminar" onclick="eliminarCategoriaInventario('${categoria.id}')">${iconoUISVG("trash")}<span>Eliminar</span></button>
 </div>
 </div>
 <div class="categoria-tabs">
 ${tabs.map(tab => `
 <button type="button" class="${tabCategoriaActual === tab.id ? "activo" : ""}" onclick="mostrarTabCategoria('${tab.id}')">${tab.etiqueta}</button>
 `).join("")}
 </div>
 <div class="categoria-tab-cuerpo">
 ${cuerpoTab}
 </div>
 `;

 if (tabCategoriaActual === "productos") {
 renderProductosCategoriaTabla();
 }
}

async function abrirFormularioCategoria() {
 const nombre =
 await pedirTextoPOS(
 "Nombre de la categoria:",
 "",
 "Nueva categoria"
 );

 if (!nombre) return;

 const categorias =
 categoriasInventarioGuardadas();

 const existe =
 categorias.some(categoria =>
 normalizarTexto(categoria.nombre) === normalizarTexto(nombre)
 );

 if (existe) {
 alertaPOS("Esa categoria ya existe.", "Categorias", "info");
 return;
 }

 const nuevaCategoria = {
 id: `cat-${Date.now()}`,
 nombre: nombre.trim(),
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][categorias.length % 6]
 };

 categorias.push(nuevaCategoria);

 guardarCategoriasInventario(categorias);
 categoriaSeleccionadaId = nuevaCategoria.id;
 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();
}

async function editarCategoriaInventario(id) {
 const categorias = categoriasInventarioGuardadas();
 const categoria = categorias.find(item => item.id === id);
 if (!categoria) return;

 const nombre = await pedirTextoPOS(
 "Nuevo nombre de la categoria:",
 categoria.nombre,
 "Editar categoria"
 );

 if (!nombre || normalizarTexto(nombre) === normalizarTexto(categoria.nombre)) return;

 const existe = categorias.some(item =>
 item.id !== id && normalizarTexto(item.nombre) === normalizarTexto(nombre)
 );

 if (existe) {
 alertaPOS("Ya existe una categoria con ese nombre.", "Categorias", "info");
 return;
 }

 categoria.nombre = nombre.trim();
 guardarCategoriasInventario(categorias);
 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();
}

async function eliminarCategoriaInventario(id) {
 const confirmar =
 await confirmarPOS(
 "Eliminar esta categoria? Los productos no se borran.",
 "Eliminar categoria",
 "alerta"
 );

 if (!confirmar) return;

 guardarCategoriasInventario(
 categoriasInventarioGuardadas()
 .filter(categoria => categoria.id !== id)
 );

 if (categoriaSeleccionadaId === id) {
 categoriaSeleccionadaId = categoriasInventarioGuardadas()[0]?.id || null;
 }

 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();
}

function filtrarInventarioPorCategoria(nombreCategoria) {
 mostrarInventario();

 const campo =
 document.getElementById("buscarInventario");

 if (campo) {
 campo.value = nombreCategoria;
 }

 buscarInventario();
}

function limpiarBusquedaInventario() {
 const campo =
 document.getElementById("buscarInventario");

 if (campo) {
 campo.value = "";
 campo.focus();
 }

 buscarInventario();
}

function limpiarBusquedaPos() {
 const campo =
 document.getElementById("busqueda");

 if (campo) {
 campo.value = "";
 campo.focus();
 }

 buscarProductos();
}

function enfocarBusquedaVentaRapida(limpiar = false) {
 const campo =
 document.getElementById("busqueda");

 if (!campo) return;

 if (limpiar) {
  campo.value = "";
  buscarProductos();
 }

 setTimeout(() => {
  campo.focus();
  campo.select();
 }, 120);
}

function mostrarPuntoVenta() {
 ocultarPantallasPrincipales();

 document.getElementById(
 "pantallaPuntoVenta"
 ).style.display = "block";

 actualizarClientePOS();
 enfocarBusquedaVentaRapida(false);
}

function estadoInventarioProducto(producto) {
 const stock = Number(producto.stock);

 if (stock <= 0) return { clase: "sin-stock", texto: "Sin stock" };
 if (stock <= 5) return { clase: "bajo", texto: "Bajo" };
 return { clase: "ok", texto: "En stock" };
}

function productosInventarioFiltrados() {
 const campo =
 document.getElementById("buscarInventario");

 const texto =
 (campo?.value || "")
 .toLowerCase()
 .trim();

 const categoriaFiltro =
 document.getElementById("filtroInventarioCategoria")?.value || "";

 const estadoFiltro =
 document.getElementById("filtroInventarioEstado")?.value || "";

 return todosProductos.filter(producto => {
 if (texto) {
  const coincide =
  String(producto.codigo || "").toLowerCase().includes(texto) ||
  String(producto.nombre || "").toLowerCase().includes(texto) ||
  String(producto.precio || "").toLowerCase().includes(texto) ||
  String(producto.proveedor || "").toLowerCase().includes(texto) ||
  String(producto.categoria || "").toLowerCase().includes(texto);

  if (!coincide) return false;
 }

 if (categoriaFiltro && String(producto.categoria || "") !== categoriaFiltro) {
  return false;
 }

 if (estadoFiltro && estadoInventarioProducto(producto).clase !== estadoFiltro) {
  return false;
 }

 return true;
 });
}

function poblarFiltroCategoriaInventario() {
 const select =
 document.getElementById("filtroInventarioCategoria");

 if (!select) return;

 const valorActual = select.value;

 const nombres =
 [...new Set(categoriasInventarioGuardadas().map(categoria => categoria.nombre).filter(Boolean))]
 .sort((a, b) => a.localeCompare(b));

 select.innerHTML =
 '<option value="">Todas</option>' +
 nombres.map(nombre => `<option value="${escaparPOS(nombre)}">${escaparPOS(nombre)}</option>`).join("");

 if (nombres.includes(valorActual)) select.value = valorActual;
}

function filtrarInventario() {
 paginaInventario = 1;
 cargarTablaInventario();
}

function limpiarFiltrosInventario() {
 const categoria = document.getElementById("filtroInventarioCategoria");
 const estado = document.getElementById("filtroInventarioEstado");

 if (categoria) categoria.value = "";
 if (estado) estado.value = "";

 limpiarBusquedaInventario();
}

function cambiarTamanoPaginaInventario(valor) {
 tamanoPaginaInventarioActual = Number(valor) || TAMANO_PAGINA_INVENTARIO;
 paginaInventario = 1;
 cargarTablaInventario();
}

function renderResumenInventario() {
 const total = todosProductos.length;
 const stockTotal = todosProductos.reduce((suma, producto) => suma + Number(producto.stock || 0), 0);
 const valorInventario = todosProductos.reduce((suma, producto) => suma + (Number(producto.stock || 0) * Number(producto.precio || 0)), 0);
 const sinStock = todosProductos.filter(producto => Number(producto.stock) <= 0).length;

 const elementoTotal = document.getElementById("resumenInventarioTotal");
 const elementoStock = document.getElementById("resumenInventarioStock");
 const elementoValor = document.getElementById("resumenInventarioValor");
 const elementoSinStock = document.getElementById("resumenInventarioSinStock");

 if (elementoTotal) elementoTotal.textContent = total.toLocaleString("es-MX");
 if (elementoStock) elementoStock.textContent = stockTotal.toLocaleString("es-MX");
 if (elementoValor) elementoValor.textContent = dinero(valorInventario);
 if (elementoSinStock) elementoSinStock.textContent = sinStock.toLocaleString("es-MX");
}

function buscarInventario() {
 paginaInventario = 1;
 cargarTablaInventario();
}

function toggleVistaProductosPOS() {
 const listado =
 document.getElementById("productos");

 if (!listado) return;

 listado.classList.toggle("productos-lista-pos");
}

function enfocarFiltroPOS() {
 const buscador =
 document.getElementById("busqueda");

 if (!buscador) return;

 buscador.focus();
 buscador.select();
 buscador.closest(".buscador-con-limpiar")?.classList.add("filtro-activo-pos");
 setTimeout(() => {
  buscador.closest(".buscador-con-limpiar")?.classList.remove("filtro-activo-pos");
 }, 1400);
}

function paginasVisiblesPaginacion(paginaActual, totalPaginas) {
 const vecinos = new Set([1, totalPaginas, paginaActual - 1, paginaActual, paginaActual + 1]);

 return [...vecinos]
 .filter(pagina => pagina >= 1 && pagina <= totalPaginas)
 .sort((a, b) => a - b);
}

function renderPaginacion(contenedorId, totalItems, paginaActual, tamanoPagina, funcionCambio) {
 const contenedor =
 document.getElementById(contenedorId);

 if (!contenedor) return;

 const totalPaginas =
 Math.max(1, Math.ceil(totalItems / tamanoPagina));

 if (totalPaginas <= 1) {
 contenedor.innerHTML = "";
 return;
 }

 const visibles =
 paginasVisiblesPaginacion(paginaActual, totalPaginas);

 const botones = [];
 let anterior = 0;

 visibles.forEach(pagina => {
 if (anterior && pagina - anterior > 1) {
  botones.push(`<span class="paginacion-tabla-puntos">...</span>`);
 }

 botones.push(`
 <button
 class="${pagina === paginaActual ? "activo" : ""}"
 onclick="${funcionCambio}(${pagina})"
 >
 ${pagina}
 </button>
 `);

 anterior = pagina;
 });

 contenedor.innerHTML = `
 <button onclick="${funcionCambio}(${Math.max(1, paginaActual - 1)})">
 Anterior
 </button>
 ${botones.join("")}
 <button onclick="${funcionCambio}(${Math.min(totalPaginas, paginaActual + 1)})">
 Siguiente
 </button>
 `;
}

function cambiarPaginaInventario(pagina) {
 paginaInventario = pagina;
 cargarTablaInventario();
}

function cambiarPaginaInventarioBajo(pagina) {
 paginaInventarioBajo = pagina;
 renderInventarioBajo(false);
}

function cambiarPaginaReporteVentas(pagina) {
 paginaReporteVentas = pagina;
 cargarReportesVentas();
}

function actualizarTextoPaginacionInventario(total, inicio, fin) {
 const elemento =
 document.getElementById("inventarioPaginacionTexto");

 if (!elemento) return;

 elemento.textContent =
 total === 0
 ? "Sin productos para mostrar"
 : `Mostrando ${inicio + 1} a ${Math.min(fin, total)} de ${total} productos`;
}

function cargarTablaInventario() {
 const tabla =
 document.getElementById("tablaInventario");

 if (!tabla) return;

 tabla.innerHTML = "";

 const productos =
 productosInventarioFiltrados();

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(productos.length / tamanoPaginaInventarioActual)
 );

 paginaInventario =
 Math.min(paginaInventario, totalPaginas);

 const inicio =
 (paginaInventario - 1) * tamanoPaginaInventarioActual;

 const productosPagina =
 productos.slice(
 inicio,
 inicio + tamanoPaginaInventarioActual
 );

 if (productos.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="7" class="inventario-vacio">
 No se encontraron productos.
 </td>
 </tr>
 `;
 renderPaginacion(
 "paginacionInventario",
 0,
 1,
 tamanoPaginaInventarioActual,
 "cambiarPaginaInventario"
 );
 actualizarTextoPaginacionInventario(0, 0, 0);
 renderResumenInventario();
 return;
 }

 productosPagina.forEach((producto) => {
 const unidad =
 unidadProducto(producto);

 const estado =
 estadoInventarioProducto(producto);

 tabla.innerHTML += `
 <tr>
 <td>${producto.codigo || "-"}</td>
 <td>
 <div class="producto-inventario-celda">
 <span class="producto-inventario-icono">${iconoProducto(producto.nombre)}</span>
 <div>
 <strong>${escaparPOS(producto.nombre || "")}</strong>
 ${producto.subcategoria ? `<small>${escaparPOS(producto.subcategoria)}</small>` : ""}
 </div>
 </div>
 </td>
 <td>${escaparPOS(producto.categoria || "-")}</td>
 <td>$${Number(producto.precio).toFixed(2)}</td>
 <td>${producto.stock} ${unidad}</td>
 <td>
 <span class="estado-inventario ${estado.clase}">
 ${estado.texto}
 </span>
 </td>
 <td class="acciones-inventario">
 <button title="Editar" onclick="editarProducto(${producto.id})">${iconoUISVG("edit")}</button>
 <button title="Eliminar" class="accion-peligro" onclick="eliminarProducto(${producto.id})">${iconoUISVG("trash")}</button>
 </td>
 </tr>
 `;
 });

 renderPaginacion(
 "paginacionInventario",
 productos.length,
 paginaInventario,
 tamanoPaginaInventarioActual,
 "cambiarPaginaInventario"
 );

 actualizarTextoPaginacionInventario(productos.length, inicio, inicio + productosPagina.length);
 renderResumenInventario();
}

function imprimirCodigosBarrasInventario() {
 const productos =
 productosInventarioFiltrados();

 if (!productos.length) {
 alertaPOS("No hay productos para imprimir con los filtros actuales.", "Imprimir codigos", "info");
 return;
 }

 if (typeof JsBarcode !== "function") {
 alertaPOS("No se pudo cargar el generador de codigos de barras. Revisa tu conexion a internet e intenta de nuevo.", "Imprimir codigos", "alerta");
 return;
 }

 const negocio =
 configuracionNegocio() || {};

 const etiquetas =
 productos.map(producto => {
 const codigo =
 String(producto.codigo || "").trim();

 if (!codigo) return "";

 const svg =
 document.createElementNS("http://www.w3.org/2000/svg", "svg");

 try {
 JsBarcode(svg, codigo, {
 format: "CODE128",
 width: 1.6,
 height: 42,
 fontSize: 12,
 margin: 6,
 displayValue: true
 });
 } catch (error) {
 console.warn("No se pudo generar codigo de barras para", codigo, error);
 return "";
 }

 return `
 <div class="etiqueta-producto">
 <strong>${escaparPOS(producto.nombre || "")}</strong>
 <div class="etiqueta-barcode">${svg.outerHTML}</div>
 <span>${dinero(producto.precio || 0)}</span>
 </div>
 `;
 }).filter(Boolean).join("");

 if (!etiquetas) {
 alertaPOS("Ninguno de los productos filtrados tiene codigo asignado todavia.", "Imprimir codigos", "info");
 return;
 }

 const ventana =
 window.open("", "_blank", "width=900,height=720");

 ventana.document.write(`
 <html>
 <head>
 <title>Codigos de barras - ${escaparPOS(negocio.nombre || "")}</title>
 <style>
 body{font-family:Arial,sans-serif;color:#111827;padding:20px;}
 h1{font-size:18px;margin:0 0 4px;}
 p{margin:0 0 18px;color:#475467;font-size:12px;}
 .hoja-etiquetas{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
 .etiqueta-producto{border:1px solid #d0d5dd;border-radius:8px;padding:10px;text-align:center;page-break-inside:avoid;}
 .etiqueta-producto strong{display:block;font-size:12px;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .etiqueta-barcode svg{max-width:100%;}
 .etiqueta-producto span{display:block;margin-top:4px;font-size:13px;font-weight:700;}
 @media print{
 .etiqueta-producto{break-inside:avoid;}
 }
 </style>
 </head>
 <body>
 <h1>${escaparPOS(negocio.nombre || "Codigos de barras")}</h1>
 <p>${new Date().toLocaleString("es-MX")} - ${productos.length} producto(s)</p>
 <div class="hoja-etiquetas">${etiquetas}</div>
 <script>window.print();</script>
 </body>
 </html>
 `);
 ventana.document.close();
}

function mostrarFormularioAgregar() {
 asegurarSelectorTipoPrecio();
 asegurarEtiquetasFichaProducto();
 inicializarCampoCodigoProducto();

 if (!productoEditandoId) {
 const botonSugerencia =
 asegurarBotonSugerenciaPrecio();

 if (botonSugerencia) botonSugerencia.style.display = "none";
 }

 document
 .getElementById("nuevoCodigo")
 ?.setAttribute("autocomplete", "off");

 document
 .getElementById("nuevoStock")
 ?.setAttribute("autocomplete", "off");

 if (!productoEditandoId) {
 seleccionarTipoProducto(
 document.getElementById("tipoProductoInventario")?.value ||
 "catalogo"
 );

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Agregar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Guardar producto";
 }
 }

 document.getElementById(
 "modalAgregar"
 ).style.display = "flex";

 setTimeout(() => {
 const campoCodigo =
 document.getElementById("nuevoCodigo");

 campoCodigo?.focus();
 campoCodigo?.select();
 }, 80);
}

function inicializarCampoCodigoProducto() {
 const campo =
 document.getElementById("nuevoCodigo");

 if (!campo || campo.dataset.lectorListo === "1") return;

 campo.dataset.lectorListo = "1";

 const buscarConPausa = () => {
 clearTimeout(campo._temporizadorCatalogo);
 campo._temporizadorCatalogo =
 setTimeout(buscarEnCatalogo, 80);
 };

 campo.addEventListener("input", buscarConPausa);
 campo.addEventListener("change", buscarEnCatalogo);
 campo.addEventListener("paste", buscarConPausa);
 campo.addEventListener("keydown", event => {
 if (event.key === "Enter") {
 event.preventDefault();
 buscarEnCatalogo();
 }
 });
}

function cerrarFormularioAgregar() {
 productoEditandoId = null;

 document.getElementById("nuevoCodigo").value = "";
 delete document.getElementById("nuevoCodigo").dataset.codigoAutomatico;
 document.getElementById("nuevoNombre").value = "";
 document.getElementById("precioDistribuidor").value = "";
 document.getElementById("precioMayoreo").value = "";
 document.getElementById("nuevoPrecio").value = "";
 document.getElementById("nuevoStock").value = "";
 document.getElementById("stockMinimo").value = "3";
 document.getElementById("nuevoProveedor").value = "";
 document.getElementById("nuevaUbicacion").value = "";
 document.getElementById("altaRotacion").value = "";
 document.getElementById("nuevoCodigoInterno").value = "";
 document.getElementById("codigosRelacionados").value = "";
 document.getElementById("nuevaCategoria").value = "";
 document.getElementById("nuevaSubcategoria").value = "";
 document.getElementById("nuevaMarca").value = "";
 document.getElementById("nuevaDescripcion").value = "";
 document.getElementById("unidadVenta").value = "pieza";
 document.getElementById("precioPublico").value = "";
 document.getElementById("tipoProductoInventario").value = "catalogo";
 document.getElementById("presentacionCompra").value = "";
 document.getElementById("factorConversion").value = "";
 document.getElementById("basculaDigital").value = "no";
 seleccionarTipoProducto("catalogo");

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Agregar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Guardar producto";
 }

 document.getElementById(
 "modalAgregar"
 ).style.display = "none";
}
function buscarEnCatalogo() {
 const codigo =
 normalizarCodigo(
 document
 .getElementById("nuevoCodigo")
 .value
 );

 if (!codigo) {
 document.getElementById("nuevoNombre").value = "";
 document.getElementById("precioDistribuidor").value = "";
 document.getElementById("precioMayoreo").value = "";
 document.getElementById("nuevoPrecio").value = "";
 document.getElementById("precioPublico").value = "";
 document.getElementById("nuevoProveedor").value = "";
 document.getElementById("nuevoCodigoInterno").value = "";
 document.getElementById("codigosRelacionados").value = "";
 document.getElementById("nuevaCategoria").value = "";
 document.getElementById("nuevaMarca").value = "";
 document.getElementById("nuevaDescripcion").value = "";
 document.getElementById("stockMinimo").value = "3";
 document.getElementById("altaRotacion").value = "";
 document.getElementById("presentacionCompra").value = "";
 document.getElementById("factorConversion").value = "";
 document.getElementById("basculaDigital").value = "no";
 return;
 }

 const producto =
 productoDesdeCatalogo(codigo);

 if (!producto) return;

 seleccionarTipoProducto("catalogo");

 document.getElementById(
 "nuevoNombre"
 ).value =
 producto.nombre || "";

 document.getElementById(
 "precioDistribuidor"
 ).value =
 producto.distribuidor || "";

 document.getElementById(
 "precioMayoreo"
 ).value =
 producto.medioMayoreo || "";

 document.getElementById(
 "nuevoPrecio"
 ).value =
 producto.medioMayoreo ||
 producto.publico ||
 producto.distribuidor ||
 "";

 document.getElementById("precioPublico").value =
 producto.publico || "";

 document.getElementById("nuevoPrecio").dataset.distribuidor =
 producto.distribuidor || "";

 document.getElementById("nuevoPrecio").dataset.medioMayoreo =
 producto.medioMayoreo || "";

 document.getElementById("nuevoPrecio").dataset.publico =
 producto.publico || "";

 document.getElementById("nuevoPrecio").dataset.precioDetectado =
 producto.precioDetectado || "medio mayoreo";

 document.getElementById("tipoPrecioVenta").value =
 "medioMayoreo";

 const opcionMedioMayoreo =
 document.querySelector("#tipoPrecioVenta option[value='medioMayoreo']");

 if (opcionMedioMayoreo) {
 opcionMedioMayoreo.textContent =
 producto.precioDetectado === "medio mayoreo con IVA"
 ? "Medio mayoreo con IVA"
 : "Medio mayoreo";
 }

 document.getElementById("nuevoProveedor").value =
 producto.proveedor ||
 localStorage.getItem("ultimoProveedorCatalogo") ||
 ultimoProveedorCatalogo() ||
 "Diprofer";

 document.getElementById("nuevoCodigoInterno").value =
 producto.codigoInterno || "";

 document.getElementById("codigosRelacionados").value =
 (producto.codigosRelacionados || [])
 .join(", ");

 document.getElementById("nuevaCategoria").value =
 producto.categoria || "";

 document.getElementById("nuevaMarca").value =
 producto.marca || "";

 document.getElementById("nuevaDescripcion").value =
 producto.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto.unidadVenta || "pieza";

 document.getElementById(
 "stockMinimo"
 ).value =
 producto.stockMinimo || 3;

 document.getElementById(
 "altaRotacion"
 ).value =
 producto.altaRotacion || "";

 enfocarStockNuevoProducto();

}

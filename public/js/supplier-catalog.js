const archivoCatalogo =
 document.getElementById("archivoCatalogo");

archivoCatalogo.addEventListener(
 "catalogo-antiguo-desactivado",
 function (e) {
 return;

 const archivo = e.target.files[0];

 if (!archivo) return;

 const lector = new FileReader();

 lector.onload = function (evento) {
 const texto = evento.target.result;

 localStorage.setItem(
 "catalogoProveedorCsv",
 texto
 );

 alert("Catalogo actualizado correctamente ");
 };

 lector.readAsText(archivo);
 }
);

archivoCatalogo.addEventListener(
 "change",
 function (e) {
 procesarArchivosCatalogo(e.target.files);
 }
);

function catalogosGuardados() {
 try {
 return JSON.parse(
 localStorage.getItem("catalogosProveedor") || "[]"
 );
 } catch (error) {
 return [];
 }
}

function plantillasCatalogoBase() {
 return [
 {
 id: "global-truper-csv",
 alcance: "global",
 giro: "Ferreteria",
 proveedor: "Truper",
 nombre: "Truper CSV oficial",
 mapeo: {
 codigoInterno: "codigo",
 claveProveedor: "clave",
 nombre: "descripcion",
 unidadVenta: "unidad",
 codigoBarras: "ean",
 costo: "precio distribuidor con IVA",
 medioMayoreo: "precio mayoreo con IVA",
 publico: "precio publico con IVA",
 marca: "Marca",
 categoria: "Descripcion SAT"
 }
 }
 ];
}

function plantillasCatalogoUsuario() {
 try {
 return JSON.parse(
 localStorage.getItem("plantillasCatalogo") || "[]"
 );
 } catch (error) {
 return [];
 }
}

function todasPlantillasCatalogo() {
 return [
 ...plantillasCatalogoBase(),
 ...plantillasCatalogoUsuario()
 ];
}

function guardarPlantillaCatalogo(plantilla) {
 const actuales =
 plantillasCatalogoUsuario();

 const id =
 plantilla.id ||
 `plantilla-${Date.now()}`;

 const nueva = {
 ...plantilla,
 id,
 alcance: "privada",
 fecha: new Date().toISOString()
 };

 const actualizadas = [
 nueva,
 ...actuales.filter(item => item.id !== id)
 ];

 localStorage.setItem(
 "plantillasCatalogo",
 JSON.stringify(actualizadas)
 );

 return nueva;
}

function normalizarNombreColumnaCatalogo(nombre) {
 return normalizarEncabezadoCatalogo(nombre);
}

function encabezadosCatalogo(csv) {
 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapa =
 detectarColumnasCatalogo(lineas);

 const indice =
 mapa.indice >= 0 ? mapa.indice : 0;

 return separarFilaCatalogo(lineas[indice] || "")
 .map((nombre, indiceColumna) => ({
 nombre: limpiarTextoCatalogo(nombre) || `Columna ${indiceColumna + 1}`,
 indice: indiceColumna
 }));
}

function buscarPlantillaPorProveedor(proveedor) {
 const texto =
 normalizarEncabezadoCatalogo(proveedor);

 return todasPlantillasCatalogo().find(plantilla =>
 normalizarEncabezadoCatalogo(plantilla.proveedor) === texto
 ) || null;
}

function indiceColumnaPorNombre(encabezados, nombre) {
 const buscado =
 normalizarNombreColumnaCatalogo(nombre);

 if (!buscado) return "";

 const encontrado =
 encabezados.find(columna =>
 normalizarNombreColumnaCatalogo(columna.nombre) === buscado
 );

 return encontrado ? encontrado.indice : "";
}

function mapeoDetectadoCatalogo(csv, plantilla = null) {
 const encabezados =
 encabezadosCatalogo(csv);

 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const detectado =
 detectarColumnasCatalogo(lineas).columnas || {};

 const desdePlantilla = {};

 if (plantilla?.mapeo) {
 Object.entries(plantilla.mapeo).forEach(([campo, columna]) => {
 desdePlantilla[campo] =
 indiceColumnaPorNombre(encabezados, columna);
 });
 }

 return {
 codigoInterno:
 desdePlantilla.codigoInterno !== undefined
 ? desdePlantilla.codigoInterno
 : (detectado.codigo ?? ""),
 claveProveedor:
 desdePlantilla.claveProveedor !== undefined
 ? desdePlantilla.claveProveedor
 : (detectado.codigoInterno ?? ""),
 nombre:
 desdePlantilla.nombre !== undefined
 ? desdePlantilla.nombre
 : (detectado.descripcion ?? detectado.nombre ?? ""),
 codigoBarras:
 desdePlantilla.codigoBarras !== undefined
 ? desdePlantilla.codigoBarras
 : (detectado.codigo ?? ""),
 unidadVenta:
 desdePlantilla.unidadVenta !== undefined
 ? desdePlantilla.unidadVenta
 : "",
 costo:
 desdePlantilla.costo !== undefined
 ? desdePlantilla.costo
 : (detectado.distribuidor ?? ""),
 medioMayoreo:
 desdePlantilla.medioMayoreo !== undefined
 ? desdePlantilla.medioMayoreo
 : (detectado.medioMayoreoIva ?? detectado.medioMayoreo ?? ""),
 publico:
 desdePlantilla.publico !== undefined
 ? desdePlantilla.publico
 : (detectado.publico ?? ""),
 marca:
 desdePlantilla.marca !== undefined
 ? desdePlantilla.marca
 : (detectado.marca ?? ""),
 categoria:
 desdePlantilla.categoria !== undefined
 ? desdePlantilla.categoria
 : (detectado.categoria ?? ""),
 ignorar: ""
 };
}

function guardarCatalogosProveedor(catalogos) {
 try {
 const catalogosListos =
 catalogos.map(prepararCatalogoParaGuardar);

 localStorage.removeItem("catalogoProveedorCsv");

 localStorage.setItem(
 "catalogosProveedor",
 JSON.stringify(catalogosListos)
 );

 localStorage.setItem(
 "catalogoProveedorCsv",
 catalogosListos[0]?.csv || ""
 );

 return true;
 } catch (error) {
 console.error("No se pudo guardar el catalogo", error);

 if (typeof alertaPOS === "function") {
 alertaPOS(
 "No se pudo guardar el catalogo porque el navegador se quedo sin espacio. Borra catalogos viejos o guarda menos archivos grandes por ahora.",
 "Catalogo no guardado",
 "error"
 );
 } else {
 alert("No se pudo guardar el catalogo porque el navegador se quedo sin espacio.");
 }

 return false;
 }
}

function ultimoProveedorCatalogo() {
 const catalogos =
 catalogosGuardados();

 return catalogos[0]?.proveedor || "";
}

function nombreProveedorDesdeArchivo(nombreArchivo) {
 return String(nombreArchivo || "Proveedor")
 .replace(/\.[^/.]+$/, "")
 .replace(/[-_]+/g, " ")
 .trim() || "Proveedor";
}

async function pedirNombreCatalogo(nombreArchivo) {
 const sugerido =
 nombreProveedorDesdeArchivo(nombreArchivo);

 const nombre =
 await pedirTextoPOS(
 "Nombre del proveedor o distribuidor de este catalogo:",
 sugerido,
 "Catalogo proveedor"
 );

 return nombre || sugerido;
}

function contarProductosCatalogo(csv) {
 return String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(linea => linea && linea.split(",").length > 2)
 .length;
}

async function abrirAsistenteCatalogo(archivo, csv) {
 const proveedorSugerido =
 nombreProveedorDesdeArchivo(archivo.name);

 const proveedor =
 await pedirTextoPOS(
 "Nombre del proveedor o distribuidor:",
 proveedorSugerido,
 "Catalogo proveedor"
 ) || proveedorSugerido;

 const plantilla =
 buscarPlantillaPorProveedor(proveedor);

 return abrirMapeoCatalogo({
 proveedor,
 archivo: archivo.name,
 csv,
 plantilla
 });
}

function opcionesColumnasCatalogo(encabezados, valorActual) {
 const opciones =
 [
 `<option value="">Ignorar / no usar</option>`,
 ...encabezados.map(columna => `
 <option value="${columna.indice}" ${String(valorActual) === String(columna.indice) ? "selected" : ""}>
 ${columna.nombre}
 </option>
 `)
 ];

 return opciones.join("");
}

async function abrirMapeoCatalogo({ proveedor, archivo, csv, plantilla }) {
 const encabezados =
 encabezadosCatalogo(csv);

 const mapeo =
 mapeoDetectadoCatalogo(csv, plantilla);

 const campos = [
 ["codigoBarras", "Codigo de barras"],
 ["codigoInterno", "Codigo interno"],
 ["claveProveedor", "Clave proveedor"],
 ["nombre", "Nombre / descripcion"],
 ["unidadVenta", "Unidad de venta"],
 ["costo", "Precio proveedor / costo"],
 ["medioMayoreo", "Precio medio mayoreo"],
 ["publico", "Precio publico"],
 ["marca", "Marca"],
 ["categoria", "Categoria"]
 ];

 const html =
 document.createElement("div");

 html.className =
 "catalogo-mapeo-modal";

 html.innerHTML = `
 <div class="catalogo-mapeo-card">
 <div class="catalogo-mapeo-head">
 <div>
 <span>Importador inteligente</span>
 <h2>${proveedor}</h2>
 <p>${archivo}</p>
 </div>
 <button type="button" id="cerrarMapeoCatalogo" class="modal-cerrar-x" aria-label="Cerrar mapeo">×</button>
 </div>

 <div class="catalogo-mapeo-grid">
 ${campos.map(([campo, etiqueta]) => `
 <label>
 <span>${etiqueta}</span>
 <select data-campo="${campo}">
 ${opcionesColumnasCatalogo(encabezados, mapeo[campo])}
 </select>
 </label>
 `).join("")}
 </div>

 <div class="catalogo-mapeo-preview">
 <h3>Vista previa</h3>
 <div id="previewMapeoCatalogo"></div>
 </div>

 <label class="catalogo-guardar-plantilla">
 <input type="checkbox" id="guardarPlantillaCatalogo" checked>
 Guardar plantilla para este proveedor
 </label>

 <div class="catalogo-mapeo-actions">
 <button type="button" id="cancelarMapeoCatalogo">Cancelar</button>
 <button type="button" id="confirmarMapeoCatalogo">Usar este mapeo</button>
 </div>
 </div>
 `;

 document.body.appendChild(html);

 const leerMapeo = () => {
 const resultado = {};

 html.querySelectorAll("[data-campo]").forEach(select => {
 resultado[select.dataset.campo] =
 select.value === "" ? "" : Number(select.value);
 });

 return resultado;
 };

 const renderPreview = () => {
 const resultado =
 leerMapeo();

 const muestra =
 productoPreviewConMapeo(csv, resultado);

 html.querySelector("#previewMapeoCatalogo").innerHTML = `
 <div><span>Codigo</span><strong>${muestra.codigoBarras || muestra.codigoInterno || "-"}</strong></div>
 <div><span>Nombre</span><strong>${muestra.nombre || "-"}</strong></div>
 <div><span>Costo</span><strong>${muestra.costo || "-"}</strong></div>
 <div><span>Medio mayoreo</span><strong>${muestra.medioMayoreo || "-"}</strong></div>
 <div><span>Publico</span><strong>${muestra.publico || "-"}</strong></div>
 <div><span>Marca</span><strong>${muestra.marca || "-"}</strong></div>
 `;
 };

 html.querySelectorAll("select").forEach(select =>
 select.addEventListener("change", renderPreview)
 );

 renderPreview();

 return new Promise(resolve => {
 const cerrar = valor => {
 html.remove();
 resolve(valor);
 };

 html.querySelector("#cerrarMapeoCatalogo")
 .addEventListener("click", () => cerrar(null));

 html.querySelector("#cancelarMapeoCatalogo")
 .addEventListener("click", () => cerrar(null));

 html.querySelector("#confirmarMapeoCatalogo")
 .addEventListener("click", () => {
 const mapeoFinal =
 leerMapeo();

 let plantillaGuardada = plantilla;

 if (html.querySelector("#guardarPlantillaCatalogo").checked) {
 const nombresMapeo = {};

 Object.entries(mapeoFinal).forEach(([campo, indice]) => {
 if (indice !== "") {
 nombresMapeo[campo] =
 encabezados[indice]?.nombre || "";
 }
 });

 plantillaGuardada =
 guardarPlantillaCatalogo({
 id: plantilla?.alcance === "privada"
 ? plantilla.id
 : `privada-${normalizarEncabezadoCatalogo(proveedor)}-${Date.now()}`,
 proveedor,
 nombre: `${proveedor} - plantilla`,
 giro: "General",
 mapeo: nombresMapeo
 });
 }

 cerrar({
 proveedor,
 plantillaId: plantillaGuardada?.id || "",
 mapeo: mapeoFinal
 });
 });
 });
}

function productoPreviewConMapeo(csv, mapeo) {
 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const encabezado =
 detectarColumnasCatalogo(lineas).indice;

 const linea =
 lineas.find((item, indice) =>
 indice !== encabezado &&
 separarFilaCatalogo(item).length > 2
 ) || "";

 const datos =
 separarFilaCatalogo(linea);

 const valor = campo => {
 const indice =
 mapeo[campo];

 return indice === "" || indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
 };

 return {
 codigoBarras: valor("codigoBarras"),
 codigoInterno: valor("codigoInterno"),
 nombre: valor("nombre"),
 costo: valor("costo"),
 medioMayoreo: valor("medioMayoreo"),
 publico: valor("publico"),
 marca: valor("marca")
 };
}

function esArchivoExcelCatalogo(archivo) {
 return /\.(xlsx|xls)$/i.test(archivo?.name || "");
}

function leerArchivoCatalogoComoCSV(archivo) {
 return new Promise((resolve, reject) => {
 const lector = new FileReader();

 lector.onerror = () =>
 reject(lector.error || new Error("No se pudo leer el archivo"));

 if (esArchivoExcelCatalogo(archivo)) {
 if (typeof XLSX === "undefined") {
 reject(new Error("No se pudo cargar el lector de Excel. Revisa tu conexion a internet e intenta de nuevo."));
 return;
 }

 lector.onload = evento => {
 try {
 const libro =
 XLSX.read(evento.target.result, { type: "array" });

 const primeraHoja =
 libro.SheetNames[0];

 const csv =
 XLSX.utils.sheet_to_csv(libro.Sheets[primeraHoja]);

 resolve(csv);
 } catch (error) {
 reject(error);
 }
 };

 lector.readAsArrayBuffer(archivo);
 return;
 }

 lector.onload = evento => resolve(evento.target.result || "");
 lector.readAsText(archivo);
 });
}

function procesarArchivosCatalogo(archivos) {
 const listaArchivos =
 Array.from(archivos || []);

 if (listaArchivos.length === 0) return;

 const lecturas =
 listaArchivos.map(async archivo => {
 let csv;

 try {
 csv = await leerArchivoCatalogoComoCSV(archivo);
 } catch (error) {
 console.warn("No se pudo leer el archivo de catalogo", archivo?.name, error);

 alertaPOS(
 `No se pudo leer "${archivo?.name || "el archivo"}". Verifica que sea un Excel (.xlsx) o CSV valido.`,
 "Catalogo proveedor",
 "alerta"
 );

 return null;
 }

 const config =
 await abrirAsistenteCatalogo(archivo, csv);

 if (!config) {
 return null;
 }

 return {
 id: `${Date.now()}-${archivo.name}`,
 proveedor: config.proveedor,
 archivo: archivo.name,
 fecha: new Date().toISOString(),
 productos: contarProductosCatalogo(csv),
 plantillaId: config.plantillaId || "",
 mapeo: config.mapeo || {},
 csv
 };
 });

 Promise.all(lecturas).then(nuevosCatalogos => {
 nuevosCatalogos =
 nuevosCatalogos.filter(Boolean);

 if (nuevosCatalogos.length === 0) return;

 const actuales =
 catalogosGuardados();

 const fusionados =
 [
 ...nuevosCatalogos,
 ...actuales.filter(actual =>
 !nuevosCatalogos.some(nuevo =>
 nuevo.proveedor.toLowerCase() ===
 actual.proveedor.toLowerCase()
 )
 )
 ];

 if (!guardarCatalogosProveedor(fusionados)) {
 return;
 }

 localStorage.setItem(
 "ultimoProveedorCatalogo",
 nuevosCatalogos[0]?.proveedor || ""
 );
 renderCatalogosProveedor();

 alertaPOS(
 "Catalogo actualizado correctamente",
 "Catalogo proveedor",
 "exito"
 );
 });
}

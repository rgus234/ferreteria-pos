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

async function sugerirMapeoCatalogoConIA(csv) {
 try {
  const encabezados = encabezadosCatalogo(csv).map(col => col.nombre);
  if (encabezados.length === 0) return null;

  const lineas = dividirLineasCatalogo(csv).map(l => l.trim()).filter(Boolean);
  const mapa = detectarColumnasCatalogo(lineas);
  const indiceEncabezado = mapa.indice >= 0 ? mapa.indice : 0;
  const filasMuestra = lineas
   .filter((linea, indice) => indice !== indiceEncabezado)
   .slice(0, 5)
   .map(linea => separarFilaCatalogo(linea));

  const respuesta = await fetch("/ia/sugerir-mapeo-catalogo", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ headers: encabezados, filasMuestra })
  });
  const datos = await respuesta.json();

  if (!respuesta.ok || !datos.ok || !datos.disponible || !datos.mapeo || Object.keys(datos.mapeo).length === 0) {
   return null;
  }

  return { mapeo: datos.mapeo };
 } catch (error) {
  console.warn("No se pudo obtener sugerencia de mapeo de la IA", error);
  return null;
 }
}

function plantillasCatalogoBase() {
 return [
 {
 id: "global-truper-csv",
 alcance: "global",
 giro: "Ferreteria",
 proveedor: "Truper",
 parser: "truper",
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
 },
 {
 id: "global-gafi-csv",
 alcance: "global",
 giro: "Ferreteria",
 proveedor: "Gafi",
 parser: "gafi",
 nombre: "Gafi CSV oficial",
 mapeo: {
 codigoInterno: "Corto",
 claveProveedor: "Alterno",
 nombre: "Articulo",
 unidadVenta: "Unidad",
 publico: "Precio Lista",
 marca: "Marca",
 categoria: "Familia",
 costo: "",
 codigoBarras: ""
 }
 }
 ];
}

// Plantillas de mapeo por proveedor -- movidas de localStorage (por
// navegador, no por negocio, se perdian al limpiar datos o cambiar de
// equipo) al servidor (/catalogo-proveedor/plantillas), consistente
// con que los catalogos mismos ya viven ahi. plantillasCatalogoBase()
// (los 2 defaults incorporados, Truper/Gafi) se queda igual, sigue
// siendo codigo puro sin llamada de red.
function plantillasCatalogoUsuarioLocal() {
 try {
 return JSON.parse(
 localStorage.getItem("plantillasCatalogo") || "[]"
 );
 } catch (error) {
 return [];
 }
}

// Sube una sola vez lo que ya estaba guardado en este navegador, para
// no perder configuraciones ya hechas -- no borra el localStorage
// (red de seguridad barata), solo marca que ya se migro.
async function migrarPlantillasLocalesAlServidorSiHaceFalta() {
 if (localStorage.getItem("plantillasCatalogoMigradas") === "1") return;

 const locales = plantillasCatalogoUsuarioLocal();
 localStorage.setItem("plantillasCatalogoMigradas", "1");
 if (locales.length === 0) return;

 for (const plantilla of locales) {
  try {
   await fetch("/catalogo-proveedor/plantillas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     proveedor: plantilla.proveedor,
     proveedorNormalizado: normalizarEncabezadoCatalogo(plantilla.proveedor),
     parser: plantilla.parser || "generico",
     mapeo: plantilla.mapeo || {}
    })
   });
  } catch (error) {
   console.warn("No se pudo migrar una plantilla local al servidor", plantilla.proveedor, error);
  }
 }
}

async function plantillasCatalogoUsuario() {
 await migrarPlantillasLocalesAlServidorSiHaceFalta();

 try {
  const respuesta = await fetch("/catalogo-proveedor/plantillas");
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok) return [];
  return datos.plantillas.map(p => ({
   id: `servidor-${p.proveedor_normalizado}`,
   proveedor: p.proveedor,
   parser: p.parser,
   mapeo: p.mapeo,
   alcance: "privada"
  }));
 } catch (error) {
  console.warn("No se pudieron cargar las plantillas del servidor", error);
  return [];
 }
}

async function todasPlantillasCatalogo() {
 const delServidor = await plantillasCatalogoUsuario();
 // Un default incorporado (Truper/Gafi) solo se usa si el negocio no
 // tiene ya su propia plantilla guardada para ese proveedor -- lo
 // guardado por el usuario siempre gana.
 const normalizadosDelServidor = new Set(delServidor.map(p => normalizarEncabezadoCatalogo(p.proveedor)));
 const defaults = plantillasCatalogoBase().filter(p => !normalizadosDelServidor.has(normalizarEncabezadoCatalogo(p.proveedor)));
 return [...defaults, ...delServidor];
}

async function guardarPlantillaCatalogo(plantilla) {
 const proveedorNormalizado = normalizarEncabezadoCatalogo(plantilla.proveedor);

 try {
  await fetch("/catalogo-proveedor/plantillas", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({
    proveedor: plantilla.proveedor,
    proveedorNormalizado,
    parser: plantilla.parser || "generico",
    mapeo: plantilla.mapeo || {}
   })
  });
 } catch (error) {
  console.warn("No se pudo guardar la plantilla en el servidor", error);
 }

 return { ...plantilla, id: `servidor-${proveedorNormalizado}`, alcance: "privada" };
}

function normalizarNombreColumnaCatalogo(nombre) {
 return normalizarEncabezadoCatalogo(nombre);
}

function encabezadosCatalogo(csv) {
 const lineas =
 dividirLineasCatalogo(csv)
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

async function buscarPlantillaPorProveedor(proveedor) {
 const texto =
 normalizarEncabezadoCatalogo(proveedor);

 const todas = await todasPlantillasCatalogo();

 return todas.find(plantilla =>
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
 dividirLineasCatalogo(csv)
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
 return dividirLineasCatalogo(csv)
 .map(linea => linea.trim())
 .filter(linea => linea && linea.split(",").length > 2)
 .length;
}

async function abrirAsistenteCatalogo(archivo, csv) {
 const seleccion =
 typeof abrirSelectorProveedorCatalogo === "function"
 ? await abrirSelectorProveedorCatalogo()
 : { parser: "generico" };

 if (!seleccion) return null;

 const parser =
 seleccion.parser || "generico";

 let proveedor =
 seleccion.proveedor || "";

 if (!proveedor) {
 const proveedorSugerido =
 nombreProveedorDesdeArchivo(archivo.name);

 proveedor =
 await pedirTextoPOS(
 "Nombre del proveedor o distribuidor:",
 proveedorSugerido,
 "Catalogo proveedor"
 ) || proveedorSugerido;
 }

 const plantilla =
 await buscarPlantillaPorProveedor(proveedor);

 // Si ya hay una plantilla guardada para este proveedor, no se abre
 // el modal completo de mapeo -- eso es lo que el usuario reporto
 // como "revolcadero" (reconfirmar a mano, cada subida, algo que ya
 // se configuro antes). Se ofrece un banner corto en su lugar; "Ajustar
 // mapeo" sigue cayendo al modal completo, prellenado, igual que hoy.
 let resultado = null;

 if (plantilla) {
 const usarPlantilla =
 await dialogoPOS({
 titulo: "Plantilla encontrada",
 mensaje: `Ya tienes una plantilla guardada para "${proveedor}". ¿La usamos para este catalogo?`,
 tipo: "info",
 mostrarCancelar: true,
 textoAceptar: "Usar plantilla",
 textoCancelar: "Ajustar mapeo"
 });

 if (usarPlantilla) {
 resultado = {
 proveedor,
 plantillaId: plantilla.id,
 mapeo: mapeoDetectadoCatalogo(csv, plantilla)
 };
 }
 }

 if (!resultado) {
 // Sin plantilla guardada -- formato nuevo/no reconocido. En vez de
 // que el usuario parta de un mapeo vacio o mal detectado, se le
 // pide a la IA (Haiku, barata, cacheada por encabezados) una
 // sugerencia -- el modal se abre PRELLENADO con eso, el usuario
 // sigue revisando y confirmando exactamente igual que hoy. En
 // planes sin IA (o si la llamada falla) simplemente cae al
 // comportamiento de siempre, sin bloquear el flujo.
 const plantillaSugeridaPorIA =
 !plantilla ? await sugerirMapeoCatalogoConIA(csv) : null;

 resultado =
 await abrirMapeoCatalogo({
 proveedor,
 archivo: archivo.name,
 csv,
 plantilla: plantilla || plantillaSugeridaPorIA
 });
 }

 if (!resultado) return null;

 return {
 ...resultado,
 parser
 };
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
 .addEventListener("click", async () => {
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
 await guardarPlantillaCatalogo({
 proveedor,
 parser: plantilla?.parser || "generico",
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
 dividirLineasCatalogo(csv)
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

 lector.onload = evento => {
 const buffer = evento.target.result;

 try {
 resolve(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
 } catch (error) {
 resolve(new TextDecoder("windows-1252").decode(buffer));
 }
 };

 lector.readAsArrayBuffer(archivo);
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
 parser: config.parser || "generico",
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

 // Ademas de guardarse local (para el asistente/diagnostico ya
 // existente), cada catalogo nuevo se sube al servidor para que el
 // motor de vinculacion real (catalog-server.js) lo procese.
 nuevosCatalogos.forEach(catalogo => {
  if (typeof subirCatalogoAlServidor === "function") {
   subirCatalogoAlServidor(catalogo);
  }
 });

 renderCatalogosProveedor();

 alertaPOS(
 "Catalogo actualizado correctamente",
 "Catalogo proveedor",
 "exito"
 );
 });
}

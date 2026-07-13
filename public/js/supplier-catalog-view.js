async function cargarProveedores() {
 const respuesta =
 await fetch("/proveedores?estado=" + estadoProveedoresActual);

 if (!respuesta.ok) {
 throw new Error("No se pudieron cargar los proveedores");
 }

 const datos =
 await respuesta.json();

 proveedores =
 datos.proveedores || [];
}

async function mostrarProveedores() {
 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
 document.getElementById("pantallaProveedores").style.display = "block";
 estadoProveedoresActual = "activo";
 paginaProveedoresActual = 1;
 document.querySelectorAll("[data-proveedor-estado]").forEach(boton => {
  boton.classList.toggle("activo", boton.dataset.proveedorEstado === "activo");
 });
 const buscador = document.getElementById("buscarProveedores");
 if (buscador) buscador.value = "";

 try {
 await cargarProveedores();
 renderProveedores();
 } catch (error) {
 alert(error.message);
 }
}

function proveedoresFiltrados() {
 const texto =
 (document.getElementById("buscarProveedores")?.value || "")
 .toLowerCase()
 .trim();

 if (!texto) return proveedores;

 return proveedores.filter(proveedor =>
 String(proveedor.nombre || "").toLowerCase().includes(texto)
 ||
 String(proveedor.contacto || "").toLowerCase().includes(texto)
 ||
 String(proveedor.telefono || "").toLowerCase().includes(texto)
 ||
 String(proveedor.correo || "").toLowerCase().includes(texto)
 );
}

function buscarProveedores() {
 paginaProveedoresActual = 1;
 renderProveedores();
}

async function cambiarEstadoProveedores(estado) {
 estadoProveedoresActual = estado;
 paginaProveedoresActual = 1;
 document.querySelectorAll("[data-proveedor-estado]").forEach(boton => {
  boton.classList.toggle("activo", boton.dataset.proveedorEstado === estado);
 });
 await cargarProveedores();
 renderProveedores();
}

function cambiarPaginaProveedores(pagina) {
 paginaProveedoresActual = pagina;
 renderProveedores();
}

function renderProveedores() {
 const tabla =
 document.getElementById("tablaProveedores");

 if (!tabla) return;

 const filtrados =
 proveedoresFiltrados();

 document.getElementById("proveedoresTotal").textContent =
 proveedores.length;

 document.getElementById("proveedoresProductos").textContent =
 proveedores.reduce(
 (total, proveedor) =>
 total + Number(proveedor.productos || 0),
 0
 );

 document.getElementById("proveedoresSinContacto").textContent =
 proveedores.filter(
 proveedor =>
 !proveedor.telefono && !proveedor.correo
 ).length;

 if (filtrados.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="proveedores-vacio">
 No hay proveedores para mostrar.
 </td>
 </tr>
 `;
 document.getElementById("proveedoresPaginacionTexto").textContent = "";
 renderPaginacion("paginacionProveedores", 0, 1, TAMANO_PAGINA_PROVEEDORES, "cambiarPaginaProveedores");
 return;
 }

 const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA_PROVEEDORES));
 paginaProveedoresActual = Math.min(paginaProveedoresActual, totalPaginas);
 const inicio = (paginaProveedoresActual - 1) * TAMANO_PAGINA_PROVEEDORES;
 const pagina = filtrados.slice(inicio, inicio + TAMANO_PAGINA_PROVEEDORES);

 tabla.innerHTML =
 pagina.map(proveedor => `
 <tr>
 <td>
 <strong>${proveedor.nombre}</strong>
 <span>${proveedor.notas || "Sin notas"}</span>
 </td>
 <td>${proveedor.contacto || "-"}</td>
 <td>${proveedor.telefono || "-"}</td>
 <td>${proveedor.correo || "-"}</td>
 <td>
 <span class="proveedor-productos">
 ${Number(proveedor.productos || 0)}
 </span>
 </td>
 <td class="acciones-proveedores">
 ${estadoProveedoresActual === "activo" ? `
 <button onclick="verProductosProveedor('${encodeURIComponent(proveedor.nombre)}')">
 Productos
 </button>
 <button onclick="editarProveedor(${proveedor.id})">
 Editar
 </button>
 <button onclick="mostrarReglasPrecios('${encodeURIComponent(proveedor.nombre)}')">
 Precios
 </button>
 <button class="btn-proveedor-baja" onclick="desactivarProveedor(${proveedor.id})">
 Baja
 </button>
 ` : `
 <button class="btn-proveedor-reactivar" onclick="reactivarProveedor(${proveedor.id})">
 Reactivar
 </button>
 `}
 </td>
 </tr>
 `).join("");

 document.getElementById("proveedoresPaginacionTexto").textContent =
 "Mostrando " + (inicio + 1) + " a " + Math.min(inicio + TAMANO_PAGINA_PROVEEDORES, filtrados.length) + " de " + filtrados.length + " proveedores";
 renderPaginacion("paginacionProveedores", filtrados.length, paginaProveedoresActual, TAMANO_PAGINA_PROVEEDORES, "cambiarPaginaProveedores");
}

async function reactivarProveedor(id) {
 const proveedor = proveedores.find(item => Number(item.id) === Number(id));
 if (!proveedor) return;

 const confirmar = await confirmarPOS(`Reactivar a ${proveedor.nombre}?`, "Reactivar proveedor", "info");
 if (!confirmar) return;

 const respuesta = await fetch(`/proveedores/${id}/activar`, { method: "PUT" });
 if (!respuesta.ok) {
 alert("No se pudo reactivar el proveedor");
 return;
 }

 await cargarProveedores();
 renderProveedores();
}

async function abrirNuevoProveedor() {
 const datos =
 await abrirFormularioCredito({
 titulo: "Nuevo proveedor",
 subtitulo: "Registra datos de contacto y surtido",
 campos: camposProveedor()
 });

 if (!datos) return;

 const respuesta =
 await fetch(
 "/proveedores",
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify(datos)
 }
 );

 if (!respuesta.ok) {
 alert("No se pudo crear el proveedor");
 return;
 }

 await cargarProveedores();
 renderProveedores();
}

async function editarProveedor(id) {
 const proveedor =
 proveedores.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!proveedor) return;

 const datos =
 await abrirFormularioCredito({
 titulo: "Editar proveedor",
 subtitulo: "Actualiza los datos del proveedor",
 campos: camposProveedor(proveedor)
 });

 if (!datos) return;

 const respuesta =
 await fetch(
 `/proveedores/${id}`,
 {
 method: "PUT",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify(datos)
 }
 );

 if (!respuesta.ok) {
 alert("No se pudo editar el proveedor");
 return;
 }

 await cargarProveedores();
 renderProveedores();
}

async function desactivarProveedor(id) {
 const proveedor =
 proveedores.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!proveedor) return;

 const confirmar =
 await confirmarPOS(
 `Dar de baja a ${proveedor.nombre}?`,
 "Baja de proveedor",
 "peligro"
 );

 if (!confirmar) return;

 const respuesta =
 await fetch(
 `/proveedores/${id}`,
 {
 method: "DELETE"
 }
 );

 if (!respuesta.ok) {
 alert("No se pudo dar de baja el proveedor");
 return;
 }

 await cargarProveedores();
 renderProveedores();
}

function verProductosProveedor(nombreCodificado) {
 const nombre =
 decodeURIComponent(nombreCodificado);

 mostrarInventario();

 const buscador =
 document.getElementById("buscarInventario");

 if (buscador) {
 buscador.value = nombre;
 buscarInventario();
 }
}

function camposProveedor(proveedor = {}) {
 return [
 {
 nombre: "nombre",
 etiqueta: "Nombre del proveedor",
 placeholder: "Ej. Truper, Urrea, Fiero",
 valor: proveedor.nombre || "",
 requerido: true
 },
 {
 nombre: "contacto",
 etiqueta: "Contacto",
 placeholder: "Nombre del vendedor",
 valor: proveedor.contacto || ""
 },
 {
 nombre: "telefono",
 etiqueta: "Telefono",
 placeholder: "Numero de contacto",
 valor: proveedor.telefono || ""
 },
 {
 nombre: "correo",
 etiqueta: "Correo",
 tipo: "email",
 placeholder: "ventas@proveedor.com",
 valor: proveedor.correo || ""
 },
 {
 nombre: "notas",
 etiqueta: "Notas",
 placeholder: "Dias de surtido, condiciones, ruta",
 valor: proveedor.notas || ""
 }
 ];
}

window.mostrarCatalogo = async function() {
 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

 asegurarPantallaCatalogo();

 const pantalla = document.getElementById("pantallaCatalogo");
 if (pantalla) pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Catalogo proveedor", "Carga, mapeo y mantenimiento de listas", "catalogo");
 }

 renderCatalogosProveedor();
 cargarResumenFotosProducto();
};

// Muestra cuantas fotos de producto hay guardadas de forma permanente
// (no solo el resultado de la ultima importacion en esta sesion) -- antes
// no habia ninguna confirmacion visible de que las fotos ya subidas
// siguieran ahi al volver a esta pantalla o recargar la pagina.
async function cargarResumenFotosProducto() {
 const contenedor =
 document.getElementById("resumenFotosProducto");

 const botonVer =
 document.getElementById("btnVerFotosImportadas");

 if (!contenedor) return;

 try {
 const respuesta =
 await fetch("/fotos-producto-resumen");

 const datos =
 await respuesta.json();

 if (!datos.ok) throw new Error(datos.error || "No se pudo consultar");

 if (!datos.total) {
 contenedor.textContent = "Todavia no has importado fotos de producto.";
 if (botonVer) botonVer.style.display = "none";
 return;
 }

 const fecha =
 datos.ultimaActualizacion
 ? new Date(datos.ultimaActualizacion).toLocaleString("es-MX")
 : "";

 contenedor.innerHTML = `<strong>${datos.total}</strong> foto(s) de producto guardada(s)${fecha ? ` · ultima actualizacion: ${fecha}` : ""}`;

 if (botonVer) {
 botonVer.style.display = "inline-flex";
 botonVer.textContent = `Ver fotos importadas (${datos.total})`;
 }

 // Si la tabla ya estaba abierta (ej. justo despues de importar un
 // lote nuevo), se refresca con los datos mas recientes.
 const tabla =
 document.getElementById("tablaFotosImportadas");

 if (tabla && tabla.style.display !== "none") {
 cargarTablaFotosImportadas();
 }
 } catch (error) {
 contenedor.textContent = "No se pudo consultar cuantas fotos hay guardadas.";
 if (botonVer) botonVer.style.display = "none";
 }
}

async function alternarTablaFotosImportadas() {
 const tabla =
 document.getElementById("tablaFotosImportadas");

 const boton =
 document.getElementById("btnVerFotosImportadas");

 const buscador =
 document.getElementById("buscarFotoImportadaInput");

 if (!tabla) return;

 const abrir =
 tabla.style.display === "none";

 tabla.style.display = abrir ? "block" : "none";

 if (buscador) {
 buscador.style.display = abrir ? "block" : "none";
 if (!abrir) buscador.value = "";
 }

 if (boton) {
 boton.textContent = boton.textContent.replace(
 abrir ? "Ver" : "Ocultar",
 abrir ? "Ocultar" : "Ver"
 );
 }

 if (abrir) await cargarTablaFotosImportadas();
}

// Se guarda la lista completa una vez traida del servidor para poder
// filtrarla por codigo al instante mientras el usuario escribe, sin
// tener que volver a pedirla al servidor en cada tecla.
let fotosImportadasCache = [];

async function cargarTablaFotosImportadas() {
 const tabla =
 document.getElementById("tablaFotosImportadas");

 if (!tabla) return;

 tabla.innerHTML = "Cargando fotos importadas...";

 try {
 const respuesta =
 await fetch("/fotos-producto-lista");

 const datos =
 await respuesta.json();

 if (!datos.ok) throw new Error(datos.error || "No se pudo consultar");

 fotosImportadasCache = datos.fotos;

 renderTablaFotosImportadas(fotosImportadasCache);
 } catch (error) {
 tabla.innerHTML = "No se pudo cargar la lista de fotos importadas.";
 }
}

function filtrarTablaFotosImportadas(texto) {
 const textoNormalizado =
 String(texto || "").trim().toLowerCase();

 if (!textoNormalizado) {
 renderTablaFotosImportadas(fotosImportadasCache);
 return;
 }

 const filtradas =
 fotosImportadasCache.filter(foto =>
 foto.codigo.toLowerCase().includes(textoNormalizado)
 );

 renderTablaFotosImportadas(filtradas, textoNormalizado);
}

function renderTablaFotosImportadas(fotos, textoBusqueda = "") {
 const tabla =
 document.getElementById("tablaFotosImportadas");

 if (!tabla) return;

 if (fotos.length === 0) {
 tabla.innerHTML =
 textoBusqueda
 ? `Ningun codigo coincide con "${escaparPOS(textoBusqueda)}".`
 : "Todavia no has importado fotos de producto.";
 return;
 }

 tabla.innerHTML = `
 <table class="tabla-fotos-importadas">
 <thead>
 <tr>
 <th>Foto</th>
 <th>Codigo</th>
 <th>Producto</th>
 <th>Actualizado</th>
 </tr>
 </thead>
 <tbody>
 ${fotos.map(foto => `
 <tr>
 <td><img src="${foto.imagenUrl}" alt="" loading="lazy" class="tabla-fotos-importadas-thumb"></td>
 <td>${escaparPOS(foto.codigo)}</td>
 <td>${foto.producto ? escaparPOS(foto.producto) : "<span class=\"tabla-fotos-importadas-sin\">Sin producto dado de alta</span>"}</td>
 <td>${new Date(foto.actualizadoAt).toLocaleString("es-MX")}</td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 `;
}

function asegurarPantallaCatalogo() {
 const pantalla =
 document.getElementById("pantallaCatalogo");

 if (!pantalla || pantalla.dataset.catalogoUi === "ok") return;

 pantalla.innerHTML = `
 <div class="catalogo-shell">
 <div class="catalogo-header">
 <div>
 <h2>Catalogo proveedor</h2>
 <p>Actualiza listas de precios y conecta codigos de barras con inventario.</p>
 </div>
 <div class="catalogo-actions">
 <button type="button" class="btn-catalogo-subir" onclick="abrirCargaCatalogo('nuevo')">
 Subir catalogo nuevo
 </button>
 <button type="button" class="btn-catalogo-actualizar" onclick="abrirCargaCatalogo('actualizar')">
 Actualizar catalogo
 </button>
 <input type="file" id="archivoCatalogoVista" multiple accept=".xlsx,.csv" hidden>
 </div>
 </div>

 <div class="catalogo-resumen">
 <div>
 <span>Catalogos cargados</span>
 <strong id="catalogosTotal">0</strong>
 </div>
 <div>
 <span>Productos en catalogos</span>
 <strong id="catalogosProductos">0</strong>
 </div>
 <div>
 <span>Ultima actualizacion</span>
 <strong id="catalogosUltima">Sin datos</strong>
 </div>
 </div>

 <div class="catalogo-grid">
 <div class="catalogo-panel">
 <div class="catalogo-panel-head">
 <h3>Catalogos por proveedor</h3>
 <button onclick="limpiarCatalogosProveedor()">Limpiar</button>
 </div>
 <div id="listaCatalogosProveedor"></div>
 </div>

 <div class="catalogo-panel">
 <h3>Lectura del catalogo</h3>

 <div class="catalogo-buscador">
 <input type="text" id="buscarProductoCatalogoInput" placeholder="Buscar producto en el catalogo por nombre..." oninput="buscarYRenderizarProductosCatalogo(this.value)">
 </div>
 <div id="resultadosBusquedaCatalogo"></div>

 <div id="vistaCatalogoProveedor" class="vista-catalogo">
 Sube un catalogo para revisar columnas, precios detectados y productos de muestra.
 </div>
 </div>
 </div>

 <div class="catalogo-panel catalogo-fotos-panel">
 <div class="catalogo-panel-head">
 <h3>Importar fotos de producto</h3>
 </div>
 <p class="catalogo-fotos-ayuda">
 Selecciona uno o varios archivos .zip del banco de fotos de tu proveedor
 (ej. el Banco de Contenido Digital de Truper). Cada foto se empareja
 sola por codigo con tus productos -- no importa si todavia no tienes
 dado de alta un producto, la foto se queda guardada esperando.
 </p>
 <div id="resumenFotosProducto" class="catalogo-fotos-total">Consultando fotos guardadas...</div>
 <button type="button" id="btnVerFotosImportadas" class="catalogo-fotos-toggle" onclick="alternarTablaFotosImportadas()" style="display:none;">
 Ver fotos importadas
 </button>
 <input type="text" id="buscarFotoImportadaInput" class="catalogo-fotos-buscador" placeholder="Buscar por codigo..." oninput="filtrarTablaFotosImportadas(this.value)" style="display:none;">
 <div id="tablaFotosImportadas" class="catalogo-fotos-tabla-wrap" style="display:none;"></div>
 <div class="catalogo-fotos-subir">
 <input type="file" id="archivoFotosProducto" multiple accept=".zip">
 <button type="button" id="btnImportarFotos" class="btn-catalogo-subir" onclick="importarFotosProductoLote()">
 Importar fotos
 </button>
 <button type="button" id="btnCancelarImportarFotos" class="catalogo-fotos-cancelar" onclick="cancelarImportacionFotosProducto()" style="display:none;">
 Cancelar
 </button>
 </div>
 <div id="progresoImportarFotos" class="catalogo-fotos-progreso" style="display:none;">
 <div id="progresoImportarFotosBarra" class="catalogo-fotos-progreso-barra"></div>
 </div>
 <div id="resultadoImportarFotos" class="catalogo-fotos-resultado"></div>
 </div>
 </div>
 `;

 pantalla.dataset.catalogoUi = "ok";

 document
 .getElementById("archivoCatalogoVista")
 .addEventListener("change", event => {
 procesarArchivosCatalogo(event.target.files);
 event.target.value = "";
 });
}

// Cancela la importacion de fotos en curso: aborta la subida que este
// en vuelo en ese momento (no solo evita seguir con la siguiente).
let cancelarImportacionFotosFlag = false;
let controladorImportacionFotos = null;

function cancelarImportacionFotosProducto() {
 cancelarImportacionFotosFlag = true;
 controladorImportacionFotos?.abort();
}

function actualizarProgresoImportarFotos(fraccion) {
 const barra =
 document.getElementById("progresoImportarFotosBarra");

 if (!barra) return;

 const porcentaje =
 Math.round(Math.min(1, Math.max(0, fraccion)) * 100);

 barra.style.width = `${porcentaje}%`;
}

function marcarProgresoImportarFotosIndeterminado(activo) {
 const contenedor =
 document.getElementById("progresoImportarFotos");

 contenedor?.classList.toggle("catalogo-fotos-progreso-indeterminado", activo);
}

// Sube un zip usando XMLHttpRequest (en vez de fetch) porque es la unica
// forma de escuchar el avance real de la subida (xhr.upload.progress) --
// con fetch la barra no tenia forma de saber si un archivo grande ya iba
// a la mitad o seguia en cero, y se sentia trabada con zips pesados.
function subirZipFotosProducto(archivo, alAvanzar) {
 return new Promise((resolve, reject) => {
 const xhr =
 new XMLHttpRequest();

 controladorImportacionFotos = xhr;

 xhr.upload.addEventListener("progress", event => {
 if (event.lengthComputable) {
 alAvanzar(event.loaded / event.total);
 }
 });

 xhr.addEventListener("load", () => {
 const contentType =
 xhr.getResponseHeader("content-type") || "";

 if (!contentType.includes("application/json")) {
 reject(new Error(`Respuesta invalida del servidor (status ${xhr.status}). El archivo puede ser demasiado pesado.`));
 return;
 }

 try {
 const datos =
 JSON.parse(xhr.responseText);

 if (!datos.ok) {
 reject(new Error(datos.error || "No se pudo importar este archivo"));
 return;
 }

 resolve(datos);
 } catch (error) {
 reject(new Error("Respuesta invalida del servidor."));
 }
 });

 xhr.addEventListener("error", () => {
 reject(new Error("Error de conexion al subir el archivo."));
 });

 xhr.addEventListener("abort", () => {
 const error = new Error("Importacion cancelada");
 error.name = "AbortError";
 reject(error);
 });

 const formData =
 new FormData();

 formData.append("zips", archivo);

 xhr.open("POST", "/fotos-producto/importar-lote");
 xhr.send(formData);
 });
}

async function importarFotosProductoLote() {
 const input =
 document.getElementById("archivoFotosProducto");

 const archivos =
 input?.files ? [...input.files] : [];

 const resultado =
 document.getElementById("resultadoImportarFotos");

 const botonImportar =
 document.getElementById("btnImportarFotos");

 const botonCancelar =
 document.getElementById("btnCancelarImportarFotos");

 const progreso =
 document.getElementById("progresoImportarFotos");

 if (archivos.length === 0) {
 await alertaPOS("Selecciona uno o varios archivos .zip primero.", "Sin archivos", "alerta");
 return;
 }

 cancelarImportacionFotosFlag = false;

 if (botonImportar) botonImportar.style.display = "none";
 if (botonCancelar) botonCancelar.style.display = "inline-flex";
 if (progreso) progreso.style.display = "block";
 actualizarProgresoImportarFotos(0);

 // Se sube un .zip por peticion (no todos juntos): un lote grande junto
 // pesa demasiado para una sola subida y el servidor/Render lo rechaza
 // sin avisar bien. Uno por uno tambien deja ver el avance real y poder
 // cancelar entre archivo y archivo.
 const totales = {
 zipsProcesados: 0,
 fotosGuardadas: 0,
 errores: []
 };

 let cancelado = false;

 for (let i = 0; i < archivos.length; i++) {
 if (cancelarImportacionFotosFlag) {
 cancelado = true;
 break;
 }

 const archivo =
 archivos[i];

 if (resultado) {
 resultado.textContent = `Subiendo ${i + 1} de ${archivos.length}: ${archivo.name}...`;
 }

 marcarProgresoImportarFotosIndeterminado(false);

 try {
 const datos =
 await subirZipFotosProducto(archivo, fraccionArchivo => {
 actualizarProgresoImportarFotos((i + fraccionArchivo) / archivos.length);

 if (fraccionArchivo >= 1 && resultado) {
 resultado.textContent = `${archivo.name} ya se subio, esperando que el servidor termine de procesarla (puede tardar si trae muchas fotos)...`;
 marcarProgresoImportarFotosIndeterminado(true);
 }
 });

 marcarProgresoImportarFotosIndeterminado(false);

 totales.zipsProcesados += datos.zipsProcesados;
 totales.fotosGuardadas += datos.fotosGuardadas;
 totales.errores.push(...datos.errores);
 } catch (error) {
 marcarProgresoImportarFotosIndeterminado(false);

 if (error.name === "AbortError") {
 cancelado = true;
 break;
 }

 totales.errores.push(`${archivo.name}: ${error.message || "No se pudo importar"}`);
 }

 actualizarProgresoImportarFotos((i + 1) / archivos.length);

 if (resultado) {
 resultado.innerHTML = `
 <strong>${totales.fotosGuardadas} foto(s) guardada(s)</strong> de ${totales.zipsProcesados} de ${archivos.length} archivo(s) procesados hasta ahora...
 `;
 }
 }

 controladorImportacionFotos = null;

 if (botonImportar) botonImportar.style.display = "inline-flex";
 if (botonCancelar) botonCancelar.style.display = "none";
 if (progreso) progreso.style.display = "none";

 if (resultado) {
 resultado.innerHTML = `
 <strong>${totales.fotosGuardadas} foto(s) guardada(s)</strong> de ${totales.zipsProcesados} de ${archivos.length} archivo(s) procesados${cancelado ? " (importacion cancelada)" : ""}.
 ${totales.errores.length ? `<br><small>${escaparPOS(totales.errores.join(" | "))}</small>` : ""}
 `;
 }

 input.value = "";

 await cargarResumenFotosProducto();

 if (typeof cargarProductos === "function") await cargarProductos();
 if (typeof cargarTablaInventario === "function") cargarTablaInventario();
}

function abrirCargaCatalogo(modo = "nuevo") {
 const input =
 document.getElementById("archivoCatalogoVista") ||
 document.getElementById("archivoCatalogo");

 if (!input) return;

 input.dataset.modoCatalogo =
 modo;

 input.click();
}

function renderCatalogosProveedor() {
 const catalogos =
 catalogosGuardados();

 const totalProductos =
 catalogos.reduce(
 (total, item) =>
 total + Number(item.productos || 0),
 0
 );

 const ultimaFecha =
 catalogos
 .map(item => item.fecha)
 .filter(Boolean)
 .sort()
 .at(-1);

 const totalEl =
 document.getElementById("catalogosTotal");

 const productosEl =
 document.getElementById("catalogosProductos");

 const ultimaEl =
 document.getElementById("catalogosUltima");

 if (totalEl) totalEl.textContent = catalogos.length;
 if (productosEl) productosEl.textContent = totalProductos;
 if (ultimaEl) {
 ultimaEl.textContent =
 ultimaFecha
 ? new Date(ultimaFecha).toLocaleDateString("es-MX")
 : "Sin datos";
 }

 const lista =
 document.getElementById("listaCatalogosProveedor");

 if (!lista) return;

 if (catalogos.length === 0) {
 lista.innerHTML = `
 <div class="catalogo-vacio">
 Todavia no hay catalogos cargados.
 </div>
 `;
 renderVistaCatalogo(null);
 return;
 }

 lista.innerHTML =
 catalogos.map((catalogo, index) => `
 <div class="catalogo-item">
 <div>
 <strong>${catalogo.proveedor}</strong>
 <span>${catalogo.archivo}</span>
 <small>${catalogo.plantillaId ? "Plantilla aplicada" : "Sin plantilla guardada"}</small>
 </div>
 <div class="catalogo-item-meta">
 <b>${catalogo.productos || 0}</b>
 <span>productos</span>
 </div>
 <button onclick="renderVistaCatalogo(${index})">
 Ver
 </button>
 <button onclick="mostrarAplicarPrecios(${index})">
 Precios
 </button>
 <button onclick="eliminarCatalogoProveedor(${index})">
 Baja
 </button>
 </div>
 `).join("");

 renderVistaCatalogo(0);
}

function productosDesdeCsvCatalogo(csv, limite = 12, mapeoCatalogo = {}) {
 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 return lineas
 .filter((linea, indice) => indice !== mapaColumnas.indice)
 .slice(0, limite)
 .map(linea => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas =
 mapaColumnas.columnas || {};

 const mayoreo =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "costo") ||
 valorColumnaCatalogo(datos, columnas, "distribuidor")
 ) || "";

 let medioMayoreo =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "medioMayoreo") ||
 valorColumnaCatalogo(datos, columnas, "medioMayoreoIva")
 ) ||
 numeroCatalogo(
 valorColumnaCatalogo(datos, columnas, "medioMayoreo")
 ) || "";

 const publico =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "publico") ||
 valorColumnaCatalogo(datos, columnas, "publico")
 ) || "";

 if (medioMayoreo && mayoreo && medioMayoreo < mayoreo) {
 medioMayoreo =
 publico && publico >= mayoreo
 ? publico
 : mayoreo;
 }

 return {
 codigo:
 normalizarCodigo(
 valorColumnaCatalogo(datos, columnas, "codigo") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoBarras") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoInterno") ||
 datos[0]
 ),
 nombre:
 valorMapeoCatalogo(datos, mapeoCatalogo, "nombre") ||
 valorColumnaCatalogo(datos, columnas, "nombre") ||
 nombreProductoDesdeFilaCatalogo(datos, columnas.codigo ?? 0),
 mayoreo: medioMayoreo,
 publico
 };
 });
}

function nombreColumnaCatalogo(lineas, indiceEncabezado, indiceColumna) {
 if (indiceEncabezado < 0 || indiceColumna === undefined) {
 return "No detectada";
 }

 const encabezados =
 separarFilaCatalogo(lineas[indiceEncabezado] || "");

 return limpiarTextoCatalogo(encabezados[indiceColumna]) || "No detectada";
}

function diagnosticoCatalogo(catalogo) {
 const lineas =
 String(catalogo?.csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapa =
 detectarColumnasCatalogo(lineas);

 const columnas =
 mapa.columnas || {};

 const mapeo =
 catalogo?.mapeo || {};

 const nombreMapeado = campo => {
 const indice =
 mapeo[campo];

 return indice === "" || indice === undefined
 ? ""
 : nombreColumnaCatalogo(lineas, mapa.indice, indice);
 };

 return {
 filas: lineas.length,
 encabezado: mapa.indice >= 0 ? mapa.indice + 1 : "No detectado",
 codigo:
 nombreMapeado("codigoBarras") ||
 nombreMapeado("codigoInterno") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.codigo),
 nombre:
 nombreMapeado("nombre") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.nombre),
 mayoreo:
 nombreMapeado("costo") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.distribuidor),
 medioMayoreo:
 nombreMapeado("medioMayoreo") ||
 nombreColumnaCatalogo(
 lineas,
 mapa.indice,
 columnas.medioMayoreoIva ?? columnas.medioMayoreo
 ),
 publico:
 nombreMapeado("publico") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.publico),
 precioVenta: mapeo.medioMayoreo !== undefined && mapeo.medioMayoreo !== ""
 ? "Configurado por plantilla"
 : columnas.medioMayoreoIva !== undefined
 ? "Medio mayoreo con IVA"
 : columnas.medioMayoreo !== undefined
 ? "Medio mayoreo"
 : "Respaldo por columnas"
 };
}

let catalogoSeleccionadoIndice = null;

function buscarProductosEnCatalogoGuardado(indice, texto, limite = 30) {
 const catalogos =
 catalogosGuardados();

 const catalogo =
 catalogos[indice];

 if (!catalogo) return [];

 const textoNormalizado =
 normalizarTexto(texto || "");

 if (!textoNormalizado) return [];

 const lineas =
 dividirLineasCatalogo(catalogo.csv || "")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const columnas =
 mapaColumnas.columnas || {};

 const mapeoCatalogo =
 catalogo.mapeo || {};

 const resultados = [];

 lineas.forEach((linea, indiceLinea) => {
 if (indiceLinea === mapaColumnas.indice) return;
 if (resultados.length >= limite) return;

 const datos =
 separarFilaCatalogo(linea);

 const nombre =
 valorMapeoCatalogo(datos, mapeoCatalogo, "nombre") ||
 valorColumnaCatalogo(datos, columnas, "nombre") ||
 nombreProductoDesdeFilaCatalogo(datos, columnas.codigo ?? 0);

 if (!normalizarTexto(nombre).includes(textoNormalizado)) return;

 const codigo =
 normalizarCodigo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoBarras") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "claveProveedor") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoInterno") ||
 valorColumnaCatalogo(datos, columnas, "codigo") ||
 datos[0]
 );

 const marca =
 valorMapeoCatalogo(datos, mapeoCatalogo, "marca") ||
 valorColumnaCatalogo(datos, columnas, "marca") ||
 detectarMarcaDesdeFilaCatalogo(datos);

 const publico =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "publico") ||
 valorColumnaCatalogo(datos, columnas, "publico")
 ) || "";

 resultados.push({ codigo, nombre, marca, publico });
 });

 return resultados;
}

function buscarYRenderizarProductosCatalogo(texto) {
 const contenedor =
 document.getElementById("resultadosBusquedaCatalogo");

 if (!contenedor) return;

 const textoLimpio =
 String(texto || "").trim();

 if (!textoLimpio || catalogoSeleccionadoIndice === null) {
 contenedor.innerHTML = "";
 return;
 }

 const resultados =
 buscarProductosEnCatalogoGuardado(catalogoSeleccionadoIndice, textoLimpio, 30);

 if (!resultados.length) {
 contenedor.innerHTML = `
 <div class="catalogo-busqueda-vacia">
 Sin resultados para "${escaparPOS(textoLimpio)}"
 </div>
 `;
 return;
 }

 contenedor.innerHTML = `
 <table class="tabla-busqueda-catalogo">
 <thead>
 <tr>
 <th>Codigo</th>
 <th>Producto</th>
 <th>Marca</th>
 <th>Publico</th>
 </tr>
 </thead>
 <tbody>
 ${resultados.map(producto => `
 <tr>
 <td><strong>${escaparPOS(producto.codigo || "-")}</strong></td>
 <td>${escaparPOS(producto.nombre)}</td>
 <td>${escaparPOS(producto.marca || "-")}</td>
 <td>${producto.publico ? "$" + Number(producto.publico).toFixed(2) : "-"}</td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 <small class="catalogo-busqueda-nota">
 Mostrando hasta 30 resultados. Copia el codigo y pegalo en "Agregar producto" para traer sus datos.
 </small>
 `;
}

function renderVistaCatalogo(indice) {
 const vista =
 document.getElementById("vistaCatalogoProveedor");

 if (!vista) return;

 catalogoSeleccionadoIndice =
 typeof indice === "number" ? indice : null;

 const buscador =
 document.getElementById("buscarProductoCatalogoInput");

 if (buscador) buscador.value = "";

 const resultadosBusqueda =
 document.getElementById("resultadosBusquedaCatalogo");

 if (resultadosBusqueda) resultadosBusqueda.innerHTML = "";

 const catalogos =
 catalogosGuardados();

 const catalogo =
 typeof indice === "number"
 ? catalogos[indice]
 : null;

 if (!catalogo) {
 vista.innerHTML = `
 <div class="catalogo-diagnostico-vacio">
 <strong>Sin catalogo seleccionado</strong>
 <span>Sube un catalogo nuevo o selecciona uno existente para revisar como se estan leyendo sus columnas.</span>
 </div>
 `;
 return;
 }

 const productos =
 productosDesdeCsvCatalogo(catalogo.csv, 12, catalogo.mapeo || {});

 const diagnostico =
 diagnosticoCatalogo(catalogo);

 vista.innerHTML = `
 <div class="vista-catalogo-header">
 <div>
 <strong>${catalogo.proveedor}</strong>
 <span>${catalogo.archivo}</span>
 </div>
 <span>${new Date(catalogo.fecha).toLocaleString("es-MX")}</span>
 </div>

 <div class="catalogo-diagnostico">
 <div>
 <span>Precio para venta</span>
 <strong>${diagnostico.precioVenta}</strong>
 </div>
 <div>
 <span>Columna codigo</span>
 <strong>${diagnostico.codigo}</strong>
 </div>
 <div>
 <span>Columna producto</span>
 <strong>${diagnostico.nombre}</strong>
 </div>
 <div>
 <span>Medio mayoreo</span>
 <strong>${diagnostico.medioMayoreo}</strong>
 </div>
 <div>
 <span>Publico</span>
 <strong>${diagnostico.publico}</strong>
 </div>
 <div>
 <span>Filas leidas</span>
 <strong>${diagnostico.filas}</strong>
 </div>
 </div>

 <h4 class="catalogo-muestra-titulo">Productos de muestra</h4>
 <table>
 <thead>
 <tr>
 <th>Codigo</th>
 <th>Producto</th>
 <th>Precio venta</th>
 <th>Publico</th>
 </tr>
 </thead>
 <tbody>
 ${productos.map(producto => `
 <tr>
 <td>${producto.codigo || "-"}</td>
 <td>${producto.nombre}</td>
 <td>${producto.mayoreo || "-"}</td>
 <td>${producto.publico || "-"}</td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 `;
}

function eliminarCatalogoProveedor(indice) {
 const catalogos =
 catalogosGuardados();

 catalogos.splice(indice, 1);
 guardarCatalogosProveedor(catalogos);
 renderCatalogosProveedor();
}

async function limpiarCatalogosProveedor() {
 const confirmar =
 await confirmarPOS(
 "Eliminar todos los catalogos guardados?",
 "Limpiar catalogos",
 "peligro"
 );

 if (!confirmar) return;

 guardarCatalogosProveedor([]);
 renderCatalogosProveedor();
}

function abrirActualizarCatalogo() {
 cerrarFormularioAgregar();
 mostrarCatalogo();

 setTimeout(() => {
 abrirCargaCatalogo("actualizar");
 }, 80);
}

function limpiarTextoUI(texto) { return String(texto || '').replace(/[\uFFFD]/g, '').replace(/\u00c3\u00a1/g, 'a').replace(/\u00c3\u00a9/g, 'e').replace(/\u00c3\u00ad/g, 'i').replace(/\u00c3\u00b3/g, 'o').replace(/\u00c3\u00ba/g, 'u').replace(/\u00c3\u00b1/g, 'n').replace(/\u00c3\u0161/g, 'U').replace(/\u00c3\u201a&middot;|\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7|&middot;/g, '-').replace(/[\u00f0][^\s]*/g, '').replace(/\s+/g, ' ').trim(); }

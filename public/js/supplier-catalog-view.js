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

async function abrirNuevoProveedor(prellenado = {}) {
 const datos =
 await abrirFormularioCredito({
 titulo: "Nuevo proveedor",
 subtitulo: prellenado.nombre ? "Nexo prellenó estos datos -- revisalos antes de guardar" : "Registra datos de contacto y surtido",
 campos: camposProveedor(prellenado)
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
 <p id="catalogoHeaderContextual">Gestiona, vincula y mantiene los catalogos de tus proveedores.</p>
 </div>
 <div class="catalogo-actions">
 <button type="button" class="btn-catalogo-actualizar" onclick="reVincularCatalogoActual()">
 Actualizar vinculacion
 </button>
 <button type="button" class="btn-catalogo-subir" onclick="abrirCargaCatalogo('nuevo')">
 Subir catalogo nuevo
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
 <span>Vinculados</span>
 <strong id="catalogosVinculados">0</strong>
 </div>
 <div>
 <span>Con conflicto</span>
 <strong id="catalogosConflicto">0</strong>
 </div>
 <div>
 <span>Fotografias</span>
 <strong id="catalogosFotos">0</strong>
 </div>
 <div>
 <span>Ultima actualizacion</span>
 <strong id="catalogosUltima">Sin datos</strong>
 </div>
 </div>

 <p id="catalogoInsight" class="catalogo-insight" style="display:none;"></p>

 <div class="catalogo-grid3">
 <div class="catalogo-panel catalogo-panel-sidebar">
 <div class="catalogo-panel-head">
 <h3>Proveedores</h3>
 <button onclick="limpiarCatalogosProveedor()">Limpiar</button>
 </div>
 <div id="listaCatalogosProveedor"></div>
 </div>

 <div class="catalogo-panel catalogo-panel-productos">
 <div class="catalogo-filtros" id="catalogoFiltros">
 <button type="button" class="activo" data-estado="" onclick="cambiarFiltroCatalogo('')">Todos</button>
 <button type="button" data-estado="vinculado" onclick="cambiarFiltroCatalogo('vinculado')">Vinculados</button>
 <button type="button" data-estado="sin_vincular" onclick="cambiarFiltroCatalogo('sin_vincular')">Sin vincular</button>
 <button type="button" data-estado="coincidencia_parcial" onclick="cambiarFiltroCatalogo('coincidencia_parcial')">Coincidencia parcial</button>
 <button type="button" data-estado="conflicto" onclick="cambiarFiltroCatalogo('conflicto')">Con conflicto</button>
 </div>
 <div class="catalogo-buscador">
 <input type="text" id="buscarProductoCatalogoInput" placeholder="Buscar por codigo o nombre del producto..." oninput="buscarProductosCatalogoServidor(this.value)">
 </div>
 <div id="catalogoListaProductos" class="catalogo-lista-productos">
 <div class="catalogo-diagnostico-vacio">
 <strong>Sin catalogo seleccionado</strong>
 <span>Sube un catalogo o selecciona un proveedor de la izquierda.</span>
 </div>
 </div>
 <div id="catalogoPaginacion" class="catalogo-paginacion"></div>
 </div>

 <div class="catalogo-panel catalogo-panel-previa" id="catalogoPanelPrevia">
 <div class="catalogo-diagnostico-vacio">
 <strong>Vista previa</strong>
 <span>Selecciona un producto para ver su informacion.</span>
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

// Se conserva el nombre (procesarArchivosCatalogo la llama tal cual)
// pero ahora delega al sidebar real -- el conteo de "vinculados" solo
// existe en el servidor (catalog-server.js), asi que las tarjetas KPI
// y la lista de proveedores se llenan desde ahi, no de localStorage.
function renderCatalogosProveedor() {
 cargarCatalogosServidor();
}

/* ---------- Rediseno: motor de vinculacion real (Fase CAT4/CAT5) ---------- */

let catalogoActivoId = null;
let catalogoActivoProveedor = "";
let filtroEstadoCatalogo = "";
let busquedaCatalogoServidor = "";
let paginaCatalogoActual = 1;
let productoCatalogoSeleccionadoId = null;
let temporizadorBusquedaCatalogo = null;

const ETIQUETA_ESTADO_CATALOGO = {
 vinculado: "Vinculado",
 coincidencia_parcial: "Coincidencia parcial",
 sin_vincular: "Sin vincular",
 conflicto: "Con conflicto"
};

function badgeEstadoCatalogoHTML(estado) {
 const etiqueta = ETIQUETA_ESTADO_CATALOGO[estado] || "Sin vincular";
 return `<span class="catalogo-badge catalogo-badge-${estado || "sin_vincular"}">${etiqueta}</span>`;
}

// Parsea el CSV completo de un catalogo usando el mismo parser por
// proveedor que ya usa la busqueda por codigo de barras
// (catalog-parsers.js) -- no se reinventa la extraccion de columnas,
// solo se corre para TODAS las filas en vez de una sola.
function productosCompletosDesdeCatalogo(catalogo) {
 const lineas = String(catalogo.csv || "").split("\n").map(l => l.trim()).filter(Boolean);
 if (lineas.length === 0) return [];

 const mapaColumnas = detectarColumnasCatalogo(lineas);
 const columnas = mapaColumnas.columnas || {};
 const mapeoCatalogo = catalogo.mapeo || {};
 const parser = typeof parserCatalogoProveedor === "function"
  ? parserCatalogoProveedor(catalogo)
  : { extraerProducto: extraerProductoGenericoCatalogo };

 const indiceCodigoProducto = columnas.codigo ?? 0;

 return lineas
  .filter((linea, indice) => indice !== mapaColumnas.indice)
  .map(linea => {
   const datos = separarFilaCatalogo(linea);
   const codigoNormalizado = normalizarCodigo(
    valorColumnaCatalogo(datos, columnas, "codigo") ||
    valorMapeoCatalogo(datos, mapeoCatalogo, "codigoBarras") ||
    valorMapeoCatalogo(datos, mapeoCatalogo, "codigoInterno") ||
    datos[indiceCodigoProducto]
   );
   const codigosAlternos = String(valorMapeoCatalogo(datos, mapeoCatalogo, "codigosAlternos") || "")
    .split("|").map(normalizarCodigo).filter(Boolean);

   try {
    return parser.extraerProducto({
     datos, columnas, mapeoCatalogo, indiceCodigoProducto,
     codigoNormalizado, codigosAlternos, catalogoProveedor: catalogo
    });
   } catch (error) {
    return null;
   }
  })
  .filter(producto => producto && producto.codigo && producto.nombre);
}

async function subirCatalogoAlServidor(catalogo) {
 const productos = productosCompletosDesdeCatalogo(catalogo);

 if (productos.length === 0) {
  console.error("productosCompletosDesdeCatalogo() no extrajo ningun producto valido de", catalogo.proveedor, catalogo);
  alertaPOS(
   `No se pudo leer ningun producto del catalogo de "${catalogo.proveedor}" para vincularlo -- revisa que el archivo tenga las columnas de codigo y nombre bien detectadas (puedes verlo en "Lectura del catalogo" mas abajo si sigue disponible).`,
   "Catalogo proveedor",
   "alerta"
  );
  return;
 }

 try {
  const respuesta = await fetch(`/catalogo-proveedor/${encodeURIComponent(catalogo.proveedor)}/subir`, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ productos })
  });
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok) {
   console.error("No se pudo subir el catalogo al servidor", datos);
   alertaPOS(datos.error || `No se pudo subir el catalogo de "${catalogo.proveedor}" al servidor.`, "Catalogo proveedor", "alerta");
   return;
  }
  mostrarInsightCatalogo(datos.insight);
  cargarCatalogosServidor();
 } catch (error) {
  console.error("No se pudo subir el catalogo al servidor", error);
  alertaPOS(`No se pudo subir el catalogo de "${catalogo.proveedor}" al servidor: ${error.message}`, "Catalogo proveedor", "alerta");
 }
}

function mostrarInsightCatalogo(insight) {
 const el = document.getElementById("catalogoInsight");
 if (!el || !insight) return;
 const partes = [];
 if (insight.coincidenciasAutomaticas) partes.push(`${insight.coincidenciasAutomaticas} coincidencias automaticas`);
 if (insight.cambiosPrecio) partes.push(`${insight.cambiosPrecio} cambios de precio`);
 if (insight.nuevos) partes.push(`${insight.nuevos} productos nuevos`);
 if (partes.length === 0) { el.style.display = "none"; return; }
 el.textContent = `Nexo encontro ${partes.join(", ")}.`;
 el.style.display = "block";
}

async function cargarCatalogosServidor() {
 try {
  const respuesta = await fetch("/catalogo-proveedor");
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok) return;
  renderResumenCatalogos(datos.catalogos);
  renderSidebarCatalogos(datos.catalogos);
 } catch (error) {
  console.error("No se pudieron cargar los catalogos", error);
 }
}

async function renderResumenCatalogos(catalogos) {
 const totalProductos = catalogos.reduce((t, c) => t + Number(c.total_productos || 0), 0);
 const vinculados = catalogos.reduce((t, c) => t + Number(c.productos_vinculados || 0), 0);
 const conflictos = catalogos.reduce((t, c) => t + Number(c.productos_conflicto || 0), 0);
 const ultima = catalogos.map(c => c.updated_at).filter(Boolean).sort().at(-1);

 document.getElementById("catalogosTotal").textContent = catalogos.length;
 document.getElementById("catalogosProductos").textContent = totalProductos;
 document.getElementById("catalogosVinculados").textContent = vinculados;
 document.getElementById("catalogosConflicto").textContent = conflictos;
 document.getElementById("catalogosUltima").textContent = ultima ? tiempoRelativoPOS(ultima) : "Sin datos";

 try {
  const respuestaFotos = await fetch("/fotos-producto-resumen");
  const datosFotos = await respuestaFotos.json();
  if (respuestaFotos.ok && datosFotos.ok) {
   document.getElementById("catalogosFotos").textContent = datosFotos.total || 0;
  }
 } catch (error) { /* la tarjeta se queda en 0, no es critico */ }
}

function renderSidebarCatalogos(catalogos) {
 const lista = document.getElementById("listaCatalogosProveedor");
 if (!lista) return;

 if (catalogos.length === 0) {
  lista.innerHTML = `<div class="catalogo-vacio">Todavia no hay catalogos cargados.</div>`;
  return;
 }

 lista.innerHTML = catalogos.map(catalogo => `
  <div class="catalogo-proveedor-item${catalogo.id === catalogoActivoId ? " activo" : ""}" onclick="seleccionarCatalogoProveedor(${catalogo.id}, '${escaparAtributoCatalogo(catalogo.proveedor)}')">
   <span class="catalogo-proveedor-punto ${Number(catalogo.productos_conflicto) > 0 ? "ambar" : "verde"}"></span>
   <div class="catalogo-proveedor-info">
    <strong>${catalogo.proveedor}</strong>
    <span>${catalogo.total_productos} productos · ${tiempoRelativoPOS(catalogo.updated_at)}</span>
   </div>
   <button type="button" class="catalogo-proveedor-baja" onclick="event.stopPropagation(); bajaCatalogoServidor(${catalogo.id})" title="Dar de baja">×</button>
  </div>
 `).join("");

 if (!catalogoActivoId && catalogos.length > 0) {
  seleccionarCatalogoProveedor(catalogos[0].id, catalogos[0].proveedor);
 }
}

function escaparAtributoCatalogo(texto) {
 return String(texto || "").replace(/'/g, "\\'");
}

function seleccionarCatalogoProveedor(id, proveedor) {
 catalogoActivoId = id;
 catalogoActivoProveedor = proveedor;
 filtroEstadoCatalogo = "";
 paginaCatalogoActual = 1;
 productoCatalogoSeleccionadoId = null;

 document.querySelectorAll(".catalogo-proveedor-item").forEach(el => el.classList.remove("activo"));
 document.querySelectorAll(`#catalogoFiltros button`).forEach(b => b.classList.toggle("activo", b.dataset.estado === ""));

 const header = document.getElementById("catalogoHeaderContextual");
 if (header) header.textContent = `${proveedor} · cargando...`;

 cargarCatalogosServidor().then(() => {
  const item = [...document.querySelectorAll(".catalogo-proveedor-item")].find(el => el.querySelector("strong")?.textContent === proveedor);
  item?.classList.add("activo");
 });

 cargarProductosCatalogoServidor();

 fetch("/catalogo-proveedor").then(r => r.json()).then(datos => {
  const catalogo = datos.catalogos?.find(c => c.id === id);
  if (catalogo && header) {
   header.textContent = `${catalogo.proveedor} · ${catalogo.total_productos} productos · ${catalogo.productos_vinculados} vinculados · ${catalogo.productos_conflicto} con conflicto · Actualizado ${tiempoRelativoPOS(catalogo.updated_at)}`;
  }
 }).catch(() => {});
}

function cambiarFiltroCatalogo(estado) {
 filtroEstadoCatalogo = estado;
 paginaCatalogoActual = 1;
 document.querySelectorAll("#catalogoFiltros button").forEach(b => b.classList.toggle("activo", b.dataset.estado === estado));
 cargarProductosCatalogoServidor();
}

function buscarProductosCatalogoServidor(texto) {
 busquedaCatalogoServidor = texto;
 paginaCatalogoActual = 1;
 clearTimeout(temporizadorBusquedaCatalogo);
 temporizadorBusquedaCatalogo = setTimeout(() => cargarProductosCatalogoServidor(), 250);
}

async function cargarProductosCatalogoServidor() {
 const contenedor = document.getElementById("catalogoListaProductos");
 if (!contenedor || !catalogoActivoId) return;

 const parametros = new URLSearchParams({ pagina: String(paginaCatalogoActual) });
 if (filtroEstadoCatalogo) parametros.set("estado", filtroEstadoCatalogo);
 if (busquedaCatalogoServidor) parametros.set("buscar", busquedaCatalogoServidor);

 try {
  const respuesta = await fetch(`/catalogo-proveedor/${catalogoActivoId}/productos?${parametros}`);
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok) return;
  renderListaProductosCatalogo(datos);
 } catch (error) {
  console.error("No se pudieron cargar los productos del catalogo", error);
 }
}

function renderListaProductosCatalogo(datos) {
 const contenedor = document.getElementById("catalogoListaProductos");
 if (!contenedor) return;

 if (datos.productos.length === 0) {
  contenedor.innerHTML = `<div class="catalogo-diagnostico-vacio"><strong>Sin resultados</strong><span>Prueba con otro filtro o busqueda.</span></div>`;
  document.getElementById("catalogoPaginacion").innerHTML = "";
  return;
 }

 contenedor.innerHTML = datos.productos.map(p => `
  <div class="catalogo-fila-producto${p.id === productoCatalogoSeleccionadoId ? " activo" : ""}" onclick="seleccionarProductoCatalogo(${p.id})">
   <div class="catalogo-fila-codigo">${p.codigo_proveedor}</div>
   <div class="catalogo-fila-nombre">
    <strong>${p.nombre_proveedor}</strong>
    <span>${p.producto_nombre ? "→ " + p.producto_nombre : "Sin vincular en Nexo POS"}</span>
   </div>
   ${badgeEstadoCatalogoHTML(p.estado)}
  </div>
 `).join("");

 const totalPaginas = Math.max(1, Math.ceil(datos.total / datos.porPagina));
 const paginacion = document.getElementById("catalogoPaginacion");
 if (paginacion) {
  paginacion.innerHTML = totalPaginas > 1
   ? `<button ${paginaCatalogoActual <= 1 ? "disabled" : ""} onclick="irPaginaCatalogo(${paginaCatalogoActual - 1})">Anterior</button>
      <span>Pagina ${paginaCatalogoActual} de ${totalPaginas}</span>
      <button ${paginaCatalogoActual >= totalPaginas ? "disabled" : ""} onclick="irPaginaCatalogo(${paginaCatalogoActual + 1})">Siguiente</button>`
   : "";
 }
}

function irPaginaCatalogo(pagina) {
 paginaCatalogoActual = pagina;
 cargarProductosCatalogoServidor();
}

async function bajaCatalogoServidor(id) {
 const confirmar = await dialogoPOS({ titulo: "Dar de baja catalogo", mensaje: "Se eliminaran todos sus productos y vinculaciones. Esta accion no se puede deshacer.", mostrarCancelar: true, textoAceptar: "Dar de baja" });
 if (!confirmar) return;
 await fetch(`/catalogo-proveedor/${id}`, { method: "DELETE" });
 if (catalogoActivoId === id) { catalogoActivoId = null; }
 cargarCatalogosServidor();
}

async function reVincularCatalogoActual() {
 if (!catalogoActivoId) { alertaPOS("Selecciona un proveedor primero.", "Catalogo proveedor", "info"); return; }
 await fetch(`/catalogo-proveedor/${catalogoActivoId}/re-vincular`, { method: "POST" });
 cargarCatalogosServidor();
 cargarProductosCatalogoServidor();
 if (productoCatalogoSeleccionadoId) seleccionarProductoCatalogo(productoCatalogoSeleccionadoId);
}

/* ---------- Panel de vista previa (columna derecha) ---------- */

async function seleccionarProductoCatalogo(catalogoProductoId) {
 productoCatalogoSeleccionadoId = catalogoProductoId;
 document.querySelectorAll(".catalogo-fila-producto").forEach(el => el.classList.remove("activo"));

 const panel = document.getElementById("catalogoPanelPrevia");
 if (panel) panel.innerHTML = `<div class="catalogo-diagnostico-vacio"><strong>Cargando...</strong></div>`;

 try {
  const respuesta = await fetch(`/catalogo-proveedor/${catalogoActivoId}/productos/${catalogoProductoId}`);
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok) return;
  renderPanelPreviaCatalogo(datos.producto);
  cargarProductosCatalogoServidor();
 } catch (error) {
  console.error("No se pudo cargar el producto del catalogo", error);
 }
}

function formatoMonedaCatalogo(valor) {
 return valor === null || valor === undefined ? "No disponible" : `$${Number(valor).toFixed(2)}`;
}

function renderPanelPreviaCatalogo(p) {
 const panel = document.getElementById("catalogoPanelPrevia");
 if (!panel) return;

 // Existencia e imagen del proveedor: ningun catalogo los manda hoy
 // -- se muestran como estado vacio explicito, nunca inventados
 // (decision tomada con el usuario).
 const fotoHTML = p.producto_codigo
  ? `<img class="catalogo-previa-foto" src="/fotos-producto/${encodeURIComponent(p.producto_codigo)}/principal" alt="${p.nombre_proveedor}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'catalogo-previa-foto-vacia',textContent:'Sin foto'}))">`
  : `<div class="catalogo-previa-foto-vacia">Sin foto</div>`;

 const coincidenciaHTML = p.producto_id
  ? `
   <div class="catalogo-previa-match">
    <span class="catalogo-previa-match-ok">Producto encontrado</span>
    <span>${p.porcentaje_coincidencia ?? 100}% de coincidencia</span>
   </div>
   <dl class="catalogo-previa-datos">
    <dt>Producto en Nexo</dt><dd>${p.producto_nombre}</dd>
    <dt>Precio actual</dt><dd>${formatoMonedaCatalogo(p.producto_precio)}</dd>
    <dt>Existencia</dt><dd>${p.producto_stock ?? 0} pzas</dd>
   </dl>
   <button type="button" class="btn-catalogo-subir" onclick="verProductoDesdeCatalogo(${p.producto_id})">Ver producto en Nexo POS</button>
  `
  : `
   <div class="catalogo-previa-match catalogo-previa-match-pendiente">Sin vincular todavia</div>
   <button type="button" class="btn-catalogo-subir" onclick="abrirVinculacionManualCatalogo(${p.id})">Vincular con un producto existente</button>
   <button type="button" class="btn-catalogo-actualizar" onclick="crearProductoDesdeCatalogoActual(${p.id})">Crear producto nuevo</button>
  `;

 panel.innerHTML = `
  ${fotoHTML}
  <h4 class="catalogo-previa-titulo">Informacion del proveedor</h4>
  <dl class="catalogo-previa-datos">
   <dt>Codigo proveedor</dt><dd>${p.codigo_proveedor}</dd>
   <dt>Producto</dt><dd>${p.nombre_proveedor}</dd>
   <dt>Marca</dt><dd>${p.marca || "No disponible"}</dd>
   <dt>Precio publico</dt><dd>${formatoMonedaCatalogo(p.precio_publico)}</dd>
   <dt>Existencia del proveedor</dt><dd>No disponible</dd>
  </dl>
  <h4 class="catalogo-previa-titulo">Coincidencia en Nexo POS</h4>
  ${coincidenciaHTML}
 `;
}

function verProductoDesdeCatalogo(productoId) {
 if (typeof verDetalleProducto === "function") verDetalleProducto(productoId);
}

async function abrirVinculacionManualCatalogo(catalogoProductoId) {
 const codigo = await dialogoPOS({
  titulo: "Vincular manualmente",
  mensaje: "Escribe el codigo del producto de Nexo POS con el que quieres vincular esta fila del catalogo.",
  entrada: true,
  mostrarCancelar: true,
  textoAceptar: "Buscar"
 });
 if (!codigo) return;

 try {
  const respuesta = await fetch(`/productos?codigo=${encodeURIComponent(codigo)}`);
  const datos = await respuesta.json();
  const producto = Array.isArray(datos) ? datos.find(x => x.codigo === codigo) : null;
  if (!producto) { alertaPOS("No se encontro ningun producto con ese codigo.", "Catalogo proveedor", "alerta"); return; }

  await fetch(`/catalogo-proveedor/${catalogoActivoId}/productos/${catalogoProductoId}/vincular`, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ productoId: producto.id })
  });

  seleccionarProductoCatalogo(catalogoProductoId);
  cargarCatalogosServidor();
 } catch (error) {
  alertaPOS("No se pudo vincular el producto.", "Catalogo proveedor", "alerta");
 }
}

async function crearProductoDesdeCatalogoActual(catalogoProductoId) {
 const confirmar = await dialogoPOS({
  titulo: "Crear producto nuevo",
  mensaje: "Se creara un producto en tu inventario con los datos de esta fila del catalogo (sin existencia -- la agregas despues).",
  mostrarCancelar: true,
  textoAceptar: "Crear"
 });
 if (!confirmar) return;

 try {
  const respuesta = await fetch(`/catalogo-proveedor/${catalogoActivoId}/productos/${catalogoProductoId}/crear-producto`, { method: "POST" });
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok) { alertaPOS(datos.error || "No se pudo crear el producto.", "Catalogo proveedor", "alerta"); return; }

  seleccionarProductoCatalogo(catalogoProductoId);
  cargarCatalogosServidor();
 } catch (error) {
  alertaPOS("No se pudo crear el producto.", "Catalogo proveedor", "alerta");
 }
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

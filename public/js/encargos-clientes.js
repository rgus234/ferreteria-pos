// Pantalla "Encargos": productos que un cliente pidio que se le
// consiga con el proveedor (Diprofer/Truper/etc) porque no estan en
// inventario. El cliente puede ser uno de credito ya existente o
// alguien sin cuenta (nombre libre). Se puede seguir agregando
// productos despues de creado, mientras siga "pendiente"/"listo".

let encargosClientesActuales = [];
let itemsEncargoNuevo = [];
let encargoDetalleActual = null;
let filtroEstadoEncargos = "";

function dineroEncargo(valor) {
 return typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2);
}

function fechaCortaEncargo(valor) {
 if (!valor) return "Sin fecha";
 const texto = String(valor).slice(0, 10);
 const partes = texto.split("-");
 return partes.length === 3 ? partes[2] + "/" + partes[1] + "/" + partes[0] : texto;
}

const ETIQUETA_ESTADO_ENCARGO = {
 pendiente: "Pendiente",
 listo: "Listo para entregar",
 entregado: "Entregado",
 cancelado: "Cancelado"
};

const ETIQUETA_FILTRO_ENCARGO = {
 pendiente: "pendientes",
 listo: "listos para entregar",
 vencido: "vencidos",
 entregado: "entregados"
};

// "Vencido" no es un estado real en la base -- es pendiente/listo cuya
// fecha de entrega ya paso. Se calcula aqui, nunca se guarda, para que
// nunca se desincronice de "hoy".
function esEncargoVencido(encargo) {
 if (encargo.estado !== "pendiente" && encargo.estado !== "listo") return false;
 if (!encargo.fechaEntregaEsperada) return false;

 const hoy = new Date().toISOString().slice(0, 10);
 return String(encargo.fechaEntregaEsperada).slice(0, 10) < hoy;
}

function inicialesEncargoCliente(nombre) {
 return typeof inicialesNegocio === "function" ? inicialesNegocio(nombre) : String(nombre || "?").slice(0, 2).toUpperCase();
}

async function mostrarEncargos() {
 if (typeof ocultarPantallasPrincipales === "function") {
 ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaEncargos");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto("Encargos", "Productos que tus clientes pidieron encargar con el proveedor", "encargos");
 }

 itemsEncargoNuevo = [];

 pantalla.innerHTML = `
 <div class="encargos-shell">
 <div class="encargos-header">
 <div>
 <h2>Encargos de clientes</h2>
 <p>Registra lo que un cliente pidió encargar, con anticipo y fecha estimada de entrega.</p>
 </div>
 </div>

 <div class="encargos-stats" id="encargosStats"></div>

 <div class="encargos-grid">
 <section class="encargos-panel">
 <h3>${iconoUISVG("plus")}<span>Nuevo encargo</span></h3>

 <div class="encargo-form-cliente">
 <label>Cliente
 <input id="encargoClienteNombre" list="encargoClienteLista" placeholder="Nombre del cliente" oninput="autocompletarClienteEncargo()">
 <datalist id="encargoClienteLista"></datalist>
 </label>
 <label>Teléfono
 <input id="encargoClienteTelefono" placeholder="Opcional">
 </label>
 </div>

 <div class="encargo-form-fila">
 <label>Anticipo
 <input id="encargoAnticipo" type="number" step="0.01" min="0" placeholder="0.00">
 </label>
 <label>Fecha estimada de entrega
 <input id="encargoFechaEntrega" type="date">
 </label>
 </div>

 <label class="encargo-form-notas">Notas
 <input id="encargoNotas" placeholder="Opcional">
 </label>

 <div class="encargo-add-row">
 <label>Producto
 <input id="encargoProductoNombre" list="encargoProductoLista" placeholder="Nombre del producto">
 <datalist id="encargoProductoLista"></datalist>
 </label>
 <label>Cant.
 <input id="encargoCantidad" type="number" step="0.001" min="0.001" placeholder="1">
 </label>
 <label>Precio est.
 <input id="encargoPrecioEstimado" type="number" step="0.01" min="0" placeholder="0.00">
 </label>
 <button type="button" class="btn-encargo-agregar" onclick="agregarItemFormularioEncargo()">Agregar</button>
 </div>

 <div id="encargoTablaItemsNuevo"></div>

 <button type="button" class="btn-encargo-primario encargo-btn-full" onclick="guardarEncargoNuevo()">Guardar encargo</button>
 </section>

 <section class="encargos-panel">
 <div class="encargos-panel-titulo-fila">
 <h3>${iconoUISVG("clipboard")}<span>Encargos</span></h3>
 <div class="encargos-filtros">
 <button type="button" class="activo" data-estado="" onclick="filtrarEncargos('')">Todos <span class="encargo-filtro-conteo" data-conteo="">0</span></button>
 <button type="button" data-estado="pendiente" onclick="filtrarEncargos('pendiente')">Pendientes <span class="encargo-filtro-conteo" data-conteo="pendiente">0</span></button>
 <button type="button" data-estado="listo" onclick="filtrarEncargos('listo')">Listos <span class="encargo-filtro-conteo" data-conteo="listo">0</span></button>
 <button type="button" data-estado="vencido" onclick="filtrarEncargos('vencido')">Vencidos <span class="encargo-filtro-conteo alerta" data-conteo="vencido">0</span></button>
 <button type="button" data-estado="entregado" onclick="filtrarEncargos('entregado')">Entregados <span class="encargo-filtro-conteo" data-conteo="entregado">0</span></button>
 </div>
 </div>
 <div id="listaEncargosClientes" class="encargos-lista"></div>
 </section>
 </div>
 </div>
 `;

 llenarDatalistClientesEncargo();
 llenarDatalistProductosEncargo();
 renderTablaItemsEncargoNuevo();
 await cargarListaEncargos();
}

function llenarDatalistClientesEncargo() {
 const lista =
 document.getElementById("encargoClienteLista");

 if (!lista) return;

 lista.innerHTML =
 (typeof clientesCredito !== "undefined" ? clientesCredito : [])
 .map(cliente => `<option value="${escaparPOS(cliente.nombre)}"></option>`)
 .join("");
}

function llenarDatalistProductosEncargo() {
 const lista =
 document.getElementById("encargoProductoLista");

 if (!lista) return;

 lista.innerHTML =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .slice(0, 500)
 .map(producto => `<option value="${escaparPOS(producto.nombre)}"></option>`)
 .join("");
}

function autocompletarClienteEncargo() {
 const nombre =
 document.getElementById("encargoClienteNombre")?.value.trim();

 const telefonoInput =
 document.getElementById("encargoClienteTelefono");

 if (!nombre || !telefonoInput) return;

 const cliente =
 (typeof clientesCredito !== "undefined" ? clientesCredito : [])
 .find(item => item.nombre?.trim().toLowerCase() === nombre.toLowerCase());

 if (cliente) {
 telefonoInput.value = cliente.telefono || "";
 }
}

function clienteEncargoSeleccionado() {
 const nombre =
 document.getElementById("encargoClienteNombre")?.value.trim();

 if (!nombre) return null;

 return (typeof clientesCredito !== "undefined" ? clientesCredito : [])
 .find(item => item.nombre?.trim().toLowerCase() === nombre.toLowerCase()) || null;
}

function agregarItemFormularioEncargo() {
 const nombreInput =
 document.getElementById("encargoProductoNombre");

 const nombre =
 nombreInput?.value.trim();

 if (!nombre) {
 nombreInput?.focus();
 return;
 }

 const cantidad =
 Number(document.getElementById("encargoCantidad")?.value || 1);

 const precioEstimado =
 Number(document.getElementById("encargoPrecioEstimado")?.value || 0);

 const productoExistente =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .find(producto => producto.nombre?.trim().toLowerCase() === nombre.toLowerCase());

 itemsEncargoNuevo.push({
 productoId: productoExistente?.id || null,
 codigo: productoExistente?.codigo || "",
 nombre,
 cantidad: cantidad > 0 ? cantidad : 1,
 precioEstimado: precioEstimado >= 0 ? precioEstimado : 0
 });

 nombreInput.value = "";
 document.getElementById("encargoCantidad").value = "";
 document.getElementById("encargoPrecioEstimado").value = "";
 nombreInput.focus();

 renderTablaItemsEncargoNuevo();
}

function quitarItemFormularioEncargo(indice) {
 itemsEncargoNuevo.splice(indice, 1);
 renderTablaItemsEncargoNuevo();
}

function renderTablaItemsEncargoNuevo() {
 const contenedor =
 document.getElementById("encargoTablaItemsNuevo");

 if (!contenedor) return;

 if (itemsEncargoNuevo.length === 0) {
 contenedor.innerHTML = `<p class="encargo-items-vacio">Todavía no agregas productos.</p>`;
 return;
 }

 contenedor.innerHTML = `
 <table class="encargo-tabla-items">
 <thead>
 <tr><th>Producto</th><th>Cant.</th><th>Precio est.</th><th></th></tr>
 </thead>
 <tbody>
 ${itemsEncargoNuevo.map((item, indice) => `
 <tr>
 <td>${escaparPOS(item.nombre)}</td>
 <td>${item.cantidad}</td>
 <td>${dineroEncargo(item.precioEstimado)}</td>
 <td><button type="button" class="btn-encargo-quitar" onclick="quitarItemFormularioEncargo(${indice})">Quitar</button></td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 `;
}

async function guardarEncargoNuevo() {
 const clienteNombre =
 document.getElementById("encargoClienteNombre")?.value.trim();

 if (!clienteNombre) {
 alertaPOS("Escribe el nombre del cliente.", "Falta el cliente", "alerta");
 return;
 }

 if (itemsEncargoNuevo.length === 0) {
 alertaPOS("Agrega al menos un producto al encargo.", "Sin productos", "alerta");
 return;
 }

 const clienteExistente =
 clienteEncargoSeleccionado();

 const payload = {
 clienteId: clienteExistente?.id || null,
 clienteNombre,
 clienteTelefono: document.getElementById("encargoClienteTelefono")?.value.trim() || "",
 anticipo: Number(document.getElementById("encargoAnticipo")?.value || 0),
 fechaEntregaEsperada: document.getElementById("encargoFechaEntrega")?.value || null,
 notas: document.getElementById("encargoNotas")?.value.trim() || "",
 items: itemsEncargoNuevo
 };

 try {
 const respuesta =
 await fetch("/encargos-clientes", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload)
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo guardar el encargo.", "Error", "peligro");
 return;
 }

 alertaPOS("Encargo guardado.", "Listo", "exito");
 itemsEncargoNuevo = [];
 await mostrarEncargos();
 } catch (error) {
 alertaPOS("No se pudo guardar el encargo. Revisa tu conexión.", "Error", "peligro");
 }
}

function filtrarEncargos(estado) {
 filtroEstadoEncargos = estado;

 document.querySelectorAll(".encargos-filtros button").forEach(boton => {
 boton.classList.toggle("activo", boton.dataset.estado === estado);
 });

 renderListaEncargos();
}

// Trae SIEMPRE la lista completa (sin filtro de estado en el
// servidor) -- el filtro de las pestanas ahora es 100% del lado del
// cliente. Asi las tarjetas de resumen y los contadores por pestana
// reflejan el total real sin importar cual pestana este activa, y
// cambiar de pestana no vuelve a pedir nada al servidor.
async function cargarListaEncargos() {
 const lista =
 document.getElementById("listaEncargosClientes");

 if (!lista) return;

 lista.innerHTML = `<p class="encargo-items-vacio">Cargando...</p>`;

 try {
 const respuesta =
 await fetch("/encargos-clientes");

 const datos =
 await respuesta.json().catch(() => ({}));

 encargosClientesActuales =
 (respuesta.ok && datos.ok) ? datos.encargos : [];

 renderStatsEncargos();
 actualizarConteosFiltrosEncargos();
 renderListaEncargos();
 } catch (error) {
 lista.innerHTML = `<p class="encargo-items-vacio">No se pudo cargar la lista.</p>`;
 }
}

function renderStatsEncargos() {
 const contenedor =
 document.getElementById("encargosStats");

 if (!contenedor) return;

 const pendientes = encargosClientesActuales.filter(e => e.estado === "pendiente");
 const listos = encargosClientesActuales.filter(e => e.estado === "listo");
 const vencidos = encargosClientesActuales.filter(esEncargoVencido);
 const anticipoEnMano = [...pendientes, ...listos].reduce((suma, e) => suma + Number(e.anticipo || 0), 0);

 contenedor.innerHTML = `
 <div class="encargo-stat-tarjeta stat-pendiente">
 <span class="encargo-stat-icono">${iconoUISVG("clock")}</span>
 <div><strong>${pendientes.length}</strong><span>Pendientes</span></div>
 </div>
 <div class="encargo-stat-tarjeta stat-listo">
 <span class="encargo-stat-icono">${iconoUISVG("check")}</span>
 <div><strong>${listos.length}</strong><span>Listos para entregar</span></div>
 </div>
 <div class="encargo-stat-tarjeta stat-vencido${vencidos.length > 0 ? " con-alerta" : ""}">
 <span class="encargo-stat-icono">${iconoUISVG("alert")}</span>
 <div><strong>${vencidos.length}</strong><span>Vencidos</span></div>
 </div>
 <div class="encargo-stat-tarjeta stat-anticipo">
 <span class="encargo-stat-icono">${iconoUISVG("wallet")}</span>
 <div><strong>${dineroEncargo(anticipoEnMano)}</strong><span>Anticipos en mano</span></div>
 </div>
 `;
}

function actualizarConteosFiltrosEncargos() {
 const conteos = {
 "": encargosClientesActuales.length,
 pendiente: 0,
 listo: 0,
 vencido: 0,
 entregado: 0
 };

 encargosClientesActuales.forEach(encargo => {
 if (conteos[encargo.estado] !== undefined) conteos[encargo.estado] += 1;
 if (esEncargoVencido(encargo)) conteos.vencido += 1;
 });

 document.querySelectorAll(".encargo-filtro-conteo").forEach(span => {
 const clave = span.dataset.conteo;
 span.textContent = conteos[clave] ?? 0;
 });
}

function encargosFiltrados() {
 if (filtroEstadoEncargos === "vencido") {
 return encargosClientesActuales.filter(esEncargoVencido);
 }

 if (!filtroEstadoEncargos) return encargosClientesActuales;

 return encargosClientesActuales.filter(encargo => encargo.estado === filtroEstadoEncargos);
}

function renderListaEncargos() {
 const lista =
 document.getElementById("listaEncargosClientes");

 if (!lista) return;

 const items =
 encargosFiltrados();

 if (items.length === 0) {
 lista.innerHTML = `
 <div class="encargo-vacio-estado">
 ${iconoUISVG("clipboard")}
 <p>Sin encargos ${filtroEstadoEncargos ? ETIQUETA_FILTRO_ENCARGO[filtroEstadoEncargos] : ""}.</p>
 </div>
 `;
 return;
 }

 lista.innerHTML =
 items.map(encargo => {
 const vencido = esEncargoVencido(encargo);

 return `
 <article class="encargo-card estado-${encargo.estado}${vencido ? " encargo-vencido" : ""}" onclick="abrirDetalleEncargo(${encargo.id})">
 <div class="encargo-card-cabecera">
 <div class="encargo-card-cliente">
 <span class="encargo-avatar">${inicialesEncargoCliente(encargo.clienteNombre)}</span>
 <strong>${escaparPOS(encargo.clienteNombre)}</strong>
 </div>
 <span class="encargo-badge estado-${encargo.estado}">${ETIQUETA_ESTADO_ENCARGO[encargo.estado] || encargo.estado}</span>
 </div>
 <span class="encargo-card-detalle">${encargo.totalItems} producto(s) &middot; ${dineroEncargo(encargo.totalEstimado)}</span>
 <span class="encargo-card-detalle${vencido ? " encargo-card-detalle-vencido" : ""}">${vencido ? iconoUISVG("alert") : ""}Entrega: ${fechaCortaEncargo(encargo.fechaEntregaEsperada)}${Number(encargo.anticipo) > 0 ? ` &middot; Anticipo ${dineroEncargo(encargo.anticipo)}` : ""}</span>
 </article>
 `;
 }).join("");
}

async function abrirDetalleEncargo(id) {
 try {
 const respuesta =
 await fetch(`/encargos-clientes/${id}`);

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS("No se pudo abrir el encargo.", "Error", "peligro");
 return;
 }

 encargoDetalleActual = datos.encargo;
 renderModalDetalleEncargo();
 } catch (error) {
 alertaPOS("No se pudo abrir el encargo.", "Error", "peligro");
 }
}

function renderModalDetalleEncargo() {
 let modal =
 document.getElementById("modalDetalleEncargo");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalDetalleEncargo";
 modal.className = "modal-personalizado modal-detalle-encargo";
 document.body.appendChild(modal);
 }

 const encargo =
 encargoDetalleActual;

 if (!encargo) return;

 const totalEstimado =
 encargo.items.reduce((suma, item) => suma + item.cantidad * item.precioEstimado, 0);

 const vencido =
 esEncargoVencido(encargo);

 modal.innerHTML = `
 <div class="modal-card encargo-detalle-card">
 <div class="modal-card-header">
 <div class="encargo-detalle-header-cliente">
 <span class="encargo-avatar encargo-avatar-grande">${inicialesEncargoCliente(encargo.clienteNombre)}</span>
 <div>
 <span>Encargo</span>
 <h3>${escaparPOS(encargo.clienteNombre)}</h3>
 </div>
 </div>
 <button type="button" onclick="cerrarDetalleEncargo()">Cerrar</button>
 </div>

 ${vencido ? `<p class="encargo-detalle-aviso-vencido">${iconoUISVG("alert")}Este encargo ya debería haber llegado.</p>` : ""}

 <div class="encargo-detalle-info">
 <span>Teléfono: ${escaparPOS(encargo.clienteTelefono || "Sin teléfono")}</span>
 <span>Anticipo: ${dineroEncargo(encargo.anticipo)}</span>
 <span>Entrega estimada: ${fechaCortaEncargo(encargo.fechaEntregaEsperada)}</span>
 ${encargo.notas ? `<span>Notas: ${escaparPOS(encargo.notas)}</span>` : ""}
 </div>

 <table class="encargo-tabla-items">
 <thead>
 <tr><th>Producto</th><th>Cant.</th><th>Precio est.</th><th></th></tr>
 </thead>
 <tbody>
 ${encargo.items.map(item => `
 <tr>
 <td>${escaparPOS(item.nombre)}</td>
 <td>${item.cantidad}</td>
 <td>${dineroEncargo(item.precioEstimado)}</td>
 <td>${encargo.estado !== "entregado" && encargo.estado !== "cancelado" ? `<button type="button" class="btn-encargo-quitar" onclick="quitarItemEncargoExistente(${item.id})">Quitar</button>` : ""}</td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 <p class="encargo-detalle-total">Total estimado: <strong>${dineroEncargo(totalEstimado)}</strong></p>

 ${encargo.estado !== "entregado" && encargo.estado !== "cancelado" ? `
 <div class="encargo-add-row">
 <label>Producto
 <input id="encargoDetalleProductoNombre" placeholder="Nombre del producto">
 </label>
 <label>Cant.
 <input id="encargoDetalleCantidad" type="number" step="0.001" min="0.001" placeholder="1">
 </label>
 <label>Precio est.
 <input id="encargoDetallePrecioEstimado" type="number" step="0.01" min="0" placeholder="0.00">
 </label>
 <button type="button" class="btn-encargo-agregar" onclick="agregarItemEncargoExistente()">Agregar</button>
 </div>
 ` : ""}

 <div class="encargo-detalle-acciones">
 ${encargo.estado === "pendiente" ? `<button type="button" class="btn-encargo-primario" onclick="cambiarEstadoEncargo('listo')">Marcar listo para entregar</button>` : ""}
 ${encargo.estado === "pendiente" || encargo.estado === "listo" ? `<button type="button" class="btn-encargo-primario" onclick="cambiarEstadoEncargo('entregado')">Marcar entregado</button>` : ""}
 ${encargo.estado === "pendiente" || encargo.estado === "listo" ? `<button type="button" class="btn-encargo-secundario" onclick="cambiarEstadoEncargo('cancelado')">Cancelar encargo</button>` : ""}
 </div>
 </div>
 `;

 modal.style.display = "flex";
}

function cerrarDetalleEncargo() {
 const modal =
 document.getElementById("modalDetalleEncargo");

 if (modal) modal.style.display = "none";

 encargoDetalleActual = null;
}

async function agregarItemEncargoExistente() {
 if (!encargoDetalleActual) return;

 const nombreInput =
 document.getElementById("encargoDetalleProductoNombre");

 const nombre =
 nombreInput?.value.trim();

 if (!nombre) {
 nombreInput?.focus();
 return;
 }

 const cantidad =
 Number(document.getElementById("encargoDetalleCantidad")?.value || 1);

 const precioEstimado =
 Number(document.getElementById("encargoDetallePrecioEstimado")?.value || 0);

 const productoExistente =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .find(producto => producto.nombre?.trim().toLowerCase() === nombre.toLowerCase());

 try {
 const respuesta =
 await fetch(`/encargos-clientes/${encargoDetalleActual.id}/items`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 productoId: productoExistente?.id || null,
 codigo: productoExistente?.codigo || "",
 nombre,
 cantidad: cantidad > 0 ? cantidad : 1,
 precioEstimado: precioEstimado >= 0 ? precioEstimado : 0
 })
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo agregar el producto.", "Error", "peligro");
 return;
 }

 encargoDetalleActual = datos.encargo;
 renderModalDetalleEncargo();
 cargarListaEncargos();
 } catch (error) {
 alertaPOS("No se pudo agregar el producto.", "Error", "peligro");
 }
}

async function quitarItemEncargoExistente(itemId) {
 if (!encargoDetalleActual) return;

 try {
 const respuesta =
 await fetch(`/encargos-clientes/${encargoDetalleActual.id}/items/${itemId}`, {
 method: "DELETE"
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo quitar el producto.", "Error", "peligro");
 return;
 }

 encargoDetalleActual = datos.encargo;
 renderModalDetalleEncargo();
 cargarListaEncargos();
 } catch (error) {
 alertaPOS("No se pudo quitar el producto.", "Error", "peligro");
 }
}

async function cambiarEstadoEncargo(estado) {
 if (!encargoDetalleActual) return;

 try {
 const respuesta =
 await fetch(`/encargos-clientes/${encargoDetalleActual.id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ estado })
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo actualizar el encargo.", "Error", "peligro");
 return;
 }

 cerrarDetalleEncargo();
 cargarListaEncargos();
 } catch (error) {
 alertaPOS("No se pudo actualizar el encargo.", "Error", "peligro");
 }
}

// Aviso fijo (no se cierra solo) que aparece al entrar al POS si hay
// encargos con fecha de entrega hoy o vencida -- a diferencia de los
// recordatorios de la campanita (localStorage, faciles de descartar
// sin querer), este vive en el servidor y se repite cada vez que se
// entra al sistema mientras el encargo siga sin marcarse entregado.
async function revisarEncargosVencidosPOS() {
 try {
 const respuesta =
 await fetch("/encargos-clientes/pendientes-hoy");

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok || !datos.encargos?.length) return;

 const nombres =
 datos.encargos.map(item => item.clienteNombre).join(", ");

 const mensaje =
 datos.encargos.length === 1
 ? `El encargo de ${nombres} ya debería haber llegado.`
 : `${datos.encargos.length} encargos ya deberían haber llegado: ${nombres}.`;

 if (typeof mostrarToastPOS === "function") {
 mostrarToastPOS(mensaje, {
 titulo: "Encargos por entregar",
 tipo: "peligro",
 sinCerrar: true,
 accion: { texto: "Ver encargos", onClick: () => mostrarEncargos() }
 });
 }
 } catch (error) {
 console.warn("No se pudieron revisar los encargos pendientes", error);
 }
}

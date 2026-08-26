// Listas de productos reutilizables (utiles escolares, despensa
// basica, kits que se venden seguido) -- se arma una vez y despues,
// temporada tras temporada, se agrega completa al carrito desde el
// Punto de Venta con un click en vez de buscar producto por producto.
// Mismo patron de pantalla que Encargos (panel de alta + lista de
// tarjetas + modal de detalle), reusa las clases CSS de
// encargos-clientes.css porque la forma visual es identica.

let listasProductoActuales = [];
let itemsListaNueva = [];
let listaDetalleActual = null;

async function mostrarListasProducto() {
 if (typeof ocultarPantallasPrincipales === "function") {
 ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaListasProducto");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto("Listas de productos", "Arma listas que vendes seguido para agregarlas completas al carrito", "listas-producto");
 }

 itemsListaNueva = [];

 pantalla.innerHTML = `
 <div class="encargos-shell">
 <div class="encargos-header">
 <div>
 <h2>Listas de productos</h2>
 <p>Arma listas de productos que vendes seguido (utiles escolares, despensa basica) para agregarlas completas al carrito desde el Punto de Venta.</p>
 </div>
 </div>

 <div class="encargos-grid">
 <section class="encargos-panel">
 <h3>Nueva lista</h3>

 <div class="encargo-form-fila">
 <label>Nombre
 <input id="listaProductoNombre" placeholder="Ej. Utiles 3er grado">
 </label>
 <label>Descripcion
 <input id="listaProductoDescripcion" placeholder="Opcional">
 </label>
 </div>

 <div class="encargo-add-row">
 <label>Producto
 <input id="listaProductoItemNombre" list="listaProductoItemLista" placeholder="Nombre del producto">
 <datalist id="listaProductoItemLista"></datalist>
 </label>
 <label>Cant.
 <input id="listaProductoItemCantidad" type="number" step="0.001" min="0.001" placeholder="1">
 </label>
 <button type="button" class="btn-encargo-agregar" onclick="agregarItemFormularioListaProducto()">Agregar</button>
 </div>

 <div id="listaProductoTablaItemsNuevo"></div>

 <button type="button" class="btn-encargo-primario encargo-btn-full" onclick="guardarListaProductoNueva()">Guardar lista</button>
 </section>

 <section class="encargos-panel">
 <div class="encargos-panel-titulo-fila">
 <h3>Tus listas</h3>
 </div>
 <div id="listaListasProducto" class="encargos-lista"></div>
 </section>
 </div>
 </div>
 `;

 llenarDatalistProductosListaProducto();
 renderTablaItemsListaProductoNuevo();
 await cargarListasProducto();
}

function llenarDatalistProductosListaProducto() {
 const lista =
 document.getElementById("listaProductoItemLista");

 if (!lista) return;

 lista.innerHTML =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .slice(0, 500)
 .map(producto => `<option value="${escaparPOS(producto.nombre)}"></option>`)
 .join("");
}

function agregarItemFormularioListaProducto() {
 const nombreInput =
 document.getElementById("listaProductoItemNombre");

 const nombre =
 nombreInput?.value.trim();

 if (!nombre) {
 nombreInput?.focus();
 return;
 }

 const producto =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .find(item => item.nombre?.trim().toLowerCase() === nombre.toLowerCase());

 if (!producto) {
 alertaPOS("Ese producto no esta en tu inventario. Escribe el nombre exacto o elige una de las sugerencias.", "Producto no encontrado", "alerta");
 return;
 }

 const cantidad =
 Number(document.getElementById("listaProductoItemCantidad")?.value || 1);

 const existente =
 itemsListaNueva.find(item => Number(item.productoId) === Number(producto.id));

 if (existente) {
 existente.cantidad += cantidad > 0 ? cantidad : 1;
 } else {
 itemsListaNueva.push({
 productoId: producto.id,
 nombre: producto.nombre,
 codigo: producto.codigo || "",
 cantidad: cantidad > 0 ? cantidad : 1
 });
 }

 nombreInput.value = "";
 document.getElementById("listaProductoItemCantidad").value = "";
 nombreInput.focus();

 renderTablaItemsListaProductoNuevo();
}

function quitarItemFormularioListaProducto(indice) {
 itemsListaNueva.splice(indice, 1);
 renderTablaItemsListaProductoNuevo();
}

function renderTablaItemsListaProductoNuevo() {
 const contenedor =
 document.getElementById("listaProductoTablaItemsNuevo");

 if (!contenedor) return;

 if (itemsListaNueva.length === 0) {
 contenedor.innerHTML = `<p class="encargo-items-vacio">Todavia no agregas productos.</p>`;
 return;
 }

 contenedor.innerHTML = `
 <table class="encargo-tabla-items">
 <thead>
 <tr><th>Producto</th><th>Cant.</th><th></th></tr>
 </thead>
 <tbody>
 ${itemsListaNueva.map((item, indice) => `
 <tr>
 <td>${escaparPOS(item.nombre)}</td>
 <td>${item.cantidad}</td>
 <td><button type="button" class="btn-encargo-quitar" onclick="quitarItemFormularioListaProducto(${indice})">Quitar</button></td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 `;
}

async function guardarListaProductoNueva() {
 const nombre =
 document.getElementById("listaProductoNombre")?.value.trim();

 if (!nombre) {
 alertaPOS("Escribe el nombre de la lista.", "Falta el nombre", "alerta");
 return;
 }

 if (itemsListaNueva.length === 0) {
 alertaPOS("Agrega al menos un producto a la lista.", "Sin productos", "alerta");
 return;
 }

 const payload = {
 nombre,
 descripcion: document.getElementById("listaProductoDescripcion")?.value.trim() || "",
 items: itemsListaNueva.map(item => ({ productoId: item.productoId, cantidad: item.cantidad }))
 };

 try {
 const respuesta =
 await fetch("/listas-producto", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload)
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo guardar la lista.", "Error", "peligro");
 return;
 }

 alertaPOS("Lista guardada.", "Listo", "exito");
 itemsListaNueva = [];
 await mostrarListasProducto();
 } catch (error) {
 alertaPOS("No se pudo guardar la lista. Revisa tu conexion.", "Error", "peligro");
 }
}

async function cargarListasProducto() {
 const lista =
 document.getElementById("listaListasProducto");

 if (!lista) return;

 lista.innerHTML = `<p class="encargo-items-vacio">Cargando...</p>`;

 try {
 const respuesta =
 await fetch("/listas-producto");

 const datos =
 await respuesta.json().catch(() => ({}));

 listasProductoActuales =
 (respuesta.ok && datos.ok) ? datos.listas : [];

 renderListaListasProducto();
 } catch (error) {
 lista.innerHTML = `<p class="encargo-items-vacio">No se pudo cargar la lista.</p>`;
 }
}

function renderListaListasProducto() {
 const lista =
 document.getElementById("listaListasProducto");

 if (!lista) return;

 if (listasProductoActuales.length === 0) {
 lista.innerHTML = `<p class="encargo-items-vacio">Todavia no tienes listas guardadas.</p>`;
 return;
 }

 lista.innerHTML =
 listasProductoActuales.map(item => `
 <article class="encargo-card" onclick="abrirDetalleListaProducto(${item.id})">
 <div class="encargo-card-cabecera">
 <strong>${escaparPOS(item.nombre)}</strong>
 <span class="encargo-badge ${item.activa ? "estado-listo" : "estado-cancelado"}">${item.activa ? "Activa" : "Inactiva"}</span>
 </div>
 ${item.descripcion ? `<span class="encargo-card-detalle">${escaparPOS(item.descripcion)}</span>` : ""}
 <span class="encargo-card-detalle">${item.totalItems} producto(s)</span>
 </article>
 `).join("");
}

async function abrirDetalleListaProducto(id) {
 try {
 const respuesta =
 await fetch(`/listas-producto/${id}`);

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS("No se pudo abrir la lista.", "Error", "peligro");
 return;
 }

 listaDetalleActual = datos.lista;
 renderModalDetalleListaProducto();
 } catch (error) {
 alertaPOS("No se pudo abrir la lista.", "Error", "peligro");
 }
}

function renderModalDetalleListaProducto() {
 let modal =
 document.getElementById("modalDetalleListaProducto");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalDetalleListaProducto";
 modal.className = "modal-personalizado modal-detalle-encargo";
 document.body.appendChild(modal);
 }

 const lista =
 listaDetalleActual;

 if (!lista) return;

 modal.innerHTML = `
 <div class="modal-card encargo-detalle-card">
 <div class="modal-card-header">
 <div>
 <span>Lista de productos</span>
 <h3>${escaparPOS(lista.nombre)}</h3>
 </div>
 <button type="button" onclick="cerrarDetalleListaProducto()">Cerrar</button>
 </div>

 <div class="encargo-form-fila">
 <label>Nombre
 <input id="listaDetalleNombre" value="${escaparPOS(lista.nombre)}">
 </label>
 <label>Descripcion
 <input id="listaDetalleDescripcion" value="${escaparPOS(lista.descripcion || "")}">
 </label>
 </div>

 <table class="encargo-tabla-items">
 <thead>
 <tr><th>Producto</th><th>Codigo</th><th>Cant.</th><th></th></tr>
 </thead>
 <tbody>
 ${lista.items.map(item => `
 <tr>
 <td>${escaparPOS(item.nombre)}</td>
 <td>${escaparPOS(item.codigo || "-")}</td>
 <td><input type="number" step="0.001" min="0.001" value="${item.cantidad}" class="lista-detalle-cantidad-input" onchange="actualizarCantidadItemListaProducto(${item.id}, this.value)"></td>
 <td><button type="button" class="btn-encargo-quitar" onclick="quitarItemListaProductoExistente(${item.id})">Quitar</button></td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 ${lista.items.length === 0 ? `<p class="encargo-items-vacio">Esta lista no tiene productos.</p>` : ""}

 <div class="encargo-add-row">
 <label>Producto
 <input id="listaDetalleItemNombre" list="listaProductoItemLista" placeholder="Nombre del producto">
 </label>
 <label>Cant.
 <input id="listaDetalleItemCantidad" type="number" step="0.001" min="0.001" placeholder="1">
 </label>
 <button type="button" class="btn-encargo-agregar" onclick="agregarItemListaProductoExistente()">Agregar</button>
 </div>

 <div class="encargo-detalle-acciones">
 <button type="button" class="btn-encargo-primario" onclick="guardarCambiosListaProducto()">Guardar cambios</button>
 <button type="button" class="btn-encargo-secundario" onclick="alternarActivaListaProducto()">${lista.activa ? "Marcar inactiva" : "Marcar activa"}</button>
 <button type="button" class="btn-encargo-quitar" onclick="eliminarListaProductoActual()">Eliminar lista</button>
 </div>
 </div>
 `;

 modal.style.display = "flex";
}

function cerrarDetalleListaProducto() {
 const modal =
 document.getElementById("modalDetalleListaProducto");

 if (modal) modal.style.display = "none";

 listaDetalleActual = null;
 cargarListasProducto();
}

async function guardarCambiosListaProducto() {
 if (!listaDetalleActual) return;

 const nombre =
 document.getElementById("listaDetalleNombre")?.value.trim();

 if (!nombre) {
 alertaPOS("El nombre no puede quedar vacio.", "Falta el nombre", "alerta");
 return;
 }

 await actualizarListaProductoActual({
 nombre,
 descripcion: document.getElementById("listaDetalleDescripcion")?.value.trim() || ""
 });

 alertaPOS("Cambios guardados.", "Listo", "exito");
}

async function alternarActivaListaProducto() {
 if (!listaDetalleActual) return;
 await actualizarListaProductoActual({ activa: !listaDetalleActual.activa });
}

async function actualizarListaProductoActual(cambios) {
 if (!listaDetalleActual) return;

 try {
 const respuesta =
 await fetch(`/listas-producto/${listaDetalleActual.id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(cambios)
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo actualizar la lista.", "Error", "peligro");
 return;
 }

 listaDetalleActual = datos.lista;
 renderModalDetalleListaProducto();
 } catch (error) {
 alertaPOS("No se pudo actualizar la lista.", "Error", "peligro");
 }
}

async function agregarItemListaProductoExistente() {
 if (!listaDetalleActual) return;

 const nombreInput =
 document.getElementById("listaDetalleItemNombre");

 const nombre =
 nombreInput?.value.trim();

 if (!nombre) {
 nombreInput?.focus();
 return;
 }

 const producto =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .find(item => item.nombre?.trim().toLowerCase() === nombre.toLowerCase());

 if (!producto) {
 alertaPOS("Ese producto no esta en tu inventario. Escribe el nombre exacto o elige una de las sugerencias.", "Producto no encontrado", "alerta");
 return;
 }

 const cantidad =
 Number(document.getElementById("listaDetalleItemCantidad")?.value || 1);

 try {
 const respuesta =
 await fetch(`/listas-producto/${listaDetalleActual.id}/items`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 productoId: producto.id,
 cantidad: cantidad > 0 ? cantidad : 1
 })
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo agregar el producto.", "Error", "peligro");
 return;
 }

 listaDetalleActual = datos.lista;
 renderModalDetalleListaProducto();
 } catch (error) {
 alertaPOS("No se pudo agregar el producto.", "Error", "peligro");
 }
}

async function actualizarCantidadItemListaProducto(itemId, valor) {
 if (!listaDetalleActual) return;

 const cantidad =
 Number(valor);

 if (!(cantidad > 0)) {
 alertaPOS("Escribe una cantidad valida.", "Cantidad invalida", "alerta");
 renderModalDetalleListaProducto();
 return;
 }

 try {
 const respuesta =
 await fetch(`/listas-producto/${listaDetalleActual.id}/items/${itemId}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ cantidad })
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo actualizar la cantidad.", "Error", "peligro");
 return;
 }

 listaDetalleActual = datos.lista;
 renderModalDetalleListaProducto();
 } catch (error) {
 alertaPOS("No se pudo actualizar la cantidad.", "Error", "peligro");
 }
}

async function quitarItemListaProductoExistente(itemId) {
 if (!listaDetalleActual) return;

 try {
 const respuesta =
 await fetch(`/listas-producto/${listaDetalleActual.id}/items/${itemId}`, {
 method: "DELETE"
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo quitar el producto.", "Error", "peligro");
 return;
 }

 listaDetalleActual = datos.lista;
 renderModalDetalleListaProducto();
 } catch (error) {
 alertaPOS("No se pudo quitar el producto.", "Error", "peligro");
 }
}

async function eliminarListaProductoActual() {
 if (!listaDetalleActual) return;

 const confirmar =
 await dialogoPOS({
 tipo: "alerta",
 titulo: "Eliminar lista",
 mensaje: `¿Eliminar la lista "${listaDetalleActual.nombre}"? Esto no afecta tu inventario, solo la lista.`,
 mostrarCancelar: true,
 textoAceptar: "Eliminar",
 textoCancelar: "Cancelar"
 });

 if (!confirmar) return;

 try {
 const respuesta =
 await fetch(`/listas-producto/${listaDetalleActual.id}`, {
 method: "DELETE"
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo eliminar la lista.", "Error", "peligro");
 return;
 }

 const modal =
 document.getElementById("modalDetalleListaProducto");

 if (modal) modal.style.display = "none";

 listaDetalleActual = null;
 alertaPOS("Lista eliminada.", "Listo", "exito");
 cargarListasProducto();
 } catch (error) {
 alertaPOS("No se pudo eliminar la lista.", "Error", "peligro");
 }
}

// --- Punto de venta: agregar una lista completa al carrito ---

function cerrarSelectorListaProductosPOS() {
 const modal =
 document.getElementById("modalListaProductosPOS");

 if (modal) modal.style.display = "none";
}

async function abrirSelectorListaProductosPOS() {
 let modal =
 document.getElementById("modalListaProductosPOS");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalListaProductosPOS";
 modal.className = "modal-personalizado modal-cliente-pos";
 document.body.appendChild(modal);
 }

 modal.innerHTML = `
 <div class="modal-card cliente-pos-card">
 <div class="modal-card-header">
 <div>
 <span>Punto de venta</span>
 <h3>Agregar lista al carrito</h3>
 </div>
 <button type="button" onclick="cerrarSelectorListaProductosPOS()">Cerrar</button>
 </div>
 <div class="cliente-pos-empty">Cargando listas...</div>
 </div>
 `;

 modal.style.display = "flex";

 try {
 const respuesta =
 await fetch("/listas-producto");

 const datos =
 await respuesta.json().catch(() => ({}));

 const listas =
 (respuesta.ok && datos.ok ? datos.listas : []).filter(item => item.activa);

 const cuerpo =
 document.querySelector("#modalListaProductosPOS .modal-card");

 if (!cuerpo) return;

 const filas =
 listas.length === 0
 ? '<div class="cliente-pos-empty">No tienes listas activas. Crea una en "Listas de productos" dentro de Inventario.</div>'
 : listas.map(item => `
 <button type="button" onclick="agregarListaAlCarritoPOS(${item.id})">
 <strong>${escaparPOS(item.nombre)}</strong>
 <span>${item.totalItems} producto(s)${item.descripcion ? ` · ${escaparPOS(item.descripcion)}` : ""}</span>
 </button>
 `).join("");

 cuerpo.innerHTML = `
 <div class="modal-card-header">
 <div>
 <span>Punto de venta</span>
 <h3>Agregar lista al carrito</h3>
 </div>
 <button type="button" onclick="cerrarSelectorListaProductosPOS()">Cerrar</button>
 </div>
 <div class="cliente-pos-resumen-grid">
 ${filas}
 </div>
 <button type="button" class="btn-encargo-secundario encargo-btn-full" onclick="cerrarSelectorListaProductosPOS(); mostrarListasProducto();">Administrar listas</button>
 `;
 } catch (error) {
 const cuerpo =
 document.querySelector("#modalListaProductosPOS .cliente-pos-empty");

 if (cuerpo) cuerpo.textContent = "No se pudieron cargar tus listas.";
 }
}

async function agregarListaAlCarritoPOS(listaId) {
 try {
 const respuesta =
 await fetch(`/listas-producto/${listaId}`);

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo cargar la lista.", "Error", "peligro");
 return;
 }

 const lista = datos.lista;
 const noEncontrados = [];
 let agregados = 0;

 lista.items.forEach(item => {
 const producto =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .find(p => Number(p.id) === Number(item.productoId));

 if (!producto) {
 noEncontrados.push(item.nombre);
 return;
 }

 agregarProductoPorId(producto.id, { cantidadInicial: item.cantidad });
 agregados++;
 });

 cerrarSelectorListaProductosPOS();

 if (agregados === 0) {
 alertaPOS("Ningun producto de esta lista esta disponible en tu inventario.", "Lista vacia", "alerta");
 return;
 }

 let mensaje = `Se agregaron ${agregados} producto(s) de "${lista.nombre}" al carrito.`;

 if (noEncontrados.length) {
 mensaje += ` No se encontraron: ${noEncontrados.join(", ")}.`;
 }

 alertaPOS(mensaje, "Lista agregada", noEncontrados.length ? "alerta" : "exito");
 } catch (error) {
 alertaPOS("No se pudo agregar la lista al carrito.", "Error", "peligro");
 }
}

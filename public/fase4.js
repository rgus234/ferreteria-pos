(() => {
 if (window.__fase4PedidosAjustes) return;
 window.__fase4PedidosAjustes = true;

 const estado = { items: [], pedidos: [], proveedoresCache: [], verTodosPedidos: false };
 const estadoRecepcionPedido = { pedidoId: null, proveedor: "", items: [], extras: [], totalFactura: null, totalPedido: 0, archivoNombre: "" };

 const MOTIVOS_AJUSTE = {
  entrada: ["Compra adicional", "Devolucion de cliente", "Producto no registrado en la compra", "Otro"],
  salida: ["Producto danado", "Merma", "Uso interno", "Otro"],
  conteo: ["Diferencia en conteo fisico", "Correccion de captura", "Otro"]
 };

 const estadoAjuste = {
  paso: 1,
  tipo: "entrada",
  motivoPreset: "",
  motivoOtro: "",
  fecha: new Date().toISOString().slice(0, 10),
  productoId: "",
  cantidad: "",
  referencia: "",
  bitacora: [],
  verTodos: false
 };

 const esc = v => String(typeof limpiarTextoUI === "function" ? limpiarTextoUI(v ?? "") : (v ?? ""))
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
 const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
 const money = v => typeof dinero === "function" ? dinero(v) : "$" + num(v).toFixed(2);
 const unidad = p => p?.unidad_venta || p?.unidadVenta || "pieza";
 const prod = id => (todosProductos || []).find(p => String(p.id) === String(id));
 const icono = nombre => typeof iconoUISVG === "function" ? iconoUISVG(nombre) : "";

 function fechaCorta(valor) {
  if (!valor) return "";
  const texto = String(valor).slice(0, 10);
  const partes = texto.split("-");
  return partes.length === 3 ? partes[2] + "/" + partes[1] + "/" + partes[0] : texto;
 }

 function horaCorta(valor) {
  if (!valor) return "";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "";
  return fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
 }

 function ocultar() {
  [
   "pantallaInicio", "pantallaPuntoVenta", "pantallaInventario", "pantallaCategoriasInventario",
   "pantallaCatalogo", "pantallaClientes", "pantallaCreditos", "pantallaProveedores", "pantallaInventarioBajo",
   "pantallaReportes", "pantallaConfiguracion", "pantallaRecepcionMercancia",
   "pantallaPedidosProveedor", "pantallaAjustesInventario", "pantallaCaja", "pantallaFinanzas"
  ].forEach(id => {
   const el = document.getElementById(id);
   if (el) el.style.display = "none";
  });
 }

 function pantallaPedidos() {
  const seccion = document.createElement("section");
  seccion.id = "pantallaPedidosProveedor";
  seccion.style.display = "none";
  seccion.innerHTML = `
   <div class="pedidos-shell">
    <div class="pedidos-header">
     <div>
      <h2>Pedidos a proveedor</h2>
      <p>Genera pedidos desde inventario bajo y recibe mercancia contra pedido.</p>
     </div>
     <div class="pedidos-header-acciones">
      <button type="button" class="btn-pedido-secundario" onclick="crearPedidoDesdeBajos()">${icono("arrowDownBox")} Desde bajos</button>
      <button type="button" class="btn-pedido-primario" onclick="nuevoPedidoProveedor()">${icono("plus")} Nuevo pedido</button>
     </div>
    </div>

    <div class="pedidos-grid">
     <section class="pedidos-panel">
      <h3>Pedido</h3>
      <div class="pedido-form-proveedor">
       <label>Proveedor
        <input id="pedidoProveedorNombre" list="pedidoProveedoresLista" placeholder="Selecciona un proveedor">
        <datalist id="pedidoProveedoresLista"></datalist>
       </label>
       <label>Notas
        <input id="pedidoProveedorNotas" placeholder="Notas del pedido (opcional)">
       </label>
      </div>
      <div class="pedido-add-row">
       <label>Producto
        <select id="pedidoProductoSelect"></select>
       </label>
       <label>Cant.
        <input id="pedidoCantidad" type="number" step="0.001" min="0" placeholder="1">
       </label>
       <label>Costo
        <input id="pedidoCosto" type="number" step="0.01" min="0" placeholder="0.00">
       </label>
       <button type="button" class="btn-pedido-agregar" onclick="agregarItemPedidoProveedor()">${icono("plus")} Agregar</button>
      </div>
      <div id="tablaPedidoProveedor"></div>
      <button type="button" class="btn-pedido-primario pedido-btn-full" onclick="guardarPedidoProveedor()">${icono("clipboard")} Guardar pedido</button>
     </section>
     <section class="pedidos-panel">
      <div class="pedidos-panel-titulo-fila">
       <h3>Pedidos recientes</h3>
       <button type="button" class="pedidos-ver-todos" id="btnVerTodosPedidos" onclick="toggleVerTodosPedidos()" style="display:none;">Ver todos</button>
      </div>
      <div id="listaPedidosProveedor" class="pedidos-lista"></div>
     </section>
    </div>

    <div class="pedidos-resumen">
     <div>
      <span class="pedidos-resumen-icono mes">${icono("file")}</span>
      <div><strong id="pedidosResumenMes">0</strong><span>Pedidos este mes</span></div>
     </div>
     <div>
      <span class="pedidos-resumen-icono compras">${icono("inventory")}</span>
      <div><strong id="pedidosResumenCompras">$0.00</strong><span>Total compras</span></div>
     </div>
     <div>
      <span class="pedidos-resumen-icono pendientes">${icono("truck")}</span>
      <div><strong id="pedidosResumenPendientes">0</strong><span>Pendientes</span></div>
     </div>
     <div>
      <span class="pedidos-resumen-icono recibidos">${icono("check")}</span>
      <div><strong id="pedidosResumenRecibidosHoy">0</strong><span>Recibidos hoy</span></div>
     </div>
    </div>
   </div>
  `;
  return seccion;
 }

 function pantallaAjustes() {
  const seccion = document.createElement("section");
  seccion.id = "pantallaAjustesInventario";
  seccion.style.display = "none";
  seccion.innerHTML = `
   <div class="ajustes-shell">
    <div class="ajustes-header">
     <div>
      <h2>Ajustes de inventario</h2>
      <p>Realiza ajustes rapidos para entradas, salidas y conteos con bitacora.</p>
     </div>
     <button type="button" class="ajustes-ayuda-link" onclick="verAyudaAjustes()">${icono("info")} ¿Como funcionan los ajustes?</button>
    </div>

    <div class="ajustes-grid">
     <div class="ajustes-columna-principal">
      <section class="ajustes-panel">
       <div class="ajustes-panel-titulo">
        <span class="ajustes-panel-icono">${icono("clipboard")}</span>
        <div>
         <h3>Crear nuevo ajuste</h3>
         <p>Registra manualmente un ajuste de inventario con su motivo y detalle.</p>
        </div>
       </div>
       <div id="ajusteWizard"></div>
      </section>

      <section class="ajustes-panel">
       <div class="ajustes-panel-titulo">
        <span class="ajustes-panel-icono">${icono("clipboard")}</span>
        <div>
         <h3>Bitacora de ajustes recientes</h3>
         <p>Consulta los ultimos ajustes realizados en el sistema.</p>
        </div>
       </div>
       <div id="listaAjustesInventario"></div>
       <button type="button" class="ajustes-ver-todos" id="btnVerTodosAjustes" onclick="toggleTodosAjustes()">Ver todos los ajustes</button>
      </section>
     </div>

     <aside class="ajustes-lateral">
      <section class="ajustes-panel ajustes-info">
       <span class="ajustes-panel-icono">${icono("info")}</span>
       <h3>¿Que es un ajuste?</h3>
       <p>Los ajustes te permiten mantener tu inventario actualizado cuando hay diferencias entre el sistema y la realidad.</p>
       <div class="ajuste-info-item entrada">
        <span class="ajuste-info-icono">${icono("arrowDownBox")}</span>
        <div><strong>Entradas</strong><span>Usalo cuando recibes productos que no fueron registrados en la compra.</span></div>
       </div>
       <div class="ajuste-info-item salida">
        <span class="ajuste-info-icono">${icono("arrowUpBox")}</span>
        <div><strong>Salidas</strong><span>Usalo cuando sacas productos por dano, perdida, uso interno u otros motivos.</span></div>
       </div>
       <div class="ajuste-info-item conteo">
        <span class="ajuste-info-icono">${icono("clipboard")}</span>
        <div><strong>Conteo / Correccion</strong><span>Usalo para corregir diferencias encontradas en un conteo fisico.</span></div>
       </div>
      </section>

      <section class="ajustes-panel">
       <h3>Acciones rapidas</h3>
       <p>Accesos directos relacionados</p>
       <button type="button" class="ajuste-accion-rapida" onclick="mostrarInventario()">
        ${icono("file")}
        <div><strong>Ver inventario actual</strong><span>Consulta el inventario disponible</span></div>
        ${icono("chevronRight")}
       </button>
       <button type="button" class="ajuste-accion-rapida" onclick="mostrarInventarioBajo()">
        ${icono("alert")}
        <div><strong>Ver inventario bajo</strong><span>Productos que necesitan reabastecerse</span></div>
        ${icono("chevronRight")}
       </button>
      </section>
     </aside>
    </div>
   </div>
  `;
  return seccion;
 }

 function pantallas() {
  const main = document.querySelector("main.contenido") || document.getElementById("sistema");
  if (!main) return;
  if (!document.getElementById("pantallaPedidosProveedor")) main.appendChild(pantallaPedidos());
  if (!document.getElementById("pantallaAjustesInventario")) main.appendChild(pantallaAjustes());
 }

 function menu() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;
  const antes = [...sidebar.querySelectorAll("button")].find(b => /Catalogo proveedor/i.test(b.textContent || "")) || sidebar.querySelector(".btn-configuracion-sidebar");

  if (!sidebar.querySelector("[data-modulo='pedidos-proveedor'],[data-modulo='pedidos'],[data-shell-module='pedidos']")) {
   const boton = document.createElement("button");
   boton.dataset.modulo = "pedidos";
   boton.dataset.shellModule = "pedidos";
   boton.dataset.navLabel = "Pedidos";
   boton.type = "button";
   boton.onclick = () => mostrarPedidosProveedor();
   boton.innerHTML = icono("file") + "<span>Pedidos</span>";
   antes ? antes.insertAdjacentElement("beforebegin", boton) : sidebar.appendChild(boton);
  }

  if (!sidebar.querySelector("[data-modulo='ajustes-inventario'],[data-modulo='ajustes'],[data-shell-module='ajustes']")) {
   const boton = document.createElement("button");
   boton.dataset.modulo = "ajustes";
   boton.dataset.shellModule = "ajustes";
   boton.dataset.navLabel = "Ajustes";
   boton.type = "button";
   boton.onclick = () => mostrarAjustesInventario();
   boton.innerHTML = icono("settings") + "<span>Ajustes</span>";
   sidebar.querySelector("[data-modulo='pedidos'],[data-shell-module='pedidos'],[data-modulo='pedidos-proveedor']")?.insertAdjacentElement("afterend", boton);
  }
 }

 function opciones() {
  return '<option value="">Producto</option>' + (todosProductos || [])
   .slice()
   .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")))
   .map(p => `<option value="${esc(p.id)}">${esc(p.nombre)} - Stock ${esc(p.stock)}</option>`)
   .join("");
 }

 async function datos() {
  if (!Array.isArray(todosProductos) || !todosProductos.length) await cargarProductos();
  const html = opciones();
  const pedidoSelect = document.getElementById("pedidoProductoSelect");
  if (pedidoSelect) pedidoSelect.innerHTML = html;
  await cargarProveedoresParaPedido();
 }

 async function cargarProveedoresParaPedido() {
  const lista = document.getElementById("pedidoProveedoresLista");
  if (!lista) return;
  try {
   const respuesta = await fetch("/proveedores");
   const datosProveedores = await respuesta.json();
   estado.proveedoresCache = datosProveedores.proveedores || [];
   lista.innerHTML = estado.proveedoresCache.map(p => `<option value="${esc(p.nombre)}">`).join("");
  } catch (error) {
   estado.proveedoresCache = [];
  }
 }

 // ---------- Pedidos a proveedor ----------

 window.mostrarPedidosProveedor = async () => {
  pantallas();
  menu();
  ocultar();
  document.getElementById("pantallaPedidosProveedor").style.display = "block";
  if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Pedidos a proveedor", "Compra y recepcion de mercancia", "pedidos");
  await datos();
  renderPedidoProveedor();
  await cargarPedidosProveedor();
 };

 window.nuevoPedidoProveedor = () => {
  estado.items = [];
  ["pedidoProveedorNombre", "pedidoProveedorNotas"].forEach(id => {
   const el = document.getElementById(id);
   if (el) el.value = "";
  });
  renderPedidoProveedor();
 };

 window.crearPedidoDesdeBajos = async () => {
  await datos();
  const bajos = typeof productosBajoStock === "function"
   ? productosBajoStock()
   : (todosProductos || []).filter(p => num(p.stock) <= num(p.stock_minimo || p.stockMinimo || 5));

  estado.items = bajos.map(p => {
   const objetivo = Math.max(num(p.stock_minimo || p.stockMinimo || 5) * 2, 10);
   return {
    productoId: p.id,
    codigo: p.codigo || "",
    nombre: p.nombre,
    proveedor: p.proveedor || "",
    cantidad: Math.max(1, objetivo - num(p.stock)),
    costo: num(p.precio_distribuidor || p.distribuidor || 0),
    unidad: unidad(p)
   };
  });

  const proveedorInput = document.getElementById("pedidoProveedorNombre");
  if (proveedorInput) proveedorInput.value = estado.items.find(i => i.proveedor)?.proveedor || "";
  renderPedidoProveedor();
 };

 window.agregarItemPedidoProveedor = () => {
  const producto = prod(document.getElementById("pedidoProductoSelect")?.value);
  if (!producto) return alertaPOS("Elige un producto para agregar.", "Selecciona producto", "info");

  estado.items.push({
   productoId: producto.id,
   codigo: producto.codigo || "",
   nombre: producto.nombre,
   proveedor: producto.proveedor || document.getElementById("pedidoProveedorNombre")?.value || "",
   cantidad: num(document.getElementById("pedidoCantidad")?.value || 1) || 1,
   costo: num(document.getElementById("pedidoCosto")?.value || producto.precio_distribuidor || 0),
   unidad: unidad(producto)
  });

  document.getElementById("pedidoCantidad").value = "";
  document.getElementById("pedidoCosto").value = "";
  renderPedidoProveedor();
 };

 window.editarItemPedidoProveedor = (indice, campo, valor) => {
  if (!estado.items[indice]) return;
  estado.items[indice][campo] = ["cantidad", "costo"].includes(campo) ? num(valor) : valor;
  renderPedidoProveedor();
 };

 window.quitarItemPedidoProveedor = indice => {
  estado.items.splice(indice, 1);
  renderPedidoProveedor();
 };

 function renderPedidoProveedor() {
  const contenedor = document.getElementById("tablaPedidoProveedor");
  if (!contenedor) return;

  if (!estado.items.length) {
   contenedor.innerHTML = '<div class="pedidos-empty">Agrega productos o usa "Desde bajos".</div>';
   return;
  }

  const total = estado.items.reduce((suma, i) => suma + num(i.cantidad) * num(i.costo), 0);
  contenedor.innerHTML = `<table class="pedido-tabla"><thead><tr><th>Producto</th><th>Cant.</th><th>Costo</th><th>Subtotal</th><th></th></tr></thead><tbody>${
   estado.items.map((item, indice) => `<tr><td><strong>${esc(item.nombre)}</strong><small>${esc(item.codigo || "Sin codigo")} - ${esc(item.proveedor || "Sin proveedor")}</small></td><td><input type="number" step="0.001" value="${esc(item.cantidad)}" onchange="editarItemPedidoProveedor(${indice}, 'cantidad', this.value)"></td><td><input type="number" step="0.01" value="${esc(item.costo)}" onchange="editarItemPedidoProveedor(${indice}, 'costo', this.value)"></td><td>${money(num(item.cantidad) * num(item.costo))}</td><td><button type="button" class="pedido-btn-quitar" onclick="quitarItemPedidoProveedor(${indice})">${icono("trash")}</button></td></tr>`).join("")
  }</tbody></table><div class="pedido-total-fila"><span>Total de productos: ${estado.items.length}</span><b>Total: ${money(total)}</b></div>`;
 }

 window.guardarPedidoProveedor = async () => {
  if (!estado.items.length) return alertaPOS("Agrega partidas antes de guardar.", "Pedido vacio", "info");

  try {
   const respuesta = await fetch("/pedidos-proveedor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     proveedor: document.getElementById("pedidoProveedorNombre")?.value || "",
     notas: document.getElementById("pedidoProveedorNotas")?.value || "",
     estado: "enviado",
     items: estado.items
    })
   });
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudo guardar");
   alertaPOS("Pedido #" + datos.pedido.id + " listo para recibir.", "Pedido guardado", "exito");
   window.nuevoPedidoProveedor();
   await cargarPedidosProveedor();
  } catch (error) {
   alertaPOS(error.message, "Error en pedido", "peligro");
  }
 };

 function etiquetaEstadoPedido(estadoPedido) {
  return { borrador: "Borrador", enviado: "Enviado", parcial: "Parcial", recibido: "Recibido", cancelado: "Cancelado" }[estadoPedido] || estadoPedido;
 }

 function esMismoDia(fecha, referencia) {
  const d = new Date(fecha);
  return d.getFullYear() === referencia.getFullYear() && d.getMonth() === referencia.getMonth() && d.getDate() === referencia.getDate();
 }

 function renderResumenPedidos() {
  const hoy = new Date();
  const pedidos = estado.pedidos;
  const esteMes = pedidos.filter(p => {
   const fecha = new Date(p.created_at);
   return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth();
  });
  const totalCompras = esteMes.reduce((suma, p) => suma + num(p.total_estimado), 0);
  const pendientes = pedidos.filter(p => !["recibido", "cancelado"].includes(p.estado)).length;
  const recibidosHoy = pedidos.filter(p => p.estado === "recibido" && p.updated_at && esMismoDia(p.updated_at, hoy)).length;

  const set = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = valor; };
  set("pedidosResumenMes", esteMes.length);
  set("pedidosResumenCompras", money(totalCompras));
  set("pedidosResumenPendientes", pendientes);
  set("pedidosResumenRecibidosHoy", recibidosHoy);
 }

 window.toggleVerTodosPedidos = () => {
  estado.verTodosPedidos = !estado.verTodosPedidos;
  renderListaPedidos();
 };

 function renderListaPedidos() {
  const lista = document.getElementById("listaPedidosProveedor");
  const boton = document.getElementById("btnVerTodosPedidos");
  if (!lista) return;

  const pedidos = estado.pedidos;
  if (!pedidos.length) {
   lista.innerHTML = '<div class="pedidos-empty">Todavia no hay pedidos.</div>';
   if (boton) boton.style.display = "none";
   return;
  }

  const visibles = estado.verTodosPedidos ? pedidos : pedidos.slice(0, 6);
  lista.innerHTML = visibles.map(p => `
   <article class="pedido-card">
    <div>
     <strong>#${esc(p.id)} - ${esc(p.proveedor || "Sin proveedor")}</strong>
     <span>${esc(p.piezas || 0)} productos - ${esc(p.partidas)} partida${Number(p.partidas) === 1 ? "" : "s"}</span>
     <small>${new Date(p.created_at).toLocaleDateString("es-MX")}</small>
    </div>
    <div>
     <b>${money(p.total_estimado)}</b>
     <span class="pedido-badge-estado ${esc(p.estado)}">${etiquetaEstadoPedido(p.estado)}</span>
     ${p.estado !== "recibido" && p.estado !== "cancelado" ? `<button type="button" class="pedido-btn-recibir" onclick="abrirRecepcionPedido(${esc(p.id)})">Recibir</button>` : ""}
    </div>
   </article>
  `).join("");

  if (boton) {
   boton.style.display = pedidos.length > 6 ? "block" : "none";
   boton.textContent = estado.verTodosPedidos ? "Ver menos" : "Ver todos";
  }
 }

 window.cargarPedidosProveedor = async () => {
  const lista = document.getElementById("listaPedidosProveedor");
  if (!lista) return;

  try {
   const respuesta = await fetch("/pedidos-proveedor");
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar");
   estado.pedidos = datos.pedidos || [];
   renderListaPedidos();
   renderResumenPedidos();
  } catch (error) {
   lista.innerHTML = '<div class="pedidos-empty">' + esc(error.message) + "</div>";
  }
 };

 window.abrirRecepcionPedido = async id => {
  try {
   const respuesta = await fetch("/pedidos-proveedor/" + id);
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "Pedido no encontrado");

   const items = (datos.items || []).map(i => {
    const pendiente = Math.max(0, num(i.cantidad) - num(i.recibido));
    return {
     pedidoItemId: i.id,
     productoId: i.producto_id,
     codigo: i.codigo || "",
     nombre: i.nombre,
     proveedor: i.proveedor,
     cantidadPedida: num(i.cantidad),
     yaRecibido: num(i.recibido),
     pendiente,
     recibidoAhora: pendiente,
     costo: num(i.costo),
     unidad: i.unidad
    };
   }).filter(i => i.pendiente > 0);

   if (!items.length) return alertaPOS("No hay partidas pendientes.", "Pedido completo", "info");

   estadoRecepcionPedido.pedidoId = id;
   estadoRecepcionPedido.proveedor = datos.pedido.proveedor || "";
   estadoRecepcionPedido.items = items;
   estadoRecepcionPedido.extras = [];
   estadoRecepcionPedido.totalFactura = null;
   estadoRecepcionPedido.totalPedido = num(datos.pedido.total_estimado);
   estadoRecepcionPedido.archivoNombre = "";

   mostrarModalRecepcionPedido();
  } catch (error) {
   alertaPOS(error.message, "No se pudo abrir la recepcion", "peligro");
  }
 };

 window.cerrarModalRecepcionPedido = () => {
  document.getElementById("modalRecepcionPedido")?.remove();
 };

 function codigoRecepcionLimpio(valor) {
  return typeof facturaParserCodigoLimpio === "function"
   ? facturaParserCodigoLimpio(valor)
   : String(valor || "").replace(/[^a-zA-Z0-9]/g, "").trim();
 }

 function estadoPartidaRecepcion(item) {
  if (num(item.recibidoAhora) <= 0) return { clase: "sin-recibir", texto: "Sin recibir" };
  if (num(item.recibidoAhora) >= item.pendiente) return { clase: "completo", texto: "Completo" };
  return { clase: "parcial", texto: "Parcial" };
 }

 function mostrarModalRecepcionPedido() {
  window.cerrarModalRecepcionPedido();

  const overlay = document.createElement("div");
  overlay.id = "modalRecepcionPedido";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
   <div class="modal-recepcion-pedido">
    <div class="modal-header">
     <h2>Recibir pedido #${esc(estadoRecepcionPedido.pedidoId)} - ${esc(estadoRecepcionPedido.proveedor || "Sin proveedor")}</h2>
     <button type="button" class="modal-cerrar-x" onclick="cerrarModalRecepcionPedido()">&times;</button>
    </div>
    <label class="recepcion-pedido-archivo">
     ${icono("file")}
     <span>Subir factura del proveedor (XML CFDI o CSV) para prellenar cantidades -- opcional</span>
     <input type="file" accept=".xml,.csv,.txt" onchange="procesarArchivoRecepcionPedido(this.files[0])">
    </label>
    <span id="recepcionPedidoArchivoNombre" class="recepcion-pedido-archivo-nombre"></span>
    <div id="recepcionPedidoAviso"></div>
    <div id="recepcionPedidoTabla"></div>
    <div id="recepcionPedidoExtras"></div>
    <div class="modal-recepcion-pedido-acciones">
     <button type="button" class="btn-pedido-secundario" onclick="cerrarModalRecepcionPedido()">Cancelar</button>
     <button type="button" class="btn-pedido-primario" onclick="confirmarRecepcionPedidoModal()">${icono("check")} Confirmar recepcion</button>
    </div>
   </div>
  `;
  document.body.appendChild(overlay);
  renderModalRecepcionPedido();
 }

 function renderModalRecepcionPedido() {
  const tabla = document.getElementById("recepcionPedidoTabla");
  if (!tabla) return;

  tabla.innerHTML = `
   <table class="recepcion-pedido-tabla">
    <thead><tr><th>Producto</th><th>Pedido</th><th>Ya recibido</th><th>Recibido ahora</th><th>Estado</th></tr></thead>
    <tbody>
     ${estadoRecepcionPedido.items.map((item, indice) => {
      const ep = estadoPartidaRecepcion(item);
      return `<tr>
       <td><strong>${esc(item.nombre)}</strong><small>${esc(item.codigo || "Sin codigo")}</small></td>
       <td>${num(item.cantidadPedida)} ${esc(item.unidad || "")}</td>
       <td>${num(item.yaRecibido)}</td>
       <td><input type="number" step="0.001" min="0" value="${num(item.recibidoAhora)}" onchange="actualizarRecibidoAhoraPedido(${indice}, this.value)"></td>
       <td><span class="recepcion-pedido-badge ${ep.clase}">${ep.texto}</span></td>
      </tr>`;
     }).join("")}
    </tbody>
   </table>
  `;

  const extras = document.getElementById("recepcionPedidoExtras");
  if (extras) {
   extras.innerHTML = estadoRecepcionPedido.extras.length ? `
    <div class="recepcion-pedido-extras">
     <strong>${icono("alert")} En la factura pero no en el pedido</strong>
     <p>Estos productos vinieron en la factura pero no coinciden con ninguna partida de este pedido -- no se aplican automaticamente, revisalos por separado.</p>
     <ul>${estadoRecepcionPedido.extras.map(e => `<li>${esc(e.descripcion)} -- ${num(e.cantidad)} ${esc(e.unidad || "")}</li>`).join("")}</ul>
    </div>
   ` : "";
  }

  const aviso = document.getElementById("recepcionPedidoAviso");
  if (aviso) {
   const diferenciaTotal = estadoRecepcionPedido.totalFactura !== null
    ? Math.abs(estadoRecepcionPedido.totalFactura - estadoRecepcionPedido.totalPedido)
    : 0;
   aviso.innerHTML = estadoRecepcionPedido.totalFactura !== null && diferenciaTotal > Math.max(1, estadoRecepcionPedido.totalPedido * 0.02) ? `
    <div class="recepcion-pedido-aviso">
     ${icono("alert")} El total de la factura (${money(estadoRecepcionPedido.totalFactura)}) no coincide con el total del pedido (${money(estadoRecepcionPedido.totalPedido)}).
    </div>
   ` : "";
  }
 }

 window.actualizarRecibidoAhoraPedido = (indice, valor) => {
  const item = estadoRecepcionPedido.items[indice];
  if (!item) return;
  item.recibidoAhora = Math.max(0, num(valor));
  renderModalRecepcionPedido();
 };

 window.procesarArchivoRecepcionPedido = async archivo => {
  if (!archivo) return;
  estadoRecepcionPedido.archivoNombre = archivo.name;
  const nombreEl = document.getElementById("recepcionPedidoArchivoNombre");
  if (nombreEl) nombreEl.textContent = archivo.name;

  const extension = archivo.name.toLowerCase().split(".").pop();
  if (!["xml", "csv", "txt"].includes(extension)) {
   alertaPOS("Usa un archivo XML CFDI o CSV para prellenar cantidades. Puedes seguir capturando a mano.", "Formato no soportado", "info");
   return;
  }

  try {
   const texto = await archivo.text();
   const resultado = extension === "xml" ? parsearFacturaXmlCfdi(texto) : parsearFacturaCsv(texto);

   if (!resultado.conceptos.length) throw new Error("El archivo no tiene productos reconocibles");

   estadoRecepcionPedido.totalFactura = resultado.documento.total || null;

   const usados = new Set();
   estadoRecepcionPedido.items.forEach(item => {
    const codigoItem = codigoRecepcionLimpio(item.codigo);
    const nombreItem = String(item.nombre || "").toLowerCase().trim();

    const indiceConcepto = resultado.conceptos.findIndex((concepto, indice) => {
     if (usados.has(indice)) return false;
     const codigoConcepto = codigoRecepcionLimpio(concepto.codigo);
     if (codigoItem && codigoConcepto && codigoItem === codigoConcepto) return true;
     return nombreItem && String(concepto.descripcion || "").toLowerCase().trim() === nombreItem;
    });

    if (indiceConcepto >= 0) {
     usados.add(indiceConcepto);
     item.recibidoAhora = Math.max(0, num(resultado.conceptos[indiceConcepto].cantidad));
    }
   });

   estadoRecepcionPedido.extras = resultado.conceptos.filter((_, indice) => !usados.has(indice));

   renderModalRecepcionPedido();
   alertaPOS("Factura leida. Revisa las cantidades antes de confirmar.", "Archivo analizado", "exito");
  } catch (error) {
   console.error(error);
   alertaPOS("No se pudo leer el archivo. Puedes seguir capturando las cantidades a mano.", "No se pudo leer", "error");
  }
 };

 window.confirmarRecepcionPedidoModal = async () => {
  const items = estadoRecepcionPedido.items
   .filter(item => num(item.recibidoAhora) > 0)
   .map(item => ({
    pedidoItemId: item.pedidoItemId,
    productoId: item.productoId,
    codigo: item.codigo,
    nombre: item.nombre,
    cantidad: num(item.recibidoAhora),
    costo: item.costo
   }));

  if (!items.length) return alertaPOS("Captura al menos una cantidad recibida.", "Nada que confirmar", "info");

  const ok = await confirmarPOS("Se sumaran al inventario las cantidades capturadas.", "Confirmar recepcion de pedido #" + estadoRecepcionPedido.pedidoId);
  if (!ok) return;

  try {
   const respuesta = await fetch("/pedidos-proveedor/" + estadoRecepcionPedido.pedidoId + "/recepciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     proveedor: estadoRecepcionPedido.proveedor,
     referencia: "Pedido #" + estadoRecepcionPedido.pedidoId,
     items
    })
   });
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudo recibir");

   window.cerrarModalRecepcionPedido();
   await cargarProductos();
   await cargarPedidosProveedor();
   alertaPOS("Inventario actualizado.", "Recepcion aplicada", "exito");
  } catch (error) {
   alertaPOS(error.message, "Recepcion no aplicada", "peligro");
  }
 };

 // ---------- Ajustes de inventario (wizard de 3 pasos) ----------

 function motivosDisponibles() {
  return MOTIVOS_AJUSTE[estadoAjuste.tipo] || MOTIVOS_AJUSTE.entrada;
 }

 function motivoFinal() {
  return estadoAjuste.motivoPreset === "Otro" ? estadoAjuste.motivoOtro : estadoAjuste.motivoPreset;
 }

 function etiquetaTipo(tipo) {
  return { entrada: "Entrada", salida: "Salida", conteo: "Conteo" }[tipo] || tipo;
 }

 function renderPasoIndicador() {
  const nombres = ["Tipo de ajuste", "Detalle", "Confirmacion"];
  return '<div class="ajuste-pasos">' + nombres.map((nombre, indice) => {
   const numero = indice + 1;
   const clase = numero === estadoAjuste.paso ? "activo" : numero < estadoAjuste.paso ? "completado" : "";
   const linea = indice < nombres.length - 1 ? `<span class="ajuste-paso-linea ${numero < estadoAjuste.paso ? "completado" : ""}"></span>` : "";
   return `<div class="ajuste-paso ${clase}"><span class="ajuste-paso-circulo">${numero < estadoAjuste.paso ? icono("check") : numero}</span><span class="ajuste-paso-nombre">${nombre}</span></div>${linea}`;
  }).join("") + "</div>";
 }

 function renderPaso1() {
  const tipos = [
   { valor: "entrada", titulo: "Entrada", desc: "Agregar productos al inventario", icono: "arrowDownBox" },
   { valor: "salida", titulo: "Salida", desc: "Retirar productos del inventario", icono: "arrowUpBox" },
   { valor: "conteo", titulo: "Conteo / Correccion", desc: "Ajuste por inventario fisico", icono: "clipboard" }
  ];

  const tarjetas = tipos.map(t => `
   <button type="button" class="ajuste-tipo-card ${t.valor} ${estadoAjuste.tipo === t.valor ? "seleccionado" : ""}" onclick="seleccionarTipoAjuste('${t.valor}')">
    <span class="ajuste-tipo-icono">${icono(t.icono)}</span>
    <strong>${t.titulo}</strong>
    <span>${t.desc}</span>
   </button>
  `).join("");

  const motivos = motivosDisponibles();
  const motivoOtroCampo = estadoAjuste.motivoPreset === "Otro" ? `
   <label class="ajuste-campo-full">
    <strong>Especifica el motivo</strong>
    <input type="text" value="${esc(estadoAjuste.motivoOtro)}" oninput="actualizarMotivoOtroAjuste(this.value)" placeholder="Describe el motivo del ajuste">
   </label>
  ` : "";

  return `
   <div class="ajuste-campo-titulo"><strong>Tipo de ajuste</strong><span>Selecciona el tipo de ajuste que deseas realizar.</span></div>
   <div class="ajuste-tipo-grid">${tarjetas}</div>
   <div class="ajuste-campos-fila">
    <label>
     <strong>Motivo del ajuste</strong>
     <span>Selecciona el motivo del ajuste.</span>
     <select onchange="actualizarMotivoAjuste(this.value)">
      <option value="">Seleccionar motivo</option>
      ${motivos.map(m => `<option value="${esc(m)}" ${estadoAjuste.motivoPreset === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
     </select>
    </label>
    <label>
     <strong>Fecha del ajuste</strong>
     <span>Fecha en que se realiza el ajuste.</span>
     <input type="date" value="${esc(estadoAjuste.fecha)}" onchange="actualizarFechaAjuste(this.value)">
    </label>
   </div>
   ${motivoOtroCampo}
   <div class="ajuste-acciones-paso">
    <button type="button" class="btn-ajuste-primario" onclick="continuarPasoAjuste()">Continuar ${icono("chevronRight")}</button>
   </div>
  `;
 }

 function renderPaso2() {
  const producto = prod(estadoAjuste.productoId);
  return `
   <div class="ajuste-campo-titulo"><strong>Detalle del ajuste</strong><span>Selecciona el producto y la cantidad a ajustar.</span></div>
   <div class="ajuste-campos-fila">
    <label>
     <strong>Producto</strong>
     <select onchange="actualizarProductoAjuste(this.value)">${opciones().replace(`value="${esc(estadoAjuste.productoId)}"`, `value="${esc(estadoAjuste.productoId)}" selected`)}</select>
     ${producto ? `<span class="ajuste-campo-nota">Stock actual: ${esc(producto.stock)}</span>` : ""}
    </label>
    <label>
     <strong>${estadoAjuste.tipo === "conteo" ? "Cantidad contada" : "Cantidad"}</strong>
     <input type="number" step="0.001" min="0" value="${esc(estadoAjuste.cantidad)}" oninput="actualizarCantidadAjuste(this.value)">
    </label>
   </div>
   <label class="ajuste-campo-full">
    <strong>Referencia (opcional)</strong>
    <input type="text" value="${esc(estadoAjuste.referencia)}" oninput="actualizarReferenciaAjuste(this.value)" placeholder="Ej. folio, nota u orden interna">
   </label>
   <div class="ajuste-acciones-paso">
    <button type="button" class="btn-ajuste-secundario" onclick="retrocederPasoAjuste()">${icono("chevronLeft")} Atras</button>
    <button type="button" class="btn-ajuste-primario" onclick="continuarPasoAjuste()">Continuar ${icono("chevronRight")}</button>
   </div>
  `;
 }

 function renderPaso3() {
  const producto = prod(estadoAjuste.productoId);
  const actual = num(producto?.stock);
  const cantidad = num(estadoAjuste.cantidad);
  const nuevo = estadoAjuste.tipo === "entrada" ? actual + cantidad : estadoAjuste.tipo === "salida" ? actual - cantidad : cantidad;

  return `
   <div class="ajuste-campo-titulo"><strong>Confirma el ajuste</strong><span>Revisa los datos antes de aplicarlo. El stock se actualizara de inmediato.</span></div>
   <div class="ajuste-resumen">
    <div><span>Tipo</span><strong>${esc(etiquetaTipo(estadoAjuste.tipo))}</strong></div>
    <div><span>Motivo</span><strong>${esc(motivoFinal() || "Sin motivo")}</strong></div>
    <div><span>Fecha</span><strong>${esc(fechaCorta(estadoAjuste.fecha))}</strong></div>
    <div><span>Producto</span><strong>${esc(producto?.nombre || "Sin producto")}</strong></div>
    <div><span>Stock actual</span><strong>${esc(actual)}</strong></div>
    <div><span>Cantidad</span><strong>${esc(cantidad)}</strong></div>
    <div><span>Stock resultante</span><strong>${esc(nuevo)}</strong></div>
    ${estadoAjuste.referencia ? `<div><span>Referencia</span><strong>${esc(estadoAjuste.referencia)}</strong></div>` : ""}
   </div>
   <div class="ajuste-acciones-paso">
    <button type="button" class="btn-ajuste-secundario" onclick="retrocederPasoAjuste()">${icono("chevronLeft")} Atras</button>
    <button type="button" class="btn-ajuste-primario" onclick="confirmarAjusteFinal()">Confirmar ajuste</button>
   </div>
  `;
 }

 function renderWizardAjuste() {
  const contenedor = document.getElementById("ajusteWizard");
  if (!contenedor) return;
  const cuerpo = estadoAjuste.paso === 1 ? renderPaso1() : estadoAjuste.paso === 2 ? renderPaso2() : renderPaso3();
  contenedor.innerHTML = renderPasoIndicador() + cuerpo;
 }

 window.seleccionarTipoAjuste = tipo => {
  estadoAjuste.tipo = tipo;
  estadoAjuste.motivoPreset = "";
  estadoAjuste.motivoOtro = "";
  renderWizardAjuste();
 };

 window.actualizarMotivoAjuste = valor => {
  estadoAjuste.motivoPreset = valor;
  renderWizardAjuste();
 };

 window.actualizarMotivoOtroAjuste = valor => { estadoAjuste.motivoOtro = valor; };
 window.actualizarFechaAjuste = valor => { estadoAjuste.fecha = valor; };
 window.actualizarProductoAjuste = valor => { estadoAjuste.productoId = valor; renderWizardAjuste(); };
 window.actualizarCantidadAjuste = valor => { estadoAjuste.cantidad = valor; };
 window.actualizarReferenciaAjuste = valor => { estadoAjuste.referencia = valor; };

 window.continuarPasoAjuste = () => {
  if (estadoAjuste.paso === 1) {
   if (!estadoAjuste.motivoPreset) return alertaPOS("Selecciona el motivo del ajuste.", "Falta el motivo", "info");
   if (estadoAjuste.motivoPreset === "Otro" && !estadoAjuste.motivoOtro.trim()) return alertaPOS("Describe el motivo del ajuste.", "Falta el motivo", "info");
   if (!estadoAjuste.fecha) return alertaPOS("Selecciona la fecha del ajuste.", "Falta la fecha", "info");
   estadoAjuste.paso = 2;
   renderWizardAjuste();
   return;
  }
  if (estadoAjuste.paso === 2) {
   if (!estadoAjuste.productoId) return alertaPOS("Selecciona el producto a ajustar.", "Falta el producto", "info");
   if (!num(estadoAjuste.cantidad) || num(estadoAjuste.cantidad) <= 0) return alertaPOS("Indica una cantidad mayor a cero.", "Falta la cantidad", "info");
   estadoAjuste.paso = 3;
   renderWizardAjuste();
  }
 };

 window.retrocederPasoAjuste = () => {
  estadoAjuste.paso = Math.max(1, estadoAjuste.paso - 1);
  renderWizardAjuste();
 };

 function reiniciarWizardAjuste() {
  estadoAjuste.paso = 1;
  estadoAjuste.tipo = "entrada";
  estadoAjuste.motivoPreset = "";
  estadoAjuste.motivoOtro = "";
  estadoAjuste.fecha = new Date().toISOString().slice(0, 10);
  estadoAjuste.productoId = "";
  estadoAjuste.cantidad = "";
  estadoAjuste.referencia = "";
  renderWizardAjuste();
 }

 window.confirmarAjusteFinal = async () => {
  const ok = await confirmarPOS("Aplicar ajuste", "El stock cambiara y quedara registrado en la bitacora.");
  if (!ok) return;

  try {
   const respuesta = await fetch("/ajustes-inventario", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     productoId: estadoAjuste.productoId,
     tipo: estadoAjuste.tipo,
     cantidad: estadoAjuste.cantidad,
     motivo: motivoFinal(),
     referencia: estadoAjuste.referencia,
     usuarioNombre: (typeof usuarioActual !== "undefined" && usuarioActual?.nombre) || "",
     fecha: estadoAjuste.fecha
    })
   });
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudo ajustar");

   await cargarProductos();
   reiniciarWizardAjuste();
   await cargarAjustesInventario();
   alertaPOS("Stock actualizado.", "Ajuste aplicado", "exito");
  } catch (error) {
   alertaPOS(error.message, "Error en ajuste", "peligro");
  }
 };

 function descripcionAjuste(a) {
  const cantidadTxt = esc(num(a.cantidad));
  const nombre = esc(a.producto_nombre);
  const motivoTxt = a.motivo ? ` (${esc(a.motivo)})` : "";
  if (a.tipo === "entrada") return `Entrada de ${cantidadTxt} de "${nombre}"${motivoTxt}.`;
  if (a.tipo === "salida") return `Salida de ${cantidadTxt} de "${nombre}"${motivoTxt}.`;
  return `Ajuste por conteo fisico de "${nombre}"${motivoTxt}.`;
 }

 window.toggleTodosAjustes = () => {
  estadoAjuste.verTodos = !estadoAjuste.verTodos;
  renderBitacoraAjustes();
 };

 window.verDetalleAjusteBitacora = id => {
  const item = estadoAjuste.bitacora.find(a => String(a.id) === String(id));
  if (!item) return;
  const detalle = [
   "Producto: " + (item.producto_nombre || "") + (item.codigo ? " (" + item.codigo + ")" : ""),
   "Tipo: " + etiquetaTipo(item.tipo),
   "Motivo: " + (item.motivo || "Sin motivo"),
   "Fecha del ajuste: " + fechaCorta(item.fecha_ajuste),
   "Registrado: " + fechaCorta(item.created_at) + " " + horaCorta(item.created_at),
   "Usuario: " + (item.usuario_nombre || "Sin registrar"),
   "Stock: " + item.stock_anterior + " -> " + item.stock_nuevo,
   item.referencia ? "Referencia: " + item.referencia : ""
  ].filter(Boolean).join("\n");
  alertaPOS(detalle, "Detalle del ajuste", "info");
 };

 function renderBitacoraAjustes() {
  const contenedor = document.getElementById("listaAjustesInventario");
  const botonVerTodos = document.getElementById("btnVerTodosAjustes");
  if (!contenedor) return;

  if (!estadoAjuste.bitacora.length) {
   contenedor.innerHTML = '<div class="ajustes-empty">Sin ajustes registrados.</div>';
   if (botonVerTodos) botonVerTodos.style.display = "none";
   return;
  }

  const visibles = estadoAjuste.verTodos ? estadoAjuste.bitacora : estadoAjuste.bitacora.slice(0, 5);
  contenedor.innerHTML = `
   <table class="ajustes-tabla">
    <thead><tr><th>Fecha</th><th>Tipo</th><th>Motivo</th><th>Descripcion</th><th>Usuario</th><th>Cantidad</th><th></th></tr></thead>
    <tbody>
     ${visibles.map(a => `
      <tr>
       <td><strong>${esc(fechaCorta(a.fecha_ajuste))}</strong><small>${esc(horaCorta(a.created_at))}</small></td>
       <td><span class="ajustes-badge ${esc(a.tipo)}">${esc(etiquetaTipo(a.tipo))}</span></td>
       <td>${esc(a.motivo || "Sin motivo")}</td>
       <td>${descripcionAjuste(a)}</td>
       <td>${esc(a.usuario_nombre || "Sin registrar")}</td>
       <td>${esc(num(a.cantidad))}</td>
       <td><button type="button" class="ajustes-ver-detalle" onclick="verDetalleAjusteBitacora(${esc(a.id)})">Ver detalle</button></td>
      </tr>
     `).join("")}
    </tbody>
   </table>
  `;

  if (botonVerTodos) {
   botonVerTodos.style.display = estadoAjuste.bitacora.length > 5 ? "block" : "none";
   botonVerTodos.textContent = estadoAjuste.verTodos ? "Ver menos" : "Ver todos los ajustes";
  }
 }

 window.verAyudaAjustes = () => {
  alertaPOS(
   "Los ajustes te permiten mantener tu inventario actualizado cuando hay diferencias entre el sistema y la realidad.\n\nEntradas: usalo cuando recibes productos que no fueron registrados en la compra.\n\nSalidas: usalo cuando sacas productos por dano, perdida, uso interno u otros motivos.\n\nConteo / Correccion: usalo para corregir diferencias encontradas en un conteo fisico.",
   "¿Como funcionan los ajustes?",
   "info"
  );
 };

 window.mostrarAjustesInventario = async () => {
  pantallas();
  menu();
  ocultar();
  document.getElementById("pantallaAjustesInventario").style.display = "block";
  if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Ajustes de inventario", "Entradas, salidas y conteos con bitacora", "ajustes");
  await datos();
  reiniciarWizardAjuste();
  await cargarAjustesInventario();
 };

 window.cargarAjustesInventario = async () => {
  try {
   const respuesta = await fetch("/ajustes-inventario");
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar ajustes");
   estadoAjuste.bitacora = datos.ajustes || [];
   renderBitacoraAjustes();
  } catch (error) {
   estadoAjuste.bitacora = [];
   const contenedor = document.getElementById("listaAjustesInventario");
   if (contenedor) contenedor.innerHTML = '<div class="ajustes-empty">' + esc(error.message) + "</div>";
  }
 };

 const estilo = document.createElement("style");
 estilo.textContent = `
  .fase4-shell{display:grid;gap:18px;color:var(--pos-text,#172033)}
  .fase4-header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:20px;border:1px solid var(--pos-line,#dbe3ef);border-radius:8px;background:var(--pos-surface-strong,#fff)}
  .fase4-header span{font-size:12px;font-weight:900;color:var(--brand-color,#0d6efd);text-transform:uppercase}
  .fase4-header h2{margin:4px 0;font-size:26px}
  .fase4-header p{margin:0;color:var(--pos-muted,#687386)}
  .fase4-header button,.fase4-primary,.fase4-add button,.fase4-card button{min-height:40px;border:0;border-radius:8px;padding:0 14px;background:var(--brand-color,#0d6efd);color:#fff;font-weight:800;cursor:pointer}
  .fase4-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:18px}
  .fase4-panel{border:1px solid var(--pos-line,#dbe3ef);border-radius:8px;background:var(--pos-surface-strong,#fff);padding:18px;min-width:0}
  .fase4-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}
  .fase4-add{display:grid;grid-template-columns:minmax(220px,1fr) 90px 110px auto;gap:10px;margin-bottom:14px}
  .fase4-form input,.fase4-form select,.fase4-add input,.fase4-add select{min-height:42px;border:1px solid var(--pos-line,#dbe3ef);border-radius:8px;padding:0 11px;background:var(--pos-surface,#fff);color:inherit}
  .fase4-table{width:100%;border-collapse:collapse}
  .fase4-table th,.fase4-table td{padding:10px;border-bottom:1px solid var(--pos-line,#dbe3ef);text-align:left}
  .fase4-table small{display:block;color:var(--pos-muted,#687386);font-size:12px}
  .fase4-table input{width:92px;min-height:34px;border:1px solid var(--pos-line,#dbe3ef);border-radius:8px;padding:0 8px}
  .fase4-list{display:grid;gap:10px;max-height:560px;overflow:auto}
  .fase4-card{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid var(--pos-line,#dbe3ef);border-radius:8px;padding:12px;background:var(--pos-surface,#fff)}
  .fase4-card span,.fase4-card small{display:block;color:var(--pos-muted,#687386);font-size:12px;margin-top:3px}
  .fase4-card div:last-child{text-align:right;display:grid;gap:6px;justify-items:end}
  .fase4-empty{padding:18px;border:1px dashed var(--pos-line,#dbe3ef);border-radius:8px;color:var(--pos-muted,#687386)}
  body.oscuro .fase4-header,body.oscuro .fase4-panel,body.oscuro .fase4-card,body.oscuro .fase4-empty{background:rgba(15,23,42,.82);border-color:rgba(148,163,184,.22)}
  body.oscuro .fase4-form input,body.oscuro .fase4-form select,body.oscuro .fase4-add input,body.oscuro .fase4-add select,body.oscuro .fase4-table input{background:rgba(15,23,42,.7);border-color:rgba(148,163,184,.24);color:#f8fafc}
  @media(max-width:900px){.fase4-header,.fase4-grid,.fase4-form,.fase4-add{grid-template-columns:1fr;display:grid}}
 `;
 document.head.appendChild(estilo);

 setTimeout(() => {
  pantallas();
  menu();
  if (typeof profesionalizarSidebarPOS === "function") profesionalizarSidebarPOS();
 }, 800);
})();

// Contador para el id sintetico de los "articulos rapidos" (ver agregarArticuloRapido) --
// siempre negativo para no colisionar nunca con un id real de producto (serial positivo).
let contadorArticuloRapido = 0;

async function procesarCodigoBarrasPos(codigoManual) {
 const input =
 document.getElementById("busqueda");

 if (!input) return;

 const codigo =
 normalizarCodigo(codigoManual || input.value);

 if (!codigo) {
 document
 .getElementById("dinero")
 ?.focus();
 return;
 }

 const ahora =
 Date.now();

 if (
 window.__ultimoCodigoBarrasPOS === codigo &&
 ahora - (window.__ultimoCodigoBarrasTiempoPOS || 0) < 700
 ) {
 input.value = "";
 return;
 }

 window.__ultimoCodigoBarrasPOS = codigo;
 window.__ultimoCodigoBarrasTiempoPOS = ahora;

 const producto =
 buscarProductoLocalPorCodigo(codigo);

 if (!producto) {
 const productoCatalogo =
 productoDesdeCatalogo(codigo);

 if (productoCatalogo) {
 llenarFormularioConProductoCatalogo(
 productoCatalogo
 );

 alert(
 "Producto encontrado en catalogo. Revisa stock y guarda para venderlo."
 );

 input.value = "";
 return;
 }

 alert(
 "Producto no encontrado en inventario ni catalogo"
 );

 return;
 }

 if (producto.permite_venta_pieza) {
 const eleccion =
 await pedirModoVentaPOS(producto);

 if (!eleccion) {
 input.value = "";
 return;
 }

 agregar(
 producto.id,
 producto.nombre,
 precioVentaProducto(producto),
 producto,
 { modoVenta: eleccion.modo, cantidadInicial: eleccion.cantidad }
 );
 } else {
 agregar(
 producto.id,
 producto.nombre,
 precioVentaProducto(producto),
 producto
 );
 }

 input.value = "";
 buscarProductos();

 setTimeout(() => {
 document
 .getElementById("busqueda")
 ?.focus();
 }, 50);
}

function filtrarFlyoutPOSCategoria(categoria = "") {
 document
 .querySelectorAll(".pos-category-strip button")
 .forEach(boton => boton.classList.remove("active"));

 const botones =
 [...document.querySelectorAll(".pos-category-strip button")];

 const activo =
 categoria
 ? botones.find(boton => boton.textContent.toLowerCase().includes(String(categoria).toLowerCase()))
 : botones[0];

 if (activo) activo.classList.add("active");

 if (!categoria) {
 if (typeof ocultarFlyoutBusquedaPOS === "function") ocultarFlyoutBusquedaPOS();
 return;
 }

 const texto =
 normalizarTexto(categoria);

 const productos =
 todosProductos.filter(producto =>
 normalizarTexto(producto.categoria || "").includes(texto) ||
 normalizarTexto(producto.subcategoria || "").includes(texto) ||
 normalizarTexto(producto.nombre || "").includes(texto)
 );

 if (typeof mostrarFlyoutBusquedaPOS === "function") {
 mostrarFlyoutBusquedaPOS(productos, { textoVacio: `Sin productos en "${categoria}"` });
 }
}

function iconoProducto(nombre) {
 const texto =
 String(nombre || "").toLowerCase();

 let icono = "🧰";

 if (texto.includes("martillo")) icono = "🔨";
 else if (texto.includes("tornillo") || texto.includes("clavo")) icono = "🔩";
 else if (texto.includes("pintura")) icono = "🎨";
 else if (texto.includes("taladro")) icono = "🛠";
 else if (texto.includes("disco")) icono = "⚙️";
 else if (texto.includes("cinta")) icono = "📏";
 else if (texto.includes("pinza") || texto.includes("llave")) icono = "🔧";
 else if (texto.includes("cable")) icono = "🔌";
 else if (texto.includes("foco") || texto.includes("bombilla") || texto.includes("lampara")) icono = "💡";
 else if (texto.includes("cemento")) icono = "🧱";
 else if (texto.includes("manguera") || texto.includes("flexible")) icono = "🚿";
 else if (texto.includes("cpvc") || texto.includes("codo") || texto.includes("tubo")) icono = "🚰";
 else if (texto.includes("sierra")) icono = "🪚";

 return `<span class="producto-mini-icon" aria-hidden="true">${icono}</span>`;
}

function miniaturaProducto(producto, claseImg = "") {
 if (producto?.imagenUrl) {
 const nombreEscapado =
 escaparPOS(producto?.nombre || "");

 return `<img src="${producto.imagenUrl}" class="${claseImg}" alt="" loading="lazy" data-fallback-nombre="${nombreEscapado}" onerror="reemplazarImagenRotaPOS(this)">`;
 }

 return iconoProducto(producto?.nombre);
}

function reemplazarImagenRotaPOS(img) {
 img.outerHTML = iconoProducto(img.dataset.fallbackNombre || "");
}

function agregarProductoPorId(id, opciones = {}) {
 const producto =
 todosProductos.find(p => Number(p.id) === Number(id));

 if (!producto) {
 alertaPOS("No se encontro el producto para agregar al carrito.", "Producto no disponible", "alerta");
 return;
 }

 agregar(
 producto.id,
 producto.nombre,
 precioVentaProducto(producto),
 producto,
 opciones
 );
}

function agregar(
 id,
 nombre,
 precio,
 producto = {},
 opciones = {}
) {
 const modoVenta =
 opciones.modoVenta === "pieza" ? "pieza" : "bolsa";

 const unidad =
 modoVenta === "pieza" ? "pieza" : unidadProducto(producto);

 const existente =
 carrito.find(item =>
 Number(item.id) === Number(id) &&
 (item.modoVenta || "bolsa") === modoVenta
 );

 if (existente) {
 existente.cantidad =
 modoVenta === "pieza"
 ? Number(existente.cantidad || 0) + Math.max(1, Number(opciones.cantidadInicial) || 1)
 : Number(existente.cantidad || 0) + pasoUnidad(unidad);
 } else {
 const precioPublico =
 Number(producto.precio_publico || producto.precio || precio || 0);

 const precioLinea =
 modoVenta === "pieza"
 ? Number(producto.precio_pieza || precio || 0)
 : Number(precio || 0);

 const cantidadInicial =
 modoVenta === "pieza"
 ? Math.max(1, Number(opciones.cantidadInicial) || 1)
 : pasoUnidad(unidad);

 carrito.push({
 id,
 nombre: modoVenta === "pieza" ? `${nombre} (pieza suelta)` : nombre,
 precio: precioLinea,
 cantidad: cantidadInicial,
 codigo: producto.codigo || "",
 codigoInterno: typeof codigoInternoDeProducto === "function" ? codigoInternoDeProducto(producto) : (producto.codigo || ""),
 unidadVenta: unidad,
 modoVenta,
 proveedor: producto.proveedor || "",
 marca: producto.marca || "",
 categoria: producto.categoria || "",
 stockDisponible: modoVenta === "pieza"
 ? Number(producto.piezas_sueltas_stock || 0)
 : (producto.stock !== undefined && producto.stock !== null ? Number(producto.stock) : null),
 tipoProducto: producto.tipo_producto || producto.tipoProducto || "",
 basculaDigital: producto.bascula_digital || producto.basculaDigital || "no",
 precioPublico,
 precioMayoreo: Number(producto.precio_mayoreo || 0),
 precioDistribuidor: Number(producto.precio_distribuidor || 0),
 imagenUrl: producto.imagenUrl || null
 });

 if (modoVenta !== "pieza" && nivelPrecioActual && nivelPrecioActual !== "publico") {
 aplicarNivelPrecioAItem(carrito[carrito.length - 1], nivelPrecioActual);
 }
 }

 actualizarCarrito();
}

// Agrega un item que no existe como producto real en el inventario (sin
// codigo, sin registro formal) -- id negativo unico para que el carrito lo
// trate como cualquier otro renglon (cantidad +/-, quitar) sin colisionar
// con productos reales. El servidor (descontarStockVentaProducto) ignora
// cualquier id que no matchee un producto real, asi que nunca descuenta
// inventario -- por diseno, no requiere logica especial en el backend.
function agregarArticuloRapido(nombre, precio, cantidad) {
 const idSintetico =
 -(++contadorArticuloRapido);

 carrito.push({
 id: idSintetico,
 nombre,
 precio: Number(precio || 0),
 cantidad: Number(cantidad || 1),
 codigo: "Sin codigo",
 codigoInterno: "Sin codigo",
 unidadVenta: "pieza",
 modoVenta: "bolsa",
 proveedor: "",
 marca: "",
 categoria: "Articulo rapido",
 stockDisponible: null,
 tipoProducto: "",
 basculaDigital: "no",
 precioPublico: Number(precio || 0),
 precioMayoreo: 0,
 precioDistribuidor: 0,
 imagenUrl: null,
 articuloRapido: true
 });

 actualizarCarrito();
}

function eliminar(index) {

 carrito.splice(
 index,
 1
 );

 actualizarCarrito();
}

function quitarUnoCarrito(id) {
 const index =
 carrito.findIndex(
 producto => Number(producto.id) === Number(id)
 );

 if (index >= 0) {
 const producto =
 carrito[index];

 const nuevaCantidad =
 Number(producto.cantidad || 0) -
 pasoUnidad(producto.unidadVenta);

 if (nuevaCantidad > 0) {
 producto.cantidad =
 Number(nuevaCantidad.toFixed(3));
 } else {
 eliminar(index);
 return;
 }

 actualizarCarrito();
 }
}

async function limpiarCarrito() {

 if (carrito.length === 0) return;

 const confirmar =
 await confirmarPOS(
 "Vaciar todos los productos del carrito?",
 "Limpiar carrito",
 "alerta"
 );

 if (!confirmar) return;

 carrito = [];
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
 metodoPagoSeleccionado = "efectivo";
 nivelPrecioActual = "mayoreo";

 actualizarCarrito();
}

function resumenCarritoPOS() {
 const subtotal =
 carrito.reduce((suma, producto) => {
  const cantidad = Number(producto.cantidad || 1);
  const precio = Number(producto.precio || 0);
  return suma + cantidad * precio;
 }, 0);

 const valorDescuento =
 Math.max(0, Number(descuentoCarrito.valor || 0));

 const descuentoBruto =
 descuentoCarrito.tipo === "porcentaje"
 ? subtotal * Math.min(valorDescuento, 100) / 100
 : descuentoCarrito.tipo === "monto"
 ? Math.min(valorDescuento, subtotal)
 : 0;

 const redondearCentavos =
 valor => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

 const subtotalRedondeado =
 redondearCentavos(subtotal);

 const descuento =
 redondearCentavos(descuentoBruto);

 const total =
 redondearCentavos(Math.max(0, subtotalRedondeado - descuento));

 return {
 subtotal: subtotalRedondeado,
 descuento,
 total,
 descuentoTipo: descuentoCarrito.tipo,
 descuentoValor: valorDescuento
 };
}

function actualizarDescuentoCarrito(tipo, valor) {
 descuentoCarrito = {
 tipo: tipo || "ninguno",
 valor: Number(valor || 0)
 };
 actualizarCarrito();
}

function quitarDescuentoCarrito() {
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
 };
 actualizarCarrito();
}

function aplicarNivelPrecioAItem(item, nivel) {
 if (!item) return;

 const candidato =
 nivel === "mayoreo"
 ? item.precioMayoreo
 : nivel === "distribuidor"
 ? item.precioDistribuidor
 : item.precioPublico;

 item.precio =
 Number(candidato) > 0
 ? Number(candidato)
 : Number(item.precioPublico || item.precio || 0);
}

function recalcularPreciosPorNivel(nivel) {
 nivelPrecioActual = nivel || "mayoreo";

 carrito.forEach(item => {
 aplicarNivelPrecioAItem(item, nivelPrecioActual);
 });

 actualizarCarrito();
}

async function cotizarVentaPOS() {
 if (carrito.length === 0) {
  await alertaPOS("Agrega productos al carrito antes de cotizar.", "Carrito vacio", "alerta");
  return;
 }

 const resumen =
 resumenCarritoPOS();

 const negocio =
 configuracionNegocio() || {};

 const fecha =
 new Date().toLocaleString("es-MX");

 const cliente =
 clienteVentaActual?.nombre || "Publico general";

 let itemsHtml = "";

 carrito.forEach(p => {
  const importe =
  Number(p.precio || 0) * Number(p.cantidad || 1);

  itemsHtml += `
  <div style="display:flex;justify-content:space-between;margin:6px 0;">
  <span>
  ${escaparPOS(p.nombre)}<br>
  <small>${formatearCantidad(p.cantidad, p.unidadVenta)} x $${Number(p.precio || 0).toFixed(2)}</small>
  </span>
  <span>$${importe.toFixed(2)}</span>
  </div>
  `;
 });

 const ticket = `
 <div style="width:300px;font-family:monospace;padding:20px;color:black;">
 <div style="text-align:center;margin-bottom:12px;">
 <h2 style="margin:0;font-size:20px;">${escaparPOS(negocio.ticketNombre || negocio.nombre || "Ferreteria")}</h2>
 <div style="font-weight:bold;margin-top:6px;">COTIZACION</div>
 <div style="font-size:11px;">No es un comprobante fiscal</div>
 <div>${fecha}</div>
 <div>Cliente: ${escaparPOS(cliente)}</div>
 </div>
 <hr>
 ${itemsHtml}
 <hr>
 ${resumen.descuento > 0 ? `<div style="display:flex;justify-content:space-between;"><span>SUBTOTAL</span><span>$${resumen.subtotal.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;"><span>DESCUENTO</span><span>-$${resumen.descuento.toFixed(2)}</span></div>` : ""}
 <div style="display:flex;justify-content:space-between;font-weight:bold;">
 <span>TOTAL</span>
 <span>$${resumen.total.toFixed(2)}</span>
 </div>
 <hr>
 <div style="text-align:center;margin-top:12px;font-size:12px;">
 Precios sujetos a cambio sin previo aviso
 </div>
 </div>
 `;

 const enviado =
 await imprimirTicketPOS(ticket, null, { abrirCajon: false });

 if (!enviado) {
  await alertaPOS("No se pudo enviar la cotizacion a la impresora.", "Cotizacion", "alerta");
 }
}

const VENTAS_EN_ESPERA_POS_KEY = "ventasEnEsperaFerreteriaPOS";

function listarVentasEnEsperaPOS() {
 try {
  const datos =
  JSON.parse(localStorage.getItem(VENTAS_EN_ESPERA_POS_KEY) || "[]");

  return Array.isArray(datos) ? datos : [];
 } catch (error) {
  return [];
 }
}

function guardarListaVentasEnEsperaPOS(lista) {
 localStorage.setItem(VENTAS_EN_ESPERA_POS_KEY, JSON.stringify(lista || []));
}

function renderIndicadorVentasEnEsperaPOS() {
 const pendientes =
 listarVentasEnEsperaPOS();

 if (!pendientes.length) return "";

 return `
 <button type="button" class="pos-ventas-espera-indicador" onclick="abrirVentasEnEsperaPOS()">
 <span>Ventas en espera</span>
 <strong>${pendientes.length}</strong>
 </button>
 `;
}

async function guardarVentaEnEspera() {
 if (carrito.length === 0) {
  await alertaPOS("Agrega productos al carrito antes de guardarlo en espera.", "Carrito vacio", "alerta");
  return;
 }

 const etiqueta =
 await pedirTextoPOS("Nombre o referencia para esta venta en espera:", "", "Guardar venta en espera");

 if (etiqueta === null) return;

 const lista =
 listarVentasEnEsperaPOS();

 lista.push({
  id: Date.now(),
  fecha: new Date().toISOString(),
  etiqueta: etiqueta || "Venta en espera",
  carrito: JSON.parse(JSON.stringify(carrito)),
  cliente: clienteVentaActual,
  descuentoCarrito: JSON.parse(JSON.stringify(descuentoCarrito)),
  nivelPrecioActual,
  metodoPagoSeleccionado
 });

 guardarListaVentasEnEsperaPOS(lista);

 carrito = [];
 descuentoCarrito = { tipo: "ninguno", valor: 0 };
 clienteVentaActual = null;
 metodoPagoSeleccionado = "efectivo";
 nivelPrecioActual = "mayoreo";

 actualizarCarrito();
 actualizarClientePOS();

 await alertaPOS("La venta quedo guardada en espera.", "Venta en espera", "exito");
}

async function abrirVentasEnEsperaPOS() {
 let modal =
 document.getElementById("modalVentasEnEsperaPOS");

 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalVentasEnEsperaPOS";
  modal.className = "modal-personalizado modal-ventas-espera-pos";
  document.body.appendChild(modal);
 }

 renderModalVentasEnEsperaPOS(modal);

 modal.style.display = "flex";
}

function cerrarVentasEnEsperaPOS() {
 const modal =
 document.getElementById("modalVentasEnEsperaPOS");

 if (modal) modal.style.display = "none";
}

function renderModalVentasEnEsperaPOS(modal) {
 const lista =
 listarVentasEnEsperaPOS();

 const filas =
 lista.length === 0
 ? `<div class="ventas-espera-vacio">No hay ventas guardadas en espera.</div>`
 : lista.map(venta => {
  const totalVenta =
  (venta.carrito || []).reduce((suma, p) => suma + Number(p.precio || 0) * Number(p.cantidad || 1), 0);

  return `
  <div class="ventas-espera-item">
   <div>
    <strong>${escaparPOS(venta.etiqueta || "Venta en espera")}</strong>
    <small>${escaparPOS(new Date(venta.fecha).toLocaleString("es-MX"))} &middot; $${totalVenta.toFixed(2)} &middot; ${(venta.carrito || []).length} producto(s)</small>
   </div>
   <div class="ventas-espera-acciones">
    <button type="button" onclick="recuperarVentaEnEspera(${venta.id})">Recuperar</button>
    <button type="button" class="btn-eliminar-espera" onclick="eliminarVentaEnEspera(${venta.id})">Eliminar</button>
   </div>
  </div>
  `;
 }).join("");

 modal.innerHTML = `
 <div class="modal-contenido-pos">
  <div class="modal-header-pos">
   <strong>Ventas en espera</strong>
   <button type="button" onclick="cerrarVentasEnEsperaPOS()">Cerrar</button>
  </div>
  <div class="ventas-espera-lista">
   ${filas}
  </div>
 </div>
 `;
}

async function recuperarVentaEnEspera(id) {
 const lista =
 listarVentasEnEsperaPOS();

 const venta =
 lista.find(v => Number(v.id) === Number(id));

 if (!venta) return;

 if (carrito.length > 0) {
  const confirmado =
  await confirmarPOS(
   "El carrito activo tiene productos. Al recuperar esta venta se reemplazara el carrito actual. Continuar?",
   "Reemplazar carrito"
  );

  if (!confirmado) return;
 }

 carrito = JSON.parse(JSON.stringify(venta.carrito || []));
 clienteVentaActual = venta.cliente || null;
 descuentoCarrito = venta.descuentoCarrito || { tipo: "ninguno", valor: 0 };
 nivelPrecioActual = venta.nivelPrecioActual || "mayoreo";
 metodoPagoSeleccionado = venta.metodoPagoSeleccionado || "efectivo";

 guardarListaVentasEnEsperaPOS(lista.filter(v => Number(v.id) !== Number(id)));

 cerrarVentasEnEsperaPOS();
 actualizarCarrito();
 actualizarClientePOS();
}

async function eliminarVentaEnEspera(id) {
 const confirmado =
 await confirmarPOS("Eliminar esta venta guardada en espera?", "Eliminar venta en espera");

 if (!confirmado) return;

 const lista =
 listarVentasEnEsperaPOS().filter(v => Number(v.id) !== Number(id));

 guardarListaVentasEnEsperaPOS(lista);

 const modal =
 document.getElementById("modalVentasEnEsperaPOS");

 if (modal) renderModalVentasEnEsperaPOS(modal);
}

function resumenClientePOS(cliente = clienteVentaActual) {
 if (!cliente) {
  return {
   nombre: "Publico general",
   detalle: "Venta de mostrador",
   saldo: 0,
   limite: 0,
   disponible: 0
  };
 }

 const saldo =
 Number(cliente.saldo || 0);

 const limite =
 Number(cliente.limite_credito || cliente.limiteCredito || 0);

 return {
  nombre: cliente.nombre || "Cliente",
  detalle: saldo > 0
  ? `Saldo ${dinero(saldo)}`
  : limite > 0
  ? `Disponible ${dinero(Math.max(0, limite - saldo))}`
  : "Sin adeudo",
  saldo,
  limite,
  disponible: Math.max(0, limite - saldo)
 };
}

function actualizarClientePOS() {
 const nombre =
 document.getElementById("clienteVentaNombre");

 const resumen =
 document.getElementById("clienteVentaResumen");

 const datos =
 resumenClientePOS();

 if (nombre) nombre.textContent = datos.nombre;
 if (resumen) resumen.textContent = datos.detalle;
}

function seleccionarClientePOS(id) {
 const clienteId = Number(id || 0);
 clienteVentaActual =
 clienteId > 0
 ? clientesCredito.find(cliente => Number(cliente.id) === clienteId) || null
 : null;

 actualizarClientePOS();
 cerrarSelectorClientePOS();
 actualizarCarrito();
}

async function crearClienteDesdePOS() {
 cerrarSelectorClientePOS();
 await abrirNuevoClienteCredito();
 await intentarRefrescarNubePOS(() => cargarCreditos(), "clientes");
 abrirSelectorClientePOS();
}

function cerrarSelectorClientePOS() {
 const modal =
 document.getElementById("modalClientePOS");

 if (modal) modal.style.display = "none";
}

async function abrirSelectorClientePOS() {
 let modal =
 document.getElementById("modalClientePOS");

 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalClientePOS";
  modal.className = "modal-personalizado modal-cliente-pos";
  document.body.appendChild(modal);
 }

 try {
  await intentarRefrescarNubePOS(() => cargarCreditos(), "clientes");
 } catch (error) {
  console.warn("No se pudieron refrescar clientes", error);
 }

 const clientes =
 [...clientesCredito].sort((a, b) =>
 String(a.nombre || "").localeCompare(String(b.nombre || ""))
 );

 const frecuentes =
 clientes.filter(cliente => Number(cliente.saldo || 0) > 0).slice(0, 4);

 const filas =
 clientes.length === 0
 ? '<div class="cliente-pos-empty">No hay clientes registrados.</div>'
 : clientes.map(cliente => {
  const datos = resumenClientePOS(cliente);
  const activo = clienteVentaActual && Number(clienteVentaActual.id) === Number(cliente.id);
  return `
  <button type="button" class="${activo ? "activo" : ""}" onclick="seleccionarClientePOS(${cliente.id})">
   <strong>${cliente.nombre}</strong>
   <span>Saldo ${dinero(datos.saldo)} · Disponible ${dinero(datos.disponible)}</span>
  </button>
  `;
 }).join("");

 modal.innerHTML = `
 <div class="modal-card cliente-pos-card">
  <div class="modal-card-header">
   <div>
    <span>Punto de venta</span>
    <h3>Seleccionar cliente</h3>
   </div>
   <button type="button" onclick="cerrarSelectorClientePOS()">Cerrar</button>
  </div>
  <div class="cliente-pos-resumen-grid">
   <button type="button" onclick="seleccionarClientePOS(0)">
    <strong>Publico general</strong>
    <span>Venta de mostrador sin credito</span>
   </button>
   <button type="button" onclick="crearClienteDesdePOS()">
    <strong>Crear cliente nuevo</strong>
    <span>Alta rapida desde el POS</span>
   </button>
  </div>
  <div class="cliente-pos-bloque">
   <h4>Clientes con credito</h4>
   <div class="cliente-pos-lista">${filas}</div>
  </div>
  ${
   frecuentes.length
   ? `<div class="cliente-pos-bloque"><h4>Atencion frecuente</h4><div class="cliente-pos-chips">${
    frecuentes.map(cliente => `<button onclick="seleccionarClientePOS(${cliente.id})">${cliente.nombre}</button>`).join("")
   }</div></div>`
   : ""
  }
 </div>
 `;

 modal.style.display = "flex";
}

function calcularCambio(total) {
 const resumen =
 resumenCarritoPOS();

 const totalReal =
 Number(total ?? resumen.total);

 const dinero =
 Number(
 document.getElementById(
 "dinero"
 )?.value || 0
 );

 const cambio =
 dinero - totalReal;

 const texto =
 document.getElementById(
 "cambioTexto"
 );

 if (!texto) return;

 texto.textContent =
 cambio >= 0
 ? `$${cambio.toFixed(2)}`
 : "Insuficiente";
}

function guardarUltimaVentaPOS(venta = {}) {
 if (!venta.id) return;

 const datos = {
  id: Number(venta.id),
  folio: venta.folio || "",
  total: Number(venta.total || 0),
  recibido: Number(venta.recibido || 0),
  cambio: Number(venta.cambio || 0),
  fecha: venta.fecha || new Date().toISOString()
 };

 localStorage.setItem(ULTIMA_VENTA_POS_KEY, JSON.stringify(datos));
}

function ultimaVentaPOS() {
 try {
  const datos =
  JSON.parse(localStorage.getItem(ULTIMA_VENTA_POS_KEY) || "null");

  return datos && datos.id ? datos : null;
 } catch (error) {
  return null;
 }
}

function renderAccesoUltimaVentaPOS() {
 const venta =
 ultimaVentaPOS();

 if (!venta) {
  return `
  <div class="ultima-venta-pos vacia">
   <div>
    <strong>Sin venta reciente</strong>
    <span>Al cobrar una venta aparecera aqui para hacer nota o reimprimir.</span>
   </div>
   <div class="ultima-venta-acciones-pos">
    <button type="button" onclick="enfocarHistorialVentasPOS()">Ver historial</button>
   </div>
  </div>
  `;
 }

 return `
 <div class="ultima-venta-pos">
  <div>
   <span>Ultima venta</span>
   <strong>${escaparPOS(venta.folio || "Venta reciente")} · ${dinero(venta.total || 0)}</strong>
   <small>${venta.fecha ? escaparPOS(new Date(venta.fecha).toLocaleString("es-MX")) : "Recien cobrada"}</small>
  </div>
  <div class="ultima-venta-acciones-pos">
   <button type="button" onclick="abrirDetalleVentaPOS(${Number(venta.id)})">Detalle / nota</button>
   <button type="button" onclick="abrirNotaVentaPOS(${Number(venta.id)})">Hacer nota</button>
   <button type="button" onclick="enfocarHistorialVentasPOS()">Historial</button>
  </div>
 </div>
 `;
}

async function enfocarHistorialVentasPOS() {
 try {
  if (typeof cargarHistorial === "function") {
   await cargarHistorial();
  }
 } catch (error) {
  console.warn("No se pudo refrescar historial", error);
 }

 const tarjeta =
 document.querySelector(".pos-historial-card");

 if (tarjeta) {
  tarjeta.scrollIntoView({
   behavior: "smooth",
   block: "center"
  });
 }
}

function actualizarCarrito() {
 renderCarritoReferenciaPOS();
}

function renderCarritoReferenciaPOS() {
 renderCarritoTablaPOS();
 renderResumenCobroPOS();
}

function renderCarritoTablaPOS() {

 const contenedor =
 document.getElementById(
 "carritoTabla"
 );

 if (!contenedor) return;

 let itemsHtml =
 renderIndicadorVentasEnEsperaPOS();

 if (carrito.length === 0) {
 itemsHtml += `
 <div class="carrito-vacio pos-cart-empty pos-cart-empty-state">
 <span class="pos-cart-empty-icon">${typeof iconoUISVG === "function" ? iconoUISVG("cart") : ""}</span>
 <strong>Escanea un codigo de barras</strong>
 <span>o busca un producto para agregar a la venta</span>
 </div>
 `;
 } else {
 itemsHtml += `
 <table class="pos-cart-table">
 <thead>
 <tr>
 <th>#</th>
 <th>Codigo</th>
 <th>Producto</th>
 <th>Cantidad</th>
 <th>Precio unitario</th>
 <th>Total</th>
 <th></th>
 </tr>
 </thead>
 <tbody>
 `;

 carrito.forEach((p, index) => {
 const unidad =
 p.unidadVenta || "pieza";

 const cantidad =
 Number(p.cantidad || 1);

 const importe =
 Number(p.precio || 0) * cantidad;

 const codigo =
 p.codigoInterno || p.codigo || `PROD-${p.id}`;

 const etiquetas =
 [
 p.marca ? `<span>${escaparPOS(p.marca)}</span>` : "",
 p.proveedor ? `<span>${escaparPOS(p.proveedor)}</span>` : "",
 p.categoria ? `<span>${escaparPOS(p.categoria)}</span>` : "",
 p.stockDisponible !== null && p.stockDisponible !== undefined ? `<span>Stock ${escaparPOS(p.stockDisponible)} ${escaparPOS(unidad)}</span>` : ""
 ].filter(Boolean).join("");

 itemsHtml += `
 <tr class="pos-cart-row" data-id="${p.id}">
 <td class="pos-cart-index">${index + 1}</td>
 <td class="pos-cart-code">${escaparPOS(codigo)}</td>
 <td class="pos-cart-product">
 <span class="pos-cart-thumb item-icono">${miniaturaProducto(p, "pos-cart-thumb-img")}</span>
 <div>
 <strong>${escaparPOS(p.nombre)}</strong>
 ${etiquetas ? `<div class="pos-cart-meta">${etiquetas}</div>` : ""}
 </div>
 </td>
 <td class="pos-cart-qty">
 <div class="item-cantidad">
 <button onclick="quitarUnoConPulso(${p.id})">-</button>
 <input
 type="number"
 min="0"
 step="${esUnidadDecimal(unidad) ? "0.001" : "1"}"
 value="${cantidad}"
 onchange="cambiarCantidadConPulso(${index}, this.value, ${p.id})"
 >
 <button onclick="sumarCantidadConPulso(${index}, ${p.id})">+</button>
 </div>
 ${p.basculaDigital === "preparado" || esUnidadDecimal(unidad) ? `
 <button class="btn-bascula" onclick="capturarPesoManual(${index})">
 Bascula / peso
 </button>
 ` : ""}
 </td>
 <td class="pos-cart-price">$${Number(p.precio).toFixed(2)}</td>
 <td class="pos-cart-total"><strong>$${importe.toFixed(2)}</strong></td>
 <td class="pos-cart-actions">
 <button type="button" class="pos-cart-remove" onclick="eliminarConAnimacion(${index}, ${p.id})" aria-label="Quitar producto">
 &times;
 </button>
 </td>
 </tr>
 `;
 });

 itemsHtml += `
 </tbody>
 </table>
 `;
 }

 contenedor.innerHTML = `<div class="carrito-items">${itemsHtml}</div>`;
}

function pulsarCantidadCarritoPorId(id) {
 const fila =
 document.querySelector(`.pos-cart-row[data-id="${Number(id)}"]`);

 if (!fila) return;

 const input =
 fila.querySelector(".item-cantidad input");

 if (!input) return;

 input.classList.add("pulso");
 setTimeout(() => input.classList.remove("pulso"), 260);
}

function sumarCantidadConPulso(index, id) {
 sumarCantidadCarrito(index);
 pulsarCantidadCarritoPorId(id);
}

function quitarUnoConPulso(id) {
 quitarUnoCarrito(id);
 pulsarCantidadCarritoPorId(id);
}

function cambiarCantidadConPulso(index, valor, id) {
 cambiarCantidadCarrito(index, valor);
 pulsarCantidadCarritoPorId(id);
}

function eliminarConAnimacion(index, id) {
 const fila =
 document.querySelector(`.pos-cart-row[data-id="${Number(id)}"]`);

 if (!fila) {
 eliminar(index);
 return;
 }

 fila.classList.add("saliendo");
 setTimeout(() => eliminar(index), 150);
}

function renderResumenCobroPOS() {

 const contenedor =
 document.getElementById(
 "resumenCobro"
 );

 if (!contenedor) return;

 const resumen =
 resumenCarritoPOS();

 const total =
 resumen.total;

 contenedor.innerHTML = `

 <div class="resumen-cobro">

 <div class="resumen-precio-aplicado">
 <span>Precio aplicado <em class="pos-shortcut-hint">F7</em></span>
 <div class="precio-aplicado-opciones">
 <button type="button" class="${nivelPrecioActual === "publico" ? "activo" : ""}" onclick="recalcularPreciosPorNivel('publico')">
 Publico
 </button>
 <button type="button" class="${nivelPrecioActual === "mayoreo" ? "activo" : ""}" onclick="recalcularPreciosPorNivel('mayoreo')">
 Medio mayoreo
 </button>
 <button type="button" class="${nivelPrecioActual === "distribuidor" ? "activo" : ""}" onclick="recalcularPreciosPorNivel('distribuidor')">
 Mayoreo / distribuidor
 </button>
 </div>
 </div>

 <button type="button" class="pos-discount-button" onclick="document.querySelector('.resumen-descuento')?.classList.toggle('abierto')">
 <span>Agregar descuento</span>
 <strong>&gt;</strong>
 </button>

 <div class="resumen-linea">
 <span>Subtotal</span>
 <strong>$${resumen.subtotal.toFixed(2)}</strong>
 </div>

 <div class="resumen-descuento">
 <label>
 <span>Descuento</span>
 <select onchange="actualizarDescuentoCarrito(this.value, document.getElementById('valorDescuentoCarrito')?.value || 0)">
 <option value="ninguno" ${resumen.descuentoTipo === "ninguno" ? "selected" : ""}>Sin descuento</option>
 <option value="porcentaje" ${resumen.descuentoTipo === "porcentaje" ? "selected" : ""}>Porcentaje</option>
 <option value="monto" ${resumen.descuentoTipo === "monto" ? "selected" : ""}>Monto</option>
 </select>
 </label>
 <input
 id="valorDescuentoCarrito"
 type="number"
 min="0"
 step="0.01"
 value="${resumen.descuentoValor || ""}"
 placeholder="0"
 oninput="actualizarDescuentoCarrito(document.querySelector('.resumen-descuento select')?.value || 'ninguno', this.value)"
 >
 </div>

 <div class="resumen-linea">
 <span>Descuento</span>
 <strong>-$${resumen.descuento.toFixed(2)}</strong>
 </div>

 <div class="resumen-linea">
 <span>IVA (16%)</span>
 <strong>$${(total * 0.16).toFixed(2)}</strong>
 </div>

 <div class="resumen-linea total-final">
 <span>Total</span>
 <strong>$${total.toFixed(2)}</strong>
 </div>

 <div class="resumen-metodo-pago">
 <span>Metodo de pago</span>
 <div class="metodo-pago-opciones">
 <button type="button" class="${metodoPagoSeleccionado === "efectivo" ? "activo" : ""}" onclick="seleccionarMetodoPagoPOS('efectivo', ${total})">
 Efectivo
 </button>
 <button type="button" class="${metodoPagoSeleccionado === "tarjeta" ? "activo" : ""}" onclick="seleccionarMetodoPagoPOS('tarjeta', ${total})">
 Tarjeta
 </button>
 <button type="button" class="${metodoPagoSeleccionado === "transferencia" ? "activo" : ""}" onclick="seleccionarMetodoPagoPOS('transferencia', ${total})">
 Transferencia
 </button>
 </div>
 </div>

 <label class="campo-recibido">
 <span>Recibido</span>
 <input
 type="number"
 id="dinero"
 placeholder="0.00"
 value="${metodoPagoSeleccionado !== "efectivo" ? total.toFixed(2) : ""}"
 ${metodoPagoSeleccionado !== "efectivo" ? "readonly" : ""}
 oninput="calcularCambio(${total})"
 onkeydown="cobrarConEnter(event, ${total})"
 >
 </label>

 <div class="resumen-linea cambio-linea">
 <span>Cambio</span>
 <strong id="cambioTexto">$0.00</strong>
 </div>

 <div class="carrito-acciones-cobro">
 <button class="btn-cobrar" onclick="cobrar(${total})">
 Cobrar <span>F8</span>
 </button>

 <div class="carrito-acciones-secundarias">
 <button class="btn-credito-carrito" onclick="cobrarCredito(${total})">
 Credito
 </button>

 <button class="btn-cotizar-carrito" onclick="cotizarVentaPOS()">
 Cotizar
 </button>

 <button class="btn-guardar-carrito" onclick="guardarVentaEnEspera()">
 Guardar
 </button>

 <button class="btn-limpiar" onclick="limpiarCarrito()">
 Cancelar
 </button>
 </div>
 </div>
 </div>
 `;

 if (metodoPagoSeleccionado !== "efectivo") {
 calcularCambio(total);
 }

}

function seleccionarMetodoPagoPOS(metodo, total) {
 metodoPagoSeleccionado = metodo || "efectivo";
 actualizarCarrito();
}

function cambiarCantidadCarrito(index, valor) {
 const producto =
 carrito[index];

 if (!producto) return;

 const cantidad =
 Math.max(0, Number(valor || 0));

 if (cantidad <= 0) {
 carrito.splice(index, 1);
 } else {
 producto.cantidad =
 Number(cantidad.toFixed(3));
 }

 actualizarCarrito();
}

function sumarCantidadCarrito(index) {
 const producto =
 carrito[index];

 if (!producto) return;

 const cantidad =
 Number(producto.cantidad || 0) +
 pasoUnidad(producto.unidadVenta);

 producto.cantidad =
 Number(cantidad.toFixed(3));

 actualizarCarrito();
}

async function capturarPesoManual(index) {
 const producto =
 carrito[index];

 if (!producto) return;

 const valor =
 await pedirTextoPOS(
 `Cantidad en ${producto.unidadVenta || "unidad"}:`,
 String(producto.cantidad || 1),
 "Bascula / cantidad"
 );

 if (valor === null) return;

 cambiarCantidadCarrito(index, valor);
}

function productosCarritoAgrupados() {
 return carrito.map(producto => {
 const cantidad =
 Number(producto.cantidad || 1);

 const precio =
 Number(producto.precio || 0);

 return {
 id: producto.id,
 codigo: producto.codigo || "",
 nombre: producto.nombre,
 precio,
 cantidad,
 unidadVenta: producto.unidadVenta || "pieza",
 modoVenta: producto.modoVenta || "bolsa",
 importe: cantidad * precio
 };
 });
}

async function imprimirTicketPOS(ticket, configOverride = null, opciones = {}) {
 try {
  const abrirCajon =
  opciones.abrirCajon !== false;

  const negocio =
  configOverride || configuracionNegocio() || {};

  const anchoMm =
  negocio.ticketAncho === "58" ? 58 : 80;

  const anchoContenido =
  negocio.ticketAncho === "58" ? "52mm" : "72mm";

  if (negocio.imprimirAutomatico === false) {
   return true;
  }

  const htmlTicket = `
   <html>
   <head>
   <title>Ticket</title>
   <style>
   @page {
    size: ${anchoMm}mm auto;
    margin: 0;
   }

   * {
    box-sizing: border-box;
   }

   html,
   body {
    width: ${anchoMm}mm;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
   }

   body {
    display: block;
    font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    line-height: 1.25;
   }

   .ticket-print-page {
    width: ${anchoMm}mm;
    min-height: auto;
    padding: 3mm 3mm 5mm;
    background: #fff;
   }

   .ticket-print-page > div {
    width: ${anchoContenido} !important;
    max-width: ${anchoContenido} !important;
    padding: 0 !important;
    margin: 0 auto !important;
   }

   .ticket-print-page h1,
   .ticket-print-page h2,
   .ticket-print-page h3 {
    font-size: 15px !important;
    line-height: 1.05 !important;
    margin: 0 0 1.5mm !important;
   }

   .ticket-print-page img {
    max-width: 16mm !important;
    max-height: 16mm !important;
   }

   .ticket-print-page hr {
    border: 0;
    border-top: 1px dashed #000;
    margin: 2mm 0;
   }

   @media print {
    html,
    body {
     width: ${anchoMm}mm;
    }

    .ticket-print-page {
     width: ${anchoMm}mm;
    }
   }
   </style>
   </head>
   <body>
   <main class="ticket-print-page">
   ${ticket}
   </main>
   </body>
   </html>
  `;

  if (
   negocio.impresionSilenciosa === true &&
   window.nexoDesktop &&
   typeof window.nexoDesktop.printTicket === "function"
  ) {
   const resultado =
   await window.nexoDesktop.printTicket({
    html: htmlTicket,
    ...opcionesImpresionPOS(negocio)
   });

   return Boolean(resultado?.ok);
  }

  const iframe =
  document.createElement("iframe");

  iframe.title = "Ticket de venta";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";

  document.body.appendChild(iframe);

  const documento =
  iframe.contentWindow.document;

  documento.open();
  documento.write(htmlTicket);
  documento.close();

  setTimeout(() => {
   iframe.contentWindow.focus();
   iframe.contentWindow.print();

   if (
    abrirCajon &&
    negocio.abrirCajonDespuesTicket === true &&
    window.nexoDesktop &&
    typeof window.nexoDesktop.openCashDrawer === "function"
   ) {
    window.nexoDesktop.openCashDrawer({
     printerName: negocio.impresoraNombre || ""
    }).catch(error => console.warn("No se pudo abrir cajon", error));
   }

   setTimeout(() => {
    iframe.remove();
   }, 1200);
  }, 180);

  return true;
 } catch (error) {
  console.warn("No se pudo imprimir ticket", error);
  return false;
 }
}

async function cobrar(total) {
 if (window.__cobrandoEnCursoPOS) return;

 window.__cobrandoEnCursoPOS = true;

 try {
 await cobrarInternoPOS(total);
 } finally {
 window.__cobrandoEnCursoPOS = false;
 }
}

async function cobrarInternoPOS(total) {

 if (!(await validarOperacionLicenciaNexoPOS("una venta"))) return;

 const resumen =
 resumenCarritoPOS();

 total =
 resumen.total;

 if (carrito.length === 0 || Number(total || 0) <= 0) {
 await alertaPOS("Agrega productos al carrito antes de cobrar.", "Carrito vacio", "alerta");
 return;
 }

 const dineroInicial =
 Number(
 document.getElementById("dinero")?.value || 0
 );

 const pago =
 await pedirMetodoPagoPOS(total, {
 metodoInicial: metodoPagoSeleccionado,
 recibidoInicial: dineroInicial > 0 ? dineroInicial : total
 });

 if (!pago) return;

 if (pago.accion === "credito") {
 await cobrarCredito(total);
 return;
 }

 const dinero =
 pago.recibido;

const cambio =
pago.cambio;

let respuesta;
let ventaRegistrada = null;
let ventaOffline = false;
const productosVenta =
productosCarritoAgrupados();

try {
 respuesta = await fetch(
 "/ventas",
 {
 method: "POST",

 headers: {
 "Content-Type":
 "application/json"
 },

 body: JSON.stringify({
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 clienteNombre: resumenClientePOS().nombre,
 cajeroUsuario: usuarioActual?.id || usuarioActual?.usuario || "",
 cajeroNombre: usuarioActual?.nombre || usuarioActual?.usuario || "Administrador",
 productos: productosVenta,
 metodoPago: pago.metodoPago,
 pagos: pago.pagos
 })
 }
 );
 } catch (error) {
 const offline =
 await registrarVentaOfflineDesktopPOS({
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 clienteNombre: resumenClientePOS().nombre,
 cajeroUsuario: usuarioActual?.id || usuarioActual?.usuario || "",
 cajeroNombre: usuarioActual?.nombre || usuarioActual?.usuario || "Administrador",
 recibido: dinero,
 cambio,
 metodoPago: pago.metodoPago,
 productos: productosVenta,
 errorConexion: error.message
 });

 if (offline.offlineDisponible && offline.ok) {
 ventaRegistrada = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 ventaOffline = true;
 } else {
 await alertaPOS("No se pudo conectar con el servidor para registrar la venta.", "Venta no registrada", "peligro");
 return;
 }
 }

 if (!ventaOffline && !respuesta.ok) {
 const offline =
 await registrarVentaOfflineDesktopPOS({
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 clienteNombre: resumenClientePOS().nombre,
 cajeroUsuario: usuarioActual?.id || usuarioActual?.usuario || "",
 cajeroNombre: usuarioActual?.nombre || usuarioActual?.usuario || "Administrador",
 recibido: dinero,
 cambio,
 metodoPago: pago.metodoPago,
 productos: productosVenta,
 errorServidor: respuesta.status
 });

 if (offline.offlineDisponible && offline.ok) {
 ventaRegistrada = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 ventaOffline = true;
 } else {
 await alertaPOS("El servidor no pudo registrar la venta. No se imprimio ticket para evitar errores de inventario.", "Venta no registrada", "peligro");
 return;
 }
 }

 if (!ventaRegistrada) {
 ventaRegistrada =
 await respuesta.json().catch(() => ({
 success: true
 }));
 }

 if (!ventaOffline) {
 await registrarEventoDesktopPOS(
 "venta_creada",
 "venta",
 ventaRegistrada.ventaId || ventaRegistrada.historialId || "",
 {
 ventaId: ventaRegistrada.ventaId || null,
 historialId: ventaRegistrada.historialId || null,
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 clienteNombre: resumenClientePOS().nombre,
 cajeroUsuario: usuarioActual?.id || usuarioActual?.usuario || "",
 cajeroNombre: usuarioActual?.nombre || usuarioActual?.usuario || "Administrador",
 recibido: dinero,
 cambio,
 metodoPago: pago.metodoPago,
 productos: productosVenta,
 fechaServidor: ventaRegistrada.fecha || null
 }
 );
 }

 const cambioTexto =
 document.getElementById(
 "cambioTexto"
 );

if (cambioTexto) {

 cambioTexto.textContent =
 ventaOffline
 ? ` Venta offline guardada | Cambio: $${cambio}`
 : ` Venta realizada | Cambio: $${cambio}`;
}
const fecha =
 new Date()
 .toLocaleString(
 "es-MX"
 );
const folioTicket =
 ventaRegistrada?.folio || ventaRegistrada?.eventId || "";

const negocio =
 configuracionNegocio() || {};

let ticket = `

<div style="
 width:300px;
 font-family:monospace;
 padding:20px;
 color:black;
">

 <div style="
 text-align:center;
 margin-bottom:12px;
 ">

 <h2 style="
 margin:0;
 font-size:22px;
 ">
 FERRETERIA
 </h2>

 <h2 style="
 margin:0;
 font-size:22px;
 ">
 OLIMPICO
 </h2>

 <div>
 Rio Grande, Zac.
 </div>

 <div>
 ${fecha}
 </div>
 ${folioTicket ? `<div><strong>Folio ${folioTicket}</strong></div>` : ""}

 </div>

 <hr>

`;

productosVenta.forEach(p => {

 ticket += `

 <div style="
 display:flex;
 justify-content:space-between;
 margin:6px 0;
 ">

 <span>
 ${p.nombre}<br>
 <small>${formatearCantidad(p.cantidad, p.unidadVenta)} x $${p.precio.toFixed(2)}</small>
 </span>

 <span>
 $${p.importe.toFixed(2)}
 </span>

 </div>
 `;
});

ticket += `

 <hr>

 ${
 resumen.descuento > 0
 ? `<div style="display:flex;justify-content:space-between;"><span>SUBTOTAL</span><span>$${resumen.subtotal.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;"><span>DESCUENTO</span><span>-$${resumen.descuento.toFixed(2)}</span></div>`
 : ""
 }

 <div style="
 display:flex;
 justify-content:space-between;
 font-weight:bold;
 ">
 <span>TOTAL</span>
 <span>$${total.toFixed(2)}</span>
 </div>

 <div style="
 display:flex;
 justify-content:space-between;
 ">
 <span>RECIBIDO</span>
 <span>$${dinero}</span>
 </div>

 <div style="
 display:flex;
 justify-content:space-between;
 ">
 <span>CAMBIO</span>
 <span>$${cambio}</span>
 </div>

 <hr>

 <div style="
 text-align:center;
 margin-top:12px;
 font-size:14px;
 ">

 Gracias por su compra 

 </div>

</div>
`;

if (negocio.nombre) {
 const separadorTicket =
 ticket.indexOf("<hr>");

 const desdeDetalle =
 separadorTicket >= 0
 ? ticket.slice(separadorTicket)
 : ticket;

 const anchoTicket =
 negocio.ticketAncho === "58" ? 230 : 300;

 const alineacionTicket =
 negocio.ticketAlineacion || "center";

 const logoTicket =
 negocio.logo && negocio.mostrarLogoTicket !== false
 ? `<img src="${negocio.logo}" style="width:58px;height:58px;object-fit:cover;border-radius:10px;margin-bottom:8px;">`
 : "";

 const nombreTicket =
 negocio.mostrarNombreTicket === false
 ? ""
 : `<h2 style="margin:0;font-size:22px;text-transform:uppercase;">${negocio.ticketNombre || negocio.nombre}</h2>`;

 const subtituloTicket =
 negocio.ticketSubtitulo
 ? `<div style="font-size:12px;">${negocio.ticketSubtitulo}</div>`
 : "";

 const direccionTicket =
 negocio.mostrarDireccionTicket === false || !negocio.direccion
 ? ""
 : `<div>${negocio.direccion}</div>`;

 const telefonoTicket =
 negocio.mostrarTelefonoTicket === false || !negocio.telefono
 ? ""
 : `<div>Tel. ${negocio.telefono}</div>`;

const cajeroTicket =
 negocio.mostrarCajeroTicket === false
 ? ""
 : `<div>Cajero: ${usuarioActual?.nombre || "Administrador"}</div>`;

 const folioPersonalizado =
 folioTicket
 ? `<div><strong>Folio ${folioTicket}</strong></div>`
 : "";

 ticket = `
 <div style="
 width:${anchoTicket}px;
 font-family:monospace;
 padding:20px;
 color:black;
 ">
 <div style="text-align:${alineacionTicket};margin-bottom:12px;">
 ${logoTicket}
 ${nombreTicket}
 ${subtituloTicket}
 ${direccionTicket}
 ${telefonoTicket}
 ${cajeroTicket}
 <div>${fecha}</div>
 ${folioPersonalizado}
 </div>
 ${desdeDetalle}
 `;
}

const mensajeTicket =
 negocio.mensajeTicket || "Gracias por su compra";

let extraTicket =
 `${mensajeTicket}
 ${negocio.notaTicket ? `<br><small>${negocio.notaTicket}</small>` : ""}
 ${negocio.mostrarBarcodeTicket ? `<div style="margin-top:10px;font-size:22px;letter-spacing:2px;">|||| ||| |||| || |||||</div>` : ""}
 <div style="margin-top:12px;font-size:9px;color:#999;">Con la tecnologia de Nexo POS</div>`;

if (ventaOffline) {
 extraTicket += `<br><small style="font-weight:bold;">PENDIENTE DE SINCRONIZAR</small>`;
}

ticket = ticket.replace(
 "Gracias por su compra",
 extraTicket
);

const ticketEnviado =
 await imprimirTicketPOS(ticket);

if (!ticketEnviado) {
 await alertaPOS(
 "La venta se registro, pero no se pudo abrir la impresion del ticket.",
 "Ticket no impreso",
 "alerta"
 );
}

if (ventaOffline) {
 await alertaPOS(
 "La venta quedo guardada en esta computadora y se sincronizara cuando vuelva el internet.",
 "Venta offline guardada",
 "exito"
 );
}

 const ventaDetalleId =
 ventaRegistrada?.historialId || ventaRegistrada?.ventaId || null;

 if (!ventaOffline && ventaDetalleId) {
  guardarUltimaVentaPOS({
   id: ventaDetalleId,
   folio: ventaRegistrada.folio,
   total,
   recibido: dinero,
   cambio,
   fecha: ventaRegistrada.fecha || new Date().toISOString()
  });
 }

 carrito = [];
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
 clienteVentaActual = null;
 metodoPagoSeleccionado = "efectivo";
 nivelPrecioActual = "mayoreo";

 actualizarCarrito();
 actualizarClientePOS();

 if (ventaOffline) {
  descontarInventarioLocalPOS(productosVenta);
 } else {
  intentarRefrescarNubePOS(() => cargarProductos(), "productos");
  intentarRefrescarNubePOS(() => cargarHistorial(), "historial");
 }

 if (
 document.getElementById("pantallaReportes")?.style.display !== "none" &&
 typeof cargarReportesVentas === "function"
 ) {
  intentarRefrescarNubePOS(() => cargarReportesVentas(), "reportes de ventas");
 }

 if (typeof window.refrescarCaja7Metodos === "function") {
  intentarRefrescarNubePOS(() => window.refrescarCaja7Metodos(), "caja");
  }

 if (!ventaOffline && ventaDetalleId) {
  mostrarAccionesVentaCompletadaPOS({
   id: ventaDetalleId,
   folio: ventaRegistrada.folio,
   total,
   recibido: dinero,
   cambio
  });
 }

 if (typeof enfocarBusquedaVentaRapida === "function") {
  enfocarBusquedaVentaRapida(true);
 }
}

async function cobrarCredito(total) {
 if (window.__cobrandoEnCursoPOS) return;

 window.__cobrandoEnCursoPOS = true;

 try {
 await cobrarCreditoInternoPOS(total);
 } finally {
 window.__cobrandoEnCursoPOS = false;
 }
}

async function cobrarCreditoInternoPOS(total) {
 if (!(await validarOperacionLicenciaNexoPOS("una venta a credito"))) return;

 const resumen =
 resumenCarritoPOS();

 total =
 resumen.total;

 if (carrito.length === 0 || total <= 0) {
 alert("Agrega productos al carrito.");
 return;
 }

 await intentarRefrescarNubePOS(() => cargarCreditos(), "clientes de credito");

 if (clientesCredito.length === 0) {
 alert("Primero registra un cliente de credito o conecta internet para cargar la lista.");
 return;
 }

 const clienteInicial =
 clienteVentaActual && Number(clienteVentaActual.id)
 ? clienteVentaActual
 : null;

 const opciones =
 clientesCredito.map(cliente => ({
 nombre: String(cliente.id),
 etiqueta: cliente.nombre,
 valor: String(cliente.id)
 }));

 const datos =
 clienteInicial
 ? {
 clienteId: String(clienteInicial.id),
 concepto: "Venta de productos"
 }
 :
 await abrirFormularioCredito({
 titulo: "Venta a credito",
 subtitulo: `Total ${dinero(total)}`,
 campos: [
 {
 nombre: "clienteId",
 etiqueta: "Cliente",
 tipo: "select",
 opciones,
 requerido: true
 },
 {
 nombre: "concepto",
 etiqueta: "Concepto",
 valor: "Venta de productos"
 }
 ]
 });

 if (!datos) return;

 const clienteId =
 Number(datos.clienteId);

 const clienteSeleccionado =
 clientesCredito.find(cliente => Number(cliente.id) === clienteId);

 const productos =
 productosCarritoAgrupados();

 let respuesta;
 let creditoRegistrado = null;
 let creditoOffline = false;
 const conceptoCredito =
 datos.concepto || "Venta de productos";

 try {
 respuesta =
 await fetch(
 `/creditos/clientes/${clienteId}/cargos`,
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 monto: total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos
 })
 }
 );
 } catch (error) {
 const offline =
 await registrarCreditoOfflineDesktopPOS({
 clienteId,
 clienteNombre: clienteSeleccionado?.nombre || "",
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos,
 errorConexion: error.message
 });

 if (offline.offlineDisponible && offline.ok) {
 creditoRegistrado = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 creditoOffline = true;
 } else {
 alert("No se pudo registrar la venta a credito");
 return;
 }
 }

 if (!creditoOffline && !respuesta.ok) {
 const offline =
 await registrarCreditoOfflineDesktopPOS({
 clienteId,
 clienteNombre: clienteSeleccionado?.nombre || "",
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos,
 errorServidor: respuesta.status
 });

 if (offline.offlineDisponible && offline.ok) {
 creditoRegistrado = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 creditoOffline = true;
 } else {
 alert("No se pudo registrar la venta a credito");
 return;
 }
 }

 if (!creditoRegistrado) {
 creditoRegistrado =
 await respuesta.json().catch(() => ({
 success: true
 }));
 }

 if (!creditoOffline) {
 await registrarEventoDesktopPOS(
 "credito_cargo_creado",
 "credito",
 creditoRegistrado.movimiento?.id || clienteId,
 {
 clienteId,
 clienteNombre: clienteSeleccionado?.nombre || "",
 movimientoId: creditoRegistrado.movimiento?.id || null,
 referencia: creditoRegistrado.movimiento?.referencia || null,
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos,
 fechaServidor: creditoRegistrado.movimiento?.fecha || null
 }
 );
 }

 const fechaCredito =
 new Date().toLocaleString("es-MX");

 let ticketCredito = `
 <div style="width:300px;font-family:monospace;padding:20px;color:black;">
 <div style="text-align:center;margin-bottom:12px;">
 <h2 style="margin:0;font-size:20px;">${(configuracionNegocio()?.ticketNombre || configuracionNegocio()?.nombre || "Ferreteria").toUpperCase()}</h2>
 <div>VENTA A CREDITO</div>
 ${creditoOffline ? `<div style="font-weight:bold;font-size:12px;">PENDIENTE DE SINCRONIZAR</div>` : ""}
 <div>${fechaCredito}</div>
 <div>Cliente: ${clienteSeleccionado?.nombre || "Cliente"}</div>
 </div>
 <hr>
 `;

 productos.forEach(producto => {
  ticketCredito += `
  <div style="display:flex;justify-content:space-between;margin:6px 0;">
  <span>${producto.nombre}<br><small>${formatearCantidad(producto.cantidad, producto.unidadVenta)} x ${dinero(producto.precio || 0)}</small></span>
  <span>${dinero(producto.importe || 0)}</span>
  </div>
  `;
 });

 ticketCredito += `
 <hr>
 ${
 resumen.descuento > 0
 ? `<div style="display:flex;justify-content:space-between;"><span>SUBTOTAL</span><span>${dinero(resumen.subtotal)}</span></div><div style="display:flex;justify-content:space-between;"><span>DESCUENTO</span><span>-${dinero(resumen.descuento)}</span></div>`
 : ""
 }
 <div style="display:flex;justify-content:space-between;font-weight:bold;">
 <span>TOTAL CREDITO</span>
 <span>${dinero(total)}</span>
 </div>
 <div style="text-align:center;margin-top:12px;font-size:13px;">
 Firma / recibido
 <br><br>
 ______________________
 </div>
 </div>
 `;

 await imprimirTicketPOS(ticketCredito, null, { abrirCajon: false });

 carrito = [];
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
 clienteVentaActual = null;
 metodoPagoSeleccionado = "efectivo";
 nivelPrecioActual = "mayoreo";
 actualizarCarrito();
 actualizarClientePOS();

 if (creditoOffline) {
 descontarInventarioLocalPOS(productos);
 } else {
 await intentarRefrescarNubePOS(() => cargarProductos(), "productos");
 await intentarRefrescarNubePOS(() => cargarCreditos(), "creditos");
 await intentarRefrescarNubePOS(() => cargarHistorial(), "historial");
 }

 await alertaPOS(
 creditoOffline
 ? `Credito guardado offline para ${clienteSeleccionado?.nombre || "el cliente"} por ${dinero(total)}. Se sincronizara al volver el internet.`
 : `Venta a credito registrada para ${clienteSeleccionado?.nombre || "el cliente"} por ${dinero(total)}.`,
 creditoOffline ? "Credito offline guardado" : "Credito guardado",
 "exito"
 );

 if (typeof mostrarPuntoVenta === "function") {
  mostrarPuntoVenta();
 }

 if (typeof enfocarBusquedaVentaRapida === "function") {
  enfocarBusquedaVentaRapida(true);
 }
}

// Ctrl+Shift+A: abrir el cajon del dinero a mano (sin vender), para cuando
// no tienen la llave fisica del cajon. Pide confirmacion primero -- Enter
// confirma, Escape cancela, igual que el resto de los dialogos del sistema.
let cajonManualEnProceso = false;

async function abrirCajonManualPOS() {
 if (cajonManualEnProceso) return;

 cajonManualEnProceso = true;

 try {
 const confirmado =
 await confirmarPOS("¿Abrir el cajon del dinero?", "Abrir cajon", "info");

 if (!confirmado) return;

 if (!window.nexoDesktop || typeof window.nexoDesktop.openCashDrawer !== "function") {
 await alertaPOS(
 "Esta funcion solo esta disponible en la app de escritorio de Nexo POS, conectada a la impresora del cajon.",
 "No disponible",
 "alerta"
 );
 return;
 }

 const negocio =
 configuracionNegocio() || {};

 try {
 await window.nexoDesktop.openCashDrawer({
 printerName: negocio.impresoraNombre || ""
 });
 } catch (error) {
 await alertaPOS(error.message || "No se pudo abrir el cajon.", "Error", "alerta");
 }
 } finally {
 cajonManualEnProceso = false;
 }
}

(function instalarAtajoAbrirCajonPOS() {
 if (window.__atajoAbrirCajonPOS) return;
 window.__atajoAbrirCajonPOS = true;

 document.addEventListener("keydown", event => {
 if (!event.ctrlKey || !event.shiftKey) return;
 if (String(event.key || "").toLowerCase() !== "a") return;

 event.preventDefault();
 abrirCajonManualPOS();
 });
})();

function procesarCodigoBarrasPos(codigoManual) {
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

 agregar(
 producto.id,
 producto.nombre,
 precioVentaProducto(producto),
 producto
 );

 input.value = "";
 buscarProductos();

 setTimeout(() => {
 document
 .getElementById("busqueda")
 ?.focus();
 }, 50);
}

function mostrarProductos(productos) {

 const contenedor =
 document.getElementById(
 "productos"
 );

 if (!contenedor) return;

 contenedor.innerHTML = "";

 const destacados =
 productos
 .slice()
 .sort((a, b) =>
 Number(b.stock || 0) -
 Number(a.stock || 0)
 )
 .slice(0, 8);

 destacados.forEach(producto => {
 const unidad =
 unidadProducto(producto);
 const codigo =
 producto.codigo || producto.codigo_barras || producto.codigoInterno || `PROD-${producto.id}`;

 contenedor.innerHTML += `

 <div class="producto">

 <div class="producto-icono">
 ${iconoProducto(producto.nombre)}
 </div>

 <h2 title="${escaparPOS(producto.nombre || "Producto")}">
 ${escaparPOS(producto.nombre || "Producto")}
 </h2>

 <span class="producto-codigo">${escaparPOS(codigo)}</span>

 <strong class="producto-precio">
 $${Number(producto.precio).toFixed(2)}
 </strong>

 <p class="producto-stock">
 Stock: ${escaparPOS(producto.stock)} ${escaparPOS(unidad)}
 </p>

 <button onclick="agregarProductoPorId(${Number(producto.id)})">
 Agregar
 </button>

 </div>
 `;
 });

 renderProductosFrecuentesPOS(destacados);
}

function filtrarProductosPOSCategoria(categoria = "") {
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

 const texto =
 normalizarTexto(categoria || "");

 const productos =
 !texto
 ? todosProductos
 : todosProductos.filter(producto =>
 normalizarTexto(producto.categoria || "").includes(texto) ||
 normalizarTexto(producto.subcategoria || "").includes(texto) ||
 normalizarTexto(producto.nombre || "").includes(texto)
 );

 mostrarProductos(productos.length ? productos : todosProductos);
}

function renderProductosFrecuentesPOS(productos = []) {
 const contenedor =
 document.getElementById("posFrecuentes");

 if (!contenedor) return;

 const frecuentes =
 productos.slice(0, 5);

 contenedor.innerHTML =
 frecuentes.length
 ? frecuentes.map(producto => `
 <button type="button" onclick="agregarProductoPorId(${Number(producto.id)})">
  ${iconoProducto(producto.nombre)}
  <span>${escaparPOS(producto.nombre || "Producto")}</span>
 </button>
 `).join("")
 : `<span class="pos-frequent-empty">Agrega productos para ver accesos rapidos.</span>`;
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

function agregarProductoPorId(id) {
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
 producto
 );
}

function agregar(
 id,
 nombre,
 precio,
 producto = {}
) {
 const unidad =
 unidadProducto(producto);

 const existente =
 carrito.find(item => Number(item.id) === Number(id));

 if (existente) {
 existente.cantidad =
 Number(existente.cantidad || 0) + pasoUnidad(unidad);
 } else {
 carrito.push({
 id,
 nombre,
 precio: Number(precio || 0),
 cantidad: pasoUnidad(unidad),
 codigo: producto.codigo || "",
 unidadVenta: unidad,
 proveedor: producto.proveedor || "",
 tipoProducto: producto.tipo_producto || producto.tipoProducto || "",
 basculaDigital: producto.bascula_digital || producto.basculaDigital || "no"
 });
 }

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

 const descuento =
 descuentoCarrito.tipo === "porcentaje"
 ? subtotal * Math.min(valorDescuento, 100) / 100
 : descuentoCarrito.tipo === "monto"
 ? Math.min(valorDescuento, subtotal)
 : 0;

 const total =
 Math.max(0, subtotal - descuento);

 return {
 subtotal,
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

 const contenedor =
 document.getElementById(
 "carrito"
 );

 if (!contenedor) return;

 contenedor.innerHTML = "";

 const resumen =
 resumenCarritoPOS();

 const total =
 resumen.total;

 let itemsHtml = "";

 if (carrito.length === 0) {
 itemsHtml = `
 <div class="carrito-vacio pos-cart-empty">
 <strong>Carrito vacio</strong>
 <span>Busca, escanea o agrega productos para iniciar una venta.</span>
 </div>
 `;
 }

 carrito.forEach((p, index) => {
 const unidad =
 p.unidadVenta || "pieza";

 const cantidad =
 Number(p.cantidad || 1);

 const importe =
 Number(p.precio || 0) * cantidad;

 const codigo =
 p.codigo || `PROD-${p.id}`;

 itemsHtml += `

 <article class="item-carrito pos-cart-item">

 <div class="item-carrito-info">
 <span class="item-icono">
 ${iconoProducto(p.nombre)}
 </span>

 <div>
 <strong>${p.nombre}</strong>
 <small>${escaparPOS(codigo)} - $${Number(p.precio).toFixed(2)} por ${unidad}</small>
 </div>
 </div>

 <div class="item-cantidad">
 <button onclick="quitarUnoCarrito(${p.id})">-</button>
 <input
 type="number"
 min="0"
 step="${esUnidadDecimal(unidad) ? "0.001" : "1"}"
 value="${cantidad}"
 onchange="cambiarCantidadCarrito(${index}, this.value)"
 >
 <button onclick="sumarCantidadCarrito(${index})">+</button>
 </div>

 <button type="button" class="pos-cart-remove" onclick="eliminar(${index})" aria-label="Quitar producto">
 x
 </button>

 ${p.basculaDigital === "preparado" || esUnidadDecimal(unidad) ? `
 <button class="btn-bascula" onclick="capturarPesoManual(${index})">
 Bascula / peso
 </button>
 ` : ""}

 <strong class="item-total">
 $${importe.toFixed(2)}
 </strong>

 </article>
 `;
 });

 contenedor.innerHTML = `

 <div class="carrito-items">
 ${itemsHtml}
 </div>

 <div class="resumen-cobro">

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

 <label class="campo-recibido">
 <span>Recibido</span>
 <input
 type="number"
 id="dinero"
 placeholder="0.00"
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
 Cobrar <span>F9</span>
 </button>

 <button class="btn-credito-carrito" onclick="cobrarCredito(${total})">
 Credito
 </button>

 <button class="btn-limpiar" onclick="limpiarCarrito()">
 Limpiar
 </button>
 </div>
 </div>
 `;

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
 importe: cantidad * precio
 };
 });
}

async function imprimirTicketPOS(ticket, configOverride = null) {
 try {
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

 if (!(await validarOperacionLicenciaNexoPOS("una venta"))) return;

 const resumen =
 resumenCarritoPOS();

 total =
 resumen.total;

 if (carrito.length === 0 || Number(total || 0) <= 0) {
 await alertaPOS("Agrega productos al carrito antes de cobrar.", "Carrito vacio", "alerta");
 return;
 }

 const dinero =
 Number(
 document.getElementById(
 "dinero"
 ).value || 0
 );

 if (dinero < total) {
 await alertaPOS(
 `Faltan ${(total - dinero).toFixed(2)} para completar la venta.`,
 "Dinero insuficiente",
 "alerta"
 );
 return;
 }

const cambio =
dinero - total;

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
 productos: productosVenta
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
 metodoPago: "efectivo",
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
 metodoPago: "efectivo",
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
 metodoPago: "efectivo",
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
 ${negocio.mostrarBarcodeTicket ? `<div style="margin-top:10px;font-size:22px;letter-spacing:2px;">|||| ||| |||| || |||||</div>` : ""}`;

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

 await imprimirTicketPOS(ticketCredito);

 carrito = [];
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
 clienteVentaActual = null;
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

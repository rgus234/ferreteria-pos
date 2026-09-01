/* Fase 2 - Flujo ferretero de producto y carrito */
(function instalarFlujoFerreteroPOS(){
 if (window.__flujoFerreteroPOSV2) return;
 window.__flujoFerreteroPOSV2 = true;

 const tipoInfo = {
  catalogo: ["Producto con codigo", "Escanea el codigo de barras o escribe la clave. Si existe en catalogos, se llena nombre, proveedor, marca y precios.", "Al encontrarlo, el cursor salta directo a Stock actual."],
  manual: ["Producto sin codigo", "Para articulos genericos o sueltos. El sistema genera un codigo interno automatico para venderlo y controlarlo.", "Ideal para escobas genericas, piezas sin etiqueta o producto local."],
  granel: ["Venta a granel", "Preparado para kilo, metro, litro o tramo. Al agregarlo al carrito, el sistema pregunta cuanto lleva y calcula el precio solo -- no hace falta bascula digital.", "Ideal para cable, clavos, manguera, cadena, tubo o liquidos."],
  servicio: ["Servicio", "Para mano de obra, cortes, ajustes, instalacion o cargos sin inventario fisico.", "Se cobra desde el POS sin depender de stock real."]
 };

 function seguro(texto) {
  return String(limpiarTextoUI(texto || ""))
   .replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");
 }

 function unidadNombre(unidad) {
  const mapa = {
   pieza: "pieza", metro: "metro", kg: "kg", kilo: "kg", gramo: "gramo", litro: "litro",
   caja: "caja", bolsa: "bolsa", paquete: "paquete", tramo: "tramo", rollo: "rollo",
   saco: "saco", bulto: "bulto", servicio: "servicio"
  };
  return mapa[String(unidad || "pieza").toLowerCase()] || String(unidad || "pieza");
 }

 function asegurarAyudaTipoProducto() {
  const selector = document.querySelector("#modalAgregar .tipo-producto-selector");
  if (!selector) return null;

  let ayuda = document.getElementById("ayudaTipoProductoPOS");
  if (!ayuda) {
   ayuda = document.createElement("div");
   ayuda.id = "ayudaTipoProductoPOS";
   ayuda.className = "producto-tipo-ayuda";
   selector.insertAdjacentElement("afterend", ayuda);
  }
  return ayuda;
 }

 function actualizarAyudaTipoProducto(tipo) {
  const ayuda = asegurarAyudaTipoProducto();
  if (!ayuda) return;

  const info = tipoInfo[tipo || "catalogo"] || tipoInfo.catalogo;
  ayuda.innerHTML =
   "<div><strong>" +
   seguro(info[0]) +
   "</strong><span>" +
   seguro(info[1]) +
   "</span></div><small>" +
   seguro(info[2]) +
   "</small>";
 }

 const seleccionarBase = window.seleccionarTipoProducto;
 window.seleccionarTipoProducto = function(tipo) {
  const tipoFinal = tipo || "catalogo";
  if (typeof seleccionarBase === "function") seleccionarBase(tipoFinal);

  actualizarAyudaTipoProducto(tipoFinal);

  const codigo = document.getElementById("nuevoCodigo");
  const stock = document.getElementById("nuevoStock");
  const unidad = document.getElementById("unidadVenta");
  const bascula = document.getElementById("basculaDigital");
  const precio = document.getElementById("nuevoPrecio");

  if (codigo) {
   codigo.autocomplete = "off";
   codigo.inputMode = tipoFinal === "catalogo" ? "numeric" : "text";
  }

  if (tipoFinal === "manual") {
   if (codigo && (!codigo.value || codigo.dataset.codigoAutomatico === "1")) {
    codigo.value = generarCodigoInternoProducto("manual", document.getElementById("nuevaCategoria")?.value || "");
    codigo.dataset.codigoAutomatico = "1";
   }
   if (stock && !stock.value) stock.value = "1";
  }

 if (tipoFinal === "granel") {
   if (unidad && !["kg", "metro", "litro", "gramo"].includes(unidad.value)) unidad.value = "kg";
   if (bascula) bascula.value = "preparado";
   if (stock) stock.step = "0.001";
   if (typeof actualizarAyudaPrecioProducto === "function") actualizarAyudaPrecioProducto();
  } else if (stock) {
   stock.step = esUnidadDecimal(unidad?.value) ? "0.001" : "1";
  }
 };

 const mostrarBase = window.mostrarFormularioAgregar;
 window.mostrarFormularioAgregar = function() {
  if (typeof mostrarBase === "function") mostrarBase();
  if (typeof asegurarEtiquetasFichaProducto === "function") {
   asegurarEtiquetasFichaProducto();
  }

  if (typeof togglePiezaCamposProducto === "function") togglePiezaCamposProducto();
  actualizarAyudaTipoProducto(document.getElementById("tipoProductoInventario")?.value || "catalogo");

  setTimeout(() => {
   const codigo = document.getElementById("nuevoCodigo");
   if (codigo && document.getElementById("modalAgregar")?.style.display !== "none") {
    codigo.focus();
    codigo.select();
   }
  }, 120);
 };

 const cerrarBase = window.cerrarFormularioAgregar;
 window.cerrarFormularioAgregar = function() {
  if (typeof cerrarBase === "function") cerrarBase();
  actualizarAyudaTipoProducto("catalogo");
 };

 window.aplicarCantidadRapidaCarrito = function(index, cantidad) {
  if (!carrito[index]) return;
  cambiarCantidadCarrito(index, cantidad);
 };

 function botonesCantidadRapidaFerretera(index, unidad) {
  if (!esUnidadDecimal(unidad)) return "";

  const unidadLimpia =
  String(unidad || "").toLowerCase();

  const opciones =
  unidadLimpia === "metro"
  ? [
   ["10 cm", 0.10],
   ["30 cm", 0.30],
   ["50 cm", 0.50],
   ["1 m", 1]
  ]
  : unidadLimpia === "litro"
  ? [
   ["250 ml", 0.25],
   ["500 ml", 0.50],
   ["1 L", 1]
  ]
  : [
   ["100 g", 0.10],
   ["250 g", 0.25],
   ["500 g", 0.50],
   ["1 kg", 1]
  ];

  return '<div class="cantidad-rapida">' +
  opciones.map(opcion =>
   '<button type="button" onclick="aplicarCantidadRapidaCarrito(' +
   index +
   ', ' +
   opcion[1] +
   ')">' +
   opcion[0] +
   "</button>"
  ).join("") +
  "</div>";
 }

 window.actualizarCarrito = function() {
  if (typeof renderCarritoReferenciaPOS === "function") {
   renderCarritoReferenciaPOS();
   if (typeof sincronizarHojaActivaVentaPOS === "function") sincronizarHojaActivaVentaPOS();
   return;
  }

  const contenedor = document.getElementById("carrito");
  if (!contenedor) return;

  const resumen = typeof resumenCarritoPOS === "function"
   ? resumenCarritoPOS()
   : { subtotal: carrito.reduce((suma, item) => suma + Number(item.precio || 0) * Number(item.cantidad || 0), 0), descuento: 0, total: 0, descuentoTipo: "ninguno", descuentoValor: 0 };
  if (!Number.isFinite(Number(resumen.total))) resumen.total = Math.max(0, Number(resumen.subtotal || 0) - Number(resumen.descuento || 0));
  const total = resumen.total;
  const itemsHtml = carrito.length === 0
   ? '<div class="carrito-vacio carrito-vacio-ferretero"><strong>Carrito vacio</strong><span>Escanea, busca o agrega productos para iniciar una venta.</span></div>'
   : carrito.map((p, index) => {
    const unidad = unidadNombre(p.unidadVenta || "pieza");
    const cantidad = Number(p.cantidad || 1);
    const importe = Number(p.precio || 0) * cantidad;
    const decimal = esUnidadDecimal(unidad);
    const botones = botonesCantidadRapidaFerretera(index, unidad);

    return '<article class="item-carrito item-carrito-ferretero"><div class="item-carrito-info"><span class="item-icono">' +
     iconoProducto(p.nombre) +
     '</span><div><strong>' +
     seguro(p.nombre) +
     "</strong><small>" +
     dinero(p.precio) +
     " por " +
     seguro(unidad) +
     (p.codigo ? " - " + seguro(p.codigo) : "") +
     '</small></div></div><div class="item-cantidad item-cantidad-ferretera"><button title="Quitar" onclick="quitarUnoCarrito(' +
     p.id +
     ')">-</button><input type="number" min="0" step="' +
     (decimal ? "0.001" : "1") +
     '" value="' +
     cantidad +
     '" onchange="cambiarCantidadCarrito(' +
     index +
     ', this.value)"><button title="Agregar" onclick="sumarCantidadCarrito(' +
     index +
     ')">+</button></div><div class="item-carrito-meta"><span>' +
     formatearCantidad(cantidad, unidad) +
     "</span><strong>" +
     dinero(importe) +
     "</strong></div>" +
     botones +
     (p.basculaDigital === "preparado" || decimal
      ? '<button class="btn-bascula" onclick="capturarPesoManual(' + index + ')">Corregir ' + seguro(unidad) + "</button>"
      : "") +
     "</article>";
   }).join("");

  contenedor.innerHTML =
   '<div class="carrito-shell-redisenado">' +
   '<section class="carrito-zona-productos"><div class="carrito-zona-head"><span>Venta actual</span><strong>' +
   carrito.length +
   ' articulos</strong></div><div class="carrito-items">' +
   itemsHtml +
   '</div></section>' +
   '<section class="resumen-cobro resumen-cobro-ferretero"><div class="resumen-cobro-head"><span>Cobro</span><strong>' +
   dinero(total) +
   '</strong></div><div class="resumen-linea"><span>Subtotal</span><strong>' +
   dinero(resumen.subtotal) +
   '</strong></div><div class="resumen-descuento"><label><span>Descuento</span><select onchange="actualizarDescuentoCarrito(this.value, document.getElementById(\'valorDescuentoCarrito\')?.value || 0)"><option value="ninguno" ' +
   (resumen.descuentoTipo === "ninguno" ? "selected" : "") +
   '>Sin descuento</option><option value="porcentaje" ' +
   (resumen.descuentoTipo === "porcentaje" ? "selected" : "") +
   '>Porcentaje</option><option value="monto" ' +
   (resumen.descuentoTipo === "monto" ? "selected" : "") +
   '>Monto</option></select></label><input id="valorDescuentoCarrito" type="number" min="0" step="0.01" value="' +
   (resumen.descuentoValor || "") +
   '" placeholder="0" onchange="actualizarDescuentoCarrito(document.querySelector(\'.resumen-descuento select\')?.value || \'ninguno\', this.value)"></div><div class="resumen-linea"><span>Descuento</span><strong>-' +
   dinero(resumen.descuento) +
   '</strong></div><div class="resumen-linea total-ferretero"><span>Total final</span><strong>' +
   dinero(total) +
   '</strong></div><label class="campo-recibido"><span>Recibido</span><input type="number" id="dinero" placeholder="0.00" oninput="calcularCambio(' +
   total +
   ')" onkeydown="cobrarConEnter(event, ' +
   total +
   ')"></label><div class="resumen-linea cambio-linea"><span>Cambio</span><strong id="cambioTexto">$0.00</strong></div><div class="carrito-acciones-cobro carrito-acciones-principales"><button class="btn-cobrar" onclick="cobrar(' +
   total +
   ')">Cobrar</button><button class="btn-credito-carrito" onclick="cobrarCredito(' +
   total +
   ')">Credito</button><button class="btn-limpiar" onclick="limpiarCarrito()">Limpiar</button></div></section>' +
   (typeof renderAccesoUltimaVentaPOS === "function" ? renderAccesoUltimaVentaPOS() : "") +
   "</div>";
 };

 document.addEventListener("change", event => {
  if (event.target?.id === "unidadVenta") {
   window.seleccionarTipoProducto(document.getElementById("tipoProductoInventario")?.value || "catalogo");
  }
 });

 setTimeout(() => {
  actualizarAyudaTipoProducto(document.getElementById("tipoProductoInventario")?.value || "catalogo");
  if (Array.isArray(carrito)) window.actualizarCarrito();
 }, 300);
})();

/* Fase 2 - Pedido inteligente ferretero */
(function instalarPedidoInteligenteFerretero(){
 if (window.__pedidoInteligenteFerreteroV2) return;
 window.__pedidoInteligenteFerreteroV2 = true;

 function textoSeguro(valor) {
  return String(typeof limpiarTextoUI === "function" ? limpiarTextoUI(valor || "") : (valor || ""))
   .replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");
 }

 function productosBajosParaPedido() {
  const base = typeof productosBajoStock === "function" ? productosBajoStock() : [];
  return base.map(producto => {
   const stock = Number(producto.stock || 0);
   const minimo = Number(producto.stock_minimo ?? producto.stockMinimo ?? 3);
   const objetivo = Math.max(minimo * 2, minimo + 5, 6);
   const sugerido = Math.max(1, Math.ceil(objetivo - stock));
   const proveedor = producto.proveedor || producto.proveedor_principal || producto.distribuidor || "Sin proveedor";
   return { ...producto, stock, minimo, objetivo, sugerido, proveedor };
  }).sort((a, b) => String(a.proveedor).localeCompare(String(b.proveedor)) || a.stock - b.stock);
 }

 function proveedoresBajos(lista) {
  return [...new Set(lista.map(item => item.proveedor || "Sin proveedor"))].sort((a, b) => a.localeCompare(b));
 }

 function renderPedidoInteligente(proveedorSeleccionado) {
  const contenedor = document.getElementById("listaSugerenciaPedido");
  if (!contenedor) return;

  const lista = productosBajosParaPedido();
  const proveedores = proveedoresBajos(lista);
  const proveedor = proveedorSeleccionado || proveedores[0] || "Todos";
  const filtrados = proveedor === "Todos" ? lista : lista.filter(item => item.proveedor === proveedor);
  const unidades = filtrados.reduce((suma, item) => suma + Number(item.sugerido || 0), 0);
  const sinStock = filtrados.filter(item => Number(item.stock || 0) <= 0).length;

  if (!lista.length) {
   contenedor.innerHTML = '<div class="pedido-empty"><strong>Inventario saludable</strong><span>No hay productos debajo del minimo.</span></div>';
   return;
  }

  const opciones = ['<option value="Todos">Todos los proveedores</option>']
   .concat(proveedores.map(nombre => '<option value="' + textoSeguro(nombre) + '"' + (nombre === proveedor ? " selected" : "") + '>' + textoSeguro(nombre) + '</option>'))
   .join("");

  const filas = filtrados.map(item => {
   const unidad = typeof unidadProducto === "function" ? unidadProducto(item) : (item.unidadVenta || "pieza");
   const estado = item.stock <= 0 ? "Sin existencia" : "Bajo minimo";
   const prioridad = item.stock <= 0 ? "alta" : "media";
   return '<tr><td><strong>' + textoSeguro(item.nombre || "Producto") + '</strong><small>' + textoSeguro(item.categoria || item.marca || "Ferreteria") + '</small></td><td>' +
    textoSeguro(item.codigo || item.codigo_interno || "Sin codigo") + '</td><td>' +
    textoSeguro(item.proveedor || "Sin proveedor") + '</td><td>' +
    textoSeguro(item.stock) + ' ' + textoSeguro(unidad) + '</td><td>' +
    textoSeguro(item.minimo) + '</td><td><b>' +
    textoSeguro(item.sugerido) + ' ' + textoSeguro(unidad) + '</b></td><td><span class="pedido-prioridad ' + prioridad + '">' + estado + '</span></td></tr>';
  }).join("");

  contenedor.innerHTML =
   '<div class="pedido-control"><label>Distribuidor<select id="pedidoProveedorFiltro" onchange="renderPedidoInteligenteFerretero(this.value)">' +
   opciones +
   '</select></label><div class="pedido-kpis"><div><span>Productos</span><strong>' + filtrados.length + '</strong></div><div><span>Sin stock</span><strong>' + sinStock + '</strong></div><div><span>Piezas sugeridas</span><strong>' + unidades + '</strong></div></div></div>' +
   '<div class="pedido-tabla-wrap"><table class="pedido-tabla"><thead><tr><th>Producto</th><th>Codigo</th><th>Proveedor</th><th>Actual</th><th>Minimo</th><th>Pedir</th><th>Prioridad</th></tr></thead><tbody>' +
   filas +
   '</tbody></table></div>';
 }

 window.renderPedidoInteligenteFerretero = renderPedidoInteligente;

 window.generarSugerenciaPedido = function() {
  const lista = productosBajosParaPedido();
  if (!lista.length) {
   alertaPOS("Inventario saludable", "No hay productos por debajo del stock minimo.", "info");
   return;
  }
  renderPedidoInteligente("Todos");
  const modal = document.getElementById("modalSugerenciaPedido");
  if (modal) modal.style.display = "flex";
 };

 const cerrarBase = window.cerrarSugerenciaPedido;
 window.cerrarSugerenciaPedido = function() {
  const modal = document.getElementById("modalSugerenciaPedido");
  if (modal) modal.style.display = "none";
  if (typeof cerrarBase === "function") {
   try { cerrarBase(); } catch (error) { console.warn(error); }
  }
 };

 function cerrarOverlaysOperativos() {
  document.getElementById("modalCategoriaProductos")?.style && (document.getElementById("modalCategoriaProductos").style.display = "none");
  document.getElementById("modalSugerenciaPedido")?.style && (document.getElementById("modalSugerenciaPedido").style.display = "none");
  document.getElementById("modalRecordatorioPOS")?.style && (document.getElementById("modalRecordatorioPOS").style.display = "none");
 }

 ["mostrarInicio", "mostrarPuntoVenta", "mostrarInventario", "mostrarInventarioBajo", "mostrarGraficas", "mostrarClientes", "mostrarProveedores", "mostrarCatalogo", "mostrarConfiguracion"].forEach(nombre => {
  const original = window[nombre];
  if (typeof original !== "function" || original.__cierraOverlaysFerreteria) return;
  const envuelta = function(...args) {
   cerrarOverlaysOperativos();
   return original.apply(this, args);
  };
  envuelta.__cierraOverlaysFerreteria = true;
  window[nombre] = envuelta;
 });
})();

/* Fase 3 - Recepcion inteligente de mercancia */
(function instalarRecepcionInteligenteMercancia(){
 if (window.__recepcionMercanciaV1) return;
 window.__recepcionMercanciaV1 = true;

  const estadoRecepcion = {
   archivo: null,
   proveedor: "",
   documento: {
    tipo: "Factura",
    folio: "",
    fecha: "",
    subtotal: 0,
    iva: 0,
    total: 0
   },
   conceptos: [],
   busqueda: "",
   filtroCategoria: "",
   soloDiferencias: false,
   pagina: 1,
   tamanoPagina: 5
  };

 function textoSeguro(valor) {
  return String(typeof limpiarTextoUI === "function" ? limpiarTextoUI(valor || "") : (valor || ""))
   .replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");
 }

 function numero(valor) {
  const n = Number(String(valor ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
 }

 function codigoLimpio(valor) {
  if (typeof normalizarCodigo === "function") return normalizarCodigo(valor);
  return String(valor || "").replace(/[^a-zA-Z0-9]/g, "").trim();
 }

 function productoId(producto) {
  return codigoLimpio(producto?.codigo || producto?.codigo_interno || producto?.id || "");
 }

 // No existe ninguna bandera en la base que diga "este codigo es
 // provisional" -- un EAN/UPC real siempre es puramente numerico y de
 // 8, 12, 13 o 14 digitos; las claves internas de los proveedores (Truper,
 // Diprofer, etc) son mas cortas o traen letras.
 function codigoPareceBarraReal(codigo) {
  return /^\d{8}$|^\d{12,14}$/.test(String(codigo || "").trim());
 }

 let filaEscaneoSeleccionadaIndice = null;

 // Escaneo unificado de recepcion (ver plan stateless-doodling-tarjan.md):
 // un solo cuadro que confirma que un producto llego fisicamente Y, de
 // paso, le asigna su codigo de barras real si todavia no lo tenia --
 // antes eran 2 pasos sueltos (una pantalla de codigo de barras que
 // corria DESPUES de confirmar la recepcion, ya guardado en inventario,
 // sin relacion con "esto ya llego"). Corre ANTES de confirmar, mientras
 // se revisa contra la factura.
 window.escanearProductoRecepcion = function(codigoCrudo) {
  const codigo = codigoLimpio(codigoCrudo);

  if (!codigo || codigo.length < 4) {
   if (typeof mostrarToastPOS === "function") mostrarToastPOS("El codigo escaneado parece muy corto, intenta de nuevo.", { tipo: "alerta" });
   return;
  }

  const conceptos = estadoRecepcion.conceptos || [];
  if (!conceptos.length) return;

  // 1. El codigo escaneado coincide con el que ya trae la fila (el de la
  // factura, o el ya guardado si es un producto existente) -- confirma
  // esa fila sin tocar su codigo. Cubre el caso comun: la mayoria de
  // productos ya trae su codigo real bien leido del XML/CSV.
  const porCoincidencia = conceptos.findIndex(item => {
   const producto = buscarProductoConcepto(item);
   return codigoLimpio(item.codigo) === codigo || (producto && codigoLimpio(producto.codigo) === codigo);
  });

  if (porCoincidencia !== -1) {
   conceptos[porCoincidencia].confirmado = true;
   filaEscaneoSeleccionadaIndice = null;
   renderRecepcionMercancia();
   return;
  }

  // 2. No coincide con ninguna -- se asume que es el codigo real de la
  // fila seleccionada (clic en una fila la selecciona) o, si no hay
  // seleccion, de la primera fila que sigue sin confirmar.
  let indiceDestino = filaEscaneoSeleccionadaIndice;
  if (indiceDestino === null || !conceptos[indiceDestino] || conceptos[indiceDestino].confirmado) {
   indiceDestino = conceptos.findIndex(item => !item.confirmado);
  }

  if (indiceDestino === -1 || indiceDestino === null) {
   if (typeof mostrarToastPOS === "function") mostrarToastPOS("Este codigo no corresponde a ningun producto de esta recepcion.", { tipo: "alerta" });
   return;
  }

  conceptos[indiceDestino].codigo = codigo;
  conceptos[indiceDestino].confirmado = true;
  filaEscaneoSeleccionadaIndice = null;
  renderRecepcionMercancia();
 };

 // Clic en una fila la marca como el destino del proximo escaneo que no
 // coincida con nada -- para escanear codeless fuera del orden en que
 // aparecen en la tabla. Clic de nuevo sobre la misma fila la deselecciona.
 window.seleccionarFilaEscaneoRecepcion = function(index) {
  filaEscaneoSeleccionadaIndice = filaEscaneoSeleccionadaIndice === index ? null : index;
  renderRecepcionMercancia();
  document.getElementById("recepcionEscaneoInput")?.focus();
 };

 // Confirmar a mano, para lo que llega a granel/suelto sin codigo fisico
 // que escanear (tornillos, clavos...).
 window.alternarConfirmadoRecepcion = function(index, event) {
  if (event) event.stopPropagation();
  if (!estadoRecepcion.conceptos[index]) return;
  estadoRecepcion.conceptos[index].confirmado = !estadoRecepcion.conceptos[index].confirmado;
  renderRecepcionMercancia();
 };

 function renderPanelEscaneoRecepcion() {
  const panel = document.getElementById("recepcionPanelEscaneo");
  if (!panel) return;

  const conceptos = estadoRecepcion.conceptos || [];
  if (!conceptos.length) {
   panel.style.display = "none";
   return;
  }
  panel.style.display = "block";

  const confirmados = conceptos.filter(c => c.confirmado).length;
  const contador = document.getElementById("recepcionEscaneoContador");
  if (contador) contador.textContent = confirmados + " de " + conceptos.length + " confirmados";

  const input = document.getElementById("recepcionEscaneoInput");
  if (input) {
   input.focus();
   input.onkeydown = event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const codigo = input.value;
    input.value = "";
    escanearProductoRecepcion(codigo);
   };
  }
 }

 function asegurarPantallaRecepcion() {
  let pantalla = document.getElementById("pantallaRecepcionMercancia");
  if (pantalla) return pantalla;

  const main = document.querySelector("main.contenido") || document.getElementById("sistema");
  pantalla = document.createElement("section");
  pantalla.id = "pantallaRecepcionMercancia";
  pantalla.style.display = "none";
  pantalla.innerHTML = `
   <div class="recepcion-shell">
    <div class="recepcion-header">
     <div class="recepcion-header-texto">
      <span class="recepcion-header-icono">${typeof iconoUISVG === "function" ? iconoUISVG("cart") : ""}</span>
      <p>Sube tu factura o remision (XML CFDI o CSV) para comparar contra tu inventario.</p>
     </div>
     <button type="button" class="btn-recepcion-historial" onclick="abrirHistorialRecepciones()">${typeof iconoUISVG === "function" ? iconoUISVG("clock") : ""} Ver historial</button>
    </div>

    <div class="recepcion-grid">
     <div class="recepcion-columna-principal">
      <section class="recepcion-panel recepcion-escaneo" id="recepcionPanelEscaneo" style="display:none;">
       <div class="recepcion-escaneo-header">
        <h3>Confirmar por escaneo <span class="recepcion-contador" id="recepcionEscaneoContador">0 de 0 confirmados</span></h3>
        <p>Escanea cada producto conforme va llegando. Si el codigo no coincide con ninguna fila, se asigna a la fila seleccionada (o a la primera pendiente) y queda confirmada de una vez.</p>
       </div>
       <input type="text" id="recepcionEscaneoInput" placeholder="Escanea aqui o teclea y presiona Enter" autocomplete="off">
      </section>

      <section class="recepcion-panel recepcion-carga">
       <h3>Informacion del documento</h3>
       <div class="recepcion-form">
        <label>Proveedor
         <input id="recepcionProveedor" placeholder="Ej. Truper, Diprofer, proveedor local" oninput="estadoRecepcionProveedor(this.value)">
        </label>
        <label>Folio / factura
         <input id="recepcionFolio" placeholder="Ej. A1143646" oninput="estadoRecepcionDocumento('folio', this.value)">
        </label>
        <label>Fecha del documento
         <input id="recepcionFecha" type="date" onchange="estadoRecepcionDocumento('fecha', this.value)">
        </label>
        <label>Tipo de documento
         <select id="recepcionTipoDocumento" onchange="estadoRecepcionDocumento('tipo', this.value)">
          <option value="Factura">Factura</option>
          <option value="Remision">Remision</option>
          <option value="Nota de credito">Nota de credito</option>
          <option value="Otro">Otro</option>
         </select>
        </label>
        <label>Categoria para productos nuevos
         <input id="recepcionCategoriaDefault" placeholder="Ej. Electricos, Tornilleria, Plomeria">
        </label>
        <label class="recepcion-form-archivo">Archivo
         <label class="recepcion-drop-compacto">
          <input id="archivoRecepcionMercancia" type="file" accept=".xml,.csv,.txt,.xlsx,.xls,.pdf" onchange="leerArchivoRecepcionMercancia(this.files[0])">
          <span class="recepcion-drop-icono">${typeof iconoUISVG === "function" ? iconoUISVG("file") : ""}</span>
          <span id="recepcionArchivoNombre">Seleccionar archivo</span>
         </label>
        </label>
       </div>
       <p class="recepcion-ayuda">XML CFDI, CSV o Excel. <a href="javascript:void(0)" onclick="verEjemploArchivoRecepcion()">Ver ejemplo de archivo</a></p>
      </section>

      <section class="recepcion-panel recepcion-preview">
       <div class="recepcion-preview-head">
        <div>
         <h3>Productos por recibir <span class="recepcion-contador" id="recepcionContador">0 productos</span></h3>
         <p>Si encuentra codigo o nombre, suma stock. Si no existe, prepara el producto para crearlo.</p>
        </div>
       </div>
       <div class="recepcion-toolbar">
        <div class="buscador-con-limpiar recepcion-buscador">
         <input id="recepcionBuscar" type="text" placeholder="Buscar producto, codigo o referencia..." oninput="buscarConceptosRecepcion(this.value)">
        </div>
        <label class="inventario-filtro-campo">
         <span>Categoria</span>
         <select id="recepcionFiltroCategoria" onchange="filtrarCategoriaRecepcion(this.value)">
          <option value="">Todas</option>
         </select>
        </label>
        <button type="button" id="recepcionBotonDiferencias" class="btn-recepcion-diferencias" onclick="toggleSoloDiferenciasRecepcion()">Solo diferencias</button>
       </div>
       <div id="tablaRecepcionMercancia" class="recepcion-tabla-wrap">
        <div class="recepcion-empty">Carga un XML CFDI o CSV para comenzar.</div>
       </div>
       <div class="recepcion-paginacion-footer">
        <span id="recepcionPaginacionTexto"></span>
        <div id="paginacionRecepcion" class="paginacion-tabla"></div>
       </div>
      </section>
     </div>

     <aside class="recepcion-panel recepcion-resumen-lateral">
      <h3>Resumen</h3>
      <div class="recepcion-kpis">
       <div><span>Productos</span><strong id="recepcionTotalProductos">0</strong></div>
       <div><span>Conceptos</span><strong id="recepcionTotalConceptos">0</strong></div>
       <div><span>Existentes</span><strong id="recepcionExistentes">0</strong></div>
       <div><span>Nuevos</span><strong id="recepcionNuevos">0</strong></div>
       <div><span>Subtotal</span><strong id="recepcionSubtotal">$0.00</strong></div>
       <div><span>IVA</span><strong id="recepcionIva">$0.00</strong></div>
      </div>
      <div class="recepcion-total-final">
       <span>Total</span>
       <strong id="recepcionImporte">$0.00</strong>
      </div>
      <p class="recepcion-documento-resumen" id="recepcionDocumentoResumen">Sin documento cargado</p>
      <p class="recepcion-diferencias-banner" id="recepcionDiferenciasBanner">0 diferencias detectadas</p>
      <div class="recepcion-acciones">
       <button type="button" class="btn-recepcion-confirmar" onclick="confirmarRecepcionMercancia()">Confirmar recepcion</button>
       <button type="button" class="btn-recepcion-secundario" onclick="limpiarRecepcionMercancia()">Cancelar</button>
      </div>
      <p class="recepcion-nota-final">El inventario se actualiza al confirmar. <a href="javascript:void(0)" onclick="imprimirResumenRecepcion()">Imprimir resumen</a></p>
     </aside>
    </div>
   </div>
  `;
  main.appendChild(pantalla);
  return pantalla;
 }

 function instalarBotonRecepcion() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || sidebar.querySelector('[data-modulo="recepcion"]')) return;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.dataset.modulo = "recepcion";
  boton.setAttribute("onclick", "mostrarRecepcionMercancia()");
  boton.innerHTML = (typeof iconoUISVG === "function" ? iconoUISVG("truck") : "") + "<span>Recepcion</span>";

  const catalogo = [...sidebar.querySelectorAll("button")].find(btn => /Catalogo proveedor/i.test(btn.textContent || ""));
  if (catalogo) catalogo.insertAdjacentElement("beforebegin", boton);
  else sidebar.appendChild(boton);
 }

 function ocultarTodoRecepcion() {
  if (typeof ocultarPantallasPrincipales === "function") {
   ocultarPantallasPrincipales();
   return;
  }
  [
   "pantallaInicio", "pantallaPuntoVenta", "pantallaInventario", "pantallaCategoriasInventario",
   "pantallaCatalogo", "pantallaClientes", "pantallaCreditos", "pantallaProveedores", "pantallaInventarioBajo",
   "pantallaReportes", "pantallaConfiguracion", "pantallaRecepcionMercancia",
   "pantallaPedidosProveedor", "pantallaAjustesInventario", "pantallaCaja", "pantallaFinanzas"
  ].forEach(id => {
   const el = document.getElementById(id);
   if (el) el.style.display = "none";
  });
  document.getElementById("modalCategoriaProductos")?.style && (document.getElementById("modalCategoriaProductos").style.display = "none");
  document.getElementById("modalSugerenciaPedido")?.style && (document.getElementById("modalSugerenciaPedido").style.display = "none");
 }

 window.mostrarRecepcionMercancia = async function() {
  if (estadoLicenciaNexoPOS?.plan === "basico") {
   if (typeof alertaPOS === "function") {
    alertaPOS("La recepcion de mercancia por factura XML/CSV esta disponible desde el plan Plus.", "Funcion no incluida", "info");
   }
   return;
  }
  asegurarPantallaRecepcion();
  instalarBotonRecepcion();
  ocultarTodoRecepcion();
  const pantalla = document.getElementById("pantallaRecepcionMercancia");
  if (pantalla) pantalla.style.display = "block";
  if (typeof actualizarModuloActivoPOS === "function") actualizarModuloActivoPOS("recepcion");
  if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Recepcion de mercancia", "Entrada de compras, XML CFDI y actualizacion de inventario", "recepcion");
  if (!Array.isArray(todosProductos) || !todosProductos.length) {
   try { await cargarProductos(); } catch (error) { console.warn(error); }
  }
  renderRecepcionMercancia();
 };

  window.estadoRecepcionProveedor = function(valor) {
   estadoRecepcion.proveedor = valor || "";
   renderRecepcionMercancia();
  };

  window.estadoRecepcionDocumento = function(campo, valor) {
   estadoRecepcion.documento[campo] = campo === "subtotal" || campo === "iva" || campo === "total" ? numero(valor) : (valor || "");
   renderRecepcionMercancia();
  };

  function aplicarDocumentoRecepcion(datos = {}) {
   estadoRecepcion.documento = {
    ...estadoRecepcion.documento,
    ...datos
   };
   const folio = document.getElementById("recepcionFolio");
   const fecha = document.getElementById("recepcionFecha");
   if (folio && datos.folio !== undefined) folio.value = datos.folio || "";
   if (fecha && datos.fecha !== undefined) fecha.value = datos.fecha || "";
  }

  window.leerArchivoRecepcionMercancia = async function(archivo) {
  if (!archivo) return;
  if (estadoLicenciaNexoPOS?.plan === "basico") return;
  estadoRecepcion.archivo = archivo;
  const nombre = document.getElementById("recepcionArchivoNombre");
  if (nombre) nombre.textContent = archivo.name;

   const extension = archivo.name.toLowerCase().split(".").pop();
   if (extension === "pdf") {
    alertaPOS("PDF detectado", "Para aplicar inventario usa el XML CFDI de la factura o exporta la tabla a CSV. El PDF servira como referencia visual en la siguiente fase.", "info");
    estadoRecepcion.conceptos = [];
    renderRecepcionMercancia();
    return;
   }

   if (["xlsx", "xls"].includes(extension)) {
    alertaPOS("Excel detectado", "Por ahora exportalo como CSV para lectura directa. Despues agregaremos lector XLSX directo.", "info");
    estadoRecepcion.conceptos = [];
    renderRecepcionMercancia();
    return;
  }

  const texto = await archivo.text();
  try {
   const resultado = extension === "xml" ? parsearFacturaXmlCfdi(texto) : parsearFacturaCsv(texto);

   if (resultado.documento.proveedor && !estadoRecepcion.proveedor) {
    estadoRecepcion.proveedor = resultado.documento.proveedor;
    const input = document.getElementById("recepcionProveedor");
    if (input) input.value = resultado.documento.proveedor;
   }
   aplicarDocumentoRecepcion(resultado.documento);

   // confirmado:false por default -- toda fila arranca sin confirmar
   // fisicamente hasta que se escanea o se marca a mano (ver Confirmar
   // por escaneo).
   estadoRecepcion.conceptos = resultado.conceptos.map(concepto => ({ ...concepto, confirmado: false }));
   if (!estadoRecepcion.conceptos.length) throw new Error("Sin conceptos");
   renderRecepcionMercancia();
   alertaPOS("Archivo analizado", "Revisa la vista previa antes de confirmar inventario.", "success");
   precargarPreciosSugeridosRecepcion();
  } catch (error) {
   console.error(error);
   estadoRecepcion.conceptos = [];
   renderRecepcionMercancia();
   alertaPOS("No se pudo leer", "El archivo no tiene estructura reconocible para esta recepcion.", "error");
  }
 };

 function buscarProductoConcepto(concepto) {
  const codigo = codigoLimpio(concepto.codigo);
  const nombre = String(concepto.descripcion || "").toLowerCase();
  return (todosProductos || []).find(p => {
   const codigos = [p.codigo, p.codigo_interno, ...(Array.isArray(p.codigos_relacionados) ? p.codigos_relacionados.map(c => c.codigo) : [])].map(codigoLimpio).filter(Boolean);
   return (codigo && codigos.includes(codigo)) || (nombre && String(p.nombre || "").toLowerCase() === nombre);
  }) || null;
 }

 // Precios de venta sugeridos para productos NUEVOS (los EXISTENTES no
 // necesitan esto -- renderRecepcionMercancia ya lee su precio actual
 // directo de "producto", sin red). Busca cada codigo nuevo contra el
 // catalogo de proveedor ya importado, en paralelo, y deja el resultado
 // escrito en el concepto crudo (estadoRecepcion.conceptos[i]) para que
 // sobreviva los re-renders (conceptosPreparados() lo copia con
 // spread cada vez). Fire-and-forget desde leerArchivoRecepcionMercancia:
 // la tabla ya se ve con el costo de la factura de inmediato, los 3
 // precios de venta se rellenan solos en cuanto responde el catalogo.
 async function precargarPreciosSugeridosRecepcion() {
  const pendientes = estadoRecepcion.conceptos.filter(c =>
   c.codigo && c.precioDistribuidorNuevo === undefined && !buscarProductoConcepto(c)
  );
  if (!pendientes.length) return;

  await Promise.all(pendientes.map(async concepto => {
   let catalogo = null;
   try {
    const respuesta = await fetch(`/catalogo-proveedor/buscar-codigo?codigo=${encodeURIComponent(concepto.codigo)}`);
    const datos = await respuesta.json();
    if (datos.ok && datos.producto) catalogo = datos.producto;
   } catch (error) {
    console.warn("No se pudo consultar el catalogo de proveedor para " + concepto.codigo, error);
   }

   const medioMayoreo = Number(catalogo?.medioMayoreo) > 0 ? Number(catalogo.medioMayoreo) : null;
   const distribuidor = Number(catalogo?.distribuidor) > 0 ? Number(catalogo.distribuidor) : Number(concepto.costo || 0);
   const publico = Number(catalogo?.publico) > 0 ? Number(catalogo.publico) : (medioMayoreo || Number(concepto.costo || 0));

   concepto.precioDistribuidorNuevo = distribuidor;
   concepto.precioMayoreoNuevo = medioMayoreo;
   concepto.precioPublicoNuevo = publico;
  }));

  renderRecepcionMercancia();
 }

 function conceptosPreparados() {
  return estadoRecepcion.conceptos.map(concepto => {
   const producto = buscarProductoConcepto(concepto);
   const precioActual = Number(producto?.precio_distribuidor || producto?.precio || 0);
   const costoNuevo = Number(concepto.costo || 0);
   const difiereCosto = Boolean(producto) && precioActual > 0 && Math.abs(costoNuevo - precioActual) >= 0.01;
   return {
    ...concepto,
    producto,
    existe: Boolean(producto),
    proveedor: estadoRecepcion.proveedor || producto?.proveedor || "",
    categoria: producto?.categoria || "",
    precioAnterior: precioActual,
    diferenciaPrecio: difiereCosto ? costoNuevo - precioActual : 0,
    tieneDiferencia: difiereCosto
   };
  });
 }

 // Recibe "lista" ya calculada en vez de llamar conceptosPreparados() por
 // su cuenta -- ese doble llamado (uno aqui, otro en renderRecepcionMercancia)
 // creaba 2 arreglos de objetos DISTINTOS por referencia (conceptosPreparados
 // arma copias nuevas con spread en cada llamada). Bug real preexistente
 // encontrado al construir "Confirmar por escaneo": lista.indexOf(item) en
 // renderRecepcionMercancia SIEMPRE daba -1 porque item nunca era el mismo
 // objeto que el de "lista" -- indiceReal era -1 en cada fila, asi que
 // editarConceptoRecepcion(-1, ...) nunca editaba nada de verdad (el guard
 // `if (!estadoRecepcion.conceptos[index]) return` lo paraba en silencio).
 function conceptosFiltrados(lista) {
  const texto = String(estadoRecepcion.busqueda || "").toLowerCase().trim();
  const categoria = estadoRecepcion.filtroCategoria || "";
  return lista.filter(item => {
   if (estadoRecepcion.soloDiferencias && !item.tieneDiferencia) return false;
   if (categoria && item.categoria !== categoria) return false;
   if (!texto) return true;
   return String(item.descripcion || "").toLowerCase().includes(texto) ||
    String(item.codigo || "").toLowerCase().includes(texto) ||
    String(item.producto?.codigo || "").toLowerCase().includes(texto);
  });
 }

 window.buscarConceptosRecepcion = function(valor) {
  estadoRecepcion.busqueda = valor || "";
  estadoRecepcion.pagina = 1;
  renderRecepcionMercancia();
 };

 window.filtrarCategoriaRecepcion = function(valor) {
  estadoRecepcion.filtroCategoria = valor || "";
  estadoRecepcion.pagina = 1;
  renderRecepcionMercancia();
 };

 window.toggleSoloDiferenciasRecepcion = function() {
  estadoRecepcion.soloDiferencias = !estadoRecepcion.soloDiferencias;
  estadoRecepcion.pagina = 1;
  renderRecepcionMercancia();
 };

 window.cambiarPaginaRecepcion = function(pagina) {
  estadoRecepcion.pagina = pagina;
  renderRecepcionMercancia();
 };

 window.verEjemploArchivoRecepcion = function() {
  alertaPOS(
   "XML CFDI: usa el archivo tal como lo entrega el proveedor.\n\nCSV: primera fila con encabezados, por ejemplo Codigo, Descripcion, Cantidad, Costo, Importe, Unidad, Folio, Fecha, Proveedor. No es necesario incluir todas las columnas; el sistema detecta las que existan.",
   "Formato de archivo esperado",
   "info"
  );
 };

 window.imprimirResumenRecepcion = function() {
  window.print();
 };

 function poblarFiltroCategoriaRecepcion(lista) {
  const select = document.getElementById("recepcionFiltroCategoria");
  if (!select) return;
  const categorias = [...new Set(lista.map(i => i.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const actual = estadoRecepcion.filtroCategoria || "";
  select.innerHTML = '<option value="">Todas</option>' + categorias.map(c => '<option value="' + textoSeguro(c) + '"' + (c === actual ? " selected" : "") + '>' + textoSeguro(c) + "</option>").join("");
 }

 window.renderRecepcionMercancia = function() {
  asegurarPantallaRecepcion();
  renderPanelEscaneoRecepcion();
  const contenedor = document.getElementById("tablaRecepcionMercancia");
  if (!contenedor) return;

  const lista = conceptosPreparados();
  const existentes = lista.filter(i => i.existe).length;
  const nuevos = lista.length - existentes;
  const conDiferencia = lista.filter(i => i.tieneDiferencia).length;
   const importe = lista.reduce((sum, i) => sum + (Number(i.importe || 0) || Number(i.costo || 0) * Number(i.cantidad || 0)), 0);
   const subtotal = Number(estadoRecepcion.documento.subtotal || 0) || importe;
   const iva = Number(estadoRecepcion.documento.iva || 0);
   const total = Number(estadoRecepcion.documento.total || 0) || (subtotal + iva);
   const formatoDinero = valor => typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2);

  const setText = (id, valor) => {
   const el = document.getElementById(id);
   if (el) el.textContent = valor;
  };
  setText("recepcionTotalProductos", lista.length);
  setText("recepcionTotalConceptos", lista.length);
  setText("recepcionExistentes", existentes);
  setText("recepcionNuevos", nuevos);
   setText("recepcionSubtotal", formatoDinero(subtotal));
   setText("recepcionIva", formatoDinero(iva));
   setText("recepcionImporte", formatoDinero(total));
   setText("recepcionDocumentoResumen", [
    estadoRecepcion.documento.tipo || "Documento",
    estadoRecepcion.documento.folio ? "Folio " + estadoRecepcion.documento.folio : "",
    estadoRecepcion.documento.fecha || "",
    estadoRecepcion.proveedor || ""
   ].filter(Boolean).join(" · ") || "Sin documento cargado");

  const banner = document.getElementById("recepcionDiferenciasBanner");
  if (banner) {
   banner.classList.toggle("con-diferencias", conDiferencia > 0);
   banner.textContent = conDiferencia > 0
    ? conDiferencia + " diferencia" + (conDiferencia === 1 ? "" : "s") + " de precio detectada" + (conDiferencia === 1 ? "" : "s")
    : "0 diferencias detectadas";
  }

  const botonDiferencias = document.getElementById("recepcionBotonDiferencias");
  if (botonDiferencias) botonDiferencias.classList.toggle("activo", Boolean(estadoRecepcion.soloDiferencias));

  poblarFiltroCategoriaRecepcion(lista);

  const filtrada = conceptosFiltrados(lista);
  const contador = document.getElementById("recepcionContador");
  if (contador) contador.textContent = filtrada.length + (filtrada.length === 1 ? " producto" : " productos");

  if (!lista.length) {
   contenedor.innerHTML = '<div class="recepcion-empty">Carga un XML CFDI o CSV para comenzar.</div>';
   setText("recepcionPaginacionTexto", "");
   const paginacionVacia = document.getElementById("paginacionRecepcion");
   if (paginacionVacia) paginacionVacia.innerHTML = "";
   return;
  }

  if (!filtrada.length) {
   contenedor.innerHTML = '<div class="recepcion-empty">Ningun producto coincide con la busqueda o los filtros.</div>';
   setText("recepcionPaginacionTexto", "");
   const paginacionSinResultados = document.getElementById("paginacionRecepcion");
   if (paginacionSinResultados) paginacionSinResultados.innerHTML = "";
   return;
  }

  const tamanoPagina = estadoRecepcion.tamanoPagina || 5;
  const totalPaginas = Math.max(1, Math.ceil(filtrada.length / tamanoPagina));
  if (estadoRecepcion.pagina > totalPaginas) estadoRecepcion.pagina = totalPaginas;
  if (estadoRecepcion.pagina < 1) estadoRecepcion.pagina = 1;
  const inicio = (estadoRecepcion.pagina - 1) * tamanoPagina;
  const paginaActual = filtrada.slice(inicio, inicio + tamanoPagina);

  const filas = paginaActual.map((item) => {
   const producto = item.producto;
   const stockActual = Number(producto?.stock || 0);
   const stockNuevo = stockActual + Number(item.cantidad || 0);
   const indiceReal = lista.indexOf(item);
    const importeLinea = Number(item.importe || 0) || Number(item.costo || 0) * Number(item.cantidad || 0);
    const miniatura = typeof miniaturaProducto === "function"
     ? miniaturaProducto(producto || { nombre: item.descripcion }, "recepcion-fila-miniatura")
     : "";
    // Precios de venta sugeridos: para un producto EXISTENTE, parten de
    // lo que ya tiene guardado (no se tocan solos -- el dueño decide si
    // los actualiza); para uno NUEVO, de precargarPreciosSugeridosRecepcion()
    // (catalogo de proveedor real, mismo match exacto de codigo que ya
    // usa "Agregar producto"). En cuanto el dueño edita un campo, ese
    // valor manda en los siguientes renders (item.precioXNuevo ya no es
    // undefined/null, asi que el ?? deja de caer al valor por defecto.
    const precioPublico = item.precioPublicoNuevo ?? producto?.precio_publico ?? "";
    const precioMayoreo = item.precioMayoreoNuevo ?? producto?.precio_mayoreo ?? "";
    // Distribuidor SIEMPRE parte del costo fresco de esta factura, sea
    // producto existente o nuevo -- es lo que de verdad esta pagando
    // ahorita, y coincide con el criterio que ya usaba este mismo
    // formulario antes de este cambio (productoPayloadDesdeExistente).
    // Solo cae al valor viejo guardado si la fila no trae costo.
    const precioDistribuidor = item.precioDistribuidorNuevo ?? item.costo ?? producto?.precio_distribuidor ?? "";
    const preciosCelda = '<td class="recepcion-precios-celda">'
     + '<label>Pub<input type="number" step="0.01" value="' + textoSeguro(precioPublico) + '" onchange="editarConceptoRecepcion(' + indiceReal + ', \'precioPublicoNuevo\', this.value)" onclick="event.stopPropagation()"></label>'
     + '<label>Med<input type="number" step="0.01" value="' + textoSeguro(precioMayoreo) + '" onchange="editarConceptoRecepcion(' + indiceReal + ', \'precioMayoreoNuevo\', this.value)" onclick="event.stopPropagation()"></label>'
     + '<label>Dist<input type="number" step="0.01" value="' + textoSeguro(precioDistribuidor) + '" onchange="editarConceptoRecepcion(' + indiceReal + ', \'precioDistribuidorNuevo\', this.value)" onclick="event.stopPropagation()"></label>'
     + '</td>';
    const clasesFila = (item.existe ? "existente" : "nuevo")
     + (item.confirmado ? " confirmado" : " no-confirmado")
     + (indiceReal === filaEscaneoSeleccionadaIndice ? " armada" : "");
    return '<tr class="' + clasesFila + '" onclick="seleccionarFilaEscaneoRecepcion(' + indiceReal + ')"><td>' + miniatura + '</td><td><strong>' + textoSeguro(item.codigo || producto?.codigo || "Sin codigo") + '</strong><small>' + textoSeguro(item.unidad || "pieza") + '</small></td><td><strong>' + textoSeguro(item.descripcion) + '</strong><small>' + (item.existe ? "Actualizar stock" : "Crear producto") + '</small></td><td><input type="number" step="0.001" value="' + textoSeguro(item.cantidad || 0) + '" onchange="editarConceptoRecepcion(' + indiceReal + ', \'cantidad\', this.value)" onclick="event.stopPropagation()"></td><td><input type="number" step="0.01" value="' + textoSeguro(item.costo || 0) + '" onchange="editarConceptoRecepcion(' + indiceReal + ', \'costo\', this.value)" onclick="event.stopPropagation()">' +
     (item.tieneDiferencia ? '<small class="recepcion-diferencia-linea">Antes ' + formatoDinero(item.precioAnterior) + '</small>' : '') + '</td>' + preciosCelda + '<td>' + formatoDinero(importeLinea) + '</td><td>' +
     textoSeguro(item.existe ? stockActual + " -> " + stockNuevo : "Nuevo") + '</td><td><span class="recepcion-estado ' + (item.existe ? "ok" : "nuevo") + '">' +
     (item.existe ? "Encontrado" : "Nuevo") + '</span><label class="recepcion-confirmar-check" onclick="event.stopPropagation()"><input type="checkbox" ' + (item.confirmado ? "checked" : "") + ' onchange="alternarConfirmadoRecepcion(' + indiceReal + ')">Recibido</label></td></tr>';
   }).join("");

   contenedor.innerHTML = '<table class="recepcion-tabla"><thead><tr><th>Foto</th><th>Codigo</th><th>Descripcion</th><th>Cantidad</th><th>Costo</th><th>Precios de venta</th><th>Importe</th><th>Stock</th><th>Estado</th></tr></thead><tbody>' + filas + '</tbody></table>';

  setText("recepcionPaginacionTexto", "Mostrando " + (inicio + 1) + "-" + Math.min(inicio + tamanoPagina, filtrada.length) + " de " + filtrada.length);
  if (typeof renderPaginacion === "function") {
   renderPaginacion("paginacionRecepcion", filtrada.length, estadoRecepcion.pagina, tamanoPagina, "cambiarPaginaRecepcion");
  }
 };

 const CAMPOS_NUMERICOS_RECEPCION = ["cantidad", "costo", "precioPublicoNuevo", "precioMayoreoNuevo", "precioDistribuidorNuevo"];

 window.editarConceptoRecepcion = function(index, campo, valor) {
  if (!estadoRecepcion.conceptos[index]) return;
  estadoRecepcion.conceptos[index][campo] = CAMPOS_NUMERICOS_RECEPCION.includes(campo) ? numero(valor) : valor;
  renderRecepcionMercancia();
 };

 function productoPayloadDesdeExistente(producto, item) {
  return {
   nombre: producto.nombre,
   precio: producto.precio,
   stock: Number(producto.stock || 0) + Number(item.cantidad || 0),
   // item.codigo primero: si se corrigio por escaneo durante ESTA
   // recepcion (Confirmar por escaneo), ese es el codigo real y debe
   // ganar -- antes producto.codigo (el ya guardado, aunque fuera
   // provisional) ganaba siempre, y un escaneo que "arreglaba" el
   // codigo de un producto existente nunca se guardaba de verdad.
   codigo: item.codigo || producto.codigo || "",
   proveedor: producto.proveedor || item.proveedor || "",
   ubicacion: producto.ubicacion || "",
   categoria: producto.categoria || "",
   subcategoria: producto.subcategoria || "",
   marca: producto.marca || "",
   descripcion: producto.descripcion || item.descripcion || "",
   unidadVenta: producto.unidad_venta || producto.unidadVenta || "pieza",
   // Los 3 precios de venta salen de lo que el dueño vio y, si quiso,
   // ajusto en la vista previa de Recepcion (columna "Precios de
   // venta") -- nunca se recalculan solos aqui. El ?? solo entra como
   // red de seguridad si por algun motivo se confirma sin haber
   // renderizado la tabla primero.
   precioDistribuidor: item.precioDistribuidorNuevo ?? (item.costo || producto.precio_distribuidor || ""),
   precioMayoreo: item.precioMayoreoNuevo ?? (producto.precio_mayoreo || ""),
   precioPublico: item.precioPublicoNuevo ?? (producto.precio_publico || producto.precio || ""),
   stockMinimo: producto.stock_minimo ?? producto.stockMinimo ?? 3,
   altaRotacion: producto.alta_rotacion || producto.altaRotacion || "",
   tipoProducto: producto.tipo_producto || producto.tipoProducto || "catalogo",
   presentacionCompra: producto.presentacion_compra || "",
   factorConversion: producto.factor_conversion || "",
   basculaDigital: producto.bascula_digital || "no",
   codigosRelacionados: []
  };
 }

 // Antes esto ponia el precio de venta directo igual al costo de la
 // factura (lo que el proveedor le cobra a la ferreteria) -- un
 // producto nuevo recibido por factura se creaba sin ningun margen,
 // vendiendose a lo que costo o hasta a perdida. Reportado por el
 // dueño con una factura real de Diprofer. Ahora los 3 precios de
 // venta ya vienen resueltos desde la vista previa de la tabla --
 // precargarPreciosSugeridosRecepcion() consulto el catalogo de
 // proveedor (mismo endpoint que ya usa "Agregar producto" al escanear
 // un codigo de catalogo, match exacto de codigo, nunca aproximado) en
 // cuanto se cargo el archivo, y el dueño pudo revisarlos/ajustarlos
 // ahi mismo antes de confirmar -- aqui solo se leen, nunca se
 // recalculan de nuevo (evita una segunda consulta redundante y,
 // sobre todo, evita que el precio final termine siendo distinto al
 // que el dueño vio y confirmo en pantalla).
 async function productoPayloadNuevo(item) {
  const categoria = document.getElementById("recepcionCategoriaDefault")?.value || "";
  const distribuidor = item.precioDistribuidorNuevo || item.costo || "";
  const mayoreo = item.precioMayoreoNuevo || "";
  const publico = item.precioPublicoNuevo || mayoreo || item.costo || "";

  return {
   nombre: item.descripcion || "Producto nuevo",
   precio: mayoreo || distribuidor || 0,
   stock: item.cantidad || 0,
   codigo: item.codigo || "",
   proveedor: item.proveedor || estadoRecepcion.proveedor || "",
   ubicacion: "",
   categoria,
   subcategoria: "",
   marca: "",
   descripcion: item.descripcion || "",
   unidadVenta: "pieza",
   precioDistribuidor: distribuidor,
   precioMayoreo: mayoreo,
   precioPublico: publico,
   stockMinimo: 3,
   altaRotacion: "",
   tipoProducto: "catalogo",
   presentacionCompra: "",
   factorConversion: "",
   basculaDigital: "no",
   codigosRelacionados: []
  };
 }

 window.confirmarRecepcionMercancia = async function() {
  const lista = conceptosPreparados();
  if (!lista.length) {
   alertaPOS("Sin conceptos", "Carga un archivo antes de confirmar.", "info");
   return;
  }

  // Aviso sin bloquear: confirmar sigue funcionando aunque falten filas
  // por escanear (un lector que falla o un producto a granel no debe
  // trabar la recepcion), solo se avisa cuantas quedan.
  const sinConfirmar = lista.filter(i => !i.confirmado).length;
  const mensajeConfirmar = "Se actualizaran existencias y se crearan productos nuevos cuando haga falta."
   + (sinConfirmar > 0 ? " " + sinConfirmar + " de " + lista.length + " productos siguen sin confirmar por escaneo." : "");

  const ok = await confirmarPOS("Confirmar recepcion", mensajeConfirmar);
  if (!ok) return;

  let actualizados = 0;
  let creados = 0;
  const itemsParaHistorial = [];
  try {
   for (const item of lista) {
    if (item.existe && item.producto?.id) {
     const respuesta = await fetch("/editar-producto/" + item.producto.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productoPayloadDesdeExistente(item.producto, item))
     });
     if (!respuesta.ok) throw new Error("No se pudo actualizar " + item.descripcion);
     actualizados++;
     itemsParaHistorial.push({ productoId: item.producto.id, codigo: item.codigo, nombre: item.descripcion, cantidad: item.cantidad, costo: item.costo });
    } else {
     const respuesta = await fetch("/agregar-producto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await productoPayloadNuevo(item))
     });
     if (!respuesta.ok) throw new Error("No se pudo crear " + item.descripcion);
     const datos = await respuesta.json();
     creados++;
     itemsParaHistorial.push({ productoId: datos?.producto?.id || null, codigo: item.codigo, nombre: item.descripcion, cantidad: item.cantidad, costo: item.costo });
    }
   }
   await cargarProductos();

   // Guarda el historial de esta recepcion -- best-effort a proposito,
   // el stock ya se aplico arriba, si esto falla no debe verse como
   // que la recepcion completa fallo (el dueño ya se quedaria
   // pensando que no se actualizo nada, cuando si se actualizo).
   try {
    await fetch("/recepciones-mercancia", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
      proveedor: estadoRecepcion.proveedor || "",
      referencia: estadoRecepcion.documento?.folio || "",
      fechaDocumento: estadoRecepcion.documento?.fecha || null,
      tipoDocumento: estadoRecepcion.documento?.tipo || "",
      items: itemsParaHistorial
     })
    });
   } catch (errorHistorial) {
    console.warn("No se pudo guardar el historial de esta recepcion:", errorHistorial.message);
   }

   limpiarRecepcionMercancia();
   alertaPOS("Recepcion aplicada", actualizados + " actualizados, " + creados + " creados.", "success");
  } catch (error) {
   console.error(error);
   alertaPOS("Recepcion incompleta", error.message || "Revisa la conexion y vuelve a intentar.", "error");
  }
 };

 window.limpiarRecepcionMercancia = function() {
   estadoRecepcion.archivo = null;
   estadoRecepcion.proveedor = "";
   estadoRecepcion.documento = { tipo: "Factura", folio: "", fecha: "", subtotal: 0, iva: 0, total: 0 };
   estadoRecepcion.conceptos = [];
   estadoRecepcion.busqueda = "";
   estadoRecepcion.filtroCategoria = "";
   estadoRecepcion.soloDiferencias = false;
   estadoRecepcion.pagina = 1;
   const archivo = document.getElementById("archivoRecepcionMercancia");
   if (archivo) archivo.value = "";
   const nombre = document.getElementById("recepcionArchivoNombre");
   if (nombre) nombre.textContent = "Seleccionar archivo";
   const proveedor = document.getElementById("recepcionProveedor");
   const folio = document.getElementById("recepcionFolio");
   const fecha = document.getElementById("recepcionFecha");
   const tipoDocumento = document.getElementById("recepcionTipoDocumento");
   const categoriaDefault = document.getElementById("recepcionCategoriaDefault");
   const buscar = document.getElementById("recepcionBuscar");
   if (proveedor) proveedor.value = "";
   if (folio) folio.value = "";
   if (fecha) fecha.value = "";
   if (tipoDocumento) tipoDocumento.value = "Factura";
   if (categoriaDefault) categoriaDefault.value = "";
   if (buscar) buscar.value = "";
   renderRecepcionMercancia();
  };

 // Historial de recepciones -- lista todas las recepciones guardadas
 // (con pedido a proveedor o libres, via factura XML/CSV suelta) y
 // permite ver el detalle de cada una. Modal propio, mismo patron
 // reusable (crear una vez, reescribir innerHTML) que ya usa
 // modalPermisosUsuario/modalHorarioUsuario en config-auth.js.
 function modalHistorialRecepciones() {
  let modal = document.getElementById("modalHistorialRecepciones");
  if (!modal) {
   modal = document.createElement("div");
   modal.id = "modalHistorialRecepciones";
   modal.className = "modal-permisos-usuario";
   document.body.appendChild(modal);
  }
  return modal;
 }

 window.abrirHistorialRecepciones = async function() {
  const modal = modalHistorialRecepciones();
  modal.innerHTML = `<div class="permisos-card"><p class="permisos-rol-nota">Cargando historial...</p></div>`;
  modal.style.display = "flex";

  try {
   const respuesta = await fetch("/recepciones-mercancia");
   const datos = await respuesta.json();
   if (!datos.ok) throw new Error(datos.error || "No se pudo cargar el historial");
   renderListaHistorialRecepciones(datos.recepciones || []);
  } catch (error) {
   modal.innerHTML = `
    <div class="permisos-card">
     <div class="permisos-header"><h2>Historial de recepciones</h2><button type="button" onclick="cerrarHistorialRecepciones()">Cerrar</button></div>
     <p class="permisos-rol-nota">${escaparPOS(error.message || "No se pudo cargar el historial.")}</p>
    </div>
   `;
  }
 };

 function renderListaHistorialRecepciones(recepciones) {
  const modal = modalHistorialRecepciones();
  modal.innerHTML = `
   <div class="permisos-card">
    <div class="permisos-header">
     <div><h2>Historial de recepciones</h2><p>Facturas y remisiones recibidas, con o sin pedido a proveedor.</p></div>
     <button type="button" onclick="cerrarHistorialRecepciones()">Cerrar</button>
    </div>
    <div class="permisos-secciones">
     <section>
      ${recepciones.length ? recepciones.map(r => `
       <div class="fila-dueno" style="cursor:pointer;" onclick="verDetalleRecepcion(${r.id})">
        <div>
         <strong>${escaparPOS(r.proveedor || "Sin proveedor")}</strong>
         <span>${escaparPOS(r.referencia || "Sin folio")} -- ${new Date(r.created_at).toLocaleDateString("es-MX")} -- ${r.items_count} producto${Number(r.items_count) === 1 ? "" : "s"}</span>
        </div>
        <strong>${dinero(Number(r.total || 0))}</strong>
       </div>
      `).join("") : `<div class="vacio">Todavia no hay recepciones registradas.</div>`}
     </section>
    </div>
   </div>
  `;
  modal.style.display = "flex";
 }

 window.verDetalleRecepcion = async function(id) {
  const modal = modalHistorialRecepciones();
  modal.innerHTML = `<div class="permisos-card"><p class="permisos-rol-nota">Cargando...</p></div>`;

  try {
   const respuesta = await fetch("/recepciones-mercancia/" + id);
   const datos = await respuesta.json();
   if (!datos.ok) throw new Error(datos.error || "No se pudo cargar la recepcion");

   const r = datos.recepcion;
   const items = datos.items || [];

   modal.innerHTML = `
    <div class="permisos-card">
     <div class="permisos-header">
      <div>
       <h2>${escaparPOS(r.proveedor || "Sin proveedor")}</h2>
       <p>${escaparPOS(r.referencia || "Sin folio")} -- ${new Date(r.created_at).toLocaleDateString("es-MX")}${r.tipo_documento ? " -- " + escaparPOS(r.tipo_documento) : ""}</p>
      </div>
      <button type="button" onclick="cerrarHistorialRecepciones()">Cerrar</button>
     </div>
     <div class="permisos-secciones">
      <section>
       ${items.map(item => `
        <div class="fila-dueno">
         <div>
          <strong>${escaparPOS(item.nombre)}</strong>
          <span>${escaparPOS(item.codigo || "Sin codigo")} -- ${Number(item.cantidad)} pzas</span>
         </div>
         <strong>${dinero(Number(item.costo || 0))}</strong>
        </div>
       `).join("")}
       <div class="fila-dueno" style="border-top:1px solid var(--line, #e2e8f0);margin-top:8px;padding-top:8px;">
        <strong>Total</strong>
        <strong>${dinero(Number(r.total || 0))}</strong>
       </div>
      </section>
     </div>
     <div class="permisos-acciones">
      <button type="button" onclick="abrirHistorialRecepciones()">Volver al historial</button>
     </div>
    </div>
   `;
  } catch (error) {
   modal.innerHTML = `
    <div class="permisos-card">
     <div class="permisos-header"><h2>Recepcion</h2><button type="button" onclick="cerrarHistorialRecepciones()">Cerrar</button></div>
     <p class="permisos-rol-nota">${escaparPOS(error.message || "No se pudo cargar la recepcion.")}</p>
    </div>
   `;
  }
 };

 window.cerrarHistorialRecepciones = function() {
  const modal = document.getElementById("modalHistorialRecepciones");
  if (modal) modal.style.display = "none";
 };

 const ocultarBase = window.ocultarPantallasPrincipales;
 if (typeof ocultarBase === "function" && !ocultarBase.__recepcionMercancia) {
  const envuelta = function(...args) {
   const resultado = ocultarBase.apply(this, args);
   document.getElementById("pantallaRecepcionMercancia")?.style && (document.getElementById("pantallaRecepcionMercancia").style.display = "none");
   return resultado;
  };
  envuelta.__recepcionMercancia = true;
  window.ocultarPantallasPrincipales = envuelta;
 }

 setTimeout(() => {
  asegurarPantallaRecepcion();
  instalarBotonRecepcion();
  if (typeof profesionalizarSidebarPOS === "function") profesionalizarSidebarPOS();
 }, 500);
})();

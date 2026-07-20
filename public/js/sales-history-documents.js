async function cargarHistorial() {

 const respuesta =
 await fetch(
 "/historial"
 );

 const historial =
 await respuesta.json();

 asegurarPanelVentasDashboard();
 actualizarPulsoVentasDashboard(historial);
 actualizarMetricasPOSReales(historial);

 const contenedor =
 document.getElementById(
 "historial"
 );

 const ultimas =
 document.getElementById(
 "ultimasVentas"
 );

 const conteo =
 document.getElementById(
 "conteoVentas"
 );

 if (conteo) {

 conteo.textContent =
 historial.length;
 }

 if (contenedor) {
 contenedor.innerHTML = historial.length
 ? historial.slice(0, 18).map(venta => renderVentaHistorialPOS(venta)).join("")
 : `<div class="historial-vacio-pos">Todavia no hay ventas registradas.</div>`;
 }

 if (ultimas) {

 ultimas.innerHTML = "";
 }

 if (ultimas) {
 ultimas.innerHTML =
 historial.slice(0, 6).map(venta => {
 const total =
 Number(venta.total || 0);

 return `
 <div class="venta-dashboard-item">
 <div>
 <strong>${venta.folio || "Venta"} · ${dinero(total)}</strong>
 <span>${formatearFechaVenta(venta.fecha)}</span>
 </div>
 <b>Ingreso</b>
 </div>
 `;
 }).join("");
 }
}

function fechaVenta(valor) {
 const fecha =
 new Date(valor);

 return Number.isNaN(fecha.getTime())
 ? new Date()
 : fecha;
}

function mismaFecha(a, b) {
 return a.getFullYear() === b.getFullYear() &&
 a.getMonth() === b.getMonth() &&
 a.getDate() === b.getDate();
}

function formatearFechaVenta(valor) {
 const fecha =
 fechaVenta(valor);

 return fecha.toLocaleString("es-MX", {
 day: "2-digit",
 month: "short",
 hour: "2-digit",
 minute: "2-digit"
 });
}

function ventasDeFecha(historial, fechaObjetivo) {
 return historial.filter(venta =>
 mismaFecha(
 fechaVenta(venta.fecha),
 fechaObjetivo
 )
 );
}

function actualizarPulsoVentasDashboard(historial) {
 const hoy =
 new Date();

 const ayer =
 new Date();

 ayer.setDate(hoy.getDate() - 1);

 const ventasHoy =
 ventasDeFecha(historial, hoy);

 const ventasAyer =
 ventasDeFecha(historial, ayer);

 const totalHoy =
 ventasHoy.reduce(
 (suma, venta) => suma + Number(venta.total || 0),
 0
 );

 const totalAyer =
 ventasAyer.reduce(
 (suma, venta) => suma + Number(venta.total || 0),
 0
 );

 const ticketPromedio =
 ventasHoy.length
 ? totalHoy / ventasHoy.length
 : 0;

 const ventaAlta =
 ventasHoy.reduce(
 (mayor, venta) => Math.max(mayor, Number(venta.total || 0)),
 0
 );

 document.getElementById("ventasHoyMonto").textContent =
 dinero(totalHoy);

 document.getElementById("ventasHoyConteo").textContent =
 ventasHoy.length;

 document.getElementById("ticketPromedioHoy").textContent =
 dinero(ticketPromedio);

 document.getElementById("ventaAltaHoy").textContent =
 dinero(ventaAlta);

 const estado =
 document.getElementById("ventasHoyEstado");

 if (estado) {
 const diferencia =
 totalAyer > 0
 ? ((totalHoy - totalAyer) / totalAyer) * 100
 : totalHoy > 0 ? 100 : 0;

 estado.textContent =
 `${diferencia >= 0 ? "+" : ""}${diferencia.toFixed(0)}% vs ayer`;

 estado.className =
 diferencia >= 0 ? "estado-positivo" : "estado-negativo";
 }

 renderGraficaDashboardVentas(ventasHoy);
}

function mismoMes(a, b) {
 return a.getFullYear() === b.getFullYear() &&
 a.getMonth() === b.getMonth();
}

function ventasDelMes(historial, fechaObjetivo) {
 return historial.filter(venta =>
 mismoMes(fechaVenta(venta.fecha), fechaObjetivo)
 );
}

function productosVendidosEnVentas(ventas) {
 return ventas.reduce((total, venta) => {
 const productos = Array.isArray(venta.productos) ? venta.productos : [];
 return total + productos.reduce((suma, producto) => suma + Number(producto.cantidad || 0), 0);
 }, 0);
}

function textoTendenciaPorcentaje(actual, anterior, etiqueta) {
 if (anterior <= 0) return actual > 0 ? `nuevo ${etiqueta}` : etiqueta;

 const diferencia = ((actual - anterior) / anterior) * 100;

 return `${diferencia >= 0 ? "+" : ""}${diferencia.toFixed(0)}% ${etiqueta}`;
}

function actualizarMetricasPOSReales(historial) {
 const posVentasDia = document.getElementById("posVentasDia");
 const posVentasMes = document.getElementById("posVentasMes");
 const posProductosVendidos = document.getElementById("posProductosVendidos");
 const posTicketPromedio = document.getElementById("posTicketPromedio");

 if (!posVentasDia && !posVentasMes && !posProductosVendidos && !posTicketPromedio) return;

 const hoy = new Date();

 const ayer = new Date();
 ayer.setDate(hoy.getDate() - 1);

 const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);

 const ventasHoy = ventasDeFecha(historial, hoy);
 const ventasAyer = ventasDeFecha(historial, ayer);
 const ventasMesActual = ventasDelMes(historial, hoy);
 const ventasMesPasado = ventasDelMes(historial, mesAnterior);

 const totalHoy = ventasHoy.reduce((suma, venta) => suma + Number(venta.total || 0), 0);
 const totalAyer = ventasAyer.reduce((suma, venta) => suma + Number(venta.total || 0), 0);
 const totalMesActual = ventasMesActual.reduce((suma, venta) => suma + Number(venta.total || 0), 0);
 const totalMesPasado = ventasMesPasado.reduce((suma, venta) => suma + Number(venta.total || 0), 0);

 const productosHoy = productosVendidosEnVentas(ventasHoy);
 const productosAyer = productosVendidosEnVentas(ventasAyer);

 const ticketPromedioHoy = ventasHoy.length ? totalHoy / ventasHoy.length : 0;
 const ticketPromedioAyer = ventasAyer.length ? totalAyer / ventasAyer.length : 0;

 if (posVentasDia) posVentasDia.textContent = dinero(totalHoy);
 if (posVentasMes) posVentasMes.textContent = dinero(totalMesActual);
 if (posProductosVendidos) posProductosVendidos.textContent = String(productosHoy);
 if (posTicketPromedio) posTicketPromedio.textContent = dinero(ticketPromedioHoy);

 const tendenciaDia = document.getElementById("posVentasDiaTendencia");
 const tendenciaMes = document.getElementById("posVentasMesTendencia");
 const tendenciaProductos = document.getElementById("posProductosVendidosTendencia");
 const tendenciaTicket = document.getElementById("posTicketPromedioTendencia");

 if (tendenciaDia) tendenciaDia.textContent = textoTendenciaPorcentaje(totalHoy, totalAyer, "vs ayer");
 if (tendenciaMes) tendenciaMes.textContent = textoTendenciaPorcentaje(totalMesActual, totalMesPasado, "vs mes anterior");
 if (tendenciaProductos) tendenciaProductos.textContent = textoTendenciaPorcentaje(productosHoy, productosAyer, "vs ayer");
 if (tendenciaTicket) tendenciaTicket.textContent = textoTendenciaPorcentaje(ticketPromedioHoy, ticketPromedioAyer, "vs ayer");
}

function renderGraficaDashboardVentas(ventasHoy) {
 const canvas =
 document.getElementById("graficaDashboardVentas");

 if (!canvas || typeof Chart === "undefined") return;

 const horas =
 Array.from({ length: 12 }, (_, indice) => indice + 8);

 const datos =
 horas.map(hora =>
 ventasHoy
 .filter(venta => fechaVenta(venta.fecha).getHours() === hora)
 .reduce((suma, venta) => suma + Number(venta.total || 0), 0)
 );

 if (graficaDashboardVentas) {
 graficaDashboardVentas.destroy();
 }

 graficaDashboardVentas = new Chart(canvas, {
 type: "line",
 data: {
 labels: horas.map(hora => `${hora}:00`),
 datasets: [
 {
 label: "Ventas",
 data: datos,
 borderColor: "#16a34a",
 backgroundColor: "rgba(22, 163, 74, .12)",
 borderWidth: 3,
 tension: .35,
 fill: true,
 pointRadius: 3,
 pointBackgroundColor: "#16a34a"
 }
 ]
 },
 options: {
 responsive: true,
 maintainAspectRatio: false,
 plugins: {
 legend: {
 display: false
 }
 },
 scales: {
 x: {
 grid: {
 display: false
 }
 },
 y: {
 beginAtZero: true,
 ticks: {
 callback: valor => dinero(valor)
 }
 }
 }
 }
 });
}

function mostrarInicio() {
 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

 document.getElementById(
 "pantallaInicio"
 ).style.display = "block";
}

function cambiarModo() {

 document.body.classList.toggle("oscuro");

 localStorage.setItem(
 TEMA_POS_KEY,
 document.body.classList.contains("oscuro")
 ? "oscuro"
 : "claro"
 );

 actualizarBotonModo();
}

function escaparPOS(valor) {
 return String(valor ?? "")
 .replace(/&/g, "&amp;")
 .replace(/</g, "&lt;")
 .replace(/>/g, "&gt;")
 .replace(/"/g, "&quot;")
 .replace(/'/g, "&#039;");
}

function productosVentaPOS(venta) {
 if (Array.isArray(venta?.productos)) return venta.productos;
 try {
  const parsed = JSON.parse(venta?.productos || "[]");
  return Array.isArray(parsed) ? parsed : [];
 } catch (error) {
  return [];
 }
}

function renderVentaHistorialPOS(venta) {
 const total = Number(venta.total || 0);
 const metodo = venta.metodo_pago || venta.metodoPago || "efectivo";
 const cliente = venta.cliente_nombre || venta.cliente_nombre_resuelto || "Publico general";
 const folio = venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`;

 return `
 <article class="venta-historial-card-pos">
  <div>
   <span>${escaparPOS(folio)}</span>
   <strong>${dinero(total)}</strong>
   <small>${formatearFechaVenta(venta.fecha)} · ${escaparPOS(metodo)} · ${escaparPOS(cliente)}</small>
  </div>
  <button type="button" onclick="abrirDetalleVentaPOS(${Number(venta.id)})">Ver detalle / nota</button>
 </article>
 `;
}

function htmlTicketDesdeVentaPOS(venta, opciones = {}) {
 const config = configuracionNegocio() || {};
 const productos = productosVentaPOS(venta);
 const ancho = config.ticketAncho === "58" ? 230 : 300;
 const folio = venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`;
 const fecha = venta.fecha ? new Date(venta.fecha).toLocaleString("es-MX") : new Date().toLocaleString("es-MX");
 const titulo = opciones.tipo === "nota" ? "NOTA DE VENTA" : "TICKET";
 const total = Number(opciones.totalMostrado ?? venta.total ?? 0);
 const cliente = opciones.clienteNombre || venta.cliente_nombre || "Publico general";
 const obra = opciones.obra || "";
 const observaciones = opciones.observaciones || "";

 const filas = productos.map(producto => {
  const cantidad = Number(producto.cantidad || 1);
  const precio = Number(producto.precio || 0);
  const importe = Number(producto.importe || cantidad * precio);
  return `
  <div style="display:flex;justify-content:space-between;gap:8px;margin:6px 0;text-align:left;">
   <span>${escaparPOS(producto.nombre || "Producto")}<br><small>${formatearCantidad(cantidad, producto.unidadVenta || "pieza")} x $${precio.toFixed(2)}</small></span>
   <span>$${importe.toFixed(2)}</span>
  </div>`;
 }).join("");

 return `
 <div style="width:${ancho}px;font-family:monospace;padding:18px;color:#000;text-align:${config.ticketAlineacion || "center"};">
  ${config.logo && config.mostrarLogoTicket !== false ? `<img src="${config.logo}" style="width:54px;height:54px;object-fit:cover;border-radius:10px;margin-bottom:8px;">` : ""}
  ${config.mostrarNombreTicket === false ? "" : `<h2 style="margin:0;font-size:20px;text-transform:uppercase;">${escaparPOS(config.ticketNombre || config.nombre || "Ferreteria Olimpico")}</h2>`}
  ${config.ticketSubtitulo ? `<div style="font-size:12px;">${escaparPOS(config.ticketSubtitulo)}</div>` : ""}
  ${config.mostrarDireccionTicket !== false && config.direccion ? `<div>${escaparPOS(config.direccion)}</div>` : ""}
  ${config.mostrarTelefonoTicket !== false && config.telefono ? `<div>Tel. ${escaparPOS(config.telefono)}</div>` : ""}
  <hr>
  <div style="font-weight:bold;">${titulo}</div>
  <div><strong>Folio ${escaparPOS(folio)}</strong></div>
  <div>${escaparPOS(fecha)}</div>
  <div>Cajero: ${escaparPOS(venta.cajero_nombre || usuarioActual?.nombre || "Administrador")}</div>
  <div>Cliente: ${escaparPOS(cliente)}</div>
  ${obra ? `<div>Obra: ${escaparPOS(obra)}</div>` : ""}
  <hr>
  ${filas}
  <hr>
  ${Number(venta.descuento || 0) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>SUBTOTAL</span><span>${dinero(venta.subtotal || 0)}</span></div><div style="display:flex;justify-content:space-between;"><span>DESCUENTO</span><span>-${dinero(venta.descuento || 0)}</span></div>` : ""}
  <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:15px;"><span>TOTAL</span><span>${dinero(total)}</span></div>
  ${opciones.tipo === "nota" ? "" : `<div style="display:flex;justify-content:space-between;"><span>RECIBIDO</span><span>${dinero(venta.pago_recibido || 0)}</span></div><div style="display:flex;justify-content:space-between;"><span>CAMBIO</span><span>${dinero(venta.cambio || 0)}</span></div>`}
  ${observaciones ? `<hr><div style="text-align:left;"><strong>Observaciones</strong><br>${escaparPOS(observaciones)}</div>` : ""}
  <hr>
  <div style="font-weight:bold;">${escaparPOS(config.mensajeTicket || "Gracias por su compra")}</div>
 </div>`;
}

async function abrirDetalleVentaPOS(id) {
 const respuesta = await fetch(`/ventas/${Number(id)}`);
 const datos = await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
  await alertaPOS(datos.error || "No se pudo abrir la venta.", "Historial", "peligro");
  return;
 }

 renderDetalleVentaPOS(datos.venta);
}

function renderDetalleVentaPOS(venta) {
 let modal = document.getElementById("modalDetalleVentaPOS");
 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalDetalleVentaPOS";
  modal.className = "modal-personalizado modal-detalle-venta-pos";
  document.body.appendChild(modal);
 }

 const productos = productosVentaPOS(venta);
 const folio = venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`;
 const bitacora = Array.isArray(venta.bitacora) ? venta.bitacora : [];

 modal.innerHTML = `
 <div class="modal-card detalle-venta-card-pos">
  <div class="modal-card-header">
   <div>
    <span>${escaparPOS(folio)}</span>
    <h3>${dinero(venta.total || 0)}</h3>
   </div>
   <button type="button" onclick="cerrarDetalleVentaPOS()">Cerrar</button>
  </div>
  <div class="detalle-venta-resumen-pos">
   <div><span>Fecha</span><strong>${escaparPOS(new Date(venta.fecha).toLocaleString("es-MX"))}</strong></div>
   <div><span>Cliente</span><strong>${escaparPOS(venta.cliente_nombre || "Publico general")}</strong></div>
   <div><span>Cajero</span><strong>${escaparPOS(venta.cajero_nombre || venta.turno_usuario || "Administrador")}</strong></div>
   <div><span>Metodo</span><strong>${escaparPOS(venta.metodo_pago || "efectivo")}</strong></div>
  </div>
  <div class="detalle-productos-pos">
   ${productos.map(producto => `<div><span>${escaparPOS(producto.nombre || "Producto")} · ${formatearCantidad(producto.cantidad || 1, producto.unidadVenta || "pieza")}</span><strong>${dinero(producto.importe || Number(producto.precio || 0) * Number(producto.cantidad || 1))}</strong></div>`).join("")}
  </div>
  <div class="detalle-venta-totales-pos">
   <div><span>Subtotal</span><strong>${dinero(venta.subtotal || venta.total || 0)}</strong></div>
   <div><span>Descuento</span><strong>-${dinero(venta.descuento || 0)}</strong></div>
   <div><span>Total</span><strong>${dinero(venta.total || 0)}</strong></div>
   <div><span>Recibido</span><strong>${dinero(venta.pago_recibido || 0)}</strong></div>
   <div><span>Cambio</span><strong>${dinero(venta.cambio || 0)}</strong></div>
  </div>
  ${bitacora.length ? `<div class="detalle-bitacora-pos"><strong>Bitacora de notas</strong>${bitacora.map(item => `<span>${new Date(item.created_at).toLocaleString("es-MX")} · ${escaparPOS(item.usuario_autorizo)} autorizo ${dinero(item.total_original)} a ${dinero(item.total_mostrado)} · ${escaparPOS(item.motivo)}</span>`).join("")}</div>` : ""}
  <div class="detalle-acciones-pos">
   <button type="button" class="detalle-boton-primario" onclick="reimprimirTicketVentaPOS(${Number(venta.id)})">Reimprimir ticket</button>
   <button type="button" onclick="abrirNotaVentaPOS(${Number(venta.id)})">Imprimir nota</button>
   <button type="button" onclick="descargarPDFVentaPOS(${Number(venta.id)})">Descargar PDF</button>
   <button type="button" disabled>WhatsApp</button>
   <button type="button" disabled>Correo</button>
   <button type="button" disabled>Factura CFDI</button>
  </div>
 </div>`;

 modal.style.display = "flex";
}

function cerrarDetalleVentaPOS() {
 const modal = document.getElementById("modalDetalleVentaPOS");
 if (modal) modal.style.display = "none";
}

async function obtenerVentaDetallePOS(id) {
 const respuesta = await fetch(`/ventas/${Number(id)}`);
 const datos = await respuesta.json().catch(() => ({}));
 if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo cargar la venta");
 return datos.venta;
}

async function reimprimirTicketVentaPOS(id) {
 try {
  const venta = await obtenerVentaDetallePOS(id);
  await imprimirTicketPOS(htmlTicketDesdeVentaPOS(venta), {
   ...(configuracionNegocio() || {}),
   abrirCajonDespuesTicket: false
  });
 } catch (error) {
  await alertaPOS(error.message, "Reimprimir ticket", "peligro");
 }
}

async function descargarPDFVentaPOS(id) {
 await reimprimirTicketVentaPOS(id);
}

async function abrirNotaVentaPOS(id) {
 const venta = await obtenerVentaDetallePOS(id);
 let modal = document.getElementById("modalNotaVentaPOS");
 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalNotaVentaPOS";
  modal.className = "modal-personalizado modal-nota-venta-pos";
  document.body.appendChild(modal);
 }

 modal.innerHTML = `
 <div class="modal-card nota-venta-card-pos">
  <div class="modal-card-header">
   <div>
    <span>${escaparPOS(venta.folio || "Nota")}</span>
    <h3>Nota de venta</h3>
   </div>
   <button type="button" onclick="cerrarNotaVentaPOS()">Cerrar</button>
  </div>
  <label>Cliente<input id="notaClienteVentaPOS" value="${escaparPOS(venta.cliente_nombre || "Publico general")}"></label>
  <label>Obra o trabajo<input id="notaObraVentaPOS" placeholder="Opcional"></label>
  <label>Observaciones<textarea id="notaObsVentaPOS" rows="3" placeholder="Opcional"></textarea></label>
  <details class="nota-ajuste-pos">
   <summary>Ajustar solo importe mostrado</summary>
   <label>Total mostrado<input id="notaTotalVentaPOS" type="number" step="0.01" value="${Number(venta.total || 0).toFixed(2)}"></label>
   <label>Motivo<input id="notaMotivoVentaPOS" placeholder="Requerido si cambia el total"></label>
   <label>PIN administrador<input id="notaPinVentaPOS" type="password" placeholder="Requerido si cambia el total"></label>
  </details>
  <div class="modal-actions-row">
   <button type="button" onclick="cerrarNotaVentaPOS()">Cancelar</button>
   <button type="button" class="btn-principal" onclick="generarNotaVentaPOS(${Number(venta.id)})">Imprimir nota</button>
  </div>
 </div>`;
 modal.style.display = "flex";
}

function cerrarNotaVentaPOS() {
 const modal = document.getElementById("modalNotaVentaPOS");
 if (modal) modal.style.display = "none";
}

function mostrarAccionesVentaCompletadaPOS(venta = {}) {
 let modal = document.getElementById("modalVentaCompletadaPOS");
 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalVentaCompletadaPOS";
  modal.className = "modal-personalizado modal-venta-completada-pos";
  document.body.appendChild(modal);
 }

 modal.innerHTML = `
 <div class="modal-card venta-completada-card-pos">
  <div class="modal-card-header">
   <div>
    <span>${escaparPOS(venta.folio || "Venta completada")}</span>
    <h3>${dinero(venta.total || 0)}</h3>
   </div>
   <button type="button" onclick="cerrarVentaCompletadaPOS()">Cerrar</button>
  </div>
  <div class="venta-completada-resumen-pos">
   <div><span>Recibido</span><strong>${dinero(venta.recibido || 0)}</strong></div>
   <div><span>Cambio</span><strong>${dinero(venta.cambio || 0)}</strong></div>
  </div>
  <div class="modal-actions-row">
   <button type="button" onclick="cerrarVentaCompletadaPOS()">Nueva venta</button>
   <button type="button" onclick="reimprimirTicketVentaPOS(${Number(venta.id)}); cerrarVentaCompletadaPOS();">Reimprimir ticket</button>
   <button type="button" class="btn-principal" onclick="abrirNotaVentaPOS(${Number(venta.id)}); cerrarVentaCompletadaPOS();">Hacer nota</button>
  </div>
 </div>`;
 modal.style.display = "flex";
}

function cerrarVentaCompletadaPOS() {
 const modal = document.getElementById("modalVentaCompletadaPOS");
 if (modal) modal.style.display = "none";
}

async function generarNotaVentaPOS(id) {
 try {
  const venta = await obtenerVentaDetallePOS(id);
  const totalMostrado = Number(document.getElementById("notaTotalVentaPOS")?.value || venta.total || 0);
  const totalOriginal = Number(venta.total || 0);
  const requiereAutorizacion = Math.abs(totalMostrado - totalOriginal) >= 0.01;
  let autorizacionLocal = false;
  let usuarioAutoriza = usuarioActual?.nombre || usuarioActual?.usuario || "";

  if (requiereAutorizacion) {
   const pin = document.getElementById("notaPinVentaPOS")?.value || "";
   const admin = await buscarAdminPorPinLocal(pin);

   if (!admin) {
    await alertaPOS("PIN de administrador incorrecto.", "Ajuste de nota", "peligro");
    return;
   }

   const motivo = document.getElementById("notaMotivoVentaPOS")?.value.trim() || "";
   if (!motivo) {
    await alertaPOS("Captura el motivo del ajuste.", "Ajuste de nota", "alerta");
    return;
   }

   autorizacionLocal = true;
   usuarioAutoriza = admin.nombre || admin.id || "Administrador";
  }

  const payload = {
   tipo: "nota",
   clienteNombre: document.getElementById("notaClienteVentaPOS")?.value.trim() || "Publico general",
   obra: document.getElementById("notaObraVentaPOS")?.value.trim() || "",
   observaciones: document.getElementById("notaObsVentaPOS")?.value.trim() || "",
   totalMostrado,
   motivoAjuste: document.getElementById("notaMotivoVentaPOS")?.value.trim() || "",
   adminPin: document.getElementById("notaPinVentaPOS")?.value || "",
   usuarioAutoriza,
   autorizacionLocal,
   creadoPor: usuarioActual?.nombre || usuarioActual?.usuario || ""
  };

  const respuesta = await fetch(`/ventas/${Number(id)}/comprobantes`, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(payload)
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo generar la nota");

  cerrarNotaVentaPOS();
  await imprimirTicketPOS(htmlTicketDesdeVentaPOS(venta, {
   tipo: "nota",
   clienteNombre: payload.clienteNombre,
   obra: payload.obra,
   observaciones: payload.observaciones,
   totalMostrado
  }), {
   ...(configuracionNegocio() || {}),
   abrirCajonDespuesTicket: false
  });
  await abrirDetalleVentaPOS(id);
 } catch (error) {
  await alertaPOS(error.message, "Nota de venta", "peligro");
 }
}

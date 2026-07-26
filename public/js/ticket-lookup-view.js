// Pantalla "Buscar ticket" -- el cajero/dueno escanea (con el mismo
// lector de codigo de barras que ya usan, que escribe como teclado) o
// teclea el folio impreso en el ticket, y se muestra la venta junto
// con que productos llevan garantia. Reusa GET /ventas/folio/:folio,
// ya protegida por requerirAccesoNegocio -- sin ruta publica nueva.

async function mostrarBuscarTicket() {
 if (typeof ocultarPantallasPrincipales === "function") {
  ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaBuscarTicket");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Buscar ticket", "Escanea o teclea el folio para ver la venta y sus garantias", "buscar-ticket");
 }

 pantalla.innerHTML = `
 <div class="caja buscar-ticket-shell">
  <h2>Buscar ticket</h2>
  <p class="buscar-ticket-subtitulo">Escanea el codigo de barras del ticket o teclea el folio (ej. V-000123).</p>
  <form onsubmit="buscarTicketPorFolio(event)" class="buscar-ticket-form">
   <input id="buscarTicketFolioInput" placeholder="Folio del ticket" autocomplete="off" autofocus>
   <button type="submit">Buscar</button>
  </form>
  <div id="buscarTicketResultado"></div>
 </div>
 `;

 document.getElementById("buscarTicketFolioInput")?.focus();
}

// Algunos lectores de codigo de barras USB mandan mal el guion del
// folio (ej. "V°000052" en vez de "V-000052") cuando su idioma de
// teclado configurado no coincide con el de Windows -- en vez de
// depender de que ese ajuste este bien hecho, se reconstruye el
// folio a partir de los digitos escaneados (el formato siempre es
// "V-" + 6 digitos), tolerando cualquier caracter raro en medio.
function normalizarFolioBuscado(texto) {
 const limpio = String(texto || "").trim();
 const digitos = limpio.match(/\d+/);

 if (digitos) {
  return "V-" + digitos[0].padStart(6, "0");
 }

 return limpio;
}

async function buscarTicketPorFolio(evento) {
 evento.preventDefault();

 const input =
 document.getElementById("buscarTicketFolioInput");

 const folio =
 normalizarFolioBuscado(input?.value);

 const resultado =
 document.getElementById("buscarTicketResultado");

 if (!folio || !resultado) return;

 resultado.innerHTML = `<p class="buscar-ticket-estado">Buscando...</p>`;

 try {
  const respuesta =
  await fetch(`/ventas/folio/${encodeURIComponent(folio)}`);

  const datos =
  await respuesta.json().catch(() => ({}));

  if (!respuesta.ok || !datos.ok || !datos.venta) {
   resultado.innerHTML = `<p class="buscar-ticket-estado buscar-ticket-error">No se encontro ningun ticket con ese folio.</p>`;
   return;
  }

  renderResultadoBuscarTicket(datos.venta);
 } catch (error) {
  resultado.innerHTML = `<p class="buscar-ticket-estado buscar-ticket-error">No se pudo buscar el ticket. Intenta de nuevo.</p>`;
 } finally {
  input?.select();
 }
}

function renderResultadoBuscarTicket(venta) {
 const resultado =
 document.getElementById("buscarTicketResultado");

 if (!resultado) return;

 const productos =
 Array.isArray(venta.productos) ? venta.productos : [];

 const filasProductos =
 productos.map(producto => `
  <div class="buscar-ticket-producto">
   <div>
    <strong>${escaparPOS(producto.nombre || "Producto")}</strong>
    <small>${escaparPOS(formatearCantidad(producto.cantidad, producto.unidadVenta || "pieza"))} x ${dinero(producto.precio || 0)}</small>
   </div>
   <span class="buscar-ticket-garantia ${producto.tieneGarantia ? "con-garantia" : "sin-garantia"}">
    ${producto.tieneGarantia ? `Con garantia -- ${escaparPOS(producto.garantiaDetalle || "sin detalle")}` : "Sin garantia"}
   </span>
  </div>
 `).join("");

 const fecha =
 venta.fecha ? new Date(venta.fecha).toLocaleString("es-MX") : "";

 resultado.innerHTML = `
 <div class="buscar-ticket-detalle">
  <div class="buscar-ticket-cabecera">
   <div><span>Folio</span><strong>${escaparPOS(venta.folio || "")}</strong></div>
   <div><span>Fecha</span><strong>${escaparPOS(fecha)}</strong></div>
   <div><span>Cajero</span><strong>${escaparPOS(venta.cajero_nombre || venta.turno_usuario || "")}</strong></div>
   <div><span>Cliente</span><strong>${escaparPOS(venta.cliente_nombre || "Publico general")}</strong></div>
   <div><span>Metodo de pago</span><strong>${escaparPOS(venta.metodo_pago || "")}</strong></div>
   <div><span>Total</span><strong>${dinero(venta.total || 0)}</strong></div>
  </div>
  <h3>Productos</h3>
  ${filasProductos || `<p class="buscar-ticket-estado">Esta venta no tiene productos registrados.</p>`}
 </div>
 `;
}

// Plantilla unica del ticket de venta -- la usan cobrarInternoPOS y el
// flujo de venta a credito (pos-sales.js), la reimpresion desde
// historial (sales-history-documents.js) y la vista previa de
// Configuracion (config-auth.js), para que las 4 pantallas muestren
// siempre exactamente lo mismo.
//
// datos: {
//   folio, fecha, cajero, cliente, obra, observaciones,
//   productos: [{nombre, cantidad, unidadVenta, precio, importe}],
//   subtotal, descuento, total, metodoPago, recibido, cambio,
//   ventaOffline
// }
// opciones: { tipo: "venta" | "credito" | "nota" }
function construirTicketVentaHTML(datos, config = {}, opciones = {}) {
 const tipo =
 opciones.tipo || "venta";

 const alineacionEncabezado =
 config.ticketAlineacion || "center";

 const logoHtml =
 config.logo && config.mostrarLogoTicket !== false
 ? `<img src="${config.logo}" style="width:58px;height:58px;object-fit:cover;border-radius:10px;margin-bottom:8px;">`
 : "";

 const nombreHtml =
 config.mostrarNombreTicket === false
 ? ""
 : `<h2 style="margin:0;font-size:22px;text-transform:uppercase;">${escaparPOS(config.ticketNombre || config.nombre || "")}</h2>`;

 const subtituloHtml =
 config.ticketSubtitulo
 ? `<div style="font-size:12px;">${escaparPOS(config.ticketSubtitulo)}</div>`
 : "";

 const etiquetaTipo =
 tipo === "credito"
 ? "VENTA A CREDITO"
 : tipo === "nota"
 ? "NOTA DE VENTA"
 : "TICKET";

 const insigniaHtml = `
  <div style="display:inline-block;background:#000;color:#fff;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:bold;letter-spacing:1px;margin-top:4px;">
   ${etiquetaTipo}
  </div>
 `;

 const cajeroHtml =
 config.mostrarCajeroTicket === false || !datos.cajero
 ? ""
 : `<div>Cajero: ${escaparPOS(datos.cajero)}</div>`;

 const clienteHtml =
 datos.cliente && datos.cliente !== "Publico general"
 ? `<div>Cliente: ${escaparPOS(datos.cliente)}</div>`
 : "";

 const obraHtml =
 datos.obra
 ? `<div>Obra: ${escaparPOS(datos.obra)}</div>`
 : "";

 const observacionesHtml =
 datos.observaciones
 ? `<hr><div style="text-align:left;"><strong>Observaciones</strong><br>${escaparPOS(datos.observaciones)}</div>`
 : "";

 const productos =
 Array.isArray(datos.productos) ? datos.productos : [];

 const filasProductos =
 productos.map(p => `
  <tr>
   <td colspan="4" style="padding-top:5px;font-weight:bold;">${escaparPOS(p.nombre || "")}</td>
  </tr>
  <tr>
   <td style="padding-bottom:4px;">${escaparPOS(formatearCantidad(p.cantidad, p.unidadVenta))}</td>
   <td style="padding-bottom:4px;text-align:right;">${dinero(p.precio || 0)}</td>
   <td style="padding-bottom:4px;"></td>
   <td style="padding-bottom:4px;text-align:right;">${dinero(p.importe || 0)}</td>
  </tr>
 `).join("");

 const tablaProductosHtml = `
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
   <thead>
    <tr style="border-bottom:1px dashed #000;">
     <td style="padding-bottom:4px;">Cant.</td>
     <td style="padding-bottom:4px;text-align:right;">Precio</td>
     <td></td>
     <td style="padding-bottom:4px;text-align:right;">Total</td>
    </tr>
   </thead>
   <tbody>
    ${filasProductos}
   </tbody>
  </table>
 `;

 const subtotalHtml =
 Number(datos.descuento || 0) > 0
 ? `
  <div style="display:flex;justify-content:space-between;"><span>SUBTOTAL</span><span>${dinero(datos.subtotal || 0)}</span></div>
  <div style="display:flex;justify-content:space-between;"><span>DESCUENTO</span><span>-${dinero(datos.descuento || 0)}</span></div>
 `
 : "";

 const ivaHtml =
 config.mostrarIvaTicket === true
 ? `
  <div style="display:flex;justify-content:space-between;font-size:10px;">
   <span>IVA (16%)</span>
   <span>${dinero(Number(datos.total || 0) - Number(datos.total || 0) / 1.16)}</span>
  </div>
  <div style="font-size:9px;color:#666;margin-bottom:2px;">(incluido en el precio, no se cobra aparte)</div>
 `
 : "";

 const etiquetaMetodoPago = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Credito",
  mixto: "Mixto"
 };

 const pagoHtml =
 tipo === "nota"
 ? ""
 : tipo === "credito"
 ? (Number(datos.abonoInmediato || 0) > 0
 ? `
  <div style="display:flex;justify-content:space-between;">
   <span>PAGO DE CONTADO</span>
   <span>${dinero(datos.abonoInmediato)}</span>
  </div>
  <div style="display:flex;justify-content:space-between;font-weight:bold;">
   <span>QUEDA A CREDITO</span>
   <span>${dinero(Number(datos.total || 0) - Number(datos.abonoInmediato || 0))}</span>
  </div>
 `
 : "")
 : `
  <div style="display:flex;justify-content:space-between;">
   <span>PAGO</span>
   <span>${escaparPOS(etiquetaMetodoPago[datos.metodoPago] || datos.metodoPago || "Efectivo")}</span>
  </div>
  <div style="display:flex;justify-content:space-between;">
   <span>MONTO PAGADO</span>
   <span>${dinero(datos.recibido || 0)}</span>
  </div>
  <div style="display:flex;justify-content:space-between;">
   <span>CAMBIO</span>
   <span>${dinero(datos.cambio || 0)}</span>
  </div>
 `;

 const firmaHtml =
 tipo === "credito"
 ? `
  <div style="margin-top:16px;border-top:1px solid #000;padding-top:4px;text-align:center;font-size:11px;">
   Firma de recibido
  </div>
 `
 : "";

 const mensajeHtml =
 `<div style="text-align:center;margin-top:12px;font-size:14px;">${escaparPOS(config.mensajeTicket || "Gracias por su compra")}</div>` +
 (config.notaTicket ? `<div style="text-align:center;"><small>${escaparPOS(config.notaTicket)}</small></div>` : "");

 const direccionHtml =
 config.mostrarDireccionTicket === false || !config.direccion
 ? ""
 : `<div>${escaparPOS(config.direccion)}</div>`;

 const telefonoHtml =
 config.mostrarTelefonoTicket === false || !config.telefono
 ? ""
 : `<div>Tel. ${escaparPOS(config.telefono)}</div>`;

 const sitioWebHtml =
 config.mostrarSitioWebTicket === false || !config.sitioWebNegocio
 ? ""
 : `<div>${escaparPOS(config.sitioWebNegocio)}</div>`;

 const redSocial = (etiqueta, valor) =>
 valor ? `<div>${etiqueta}: ${escaparPOS(valor)}</div>` : "";

 const hayRedSocial =
 config.facebookNegocio || config.instagramNegocio || config.whatsappNegocio;

 const redesHtml =
 config.mostrarRedesTicket === true && hayRedSocial
 ? `
  <div style="margin-top:6px;font-weight:bold;">Siguenos</div>
  ${redSocial("Facebook", config.facebookNegocio)}
  ${redSocial("Instagram", config.instagramNegocio)}
  ${redSocial("WhatsApp", config.whatsappNegocio)}
 `
 : "";

 let codigoBarrasHtml = "";
 if (config.mostrarBarcodeTicket && datos.folio && typeof JsBarcode === "function") {
  try {
   const svg =
   document.createElementNS("http://www.w3.org/2000/svg", "svg");

   // Se codifica solo la parte numerica del folio (ej. "000057" en
   // vez de "V-000057") -- JsBarcode usa el modo numerico de CODE128
   // (2 digitos por caracter de codigo) cuando el valor es puramente
   // numerico, quedando mucho mas compacto que el modo alfanumerico.
   // Eso deja barras mas anchas (mejor lectura con el escaner) sin
   // salirse del ancho seguro del ticket. El texto abajo del codigo
   // sigue mostrando el folio completo con la "V-" para referencia.
   const soloDigitos =
   String(datos.folio || "").replace(/\D/g, "") || String(datos.folio || "");

   JsBarcode(svg, soloDigitos, {
    format: "CODE128",
    width: 2,
    height: 40,
    fontSize: 12,
    margin: 4,
    displayValue: true,
    text: String(datos.folio || "")
   });

   svg.setAttribute("style", "max-width:100%;height:auto;");

   codigoBarrasHtml = `<div style="margin-top:10px;text-align:center;">${svg.outerHTML}</div>`;
  } catch (error) {
   console.warn("No se pudo generar el codigo de barras del ticket", error);
  }
 }

 const offlineHtml =
 datos.ventaOffline
 ? `<div style="text-align:center;margin-top:6px;"><small style="font-weight:bold;">PENDIENTE DE SINCRONIZAR</small></div>`
 : "";

 return `
 <div>
  <div style="text-align:${alineacionEncabezado};margin-bottom:8px;">
   ${logoHtml}
   ${nombreHtml}
   ${subtituloHtml}
   ${insigniaHtml}
   <div style="margin-top:6px;">${escaparPOS(datos.fecha || "")}</div>
   ${datos.folio ? `<div><strong>Folio ${escaparPOS(datos.folio)}</strong></div>` : ""}
   ${cajeroHtml}
   ${clienteHtml}
   ${obraHtml}
  </div>

  <hr>

  ${tablaProductosHtml}

  <hr>

  ${subtotalHtml}
  ${ivaHtml}

  <div style="display:flex;justify-content:space-between;font-weight:bold;">
   <span>TOTAL</span>
   <span>${dinero(datos.total || 0)}</span>
  </div>

  ${pagoHtml}
  ${firmaHtml}
  ${observacionesHtml}

  <hr>

  ${mensajeHtml}
  ${offlineHtml}

  <hr>

  <div style="text-align:center;">
   ${direccionHtml}
   ${telefonoHtml}
   ${sitioWebHtml}
   ${redesHtml}
  </div>

  ${codigoBarrasHtml}

  <div style="margin-top:12px;font-size:9px;color:#999;text-align:center;">Con la tecnologia de Nexo POS</div>
 </div>
 `;
}

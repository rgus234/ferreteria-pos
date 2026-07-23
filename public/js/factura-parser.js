/* Lector compartido de facturas de proveedor (XML CFDI y CSV).
   Puro: no toca el DOM ni estado global, solo recibe texto y regresa
   {documento, conceptos}. Usado por Recepcion de mercancia
   (ferretero-flow.js, compara contra inventario completo) y por la
   recepcion de un pedido a proveedor (fase4.js, compara contra las
   partidas de ese pedido) -- misma logica de lectura, cada pantalla
   decide contra que comparar los conceptos resultantes. */

function facturaParserNumero(valor) {
 const n = Number(String(valor ?? "").replace(/[$,\s]/g, ""));
 return Number.isFinite(n) ? n : 0;
}

function facturaParserCodigoLimpio(valor) {
 if (typeof normalizarCodigo === "function") return normalizarCodigo(valor);
 return String(valor || "").replace(/[^a-zA-Z0-9]/g, "").trim();
}

function facturaParserSepararCsvLinea(linea) {
 const partes = [];
 let actual = "";
 let comillas = false;
 for (const char of linea) {
  if (char === '"') { comillas = !comillas; continue; }
  if ((char === "," || char === ";") && !comillas) {
   partes.push(actual.trim());
   actual = "";
  } else {
   actual += char;
  }
 }
 partes.push(actual.trim());
 return partes;
}

function facturaParserIndicePorEncabezado(headers, patrones) {
 return headers.findIndex(h => patrones.some(p => p.test(h)));
}

function parsearFacturaXmlCfdi(texto) {
 const doc = new DOMParser().parseFromString(texto, "text/xml");
 const error = doc.querySelector("parsererror");
 if (error) throw new Error("XML invalido");

 const comprobante = doc.getElementsByTagNameNS("*", "Comprobante")[0] || doc.getElementsByTagName("cfdi:Comprobante")[0] || doc.documentElement;
 const emisor = doc.getElementsByTagNameNS("*", "Emisor")[0] || doc.getElementsByTagName("cfdi:Emisor")[0];
 const proveedor = emisor?.getAttribute("Nombre") || emisor?.getAttribute("Rfc") || "";
 const impuestos = doc.getElementsByTagNameNS("*", "Impuestos")[0] || doc.getElementsByTagName("cfdi:Impuestos")[0];
 const fechaXml = comprobante?.getAttribute("Fecha") || "";

 const documento = {
  tipo: "Factura",
  proveedor,
  folio: comprobante?.getAttribute("Folio") || comprobante?.getAttribute("Serie") || "",
  fecha: fechaXml ? fechaXml.slice(0, 10) : "",
  subtotal: facturaParserNumero(comprobante?.getAttribute("SubTotal") || 0),
  iva: facturaParserNumero(impuestos?.getAttribute("TotalImpuestosTrasladados") || 0),
  total: facturaParserNumero(comprobante?.getAttribute("Total") || 0)
 };

 // getElementsByTagNameNS("*", "Concepto") ya encuentra los nodos en
 // cualquier XML con namespace bien declarado (el caso real de un CFDI
 // valido). El fallback a "cfdi:Concepto" es solo para documentos que
 // no declaran namespace -- si se concatenan ambos resultados en un
 // XML normal, el mismo nodo aparece dos veces (mismo local-name,
 // ambas consultas lo encuentran) y cada concepto se duplica.
 const porNamespace = doc.getElementsByTagNameNS("*", "Concepto");
 const nodos = porNamespace.length ? Array.from(porNamespace) : Array.from(doc.getElementsByTagName("cfdi:Concepto"));

 const conceptos = nodos.map(nodo => ({
  codigo: facturaParserCodigoLimpio(nodo.getAttribute("NoIdentificacion") || nodo.getAttribute("ClaveProdServ") || ""),
  descripcion: nodo.getAttribute("Descripcion") || "Producto sin descripcion",
  cantidad: facturaParserNumero(nodo.getAttribute("Cantidad") || 1),
  costo: facturaParserNumero(nodo.getAttribute("ValorUnitario") || 0),
  importe: facturaParserNumero(nodo.getAttribute("Importe") || 0),
  unidad: nodo.getAttribute("Unidad") || nodo.getAttribute("ClaveUnidad") || "pieza"
 })).filter(item => item.descripcion || item.codigo);

 return { documento, conceptos };
}

function parsearFacturaCsv(texto) {
 const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
 if (!lineas.length) return { documento: {}, conceptos: [] };

 const headersRaw = facturaParserSepararCsvLinea(lineas[0]);
 const headers = headersRaw.map(h => h.toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), ""));
 const idxCodigo = facturaParserIndicePorEncabezado(headers, [/codigo/, /clave/, /sku/, /no.?ident/]);
 const idxDesc = facturaParserIndicePorEncabezado(headers, [/descripcion/, /producto/, /nombre/, /concepto/]);
 const idxCant = facturaParserIndicePorEncabezado(headers, [/cantidad/, /cant/, /existencia/]);
 const idxCosto = facturaParserIndicePorEncabezado(headers, [/valor.?unit/, /costo/, /precio/, /unitario/]);
 const idxImporte = facturaParserIndicePorEncabezado(headers, [/importe/, /total/]);
 const idxUnidad = facturaParserIndicePorEncabezado(headers, [/unidad/, /medida/]);
 const idxFolio = facturaParserIndicePorEncabezado(headers, [/folio/, /factura/, /documento/]);
 const idxFecha = facturaParserIndicePorEncabezado(headers, [/fecha/]);
 const idxProveedor = facturaParserIndicePorEncabezado(headers, [/proveedor/, /emisor/]);

 const primera = facturaParserSepararCsvLinea(lineas[1] || "");
 const documento = {
  proveedor: idxProveedor >= 0 ? primera[idxProveedor] || "" : "",
  folio: idxFolio >= 0 ? primera[idxFolio] || "" : "",
  fecha: idxFecha >= 0 ? primera[idxFecha] || "" : ""
 };

 const conceptos = lineas.slice(1).map(linea => {
  const cols = facturaParserSepararCsvLinea(linea);
  return {
   codigo: facturaParserCodigoLimpio(cols[idxCodigo] || ""),
   descripcion: cols[idxDesc] || cols[1] || "Producto sin descripcion",
   cantidad: facturaParserNumero(cols[idxCant] || 1),
   costo: facturaParserNumero(cols[idxCosto] || 0),
   importe: facturaParserNumero(cols[idxImporte] || 0),
   unidad: cols[idxUnidad] || "pieza"
  };
 }).filter(item => item.descripcion || item.codigo);

 return { documento, conceptos };
}

window.parsearFacturaXmlCfdi = parsearFacturaXmlCfdi;
window.parsearFacturaCsv = parsearFacturaCsv;

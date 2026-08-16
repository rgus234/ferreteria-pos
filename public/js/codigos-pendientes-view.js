// Pantalla "Codigos pendientes" -- lista los productos cuyo codigo
// guardado no tiene forma de codigo de barras real (llegaron de una
// importacion masiva de un proveedor -- Truper/Diprofer/Gafi -- cuyo
// archivo solo trae su clave interna, nunca el EAN real). Deja
// escanear/teclear el codigo real en cualquier orden: se selecciona un
// renglon con un clic (o se usa el primero pendiente por default) y el
// siguiente codigo que llegue -- por teclado normal o por el lector
// USB, que en esta pantalla no necesita nada especial porque el campo
// de captura siempre esta enfocado -- se guarda ahi mismo y avanza
// solo al siguiente pendiente.

let codigosPendientesSeleccionadoId = null;
const codigosPendientesCompletadosSesion = new Set();

// No existe ninguna bandera en la base que diga "este codigo es
// provisional" -- un EAN/UPC real siempre es puramente numerico y de
// 8, 12, 13 o 14 digitos; las claves internas de los proveedores son
// mas cortas o traen letras (ej. "12710", "CTF12", "HTA95").
function codigoPareceBarraReal(codigo) {
 return /^\d{8}$|^\d{12,14}$/.test(String(codigo || "").trim());
}

function codigosPendientesLista() {
 return (todosProductos || [])
 .filter(p => !codigoPareceBarraReal(p.codigo))
 .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
}

async function mostrarCodigosPendientes() {
 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

 const pantalla =
 document.getElementById("pantallaCodigosPendientes");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto(
 "Codigos pendientes",
 "Escanea el codigo de barras real de cada producto -- no importa el orden",
 "codigos-pendientes"
 );
 }

 codigosPendientesSeleccionadoId = null;
 renderCodigosPendientes();
}

// Un renglon desaparece de la lista solo (recalculada desde
// todosProductos, ver codigosPendientesLista) en cuanto su codigo
// cambia a algo con forma de codigo de barras real -- no hace falta
// marcarlo "listo" aparte, el progreso ya se ve en que la lista
// encoge y en el contador de la sesion.
function filaCodigoPendienteHtml(producto, activo) {
 return `
 <div class="codpend-fila${activo ? " activo" : ""}" data-codpend-id="${producto.id}">
  <div class="codpend-fila-info">
   <strong>${escaparPOS(producto.nombre)}</strong>
   <span>${escaparPOS(producto.marca || producto.categoria || "")}</span>
  </div>
  <span class="codpend-fila-clave">${escaparPOS(producto.codigo || "sin codigo")}</span>
 </div>
 `;
}

function renderCodigosPendientes() {
 const pantalla =
 document.getElementById("pantallaCodigosPendientes");

 if (!pantalla) return;

 const pendientes =
 codigosPendientesLista();

 if (!pendientes.some(p => p.id === codigosPendientesSeleccionadoId)) {
 codigosPendientesSeleccionadoId =
 pendientes.length > 0 ? pendientes[0].id : null;
 }

 const seleccionado =
 pendientes.find(p => p.id === codigosPendientesSeleccionadoId) || null;

 pantalla.innerHTML = `
 <div class="caja codpend-shell">
  <h2>Codigos de barras pendientes</h2>
  <p class="codpend-ayuda">
   Estos productos se dieron de alta sin un codigo de barras real (llegaron de una importacion del proveedor).
   Selecciona uno de la lista y escanea el codigo de barras real del producto que tienes en la mano -- se guarda solo,
   sin importar el orden en que los vayas escaneando.
  </p>

  ${pendientes.length === 0 ? `
  <div class="codpend-vacio">
   <strong>No hay codigos pendientes.</strong>
   <span>Todos tus productos ya tienen un codigo de barras con forma valida.</span>
  </div>
  ` : `
  <div class="codpend-layout">
   <div class="codpend-lista" id="codpendLista">
    ${pendientes.map(p => filaCodigoPendienteHtml(p, p.id === codigosPendientesSeleccionadoId)).join("")}
   </div>

   <div class="codpend-panel">
    <div class="codpend-seleccion">
     <span class="codpend-seleccion-etiqueta">Escaneando para</span>
     <strong>${seleccionado ? escaparPOS(seleccionado.nombre) : "Selecciona un producto"}</strong>
     ${seleccionado ? `<span class="codpend-seleccion-clave">Clave actual: ${escaparPOS(seleccionado.codigo || "(sin codigo)")}</span>` : ""}
    </div>

    <label class="codpend-input-label">Codigo de barras
     <input type="text" id="codpendInput" placeholder="Escanea aqui o teclea y presiona Enter" autocomplete="off" ${seleccionado ? "" : "disabled"}>
    </label>

    <p class="codpend-progreso">${codigosPendientesCompletadosSesion.size} completados en esta sesion -- quedan ${pendientes.length}</p>
   </div>
  </div>
  `}
 </div>
 `;

 const input =
 document.getElementById("codpendInput");

 if (input) {
 input.focus();

 input.onkeydown = event => {
  if (event.key !== "Enter") return;
  event.preventDefault();

  const codigo = input.value;
  input.value = "";
  guardarCodigoPendiente(codigo);
 };
 }

 document.querySelectorAll("[data-codpend-id]").forEach(fila => {
 fila.onclick = () => {
  codigosPendientesSeleccionadoId = Number(fila.dataset.codpendId);
  renderCodigosPendientes();
 };
 });
}

function avanzarAlSiguientePendienteCodigos() {
 const pendientes =
 codigosPendientesLista();

 const siguiente =
 pendientes.find(p => p.id !== codigosPendientesSeleccionadoId) || pendientes[0] || null;

 codigosPendientesSeleccionadoId =
 siguiente ? siguiente.id : null;

 renderCodigosPendientes();
}

// Mismo criterio que productoPayloadDesdeExistente() (ferretero-flow.js):
// reconstruye TODOS los campos que PUT /editar-producto/:id exige a
// partir del producto ya cargado en todosProductos, cambiando solo el
// codigo -- nombre/precio/stock no tienen fallback en el servidor, asi
// que mandarlos vacios los borraria.
function codigosPendientesPayloadDesdeExistente(producto, codigoNuevo) {
 return {
 nombre: producto.nombre,
 precio: producto.precio,
 stock: producto.stock,
 codigo: codigoNuevo,
 proveedor: producto.proveedor || "",
 ubicacion: producto.ubicacion || "",
 categoria: producto.categoria || "",
 subcategoria: producto.subcategoria || "",
 categoriaNexoId: producto.categoria_nexo_id || null,
 marca: producto.marca || "",
 descripcion: producto.descripcion || "",
 unidadVenta: producto.unidad_venta || "pieza",
 precioDistribuidor: producto.precio_distribuidor ?? "",
 precioMayoreo: producto.precio_mayoreo ?? "",
 precioPublico: producto.precio_publico ?? producto.precio,
 stockMinimo: producto.stock_minimo ?? 3,
 altaRotacion: producto.alta_rotacion || "",
 tipoProducto: producto.tipo_producto || "catalogo",
 presentacionCompra: producto.presentacion_compra || "",
 factorConversion: producto.factor_conversion ?? "",
 basculaDigital: producto.bascula_digital || "no",
 codigosRelacionados: (producto.codigos_relacionados || []).map(c => c.codigo).filter(Boolean),
 permiteVentaPieza: Boolean(producto.permite_venta_pieza),
 unidadSuelta: producto.unidad_suelta || "pieza",
 piezasPorBolsa: producto.piezas_por_bolsa ?? "",
 precioPieza: producto.precio_pieza ?? "",
 tieneGarantia: Boolean(producto.tiene_garantia),
 garantiaDetalle: producto.garantia_detalle || "",
 stockMaximo: producto.stock_maximo ?? "",
 peso: producto.peso ?? "",
 largoCm: producto.largo_cm ?? "",
 anchoCm: producto.ancho_cm ?? "",
 altoCm: producto.alto_cm ?? "",
 notasInternas: producto.notas_internas || "",
 admiteCambios: producto.admite_cambios !== false,
 destacado: Boolean(producto.destacado),
 precioOferta: producto.precio_oferta ?? ""
 };
}

async function guardarCodigoPendiente(codigoCrudo) {
 const codigo =
 normalizarCodigo(codigoCrudo);

 if (!codigo || codigo.length < 4) {
 mostrarToastPOS("El codigo escaneado parece muy corto, intenta de nuevo.", { tipo: "alerta" });
 return;
 }

 const producto =
 (todosProductos || []).find(p => p.id === codigosPendientesSeleccionadoId);

 if (!producto) {
 mostrarToastPOS("Selecciona un producto de la lista antes de escanear.", { tipo: "alerta" });
 return;
 }

 // Reescaneo del mismo producto con el mismo codigo que ya tiene --
 // no pasa nada, se confirma y ya (idempotente, como se pidio).
 if (normalizarCodigo(producto.codigo) === codigo) {
 mostrarToastPOS(`"${producto.nombre}" ya tenia este codigo guardado.`, { tipo: "info", titulo: "Sin cambios" });
 codigosPendientesCompletadosSesion.add(producto.id);
 avanzarAlSiguientePendienteCodigos();
 return;
 }

 const duplicado =
 typeof buscarProductoPorCodigo === "function" ? buscarProductoPorCodigo(codigo) : null;

 if (duplicado && duplicado.id !== producto.id) {
 mostrarToastPOS(`Este codigo ya es de "${duplicado.nombre}" -- revisa que no sea el producto equivocado.`, { tipo: "peligro", titulo: "Codigo duplicado" });
 return;
 }

 const payload =
 codigosPendientesPayloadDesdeExistente(producto, codigo);

 try {
 const respuesta =
 await fetch(`/editar-producto/${producto.id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
 });

 const datos =
 await respuesta.json();

 if (!datos.success) {
  mostrarToastPOS(datos.error || "No se pudo guardar el codigo.", { tipo: "peligro" });
  return;
 }

 producto.codigo = codigo;
 codigosPendientesCompletadosSesion.add(producto.id);

 mostrarToastPOS(`"${producto.nombre}": codigo guardado.`, { tipo: "exito", titulo: "Listo", autoDismiss: 1800 });

 avanzarAlSiguientePendienteCodigos();
 } catch (error) {
 mostrarToastPOS("Error de conexion, intenta de nuevo.", { tipo: "peligro" });
 }
}

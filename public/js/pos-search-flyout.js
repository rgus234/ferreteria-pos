/* Buscador flyout de Punto de venta: reemplaza la cuadricula fija de productos
   por una lista flotante de resultados debajo del buscador. */
(function instalarFlyoutBusquedaPOS() {
 if (window.__posSearchFlyoutInstalado) return;
 window.__posSearchFlyoutInstalado = true;

 function contenedorFlyout() {
  return document.getElementById("posSearchFlyout");
 }

 function ocultarFlyoutBusquedaPOS() {
  const contenedor =
  contenedorFlyout();

  if (!contenedor) return;

  contenedor.classList.remove("abierto");
  contenedor.innerHTML = "";
 }

 window.ocultarFlyoutBusquedaPOS = ocultarFlyoutBusquedaPOS;

 function filaFlyout(producto) {
  const unidad =
  typeof unidadProducto === "function" ? unidadProducto(producto) : (producto.unidadVenta || "pieza");

  const codigo =
  producto.codigo || producto.codigo_barras || producto.codigoInterno || `PROD-${producto.id}`;

  // Sugerencias del catalogo de proveedor (IA-6) no son productos
  // reales del inventario todavia -- sin id util, sin boton de
  // agregar (ver "Fuera de alcance" en el plan de IA-6).
  if (producto.__origenCatalogo) {
   return `
   <div class="pos-flyout-row pos-flyout-row-catalogo">
    <span class="pos-flyout-thumb">🧰</span>
    <div class="pos-flyout-info">
     <strong>${escaparPOS(producto.nombre || "Producto")}</strong>
     <small>${escaparPOS(producto.marca || "")}${producto.marca ? " &middot; " : ""}Del catalogo de proveedor -- aun no esta en tu inventario</small>
    </div>
    <strong class="pos-flyout-precio">$${Number(producto.precio || 0).toFixed(2)}</strong>
   </div>
   `;
  }

  return `
  <div class="pos-flyout-row" data-flyout-id="${Number(producto.id)}">
   <span class="pos-flyout-thumb">${typeof miniaturaProducto === "function" ? miniaturaProducto(producto, "pos-flyout-thumb-img") : "🧰"}</span>
   <div class="pos-flyout-info">
    <strong>${escaparPOS(producto.nombre || "Producto")}</strong>
    <small>${escaparPOS(producto.marca || "")}${producto.marca ? " &middot; " : ""}Codigo ${escaparPOS(codigo)} &middot; Stock ${escaparPOS(producto.stock ?? 0)} ${escaparPOS(unidad)}</small>
   </div>
   <strong class="pos-flyout-precio">$${Number(producto.precio || 0).toFixed(2)}</strong>
   <button type="button" class="pos-flyout-agregar" onclick="agregarDesdeFlyoutPOS(${Number(producto.id)}); event.stopPropagation();">
    Agregar
   </button>
  </div>
  `;
 }

 async function agregarDesdeFlyoutPOS(id) {
  const producto =
  typeof todosProductos !== "undefined"
   ? todosProductos.find(p => Number(p.id) === Number(id))
   : null;

  if (producto?.permite_venta_pieza) {
   const eleccion =
   await pedirModoVentaPOS(producto);

   if (!eleccion) return;

   agregarProductoPorId(id, { modoVenta: eleccion.modo, cantidadInicial: eleccion.cantidad });
  } else {
   agregarProductoPorId(id);
  }

  const campo =
  document.getElementById("busqueda");

  if (campo) campo.value = "";

  ocultarFlyoutBusquedaPOS();

  setTimeout(() => campo?.focus(), 50);
 }

 window.agregarDesdeFlyoutPOS = agregarDesdeFlyoutPOS;

 function mostrarFlyoutBusquedaPOS(productos, opciones = {}) {
  const contenedor =
  contenedorFlyout();

  if (!contenedor) return;

  const lista =
  Array.isArray(productos) ? productos : [];

  if (!lista.length) {
   contenedor.innerHTML = `<div class="pos-flyout-vacio">${escaparPOS(opciones.textoVacio || "Sin resultados")}</div>`;
   contenedor.classList.add("abierto");
   return;
  }

  const destacados =
  lista
  .slice()
  .sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0))
  .slice(0, 8);

  const nota =
  opciones.nota ? `<div class="pos-flyout-nota">${escaparPOS(opciones.nota)}</div>` : "";

  contenedor.innerHTML =
  nota + destacados.map(filaFlyout).join("");

  contenedor.classList.add("abierto");
 }

 window.mostrarFlyoutBusquedaPOS = mostrarFlyoutBusquedaPOS;

 document.addEventListener("click", event => {
  const contenedor =
  contenedorFlyout();

  if (!contenedor || !contenedor.classList.contains("abierto")) return;

  const dentro =
  event.target.closest(".pos-search-wrap");

  if (!dentro) ocultarFlyoutBusquedaPOS();
 });

 document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;

  const contenedor =
  contenedorFlyout();

  if (contenedor && contenedor.classList.contains("abierto")) {
   ocultarFlyoutBusquedaPOS();
  }
 });
})();

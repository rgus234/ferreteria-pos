/* Panel "Ver detalles" de producto: informacion completa de solo lectura
   mas la foto principal y galeria (si el producto tiene fotos importadas).
   Sigue el mismo patron de modal ya usado en el resto del POS. */

async function verDetalleProducto(id) {
 const producto =
 todosProductos.find(p => Number(p.id) === Number(id));

 if (!producto) return;

 let modal =
 document.getElementById("modalDetalleProductoPOS");

 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalDetalleProductoPOS";
  modal.className = "modal-personalizado modal-detalle-producto";
  document.body.appendChild(modal);
 }

 const unidad =
 typeof unidadProducto === "function" ? unidadProducto(producto) : (producto.unidad_venta || "pieza");

 const stockTexto =
 typeof formatearCantidad === "function"
 ? formatearCantidad(producto.stock, unidad)
 : `${producto.stock ?? 0} ${unidad}`;

 const imagenPrincipal =
 producto.imagenUrl
 ? `<img id="detalleProductoImgPrincipal" src="${producto.imagenUrl}" alt="">`
 : `<div class="detalle-producto-sin-foto">${iconoProducto(producto.nombre)}<span>Sin foto todavia</span></div>`;

 modal.innerHTML = `
 <div class="modal-card detalle-producto-card">
  <div class="modal-card-header">
   <div>
    <span>Ver detalles</span>
    <h3>${escaparPOS(producto.nombre || "")}</h3>
   </div>
   <button type="button" class="detalle-producto-cerrar" data-accion="cerrar">Cerrar</button>
  </div>

  <div class="detalle-producto-body">
   <div class="detalle-producto-imagen">
    ${imagenPrincipal}
    <div id="detalleProductoGaleria" class="detalle-producto-galeria"></div>
   </div>

   <div class="cuenta-datos-grid detalle-producto-datos">
    <div><span>Codigo</span><strong>${escaparPOS(producto.codigo || "-")}</strong></div>
    <div><span>Marca</span><strong>${escaparPOS(producto.marca || "-")}</strong></div>
    <div><span>Categoria</span><strong>${escaparPOS(producto.categoria || "-")}</strong></div>
    <div><span>Subcategoria</span><strong>${escaparPOS(producto.subcategoria || "-")}</strong></div>
    <div><span>Proveedor</span><strong>${escaparPOS(producto.proveedor || "-")}</strong></div>
    <div><span>Ubicacion</span><strong>${escaparPOS(producto.ubicacion || "-")}</strong></div>
    <div><span>Stock</span><strong>${escaparPOS(stockTexto)}</strong></div>
    <div><span>Precio publico</span><strong>$${Number(producto.precio_publico || producto.precio || 0).toFixed(2)}</strong></div>
    <div><span>Precio mayoreo</span><strong>$${Number(producto.precio_mayoreo || 0).toFixed(2)}</strong></div>
    <div><span>Precio distribuidor</span><strong>$${Number(producto.precio_distribuidor || 0).toFixed(2)}</strong></div>
   </div>
  </div>
 </div>
 `;

 modal.style.display = "flex";

 modal.querySelectorAll("[data-accion='cerrar']").forEach(boton => {
  boton.onclick = () => cerrarDetalleProducto();
 });

 if (producto.fotoCodigo) {
  cargarGaleriaDetalleProducto(producto.fotoCodigo);
 }
}

async function cargarGaleriaDetalleProducto(codigo) {
 try {
  const respuesta =
  await fetch(`/fotos-producto/${codigo}/galeria`);

  const datos =
  await respuesta.json();

  const contenedor =
  document.getElementById("detalleProductoGaleria");

  if (!contenedor || !datos.ok) return;

  contenedor.innerHTML = datos.imagenes.map(img =>
   `<button type="button" class="detalle-producto-galeria-item" onclick="cambiarImagenPrincipalDetalle('${img.url}')"><img src="${img.url}" alt=""></button>`
  ).join("");
 } catch (error) {
  console.warn("No se pudo cargar la galeria", error);
 }
}

function cambiarImagenPrincipalDetalle(url) {
 const img =
 document.getElementById("detalleProductoImgPrincipal");

 if (img) img.src = url;
}

function cerrarDetalleProducto() {
 const modal =
 document.getElementById("modalDetalleProductoPOS");

 if (modal) modal.style.display = "none";
}

document.addEventListener("keydown", event => {
 const modal =
 document.getElementById("modalDetalleProductoPOS");

 if (!modal || modal.style.display === "none") return;

 if (event.key === "Escape") {
  event.preventDefault();
  cerrarDetalleProducto();
 }
});

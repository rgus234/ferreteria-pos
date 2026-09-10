/* Panel "Ver detalles" de producto: informacion completa de solo lectura
   mas la foto principal y galeria (si el producto tiene fotos importadas).
   Sigue el mismo patron de modal ya usado en el resto del POS. */

async function verDetalleProducto(id) {
 const producto =
 todosProductos.find(p => Number(p.id) === Number(id));

 if (!producto) return;

 // Se resuelve una sola vez: la usan tanto la pantalla del cliente
 // (todas las fotos, no solo la principal) como la galeria de aqui
 // abajo, para no duplicar la consulta.
 const galeriaCompletaPromesa = resolverGaleriaVerDetalles(producto);

 // Pantalla del cliente: al abrir el detalle de un producto desde
 // Inventario tambien se manda a mostrar alla (mismo criterio que
 // Explorar Nexo y Punto de venta).
 if (typeof pantallaClienteMostrar === "function") {
  galeriaCompletaPromesa.then(fotos => {
   pantallaClienteMostrar({
    nombre: producto.nombre,
    foto: fotos[0] || producto.imagenUrl || null,
    fotos: fotos.length ? fotos : (producto.imagenUrl ? [producto.imagenUrl] : []),
    precio: producto.precio_publico ?? producto.precio,
    marca: producto.marca,
    origen: "inventario"
   });
  });
 }

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
    <button type="button" class="detalle-producto-proyectar" onclick="pantallaClienteAbrirProyeccion()" title="Proyectar a otra pantalla">📽️ Proyectar</button>
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

 cargarGaleriaDetalleProducto(producto, galeriaCompletaPromesa);
}

// Todas las fotos de este producto, en el mismo orden que se van a
// mostrar. La foto propia (si el negocio ya subio una) siempre manda
// como principal -- nunca se reemplaza. Pero antes el Banco de Nexo /
// catalogo del fabricante solo se consultaba cuando NO habia ninguna
// foto propia: la mayoria de los productos con foto propia solo
// tienen esa (nadie sube una galeria a mano en fotos_producto_galeria),
// asi que en la practica "Ver detalles" casi nunca mostraba mas de una
// foto aunque el resto del POS (Explorar Nexo, Proyectar) ya tuviera
// varias para ese mismo codigo. Ahora, si la galeria PROPIA esta
// vacia, se completa con el banco/fabricante igual -- mismo criterio
// que ya usa la ficha publica de Nexo Market.
async function resolverGaleriaVerDetalles(producto) {
 let propias = [];

 if (producto.imagenUrl && producto.fotoCodigo) {
  try {
   const respuesta = await fetch(`/fotos-producto/${producto.fotoCodigo}/galeria`);
   const datos = await respuesta.json();
   propias = datos.ok && Array.isArray(datos.imagenes) ? datos.imagenes.map(img => img.url) : [];
  } catch (error) {
   propias = [];
  }
 }

 if (propias.length > 0) {
  return [producto.imagenUrl, ...propias];
 }

 const galeriaBanco = producto.codigo && typeof explorarNexoResolverGaleria === "function"
  ? await explorarNexoResolverGaleria(producto.codigo)
  : [];

 // Con foto propia pero sin galeria: la propia se queda de principal,
 // el banco solo aporta vistas adicionales (nunca la reemplaza).
 return producto.imagenUrl ? [producto.imagenUrl, ...galeriaBanco] : galeriaBanco;
}

async function cargarGaleriaDetalleProducto(producto, galeriaCompletaPromesa) {
 try {
  const fotos = await galeriaCompletaPromesa;
  if (!fotos.length) return;

  // Sin foto propia, el modal se pinto con el placeholder de "Sin foto
  // todavia" -- si el banco/fabricante si tiene una, se reemplaza por
  // la primera foto real y el resto se vuelve la galeria de abajo.
  if (!producto.imagenUrl) {
   const placeholder = document.querySelector(".detalle-producto-imagen .detalle-producto-sin-foto");
   if (placeholder) {
    const img = document.createElement("img");
    img.id = "detalleProductoImgPrincipal";
    img.src = fotos[0];
    img.alt = "";
    placeholder.replaceWith(img);
   }
  }

  const extras = fotos.slice(1);

  const contenedor =
  document.getElementById("detalleProductoGaleria");

  if (!contenedor || !extras.length) return;

  contenedor.innerHTML = extras.map(url =>
   `<button type="button" class="detalle-producto-galeria-item" data-detalle-foto="${escaparPOS(url)}"><img src="${url}" alt=""></button>`
  ).join("");

  contenedor.addEventListener("click", event => {
   const boton = event.target.closest("[data-detalle-foto]");
   if (boton) cambiarImagenPrincipalDetalle(boton.dataset.detalleFoto);
  });
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

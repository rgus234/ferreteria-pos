window.mostrarInventarioBajo = async function() {
 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

 const pantalla = document.getElementById("pantallaInventarioBajo");
 if (pantalla) pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Inventario bajo", "Alertas y sugerencias para reabastecer", "inventario-bajo");
 }

 if (!Array.isArray(todosProductos) || !todosProductos.length) {
  try { await cargarProductos(); } catch (error) { console.warn(error); }
 }

 renderInventarioBajo();
};

function productosBajoStock() {
 const texto =
 (document.getElementById("buscarInventarioBajo")?.value || "")
 .toLowerCase()
 .trim();

 const bajos =
 todosProductos.filter(
 producto =>
 Number(producto.stock) <= 5
 );

 if (!texto) return bajos;

 return bajos.filter(producto =>
 String(producto.codigo || "").toLowerCase().includes(texto)
 ||
 String(producto.nombre || "").toLowerCase().includes(texto)
 ||
 String(producto.proveedor || "").toLowerCase().includes(texto)
 );
}

function renderInventarioBajo(resetearPagina = true) {
 const tabla =
 document.getElementById("tablaInventarioBajo");

 if (!tabla) return;

 if (resetearPagina) {
 paginaInventarioBajo = 1;
 }

 const bajos =
 productosBajoStock();

 const todosBajos =
 todosProductos.filter(
 producto =>
 Number(producto.stock) <= 5
 );

 const sinStock =
 todosBajos.filter(
 producto =>
 Number(producto.stock) <= 0
 );

 const reposicion =
 todosBajos.reduce(
 (total, producto) =>
 total + Math.max(0, 10 - Number(producto.stock || 0)),
 0
 );

 document.getElementById("bajoTotal").textContent =
 todosBajos.length;

 document.getElementById("bajoSinStock").textContent =
 sinStock.length;

 document.getElementById("bajoReposicion").textContent =
 reposicion;

 // Menu simplificado: tarjetas con foto en lugar de la tabla de siempre
 if (document.body.classList.contains("menu-simple")) {
  renderInventarioBajoTarjetas(bajos);
  return;
 }

 document.getElementById("bajoTarjetas")?.remove();

 if (bajos.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="bajo-vacio">
 No hay productos bajos con ese filtro.
 </td>
 </tr>
 `;
 renderPaginacion(
 "paginacionInventarioBajo",
 0,
 1,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaInventarioBajo"
 );
 return;
 }

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(bajos.length / TAMANO_PAGINA_INVENTARIO)
 );

 paginaInventarioBajo =
 Math.min(paginaInventarioBajo, totalPaginas);

 const inicio =
 (paginaInventarioBajo - 1) * TAMANO_PAGINA_INVENTARIO;

 const bajosPagina =
 bajos.slice(
 inicio,
 inicio + TAMANO_PAGINA_INVENTARIO
 );

 tabla.innerHTML =
 bajosPagina.map(producto => {
 const stock =
 Number(producto.stock || 0);

 const estado =
 stock <= 0
 ? "Sin existencia"
 : stock <= 2
 ? "Critico"
 : "Bajo";

 const clase =
 stock <= 0
 ? "sin-stock"
 : stock <= 2
 ? "critico"
 : "bajo";

 return `
 <tr>
 <td>
 <strong>${producto.nombre}</strong>
 <span>${dinero(producto.precio || 0)}</span>
 </td>
 <td>${producto.codigo || "-"}</td>
 <td>${producto.proveedor || "-"}</td>
 <td>
 <strong class="stock-bajo-numero">${stock}</strong>
 </td>
 <td>
 <span class="estado-bajo ${clase}">
 ${estado}
 </span>
 </td>
 <td class="acciones-bajo">
 <button onclick="abrirModalInventarioBajo(${producto.id})">
 Detalle
 </button>
 <button onclick="mostrarInventario(); document.getElementById('buscarInventario').value='${producto.nombre.replace(/'/g, "")}'; buscarInventario();">
 Ver
 </button>
 </td>
 </tr>
 `;
 }).join("");

 renderPaginacion(
 "paginacionInventarioBajo",
 bajos.length,
 paginaInventarioBajo,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaInventarioBajo"
 );
}

// Una tarjeta por producto: foto, cuanto queda (con color) y a quien se lo compras. Mismas acciones que la tabla.
function renderInventarioBajoTarjetas(bajos) {
 const tabla = document.getElementById("tablaInventarioBajo");
 const tablaCompleta = tabla.closest("table");
 let caja = document.getElementById("bajoTarjetas");

 if (!caja) {
  caja = document.createElement("div");
  caja.id = "bajoTarjetas";
  caja.className = "bajo-tarjetas";
  tablaCompleta.insertAdjacentElement("beforebegin", caja);
 }

 tabla.innerHTML = "";

 const totalPaginas = Math.max(1, Math.ceil(bajos.length / TAMANO_PAGINA_INVENTARIO));
 paginaInventarioBajo = Math.min(paginaInventarioBajo, totalPaginas);
 const inicio = (paginaInventarioBajo - 1) * TAMANO_PAGINA_INVENTARIO;
 const pagina = bajos.slice(inicio, inicio + TAMANO_PAGINA_INVENTARIO);

 caja.innerHTML = pagina.length ? pagina.map(producto => {
  const stock = Number(producto.stock || 0);
  const clase = stock <= 0 ? "sin-stock" : stock <= 2 ? "critico" : "bajo";
  const estado = stock <= 0 ? "Sin existencia" : stock <= 2 ? "Casi se acaba" : "Está bajo";
  const foto = producto.imagenUrl
   ? `<img class="bajo-foto" src="${escaparPOS(producto.imagenUrl)}" alt="" loading="lazy">`
   : `<span class="bajo-foto bajo-foto-vacia" aria-hidden="true"></span>`;

  return `<article class="bajo-tarjeta ${clase}">
   ${foto}
   <div class="bajo-info">
    <strong>${escaparPOS(producto.nombre)}</strong>
    <span>${dinero(producto.precio || 0)}${producto.proveedor ? " · " + escaparPOS(producto.proveedor) : ""}</span>
    <em class="estado-bajo ${clase}">${estado}</em>
   </div>
   <div class="bajo-cantidad"><b>${stock}</b><small>quedan</small></div>
   <div class="bajo-botones">
    <button type="button" onclick="editarProducto(${producto.id})">Editar</button>
    <button type="button" class="bajo-secundario" onclick="abrirModalInventarioBajo(${producto.id})">Detalle</button>
   </div>
  </article>`;
 }).join("") : `<p class="bajo-vacio">No hay productos bajos con ese filtro.</p>`;

 renderPaginacion("paginacionInventarioBajo", bajos.length, paginaInventarioBajo, TAMANO_PAGINA_INVENTARIO, "cambiarPaginaInventarioBajo");
}

function asegurarModalInventarioBajo() {
 let modal =
 document.getElementById("modalInventarioBajoDetalle");

 if (modal) return modal;

 modal = document.createElement("div");
 modal.id = "modalInventarioBajoDetalle";
 modal.className = "modal-personalizado modal-inventario-bajo";
 modal.style.display = "none";
 document.body.appendChild(modal);
 return modal;
}

function abrirModalInventarioBajo(id) {
 const producto =
 todosProductos.find(item => Number(item.id) === Number(id));

 if (!producto) return;

 const stock =
 Number(producto.stock || 0);

 const minimo =
 Number(producto.stock_minimo ?? producto.stockMinimo ?? 5);

 const sugerido =
 Math.max(1, minimo * 2 - stock);

 const modal =
 asegurarModalInventarioBajo();

 modal.innerHTML = `
 <div class="modal-card inventario-bajo-card">
 <div class="modal-card-header">
 <div>
 <span>Inventario bajo</span>
 <h3>${producto.nombre || "Producto"}</h3>
 </div>
 <button type="button" onclick="cerrarModalInventarioBajo()">Cerrar</button>
 </div>
 <div class="inventario-bajo-detalle">
 <div><span>Codigo</span><strong>${producto.codigo || "-"}</strong></div>
 <div><span>Proveedor</span><strong>${producto.proveedor || "-"}</strong></div>
 <div><span>Stock actual</span><strong>${stock} ${unidadProducto(producto)}</strong></div>
 <div><span>Minimo</span><strong>${minimo} ${unidadProducto(producto)}</strong></div>
 <div><span>Sugerido</span><strong>${sugerido} ${unidadProducto(producto)}</strong></div>
 <div><span>Precio</span><strong>${dinero(producto.precio || 0)}</strong></div>
 </div>
 <div class="modal-actions-row">
 <button type="button" onclick="cerrarModalInventarioBajo()">Cerrar</button>
 <button type="button" class="btn-principal" onclick="cerrarModalInventarioBajo(); editarProducto(${producto.id})">Editar producto</button>
 </div>
 </div>
 `;

 modal.style.display = "flex";
}

function cerrarModalInventarioBajo() {
 const modal =
 document.getElementById("modalInventarioBajoDetalle");

 if (modal) modal.style.display = "none";
}

function generarSugerenciaPedido() {
 // Con "Pedidos" encendido (abarrotes y ferreteria): el pedido sugerido es el de Pedidos (Autollenar, con fotos y por proveedor), no esta lista.
 if (typeof funcionBeta === "function" && funcionBeta("pedidos_unico") && typeof mostrarAutollenarPedido === "function") {
  mostrarAutollenarPedido();
  return;
 }

 const bajos =
 productosBajoStock();

 if (bajos.length === 0) {
 alertaPOS(
 "No hay productos bajos para sugerir pedido.",
 "Sugerencia de pedido",
 "info"
 );
 return;
 }

 const contenedor =
 document.getElementById("listaSugerenciaPedido");

 if (!contenedor) return;

 contenedor.innerHTML =
 bajos.map(producto => {
 const stock =
 Number(producto.stock || 0);

 const cantidad =
 Math.max(1, 10 - stock);

 return `
 <div class="pedido-item">
 <div>
 <strong>${producto.nombre}</strong>
 <span>${producto.codigo || "Sin codigo"} &middot; ${producto.proveedor || "Sin proveedor"}</span>
 </div>
 <div>
 <small>Stock actual</small>
 <b>${stock} ${unidadProducto(producto)}</b>
 </div>
 <div>
 <small>Pedir</small>
 <b>${cantidad} ${unidadProducto(producto)}</b>
 </div>
 </div>
 `;
 }).join("");

 document.getElementById("modalSugerenciaPedido").style.display =
 "flex";
}

function cerrarSugerenciaPedido() {
 document.getElementById("modalSugerenciaPedido").style.display =
 "none";
}

function imprimirSugerenciaPedido() {
 const contenido =
 document.getElementById("listaSugerenciaPedido");

 if (!contenido || !contenido.innerHTML.trim()) {
  alertaPOS("Genera primero una sugerencia de pedido.", "Imprimir pedido", "info");
  return;
 }

 const negocio =
 configuracionNegocio() || {};

 const ventana =
 window.open("", "_blank", "width=900,height=720");

 ventana.document.write(`
 <html>
 <head>
 <title>Pedido sugerido</title>
 <style>
 body{font-family:Arial,sans-serif;color:#111827;padding:24px;}
 h1{font-size:22px;margin:0 0 4px;}
 p{margin:0 0 18px;color:#475467;}
 table{width:100%;border-collapse:collapse;}
 th,td{border-bottom:1px solid #d0d5dd;padding:8px;text-align:left;font-size:12px;}
 .pedido-item{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:12px;border-bottom:1px solid #d0d5dd;padding:10px 0;}
 .pedido-item span,.pedido-item small{display:block;color:#667085;font-size:12px;}
 </style>
 </head>
 <body>
 <h1>${negocio.nombre || "Pedido sugerido"}</h1>
 <p>${new Date().toLocaleString("es-MX")}</p>
 ${contenido.innerHTML}
 <script>window.print();</script>
 </body>
 </html>
 `);
 ventana.document.close();
}

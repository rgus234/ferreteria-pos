const DIAS_ALERTA_CADUCIDAD = 30;

window.mostrarPorVencer = async function() {
 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

 const pantalla = document.getElementById("pantallaPorVencer");
 if (pantalla) pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Por vencer", "Productos con fecha de caducidad proxima o vencida", "por-vencer");
 }

 if (!Array.isArray(todosProductos) || !todosProductos.length) {
  try { await cargarProductos(); } catch (error) { console.warn(error); }
 }

 renderPorVencer();
};

function diasParaCaducar(producto) {
 if (!producto.fecha_caducidad) return null;

 const hoy = new Date();
 hoy.setHours(0, 0, 0, 0);

 const fecha =
 new Date(String(producto.fecha_caducidad).slice(0, 10) + "T00:00:00");

 return Math.round((fecha - hoy) / 86400000);
}

function productosPorVencerBase() {
 return todosProductos
 .filter(producto => {
 const dias = diasParaCaducar(producto);
 return dias !== null && dias <= DIAS_ALERTA_CADUCIDAD;
 })
 .sort((a, b) => diasParaCaducar(a) - diasParaCaducar(b));
}

function productosPorVencer() {
 const texto =
 (document.getElementById("buscarPorVencer")?.value || "")
 .toLowerCase()
 .trim();

 const proximos =
 productosPorVencerBase();

 if (!texto) return proximos;

 return proximos.filter(producto =>
 String(producto.codigo || "").toLowerCase().includes(texto)
 ||
 String(producto.nombre || "").toLowerCase().includes(texto)
 ||
 String(producto.proveedor || "").toLowerCase().includes(texto)
 );
}

function renderPorVencer(resetearPagina = true) {
 const tabla =
 document.getElementById("tablaPorVencer");

 if (!tabla) return;

 if (resetearPagina) {
 paginaPorVencer = 1;
 }

 const proximos =
 productosPorVencer();

 const todosProximos =
 productosPorVencerBase();

 const vencidos =
 todosProximos.filter(producto => diasParaCaducar(producto) < 0);

 const valorRiesgo =
 todosProximos.reduce(
 (total, producto) =>
 total + (Number(producto.stock || 0) * Number(producto.precio || 0)),
 0
 );

 document.getElementById("vencerTotal").textContent =
 todosProximos.length;

 document.getElementById("vencerVencidos").textContent =
 vencidos.length;

 document.getElementById("vencerValorRiesgo").textContent =
 dinero(valorRiesgo);

 if (proximos.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="bajo-vacio">
 No hay productos por vencer con ese filtro.
 </td>
 </tr>
 `;
 renderPaginacion(
 "paginacionPorVencer",
 0,
 1,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaPorVencer"
 );
 return;
 }

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(proximos.length / TAMANO_PAGINA_INVENTARIO)
 );

 paginaPorVencer =
 Math.min(paginaPorVencer, totalPaginas);

 const inicio =
 (paginaPorVencer - 1) * TAMANO_PAGINA_INVENTARIO;

 const proximosPagina =
 proximos.slice(
 inicio,
 inicio + TAMANO_PAGINA_INVENTARIO
 );

 tabla.innerHTML =
 proximosPagina.map(producto => {
 const dias =
 diasParaCaducar(producto);

 const estado =
 dias < 0
 ? "Vencido"
 : dias <= 7
 ? "Vence pronto"
 : "Por vencer";

 const clase =
 dias < 0
 ? "sin-stock"
 : dias <= 7
 ? "critico"
 : "bajo";

 const textoDias =
 dias < 0
 ? `Vencio hace ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"}`
 : dias === 0
 ? "Vence hoy"
 : `En ${dias} dia${dias === 1 ? "" : "s"}`;

 return `
 <tr>
 <td>
 <strong>${escaparPOS(producto.nombre)}</strong>
 <span>${dinero(producto.precio || 0)}</span>
 </td>
 <td>${escaparPOS(producto.codigo || "-")}</td>
 <td>${new Date(producto.fecha_caducidad).toLocaleDateString("es-MX")}</td>
 <td>
 <strong class="stock-bajo-numero">${Number(producto.stock || 0)} ${unidadProducto(producto)}</strong>
 </td>
 <td>
 <span class="estado-bajo ${clase}">
 ${estado}
 </span>
 <div>${textoDias}</div>
 </td>
 <td class="acciones-bajo">
 <button onclick="editarProducto(${producto.id})">
 Editar
 </button>
 <button data-buscar-nombre="${escaparPOS(producto.nombre)}" onclick="irABuscarEnInventarioPorVencer(this)">
 Ver
 </button>
 </td>
 </tr>
 `;
 }).join("");

 renderPaginacion(
 "paginacionPorVencer",
 proximos.length,
 paginaPorVencer,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaPorVencer"
 );
}

function cambiarPaginaPorVencer(pagina) {
 paginaPorVencer = pagina;
 renderPorVencer(false);
}

function irABuscarEnInventarioPorVencer(boton) {
 mostrarInventario();

 const campo =
 document.getElementById("buscarInventario");

 if (campo) campo.value = boton.dataset.buscarNombre || "";

 buscarInventario();
}

function mostrarGraficas() {
 ocultarPantallasPrincipales();
 document.getElementById("pantallaReportes").style.display = "block";
 paginaReporteVentas = 1;

 cargarReportesVentas();
}

let periodoReporteVentas = "dia";
let ultimoReporteVentas = null;
let categoriasReporteExpandido = false;

const MESES_REPORTE = [
 "enero", "febrero", "marzo", "abril", "mayo", "junio",
 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const PALETA_REPORTE = ["#0d6efd", "#8b5cf6", "#14b8a6", "#94a3b8", "#f59e0b", "#ef4444", "#22c55e", "#ec4899"];

function cambiarPeriodoReporteVentas(periodo) {
 periodoReporteVentas = periodo || "dia";
 paginaReporteVentas = 1;
 document.querySelectorAll("[data-reporte-periodo]").forEach(boton => {
  boton.classList.toggle("activo", boton.dataset.reportePeriodo === periodoReporteVentas);
 });
 cargarReportesVentas();
}

function colorMarcaReporte() {
 const valor = getComputedStyle(document.documentElement).getPropertyValue("--brand-color");
 return valor && valor.trim() ? valor.trim() : "#0d6efd";
}

function textoTendenciaReporte(actual, anterior) {
 const a = Number(actual || 0);
 const b = Number(anterior || 0);
 if (b <= 0) return a > 0 ? "Nuevo vs periodo anterior" : "Sin cambios vs periodo anterior";
 const porcentaje = ((a - b) / b) * 100;
 const signo = porcentaje >= 0 ? "+" : "";
 return signo + porcentaje.toFixed(1) + "% vs periodo anterior";
}

function claseTendenciaReporte(actual, anterior) {
 const a = Number(actual || 0);
 const b = Number(anterior || 0);
 if (b <= 0) return a > 0 ? "positiva" : "neutra";
 return a >= b ? "positiva" : "negativa";
}

function diaLargoReporte(diaCorto) {
 const partes = String(diaCorto || "").split("/");
 if (partes.length !== 2) return diaCorto || "-";
 const mes = MESES_REPORTE[Number(partes[1]) - 1];
 return mes ? Number(partes[0]) + " de " + mes : diaCorto;
}

function diasEnPeriodoReporte() {
 const hoy = new Date();

 if (periodoReporteVentas === "rango") {
  const desde = document.getElementById("reporteDesde")?.value || "";
  const hasta = document.getElementById("reporteHasta")?.value || "";
  if (!desde || !hasta) return 1;
  const inicio = new Date(desde);
  const fin = new Date(hasta);
  return Math.max(1, Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1);
 }

 if (periodoReporteVentas === "semana") {
  const diaSemana = (hoy.getDay() + 6) % 7;
  return diaSemana + 1;
 }

 if (periodoReporteVentas === "anio") {
  const inicioAnio = new Date(hoy.getFullYear(), 0, 1);
  return Math.round((hoy.getTime() - inicioAnio.getTime()) / 86400000) + 1;
 }

 if (periodoReporteVentas === "mes") {
  return hoy.getDate();
 }

 return 1;
}

async function cargarReportesVentas() {
 const params =
 new URLSearchParams();

 params.set("periodo", periodoReporteVentas || "dia");

 if (periodoReporteVentas === "rango") {
  const desde =
  document.getElementById("reporteDesde")?.value || "";

  const hasta =
  document.getElementById("reporteHasta")?.value || "";

  if (desde && hasta) {
   params.set("desde", desde);
   params.set("hasta", hasta);
  }
 }

 const respuesta =
 await fetch("/reportes/ventas?" + params.toString());

 if (!respuesta.ok) {
 alert("No se pudieron cargar los reportes");
 return;
 }

 const datos =
 await respuesta.json();

 ultimoReporteVentas = datos;
 categoriasReporteExpandido = false;

 const resumen =
 datos.resumen || {};

 const anterior =
 datos.resumenAnterior || {};

 const total =
 Number(resumen.total || 0);

 const transacciones =
 Number(resumen.transacciones || 0);

 document.getElementById("reporteTotalVentas").textContent =
 dinero(total);

 document.getElementById("reporteTransacciones").textContent =
 transacciones;

 document.getElementById("reporteTicketPromedio").textContent =
 dinero(resumen.ticket_promedio || 0);

 document.getElementById("reporteProductosVendidos").textContent =
 Number(resumen.productos_vendidos || 0).toFixed(0);

 const tendencias = {
  reporteTotalVentasTendencia: [total, anterior.total],
  reporteTransaccionesTendencia: [transacciones, anterior.transacciones],
  reporteTicketPromedioTendencia: [resumen.ticket_promedio, anterior.ticket_promedio],
  reporteProductosVendidosTendencia: [resumen.productos_vendidos, anterior.productos_vendidos]
 };

 Object.entries(tendencias).forEach(([id, [actual, valorAnterior]]) => {
  const elemento = document.getElementById(id);
  if (!elemento) return;
  elemento.textContent = textoTendenciaReporte(actual, valorAnterior);
  elemento.className = "reporte-tendencia " + claseTendenciaReporte(actual, valorAnterior);
 });

 renderGraficaReporteVentas(datos.porDia || []);
 renderUltimasVentasReporte(datos.ultimas || []);
 renderGraficaMetodosPago(datos.metodosPago || []);
 renderListaReporteCompacta("reporteProductosVendidosLista", datos.productosVendidos || [], item => ({
  titulo: item.nombre || "Producto",
  detalle: `${Number(item.cantidad || 0).toFixed(2)} vendidos`,
  valor: dinero(item.total || 0)
 }));
 renderListaReporteCompacta("reporteHorasVenta", datos.porHora || [], item => ({
  titulo: item.hora || "-",
  detalle: `${item.transacciones || 0} ventas`,
  valor: dinero(item.total || 0)
 }));
 renderVentasPorCategoriaReporte(datos.ventasPorCategoria || []);
 renderResumenPeriodoReporte(datos.porDia || [], total, anterior.total);
}

function renderListaReporteCompacta(id, items, adaptador) {
 const contenedor =
 document.getElementById(id);

 if (!contenedor) return;

 if (!items.length) {
  contenedor.innerHTML = '<div class="reporte-vacio">Sin datos para este periodo.</div>';
  return;
 }

 contenedor.innerHTML =
 items.map(item => {
  const vista = adaptador(item);
  return `
  <div class="reporte-mini-row">
   <div>
    <strong>${vista.titulo}</strong>
    <span>${vista.detalle}</span>
   </div>
   <b>${vista.valor}</b>
  </div>
  `;
 }).join("");
}

function renderGraficaReporteVentas(ventasPorDia) {
 const canvas =
 document.getElementById("graficaVentasReporte");

 if (!canvas || typeof Chart === "undefined") return;

 const contexto =
 canvas.getContext("2d");

 if (graficaReporteVentas) {
 graficaReporteVentas.destroy();
 }

 const marca = colorMarcaReporte();

 graficaReporteVentas = new Chart(contexto, {
 type: "line",
 data: {
 labels: ventasPorDia.map(item => item.dia),
 datasets: [
 {
 label: "Ventas",
 data: ventasPorDia.map(item => Number(item.total || 0)),
 borderColor: marca,
 backgroundColor: marca + "22",
 pointBackgroundColor: marca,
 tension: 0.35,
 fill: true
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
 y: {
 beginAtZero: true
 }
 }
 }
 });
}

function renderGraficaMetodosPago(metodos) {
 const canvas = document.getElementById("graficaMetodosPago");
 const leyenda = document.getElementById("reporteMetodosPagoLeyenda");
 if (!canvas || !leyenda) return;

 if (!metodos.length) {
  leyenda.innerHTML = '<div class="reporte-vacio">Sin datos para este periodo.</div>';
  if (graficaMetodosPago) {
   graficaMetodosPago.destroy();
   graficaMetodosPago = null;
  }
  return;
 }

 const totalGeneral = metodos.reduce((suma, item) => suma + Number(item.total || 0), 0) || 1;

 leyenda.innerHTML = metodos.map((item, indice) => {
  const porcentaje = (Number(item.total || 0) / totalGeneral) * 100;
  return `
   <div class="reporte-metodo-fila">
    <span class="reporte-metodo-punto" style="background:${PALETA_REPORTE[indice % PALETA_REPORTE.length]}"></span>
    <span class="reporte-metodo-nombre">${item.metodo_pago || "efectivo"}</span>
    <span class="reporte-metodo-porcentaje">${porcentaje.toFixed(1)}%</span>
    <b>${dinero(item.total || 0)}</b>
   </div>
  `;
 }).join("");

 if (typeof Chart === "undefined") return;
 const contexto = canvas.getContext("2d");
 if (graficaMetodosPago) graficaMetodosPago.destroy();

 graficaMetodosPago = new Chart(contexto, {
  type: "doughnut",
  data: {
   labels: metodos.map(item => item.metodo_pago || "efectivo"),
   datasets: [{
    data: metodos.map(item => Number(item.total || 0)),
    backgroundColor: metodos.map((_, indice) => PALETA_REPORTE[indice % PALETA_REPORTE.length]),
    borderWidth: 0
   }]
  },
  options: {
   responsive: true,
   maintainAspectRatio: false,
   cutout: "68%",
   plugins: {
    legend: { display: false }
   }
  }
 });
}

function renderVentasPorCategoriaReporte(categorias) {
 const contenedor = document.getElementById("reporteVentasPorCategoria");
 const botonVerTodas = document.getElementById("btnVerTodasCategoriasReporte");
 if (!contenedor) return;

 if (!categorias.length) {
  contenedor.innerHTML = '<div class="reporte-vacio">Sin datos para este periodo.</div>';
  if (botonVerTodas) botonVerTodas.style.display = "none";
  return;
 }

 const totalGeneral = categorias.reduce((suma, item) => suma + Number(item.total || 0), 0) || 1;
 const visibles = categoriasReporteExpandido ? categorias : categorias.slice(0, 5);

 contenedor.innerHTML = visibles.map(item => {
  const porcentaje = (Number(item.total || 0) / totalGeneral) * 100;
  return `
   <div class="reporte-categoria-fila">
    <div class="reporte-categoria-encabezado">
     <span>${item.categoria}</span>
     <b>${dinero(item.total || 0)}</b>
    </div>
    <div class="reporte-categoria-barra">
     <div class="reporte-categoria-barra-relleno" style="width:${porcentaje.toFixed(1)}%"></div>
    </div>
    <span class="reporte-categoria-porcentaje">${porcentaje.toFixed(1)}%</span>
   </div>
  `;
 }).join("");

 if (botonVerTodas) {
  botonVerTodas.style.display = categorias.length > 5 ? "block" : "none";
  botonVerTodas.textContent = categoriasReporteExpandido ? "Ver menos categorias" : "Ver todas las categorias";
 }
}

function toggleCategoriasReporte() {
 categoriasReporteExpandido = !categoriasReporteExpandido;
 renderVentasPorCategoriaReporte((ultimoReporteVentas && ultimoReporteVentas.ventasPorCategoria) || []);
}

function renderResumenPeriodoReporte(porDia, totalActual, totalAnterior) {
 const contenedor = document.getElementById("reporteResumenPeriodo");
 if (!contenedor) return;

 const dias = diasEnPeriodoReporte();
 let mejor = null;
 let peor = null;

 porDia.forEach(item => {
  const valor = Number(item.total || 0);
  if (!mejor || valor > Number(mejor.total || 0)) mejor = item;
  if (!peor || valor < Number(peor.total || 0)) peor = item;
 });

 const filas = [
  { titulo: "Dias en el periodo", valor: dias + (dias === 1 ? " dia" : " dias") },
  { titulo: "Mejor dia de ventas", valor: mejor ? diaLargoReporte(mejor.dia) + " · " + dinero(mejor.total) : "Sin datos" },
  { titulo: "Peor dia de ventas", valor: peor && porDia.length > 1 ? diaLargoReporte(peor.dia) + " · " + dinero(peor.total) : "Sin datos" },
  { titulo: "Crecimiento en ventas", valor: textoTendenciaReporte(totalActual, totalAnterior) }
 ];

 contenedor.innerHTML = filas.map(fila => `
  <div class="reporte-resumen-periodo-fila">
   <span>${fila.titulo}</span>
   <b>${fila.valor}</b>
  </div>
 `).join("");
}

function exportarReporteVentasCSV() {
 if (!ultimoReporteVentas) return;

 const resumen = ultimoReporteVentas.resumen || {};
 const filas = [
  ["Reporte de ventas", ""],
  ["Ventas totales", dinero(resumen.total || 0)],
  ["Transacciones", Number(resumen.transacciones || 0)],
  ["Ticket promedio", dinero(resumen.ticket_promedio || 0)],
  ["Productos vendidos", Number(resumen.productos_vendidos || 0)],
  [""],
  ["Ventas por dia", ""],
  ...(ultimoReporteVentas.porDia || []).map(item => [item.dia, Number(item.total || 0)]),
  [""],
  ["Productos mas vendidos", ""],
  ...(ultimoReporteVentas.productosVendidos || []).map(item => [item.nombre, Number(item.total || 0)])
 ];

 const csv = filas.map(fila => fila.map(valor => `"${String(valor).replace(/"/g, '""')}"`).join(",")).join("\n");
 const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);
 const enlace = document.createElement("a");
 enlace.href = url;
 enlace.download = "reporte-ventas-" + periodoReporteVentas + ".csv";
 enlace.click();
 URL.revokeObjectURL(url);
}

function renderUltimasVentasReporte(ventas) {
 const contenedor =
 document.getElementById("reporteUltimasVentas");

 if (!contenedor) return;

 if (ventas.length === 0) {
 contenedor.innerHTML =
 `<div class="reporte-vacio">Todavia no hay ventas registradas.</div>`;
 renderPaginacion(
 "paginacionReporteVentas",
 0,
 1,
 TAMANO_PAGINA_REPORTES,
 "cambiarPaginaReporteVentas"
 );
 return;
 }

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(ventas.length / TAMANO_PAGINA_REPORTES)
 );

 paginaReporteVentas =
 Math.min(paginaReporteVentas, totalPaginas);

 const inicio =
 (paginaReporteVentas - 1) * TAMANO_PAGINA_REPORTES;

 const ventasPagina =
 ventas.slice(
 inicio,
 inicio + TAMANO_PAGINA_REPORTES
 );

 contenedor.innerHTML =
 ventasPagina.map(venta => `
 <div class="reporte-venta-item">
 <div>
 <strong>${dinero(venta.total)}</strong>
 <span>${new Date(venta.fecha).toLocaleString("es-MX")}</span>
 </div>
 <div class="reporte-venta-item-acciones">
 <b>#${venta.id}</b>
 <button type="button" class="reporte-venta-detalle-btn" onclick="abrirDetalleVentaPOS(${Number(venta.id)})">Ver detalle</button>
 </div>
 </div>
 `).join("");

 renderPaginacion(
 "paginacionReporteVentas",
 ventas.length,
 paginaReporteVentas,
 TAMANO_PAGINA_REPORTES,
 "cambiarPaginaReporteVentas"
 );
}

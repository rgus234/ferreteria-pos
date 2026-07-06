(() => {
 if (window.__fase5Finanzas) return;
 window.__fase5Finanzas = true;

 const esc = valor => String(typeof limpiarTextoUI === "function" ? limpiarTextoUI(valor ?? "") : (valor ?? ""))
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
 const num = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;
 const money = valor => typeof dinero === "function" ? dinero(valor) : "$" + num(valor).toFixed(2);
 const icono = nombre => typeof iconoUISVG === "function" ? iconoUISVG(nombre) : "";

 const CATEGORIAS_GASTO = ["General", "Renta", "Servicios", "Nomina", "Flete", "Mantenimiento"];
 const PALETA_FINANZAS = ["#0d6efd", "#8b5cf6", "#14b8a6", "#94a3b8", "#f59e0b", "#ef4444"];

 const estado = {
  periodo: "mes",
  resumen: null,
  porDia: [],
  gastosPorCategoria: [],
  cuentasPorCobrar: [],
  cuentas: [],
  gastos: [],
  verTodasCuentasPagar: false,
  verTodasCuentasCobrar: false
 };

 let graficaFinanzas = null;
 let graficaGastosCategoria = null;

 function ocultarPantallasFinanzas() {
  [
   "pantallaInicio", "pantallaPuntoVenta", "pantallaInventario", "pantallaCategoriasInventario",
   "pantallaCatalogo", "pantallaClientes", "pantallaCreditos", "pantallaProveedores", "pantallaInventarioBajo",
   "pantallaReportes", "pantallaConfiguracion", "pantallaRecepcionMercancia", "pantallaPedidosProveedor",
   "pantallaAjustesInventario", "pantallaCaja", "pantallaFinanzas"
  ].forEach(id => {
   const el = document.getElementById(id);
   if (el) el.style.display = "none";
  });
 }

 function asegurarPantallaFinanzas() {
  const main = document.querySelector("main.contenido") || document.getElementById("sistema");
  if (!main || document.getElementById("pantallaFinanzas")) return;

  const pantalla = document.createElement("section");
  pantalla.id = "pantallaFinanzas";
  pantalla.style.display = "none";
  pantalla.innerHTML = `
   <div class="finanzas-shell">
    <div class="finanzas-header">
     <span class="finanzas-header-icono">${icono("wallet")}</span>
     <div class="finanzas-header-texto">
      <h2>Finanzas</h2>
      <p>Controla pagos, gastos y el estado financiero de tu negocio</p>
     </div>
    </div>

    <div class="finanzas-filtros">
     <button type="button" data-fin-periodo="dia" onclick="cambiarPeriodoFinanzas('dia')">Dia</button>
     <button type="button" data-fin-periodo="semana" onclick="cambiarPeriodoFinanzas('semana')">Semana</button>
     <button type="button" class="activo" data-fin-periodo="mes" onclick="cambiarPeriodoFinanzas('mes')">Mes</button>
     <button type="button" data-fin-periodo="anio" onclick="cambiarPeriodoFinanzas('anio')">Ano</button>
     <label>Desde <input id="finDesde" type="date"></label>
     <label>Hasta <input id="finHasta" type="date"></label>
     <button type="button" onclick="cambiarPeriodoFinanzas('rango')">Aplicar rango</button>
     <button type="button" class="btn-fin-exportar" onclick="exportarFinanzasCSV()">Exportar</button>
    </div>

    <div class="finanzas-kpis">
     <div>
      <span class="finanzas-kpi-icono ingresos">${icono("arrowDownBox")}</span>
      <div><span>Ingresos totales</span><strong id="finIngresos">$0.00</strong><em id="finIngresosTendencia" class="finanzas-tendencia"></em></div>
     </div>
     <div>
      <span class="finanzas-kpi-icono gastos">${icono("file")}</span>
      <div><span>Gastos totales</span><strong id="finGastosMes">$0.00</strong><em id="finGastosTendencia" class="finanzas-tendencia"></em></div>
     </div>
     <div>
      <span class="finanzas-kpi-icono utilidad">${icono("chart")}</span>
      <div><span>Utilidad neta</span><strong id="finUtilidad">$0.00</strong><em id="finUtilidadTendencia" class="finanzas-tendencia"></em></div>
     </div>
     <div>
      <span class="finanzas-kpi-icono porpagar">${icono("clock")}</span>
      <div><span>Cuentas por pagar</span><strong id="finPorPagar">$0.00</strong><em id="finCuentasAbiertasTexto" class="finanzas-tendencia"></em></div>
     </div>
     <div>
      <span class="finanzas-kpi-icono balance">${icono("wallet")}</span>
      <div><span>Balance disponible</span><strong id="finBalance">$0.00</strong><em class="finanzas-tendencia">Despues de gastos y pagos</em></div>
     </div>
    </div>

    <div class="finanzas-grid">
     <section class="finanzas-panel">
      <h3>Resumen financiero</h3>
      <canvas id="graficaFinanzas"></canvas>
      <div class="finanzas-leyenda-linea">
       <span><i style="background:#0d6efd"></i>Ingresos</span>
       <span><i style="background:#ef4444"></i>Gastos</span>
       <span><i style="background:#10b981"></i>Utilidad</span>
      </div>
     </section>
     <section class="finanzas-panel">
      <h3>Gastos por categoria</h3>
      <div class="finanzas-donut-wrap"><canvas id="graficaGastosCategoria"></canvas></div>
      <div id="finGastosCategoriaLeyenda" class="finanzas-categoria-leyenda"></div>
     </section>
    </div>

    <div class="finanzas-grid">
     <section class="finanzas-panel">
      <div class="finanzas-panel-titulo-fila">
       <h3>Cuentas por pagar</h3>
       <button type="button" class="finanzas-btn-agregar" onclick="abrirModalNuevaCuentaPagar()">${icono("plus")} Nueva cuenta</button>
      </div>
      <div id="listaCuentasPagarPOS" class="finanzas-tabla-wrap"></div>
      <button type="button" class="finanzas-ver-todas" id="btnVerTodasCuentasPagar" onclick="toggleVerTodasCuentasPagar()" style="display:none;">Ver todas</button>
     </section>
     <section class="finanzas-panel">
      <div class="finanzas-panel-titulo-fila">
       <h3>Cuentas por cobrar</h3>
       <button type="button" class="finanzas-btn-agregar" onclick="mostrarCreditos()">${icono("chevronRight")} Ir a creditos</button>
      </div>
      <p>Saldos de clientes con credito pendiente</p>
      <div id="listaCuentasCobrarPOS" class="finanzas-tabla-wrap"></div>
      <button type="button" class="finanzas-ver-todas" id="btnVerTodasCuentasCobrar" onclick="toggleVerTodasCuentasCobrar()" style="display:none;">Ver todas</button>
     </section>
    </div>

    <section class="finanzas-panel">
     <h3>Acciones rapidas</h3>
     <button type="button" class="finanzas-accion-rapida" onclick="abrirModalNuevoGasto()">
      ${icono("plus")}
      <div><strong>Registrar gasto</strong><span>Agrega un nuevo gasto operativo</span></div>
      ${icono("chevronRight")}
     </button>
     <button type="button" class="finanzas-accion-rapida" onclick="mostrarGraficas()">
      ${icono("chart")}
      <div><strong>Ver ventas del periodo</strong><span>Consulta el reporte de ventas</span></div>
      ${icono("chevronRight")}
     </button>
     <button type="button" class="finanzas-accion-rapida" onclick="accionPagarProveedorRapida()">
      ${icono("swap")}
      <div><strong>Pagar proveedor</strong><span>Realiza un pago a proveedor</span></div>
      ${icono("chevronRight")}
     </button>
     <button type="button" class="finanzas-accion-rapida" onclick="mostrarCajaPOS()">
      ${icono("wallet")}
      <div><strong>Ver flujo de efectivo</strong><span>Consulta entradas y salidas en caja</span></div>
      ${icono("chevronRight")}
     </button>
     <button type="button" class="finanzas-accion-rapida" onclick="exportarFinanzasCSV()">
      ${icono("clipboard")}
      <div><strong>Generar reporte financiero</strong><span>Exporta tu resumen financiero</span></div>
      ${icono("chevronRight")}
     </button>
    </section>

    <div class="finanzas-grid">
     <section class="finanzas-panel">
      <h3>Gastos recientes</h3>
      <div id="listaGastosPOS" class="finanzas-lista"></div>
     </section>
     <section class="finanzas-panel">
      <h3>Pagos a proveedores recientes</h3>
      <div id="listaPagosProveedorPOS" class="finanzas-lista"></div>
     </section>
    </div>
   </div>

   <div class="modal-overlay finanzas-modal-overlay" id="modalNuevaCuentaPagar" style="display:none;">
    <div class="finanzas-modal-card">
     <h3>Nueva cuenta por pagar</h3>
     <p>Registra una factura o nota pendiente de pago</p>
     <label>Proveedor<input id="finCuentaProveedor" placeholder="Nombre del proveedor"></label>
     <label>Concepto / factura<input id="finCuentaConcepto" placeholder="Ej. Factura #1123"></label>
     <div class="finanzas-modal-fila">
      <label>Monto<input id="finCuentaMonto" type="number" step="0.01" min="0" placeholder="0.00"></label>
      <label>Vencimiento<input id="finCuentaVencimiento" type="date"></label>
     </div>
     <label>Notas (opcional)<input id="finCuentaNotas" placeholder="Escribe una nota"></label>
     <div class="finanzas-modal-acciones">
      <button type="button" class="btn-fin-secundario" onclick="cerrarModalNuevaCuentaPagar()">Cancelar</button>
      <button type="button" class="btn-fin-primario" onclick="guardarCuentaPagarPOS()">Guardar cuenta</button>
     </div>
    </div>
   </div>

   <div class="modal-overlay finanzas-modal-overlay" id="modalNuevoGasto" style="display:none;">
    <div class="finanzas-modal-card">
     <h3>Registrar gasto</h3>
     <p>Agrega un gasto operativo a la bitacora</p>
     <label>Categoria
      <select id="finGastoCategoria">${CATEGORIAS_GASTO.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
     </label>
     <label>Concepto<input id="finGastoConcepto" placeholder="Descripcion del gasto"></label>
     <div class="finanzas-modal-fila">
      <label>Monto<input id="finGastoMonto" type="number" step="0.01" min="0" placeholder="0.00"></label>
      <label>Metodo<input id="finGastoMetodo" placeholder="Efectivo, transferencia..."></label>
     </div>
     <label>Referencia (opcional)<input id="finGastoReferencia" placeholder="Folio o referencia"></label>
     <div class="finanzas-modal-acciones">
      <button type="button" class="btn-fin-secundario" onclick="cerrarModalNuevoGasto()">Cancelar</button>
      <button type="button" class="btn-fin-primario" onclick="guardarGastoOperativoPOS()">Guardar gasto</button>
     </div>
    </div>
   </div>
  `;
  main.appendChild(pantalla);
 }

 function instalarMenuFinanzas() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || sidebar.querySelector("[data-modulo='finanzas']")) return;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.dataset.modulo = "finanzas";
  boton.onclick = () => mostrarFinanzasPOS();
  boton.innerHTML = icono("wallet") + "<span>Finanzas</span>";

  const antes = sidebar.querySelector("[data-modulo='caja']") ||
   sidebar.querySelector("[data-modulo='ajustes']") ||
   [...sidebar.querySelectorAll("button")].find(btn => /Reportes/i.test(btn.textContent || ""));

  if (antes) antes.insertAdjacentElement("afterend", boton);
  else sidebar.appendChild(boton);
 }

 function limpiarCampos(ids) {
  ids.forEach(id => {
   const el = document.getElementById(id);
   if (el) el.value = "";
  });
 }

 function setTexto(id, valor) {
  const el = document.getElementById(id);
  if (el) el.textContent = valor;
 }

 function colorMarcaFinanzas() {
  const valor = getComputedStyle(document.documentElement).getPropertyValue("--brand-color");
  return valor && valor.trim() ? valor.trim() : "#0d6efd";
 }

 function textoTendenciaFinanzas(actual, anterior) {
  const a = num(actual);
  const b = num(anterior);
  if (b <= 0) return a > 0 ? "Nuevo vs periodo anterior" : "Sin cambios vs periodo anterior";
  const porcentaje = ((a - b) / b) * 100;
  const signo = porcentaje >= 0 ? "+" : "";
  return signo + porcentaje.toFixed(1) + "% vs periodo anterior";
 }

 function claseTendenciaFinanzas(actual, anterior, invertido) {
  const a = num(actual);
  const b = num(anterior);
  if (b <= 0) return a > 0 ? (invertido ? "negativa" : "positiva") : "neutra";
  const sube = a >= b;
  const positivo = invertido ? !sube : sube;
  return positivo ? "positiva" : "negativa";
 }

 window.cambiarPeriodoFinanzas = periodo => {
  estado.periodo = periodo || "mes";
  document.querySelectorAll("[data-fin-periodo]").forEach(boton => {
   boton.classList.toggle("activo", boton.dataset.finPeriodo === estado.periodo);
  });
  cargarFinanzasPOS();
 };

 function parametrosPeriodo() {
  const params = new URLSearchParams();
  params.set("periodo", estado.periodo);
  if (estado.periodo === "rango") {
   const desde = document.getElementById("finDesde")?.value || "";
   const hasta = document.getElementById("finHasta")?.value || "";
   if (desde && hasta) {
    params.set("desde", desde);
    params.set("hasta", hasta);
   }
  }
  return params;
 }

 async function cargarResumenFinanzas() {
  const respuesta = await fetch("/finanzas/resumen?" + parametrosPeriodo().toString());
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || "No se pudo cargar resumen");

  estado.resumen = datos;
  const anterior = datos.anterior || {};

  setTexto("finIngresos", money(datos.ingresos));
  setTexto("finGastosMes", money(datos.gastos_mes));
  setTexto("finUtilidad", money(datos.utilidad_neta));
  setTexto("finPorPagar", money(datos.por_pagar));
  setTexto("finBalance", money(datos.balance_disponible));
  setTexto("finCuentasAbiertasTexto", (datos.cuentas_abiertas || 0) + " cuentas pendientes");

  const tendencias = {
   finIngresosTendencia: [datos.ingresos, anterior.ingresos, false],
   finGastosTendencia: [datos.gastos_mes, anterior.gastos, true],
   finUtilidadTendencia: [datos.utilidad_neta, anterior.utilidad_neta, false]
  };
  Object.entries(tendencias).forEach(([id, [actual, valorAnterior, invertido]]) => {
   const el = document.getElementById(id);
   if (!el) return;
   el.textContent = textoTendenciaFinanzas(actual, valorAnterior);
   el.className = "finanzas-tendencia " + claseTendenciaFinanzas(actual, valorAnterior, invertido);
  });
 }

 async function cargarResumenPorDia() {
  const respuesta = await fetch("/finanzas/resumen-por-dia?" + parametrosPeriodo().toString());
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || "No se pudo cargar el resumen por dia");

  estado.porDia = datos.porDia || [];
  estado.gastosPorCategoria = datos.gastosPorCategoria || [];
  renderGraficaFinanzas();
  renderGastosPorCategoria();
 }

 function renderGraficaFinanzas() {
  const canvas = document.getElementById("graficaFinanzas");
  if (!canvas || typeof Chart === "undefined") return;
  if (graficaFinanzas) graficaFinanzas.destroy();

  graficaFinanzas = new Chart(canvas.getContext("2d"), {
   type: "line",
   data: {
    labels: estado.porDia.map(item => item.dia),
    datasets: [
     { label: "Ingresos", data: estado.porDia.map(item => num(item.ingresos)), borderColor: "#0d6efd", backgroundColor: "#0d6efd22", tension: 0.35 },
     { label: "Gastos", data: estado.porDia.map(item => num(item.gastos)), borderColor: "#ef4444", backgroundColor: "#ef444422", tension: 0.35 },
     { label: "Utilidad", data: estado.porDia.map(item => num(item.utilidad)), borderColor: "#10b981", backgroundColor: "#10b98122", tension: 0.35 }
    ]
   },
   options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
   }
  });
 }

 function renderGastosPorCategoria() {
  const canvas = document.getElementById("graficaGastosCategoria");
  const leyenda = document.getElementById("finGastosCategoriaLeyenda");
  if (!canvas || !leyenda) return;

  const categorias = estado.gastosPorCategoria;
  if (!categorias.length) {
   leyenda.innerHTML = '<div class="finanzas-empty">Sin gastos en este periodo.</div>';
   if (graficaGastosCategoria) { graficaGastosCategoria.destroy(); graficaGastosCategoria = null; }
   return;
  }

  const total = categorias.reduce((suma, item) => suma + num(item.total), 0) || 1;
  leyenda.innerHTML = categorias.map((item, indice) => `
   <div class="finanzas-categoria-fila">
    <span class="finanzas-categoria-punto" style="background:${PALETA_FINANZAS[indice % PALETA_FINANZAS.length]}"></span>
    <span class="finanzas-categoria-nombre">${esc(item.categoria)}</span>
    <span class="finanzas-categoria-monto">${money(item.total)}</span>
    <b>${((num(item.total) / total) * 100).toFixed(1)}%</b>
   </div>
  `).join("");

  if (typeof Chart === "undefined") return;
  if (graficaGastosCategoria) graficaGastosCategoria.destroy();
  graficaGastosCategoria = new Chart(canvas.getContext("2d"), {
   type: "doughnut",
   data: {
    labels: categorias.map(item => item.categoria),
    datasets: [{ data: categorias.map(item => num(item.total)), backgroundColor: categorias.map((_, i) => PALETA_FINANZAS[i % PALETA_FINANZAS.length]), borderWidth: 0 }]
   },
   options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false } } }
  });
 }

 window.toggleVerTodasCuentasPagar = () => {
  estado.verTodasCuentasPagar = !estado.verTodasCuentasPagar;
  renderCuentasPagar();
 };

 window.toggleVerTodasCuentasCobrar = () => {
  estado.verTodasCuentasCobrar = !estado.verTodasCuentasCobrar;
  renderCuentasCobrar();
 };

 function renderCuentasPagar() {
  const contenedor = document.getElementById("listaCuentasPagarPOS");
  const boton = document.getElementById("btnVerTodasCuentasPagar");
  if (!contenedor) return;

  if (!estado.cuentas.length) {
   contenedor.innerHTML = '<div class="finanzas-empty">Sin cuentas por pagar.</div>';
   if (boton) boton.style.display = "none";
   return;
  }

  const visibles = estado.verTodasCuentasPagar ? estado.cuentas : estado.cuentas.slice(0, 5);
  contenedor.innerHTML = `
   <table class="finanzas-tabla">
    <thead><tr><th>Proveedor</th><th>Factura / Concepto</th><th>Vencimiento</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
    <tbody>
     ${visibles.map(cuenta => `
      <tr>
       <td>${esc(cuenta.proveedor || "Sin proveedor")}</td>
       <td>${esc(cuenta.concepto || "")}</td>
       <td>${cuenta.vencimiento ? new Date(cuenta.vencimiento).toLocaleDateString("es-MX") : "Sin fecha"}</td>
       <td>${money(cuenta.saldo)}</td>
       <td><span class="finanzas-badge-estado ${esc(cuenta.estado)}">${esc(cuenta.estado)}</span></td>
       <td>${cuenta.estado === "pagada" || cuenta.estado === "cancelada" ? "" : `<button type="button" class="finanzas-btn-pagar" onclick="registrarPagoProveedorPOS(${cuenta.id})">Pagar</button>`}</td>
      </tr>
     `).join("")}
    </tbody>
   </table>
  `;

  if (boton) {
   boton.style.display = estado.cuentas.length > 5 ? "block" : "none";
   boton.textContent = estado.verTodasCuentasPagar ? "Ver menos" : "Ver todas";
  }
 }

 function renderCuentasCobrar() {
  const contenedor = document.getElementById("listaCuentasCobrarPOS");
  const boton = document.getElementById("btnVerTodasCuentasCobrar");
  if (!contenedor) return;

  if (!estado.cuentasPorCobrar.length) {
   contenedor.innerHTML = '<div class="finanzas-empty">Sin clientes con saldo pendiente.</div>';
   if (boton) boton.style.display = "none";
   return;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const visibles = estado.verTodasCuentasCobrar ? estado.cuentasPorCobrar : estado.cuentasPorCobrar.slice(0, 5);
  contenedor.innerHTML = `
   <table class="finanzas-tabla">
    <thead><tr><th>Cliente</th><th>Vencimiento</th><th>Monto</th><th>Estado</th></tr></thead>
    <tbody>
     ${visibles.map(cliente => {
      const fechaVenc = cliente.fecha_vencimiento ? String(cliente.fecha_vencimiento).slice(0, 10) : "";
      const vencido = fechaVenc && fechaVenc < hoy;
      return `
      <tr>
       <td>${esc(cliente.nombre)}</td>
       <td>${fechaVenc ? new Date(fechaVenc).toLocaleDateString("es-MX") : "Sin fecha"}</td>
       <td>${money(cliente.saldo)}</td>
       <td><span class="finanzas-badge-estado ${vencido ? "vencida" : "pendiente"}">${vencido ? "Vencido" : "Pendiente"}</span></td>
      </tr>
      `;
     }).join("")}
    </tbody>
   </table>
  `;

  if (boton) {
   boton.style.display = estado.cuentasPorCobrar.length > 5 ? "block" : "none";
   boton.textContent = estado.verTodasCuentasCobrar ? "Ver menos" : "Ver todas";
  }
 }

 window.mostrarFinanzasPOS = async function () {
  asegurarPantallaFinanzas();
  instalarMenuFinanzas();
  ocultarPantallasFinanzas();
  document.getElementById("pantallaFinanzas").style.display = "block";

  if (typeof actualizarModuloActivoPOS === "function") actualizarModuloActivoPOS("finanzas");
  if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Finanzas", "Pagos, gastos y estado financiero", "finanzas");

  await cargarFinanzasPOS();
 };

 window.cargarFinanzasPOS = async function () {
  try {
   await cargarResumenFinanzas();
   await cargarResumenPorDia();
   await cargarCuentasPagarPOS();
   await cargarCuentasPorCobrarPOS();
   await cargarGastosOperativosPOS();
   await cargarPagosProveedorPOS();
  } catch (error) {
   alertaPOS(error.message, "Finanzas", "peligro");
  }
 };

 window.abrirModalNuevaCuentaPagar = () => { document.getElementById("modalNuevaCuentaPagar").style.display = "flex"; };
 window.cerrarModalNuevaCuentaPagar = () => { document.getElementById("modalNuevaCuentaPagar").style.display = "none"; };
 window.abrirModalNuevoGasto = () => { document.getElementById("modalNuevoGasto").style.display = "flex"; };
 window.cerrarModalNuevoGasto = () => { document.getElementById("modalNuevoGasto").style.display = "none"; };

 window.accionPagarProveedorRapida = () => {
  const pendiente = estado.cuentas.find(c => c.estado === "pendiente" || c.estado === "parcial");
  if (!pendiente) return alertaPOS("No hay cuentas por pagar pendientes.", "Sin pagos pendientes", "info");
  window.registrarPagoProveedorPOS(pendiente.id);
 };

 window.guardarCuentaPagarPOS = async function () {
  const payload = {
   proveedor: document.getElementById("finCuentaProveedor")?.value || "",
   concepto: document.getElementById("finCuentaConcepto")?.value || "",
   montoTotal: document.getElementById("finCuentaMonto")?.value || "",
   vencimiento: document.getElementById("finCuentaVencimiento")?.value || null,
   notas: document.getElementById("finCuentaNotas")?.value || ""
  };

  try {
   const respuesta = await fetch("/cuentas-pagar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
   });
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudo guardar cuenta");

   limpiarCampos(["finCuentaProveedor", "finCuentaConcepto", "finCuentaMonto", "finCuentaVencimiento", "finCuentaNotas"]);
   window.cerrarModalNuevaCuentaPagar();
   await cargarFinanzasPOS();
   alertaPOS("Quedo pendiente para pago.", "Cuenta registrada", "exito");
  } catch (error) {
   alertaPOS(error.message, "Cuenta por pagar", "peligro");
  }
 };

 window.cargarCuentasPagarPOS = async function () {
  try {
   const respuesta = await fetch("/cuentas-pagar");
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar cuentas");
   estado.cuentas = datos.cuentas || [];
   renderCuentasPagar();
  } catch (error) {
   const contenedor = document.getElementById("listaCuentasPagarPOS");
   if (contenedor) contenedor.innerHTML = `<div class="finanzas-empty">${esc(error.message)}</div>`;
  }
 };

 window.cargarCuentasPorCobrarPOS = async function () {
  try {
   const respuesta = await fetch("/finanzas/cuentas-por-cobrar");
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar cuentas por cobrar");
   estado.cuentasPorCobrar = datos.cuentas || [];
   renderCuentasCobrar();
  } catch (error) {
   const contenedor = document.getElementById("listaCuentasCobrarPOS");
   if (contenedor) contenedor.innerHTML = `<div class="finanzas-empty">${esc(error.message)}</div>`;
  }
 };

 window.registrarPagoProveedorPOS = async function (id) {
  const cuenta = estado.cuentas.find(item => Number(item.id) === Number(id));
  if (!cuenta) return;

  const monto = await pedirTextoPOS(`Saldo pendiente: ${money(cuenta.saldo)}. Monto a pagar:`, cuenta.saldo, "Pago a proveedor");
  if (monto === null) return;

  const referencia = await pedirTextoPOS("Referencia, metodo o folio del pago:", "", "Referencia de pago");

  try {
   const respuesta = await fetch(`/cuentas-pagar/${id}/pagos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monto, metodo: referencia || "", referencia: referencia || "", notas: "Pago registrado desde POS" })
   });
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudo registrar pago");

   await cargarFinanzasPOS();
   alertaPOS(`Nuevo saldo: ${money(datos.saldo)}`, "Pago registrado", "exito");
  } catch (error) {
   alertaPOS(error.message, "Pago a proveedor", "peligro");
  }
 };

 window.guardarGastoOperativoPOS = async function () {
  const payload = {
   categoria: document.getElementById("finGastoCategoria")?.value || "General",
   concepto: document.getElementById("finGastoConcepto")?.value || "",
   monto: document.getElementById("finGastoMonto")?.value || "",
   metodo: document.getElementById("finGastoMetodo")?.value || "",
   referencia: document.getElementById("finGastoReferencia")?.value || ""
  };

  try {
   const respuesta = await fetch("/gastos-operativos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
   });
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudo guardar gasto");

   limpiarCampos(["finGastoConcepto", "finGastoMonto", "finGastoMetodo", "finGastoReferencia"]);
   window.cerrarModalNuevoGasto();
   await cargarFinanzasPOS();
   alertaPOS("Quedo en la bitacora de gastos.", "Gasto registrado", "exito");
  } catch (error) {
   alertaPOS(error.message, "Gasto operativo", "peligro");
  }
 };

 window.cargarGastosOperativosPOS = async function () {
  const contenedor = document.getElementById("listaGastosPOS");
  if (!contenedor) return;

  try {
   const respuesta = await fetch("/gastos-operativos");
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar gastos");

   estado.gastos = datos.gastos || [];
   if (!estado.gastos.length) {
    contenedor.innerHTML = '<div class="finanzas-empty">Sin gastos registrados.</div>';
    return;
   }

   contenedor.innerHTML = estado.gastos.slice(0, 8).map(gasto => `
    <div class="finanzas-mini-row">
     <div><strong>${esc(gasto.concepto)}</strong><span>${esc(gasto.categoria || "General")}</span></div>
     <div><b>${money(gasto.monto)}</b><small>${new Date(gasto.created_at).toLocaleDateString("es-MX")}</small></div>
    </div>
   `).join("");
  } catch (error) {
   contenedor.innerHTML = `<div class="finanzas-empty">${esc(error.message)}</div>`;
  }
 };

 window.cargarPagosProveedorPOS = async function () {
  const contenedor = document.getElementById("listaPagosProveedorPOS");
  if (!contenedor) return;

  try {
   const respuesta = await fetch("/pagos-proveedor");
   const datos = await respuesta.json();
   if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar pagos");

   const pagos = datos.pagos || [];
   if (!pagos.length) {
    contenedor.innerHTML = '<div class="finanzas-empty">Sin pagos registrados.</div>';
    return;
   }

   contenedor.innerHTML = pagos.slice(0, 8).map(pago => `
    <div class="finanzas-mini-row">
     <div><strong>${esc(pago.proveedor || "Sin proveedor")}</strong><span>${esc(pago.referencia || pago.metodo || "")}</span></div>
     <div><b>${money(pago.monto)}</b><small>${new Date(pago.created_at).toLocaleDateString("es-MX")}</small></div>
    </div>
   `).join("");
  } catch (error) {
   contenedor.innerHTML = `<div class="finanzas-empty">${esc(error.message)}</div>`;
  }
 };

 window.exportarFinanzasCSV = () => {
  if (!estado.resumen) return;

  const filas = [
   ["Reporte financiero", ""],
   ["Ingresos totales", money(estado.resumen.ingresos)],
   ["Gastos totales", money(estado.resumen.gastos_mes)],
   ["Utilidad neta", money(estado.resumen.utilidad_neta)],
   ["Cuentas por pagar", money(estado.resumen.por_pagar)],
   ["Balance disponible", money(estado.resumen.balance_disponible)],
   [""],
   ["Gastos por categoria", ""],
   ...estado.gastosPorCategoria.map(item => [item.categoria, num(item.total)]),
   [""],
   ["Cuentas por pagar", ""],
   ...estado.cuentas.map(c => [c.proveedor, num(c.saldo)])
  ];

  const csv = filas.map(fila => fila.map(valor => `"${String(valor).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = "reporte-financiero-" + estado.periodo + ".csv";
  enlace.click();
  URL.revokeObjectURL(url);
 };

 function iniciarFinanzas() {
  asegurarPantallaFinanzas();
  instalarMenuFinanzas();
 }

 if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciarFinanzas);
 } else {
  iniciarFinanzas();
 }
})();

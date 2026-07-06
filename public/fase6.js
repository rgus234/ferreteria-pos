(() => {
 if (window.__fase6Caja) return;
 window.__fase6Caja = true;

 const num = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;
 const money = valor => typeof dinero === "function" ? dinero(valor) : "$" + num(valor).toFixed(2);
 const icono = nombre => typeof iconoUISVG === "function" ? iconoUISVG(nombre) : "";
 const esc = valor => String(typeof limpiarTextoUI === "function" ? limpiarTextoUI(valor ?? "") : (valor ?? ""))
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

 const MOTIVOS_APERTURA = ["Apertura de turno", "Fondo fijo diario", "Cambio de turno", "Otro"];
 const CONCEPTOS_MOVIMIENTO = ["Venta en efectivo", "Pago a proveedor", "Deposito bancario", "Retiro de dueno", "Cambio / vueltos", "Gasto menor", "Ajuste de caja"];

 const estado = {
  turno: null,
  resumen: null,
  resumenAyer: null,
  movs: [],
  cortes: [],
  verTodosMovimientos: false,
  motivoApertura: "",
  motivoAperturaOtro: ""
 };

 let cronometroInterval = null;

 function hide() {
  [
   "pantallaInicio", "pantallaPuntoVenta", "pantallaInventario", "pantallaCategoriasInventario",
   "pantallaCatalogo", "pantallaClientes", "pantallaCreditos", "pantallaProveedores", "pantallaInventarioBajo",
   "pantallaReportes", "pantallaConfiguracion", "pantallaRecepcionMercancia", "pantallaPedidosProveedor",
   "pantallaAjustesInventario", "pantallaFinanzas", "pantallaCaja"
  ].forEach(id => {
   const el = document.getElementById(id);
   if (el) el.style.display = "none";
  });
 }

 function screen() {
  const main = document.querySelector("main.contenido") || document.getElementById("sistema");
  if (!main || document.getElementById("pantallaCaja")) return;

  const seccion = document.createElement("section");
  seccion.id = "pantallaCaja";
  seccion.style.display = "none";
  seccion.innerHTML = `
   <div class="caja-shell">
    <div class="caja-header">
     <span class="caja-header-icono">${icono("wallet")}</span>
     <div class="caja-header-texto">
      <h2>Caja</h2>
      <p>Gestiona tu sesion de caja y movimientos de efectivo</p>
     </div>
     <button type="button" class="caja-btn-historial" onclick="abrirHistorialCajas()">${icono("clock")} Ver historial de cajas</button>
    </div>

    <div id="cajaEstadoSesion"></div>
    <div id="cajaKpis" class="caja-kpis"></div>

    <div class="caja-grid">
     <section class="caja-panel">
      <h3>Corte de caja rapido</h3>
      <p>Resumen actual de la sesion</p>
      <div id="cajaCorteRapido"></div>
     </section>

     <section class="caja-panel" id="cajaPanelAccion"></section>

     <section class="caja-panel">
      <div class="caja-panel-titulo-fila">
       <h3>Movimientos recientes</h3>
       <button type="button" class="caja-ver-todos-link" id="btnVerTodosMovs" onclick="toggleVerTodosMovimientosCaja()">Ver todos</button>
      </div>
      <div id="cajaMovimientosRecientes"></div>
     </section>
    </div>

    <section class="caja-panel">
     <div class="caja-panel-titulo-fila">
      <h3>Movimiento de caja</h3>
     </div>
     <p>Registra entradas, salidas o transferencias de efectivo</p>
     <div class="caja-form-movimiento">
      <label>Tipo de movimiento
       <select id="cajaTipo">
        <option value="entrada">Entrada</option>
        <option value="salida">Salida</option>
       </select>
      </label>
      <label>Monto
       <input id="cajaMonto" type="number" step="0.01" min="0" placeholder="0.00">
      </label>
      <label>Categoria / Concepto
       <input id="cajaConcepto" list="cajaConceptosLista" placeholder="Seleccionar o escribir">
       <datalist id="cajaConceptosLista">
        ${CONCEPTOS_MOVIMIENTO.map(c => `<option value="${esc(c)}">`).join("")}
       </datalist>
      </label>
      <label>Referencia (opcional)
       <input id="cajaReferencia" placeholder="Escribe una referencia">
      </label>
     </div>
     <button type="button" class="btn-caja-primario" id="btnRegistrarMovimiento" onclick="guardarMovimientoCajaPOS()">${icono("swap")} Registrar movimiento</button>
    </section>

    <section class="caja-panel">
     <h3>Acciones rapidas</h3>
     <button type="button" class="caja-accion-rapida" onclick="mostrarGraficas()">
      ${icono("chart")}
      <div><strong>Ver reporte de ventas</strong><span>Consulta el detalle de ventas del dia</span></div>
      ${icono("chevronRight")}
     </button>
     <button type="button" class="caja-accion-rapida" onclick="irMovimientosCajaPOS()">
      ${icono("file")}
      <div><strong>Ver movimientos de caja</strong><span>Historial completo de movimientos</span></div>
      ${icono("chevronRight")}
     </button>
     <button type="button" class="caja-accion-rapida" onclick="abrirModalCerrarTurnoCaja()">
      ${icono("clipboard")}
      <div><strong>Hacer corte de caja</strong><span>Generar reporte de cierre de sesion</span></div>
      ${icono("chevronRight")}
     </button>
    </section>
   </div>

   <div class="modal-overlay caja-modal-overlay" id="modalCerrarTurnoCaja" style="display:none;">
    <div class="caja-modal-card">
     <h3>Cerrar sesion de caja</h3>
     <p>Cuenta el efectivo y los demas metodos de pago antes de cerrar.</p>
     <div id="cajaCierreResumen" class="caja-cierre-resumen"></div>
     <div class="caja-form-cierre">
      <label>Efectivo contado
       <input id="cajaEfectivoContado" type="number" step="0.01" min="0" placeholder="0.00">
      </label>
      <label>Tarjeta contado
       <input id="cajaTarjetaContado" type="number" step="0.01" min="0" placeholder="0.00">
      </label>
      <label>Transferencia contado
       <input id="cajaTransferenciaContado" type="number" step="0.01" min="0" placeholder="0.00">
      </label>
      <label>Credito contado
       <input id="cajaCreditoContado" type="number" step="0.01" min="0" placeholder="0.00">
      </label>
     </div>
     <label class="caja-campo-full">Notas de cierre (opcional)
      <input id="cajaNotasCerrar" placeholder="Escribe una nota">
     </label>
     <div class="caja-modal-acciones">
      <button type="button" class="btn-caja-secundario" onclick="cerrarModalCerrarTurnoCaja()">Cancelar</button>
      <button type="button" class="btn-caja-primario" onclick="confirmarCierreTurnoCajaPOS()">Cerrar turno</button>
     </div>
    </div>
   </div>

   <div class="modal-overlay caja-modal-overlay" id="modalHistorialCajas" style="display:none;">
    <div class="caja-modal-card caja-modal-historial">
     <div class="caja-modal-historial-header">
      <h3>Historial de cajas</h3>
      <button type="button" class="btn-caja-secundario" onclick="cerrarHistorialCajas()">Cerrar</button>
     </div>
     <div id="cajaHistorialLista"></div>
    </div>
   </div>
  `;
  main.appendChild(seccion);
 }

 function menu() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || sidebar.querySelector("[data-modulo='caja']")) return;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.dataset.modulo = "caja";
  boton.onclick = () => mostrarCajaPOS();
  boton.innerHTML = icono("wallet") + "<span>Caja</span>";

  const antes = sidebar.querySelector("[data-modulo='finanzas']") ||
   [...sidebar.querySelectorAll("button")].find(x => /Reportes/i.test(x.textContent || ""));
  antes ? antes.insertAdjacentElement("afterend", boton) : sidebar.appendChild(boton);
 }

 async function getJson(url, opciones) {
  const respuesta = await fetch(url, opciones);
  const texto = await respuesta.text();
  let datos;
  try {
   datos = JSON.parse(texto);
  } catch (error) {
   throw new Error("El servidor no regreso JSON. Reinicia el POS.");
  }
  if (!respuesta.ok) throw new Error(datos.error || "Error de servidor");
  return datos;
 }

 function tiempoAbiertoTexto(desde) {
  const inicio = new Date(desde).getTime();
  if (Number.isNaN(inicio)) return "00:00:00";
  const diferenciaSegundos = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
  const horas = String(Math.floor(diferenciaSegundos / 3600)).padStart(2, "0");
  const minutos = String(Math.floor((diferenciaSegundos % 3600) / 60)).padStart(2, "0");
  const segundos = String(diferenciaSegundos % 60).padStart(2, "0");
  return `${horas}:${minutos}:${segundos}`;
 }

 function actualizarCronometro() {
  const elemento = document.getElementById("cajaTiempoAbierto");
  if (!elemento || !estado.turno) return;
  elemento.textContent = tiempoAbiertoTexto(estado.turno.abierto_at);
 }

 function iniciarCronometro() {
  if (cronometroInterval) clearInterval(cronometroInterval);
  cronometroInterval = setInterval(() => {
   const pantalla = document.getElementById("pantallaCaja");
   if (!pantalla || pantalla.style.display === "none") return;
   actualizarCronometro();
  }, 1000);
 }

 function renderEstadoSesion() {
  const contenedor = document.getElementById("cajaEstadoSesion");
  if (!contenedor) return;
  const turno = estado.turno;

  if (!turno) {
   contenedor.innerHTML = `
    <div class="caja-sesion-card cerrada">
     <span class="caja-sesion-punto"></span>
     <div>
      <strong>No hay turno abierto</strong>
      <span>Abre un turno para comenzar a registrar ventas y movimientos.</span>
     </div>
    </div>
   `;
   return;
  }

  contenedor.innerHTML = `
   <div class="caja-sesion-card activa">
    <span class="caja-sesion-punto"></span>
    <div>
     <strong>Sesion activa</strong>
     <span>Abierta por: ${esc(turno.usuario || "Sin responsable")} · Inicio: ${new Date(turno.abierto_at).toLocaleString("es-MX")}</span>
    </div>
    <div class="caja-sesion-tiempo">
     ${icono("clock")}
     <div><span>Tiempo abierta</span><strong id="cajaTiempoAbierto">${tiempoAbiertoTexto(turno.abierto_at)}</strong></div>
    </div>
    <button type="button" class="btn-caja-cerrar-sesion" onclick="abrirModalCerrarTurnoCaja()">${icono("swap")} Cerrar sesion</button>
   </div>
  `;
 }

 function tendenciaTicket(actual, anterior) {
  if (!anterior) return "";
  const diferencia = actual - anterior;
  if (Math.abs(diferencia) < 0.01) return `vs ayer ${money(anterior)}`;
  const flecha = diferencia > 0 ? "&uarr;" : "&darr;";
  return `vs ayer ${money(anterior)} ${flecha}`;
 }

 function renderKpis() {
  const contenedor = document.getElementById("cajaKpis");
  if (!contenedor) return;
  const resumen = estado.resumen;

  if (!resumen) {
   contenedor.innerHTML = "";
   return;
  }

  const ticketPromedio = resumen.transacciones > 0 ? resumen.ventas / resumen.transacciones : 0;
  const ticketAyer = estado.resumenAyer && estado.resumenAyer.transacciones > 0 ? estado.resumenAyer.ticket_promedio : 0;

  contenedor.innerHTML = `
   <div class="caja-kpi-card">
    <span class="caja-kpi-icono efectivo">${icono("wallet")}</span>
    <div><span>Efectivo en caja</span><strong>${money(resumen.efectivo)}</strong><small>Incluye ventas del dia</small></div>
   </div>
   <div class="caja-kpi-card">
    <span class="caja-kpi-icono tarjeta">${icono("credit")}</span>
    <div><span>Tarjeta</span><strong>${money(resumen.tarjeta)}</strong><small>Ventas con tarjeta</small></div>
   </div>
   <div class="caja-kpi-card">
    <span class="caja-kpi-icono transferencia">${icono("swap")}</span>
    <div><span>Transferencia</span><strong>${money(resumen.transferencia)}</strong><small>Ventas por transferencia</small></div>
   </div>
   <div class="caja-kpi-card">
    <span class="caja-kpi-icono ventas">${icono("chart")}</span>
    <div><span>Total ventas del dia</span><strong>${money(resumen.ventas)}</strong><small>${resumen.transacciones} transacciones</small></div>
   </div>
   <div class="caja-kpi-card">
    <span class="caja-kpi-icono ticket">${icono("tag")}</span>
    <div><span>Ticket promedio</span><strong>${money(ticketPromedio)}</strong><small>${tendenciaTicket(ticketPromedio, ticketAyer)}</small></div>
   </div>
  `;
 }

 function renderCorteRapido() {
  const contenedor = document.getElementById("cajaCorteRapido");
  if (!contenedor) return;
  const resumen = estado.resumen;

  if (!resumen) {
   contenedor.innerHTML = '<div class="caja-empty">Abre un turno para ver el corte rapido.</div>';
   return;
  }

  const filas = [
   ["Efectivo en caja", money(resumen.efectivo)],
   ["Tarjeta", money(resumen.tarjeta)],
   ["Transferencia", money(resumen.transferencia)],
   ["Total ventas", money(resumen.ventas)],
   ["Total transacciones", resumen.transacciones]
  ];

  contenedor.innerHTML = filas.map(([titulo, valor]) => `
   <div class="caja-corte-fila"><span>${titulo}</span><b>${valor}</b></div>
  `).join("") + `
   <div class="caja-corte-fila caja-corte-total"><span>Total esperado</span><b>${money(resumen.esperado_efectivo)}</b></div>
  `;
 }

 function renderPanelAccion() {
  const contenedor = document.getElementById("cajaPanelAccion");
  if (!contenedor) return;

  if (!estado.turno) {
   contenedor.innerHTML = `
    <h3>Abrir turno</h3>
    <p>Inicia nueva sesion de caja</p>
    <label>Monto inicial de efectivo
     <div class="caja-input-dinero"><span>$</span><input id="cajaFondo" type="number" step="0.01" min="0" placeholder="0.00"></div>
    </label>
    <label>Motivo de apertura (opcional)
     <select id="cajaMotivoApertura" onchange="actualizarMotivoAperturaCaja(this.value)">
      <option value="">Seleccionar motivo</option>
      ${MOTIVOS_APERTURA.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}
     </select>
    </label>
    ${estado.motivoApertura === "Otro" ? `
     <label>Especifica el motivo
      <input id="cajaMotivoAperturaOtro" oninput="actualizarMotivoAperturaOtroCaja(this.value)" value="${esc(estado.motivoAperturaOtro)}">
     </label>
    ` : ""}
    <label>Notas (opcional)
     <input id="cajaNotasAbrir" placeholder="Escribe una nota...">
    </label>
    <button type="button" class="btn-caja-primario caja-btn-full" onclick="abrirTurnoCajaPOS()">Abrir turno</button>
   `;
   return;
  }

  contenedor.innerHTML = `
   <h3>Turno en curso</h3>
   <p>Responsable: ${esc(estado.turno.usuario || "Sin responsable")}</p>
   <div class="caja-corte-fila"><span>Fondo inicial</span><b>${money(estado.turno.fondo_inicial)}</b></div>
   <div class="caja-corte-fila"><span>Entradas registradas</span><b>${money(estado.resumen?.entradas || 0)}</b></div>
   <div class="caja-corte-fila"><span>Salidas registradas</span><b>${money(estado.resumen?.salidas || 0)}</b></div>
   ${estado.turno.notas ? `<p class="caja-notas-turno">${esc(estado.turno.notas)}</p>` : ""}
  `;
 }

 function renderMovimientos() {
  const contenedor = document.getElementById("cajaMovimientosRecientes");
  const botonVerTodos = document.getElementById("btnVerTodosMovs");
  if (!contenedor) return;

  if (!estado.movs.length) {
   contenedor.innerHTML = '<div class="caja-empty">Sin movimientos registrados.</div>';
   if (botonVerTodos) botonVerTodos.style.display = "none";
   return;
  }

  const visibles = estado.verTodosMovimientos ? estado.movs : estado.movs.slice(0, 5);

  contenedor.innerHTML = visibles.map(m => `
   <div class="caja-movimiento-fila ${esc(m.tipo)}">
    <span class="caja-movimiento-icono">${icono(m.tipo === "entrada" ? "arrowDownBox" : "arrowUpBox")}</span>
    <div>
     <strong>${esc(m.concepto || (m.tipo === "entrada" ? "Entrada de efectivo" : "Salida de efectivo"))}</strong>
     <span>${esc(m.referencia || "")}</span>
    </div>
    <div class="caja-movimiento-monto">
     <b class="${m.tipo === "entrada" ? "positivo" : "negativo"}">${m.tipo === "entrada" ? "+" : "-"}${money(m.monto)}</b>
     <small>${new Date(m.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</small>
    </div>
   </div>
  `).join("");

  if (botonVerTodos) {
   botonVerTodos.style.display = estado.movs.length > 5 ? "inline-flex" : "none";
   botonVerTodos.textContent = estado.verTodosMovimientos ? "Ver menos" : "Ver todos";
  }
 }

 function render() {
  renderEstadoSesion();
  renderKpis();
  renderCorteRapido();
  renderPanelAccion();
  renderMovimientos();
 }

 window.mostrarCajaPOS = async () => {
  screen();
  menu();
  hide();
  document.getElementById("pantallaCaja").style.display = "block";
  if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Caja", "Turnos, arqueo y movimientos", "caja");
  await cargarCajaPOS();
  iniciarCronometro();
 };

 window.cargarCajaPOS = async () => {
  try {
   const activo = await getJson("/caja/turno-activo");
   estado.turno = activo.turno;
   estado.resumen = activo.resumen;
   estado.resumenAyer = activo.resumenAyer;

   const movs = await getJson("/caja/movimientos");
   estado.movs = movs.movimientos || [];

   render();
  } catch (error) {
   alertaPOS(error.message, "Caja", "peligro");
  }
 };

 window.irMovimientosCajaPOS = () => {
  estado.verTodosMovimientos = true;
  renderMovimientos();
  document.getElementById("cajaMovimientosRecientes")?.scrollIntoView({ behavior: "smooth", block: "center" });
 };

 window.toggleVerTodosMovimientosCaja = () => {
  estado.verTodosMovimientos = !estado.verTodosMovimientos;
  renderMovimientos();
 };

 window.actualizarMotivoAperturaCaja = valor => {
  estado.motivoApertura = valor;
  renderPanelAccion();
 };

 window.actualizarMotivoAperturaOtroCaja = valor => { estado.motivoAperturaOtro = valor; };

 window.abrirTurnoCajaPOS = async () => {
  const motivoFinal = estado.motivoApertura === "Otro" ? estado.motivoAperturaOtro : estado.motivoApertura;
  const notasLibres = document.getElementById("cajaNotasAbrir")?.value || "";
  const notas = [motivoFinal, notasLibres].filter(Boolean).join(" - ");

  try {
   await getJson("/caja/abrir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     usuario: (typeof usuarioActual !== "undefined" && usuarioActual?.nombre) || "",
     fondoInicial: document.getElementById("cajaFondo")?.value || 0,
     notas
    })
   });
   estado.motivoApertura = "";
   estado.motivoAperturaOtro = "";
   alertaPOS("Caja lista para operar.", "Turno abierto", "exito");
   await cargarCajaPOS();
   iniciarCronometro();
  } catch (error) {
   alertaPOS(error.message, "Abrir turno", "peligro");
  }
 };

 window.guardarMovimientoCajaPOS = async () => {
  const monto = document.getElementById("cajaMonto")?.value || 0;
  if (!num(monto) || num(monto) <= 0) return alertaPOS("Indica un monto mayor a cero.", "Falta el monto", "info");

  try {
   await getJson("/caja/movimientos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     tipo: document.getElementById("cajaTipo")?.value,
     concepto: document.getElementById("cajaConcepto")?.value || "",
     monto,
     referencia: document.getElementById("cajaReferencia")?.value || ""
    })
   });
   ["cajaMonto", "cajaConcepto", "cajaReferencia"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
   });
   await cargarCajaPOS();
   alertaPOS("Caja actualizada.", "Movimiento registrado", "exito");
  } catch (error) {
   alertaPOS(error.message, "Movimiento de caja", "peligro");
  }
 };

 window.abrirModalCerrarTurnoCaja = () => {
  if (!estado.turno) return alertaPOS("Abre un turno antes de hacer un corte de caja.", "Sin turno abierto", "info");

  const modal = document.getElementById("modalCerrarTurnoCaja");
  const resumenContenedor = document.getElementById("cajaCierreResumen");
  if (resumenContenedor && estado.resumen) {
   resumenContenedor.innerHTML = `
    <div class="caja-corte-fila"><span>Ventas del turno</span><b>${money(estado.resumen.ventas)}</b></div>
    <div class="caja-corte-fila"><span>Total esperado en efectivo</span><b>${money(estado.resumen.esperado_efectivo)}</b></div>
   `;
  }
  if (modal) modal.style.display = "flex";
 };

 window.cerrarModalCerrarTurnoCaja = () => {
  const modal = document.getElementById("modalCerrarTurnoCaja");
  if (modal) modal.style.display = "none";
 };

 window.confirmarCierreTurnoCajaPOS = async () => {
  const ok = await confirmarPOS("Se guardara el corte y ya no podras agregar movimientos a este turno.", "Cerrar turno");
  if (!ok) return;

  try {
   const datos = await getJson("/caja/cerrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     efectivoContado: document.getElementById("cajaEfectivoContado")?.value || 0,
     tarjetaContado: document.getElementById("cajaTarjetaContado")?.value || 0,
     transferenciaContado: document.getElementById("cajaTransferenciaContado")?.value || 0,
     creditoContado: document.getElementById("cajaCreditoContado")?.value || 0,
     notas: document.getElementById("cajaNotasCerrar")?.value || ""
    })
   });
   window.cerrarModalCerrarTurnoCaja();
   await cargarCajaPOS();
   alertaPOS(
    "Diferencia: " + money(datos.turno.diferencia),
    "Turno cerrado",
    num(datos.turno.diferencia) === 0 ? "exito" : "alerta"
   );
  } catch (error) {
   alertaPOS(error.message, "Cerrar turno", "peligro");
  }
 };

 window.abrirHistorialCajas = async () => {
  const modal = document.getElementById("modalHistorialCajas");
  const lista = document.getElementById("cajaHistorialLista");
  if (!modal || !lista) return;

  modal.style.display = "flex";
  lista.innerHTML = '<div class="caja-empty">Cargando...</div>';

  try {
   const datos = await getJson("/caja/cortes");
   estado.cortes = datos.cortes || [];

   if (!estado.cortes.length) {
    lista.innerHTML = '<div class="caja-empty">Sin cortes registrados.</div>';
    return;
   }

   lista.innerHTML = `
    <table class="caja-tabla-historial">
     <thead><tr><th>Apertura</th><th>Responsable</th><th>Estado</th><th>Ventas</th><th>Esperado</th><th>Diferencia</th></tr></thead>
     <tbody>
      ${estado.cortes.map(c => `
       <tr>
        <td>${new Date(c.abierto_at).toLocaleString("es-MX")}</td>
        <td>${esc(c.usuario || "Sin responsable")}</td>
        <td><span class="caja-badge-estado ${esc(c.estado)}">${c.estado === "abierto" ? "Abierto" : "Cerrado"}</span></td>
        <td>${money(c.ventas_calculadas)}</td>
        <td>${money(c.esperado_efectivo)}</td>
        <td class="${num(c.diferencia) < 0 ? "negativo" : "positivo"}">${money(c.diferencia)}</td>
       </tr>
      `).join("")}
     </tbody>
    </table>
   `;
  } catch (error) {
   lista.innerHTML = '<div class="caja-empty">' + esc(error.message) + "</div>";
  }
 };

 window.cerrarHistorialCajas = () => {
  const modal = document.getElementById("modalHistorialCajas");
  if (modal) modal.style.display = "none";
 };

 setTimeout(() => {
  screen();
  menu();
  if (typeof profesionalizarSidebarPOS === "function") profesionalizarSidebarPOS();
 }, 1000);
})();

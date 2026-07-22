let creditosTabActual = "todos";
let creditosDetalleTabActual = "movimientos";
let datosCreditosActuales = null;

function inicialesClienteCredito(nombre) {
 return String(nombre || "Cliente")
 .trim()
 .split(/\s+/)
 .filter(Boolean)
 .slice(0, 2)
 .map(parte => parte[0])
 .join("")
 .toUpperCase() || "C";
}

function clienteCreditoVencido(cliente) {
 const saldo = Number(cliente.saldo || 0);

 if (saldo <= 0 || !cliente.fecha_vencimiento) return false;

 return String(cliente.fecha_vencimiento).slice(0, 10) < new Date().toISOString().slice(0, 10);
}

async function cargarCreditos() {
 const respuesta =
 await fetch("/creditos");

 if (!respuesta.ok) {
 const error =
 await respuesta.json()
 .catch(() => ({}));

 throw new Error(
 error.error ||
 "No se pudieron cargar los creditos"
 );
 }

 const datos =
 await respuesta.json();

 clientesCredito =
 datos.clientes || [];

 datosCreditosActuales = datos;

 if (clienteVentaActual && Number(clienteVentaActual.id)) {
  clienteVentaActual =
  clientesCredito.find(cliente => Number(cliente.id) === Number(clienteVentaActual.id)) ||
  clienteVentaActual;
  actualizarClientePOS();
 }

 const creditoPendiente =
 document.getElementById(
 "creditoPendiente"
 );

 const clientesDeuda =
 document.getElementById(
 "clientesDeuda"
 );

 if (creditoPendiente) {
 const deudaReal =
 clientesCredito.reduce(
 (total, cliente) =>
 total + Math.max(0, Number(cliente.saldo || 0)),
 0
 );

 creditoPendiente.textContent =
 dinero(deudaReal);
 }

 if (clientesDeuda) {
 const conAdeudo =
 clientesCredito.filter(cliente =>
 Number(cliente.saldo || 0) > 0
 ).length;

 clientesDeuda.textContent =
 `${conAdeudo} clientes`;
 }

 renderCreditos(datos);
 renderResumenStatsCreditos(datos);

 if (
 document.getElementById("pantallaClientes")?.style.display === "block"
 ) {
 renderClientes();
 }
}

function renderResumenStatsCreditos(datos) {
 const contenedor = document.getElementById("resumenStatsCreditos");
 if (!contenedor || !datos) return;

 contenedor.innerHTML = `
 <article class="credito-stat-purple">
 <span>${iconoUISVG("wallet")}</span>
 <div>
 <small>Saldo pendiente total</small>
 <strong>${dinero(datos.total)}</strong>
 </div>
 </article>
 <article class="credito-stat-blue">
 <span>${iconoUISVG("users")}</span>
 <div>
 <small>Creditos pendientes</small>
 <strong>${datos.clientesConAdeudo || 0}</strong>
 <em>Clientes con saldo</em>
 </div>
 </article>
 <article class="credito-stat-orange">
 <span>${iconoUISVG("alert")}</span>
 <div>
 <small>Creditos vencidos</small>
 <strong>${datos.clientesVencidos || 0}</strong>
 <em class="credito-stat-alerta">${dinero(datos.totalVencido || 0)} vencidos</em>
 </div>
 </article>
 <article class="credito-stat-green">
 <span>${iconoUISVG("chart")}</span>
 <div>
 <small>Pagos este mes</small>
 <strong>${dinero(datos.pagosEsteMes || 0)}</strong>
 </div>
 </article>
 `;
}

function creditosClientesTab() {
 let lista = clientesCredito;

 if (creditosTabActual === "vencidos") lista = lista.filter(clienteCreditoVencido);
 else if (creditosTabActual === "al-dia") lista = lista.filter(cliente => !clienteCreditoVencido(cliente));

 const texto = normalizarTexto(document.getElementById("buscarListaCreditos")?.value || "");

 if (texto) {
 lista = lista.filter(cliente =>
 normalizarTexto(cliente.nombre || "").includes(texto) ||
 String(cliente.id).includes(texto)
 );
 }

 return lista;
}

function cambiarTabCreditos(tab) {
 creditosTabActual = tab;
 renderCreditos(datosCreditosActuales || {});
}

function renderCreditos(datos) {
 const lista =
 document.querySelector(
 ".creditos-principales"
 );

 if (!lista) return;

 const tabs = document.getElementById("creditosTabs");
 const vencidos = clientesCredito.filter(clienteCreditoVencido).length;
 const alDia = clientesCredito.length - vencidos;

 if (tabs) {
 tabs.innerHTML = `
 <button type="button" class="${creditosTabActual === "todos" ? "activo" : ""}" onclick="cambiarTabCreditos('todos')">Todos (${clientesCredito.length})</button>
 <button type="button" class="${creditosTabActual === "vencidos" ? "activo" : ""}" onclick="cambiarTabCreditos('vencidos')">Vencidos (${vencidos})</button>
 <button type="button" class="${creditosTabActual === "al-dia" ? "activo" : ""}" onclick="cambiarTabCreditos('al-dia')">Al dia (${alDia})</button>
 `;
 }

 const clientesTab = creditosClientesTab();

 if (clientesTab.length === 0) {
 lista.innerHTML =
 `<div class="cliente-credito">
 <h3>Sin clientes</h3>
 <p>No hay cuentas de credito en este filtro.</p>
 </div>`;
 } else {
 lista.innerHTML =
 clientesTab.map(cliente => {
 const vencido = clienteCreditoVencido(cliente);

 return `
 <button type="button" class="cliente-credito ${creditoActual && Number(creditoActual.id) === Number(cliente.id) ? "activo" : ""}" onclick="abrirCuentaCreditoDetalle(${cliente.id})">
 <span class="cliente-avatar">${inicialesClienteCredito(cliente.nombre)}</span>
 <span class="cliente-credito-texto">
 <strong>${escaparPOS(cliente.nombre || "Cliente")}</strong>
 <small>CR-${String(cliente.id).padStart(6, "0")}</small>
 ${cliente.fecha_vencimiento ? `<small>Vence: ${new Date(cliente.fecha_vencimiento).toLocaleDateString("es-MX")}</small>` : ""}
 </span>
 <span class="cliente-credito-derecha">
 <strong>${dinero(cliente.saldo)}</strong>
 <span class="credito-badge ${vencido ? "vencido" : "al-dia"}">${vencido ? "Vencido" : "Al dia"}</span>
 </span>
 </button>
 `;
 }).join("");
 }

 const textoPaginacion = document.getElementById("creditosListaTexto");
 if (textoPaginacion) {
 textoPaginacion.textContent = `Mostrando 1 a ${clientesTab.length} de ${clientesTab.length} clientes`;
 }
}

async function abrirCreditos() {
 await mostrarCreditos();
}

async function mostrarCreditos() {
 ocultarPantallasPrincipales();

 document.getElementById("pantallaCreditos").style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Creditos", "Cuentas, saldos y pagos de clientes", "creditos");
 }

 creditosTabActual = "todos";
 regresarListaCreditos();

 try {
 await cargarCreditos();
 } catch (error) {
 const lista =
 document.querySelector(
 ".creditos-principales"
 );

 if (lista) {
 lista.innerHTML =
 `<div class="cliente-credito">
 <h3>Error cargando creditos</h3>
 <p>${error.message}</p>
 </div>`;
 }

 alert(error.message);
 }
}

function cerrarCreditos() {
 mostrarInicio();
}

async function abrirCuentaCreditoDetalle(id) {
 await abrirCuentaCliente(id);

 creditosDetalleTabActual = "movimientos";
 renderCreditoDetalleExtra();
 mostrarTabDetalleCredito("movimientos");
 renderCreditos(datosCreditosActuales || {});
}

function renderCreditoDetalleExtra() {
 if (!creditoActual) return;

 const saldo = Number(creditoActual.saldo || 0);
 const limite = Number(creditoActual.limite_credito || 0);
 const vencido = clienteCreditoVencido(creditoActual);

 const avatar = document.getElementById("creditoDetalleAvatar");
 if (avatar) avatar.textContent = inicialesClienteCredito(creditoActual.nombre);

 const badge = document.getElementById("creditoDetalleBadge");
 if (badge) {
 badge.textContent = saldo <= 0 ? "Sin saldo" : vencido ? "Vencido" : "Al dia";
 badge.className = "credito-badge " + (saldo <= 0 ? "al-dia" : vencido ? "vencido" : "al-dia");
 }

 const codigo = document.getElementById("creditoDetalleCodigo");
 if (codigo) codigo.textContent = `CR-${String(creditoActual.id).padStart(6, "0")}`;

 const movimientos = window.movimientosCreditoActuales || [];
 const ultimoMovimiento = movimientos.length
 ? movimientos.reduce((ultima, mov) => new Date(mov.fecha) > new Date(ultima) ? mov.fecha : ultima, movimientos[0].fecha)
 : null;

 const textoMovimientos = document.getElementById("movimientosPaginacionTexto");
 if (textoMovimientos) {
 textoMovimientos.textContent = movimientos.length
 ? `Mostrando 1 a ${Math.min(6, movimientos.length)} de ${movimientos.length} movimientos`
 : "Sin movimientos registrados";
 }

 const dias = creditoActual.fecha_vencimiento
 ? Math.round((new Date(creditoActual.fecha_vencimiento) - new Date()) / 86400000)
 : null;

 const resumenLateral = document.getElementById("creditoResumenLateral");
 if (resumenLateral) {
 resumenLateral.innerHTML = `
 <div><span>Fecha de creacion</span><strong>${new Date(creditoActual.created_at).toLocaleDateString("es-MX")}</strong></div>
 <div><span>Ultimo movimiento</span><strong>${ultimoMovimiento ? new Date(ultimoMovimiento).toLocaleDateString("es-MX") : "Sin movimientos"}</strong></div>
 <div><span>Vencimiento</span><strong>${creditoActual.fecha_vencimiento ? new Date(creditoActual.fecha_vencimiento).toLocaleDateString("es-MX") : "Sin fecha"}</strong></div>
 ${dias !== null ? `<div><span>Dias para vencer</span><strong class="${dias < 0 ? "rojo" : ""}">${dias < 0 ? Math.abs(dias) + " dias vencido" : dias + " dias"}</strong></div>` : ""}
 <div><span>Limite de credito</span><strong>${dinero(limite)}</strong></div>
 <div><span>Credito utilizado</span><strong>${dinero(saldo)}</strong></div>
 <div><span>Saldo pendiente</span><strong class="${saldo > 0 ? "rojo" : "verde"}">${dinero(saldo)}</strong></div>
 `;
 }

 const infoTab = document.getElementById("creditoInfoTab");
 if (infoTab) {
 infoTab.innerHTML = `
 <div><span>Nombre</span><strong>${escaparPOS(creditoActual.nombre || "")}</strong></div>
 <div><span>Telefono</span><strong>${escaparPOS(creditoActual.telefono || "Sin registrar")}</strong></div>
 <div><span>Cliente desde</span><strong>${new Date(creditoActual.created_at).toLocaleDateString("es-MX")}</strong></div>
 <div><span>Fecha de vencimiento</span><strong>${creditoActual.fecha_vencimiento ? new Date(creditoActual.fecha_vencimiento).toLocaleDateString("es-MX") : "Sin fecha"}</strong></div>
 `;
 }

 const pagosTab = document.getElementById("creditoPagosTabla");
 if (pagosTab) {
 const pagos = (window.movimientosCreditoActuales || []).filter(mov => mov.tipo === "abono");
 pagosTab.innerHTML = pagos.length === 0
 ? `<tr><td colspan="4" class="inventario-vacio">Sin pagos registrados.</td></tr>`
 : pagos.map(pago => `
 <tr>
 <td>${new Date(pago.fecha).toLocaleDateString("es-MX")}</td>
 <td>${escaparPOS(pago.referencia || "-")}</td>
 <td>${escaparPOS(pago.concepto || "")}</td>
 <td>${dinero(pago.monto)}</td>
 </tr>
 `).join("");
 }
}

function mostrarTabDetalleCredito(tab) {
 creditosDetalleTabActual = tab;

 document.querySelectorAll(".credito-detalle-tabs button").forEach(boton => {
 boton.classList.toggle("activo", boton.dataset.tab === tab);
 });

 document.querySelectorAll(".credito-tab-panel").forEach(panel => {
 panel.style.display = panel.dataset.tabPanel === tab ? "block" : "none";
 });
}

function verDetallesClienteDesdeCreditos() {
 if (!creditoActual) return;

 mostrarClientes();

 setTimeout(() => {
 const campo = document.getElementById("buscarClientes");
 if (campo) {
 campo.value = creditoActual.nombre;
 buscarClientes();
 }
 }, 80);
}

async function abrirCuentaCliente(id) {
 if (!id) {
 alert(
 "Primero carga o crea un cliente de credito."
 );
 return;
 }

 const respuesta =
 await fetch(`/creditos/clientes/${id}`);

 if (!respuesta.ok) {
 alert("No se pudo abrir la cuenta");
 return;
 }

 const datos =
 await respuesta.json();

 creditoActual =
 datos.cliente;

 const saldo =
 Number(datos.cliente.saldo || 0);

 const limite =
 Number(datos.cliente.limite_credito || 0);

 const disponible =
 limite - saldo;

 document.querySelector(
 "#detalleCliente .cliente-info h2"
 ).textContent =
 datos.cliente.nombre;

 document.querySelector(
 "#detalleCliente .cliente-info p"
 ).textContent =
 `Cliente desde: ${
 new Date(datos.cliente.created_at)
 .toLocaleDateString("es-MX")
 }`;

 document.querySelector(
 "#detalleCliente .limite-credito strong"
 ).textContent =
 dinero(limite);

 const tarjetas =
 document.querySelectorAll(
 "#detalleCliente .credito-resumen .resumen-card strong"
 );

 if (tarjetas.length >= 4) {
 tarjetas[0].textContent = dinero(saldo);
 tarjetas[1].textContent = dinero(saldo);
 tarjetas[2].textContent = dinero(disponible);
 tarjetas[3].textContent =
 saldo > limite && limite > 0
 ? "Excedido"
 : saldo > 0
 ? "Por vencer"
 : "Al corriente";
 }

 const cuerpo =
 document.querySelector(
 "#detalleCliente .tabla-creditos tbody"
 );

 let saldoAcumulado = 0;

 window.movimientosCreditoActuales =
 datos.movimientos || [];

 cuerpo.innerHTML =
 datos.movimientos.map((movimiento, indice) => {
 const monto =
 Number(movimiento.monto);

 const productosMovimiento =
 Array.isArray(movimiento.productos)
 ? movimiento.productos
 : [];

 saldoAcumulado +=
 movimiento.tipo === "venta"
 ? monto
 : -monto;

 return `
 <tr class="${indice >= 6 ? "movimiento-extra oculto" : ""}">
 <td>${
 new Date(movimiento.fecha)
 .toLocaleDateString("es-MX")
 }</td>
 <td>${
 movimiento.tipo === "venta"
 ? " Venta"
 : " Abono"
 }</td>
 <td>${escaparPOS(movimiento.referencia || "")}</td>
 <td>
 ${escaparPOS(movimiento.concepto || "")}
 ${
 productosMovimiento.length > 0
 ? `<br><button class="btn-ver-detalle-venta" onclick="verDetalleVentaCredito(${indice})">Ver detalle</button>`
 : ""
 }
 </td>
 <td>${
 movimiento.tipo === "venta"
 ? dinero(monto)
 : `-${dinero(monto)}`
 }</td>
 <td>${dinero(saldoAcumulado)}</td>
 </tr>
 `; 
 }).join("");

 const contenedorMovimientos =
 document.querySelector("#detalleCliente .movimientos-cliente");

 const botonVerMasAnterior =
 document.getElementById("btnVerMasMovimientosCredito");

 if (botonVerMasAnterior) botonVerMasAnterior.remove();

 if (contenedorMovimientos && (datos.movimientos || []).length > 6) {
  contenedorMovimientos.insertAdjacentHTML(
   "beforeend",
   `<button id="btnVerMasMovimientosCredito" class="btn-ver-mas-creditos" type="button" onclick="mostrarMasMovimientosCredito()">Ver mas movimientos</button>`
  );
 }

 document.getElementById("detalleCliente").style.display = "block";
}

function mostrarMasMovimientosCredito() {
 document.querySelectorAll("#detalleCliente .movimiento-extra.oculto")
 .forEach(fila => fila.classList.remove("oculto"));

 const boton =
 document.getElementById("btnVerMasMovimientosCredito");

 if (boton) boton.remove();
}

function regresarListaCreditos() {
 document.getElementById("listaCreditos").style.display = "grid";
 document.getElementById("detalleCliente").style.display = "none";
}

async function imprimirEstadoCuentaCredito() {
 if (!creditoActual) {
 await alertaPOS("Abre primero la cuenta de un cliente para imprimir su estado de cuenta.", "Estado de cuenta", "info");
 return;
 }

 const negocio =
 configuracionNegocio() || {};

 const saldo =
 Number(creditoActual.saldo || 0);

 const limite =
 Number(creditoActual.limite_credito || 0);

 const disponible =
 limite - saldo;

 const estado =
 saldo > limite && limite > 0
 ? "Excedido"
 : saldo > 0
 ? "Por vencer"
 : "Al corriente";

 const movimientos =
 window.movimientosCreditoActuales || [];

 const filasMovimientos =
 movimientos.map(movimiento => {
 const monto =
 Number(movimiento.monto || 0);

 const fecha =
 new Date(movimiento.fecha).toLocaleDateString("es-MX");

 const tipo =
 movimiento.tipo === "venta" ? "Venta" : "Abono";

 const signo =
 movimiento.tipo === "venta" ? "" : "-";

 return `
 <div style="display:flex;justify-content:space-between;font-size:11px;margin:3px 0;">
 <span>${fecha} ${tipo}</span>
 <span>${signo}${dinero(monto)}</span>
 </div>
 `;
 }).join("");

 const ticket = `
 <div style="text-align:center;">
 <h2>${escaparPOS(negocio.nombre || "Nexo POS")}</h2>
 <div>Estado de cuenta</div>
 </div>
 <hr>
 <div>Cliente: ${escaparPOS(creditoActual.nombre || "")}</div>
 <div>Fecha: ${new Date().toLocaleDateString("es-MX")}</div>
 <hr>
 <div style="display:flex;justify-content:space-between;"><span>Saldo pendiente</span><span>${dinero(saldo)}</span></div>
 <div style="display:flex;justify-content:space-between;"><span>Limite de credito</span><span>${dinero(limite)}</span></div>
 <div style="display:flex;justify-content:space-between;"><span>Disponible</span><span>${dinero(disponible)}</span></div>
 <div style="display:flex;justify-content:space-between;"><span>Estado</span><span>${estado}</span></div>
 <hr>
 <div style="font-weight:bold;">Movimientos</div>
 ${filasMovimientos || "<div>Sin movimientos registrados</div>"}
 <hr>
 <div style="text-align:center;">Gracias por su preferencia</div>
 `;

 const enviado =
 await imprimirTicketPOS(ticket, null, { abrirCajon: false });

 if (!enviado) {
 await alertaPOS("No se pudo enviar el estado de cuenta a la impresora.", "Estado de cuenta", "alerta");
 }
}

function verDetalleVentaCredito(indice) {
 const movimiento =
 (window.movimientosCreditoActuales || [])[indice];

 if (!movimiento) return;

 const productos =
 Array.isArray(movimiento.productos)
 ? movimiento.productos
 : [];

 let modal =
 document.getElementById("modalDetalleVentaCredito");

 if (!modal) {
 modal =
 document.createElement("div");

 modal.id =
 "modalDetalleVentaCredito";

 modal.className =
 "modal-form-credito";

 document.body.appendChild(modal);
 }

 const total =
 productos.reduce(
 (suma, producto) =>
 suma + Number(producto.importe || 0),
 0
 );

 modal.innerHTML = `
 <div class="detalle-venta-card">
 <div class="detalle-venta-header">
 <button type="button" class="btn-regresar-detalle-credito" onclick="cerrarDetalleVentaCredito()">Regresar</button>
 <div>
 <h2>Detalle de venta ${escaparPOS(movimiento.referencia || "")}</h2>
 <p>${new Date(movimiento.fecha).toLocaleDateString("es-MX")}</p>
 </div>
 </div>

 <div class="detalle-venta-resumen">
 <div>
 <span>Total de la venta</span>
 <strong>${dinero(movimiento.monto || total)}</strong>
 </div>
 <div>
 <span>Productos</span>
 <strong>${productos.length}</strong>
 </div>
 </div>

 <table class="tabla-detalle-venta">
 <thead>
 <tr>
 <th>Cantidad</th>
 <th>Producto</th>
 <th>Precio unitario</th>
 <th>Importe</th>
 </tr>
 </thead>
 <tbody>
 ${productos.map(producto => `
 <tr>
 <td>${producto.cantidad || 1}</td>
 <td>${escaparPOS(producto.nombre || "Producto")}</td>
 <td>${dinero(producto.precio || 0)}</td>
 <td>${dinero(producto.importe || 0)}</td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 </div>
 `;

 modal.style.display =
 "flex";
}

function cerrarDetalleVentaCredito() {
 const modal =
 document.getElementById("modalDetalleVentaCredito");

 if (modal) {
 modal.style.display = "none";
 }
}

function abrirFormularioCredito(configuracion) {
 const modal =
 document.getElementById(
 "modalFormularioCredito"
 );

 const titulo =
 document.getElementById(
 "formCreditoTitulo"
 );

 const subtitulo =
 document.getElementById(
 "formCreditoSubtitulo"
 );

 const campos =
 document.getElementById(
 "formCreditoCampos"
 );

 titulo.textContent =
 configuracion.titulo;

 subtitulo.textContent =
 configuracion.subtitulo || "";

 campos.innerHTML =
 configuracion.campos.map(campo => `
 <label>
 <span>${campo.etiqueta}</span>
 ${
 campo.tipo === "select"
 ? `<select id="creditoCampo_${campo.nombre}" ${campo.requerido ? "required" : ""}>
 ${(campo.opciones || []).map(opcion => `
 <option value="${opcion.valor}">
 ${opcion.etiqueta}
 </option>
 `).join("")}
 </select>`
 : `<input
 id="creditoCampo_${campo.nombre}"
 type="${campo.tipo || "text"}"
 placeholder="${campo.placeholder || ""}"
 value="${campo.valor || ""}"
 ${campo.min !== undefined ? `min="${campo.min}"` : ""}
 ${campo.requerido ? "required" : ""}
 >`
 }
 </label>
 `).join("");

 campos.onsubmit = event => {
  event.preventDefault();
  guardarFormularioCredito();
 };

 campos.onkeydown = event => {
  if (event.key !== "Enter") return;
  if (event.target?.tagName === "TEXTAREA") return;

  event.preventDefault();
  guardarFormularioCredito();
 };

 modal.style.display = "flex";

 setTimeout(() => {
 const primerCampo =
 campos.querySelector("select, input");

 if (!primerCampo) return;

 primerCampo.focus();

 if (
 primerCampo.tagName === "INPUT" &&
 typeof primerCampo.setSelectionRange === "function"
 ) {
  const final =
  primerCampo.value.length;

  primerCampo.setSelectionRange(final, final);
 }
 }, 50);

 return new Promise(resolve => {
 resolverFormularioCredito = {
 resolve,
 campos: configuracion.campos
 };
 });
}

function cerrarFormularioCredito() {
 const modal =
 document.getElementById(
 "modalFormularioCredito"
 );

 modal.style.display = "none";

 if (resolverFormularioCredito) {
 resolverFormularioCredito.resolve(null);
 resolverFormularioCredito = null;
 }
}

function guardarFormularioCredito() {
 if (!resolverFormularioCredito) return;

 const datos = {};

 for (const campo of resolverFormularioCredito.campos) {
 const input =
 document.getElementById(
 `creditoCampo_${campo.nombre}`
 );

 const valor =
 input.value.trim();

 if (campo.requerido && !valor) {
 input.focus();
 return;
 }

 datos[campo.nombre] =
 campo.tipo === "number"
 ? Number(valor || 0)
 : valor;
 }

 const resolver =
 resolverFormularioCredito.resolve;

 resolverFormularioCredito = null;

 document.getElementById(
 "modalFormularioCredito"
 ).style.display = "none";

 resolver(datos);
}

async function abrirNuevoClienteCredito(prellenado = {}) {
 const datos =
 await abrirFormularioCredito({
 titulo: "Nuevo cliente",
 subtitulo: prellenado.nombre ? "Nexo prellenó estos datos -- revisalos antes de guardar" : "Agrega una cuenta de credito",
 campos: [
 {
 nombre: "nombre",
 etiqueta: "Nombre del cliente",
 placeholder: "Ej. Constructora Lopez",
 valor: prellenado.nombre || "",
 requerido: true
 },
 {
 nombre: "telefono",
 etiqueta: "Telefono",
 placeholder: "Ej. 498 000 0000",
 valor: prellenado.telefono || ""
 },
 {
 nombre: "limiteCredito",
 etiqueta: "Limite de credito",
 tipo: "number",
 placeholder: "0",
 valor: String(prellenado.limiteCredito || 0),
 min: 0
 },
 {
 nombre: "fechaVencimiento",
 etiqueta: "Fecha de vencimiento (opcional)",
 tipo: "date"
 }
 ]
 });

 if (!datos) return;

 const payloadCliente = {
 nombre: datos.nombre,
 telefono: datos.telefono,
 limiteCredito: datos.limiteCredito,
 fechaVencimiento: datos.fechaVencimiento || null
 };

 let respuesta;
 let clienteOffline = false;

 try {
 respuesta =
 await fetch(
 "/creditos/clientes",
 {
 method: "POST",
 headers: {
 "Content-Type":
 "application/json"
 },
 body: JSON.stringify(payloadCliente)
 }
 );
 } catch (error) {
 const idLocal =
 -Date.now();

 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "cliente_credito_creado",
 "cliente_credito",
 "",
 {
 ...payloadCliente,
 clienteId: null,
 localId: idLocal,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 alert("No se pudo crear el cliente");
 return;
 }

 clientesCredito = [
 {
 id: idLocal,
 nombre: payloadCliente.nombre,
 telefono: payloadCliente.telefono,
 limite_credito: payloadCliente.limiteCredito || 0,
 fecha_vencimiento: payloadCliente.fechaVencimiento || null,
 saldo: 0,
 created_at: new Date().toISOString(),
 pendienteSync: true
 },
 ...clientesCredito
 ];

 clienteOffline = true;
 }

 if (!clienteOffline && !respuesta.ok) {
 alert("No se pudo crear el cliente");
 return;
 }

 if (clienteOffline) {
 await guardarCatalogosLocalesDesktopPOS();
 renderCreditos({
 clientes: clientesCredito,
 total: clientesCredito.reduce((suma, cliente) => suma + Number(cliente.saldo || 0), 0),
 clientesConAdeudo: clientesCredito.filter(cliente => Number(cliente.saldo || 0) > 0).length
 });
 await alertaPOS("Cliente guardado offline. Se sincronizara cuando vuelva el internet.", "Cliente offline", "exito");
 } else {
 await cargarCreditos();
 }
}

async function registrarAbonoCredito() {
 if (!creditoActual) {
 alert(
 "Primero abre la cuenta de un cliente."
 );
 return;
 }

 const datos =
 await abrirFormularioCredito({
 titulo: "Registrar abono",
 subtitulo: creditoActual.nombre,
 campos: [
 {
 nombre: "monto",
 etiqueta: "Monto del abono",
 tipo: "number",
 placeholder: "0",
 valor: "0",
 min: 1,
 requerido: true
 },
 {
 nombre: "concepto",
 etiqueta: "Concepto",
 placeholder: "Pago parcial",
 valor: "Pago parcial"
 }
 ]
 });

 if (!datos) return;

 const monto =
 Number(datos.monto);

 if (monto <= 0) return;

 const concepto =
 datos.concepto ||
 "Pago parcial";

 await fetch(
 `/creditos/clientes/${creditoActual.id}/abonos`,
 {
 method: "POST",
 headers: {
 "Content-Type":
 "application/json"
 },
 body: JSON.stringify({
 monto,
 concepto
 })
 }
 );

 await cargarCreditos();
 await abrirCuentaCreditoDetalle(creditoActual.id);
}

async function registrarCargoCredito() {
 if (!(await validarOperacionLicenciaNexoPOS("un cargo a credito"))) return;

 if (!creditoActual) {
 alert(
 "Primero abre la cuenta de un cliente."
 );
 return;
 }

 const datos =
 await abrirFormularioCredito({
 titulo: "Registrar cargo",
 subtitulo: creditoActual.nombre,
 campos: [
 {
 nombre: "monto",
 etiqueta: "Monto del cargo",
 tipo: "number",
 placeholder: "0",
 valor: "0",
 min: 1,
 requerido: true
 },
 {
 nombre: "concepto",
 etiqueta: "Concepto",
 placeholder: "Venta a credito",
 valor: "Venta a credito"
 }
 ]
 });

 if (!datos) return;

 const monto =
 Number(datos.monto);

 if (monto <= 0) return;

 const concepto =
 datos.concepto ||
 "Venta a credito";

 await fetch(
 `/creditos/clientes/${creditoActual.id}/cargos`,
 {
 method: "POST",
 headers: {
 "Content-Type":
 "application/json"
 },
 body: JSON.stringify({
 monto,
 concepto,
 productos: []
 })
 }
 );

 await cargarCreditos();
 await abrirCuentaCreditoDetalle(creditoActual.id);
}

function verTodosCreditos() {
 cargarCreditos();
}

async function mostrarClientes() {
 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
 document.getElementById("pantallaClientes").style.display = "block";

 await cargarCreditos();
 renderClientes();
}

function clientesFiltrados() {
 const texto =
 (document.getElementById("buscarClientes")?.value || "")
 .toLowerCase()
 .trim();

 if (!texto) return clientesCredito;

 return clientesCredito.filter(cliente =>
 String(cliente.nombre || "").toLowerCase().includes(texto)
 ||
 String(cliente.telefono || "").toLowerCase().includes(texto)
 ||
 String(cliente.saldo || "").toLowerCase().includes(texto)
 );
}

function buscarClientes() {
 renderClientes();
}

function renderClientes() {
 const tabla =
 document.getElementById("tablaClientes");

 if (!tabla) return;

 const clientes =
 clientesFiltrados();

 const total =
 clientesCredito.reduce(
 (suma, cliente) =>
 suma + Number(cliente.saldo || 0),
 0
 );

 document.getElementById("clientesTotal").textContent =
 clientesCredito.length;

 document.getElementById("clientesConAdeudo").textContent =
 clientesCredito.filter(
 cliente =>
 Number(cliente.saldo || 0) > 0
 ).length;

 document.getElementById("clientesCreditoTotal").textContent =
 dinero(total);

 if (clientes.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="clientes-vacio">
 No hay clientes para mostrar.
 </td>
 </tr>
 `;
 return;
 }

 tabla.innerHTML =
 clientes.map(cliente => {
 const saldo =
 Number(cliente.saldo || 0);

 return `
 <tr>
 <td>
 <strong>${cliente.nombre}</strong>
 <span>Cliente desde ${
 new Date(cliente.created_at)
 .toLocaleDateString("es-MX")
 }</span>
 </td>
 <td>${cliente.telefono || "-"}</td>
 <td class="${saldo > 0 ? "cliente-saldo-rojo" : "cliente-saldo-ok"}">
 ${dinero(saldo)}
 </td>
 <td>${dinero(cliente.limite_credito || 0)}</td>
 <td>
 <span class="estado-cliente ${saldo > 0 ? "adeudo" : "ok"}">
 ${saldo > 0 ? "Con adeudo" : "Al corriente"}
 </span>
 </td>
 <td class="acciones-clientes">
 <button onclick="verCreditoDesdeClientes(${cliente.id})">
 Cuenta
 </button>
 <button onclick="editarClienteCredito(${cliente.id})">
 Editar
 </button>
 <button onclick="desactivarClienteCredito(${cliente.id})">
 Baja
 </button>
 </td>
 </tr>
 `;
 }).join("");
}

async function verCreditoDesdeClientes(id) {
 await abrirCreditos();
 await abrirCuentaCreditoDetalle(id);
}

async function editarClienteCredito(id) {
 const cliente =
 clientesCredito.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!cliente) return;

 const datos =
 await abrirFormularioCredito({
 titulo: "Editar cliente",
 subtitulo: "Actualiza los datos de credito",
 campos: [
 {
 nombre: "nombre",
 etiqueta: "Nombre del cliente",
 valor: cliente.nombre,
 requerido: true
 },
 {
 nombre: "telefono",
 etiqueta: "Telefono",
 valor: cliente.telefono || ""
 },
 {
 nombre: "limiteCredito",
 etiqueta: "Limite de credito",
 tipo: "number",
 valor: cliente.limite_credito || 0
 },
 {
 nombre: "fechaVencimiento",
 etiqueta: "Fecha de vencimiento (opcional)",
 tipo: "date",
 valor: cliente.fecha_vencimiento ? String(cliente.fecha_vencimiento).slice(0, 10) : ""
 }
 ]
 });

 if (!datos) return;

 let respuesta;
 let clienteOffline = false;

 try {
 respuesta =
 await fetch(
 `/creditos/clientes/${id}`,
 {
 method: "PUT",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify(datos)
 }
 );
 } catch (error) {
 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "cliente_credito_actualizado",
 "cliente_credito",
 id,
 {
 ...datos,
 clienteId: id,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 alert("No se pudo editar el cliente");
 return;
 }

 clientesCredito =
 clientesCredito.map(item =>
 Number(item.id) === Number(id)
 ? {
 ...item,
 nombre: datos.nombre,
 telefono: datos.telefono,
 limite_credito: datos.limiteCredito,
 fecha_vencimiento: datos.fechaVencimiento || null,
 pendienteSync: true
 }
 : item
 );

 clienteOffline = true;
 }

 if (!clienteOffline && !respuesta.ok) {
 alert("No se pudo editar el cliente");
 return;
 }

 if (clienteOffline) {
 await guardarCatalogosLocalesDesktopPOS();
 } else {
 await cargarCreditos();
 }

 if (document.getElementById("pantallaClientes")?.style.display === "block") {
 renderClientes();
 }

 if (document.getElementById("pantallaCreditos")?.style.display === "block") {
 if (creditoActual && Number(creditoActual.id) === Number(id)) {
 await abrirCuentaCreditoDetalle(id);
 } else {
 renderCreditos(datosCreditosActuales || {});
 }
 }
}

async function desactivarClienteCredito(id) {
 const cliente =
 clientesCredito.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!cliente) return;

 const confirmar =
 await confirmarPOS(
 `Dar de baja a ${cliente.nombre}?`,
 "Baja de cliente",
 "peligro"
 );

 if (!confirmar) return;

 let respuesta;
 let clienteOffline = false;

 try {
 respuesta =
 await fetch(
 `/creditos/clientes/${id}`,
 {
 method: "DELETE"
 }
 );
 } catch (error) {
 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "cliente_credito_eliminado",
 "cliente_credito",
 id,
 {
 clienteId: id,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 alert("No se pudo dar de baja el cliente");
 return;
 }

 clientesCredito =
 clientesCredito.filter(item => Number(item.id) !== Number(id));

 clienteOffline = true;
 }

 if (!clienteOffline && !respuesta.ok) {
 alert("No se pudo dar de baja el cliente");
 return;
 }

 if (clienteOffline) {
 await guardarCatalogosLocalesDesktopPOS();
 } else {
 await cargarCreditos();
 }

 if (document.getElementById("pantallaClientes")?.style.display === "block") {
 renderClientes();
 }

 if (document.getElementById("pantallaCreditos")?.style.display === "block") {
 if (creditoActual && Number(creditoActual.id) === Number(id)) {
 creditoActual = null;
 regresarListaCreditos();
 }

 renderCreditos(datosCreditosActuales || {});
 }
}

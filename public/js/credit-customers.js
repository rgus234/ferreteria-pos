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
 return Boolean(cliente?.vencido);
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
 `<tr><td colspan="3" class="creditos-tabla-vacio">No hay cuentas de credito en este filtro.</td></tr>`;
 } else {
 lista.innerHTML =
 clientesTab.map(cliente => {
 const vencido = clienteCreditoVencido(cliente);

 return `
 <tr class="fila-cliente-credito ${creditoActual && Number(creditoActual.id) === Number(cliente.id) ? "activo" : ""}" onclick="abrirCuentaCreditoDetalle(${cliente.id})">
 <td class="celda-cliente-credito">
 <span class="cliente-avatar">${inicialesClienteCredito(cliente.nombre)}</span>
 <span class="cliente-credito-texto">
 <strong>${escaparPOS(cliente.nombre || "Cliente")}</strong>
 <small>CR-${String(cliente.id).padStart(6, "0")}${cliente.vencido ? ` &middot; <span class="rojo">Vencido: ${dinero(cliente.totalVencido)}</span>` : ""}</small>
 </span>
 </td>
 <td class="celda-saldo-credito"><strong>${dinero(cliente.saldo)}</strong></td>
 <td class="celda-estado-credito"><span class="credito-badge ${vencido ? "vencido" : "al-dia"}">${vencido ? "Vencido" : "Al dia"}</span></td>
 </tr>
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
 `<tr><td colspan="3" class="creditos-tabla-vacio">Error cargando creditos: ${escaparPOS(error.message)}</td></tr>`;
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

 const aging = window.creditoAgingActual;

 const resumenLateral = document.getElementById("creditoResumenLateral");
 if (resumenLateral) {
 resumenLateral.innerHTML = `
 <div><span>Fecha de creacion</span><strong>${new Date(creditoActual.created_at).toLocaleDateString("es-MX")}</strong></div>
 <div><span>Ultimo movimiento</span><strong>${ultimoMovimiento ? new Date(ultimoMovimiento).toLocaleDateString("es-MX") : "Sin movimientos"}</strong></div>
 ${aging && aging.ventaVencidaMasAntigua ? `
 <div><span>Compra vencida mas antigua</span><strong>${new Date(aging.ventaVencidaMasAntigua.fechaVencimiento).toLocaleDateString("es-MX")}</strong></div>
 <div><span>Dias de atraso</span><strong class="rojo">${aging.ventaVencidaMasAntigua.diasVencido} dias</strong></div>
 ` : ""}
 <div><span>Limite de credito</span><strong>${dinero(limite)}</strong></div>
 <div><span>Credito utilizado</span><strong>${dinero(saldo)}</strong></div>
 <div><span>Saldo pendiente</span><strong class="${saldo > 0 ? "rojo" : "verde"}">${dinero(saldo)}</strong></div>
 ${aging && aging.vencido ? `<div><span>Total vencido</span><strong class="rojo">${dinero(aging.totalVencido)}</strong></div>` : ""}
 `;
 }

 const infoTab = document.getElementById("creditoInfoTab");
 if (infoTab) {
 infoTab.innerHTML = `
 <div><span>Nombre</span><strong>${escaparPOS(creditoActual.nombre || "")}</strong></div>
 <div><span>Telefono</span><strong>${escaparPOS(creditoActual.telefono || "Sin registrar")}</strong></div>
 <div><span>Cliente desde</span><strong>${new Date(creditoActual.created_at).toLocaleDateString("es-MX")}</strong></div>
 `;
 }

 const accionWhatsapp = document.getElementById("creditoAccionWhatsapp");
 if (accionWhatsapp) {
 const planPermitido = ["pro", "demo"].includes(estadoLicenciaNexoPOS?.plan);
 accionWhatsapp.innerHTML = (planPermitido && aging && aging.vencido)
 ? `<button class="btn-whatsapp-recordatorio" type="button" onclick="enviarRecordatorioCreditoWhatsApp()">Recordar por WhatsApp</button>`
 : "";
 }

 const accionPortal = document.getElementById("creditoAccionPortal");
 if (accionPortal) {
 accionPortal.innerHTML = creditoActual.codigoAccesoActivo
 ? `<button class="btn-portal-cliente" type="button" onclick="activarPortalCliente()">Regenerar codigo de acceso</button>
 <button class="btn-portal-cliente-desactivar" type="button" onclick="desactivarPortalCliente()">Desactivar portal</button>`
 : `<button class="btn-portal-cliente" type="button" onclick="activarPortalCliente()">Activar portal del cliente</button>`;
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

 const fechaClienteDesde =
 document.getElementById("creditoDetalleFecha");

 if (fechaClienteDesde) {
 fechaClienteDesde.textContent =
 new Date(datos.cliente.created_at)
 .toLocaleDateString("es-MX");
 }

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

 window.creditoAgingActual =
 datos.aging || null;

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
 ${
 movimiento.tipo === "venta" && movimiento.historial_id && productosMovimiento.length > 0
 ? `<button class="btn-ver-detalle-venta btn-editar-compra-credito" onclick="editarCompraCreditoPOS(${indice})">Editar compra</button>`
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

 document.getElementById("listaCreditos").style.display = "none";
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
 document.getElementById("listaCreditos").style.display = "block";
 document.getElementById("detalleCliente").style.display = "none";
}

function normalizarTelefonoWhatsApp(telefono) {
 const digitos = String(telefono || "").replace(/\D/g, "");
 if (!digitos) return null;
 if (digitos.length === 10) return `52${digitos}`;
 return digitos.length >= 10 ? digitos : null;
}

function enviarRecordatorioCreditoWhatsApp() {
 if (!creditoActual) return;

 const aging = window.creditoAgingActual;
 if (!aging || !aging.vencido) {
 alertaPOS("Este cliente no tiene compras vencidas.", "Recordatorio por WhatsApp", "info");
 return;
 }

 const telefono = normalizarTelefonoWhatsApp(creditoActual.telefono);
 if (!telefono) {
 alertaPOS("Este cliente no tiene un telefono registrado. Agregalo desde 'Editar cliente'.", "Recordatorio por WhatsApp", "alerta");
 return;
 }

 const negocio = configuracionNegocio() || {};
 const masAntigua = aging.ventaVencidaMasAntigua;
 const fechaTexto = masAntigua ? new Date(masAntigua.fechaVencimiento).toLocaleDateString("es-MX") : "";
 const dias = masAntigua ? masAntigua.diasVencido : 0;

 const mensaje =
 `Hola ${creditoActual.nombre || ""}, te saluda ${negocio.nombre || "Nexo"}. ` +
 `Tienes un saldo vencido de ${dinero(aging.totalVencido)}` +
 (fechaTexto ? ` de una compra con vencimiento el ${fechaTexto} (${dias} dia${dias === 1 ? "" : "s"} de atraso)` : "") +
 `. Te agradecemos tu pago a la brevedad. Cualquier duda, contactanos.`;

 window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`, "_blank", "noopener");
}

// Portal de cliente final (Fase 6 del sitio web por negocio) -- el
// codigo se genera en el servidor y se regresa en texto plano UNA
// sola vez en esta respuesta; nunca se puede volver a consultar
// despues. El dueno lo comparte el mismo con el cliente (de palabra,
// WhatsApp, impreso), mismo criterio que el recordatorio de arriba.
async function activarPortalCliente() {
 if (!creditoActual) return;

 try {
 const respuesta = await fetch(`/creditos/clientes/${creditoActual.id}/codigo-acceso`, { method: "POST" });
 const datos = await respuesta.json();

 if (!datos.ok) {
 await alertaPOS(datos.error || "No se pudo generar el codigo de acceso.", "Portal del cliente", "alerta");
 return;
 }

 navigator.clipboard?.writeText(datos.codigo).catch(() => {});

 await dialogoPOS({
 tipo: "exito",
 titulo: "Portal activado",
 mensaje: `Codigo para ${creditoActual.nombre}: ${datos.codigo}. Compartelo tu mismo (de palabra, WhatsApp, impreso) para que pueda entrar a su area en tu sitio web -- este codigo solo se muestra una vez. Ya se copio a tu portapapeles.`,
 textoAceptar: "Entendido"
 });

 creditoActual.codigoAccesoActivo = true;
 renderCreditoDetalleExtra();
 } catch (error) {
 await alertaPOS("No se pudo generar el codigo de acceso. Intenta de nuevo.", "Portal del cliente", "alerta");
 }
}

async function desactivarPortalCliente() {
 if (!creditoActual) return;

 const confirmar = await confirmarPOS(
 `Desactivar el portal de ${creditoActual.nombre}? Ya no podra iniciar sesion con su codigo actual.`,
 "Desactivar portal",
 "alerta"
 );
 if (!confirmar) return;

 try {
 const respuesta = await fetch(`/creditos/clientes/${creditoActual.id}/codigo-acceso/revocar`, { method: "POST" });
 const datos = await respuesta.json();

 if (!datos.ok) {
 await alertaPOS(datos.error || "No se pudo desactivar el portal.", "Portal del cliente", "alerta");
 return;
 }

 creditoActual.codigoAccesoActivo = false;
 renderCreditoDetalleExtra();
 alertaPOS("Portal desactivado.", "Portal del cliente", "exito");
 } catch (error) {
 await alertaPOS("No se pudo desactivar el portal. Intenta de nuevo.", "Portal del cliente", "alerta");
 }
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
 <h2>${escaparPOS(negocio.nombre || "Nexo")}</h2>
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

// Deja editar una compra a credito (cambiar un producto por otro) --
// solo disponible para compras nuevas que ya tienen folio real
// (movimiento.historial_id). Pide PIN de administrador primero, y
// reusa el modal de 2 pasos "Cambiar producto" que ya existe en
// Buscar ticket (ticket-lookup-view.js) en vez de duplicar esa logica.
async function editarCompraCreditoPOS(indice) {
 const movimiento =
 (window.movimientosCreditoActuales || [])[indice];

 if (!movimiento || !movimiento.historial_id) return;

 const pin =
 await pedirPasswordPOS(
 "Ingresa el PIN de un administrador para editar esta compra.",
 "Editar compra"
 );

 if (pin === null || pin === undefined) return;

 if (pinOfflineBloqueado(LIMITADOR_PIN_OFFLINE_LLAVE_ADMIN)) {
 await alertaPOS("Demasiados intentos. Espera unos minutos e intenta de nuevo.", "Editar compra", "peligro");
 return;
 }

 const admin =
 await buscarAdminPorPinLocal(pin);

 if (!admin) {
 await alertaPOS("PIN de administrador incorrecto.", "Editar compra", "peligro");
 return;
 }

 let datos;

 try {
 const respuesta =
 await fetch(`/ventas/${movimiento.historial_id}`);

 datos =
 await respuesta.json();

 if (!respuesta.ok || !datos.ok || !datos.venta) {
 throw new Error("respuesta invalida");
 }
 } catch (error) {
 await alertaPOS("No se pudo cargar la compra.", "Editar compra", "peligro");
 return;
 }

 const productos =
 Array.isArray(datos.venta.productos) ? datos.venta.productos : [];

 const productosConCambio =
 productos.filter(producto => producto.admiteCambios !== false && producto.id);

 if (!productosConCambio.length) {
 await alertaPOS("Esta compra no tiene productos que se puedan cambiar.", "Editar compra", "info");
 return;
 }

 // El modal de "Cambiar producto" (ticket-lookup-view.js) depende de
 // esta variable de modulo -- se puede asignar directo (sin "window.")
 // porque ambos archivos son scripts clasicos que comparten el mismo
 // scope global lexico.
 ventaActualBuscarTicket = datos.venta;

 let productoElegidoId =
 productosConCambio.length === 1 ? Number(productosConCambio[0].id) : null;

 if (!productoElegidoId) {
  const eleccion =
  await abrirFormularioCredito({
  titulo: "Elige el producto a cambiar",
  subtitulo: datos.venta.folio || "",
  campos: [
  {
  nombre: "productoId",
  etiqueta: "Producto",
  tipo: "select",
  opciones: productosConCambio.map(producto => ({
  valor: producto.id,
  etiqueta: `${producto.nombre} x ${producto.cantidad}`
  }))
  }
  ]
  });

  if (!eleccion) return;

  productoElegidoId = Number(eleccion.productoId);
 }

 if (typeof abrirCambioProductoPOS !== "function") return;

 const resultado =
 await abrirCambioProductoPOS(productoElegidoId, pin);

 if (resultado && creditoActual?.id) {
  await abrirCuentaCliente(creditoActual.id);
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
 <option value="${opcion.valor}" ${String(opcion.valor) === String(campo.valor ?? "") ? "selected" : ""}>
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
 nombre: "nivelPrecioPreferido",
 etiqueta: "Precio con el que siempre compra",
 tipo: "select",
 valor: "",
 opciones: [
 { valor: "", etiqueta: "Sin preferencia -- usar el precio activo en el POS" },
 { valor: "publico", etiqueta: "Publico" },
 { valor: "mayoreo", etiqueta: "Medio mayoreo" },
 { valor: "distribuidor", etiqueta: "Mayoreo / distribuidor" }
 ]
 }
 ]
 });

 if (!datos) return;

 const payloadCliente = {
 nombre: datos.nombre,
 telefono: datos.telefono,
 limiteCredito: datos.limiteCredito,
 nivelPrecioPreferido: datos.nivelPrecioPreferido || null
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

 async function enviarCargoManual(adminPin) {
 const cuerpo = {
 monto,
 concepto,
 productos: [],
 idempotencyKey: crearEventIdPOS("cargo-manual")
 };

 if (adminPin) cuerpo.adminPin = adminPin;

 return fetch(
 `/creditos/clientes/${creditoActual.id}/cargos`,
 {
 method: "POST",
 headers: {
 "Content-Type":
 "application/json"
 },
 body: JSON.stringify(cuerpo)
 }
 );
 }

 let respuesta =
 await enviarCargoManual();

 if (!respuesta.ok) {
 const cuerpoError =
 await respuesta.clone().json().catch(() => null);

 if (cuerpoError?.excedeLimiteCredito) {
 const pinDatos =
 await abrirFormularioCredito({
 titulo: "Autorizacion requerida",
 subtitulo: cuerpoError.error,
 campos: [{
 nombre: "adminPin",
 etiqueta: "PIN de administrador",
 tipo: "password",
 requerido: true
 }]
 });

 if (!pinDatos) return;

 respuesta = await enviarCargoManual(pinDatos.adminPin);
 }
 }

 if (!respuesta.ok) {
 const cuerpoError =
 await respuesta.json().catch(() => null);

 alert(cuerpoError?.error || "No se pudo registrar el cargo");
 return;
 }

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
 nombre: "nivelPrecioPreferido",
 etiqueta: "Precio con el que siempre compra",
 tipo: "select",
 valor: cliente.nivel_precio_preferido || "",
 opciones: [
 { valor: "", etiqueta: "Sin preferencia -- usar el precio activo en el POS" },
 { valor: "publico", etiqueta: "Publico" },
 { valor: "mayoreo", etiqueta: "Medio mayoreo" },
 { valor: "distribuidor", etiqueta: "Mayoreo / distribuidor" }
 ]
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

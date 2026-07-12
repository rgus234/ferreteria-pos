/* Modal de confirmacion de metodo de pago (Efectivo/Tarjeta/Transferencia/Credito/Mixto),
   navegable con las flechas del teclado. Reemplaza al viejo fase7-pagos.js (que
   interceptaba window.fetch/window.cobrar desde afuera y causaba el bug del doble
   Enter) -- esta version es una funcion nativa que cobrarInternoPOS() llama y espera,
   sin monkeypatching. Reusa las clases CSS de pos-payment-modal.css (ya existian,
   dejadas del sistema viejo). */

function renderNotaTransferencia(total) {
 const config = (typeof configuracionNegocio === "function" ? configuracionNegocio() : null) || {};
 const titular = (config.transferTitular || "").trim();
 const banco = (config.transferBanco || "").trim();
 const cuenta = (config.transferCuenta || "").trim();

 if (!titular && !banco && !cuenta) {
  return `<div class="metodo-pago-nota">Se registra el total (${dinero(total)}) como pagado por transferencia. Configura los datos de tu cuenta en Configuracion &gt; Empresa para que aparezcan aqui.</div>`;
 }

 return `
 <div class="metodo-pago-transferencia">
  <span class="metodo-pago-transferencia-titulo">Datos para la transferencia (${dinero(total)})</span>
  ${titular ? `<div><span>Titular</span><strong>${titular}</strong></div>` : ""}
  ${banco ? `<div><span>Banco</span><strong>${banco}</strong></div>` : ""}
  ${cuenta ? `<div><span>CLABE / cuenta</span><strong>${cuenta}</strong></div>` : ""}
 </div>
 `;
}

async function pedirMetodoPagoPOS(total, opciones = {}) {
 const metodos = ["efectivo", "tarjeta", "transferencia", "credito", "mixto"];

 const etiquetas = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Credito",
  mixto: "Mixto"
 };

 const num = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;

 let indice =
 metodos.indexOf(opciones.metodoInicial) >= 0
 ? metodos.indexOf(opciones.metodoInicial)
 : 0;

 let recibidoEfectivo =
 opciones.recibidoInicial != null && Number(opciones.recibidoInicial) > 0
 ? String(opciones.recibidoInicial)
 : "";

 let pagosMixtos = {
 efectivo: "",
 tarjeta: "",
 transferencia: "",
 credito: ""
 };

 return new Promise(resolve => {
 let modal =
 document.getElementById("modalMetodoPagoPOS");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalMetodoPagoPOS";
 modal.className = "modal-personalizado modal-metodo-pago";
 document.body.appendChild(modal);
 }

 let cerrado = false;

 const cerrar = valor => {
 if (cerrado) return;
 cerrado = true;
 modal.style.display = "none";
 modal.innerHTML = "";
 document.removeEventListener("keydown", manejarTeclado, true);
 resolve(valor);
 };

 const aceptar = async () => {
 const metodo = metodos[indice];

 if (metodo === "credito") {
 cerrar({ accion: "credito" });
 return;
 }

 if (metodo === "mixto") {
 const pagos = {
 efectivo: num(pagosMixtos.efectivo),
 tarjeta: num(pagosMixtos.tarjeta),
 transferencia: num(pagosMixtos.transferencia),
 credito: num(pagosMixtos.credito)
 };

 const recibido =
 pagos.efectivo + pagos.tarjeta + pagos.transferencia + pagos.credito;

 if (recibido < total) {
 await alertaPOS(
 `Faltan ${(total - recibido).toFixed(2)} para completar el pago mixto.`,
 "Pago incompleto",
 "alerta"
 );
 return;
 }

 cerrar({
 metodoPago: "mixto",
 pagos,
 recibido,
 cambio: Math.max(0, recibido - total)
 });
 return;
 }

 if (metodo === "efectivo") {
 const recibido = num(recibidoEfectivo);

 if (recibido < total) {
 await alertaPOS(
 `Faltan ${(total - recibido).toFixed(2)} para completar la venta.`,
 "Dinero insuficiente",
 "alerta"
 );
 return;
 }

 cerrar({
 metodoPago: "efectivo",
 pagos: { efectivo: total, tarjeta: 0, transferencia: 0, credito: 0 },
 recibido,
 cambio: recibido - total
 });
 return;
 }

 cerrar({
 metodoPago: metodo,
 pagos: {
 efectivo: 0,
 tarjeta: metodo === "tarjeta" ? total : 0,
 transferencia: metodo === "transferencia" ? total : 0,
 credito: 0
 },
 recibido: total,
 cambio: 0
 });
 };

 const mover = paso => {
 indice = (indice + paso + metodos.length) % metodos.length;
 render();
 };

 const actualizarVistaEnVivo = () => {
 if (metodos[indice] === "efectivo") {
 const cambioEl = modal.querySelector("#modalPagoCambioEfectivo");
 if (cambioEl) cambioEl.textContent = dinero(Math.max(0, num(recibidoEfectivo) - total));
 }

 if (metodos[indice] === "mixto") {
 const suma =
 num(pagosMixtos.efectivo) + num(pagosMixtos.tarjeta) +
 num(pagosMixtos.transferencia) + num(pagosMixtos.credito);

 const falta = Math.max(0, total - suma);
 const cambio = Math.max(0, suma - total);

 const etiquetaEl = modal.querySelector("#modalPagoMixtoEtiqueta");
 const valorEl = modal.querySelector("#modalPagoMixtoValor");

 if (etiquetaEl) etiquetaEl.textContent = falta > 0 ? "Falta" : "Cambio";
 if (valorEl) valorEl.textContent = dinero(falta > 0 ? falta : cambio);
 }
 };

 const render = () => {
 const metodo = metodos[indice];
 const esEfectivo = metodo === "efectivo";
 const esMixto = metodo === "mixto";
 const esCredito = metodo === "credito";
 const esTransferencia = metodo === "transferencia";

 const cambioEfectivo =
 Math.max(0, num(recibidoEfectivo) - total);

 const sumaMixta =
 num(pagosMixtos.efectivo) + num(pagosMixtos.tarjeta) +
 num(pagosMixtos.transferencia) + num(pagosMixtos.credito);

 const faltanteMixto = Math.max(0, total - sumaMixta);
 const cambioMixto = Math.max(0, sumaMixta - total);

 modal.innerHTML = `
 <div class="modal-card metodo-pago-card">
 <div class="modal-card-header">
 <div>
 <span>Confirmar cobro</span>
 <h3>${dinero(total)}</h3>
 </div>
 <button type="button" class="metodo-pago-cerrar" data-accion="cancelar">Cerrar</button>
 </div>

 <div class="metodo-pago-label">Metodo de pago (flechas del teclado para cambiar)</div>

 <div class="metodo-pago-selector">
 <button type="button" class="metodo-flecha" data-accion="anterior" title="Anterior">&#8592;</button>
 <div class="metodo-pago-opciones">
 ${metodos.map((m, i) => `
 <button type="button" class="${i === indice ? "activo" : ""}" data-metodo="${m}">
 <strong>${etiquetas[m]}</strong>
 <span>${m === "mixto" ? "Divide el pago" : m === "credito" ? "A cuenta del cliente" : "Pago completo"}</span>
 </button>
 `).join("")}
 </div>
 <button type="button" class="metodo-flecha" data-accion="siguiente" title="Siguiente">&#8594;</button>
 </div>

 ${esEfectivo ? `
 <div class="metodo-pago-efectivo-campos">
 <label>Recibido
 <input type="number" step="0.01" min="0" id="modalPagoRecibido" value="${recibidoEfectivo}" placeholder="0.00">
 </label>
 <div class="metodo-pago-resumen-linea">
 <span>Cambio</span>
 <strong id="modalPagoCambioEfectivo">${dinero(cambioEfectivo)}</strong>
 </div>
 </div>
 ` : ""}

 ${esMixto ? `
 <div class="metodo-pago-mixto">
 <label>Efectivo<input type="number" step="0.01" min="0" id="pagoMixtoEfectivo" value="${pagosMixtos.efectivo}"></label>
 <label>Tarjeta<input type="number" step="0.01" min="0" id="pagoMixtoTarjeta" value="${pagosMixtos.tarjeta}"></label>
 <label>Transferencia<input type="number" step="0.01" min="0" id="pagoMixtoTransferencia" value="${pagosMixtos.transferencia}"></label>
 <label>Credito<input type="number" step="0.01" min="0" id="pagoMixtoCredito" value="${pagosMixtos.credito}"></label>
 </div>
 <div class="metodo-pago-resumen-linea">
 <span id="modalPagoMixtoEtiqueta">${faltanteMixto > 0 ? "Falta" : "Cambio"}</span>
 <strong id="modalPagoMixtoValor">${dinero(faltanteMixto > 0 ? faltanteMixto : cambioMixto)}</strong>
 </div>
 ` : ""}

 ${esCredito ? `<div class="metodo-pago-nota">Se abrira el flujo de credito al confirmar.</div>` : ""}
 ${esTransferencia ? renderNotaTransferencia(total) : ""}
 ${!esEfectivo && !esMixto && !esCredito && !esTransferencia ? `<div class="metodo-pago-nota">Se registra el total (${dinero(total)}) como pagado por ${etiquetas[metodo].toLowerCase()}.</div>` : ""}

 <div class="modal-actions-row">
 <button type="button" data-accion="cancelar">Cancelar</button>
 <button type="button" class="btn-principal" data-accion="aceptar">${esCredito ? "Continuar a credito" : "Confirmar cobro"}</button>
 </div>
 </div>
 `;

 modal.style.display = "flex";

 const inputRecibido = document.getElementById("modalPagoRecibido");

 if (inputRecibido) {
 inputRecibido.focus();
 inputRecibido.select();

 inputRecibido.oninput = () => {
 recibidoEfectivo = inputRecibido.value;
 actualizarVistaEnVivo();
 };
 }

 ["pagoMixtoEfectivo", "pagoMixtoTarjeta", "pagoMixtoTransferencia", "pagoMixtoCredito"].forEach(id => {
 const campo = document.getElementById(id);
 if (!campo) return;

 campo.oninput = () => {
 const clave = id.replace("pagoMixto", "").toLowerCase();
 pagosMixtos[clave] = campo.value;
 actualizarVistaEnVivo();
 };
 });

 modal.querySelectorAll("[data-metodo]").forEach(boton => {
 boton.onclick = () => {
 indice = metodos.indexOf(boton.dataset.metodo);
 render();
 };
 });

 modal.querySelectorAll("[data-accion]").forEach(boton => {
 boton.onclick = () => {
 const accion = boton.dataset.accion;
 if (accion === "cancelar") cerrar(null);
 if (accion === "anterior") mover(-1);
 if (accion === "siguiente") mover(1);
 if (accion === "aceptar") aceptar();
 };
 });
 };

 const manejarTeclado = event => {
 if (modal.style.display === "none") return;

 if (event.key === "ArrowLeft" && !event.target.matches("input")) {
 event.preventDefault();
 mover(-1);
 }

 if (event.key === "ArrowRight" && !event.target.matches("input")) {
 event.preventDefault();
 mover(1);
 }

 if (event.key === "Escape") {
 event.preventDefault();
 cerrar(null);
 }

 if (event.key === "Enter") {
 event.preventDefault();
 aceptar();
 }
 };

 document.addEventListener("keydown", manejarTeclado, true);
 render();
 });
}

(() => {
 if (window.__fase7PagosPOS) return;
 window.__fase7PagosPOS = true;

 const metodos = ["efectivo", "tarjeta", "transferencia", "credito", "mixto"];
 const etiquetas = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Credito",
  mixto: "Mixto"
 };

 const num = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;

 function asegurarModalPago() {
  let modal = document.getElementById("modalMetodoPagoPOS");

  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "modalMetodoPagoPOS";
  modal.className = "modal-personalizado modal-metodo-pago";
  modal.style.display = "none";
  document.body.appendChild(modal);
  return modal;
 }

 function renderModalPago(total, metodoActivo, pagos = {}) {
  const modal = asegurarModalPago();
  const esMixto = metodoActivo === "mixto";

  modal.innerHTML = `
  <div class="modal-card metodo-pago-card">
  <div class="modal-card-header">
  <div>
  <span>Cobro</span>
  <h3>${typeof dinero === "function" ? dinero(total) : "$" + total.toFixed(2)}</h3>
  </div>
  <button type="button" class="metodo-pago-cerrar" data-pago-accion="cancelar">Cerrar</button>
  </div>
  <div class="metodo-pago-label">Metodo de pago</div>
  <div class="metodo-pago-selector" tabindex="0">
  <button type="button" class="metodo-flecha" data-pago-accion="anterior" title="Anterior">&#8592;</button>
  <div class="metodo-pago-opciones">
  ${metodos.map(metodo => `
  <button type="button" class="${metodo === metodoActivo ? "activo" : ""}" data-pago-metodo="${metodo}">
  <strong>${etiquetas[metodo]}</strong>
  <span>${metodo === "mixto" ? "Divide el pago" : "Pago completo"}</span>
  </button>
  `).join("")}
  </div>
  <button type="button" class="metodo-flecha" data-pago-accion="siguiente" title="Siguiente">&#8594;</button>
  </div>
  <div class="metodo-pago-mixto" style="display:${esMixto ? "grid" : "none"}">
  <label>Efectivo<input id="pagoMixtoEfectivo" type="number" step="0.01" value="${pagos.efectivo || 0}"></label>
  <label>Tarjeta<input id="pagoMixtoTarjeta" type="number" step="0.01" value="${pagos.tarjeta || 0}"></label>
  <label>Transferencia<input id="pagoMixtoTransferencia" type="number" step="0.01" value="${pagos.transferencia || 0}"></label>
  <label>Credito<input id="pagoMixtoCredito" type="number" step="0.01" value="${pagos.credito || 0}"></label>
  </div>
  <div class="modal-actions-row">
  <button type="button" data-pago-accion="cancelar">Cancelar</button>
  <button type="button" class="btn-principal" data-pago-accion="aceptar">Cobrar</button>
  </div>
  </div>
  `;

  modal.style.display = "flex";
  modal.tabIndex = -1;
  setTimeout(() => {
   modal.focus();
   modal.querySelector(".metodo-pago-selector")?.focus();
  }, 50);
  return modal;
 }

 function pagoDesdeModal(total, metodo) {
  const pagos = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 };

  if (metodo === "mixto") {
   pagos.efectivo = num(document.getElementById("pagoMixtoEfectivo")?.value);
   pagos.tarjeta = num(document.getElementById("pagoMixtoTarjeta")?.value);
   pagos.transferencia = num(document.getElementById("pagoMixtoTransferencia")?.value);
   pagos.credito = num(document.getElementById("pagoMixtoCredito")?.value);

   const recibido = pagos.efectivo + pagos.tarjeta + pagos.transferencia + pagos.credito;
   return { metodoPago: "mixto", pagos, recibido, cambio: Math.max(0, recibido - total) };
  }

  if (metodo === "efectivo") {
   const recibido = num(document.getElementById("dinero")?.value);
   pagos.efectivo = total;
   return { metodoPago: "efectivo", pagos, recibido, cambio: Math.max(0, recibido - total) };
  }

  pagos[metodo] = total;

  const dineroInput = document.getElementById("dinero");
  if (dineroInput) dineroInput.value = String(total);

  return { metodoPago: metodo, pagos, recibido: total, cambio: 0 };
 }

 async function pedirPago(total) {
  let indice = 0;
  let pagosMixtos = {};

  return new Promise(resolve => {
   let modal = renderModalPago(total, metodos[indice], pagosMixtos);
   let cerrado = false;

   const cerrar = valor => {
    if (cerrado) return;
    cerrado = true;
    modal.style.display = "none";
    modal.onkeydown = null;
    modal.onclick = null;
    document.removeEventListener("keydown", manejarTeclado);
    resolve(valor);
   };

   const seleccionar = metodo => {
    if (metodos[indice] === "mixto") {
     pagosMixtos = {
      efectivo: document.getElementById("pagoMixtoEfectivo")?.value || 0,
      tarjeta: document.getElementById("pagoMixtoTarjeta")?.value || 0,
      transferencia: document.getElementById("pagoMixtoTransferencia")?.value || 0,
      credito: document.getElementById("pagoMixtoCredito")?.value || 0
     };
    }

    indice = metodos.indexOf(metodo);
    modal = renderModalPago(total, metodos[indice], pagosMixtos);
    conectar();
   };

   const mover = paso => {
    seleccionar(metodos[(indice + paso + metodos.length) % metodos.length]);
   };

   const aceptar = async () => {
    if (metodos[indice] === "credito") {
     cerrar({ accion: "credito" });
     return;
    }

    const pago = pagoDesdeModal(total, metodos[indice]);

    if (pago.recibido < total) {
     await alertaPOS("Faltan " + (total - pago.recibido).toFixed(2) + " para completar la venta.", "Pago incompleto", "alerta");
     return;
    }

    cerrar(pago);
   };

   const manejarTeclado = event => {
    if (event.defaultPrevented) return;
    if (modal.style.display === "none") return;
    if (event.key === "ArrowLeft") {
     event.preventDefault();
     mover(-1);
    }
    if (event.key === "ArrowRight") {
     event.preventDefault();
     mover(1);
    }
    if (event.key === "Escape") {
     event.preventDefault();
     cerrar(null);
    }
    if (event.key === "Enter" && !event.target.matches("input")) {
     event.preventDefault();
     aceptar();
    }
   };

   function conectar() {
    modal.onclick = event => {
     const metodo = event.target.closest("[data-pago-metodo]")?.dataset.pagoMetodo;
     const accion = event.target.closest("[data-pago-accion]")?.dataset.pagoAccion;

     if (metodo) seleccionar(metodo);
     if (accion === "anterior") mover(-1);
     if (accion === "siguiente") mover(1);
     if (accion === "cancelar") cerrar(null);
     if (accion === "aceptar") aceptar();
    };

    modal.onkeydown = manejarTeclado;
   }

   conectar();
   document.addEventListener("keydown", manejarTeclado);
  });
 }

 const fetchOriginal = window.fetch.bind(window);
 window.fetch = async function(input, init) {
  const url = typeof input === "string" ? input : input?.url;

  if (url === "/ventas" && init?.body && window.__pagoVentaActual) {
   try {
    const body = JSON.parse(init.body);
    Object.assign(body, window.__pagoVentaActual);
    init = { ...init, body: JSON.stringify(body) };
   } catch (error) {
    console.warn(error);
   }
  }

  return fetchOriginal(input, init);
 };

 function wrap() {
  const cobrarOriginal = window.cobrar;

  if (typeof cobrarOriginal !== "function" || cobrarOriginal.__fase7Pagos) return;

  const cobrarConPago = async function(total) {
   if ((typeof carrito !== "undefined" && carrito.length === 0) || num(total) <= 0) {
    return cobrarOriginal.apply(this, arguments);
   }

   const pago = await pedirPago(num(total));
   if (!pago) return;

   if (pago.accion === "credito") {
    if (typeof window.cobrarCredito === "function") {
     return window.cobrarCredito(num(total));
    }

    if (typeof cobrarCredito === "function") {
     return cobrarCredito(num(total));
    }

    await alertaPOS("No se encontro el flujo de clientes a credito.", "Credito", "peligro");
    return;
   }

   window.__pagoVentaActual = pago;

   try {
    return await cobrarOriginal.apply(this, arguments);
   } finally {
    setTimeout(() => {
     window.__pagoVentaActual = null;
    }, 500);
   }
  };

  cobrarConPago.__fase7Pagos = true;
  window.cobrar = cobrarConPago;
 }

 setTimeout(wrap, 300);
 setTimeout(wrap, 1200);
 document.addEventListener("click", () => setTimeout(wrap, 80));
})();

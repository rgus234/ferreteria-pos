/* Modal que pregunta si un producto que se vende por bolsa/caja completa o por
   pieza suelta se va a vender de una forma u otra, y si es pieza cuantas.
   Sigue el mismo patron de pedirMetodoPagoPOS (pos-payment-modal.js): funcion
   async que crea/reusa un modal, espera una Promise y la resuelve al cerrar. */

async function pedirModoVentaPOS(producto) {
 let paso = "modo";
 let cantidadTexto = "1";

 return new Promise(resolve => {
  let modal =
  document.getElementById("modalVentaPiezaPOS");

  if (!modal) {
   modal = document.createElement("div");
   modal.id = "modalVentaPiezaPOS";
   modal.className = "modal-personalizado modal-venta-pieza";
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

  const elegirBolsa = () => {
   cerrar({ modo: "bolsa", cantidad: 1 });
  };

  const irAPasoCantidad = () => {
   paso = "cantidad";
   render();
  };

  const confirmarCantidad = () => {
   const cantidad =
   Number(cantidadTexto);

   if (!Number.isFinite(cantidad) || cantidad <= 0) {
    const input = document.getElementById("modalVentaPiezaCantidad");
    input?.focus();
    input?.select();
    return;
   }

   cerrar({ modo: "pieza", cantidad });
  };

  const render = () => {
   const nombre =
   escaparPOS(producto?.nombre || "Producto");

   modal.innerHTML =
   paso === "modo"
   ? `
   <div class="modal-card venta-pieza-card">
    <div class="modal-card-header">
     <div>
      <span>Como lo quiere vender?</span>
      <h3>${nombre}</h3>
     </div>
     <button type="button" class="venta-pieza-cerrar" data-accion="cancelar">Cerrar</button>
    </div>

    <div class="venta-pieza-opciones">
     <button type="button" data-accion="bolsa">
      <strong>Bolsa completa</strong>
      <span>Vende la presentacion cerrada tal como esta</span>
     </button>
     <button type="button" data-accion="pieza">
      <strong>Piezas sueltas</strong>
      <span>Abre o descuenta piezas individuales</span>
     </button>
    </div>
   </div>
   `
   : `
   <div class="modal-card venta-pieza-card">
    <div class="modal-card-header">
     <div>
      <span>Piezas sueltas</span>
      <h3>${nombre}</h3>
     </div>
     <button type="button" class="venta-pieza-cerrar" data-accion="cancelar">Cerrar</button>
    </div>

    <label class="venta-pieza-cantidad-label">Cuantas piezas?
     <input type="number" step="1" min="1" id="modalVentaPiezaCantidad" value="${cantidadTexto}">
    </label>

    <div class="modal-actions-row">
     <button type="button" data-accion="volver">Volver</button>
     <button type="button" class="btn-principal" data-accion="confirmar">Agregar al carrito</button>
    </div>
   </div>
   `;

   modal.style.display = "flex";

   modal.querySelectorAll("[data-accion]").forEach(boton => {
    boton.onclick = () => {
     const accion = boton.dataset.accion;
     if (accion === "cancelar") cerrar(null);
     if (accion === "bolsa") elegirBolsa();
     if (accion === "pieza") irAPasoCantidad();
     if (accion === "volver") { paso = "modo"; render(); }
     if (accion === "confirmar") confirmarCantidad();
    };
   });

   const inputCantidad = document.getElementById("modalVentaPiezaCantidad");

   if (inputCantidad) {
    inputCantidad.focus();
    inputCantidad.select();

    inputCantidad.oninput = () => {
     cantidadTexto = inputCantidad.value;
    };
   }
  };

  const manejarTeclado = event => {
   if (modal.style.display === "none") return;

   if (event.key === "Escape") {
    event.preventDefault();
    cerrar(null);
   }

   if (event.key === "Enter" && paso === "cantidad") {
    event.preventDefault();
    confirmarCantidad();
   }
  };

  document.addEventListener("keydown", manejarTeclado, true);
  render();
 });
}

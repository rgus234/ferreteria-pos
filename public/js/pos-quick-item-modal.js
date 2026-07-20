/* Modal para agregar un "articulo rapido" a la venta: algo que no existe
   como producto en el inventario (sin codigo de barras, sin registro
   formal) y no vale la pena crear como producto solo para venderlo una
   vez. Se suma al ticket y al total de la venta pero no descuenta
   inventario -- ver agregarArticuloRapido (pos-sales.js) y
   descontarStockVentaProducto (server.js), que ignora cualquier id que no
   coincida con un producto real. Sigue el mismo patron de pedirModoVentaPOS
   (pos-piece-sale-modal.js): funcion async que crea/reusa un modal, espera
   una Promise y la resuelve al cerrar. */

async function pedirArticuloRapidoPOS(nombrePrellenado = "") {
 let nombreTexto = nombrePrellenado || "";
 let precioTexto = "";
 let cantidadTexto = "1";

 return new Promise(resolve => {
  let modal =
  document.getElementById("modalArticuloRapidoPOS");

  if (!modal) {
   modal = document.createElement("div");
   modal.id = "modalArticuloRapidoPOS";
   modal.className = "modal-personalizado modal-articulo-rapido";
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

  const confirmar = () => {
   const nombre = nombreTexto.trim();
   const precio = Number(precioTexto);
   const cantidad = Number(cantidadTexto);

   if (!nombre) {
    document.getElementById("modalArticuloRapidoNombre")?.focus();
    return;
   }

   if (!Number.isFinite(precio) || precio <= 0) {
    const input = document.getElementById("modalArticuloRapidoPrecio");
    input?.focus();
    input?.select();
    return;
   }

   if (!Number.isFinite(cantidad) || cantidad <= 0) {
    const input = document.getElementById("modalArticuloRapidoCantidad");
    input?.focus();
    input?.select();
    return;
   }

   cerrar({ nombre, precio, cantidad });
  };

  const render = () => {
   modal.innerHTML = `
   <div class="modal-card articulo-rapido-card">
    <div class="modal-card-header">
     <div>
      <span>Sin codigo en el inventario</span>
      <h3>Articulo rapido</h3>
     </div>
     <button type="button" class="articulo-rapido-cerrar" data-accion="cancelar">Cerrar</button>
    </div>

    <p class="articulo-rapido-nota">Se agrega al ticket y al total de la venta, pero no descuenta inventario -- usalo para algo que no vas a registrar como producto.</p>

    <label class="articulo-rapido-campo">Que es?
     <input type="text" id="modalArticuloRapidoNombre" placeholder="Ej. Corte de tubo especial" value="${escaparPOS(nombreTexto)}">
    </label>

    <div class="articulo-rapido-fila">
     <label class="articulo-rapido-campo">Precio
      <input type="number" step="0.01" min="0.01" id="modalArticuloRapidoPrecio" placeholder="0.00" value="${escaparPOS(precioTexto)}">
     </label>
     <label class="articulo-rapido-campo">Cantidad
      <input type="number" step="1" min="1" id="modalArticuloRapidoCantidad" value="${escaparPOS(cantidadTexto)}">
     </label>
    </div>

    <div class="modal-actions-row">
     <button type="button" data-accion="cancelar">Cancelar</button>
     <button type="button" class="btn-principal" data-accion="confirmar">Agregar al carrito</button>
    </div>
   </div>
   `;

   modal.style.display = "flex";

   modal.querySelectorAll("[data-accion]").forEach(boton => {
    boton.onclick = () => {
     const accion = boton.dataset.accion;
     if (accion === "cancelar") cerrar(null);
     if (accion === "confirmar") confirmar();
    };
   });

   const inputNombre = document.getElementById("modalArticuloRapidoNombre");
   const inputPrecio = document.getElementById("modalArticuloRapidoPrecio");
   const inputCantidad = document.getElementById("modalArticuloRapidoCantidad");

   inputNombre.oninput = () => { nombreTexto = inputNombre.value; };
   inputPrecio.oninput = () => { precioTexto = inputPrecio.value; };
   inputCantidad.oninput = () => { cantidadTexto = inputCantidad.value; };

   if (nombreTexto) {
    inputPrecio.focus();
   } else {
    inputNombre.focus();
   }
  };

  const manejarTeclado = event => {
   if (modal.style.display === "none") return;

   if (event.key === "Escape") {
    event.preventDefault();
    cerrar(null);
   }

   if (event.key === "Enter") {
    event.preventDefault();
    confirmar();
   }
  };

  document.addEventListener("keydown", manejarTeclado, true);
  render();
 });
}

async function abrirModalArticuloRapidoPOS(nombrePrellenado = "") {
 const resultado =
 await pedirArticuloRapidoPOS((nombrePrellenado || "").trim());

 if (!resultado) return;

 agregarArticuloRapido(resultado.nombre, resultado.precio, resultado.cantidad);

 const campo =
 document.getElementById("busqueda");

 if (campo) campo.value = "";

 if (typeof ocultarFlyoutBusquedaPOS === "function") ocultarFlyoutBusquedaPOS();

 setTimeout(() => campo?.focus(), 50);
}

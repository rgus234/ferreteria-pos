/* Modal que pide la cantidad (peso/medida) de un producto por unidad
   decimal (kg, litro, metro, gramo) EN EL MOMENTO de agregarlo al
   carrito -- antes solo existia un boton para editarlo despues de que
   ya estaba en el carrito con cantidad 1, facil de olvidar. Nunca lee
   ningun aparato: el cajero teclea el numero a mano (con o sin
   bascula fisica conectada, el sistema funciona igual). Mismo patron
   de pedirModoVentaPOS (pos-piece-sale-modal.js): funcion async que
   crea/reusa un modal, espera una Promise y la resuelve al cerrar. */

const ETIQUETAS_UNIDAD_DECIMAL_PESO = {
 kg: { pregunta: "kilos", abrev: "kg" },
 kilo: { pregunta: "kilos", abrev: "kg" },
 gramo: { pregunta: "gramos", abrev: "g" },
 metro: { pregunta: "metros", abrev: "m" },
 litro: { pregunta: "litros", abrev: "L" }
};

async function pedirPesoPOS(producto) {
 const unidad =
 String(producto?.unidad_venta || producto?.unidadVenta || "kg").toLowerCase();

 const etiqueta =
 ETIQUETAS_UNIDAD_DECIMAL_PESO[unidad] || { pregunta: "cantidad", abrev: unidad };

 const precioUnidad =
 Number(precioVentaProducto(producto) || 0);

 let cantidadTexto = "";

 return new Promise(resolve => {
  let modal =
  document.getElementById("modalPesoPOS");

  if (!modal) {
   modal = document.createElement("div");
   modal.id = "modalPesoPOS";
   modal.className = "modal-personalizado modal-peso-pos";
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

  const actualizarTotal = () => {
   const total =
   document.getElementById("modalPesoTotal");

   if (!total) return;

   const cantidad =
   Number(cantidadTexto);

   if (Number.isFinite(cantidad) && cantidad > 0 && precioUnidad > 0) {
    total.textContent =
    `= $${(cantidad * precioUnidad).toFixed(2)}`;
    total.style.visibility = "visible";
   } else {
    total.style.visibility = "hidden";
   }
  };

  const confirmar = () => {
   const cantidad =
   Number(cantidadTexto);

   if (!Number.isFinite(cantidad) || cantidad <= 0) {
    const input = document.getElementById("modalPesoCantidad");
    input?.focus();
    input?.select();
    return;
   }

   cerrar(cantidad);
  };

  const render = () => {
   const nombre =
   escaparPOS(producto?.nombre || "Producto");

   const precioTexto =
   precioUnidad > 0
   ? `$${precioUnidad.toFixed(2)} por ${etiqueta.abrev}`
   : "";

   modal.innerHTML = `
   <div class="modal-card peso-pos-card">
    <div class="modal-card-header">
     <div>
      <span>Cuantos ${etiqueta.pregunta} lleva?</span>
      <h3>${nombre}</h3>
     </div>
     <button type="button" class="peso-pos-cerrar" data-accion="cancelar">Cerrar</button>
    </div>

    ${precioTexto ? `<p class="peso-pos-precio-unidad">${precioTexto}</p>` : ""}

    <label class="peso-pos-cantidad-label">Cantidad en ${etiqueta.abrev}
     <input type="number" step="0.001" min="0.001" id="modalPesoCantidad" placeholder="0.000" inputmode="decimal">
    </label>

    <p class="peso-pos-total" id="modalPesoTotal" style="visibility:hidden;"></p>

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

   const inputCantidad =
   document.getElementById("modalPesoCantidad");

   if (inputCantidad) {
    inputCantidad.focus();

    inputCantidad.oninput = () => {
     cantidadTexto = inputCantidad.value;
     actualizarTotal();
    };
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

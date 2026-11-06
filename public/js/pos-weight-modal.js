/* Modal que pide la cantidad (peso/medida) de un producto por unidad
   decimal (kg, litro, metro, gramo) EN EL MOMENTO de agregarlo al
   carrito -- antes solo existia un boton para editarlo despues de que
   ya estaba en el carrito con cantidad 1, facil de olvidar. Nunca lee
   ningun aparato: el cajero teclea el numero a mano (con o sin
   bascula fisica conectada, el sistema funciona igual). Mismo patron
   de pedirModoVentaPOS (pos-piece-sale-modal.js): funcion async que
   crea/reusa un modal, espera una Promise y la resuelve al cerrar.

   Con la funcion nueva "bascula" encendida (bascula-pos.js) se suma: vender por importe ("quiero $50") y, si hay una bascula
   conectada, el peso en vivo con una barra que va de rojo a verde. Apagada, nada de eso aparece. */

const ETIQUETAS_UNIDAD_DECIMAL_PESO = {
 kg: { pregunta: "kilos", abrev: "kg" },
 kilo: { pregunta: "kilos", abrev: "kg" },
 gramo: { pregunta: "gramos", abrev: "g" },
 metro: { pregunta: "metros", abrev: "m" },
 litro: { pregunta: "litros", abrev: "L" }
};

// Cantidades que mas se piden de cada unidad: un toque las suma (1/2 + 1/2 = 1 kg) y se corrigen en el campo.
const ATAJOS_PESO_POS = {
 kg: [[0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, "1"], [2, "2"]],
 gramo: [[100, "100"], [250, "250"], [500, "500"]],
 litro: [[0.5, "½"], [1, "1"], [2, "2"]],
 metro: [[1, "1"], [2, "2"], [5, "5"]]
};

// Importes que mas se piden ("dame $50 de jamon"): un toque los escribe.
const ATAJOS_IMPORTE_POS = [20, 50, 100];

// Cuantas unidades del producto hay en un kilo: solo las que una bascula puede pesar.
const UNIDADES_POR_KILO_POS = { kg: 1, kilo: 1, gramo: 1000 };

async function pedirPesoPOS(producto) {
 const unidad =
 String(producto?.unidad_venta || producto?.unidadVenta || "kg").toLowerCase();

 const atajosPeso = ATAJOS_PESO_POS[unidad === "kilo" ? "kg" : unidad] || [];

 const etiqueta =
 ETIQUETAS_UNIDAD_DECIMAL_PESO[unidad] || { pregunta: "cantidad", abrev: unidad };

 const precioUnidad =
 Number(precioVentaProducto(producto) || 0);

 const bascula = window.nexoBascula;
 const conBascula = Boolean(bascula && typeof window.funcionBeta === "function" && window.funcionBeta("bascula") && precioUnidad > 0);
 const unidadesPorKilo = UNIDADES_POR_KILO_POS[unidad] || null;

 let modoGuardado = "cantidad";
 try { modoGuardado = localStorage.getItem("nexo_peso_modo") === "importe" ? "importe" : "cantidad"; } catch (error) { /* sin almacenamiento */ }

 let modo = conBascula ? modoGuardado : "cantidad";
 let cantidadTexto = "";
 let importeTexto = "";
 let quitarEscucha = null;

 const dinero = valor => `$${Number(valor).toFixed(2)}`;
 const redondear3 = valor => Math.round((Number(valor) + Number.EPSILON) * 1000) / 1000;
 const metaImporte = () => (conBascula && modo === "importe" ? bascula.metaDesdeImporte(importeTexto, precioUnidad) : null);

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
   if (quitarEscucha) quitarEscucha();
   modal.style.display = "none";
   modal.innerHTML = "";
   document.removeEventListener("keydown", manejarTeclado, true);
   resolve(valor);
  };

  const actualizarTotal = () => {
   const total =
   document.getElementById("modalPesoTotal");

   if (!total) return;

   if (modo === "importe") {
    const meta = metaImporte();

    if (meta) {
     total.textContent = `= ${meta} ${etiqueta.abrev} · ${dinero(meta * precioUnidad)}`;
     total.style.visibility = "visible";
    } else {
     total.style.visibility = "hidden";
    }

    pintarBascula();
    return;
   }

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
   if (modo === "importe") {
    const meta = metaImporte();

    if (!meta) {
     const campoImporte = document.getElementById("modalPesoCantidad");
     campoImporte?.focus();
     campoImporte?.select();
     return;
    }

    const hayBascula = Boolean(unidadesPorKilo && bascula.conectada());
    const pesoEnUnidad = hayBascula ? bascula.pesoKg() * unidadesPorKilo : 0;

    cerrar(bascula.cantidadImporte(meta, pesoEnUnidad, hayBascula));
    return;
   }

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

  // Panel de la bascula: se arma una vez por estado y despues solo se actualizan los numeros (no se pierde el foco ni los toques).
  const pintarBascula = () => {
   const panel = document.getElementById("modalPesoBascula");

   if (!panel || !conBascula) return;

   const conectada = Boolean(unidadesPorKilo && bascula.conectada());

   if (!conectada) {
    if (panel.dataset.estado !== "sin") {
     panel.dataset.estado = "sin";
     panel.className = "bas-panel bas-sin";
     panel.innerHTML = unidadesPorKilo && bascula.disponible()
      ? `<button type="button" class="bas-conectar" data-bascula="conectar">Conectar báscula</button>
         <label class="bas-velocidad">Velocidad <select id="basVelocidad">${bascula.VELOCIDADES.map(v => `<option value="${v}" ${v === bascula.velocidad() ? "selected" : ""}>${v}</option>`).join("")}</select></label>
         <span class="bas-error" id="basError" role="alert"></span>`
      : "";
     enlazarBascula(panel);
    }

    return;
   }

   if (panel.dataset.estado !== modo) {
    panel.dataset.estado = modo;
    panel.className = "bas-panel";
    panel.innerHTML = `<div class="bas-vivo"><span class="bas-peso" id="basPeso">0 g</span><span class="bas-importe" id="basImporte"></span></div>
     ${modo === "importe" ? `<div class="bas-barra" aria-hidden="true"><i id="basRelleno"></i></div><div class="bas-estado" id="basEstado" aria-live="polite"></div>` : `<div class="bas-estado" id="basEstado" aria-live="polite"></div><button type="button" class="bas-usar" data-bascula="usar">Usar este peso</button>`}
     <button type="button" class="bas-desconectar" data-bascula="desconectar">Desconectar</button>`;
    enlazarBascula(panel);
   }

   const kg = bascula.pesoKg();
   const estable = bascula.estable();

   document.getElementById("basPeso").textContent = bascula.formatoPeso(kg);
   document.getElementById("basImporte").textContent = dinero(kg * unidadesPorKilo * precioUnidad);

   const estado = document.getElementById("basEstado");

   if (modo === "importe") {
    const meta = metaImporte();
    const lectura = bascula.estadoBarra(kg, meta ? meta / unidadesPorKilo : 0, estable);

    panel.dataset.color = meta ? lectura.color : "gris";
    panel.classList.toggle("bas-listo", Boolean(meta && lectura.listo));
    document.getElementById("basRelleno").style.width = `${meta ? lectura.porcentaje : 0}%`;
    estado.textContent = meta ? lectura.texto : "Escribe el importe";
   } else {
    panel.dataset.color = kg > 0 ? (estable ? "verde" : "ambar") : "gris";
    estado.textContent = kg > 0 ? (estable ? "Peso estable" : "Pesando…") : "Pon el producto en la báscula";
   }
  };

  const enlazarBascula = panel => {
   panel.querySelectorAll("[data-bascula]").forEach(boton => {
    boton.onclick = async () => {
     const accion = boton.dataset.bascula;

     if (accion === "conectar") {
      const velocidad = document.getElementById("basVelocidad");
      if (velocidad) bascula.guardarVelocidad(velocidad.value);

      try {
       await bascula.conectar();
      } catch (error) {
       const mensaje = document.getElementById("basError");
       if (mensaje && error?.name !== "NotFoundError") mensaje.textContent = error?.message || "No se pudo conectar la báscula.";
      }

      pintarBascula();
      return;
     }

     if (accion === "usar") {
      const campo = document.getElementById("modalPesoCantidad");
      const valor = redondear3(bascula.pesoKg() * unidadesPorKilo);

      if (!(valor > 0) || !campo) return;

      cantidadTexto = String(valor);
      campo.value = cantidadTexto;
      actualizarTotal();
      return;
     }

     if (accion === "desconectar") {
      await bascula.desconectar();
      panel.dataset.estado = "";
      pintarBascula();
     }
    };
   });
  };

  const render = () => {
   const nombre =
   escaparPOS(producto?.nombre || "Producto");

   const precioTexto =
   precioUnidad > 0
   ? `$${precioUnidad.toFixed(2)} por ${etiqueta.abrev}`
   : "";

   const enImporte = conBascula && modo === "importe";

   const pestanas = conBascula
    ? `<div class="peso-pos-modos" role="tablist" aria-label="Cómo capturar">
        <button type="button" role="tab" aria-selected="${!enImporte}" class="${enImporte ? "" : "activo"}" data-modo="cantidad">${etiqueta.pregunta[0].toUpperCase()}${etiqueta.pregunta.slice(1)}</button>
        <button type="button" role="tab" aria-selected="${enImporte}" class="${enImporte ? "activo" : ""}" data-modo="importe">Pesos</button>
       </div>`
    : "";

   const campo = enImporte
    ? `<label class="peso-pos-cantidad-label">Importe en pesos
       <input type="number" step="0.01" min="0.01" id="modalPesoCantidad" placeholder="0.00" inputmode="decimal" value="${importeTexto}">
      </label>`
    : `<label class="peso-pos-cantidad-label">Cantidad en ${etiqueta.abrev}
       <input type="number" step="0.001" min="0.001" id="modalPesoCantidad" placeholder="0.000" inputmode="decimal" value="${cantidadTexto}">
      </label>`;

   const atajos = enImporte
    ? `<div class="peso-pos-atajos" role="group" aria-label="Importes rapidos"><span>Toca para escribir</span>${ATAJOS_IMPORTE_POS.map(valor => `<button type="button" data-importe="${valor}">$${valor}</button>`).join("")}<button type="button" class="peso-pos-borrar" data-importe="borrar">Borrar</button></div>`
    : (atajosPeso.length ? `<div class="peso-pos-atajos" role="group" aria-label="Cantidades rapidas"><span>Toca para sumar</span>${atajosPeso.map(([valor, texto]) => `<button type="button" data-atajo="${valor}">${texto} ${etiqueta.abrev}</button>`).join("")}<button type="button" class="peso-pos-borrar" data-atajo="borrar">Borrar</button></div>` : "");

   modal.innerHTML = `
   <div class="modal-card peso-pos-card">
    <div class="modal-card-header">
     <div>
      <span>${enImporte ? "Cuánto va a llevar en pesos?" : `Cuantos ${etiqueta.pregunta} lleva?`}</span>
      <h3>${nombre}</h3>
     </div>
     <button type="button" class="peso-pos-cerrar" data-accion="cancelar">Cerrar</button>
    </div>

    ${precioTexto ? `<p class="peso-pos-precio-unidad">${precioTexto}</p>` : ""}

    ${pestanas}

    ${campo}

    ${atajos}

    ${conBascula ? `<div id="modalPesoBascula" class="bas-panel"></div>` : ""}

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

   modal.querySelectorAll("[data-modo]").forEach(boton => {
    boton.onclick = () => {
     if (boton.dataset.modo === modo) return;
     modo = boton.dataset.modo;
     try { localStorage.setItem("nexo_peso_modo", modo); } catch (error) { /* sin almacenamiento */ }
     render();
    };
   });

   modal.querySelectorAll("[data-atajo]").forEach(boton => {
    boton.onclick = () => {
     const campo = document.getElementById("modalPesoCantidad");
     if (!campo) return;

     if (boton.dataset.atajo === "borrar") cantidadTexto = "";
     else cantidadTexto = String(Math.round(((Number(cantidadTexto) || 0) + Number(boton.dataset.atajo)) * 1000) / 1000);

     campo.value = cantidadTexto;
     actualizarTotal();
     campo.focus();
    };
   });

   modal.querySelectorAll("[data-importe]").forEach(boton => {
    boton.onclick = () => {
     const campo = document.getElementById("modalPesoCantidad");
     if (!campo) return;

     importeTexto = boton.dataset.importe === "borrar" ? "" : String(boton.dataset.importe);

     campo.value = importeTexto;
     actualizarTotal();
     campo.focus();
    };
   });

   const inputCantidad =
   document.getElementById("modalPesoCantidad");

   if (inputCantidad) {
    inputCantidad.focus();

    inputCantidad.oninput = () => {
     if (modo === "importe") importeTexto = inputCantidad.value;
     else cantidadTexto = inputCantidad.value;
     actualizarTotal();
    };
   }

   actualizarTotal();
   pintarBascula();
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
  if (conBascula) quitarEscucha = bascula.suscribir(() => pintarBascula());
  render();
 });
}

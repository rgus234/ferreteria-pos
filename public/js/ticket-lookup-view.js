// Pantalla "Buscar ticket" -- el cajero/dueno escanea (con el mismo
// lector de codigo de barras que ya usan, que escribe como teclado) o
// teclea el folio impreso en el ticket, y se muestra la venta junto
// con que productos llevan garantia. Reusa GET /ventas/folio/:folio,
// ya protegida por requerirAccesoNegocio -- sin ruta publica nueva.
//
// Tambien permite cambiar un producto de la venta por otro
// (POST /ventas/:id/cambios) -- ajusta el stock de los dos, calcula
// la diferencia de precio y actualiza el ticket para reflejar la
// composicion final de la venta.

let ventaActualBuscarTicket = null;

async function mostrarBuscarTicket() {
 if (typeof ocultarPantallasPrincipales === "function") {
  ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaBuscarTicket");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Buscar ticket", "Escanea o teclea el folio para ver la venta y sus garantias", "buscar-ticket");
 }

 pantalla.innerHTML = `
 <div class="caja buscar-ticket-shell">
  <h2>Buscar ticket</h2>
  <p class="buscar-ticket-subtitulo">Escanea el codigo de barras del ticket o teclea el folio (ej. V-000123).</p>
  <form onsubmit="buscarTicketPorFolio(event)" class="buscar-ticket-form">
   <input id="buscarTicketFolioInput" placeholder="Folio del ticket" autocomplete="off" autofocus>
   <button type="submit">Buscar</button>
  </form>
  <div id="buscarTicketResultado"></div>
 </div>
 `;

 document.getElementById("buscarTicketFolioInput")?.focus();
}

// Algunos lectores de codigo de barras USB mandan mal el guion del
// folio (ej. "V°000052" en vez de "V-000052") cuando su idioma de
// teclado configurado no coincide con el de Windows -- en vez de
// depender de que ese ajuste este bien hecho, se reconstruye el
// folio a partir de los digitos escaneados (el formato siempre es
// "V-" + 6 digitos), tolerando cualquier caracter raro en medio.
function normalizarFolioBuscado(texto) {
 const limpio = String(texto || "").trim();
 const digitos = limpio.match(/\d+/);

 if (digitos) {
  return "V-" + digitos[0].padStart(6, "0");
 }

 return limpio;
}

async function buscarTicketPorFolio(evento) {
 evento.preventDefault();

 const input =
 document.getElementById("buscarTicketFolioInput");

 const folio =
 normalizarFolioBuscado(input?.value);

 const resultado =
 document.getElementById("buscarTicketResultado");

 if (!folio || !resultado) return;

 resultado.innerHTML = `<p class="buscar-ticket-estado">Buscando...</p>`;

 try {
  const respuesta =
  await fetch(`/ventas/folio/${encodeURIComponent(folio)}`);

  const datos =
  await respuesta.json().catch(() => ({}));

  if (!respuesta.ok || !datos.ok || !datos.venta) {
   resultado.innerHTML = `<p class="buscar-ticket-estado buscar-ticket-error">No se encontro ningun ticket con ese folio.</p>`;
   return;
  }

  renderResultadoBuscarTicket(datos.venta);
 } catch (error) {
  resultado.innerHTML = `<p class="buscar-ticket-estado buscar-ticket-error">No se pudo buscar el ticket. Intenta de nuevo.</p>`;
 } finally {
  input?.select();
 }
}

function renderResultadoBuscarTicket(venta) {
 const resultado =
 document.getElementById("buscarTicketResultado");

 if (!resultado) return;

 ventaActualBuscarTicket = venta;

 const productos =
 Array.isArray(venta.productos) ? venta.productos : [];

 const filasProductos =
 productos.map(producto => `
  <div class="buscar-ticket-producto">
   <div>
    <strong>${escaparPOS(producto.nombre || "Producto")}</strong>
    <small>${escaparPOS(formatearCantidad(producto.cantidad, producto.unidadVenta || "pieza"))} x ${dinero(producto.precio || 0)}</small>
   </div>
   <span class="buscar-ticket-garantia ${producto.tieneGarantia ? "con-garantia" : "sin-garantia"}">
    ${producto.tieneGarantia ? `Con garantia -- ${escaparPOS(producto.garantiaDetalle || "sin detalle")}` : "Sin garantia"}
   </span>
   ${producto.admiteCambios !== false && producto.id ? `
    <button type="button" class="buscar-ticket-btn-cambio" onclick="abrirCambioProductoPOS(${Number(producto.id)})">
     Cambiar este producto
    </button>
   ` : ""}
  </div>
 `).join("");

 const cambios =
 Array.isArray(venta.cambios) ? venta.cambios : [];

 const notaCambios =
 cambios.length > 0
  ? `
   <div class="buscar-ticket-cambios">
    <h3>Cambios en este ticket</h3>
    ${cambios.map(cambio => `
     <p class="buscar-ticket-cambio-fila">
      Cambiado: <strong>${escaparPOS(cambio.producto_devuelto_nombre)}</strong> por
      <strong>${escaparPOS(cambio.producto_nuevo_nombre)}</strong>
      -- ${new Date(cambio.created_at).toLocaleString("es-MX")}
     </p>
    `).join("")}
   </div>
  `
  : "";

 const fecha =
 venta.fecha ? new Date(venta.fecha).toLocaleString("es-MX") : "";

 resultado.innerHTML = `
 <div class="buscar-ticket-detalle">
  <div class="buscar-ticket-cabecera">
   <div><span>Folio</span><strong>${escaparPOS(venta.folio || "")}</strong></div>
   <div><span>Fecha</span><strong>${escaparPOS(fecha)}</strong></div>
   <div><span>Cajero</span><strong>${escaparPOS(venta.cajero_nombre || venta.turno_usuario || "")}</strong></div>
   <div><span>Cliente</span><strong>${escaparPOS(venta.cliente_nombre || "Publico general")}</strong></div>
   <div><span>Metodo de pago</span><strong>${escaparPOS(venta.metodo_pago || "")}</strong></div>
   <div><span>Total</span><strong>${dinero(venta.total || 0)}</strong></div>
  </div>
  <h3>Productos</h3>
  ${filasProductos || `<p class="buscar-ticket-estado">Esta venta no tiene productos registrados.</p>`}
  ${notaCambios}
 </div>
 `;
}

// Cambia un producto de la venta actual por otro -- flujo de 2 pasos
// (buscar/elegir reemplazo, luego confirmar con la diferencia de
// precio ya calculada), mismo patron de modal con "paso" interno que
// ya usa pedirModoVentaPOS (public/js/pos-piece-sale-modal.js).
function abrirCambioProductoPOS(productoId, adminPinAutorizado = null) {
 const venta = ventaActualBuscarTicket;

 if (!venta) return;

 const lineaOriginal =
 (Array.isArray(venta.productos) ? venta.productos : [])
  .find(item => Number(item?.id) === Number(productoId));

 if (!lineaOriginal) return;

 return new Promise(resolve => {
  let paso = "buscar";
  let cerrado = false;
  let cantidadDevuelta = Number(lineaOriginal.cantidad) || 1;
  let cantidadNueva = 1;
  let productoSeleccionado = null;
  let productoRevisado = false;

  let modal =
  document.getElementById("modalCambioProductoPOS");

  if (!modal) {
   modal = document.createElement("div");
   modal.id = "modalCambioProductoPOS";
   modal.className = "modal-personalizado modal-cambio-producto";
   document.body.appendChild(modal);
  }

  function cerrar(valor) {
   if (cerrado) return;
   cerrado = true;
   document.removeEventListener("keydown", alKeydown, { capture: true });
   modal.style.display = "none";
   modal.innerHTML = "";
   resolve(valor || null);
  }

  function alKeydown(evento) {
   if (evento.key === "Escape") {
    evento.preventDefault();
    cerrar(null);
   }
  }

  function resultadosBusqueda() {
   const texto =
   document.getElementById("cambioProductoBuscarInput")?.value || "";

   if (!texto.trim()) return "";

   const encontrados =
   (typeof todosProductos !== "undefined" ? todosProductos : [])
    .filter(producto =>
     Number(producto.id) !== Number(productoId) &&
     typeof productoCoincideConTexto === "function" &&
     productoCoincideConTexto(producto, texto)
    )
    .slice(0, 8);

   if (!encontrados.length) {
    return `<p class="cambio-producto-vacio">Sin resultados</p>`;
   }

   return encontrados.map(producto => `
    <button type="button" class="cambio-producto-resultado" data-elegir-id="${producto.id}">
     <span>${escaparPOS(producto.nombre)}</span>
     <small>${dinero(producto.precio || 0)} -- stock ${producto.stock}</small>
    </button>
   `).join("");
  }

  function conectarBotones() {
   modal.querySelectorAll("[data-accion]").forEach(boton => {
    boton.onclick = () => {
     const accion = boton.dataset.accion;

     if (accion === "cancelar") {
      cerrar(null);
      return;
     }

     if (accion === "continuar") {
      cantidadDevuelta = Number(document.getElementById("cambioProductoCantidadDevuelta")?.value) || cantidadDevuelta;
      cantidadNueva = Number(document.getElementById("cambioProductoCantidadNueva")?.value) || cantidadNueva;
      productoRevisado = false;
      paso = "confirmar";
      render();
      return;
     }

     if (accion === "volver") {
      paso = "buscar";
      render();
      return;
     }

     if (accion === "confirmar") {
      confirmarCambio();
     }
    };
   });

   modal.querySelectorAll("[data-elegir-id]").forEach(boton => {
    boton.onclick = () => {
     const id = Number(boton.dataset.elegirId);
     productoSeleccionado = (typeof todosProductos !== "undefined" ? todosProductos : [])
      .find(producto => Number(producto.id) === id) || null;
     render();
    };
   });

   const buscarInput =
   document.getElementById("cambioProductoBuscarInput");

   if (buscarInput) {
    buscarInput.addEventListener("input", () => {
     const contenedor = document.getElementById("cambioProductoResultados");
     if (contenedor) contenedor.innerHTML = resultadosBusqueda();
     conectarBotones();
    });
    buscarInput.focus();
   }

   const checkRevision =
   document.getElementById("cambioProductoRevisado");

   if (checkRevision) {
    checkRevision.onchange = () => {
     productoRevisado = checkRevision.checked;
     const botonConfirmar = modal.querySelector('[data-accion="confirmar"]');
     if (botonConfirmar) botonConfirmar.disabled = !productoRevisado;
    };
   }
  }

  async function confirmarCambio() {
   try {
    const respuesta = await fetch(`/ventas/${venta.id}/cambios`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
      productoDevueltoId: productoId,
      cantidadDevuelta,
      productoNuevoId: productoSeleccionado.id,
      cantidadNueva,
      usuarioNombre: (typeof usuarioActual !== "undefined" && usuarioActual?.nombre) || "",
      adminPin: adminPinAutorizado || ""
     })
    });

    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok || !datos.ok) {
     await alertaPOS(datos.error || "No se pudo hacer el cambio.", "Error", "peligro");
     return;
    }

    const folioVenta = venta.folio;

    cerrar(datos);

    await alertaPOS(
     datos.diferencia > 0
      ? `Cambio hecho. Cobra ${dinero(datos.diferencia)} de diferencia.`
      : datos.diferencia < 0
      ? `Cambio hecho. Regresa ${dinero(Math.abs(datos.diferencia))} de cambio.`
      : "Cambio hecho sin diferencia de precio.",
     "Cambio registrado",
     "exito"
    );

    const inputFolio =
    document.getElementById("buscarTicketFolioInput");

    if (inputFolio) inputFolio.value = folioVenta;

    buscarTicketPorFolio({ preventDefault() {} });
   } catch (error) {
    await alertaPOS("No se pudo hacer el cambio. Intenta de nuevo.", "Error", "peligro");
   }
  }

  function render() {
   if (paso === "buscar") {
    modal.innerHTML = `
     <div class="modal-cambio-producto-caja">
      <h3>Cambiar producto</h3>
      <p class="cambio-producto-original">Se regresa: <strong>${escaparPOS(lineaOriginal.nombre)}</strong></p>
      <label class="cambio-producto-campo">
       Cantidad a devolver
       <input type="number" id="cambioProductoCantidadDevuelta" min="0.001" step="0.001" value="${cantidadDevuelta}">
      </label>
      <label class="cambio-producto-campo">
       Buscar producto de reemplazo
       <input type="text" id="cambioProductoBuscarInput" placeholder="Nombre o codigo" autocomplete="off">
      </label>
      <div id="cambioProductoResultados" class="cambio-producto-resultados">${resultadosBusqueda()}</div>
      ${productoSeleccionado ? `
       <div class="cambio-producto-elegido">
        <span>Elegiste: <strong>${escaparPOS(productoSeleccionado.nombre)}</strong></span>
        <label class="cambio-producto-campo">
         Cantidad nueva
         <input type="number" id="cambioProductoCantidadNueva" min="0.001" step="0.001" value="${cantidadNueva}">
        </label>
       </div>
      ` : ""}
      <div class="modal-cambio-producto-botones">
       <button type="button" data-accion="cancelar">Cancelar</button>
       <button type="button" data-accion="continuar" ${productoSeleccionado ? "" : "disabled"}>Continuar</button>
      </div>
     </div>
    `;
   } else {
    const precioDevuelto = Number(lineaOriginal.precio || 0);
    const precioNuevo = Number(productoSeleccionado.precio || 0);
    const diferencia = (precioNuevo * cantidadNueva) - (precioDevuelto * cantidadDevuelta);

    const textoDiferencia =
    diferencia > 0
     ? `Cobrar ${dinero(diferencia)} mas`
     : diferencia < 0
     ? `Regresar ${dinero(Math.abs(diferencia))} de cambio`
     : "Sin diferencia de precio";

    modal.innerHTML = `
     <div class="modal-cambio-producto-caja">
      <h3>Confirmar cambio</h3>
      <div class="cambio-producto-resumen">
       <div><span>Se regresa</span><strong>${escaparPOS(lineaOriginal.nombre)} x ${cantidadDevuelta}</strong></div>
       <div><span>Se entrega</span><strong>${escaparPOS(productoSeleccionado.nombre)} x ${cantidadNueva}</strong></div>
       <div class="cambio-producto-diferencia">${textoDiferencia}</div>
      </div>
      <label class="cambio-producto-revision">
       <input type="checkbox" id="cambioProductoRevisado" ${productoRevisado ? "checked" : ""}>
       Confirmo que revise el producto devuelto y esta en condiciones de reventa
      </label>
      <div class="modal-cambio-producto-botones">
       <button type="button" data-accion="volver">Volver</button>
       <button type="button" data-accion="confirmar" ${productoRevisado ? "" : "disabled"}>Confirmar cambio</button>
      </div>
     </div>
    `;
   }

   conectarBotones();
  }

  modal.style.display = "flex";
  document.addEventListener("keydown", alKeydown, { capture: true });
  render();
 });
}

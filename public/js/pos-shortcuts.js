/* Atajos de teclado del Punto de venta: F2 Buscar, F3 Escanear, F4 Cliente,
   F5 Descuento, F6 Cantidad, F7 Precio, F8 Cobrar */
(function instalarAtajosPuntoVentaPOS() {
 if (window.__posShortcutsInstalado) return;
 window.__posShortcutsInstalado = true;

 function puntoVentaVisible() {
  const pantalla =
  document.getElementById("pantallaPuntoVenta");

  return pantalla && pantalla.style.display !== "none";
 }

 function modalOperativoAbierto() {
  return Boolean(
  document.querySelector('.modal-overlay[style*="flex"], .modal-personalizado[style*="flex"], .modal-form-credito[style*="flex"]')
  );
 }

 function enfocarUltimaCantidadCarrito() {
  const filas =
  document.querySelectorAll(".pos-cart-row");

  if (!filas.length) return;

  const input =
  filas[filas.length - 1].querySelector(".item-cantidad input");

  if (!input) return;

  input.focus();
  input.select();
 }

 function expandirDescuentoCarrito() {
  const bloque =
  document.querySelector(".resumen-descuento");

  if (!bloque) return;

  bloque.classList.add("abierto");

  const valor =
  bloque.querySelector("#valorDescuentoCarrito");

  if (valor) {
   valor.focus();
   valor.select();
  }
 }

 function resaltarPrecioAplicadoCarrito() {
  const bloque =
  document.querySelector(".precio-aplicado-opciones");

  if (!bloque) return;

  bloque.classList.add("resaltado");

  const activo =
  bloque.querySelector("button.activo") || bloque.querySelector("button");

  if (activo) activo.focus();

  setTimeout(() => bloque.classList.remove("resaltado"), 900);
 }

 document.addEventListener("keydown", event => {
  if (!puntoVentaVisible() || modalOperativoAbierto()) return;

  if (!["F2", "F3", "F4", "F5", "F6", "F7", "F8"].includes(event.key)) return;

  event.preventDefault();

  if (event.key === "F2") {
   if (typeof enfocarBusquedaVentaRapida === "function") {
    enfocarBusquedaVentaRapida(false);
   }
   return;
  }

  if (event.key === "F3") {
   if (typeof enfocarBusquedaVentaRapida === "function") {
    enfocarBusquedaVentaRapida(true);
   }
   return;
  }

  if (event.key === "F4") {
   if (typeof abrirSelectorClientePOS === "function") {
    abrirSelectorClientePOS();
   }
   return;
  }

  if (event.key === "F5") {
   expandirDescuentoCarrito();
   return;
  }

  if (event.key === "F6") {
   enfocarUltimaCantidadCarrito();
   return;
  }

  if (event.key === "F7") {
   resaltarPrecioAplicadoCarrito();
   return;
  }

  if (event.key === "F8") {
   if (typeof resumenCarritoPOS === "function" && typeof cobrar === "function") {
    const resumen = resumenCarritoPOS();
    if (resumen.total > 0) {
     cobrar(resumen.total);
    }
   }
   return;
  }
 });
})();

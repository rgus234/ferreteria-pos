/* Captura global de lector USB */
(function instalarScannerUsbPOS() {
 if (window.__scannerUsbPOS) return;
 window.__scannerUsbPOS = true;

 let buffer = "";
 let ultimoTiempo = 0;
 let temporizador = null;

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

 function reiniciar() {
  buffer = "";
  ultimoTiempo = 0;
  clearTimeout(temporizador);
  temporizador = null;
 }

 function enviarCodigo() {
  const codigo =
  normalizarCodigo(buffer);

  reiniciar();

  if (!codigo || codigo.length < 4) return;

  if (typeof procesarCodigoBarrasPos === "function") {
   procesarCodigoBarrasPos(codigo);
  }
 }

 document.addEventListener("keydown", event => {
  if (!puntoVentaVisible() || modalOperativoAbierto()) return;

  const objetivo =
  event.target;

  const escribiendo =
  objetivo && ["INPUT", "TEXTAREA", "SELECT"].includes(objetivo.tagName);

  if (escribiendo && objetivo.id !== "busqueda") return;

  const ahora =
  Date.now();

  if (ahora - ultimoTiempo > 80) {
   buffer = "";
  }

  ultimoTiempo = ahora;

  if (event.key === "Enter") {
   if (buffer.length >= 4) {
    event.preventDefault();
    enviarCodigo();
   }
   return;
  }

  if (/^[a-zA-Z0-9]$/.test(event.key)) {
   buffer += event.key;
   clearTimeout(temporizador);
   temporizador = setTimeout(reiniciar, 140);

   if (!escribiendo) {
    event.preventDefault();
   }
  }
 });
})();

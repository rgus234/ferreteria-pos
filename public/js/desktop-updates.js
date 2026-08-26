// Aviso de actualizacion del escritorio -- el mecanismo de
// auto-actualizacion (apps/desktop/main.js, electron-updater) estaba
// completamente cableado del lado de Electron (baja la version nueva
// sola, cada 30 min) pero nadie del lado cliente escuchaba nada: Nexo
// se reiniciaba solo para instalarla sin ningun aviso. Si eso pasaba
// a medio cobrar una venta, la app simplemente desaparecia de la
// pantalla y volvia a abrir sin explicacion -- se siente como que se
// rompio, no como una actualizacion. Solo corre dentro del
// escritorio: window.nexoDesktop nunca existe en el navegador/movil.
(function iniciarAvisosActualizacionDesktop() {
 if (typeof window.nexoDesktop?.onUpdateStatus !== "function") return;

 window.nexoDesktop.onUpdateStatus(estado => {
  if (!estado || typeof mostrarToastPOS !== "function") return;

  if (estado.status === "downloaded") {
   mostrarToastPOS(
    `Nexo va a reiniciarse en unos segundos para instalar la version ${estado.latestVersion || "nueva"}. Termina de cobrar lo que tengas abierto.`,
    { titulo: "Actualizacion lista", tipo: "alerta", sinCerrar: true }
   );
   return;
  }

  if (estado.status === "error" && estado.error) {
   console.warn("[actualizacion-desktop]", estado.error);
  }
 });
})();

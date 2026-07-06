(() => {
 if (window.__fase7CajaUI) return;
 window.__fase7CajaUI = true;

 window.refrescarCaja7Metodos = () => {
  const pantalla = document.getElementById("pantallaCaja");
  if (!pantalla || pantalla.style.display === "none") return;
  if (typeof window.cargarCajaPOS === "function") window.cargarCajaPOS();
 };
})();

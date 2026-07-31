/* Menu movil compartido entre index.html y nexo-ia.html -- abre/cierra
   el panel desplegable (#mobileMenu) con el boton hamburguesa
   (#navToggle). Debajo de 760px (ver styles.css) el navegador y los
   botones de header-actions se mueven dentro de ese panel. */
(function () {
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("mobileMenu");
  if (!toggle || !menu) return;

  function cerrarMenu() {
    menu.classList.remove("abierto");
    toggle.classList.remove("abierto");
    toggle.setAttribute("aria-expanded", "false");
  }

  function alternarMenu() {
    const abierto = !menu.classList.contains("abierto");
    menu.classList.toggle("abierto", abierto);
    toggle.classList.toggle("abierto", abierto);
    toggle.setAttribute("aria-expanded", String(abierto));
  }

  toggle.addEventListener("click", alternarMenu);

  menu.querySelectorAll("a").forEach(enlace => {
    enlace.addEventListener("click", cerrarMenu);
  });

  document.addEventListener("click", event => {
    if (!menu.classList.contains("abierto")) return;
    if (menu.contains(event.target) || toggle.contains(event.target)) return;
    cerrarMenu();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") cerrarMenu();
  });
})();

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

/* Animacion de entrada al hacer scroll -- agrega .reveal-visible la
   primera vez que una seccion .reveal entra en pantalla (ver
   styles.css). Con movimiento reducido, o si el navegador no soporta
   IntersectionObserver, se muestran todas de una vez sin animar. */
(function () {
  const elementos = document.querySelectorAll(".reveal");
  if (!elementos.length) return;

  const prefiereMenosMovimiento =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefiereMenosMovimiento || typeof IntersectionObserver !== "function") {
    elementos.forEach(el => el.classList.add("reveal-visible"));
    return;
  }

  // threshold bajo a proposito -- una seccion mas alta que la pantalla
  // (comun en celulares con varias tarjetas apiladas) nunca llega a
  // mostrar un 15% de su propia altura de una sola vez, así que un
  // threshold alto simplemente nunca se cumple y la seccion se queda
  // invisible para siempre. Con threshold 0 basta con que un pixel
  // entre en pantalla.
  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.add("reveal-visible");
      observador.unobserve(entrada.target);
    });
  }, { threshold: 0, rootMargin: "0px 0px -40px 0px" });

  elementos.forEach(el => observador.observe(el));
})();

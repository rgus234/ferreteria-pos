/* Bienvenida de primer uso (escritorio) -- carrusel de una sola vez
   que se muestra justo despues de que un negocio recien creado arma
   su primer perfil de administrador (crearPerfilAdministradorInicial,
   config-auth.js). Mismo patron que el carrusel de /dueno
   (dueno.js), con una diferencia pedida por el usuario: boton
   "Saltar" visible desde la primera diapositiva. */

const NEXO_ONBOARDING_BIENVENIDA_KEY = "nexoOnboardingBienvenidaVisto";
const NEXO_ONBOARDING_TOTAL_SLIDES = 5;

let nexoOnboardingSlideActual = 0;

function mostrarBienvenidaNexoOnboarding() {
 if (localStorage.getItem(NEXO_ONBOARDING_BIENVENIDA_KEY)) return;

 const contenedor = document.getElementById("nexoOnboardingBienvenida");
 if (!contenedor) return;

 contenedor.style.display = "flex";
 nexoOnboardingSlideActual = 0;
 renderDotsBienvenidaNexoOnboarding();
 actualizarSlideBienvenidaNexoOnboarding();
}

function renderDotsBienvenidaNexoOnboarding() {
 const contenedor = document.getElementById("nexoOnboardingDots");
 if (!contenedor) return;

 contenedor.innerHTML = Array.from({ length: NEXO_ONBOARDING_TOTAL_SLIDES }, (valor, indice) =>
  `<span class="nexo-onboarding-dot${indice === nexoOnboardingSlideActual ? " activo" : ""}"></span>`
 ).join("");
}

function actualizarSlideBienvenidaNexoOnboarding() {
 const slides = document.getElementById("nexoOnboardingSlides");
 if (slides) slides.style.transform = `translateX(-${nexoOnboardingSlideActual * 100}%)`;

 document.querySelectorAll("#nexoOnboardingDots .nexo-onboarding-dot").forEach((punto, indice) => {
  punto.classList.toggle("activo", indice === nexoOnboardingSlideActual);
 });

 const boton = document.getElementById("nexoOnboardingBoton");
 if (boton) {
  boton.textContent = nexoOnboardingSlideActual === NEXO_ONBOARDING_TOTAL_SLIDES - 1 ? "Comenzar" : "Siguiente";
 }
}

function siguienteDiapositivaBienvenidaNexo() {
 if (nexoOnboardingSlideActual < NEXO_ONBOARDING_TOTAL_SLIDES - 1) {
  nexoOnboardingSlideActual += 1;
  actualizarSlideBienvenidaNexoOnboarding();
  return;
 }

 cerrarBienvenidaNexoOnboarding(true);
}

function saltarBienvenidaNexoOnboarding() {
 cerrarBienvenidaNexoOnboarding(false);
}

function cerrarBienvenidaNexoOnboarding(iniciarTourVenta) {
 localStorage.setItem(NEXO_ONBOARDING_BIENVENIDA_KEY, "1");

 const contenedor = document.getElementById("nexoOnboardingBienvenida");
 if (contenedor) contenedor.style.display = "none";

 if (iniciarTourVenta && typeof nexoTour === "function" && typeof nexoIaTourPasos === "function") {
  const pasos = nexoIaTourPasos("venta");
  if (pasos) {
   // El tour de Venta resalta elementos que solo existen visualmente
   // dentro de #pantallaPuntoVenta (busqueda, carrito, Cobrar) -- el
   // landing tras crear el perfil es Inicio, no Venta, asi que hay
   // que navegar ahi primero o el spotlight no encuentra nada que
   // resaltar (mismo boton que ya usa el sidebar, product-inventory.js).
   if (typeof mostrarPuntoVenta === "function") mostrarPuntoVenta();
   localStorage.setItem("nexoTourVisto_venta", "1");
   if (typeof actualizarModuloActivoPOS === "function") actualizarModuloActivoPOS("venta");
   nexoTour(pasos);
  }
 }
}

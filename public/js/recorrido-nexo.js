/* Recorrido de bienvenida de Nexo (negocio nuevo, escritorio).

   Un solo camino, una sola forma de verse, con la mascota como guia:

     1. Tu cuenta   -> bienvenida + inicio de sesion (aqui)
     2. Tu perfil   -> nombre y PIN del administrador (config-auth.js)
     3. Tu negocio  -> asistente de inicio, paso a paso (asistente-inicio.js)
     4. A vender    -> listo + guia

   Este archivo solo trae lo compartido: la barra de etapas, la mascota con su
   gesto segun el paso, el confeti y los botones de la pantalla de bienvenida.
   La logica de cada etapa sigue donde ya vivia. */

window.recorridoNexo = (function () {
 const ETAPAS = ["Tu cuenta", "Tu perfil", "Tu negocio", "¡A vender!"];

 function mascota(expresion) {
  return `img/nexo-ia/${expresion}-transparente.png`;
 }

 // actual: 1 a 4. Las anteriores aparecen como hechas.
 function etapasHtml(actual) {
  const piezas = [];

  ETAPAS.forEach((nombre, indice) => {
   const numero = indice + 1;
   const estado = numero < actual ? "hecha" : numero === actual ? "actual" : "";

   if (indice > 0) piezas.push(`<span class="rn-linea ${numero <= actual ? "hecha" : ""}"></span>`);

   piezas.push(`
    <span class="rn-etapa ${estado}" ${numero === actual ? 'aria-current="step"' : ""}>
     <span class="rn-etapa-punto">${numero < actual ? "&#10003;" : numero}</span>
     <span class="rn-etapa-nombre">${nombre}</span>
    </span>`);
  });

  return piezas.join("");
 }

 function montarEtapas() {
  document.querySelectorAll("[data-rn-etapas]").forEach(elemento => {
   elemento.classList.add("rn-etapas");
   elemento.innerHTML = etapasHtml(Number(elemento.dataset.rnEtapas) || 1);
  });
 }

 // Gesto y frase de la mascota en cada paso del asistente.
 const ESCENAS_ASISTENTE = {
  bienvenida: { gesto: "feliz", frase: "¡Hola! Soy Nexo 👋 Te acompaño para que tu negocio quede listo en unos minutos." },
  giro: { gesto: "pensando", frase: "Cuéntame qué vendes y te dejo las categorías y los consejos de tu giro." },
  correos: { gesto: "neutral", frase: "Con tu correo te avisamos de lo importante. Puedes cambiarlo cuando quieras." },
  negocio: { gesto: "feliz", frase: "Estos datos salen en tus tickets. Ya llené lo que tenía de ti." },
  equipo: { gesto: "neutral", frase: "Dime con qué cuentas en tu mostrador y Nexo se acomoda a ti. Lo puedes cambiar después." },
  vende: { gesto: "pensando", frase: "Ya casi. Te marqué lo más común para tu giro: cambia lo que no aplique." },
  listo: { gesto: "celebrando", frase: "¡Listo! Tu negocio quedó configurado. ¡A vender! 🎉" }
 };

 // Cambia la mascota y su frase con una animacion corta. Reinicia la animacion
 // quitando y poniendo la clase (con un reflujo en medio).
 function actualizarEscenaAsistente(paso) {
  const escena = ESCENAS_ASISTENTE[paso] || ESCENAS_ASISTENTE.bienvenida;
  const imagen = document.getElementById("asistenteMascotaGrande");
  const burbuja = document.getElementById("asistenteBurbuja");
  const etapas = document.getElementById("asistenteEtapas");

  if (etapas) etapas.innerHTML = etapasHtml(paso === "listo" ? 4 : 3);

  if (burbuja) {
   burbuja.textContent = escena.frase;
   reiniciarAnimacion(burbuja, "rn-burbuja-nueva");
  }

  if (imagen) {
   const destino = mascota(escena.gesto);
   if (!imagen.src.endsWith(destino)) imagen.src = destino;
   reiniciarAnimacion(imagen, "rn-mascota-cambia");
  }

  const cuerpo = document.querySelector("#asistenteInicio .asistente-card");
  if (cuerpo) reiniciarAnimacion(cuerpo, "rn-paso-entra");

  if (paso === "listo") confeti(document.getElementById("asistenteInicio"));
 }

 function reiniciarAnimacion(elemento, clase) {
  elemento.classList.remove(clase);
  void elemento.offsetWidth;
  elemento.classList.add(clase);
 }

 function confeti(contenedor) {
  if (!contenedor || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  contenedor.querySelector(".rn-confeti")?.remove();

  const capa = document.createElement("div");
  capa.className = "rn-confeti";
  capa.setAttribute("aria-hidden", "true");

  const colores = ["#1067e8", "#18b88f", "#f3a21b", "#e5484d", "#8b5cf6"];

  for (let i = 0; i < 36; i++) {
   const pieza = document.createElement("span");
   pieza.style.left = `${Math.round(Math.random() * 100)}%`;
   pieza.style.background = colores[i % colores.length];
   pieza.style.animationDelay = `${(Math.random() * 0.6).toFixed(2)}s`;
   pieza.style.animationDuration = `${(2.2 + Math.random() * 1.6).toFixed(2)}s`;
   pieza.style.transform = `rotate(${Math.round(Math.random() * 360)}deg)`;
   capa.appendChild(pieza);
  }

  contenedor.appendChild(capa);
  setTimeout(() => capa.remove(), 4800);
 }

 // ----- Pantalla de bienvenida (equipo sin negocio)

 function iniciarSesion() {
  if (typeof abrirBuscarNegocioSetup === "function") abrirBuscarNegocioSetup();
 }

 function quieroParticipar() {
  window.open("https://nexoposoficial.com/#participa", "_blank", "noopener");
 }

 // El formulario viejo solo guarda datos en este equipo y no crea cuenta: se
 // conserva, pero escondido, para quien de verdad lo necesite.
 function mostrarAvanzado() {
  document.getElementById("configuracionInicial")?.classList.add("rn-avanzado");
 }

 function ocultarAvanzado() {
  document.getElementById("configuracionInicial")?.classList.remove("rn-avanzado");
 }

 document.addEventListener("DOMContentLoaded", montarEtapas);
 if (document.readyState !== "loading") montarEtapas();

 return {
  etapasHtml,
  montarEtapas,
  mascota,
  actualizarEscenaAsistente,
  confeti,
  iniciarSesion,
  quieroParticipar,
  mostrarAvanzado,
  ocultarAvanzado
 };
})();

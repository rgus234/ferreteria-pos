/* Nexo AI v2 -- tours con spotlight. Componente generico, 100%
   cliente, compartido entre el escritorio y /dueno: recorta un
   overlay semitransparente alrededor de un elemento real de la
   pantalla y muestra un globo de texto corto al lado. Sin libreria
   nueva -- solo getBoundingClientRect() y CSS. */

function nexoSpotlight(selectorObjetivo, texto, opciones = {}) {
 return new Promise(resolve => {
  const objetivo = document.querySelector(selectorObjetivo);
  if (!objetivo) { resolve(); return; }

  objetivo.scrollIntoView({ block: "center", behavior: "auto" });

  const rect = objetivo.getBoundingClientRect();

  const overlay = document.createElement("div");
  overlay.className = "nexo-tour-overlay";

  const recorte = document.createElement("div");
  recorte.className = "nexo-tour-recorte";
  recorte.style.top = `${Math.max(0, rect.top - 6)}px`;
  recorte.style.left = `${Math.max(0, rect.left - 6)}px`;
  recorte.style.width = `${rect.width + 12}px`;
  recorte.style.height = `${rect.height + 12}px`;
  overlay.appendChild(recorte);

  const globo = document.createElement("div");
  globo.className = "nexo-tour-globo";
  const vaAbajo = rect.top < window.innerHeight / 2;
  if (vaAbajo) globo.style.top = `${rect.bottom + 16}px`;
  else globo.style.bottom = `${window.innerHeight - rect.top + 16}px`;
  globo.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 320))}px`;

  globo.innerHTML = `
   <p>${texto}</p>
   <div class="nexo-tour-globo-botones">
    <button type="button" class="nexo-tour-saltar">Saltar</button>
    <button type="button" class="nexo-tour-siguiente">${opciones.esUltimo ? "Entendido" : "Siguiente"}</button>
   </div>
  `;
  overlay.appendChild(globo);
  document.body.appendChild(overlay);

  const cerrar = () => { overlay.remove(); resolve(); };
  globo.querySelector(".nexo-tour-saltar").addEventListener("click", cerrar);
  globo.querySelector(".nexo-tour-siguiente").addEventListener("click", cerrar);
  overlay.addEventListener("click", event => { if (event.target === overlay) cerrar(); });
 });
}

async function nexoTour(pasos) {
 for (let indice = 0; indice < pasos.length; indice++) {
  await nexoSpotlight(pasos[indice].selector, pasos[indice].texto, { esUltimo: indice === pasos.length - 1 });
 }
}

/* Tours cortos por modulo (1 paso: resalta el boton del sidebar y
   reusa el texto de AYUDA_MODULOS_POS, ya escrito en shell-topbar.js
   -- misma fuente de verdad que "Que hace: <modulo>", sin inventar
   copy nuevo). Se agregan solo para los modulos donde vale la pena un
   tour (no los 19 -- Inicio y Venta ya son evidentes por si solos). */
const NEXO_TOUR_VISTO_PREFIJO = "nexoTourVisto_";

function nexoIaTourPasos(modulo) {
 const mapaSelector = {
  inventario: '[data-shell-module="inventario"]',
  reportes: '[data-shell-module="reportes"]',
  clientes: '[data-shell-module="clientes"]',
  catalogo: '[data-shell-module="catalogo"]',
  "inventario-bajo": '[data-shell-module="inventario-bajo"]'
 };

 const selector = mapaSelector[modulo];
 if (!selector) return null;

 const texto = (typeof AYUDA_MODULOS_POS !== "undefined" && AYUDA_MODULOS_POS[modulo]) || "Explora esta seccion del sistema.";
 return [{ selector, texto }];
}

function nexoIaTourAutoModulo(modulo) {
 const pasos = nexoIaTourPasos(modulo);
 if (!pasos) return;

 const clave = NEXO_TOUR_VISTO_PREFIJO + modulo;
 if (localStorage.getItem(clave)) return;

 localStorage.setItem(clave, "1");
 nexoTour(pasos);
}

/* Disparo manual desde el panel de ayuda de Nexo (plan Basico, ver
   nexo-ia.js) -- ignora el flag de "ya visto", el usuario lo pidio a
   proposito. */
function nexoIaTourManual(modulo) {
 const claveModulo = modulo || (typeof contextoTopbarPOS !== "undefined" && contextoTopbarPOS.modulo) || "inicio";
 const pasos = nexoIaTourPasos(claveModulo);

 if (!pasos) {
  if (typeof alertaPOS === "function") alertaPOS("Esta seccion todavia no tiene un tour guiado.", "Nexo", "info");
  return;
 }

 nexoTour(pasos);
}

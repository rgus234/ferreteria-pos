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

const PASOS_TOUR_POR_MODULO = {
 inventario: [{ selector: '[data-shell-module="inventario"]', texto: null }],
 reportes: [{ selector: '[data-shell-module="reportes"]', texto: null }],
 clientes: [{ selector: '[data-shell-module="clientes"]', texto: null }],
 catalogo: [{ selector: '[data-shell-module="catalogo"]', texto: null }],
 "inventario-bajo": [{ selector: '[data-shell-module="inventario-bajo"]', texto: null }],

 venta: [
  { selector: "#busqueda", texto: "Aqui escribes el nombre, el codigo o escaneas el producto que buscas." },
  { selector: ".pos-cart-hero-heading", texto: "Cada producto que agregues aparece aqui, en el carrito de la venta." },
  { selector: ".cliente-pos-selector", texto: "Por defecto la venta es 'Publico general' -- toca aqui si quieres asignarla a un cliente con credito." },
  { selector: "#resumenCobro .btn-cobrar", texto: "Cuando termines, toca Cobrar (o la tecla F8) para cerrar la venta." }
 ],

 "agregar-producto": [
  { selector: 'section[data-seccion="basica"] h2', texto: "Aqui va lo basico: codigo de barras, nombre, categoria y marca del producto." },
  { selector: 'section[data-seccion="precios"] h2', texto: "Estos son tus precios. 'Precio del carrito' es el que de verdad se cobra en una venta." },
  { selector: 'section[data-seccion="inventario"] h2', texto: "Aqui llevas el stock: cuanto tienes, cuando avisarte que ya es poco, y donde esta ubicado." },
  { selector: "#nuevaImagenProducto", texto: "Sube una foto del producto. Si el codigo ya tiene foto en el Banco de Nexo, aparece sola aqui y solo tienes que confirmarla." },
  { selector: "#btnGuardarProducto", texto: "Cuando termines, guarda el producto -- ya queda listo para venderse." }
 ]
};

function nexoIaTourPasos(modulo) {
 const pasos = PASOS_TOUR_POR_MODULO[modulo];
 if (!pasos) return null;

 return pasos.map(paso => ({
  selector: paso.selector,
  texto: paso.texto || (typeof AYUDA_MODULOS_POS !== "undefined" && AYUDA_MODULOS_POS[modulo]) || "Explora esta seccion del sistema."
 }));
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

/* Nexo IA (IA-2b): la burbuja flotante ya no es el chat -- es un
   acceso rapido (resumen + recomendaciones + preguntas rapidas). El
   chat completo vive en el modulo de pantalla completa
   (#pantallaNexoIA), igual que Ventas, Inventario o Reportes.
   Sin persistencia: el historial vive solo en esta variable JS y se
   pierde al recargar -- aceptado para esta version. El interceptor
   global de fetch (app.js) ya agrega el header de auth correcto a
   las rutas de /ia/*, no hace falta nada especial aqui. */

let historialNexoIA = [];
let nexoIaEnviando = false;

/* Base compartida (antena + cuerpo + ojos) para las 3 expresiones de
   Nexo -- feliz/neutral (default), pensando (mientras espera la
   respuesta del modelo) y alerta (cuando el resumen rapido encuentra
   stock bajo o creditos vencidos). El color de la alerta se aplica
   por clase CSS (.nexo-ia-marca-alerta), no fijo en el SVG, para
   respetar modo claro/oscuro. */
function nexoIaMarcaSVG(estado) {
 const cuerpoBase = `
  <circle cx="20" cy="7" r="2.4" fill="currentColor"/>
  <line x1="20" y1="9.4" x2="20" y2="14" stroke="currentColor" stroke-width="2"/>
  <rect x="6" y="14" width="28" height="22" rx="8" stroke="currentColor" stroke-width="2.2"/>
  <circle cx="15" cy="25" r="2.6" fill="currentColor"/>
  <circle cx="25" cy="25" r="2.6" fill="currentColor"/>
 `;

 const extra = {
  pensando: '<circle cx="14" cy="31" r="1.1" fill="currentColor"/><circle cx="20" cy="31" r="1.1" fill="currentColor"/><circle cx="26" cy="31" r="1.1" fill="currentColor"/>',
  alerta: '<path d="M20 28l2.6 4.6h-5.2L20 28Z" fill="currentColor"/>',
  feliz: '<path d="M15 29c1.5 1.5 6.5 1.5 8 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
 };

 const clase = estado === "alerta" ? " nexo-ia-marca-alerta" : "";

 return `
  <svg class="nexo-ia-marca${clase}" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
   ${cuerpoBase}
   ${extra[estado] || extra.feliz}
  </svg>
 `;
}

async function nexoIaHayAlerta() {
 try {
  const respuesta = await fetch("/ia/resumen-rapido");
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok) return false;
  return datos.stockBajo.productos.length > 0 || datos.creditos.clientesVencidos > 0;
 } catch (error) {
  return false;
 }
}

const PREGUNTAS_RAPIDAS_NEXO_IA = [
 "Como van mis ventas?",
 "Que productos se estan agotando?",
 "Tengo creditos vencidos?"
];

function nexoIaEquipoVinculado() {
 const tokenDispositivo = localStorage.getItem("nexoDispositivoToken");
 const tokenCuenta = localStorage.getItem("nexoCuentaSesionToken");
 return Boolean(tokenDispositivo || tokenCuenta);
}

function crearNexoIaUI() {
 if (document.getElementById("nexoIaBurbuja")) return;

 const burbuja = document.createElement("button");
 burbuja.id = "nexoIaBurbuja";
 burbuja.type = "button";
 burbuja.title = "Nexo IA";
 burbuja.innerHTML = nexoIaMarcaSVG("feliz");
 burbuja.addEventListener("click", alternarPopoverNexoIA);

 const popover = document.createElement("div");
 popover.id = "nexoIaPopover";

 document.body.appendChild(burbuja);
 document.body.appendChild(popover);
}

function alternarPopoverNexoIA() {
 const popover = document.getElementById("nexoIaPopover");
 if (!popover) return;

 const abriendo = !popover.classList.contains("abierto");
 popover.classList.toggle("abierto", abriendo);

 if (abriendo) cargarResumenRapidoNexoIA();
}

function cerrarPopoverNexoIA() {
 document.getElementById("nexoIaPopover")?.classList.remove("abierto");
}

async function cargarResumenRapidoNexoIA() {
 const popover = document.getElementById("nexoIaPopover");
 if (!popover) return;

 popover.innerHTML = `
  <div class="nexo-ia-popover-cabecera">
   ${nexoIaMarcaSVG("feliz")}
   <div class="nexo-ia-popover-titulo">Nexo IA</div>
  </div>
  <p class="nexo-ia-popover-cargando">Revisando tu negocio...</p>
 `;

 try {
  const respuesta = await fetch("/ia/resumen-rapido");
  const datos = await respuesta.json();

  if (!respuesta.ok || !datos.ok) {
   popover.querySelector(".nexo-ia-popover-cargando").textContent = "No se pudo cargar el resumen ahora mismo.";
   renderAccesosPopoverNexoIA(popover);
   return;
  }

  const hayAlerta = datos.stockBajo.productos.length > 0 || datos.creditos.clientesVencidos > 0;
  const marca = popover.querySelector(".nexo-ia-popover-cabecera");
  if (marca) marca.innerHTML = nexoIaMarcaSVG(hayAlerta ? "alerta" : "feliz") + '<div class="nexo-ia-popover-titulo">Nexo IA</div>';

  const filas = [
   `Ventas (7 dias): ${datos.ventas.transacciones} venta(s), $${Number(datos.ventas.total).toFixed(2)}`,
   datos.stockBajo.productos.length === 0
    ? "Inventario: sin productos en stock bajo"
    : `Inventario: ${datos.stockBajo.productos.length} producto(s) con stock bajo`,
   datos.creditos.clientesVencidos === 0
    ? "Creditos: sin creditos vencidos"
    : `Creditos: ${datos.creditos.clientesVencidos} vencido(s) por $${Number(datos.creditos.totalVencido).toFixed(2)}`
  ];

  popover.querySelector(".nexo-ia-popover-cargando").remove();

  const resumen = document.createElement("div");
  resumen.className = "nexo-ia-popover-resumen";
  resumen.innerHTML = filas.map(fila => `<p>${fila}</p>`).join("");
  popover.appendChild(resumen);

  renderAccesosPopoverNexoIA(popover);
 } catch (error) {
  popover.querySelector(".nexo-ia-popover-cargando").textContent = "No se pudo conectar con Nexo ahora mismo.";
  renderAccesosPopoverNexoIA(popover);
 }
}

function renderAccesosPopoverNexoIA(popover) {
 const preguntas = document.createElement("div");
 preguntas.className = "nexo-ia-popover-preguntas";
 preguntas.innerHTML = PREGUNTAS_RAPIDAS_NEXO_IA.map(
  (pregunta, indice) => `<button type="button" data-pregunta-rapida="${indice}">${pregunta}</button>`
 ).join("");
 popover.appendChild(preguntas);

 preguntas.querySelectorAll("[data-pregunta-rapida]").forEach(boton => {
  boton.addEventListener("click", () => {
   const pregunta = PREGUNTAS_RAPIDAS_NEXO_IA[Number(boton.dataset.preguntaRapida)];
   cerrarPopoverNexoIA();
   abrirNexoIAConPregunta(pregunta);
  });
 });

 const abrir = document.createElement("button");
 abrir.type = "button";
 abrir.className = "nexo-ia-popover-abrir";
 abrir.textContent = "Abrir Nexo IA";
 abrir.addEventListener("click", () => {
  cerrarPopoverNexoIA();
  mostrarNexoIA();
 });
 popover.appendChild(abrir);
}

function abrirNexoIAConPregunta(pregunta) {
 mostrarNexoIA();
 const input = document.getElementById("nexoIaInput");
 if (input) input.value = pregunta;
 enviarMensajeNexoIA();
}

async function mostrarNexoIA() {
 if (typeof ocultarPantallasPrincipales === "function") {
  ocultarPantallasPrincipales();
 }

 const pantalla = document.getElementById("pantallaNexoIA");
 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarModuloActivoPOS === "function") {
  actualizarModuloActivoPOS("nexo-ia");
 }

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Nexo IA", "Tu asistente para ventas, inventario y creditos", "nexo-ia");
 }

 pantalla.innerHTML = `
  <div class="caja nexo-ia-vista">
   <div class="nexo-ia-vista-cabecera" id="nexoIaVistaCabecera">
    ${nexoIaMarcaSVG("feliz")}
    <div>
     <h2>Nexo IA</h2>
     <p class="nexo-ia-vista-subtitulo">Pregunta lo que quieras saber de tu negocio</p>
    </div>
   </div>
   <div class="nexo-ia-mensajes" id="nexoIaMensajes"></div>
   <div class="nexo-ia-entrada">
    <textarea id="nexoIaInput" placeholder="Escribe tu pregunta..." maxlength="2000"></textarea>
    <button type="button" id="nexoIaEnviar">Enviar</button>
   </div>
  </div>
 `;

 document.getElementById("nexoIaEnviar").addEventListener("click", enviarMensajeNexoIA);
 document.getElementById("nexoIaInput").addEventListener("keydown", evento => {
  if (evento.key === "Enter" && !evento.shiftKey) {
   evento.preventDefault();
   enviarMensajeNexoIA();
  }
 });

 if (historialNexoIA.length === 0) {
  agregarMensajeNexoIA("Hola, soy Nexo. Preguntame como van tus ventas, tu inventario o tus creditos.", "asistente");
 } else {
  historialNexoIA.forEach(entrada => {
   agregarMensajeNexoIA(entrada.contenido, entrada.rol === "user" ? "usuario" : "asistente");
  });
 }
}

function actualizarMarcaCabeceraNexoIA(estado) {
 const svgActual = document.querySelector("#nexoIaVistaCabecera svg");
 if (svgActual) svgActual.outerHTML = nexoIaMarcaSVG(estado);
}

function agregarMensajeNexoIA(texto, clase) {
 const lista = document.getElementById("nexoIaMensajes");
 if (!lista) return null;
 const burbuja = document.createElement("div");
 burbuja.className = `nexo-ia-mensaje ${clase}`;
 burbuja.textContent = texto;
 lista.appendChild(burbuja);
 lista.scrollTop = lista.scrollHeight;
 return burbuja;
}

async function enviarMensajeNexoIA() {
 if (nexoIaEnviando) return;

 const input = document.getElementById("nexoIaInput");
 const mensaje = (input?.value || "").trim();
 if (!mensaje) return;

 input.value = "";
 agregarMensajeNexoIA(mensaje, "usuario");
 const indicador = agregarMensajeNexoIA("Nexo esta pensando...", "pensando");
 actualizarMarcaCabeceraNexoIA("pensando");

 nexoIaEnviando = true;
 const botonEnviar = document.getElementById("nexoIaEnviar");
 if (botonEnviar) botonEnviar.disabled = true;

 try {
  const respuesta = await fetch("/ia/chat", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ mensaje, historial: historialNexoIA })
  });

  const datos = await respuesta.json();
  indicador?.remove();

  if (!respuesta.ok || !datos.ok) {
   agregarMensajeNexoIA(datos.error || "Nexo no pudo responder. Intenta de nuevo.", "error");
   return;
  }

  agregarMensajeNexoIA(datos.respuesta, "asistente");
  historialNexoIA.push({ rol: "user", contenido: mensaje });
  historialNexoIA.push({ rol: "assistant", contenido: datos.respuesta });
  historialNexoIA = historialNexoIA.slice(-12);
 } catch (error) {
  indicador?.remove();
  agregarMensajeNexoIA("No se pudo conectar con Nexo. Revisa tu conexion.", "error");
 } finally {
  nexoIaEnviando = false;
  const boton = document.getElementById("nexoIaEnviar");
  if (boton) boton.disabled = false;
  actualizarMarcaCabeceraNexoIA("feliz");
 }
}

async function actualizarVisibilidadNexoIA() {
 const burbuja = document.getElementById("nexoIaBurbuja");
 if (!burbuja) return;

 const vinculado = nexoIaEquipoVinculado();
 burbuja.classList.toggle("visible", vinculado);
 if (!vinculado) return;

 const hayAlerta = await nexoIaHayAlerta();
 burbuja.innerHTML = nexoIaMarcaSVG(hayAlerta ? "alerta" : "feliz");
 burbuja.classList.toggle("con-alerta", hayAlerta);
}

document.addEventListener("DOMContentLoaded", () => {
 crearNexoIaUI();
 actualizarVisibilidadNexoIA();
});

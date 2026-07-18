/* Burbuja flotante de Nexo IA (chat basico con datos reales, IA-1).
   Sin persistencia: el historial vive solo en esta variable JS y se
   pierde al recargar -- aceptado para esta primera version. El
   interceptor global de fetch (app.js) ya agrega el header de auth
   correcto a "/ia/chat", no hace falta nada especial aqui. */

let historialNexoIA = [];
let nexoIaEnviando = false;

const NEXO_IA_MARCA_SVG = `
 <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="20" cy="7" r="2.4" fill="currentColor"/>
  <line x1="20" y1="9.4" x2="20" y2="14" stroke="currentColor" stroke-width="2"/>
  <rect x="6" y="14" width="28" height="22" rx="8" stroke="currentColor" stroke-width="2.2"/>
  <circle cx="15" cy="25" r="2.6" fill="currentColor"/>
  <circle cx="25" cy="25" r="2.6" fill="currentColor"/>
 </svg>
`;

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
 burbuja.innerHTML = NEXO_IA_MARCA_SVG;
 burbuja.addEventListener("click", alternarPanelNexoIA);

 const panel = document.createElement("div");
 panel.id = "nexoIaPanel";
 panel.innerHTML = `
  <div class="nexo-ia-cabecera">
   ${NEXO_IA_MARCA_SVG}
   <div class="nexo-ia-cabecera-titulo">Nexo IA</div>
   <button type="button" class="nexo-ia-cerrar" id="nexoIaCerrar" aria-label="Cerrar">&times;</button>
  </div>
  <div class="nexo-ia-mensajes" id="nexoIaMensajes">
   <div class="nexo-ia-mensaje asistente">Hola, soy Nexo. Preguntame como van tus ventas, tu inventario o tus creditos.</div>
  </div>
  <div class="nexo-ia-entrada">
   <textarea id="nexoIaInput" placeholder="Escribe tu pregunta..." maxlength="2000"></textarea>
   <button type="button" id="nexoIaEnviar">Enviar</button>
  </div>
 `;

 document.body.appendChild(burbuja);
 document.body.appendChild(panel);

 document.getElementById("nexoIaCerrar").addEventListener("click", alternarPanelNexoIA);
 document.getElementById("nexoIaEnviar").addEventListener("click", enviarMensajeNexoIA);
 document.getElementById("nexoIaInput").addEventListener("keydown", evento => {
  if (evento.key === "Enter" && !evento.shiftKey) {
   evento.preventDefault();
   enviarMensajeNexoIA();
  }
 });
}

function alternarPanelNexoIA() {
 const panel = document.getElementById("nexoIaPanel");
 if (!panel) return;
 panel.classList.toggle("abierto");
 if (panel.classList.contains("abierto")) {
  document.getElementById("nexoIaInput")?.focus();
 }
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

 nexoIaEnviando = true;
 document.getElementById("nexoIaEnviar").disabled = true;

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
  document.getElementById("nexoIaEnviar").disabled = false;
 }
}

function actualizarVisibilidadNexoIA() {
 const burbuja = document.getElementById("nexoIaBurbuja");
 if (!burbuja) return;
 burbuja.classList.toggle("visible", nexoIaEquipoVinculado());
}

document.addEventListener("DOMContentLoaded", () => {
 crearNexoIaUI();
 actualizarVisibilidadNexoIA();
});

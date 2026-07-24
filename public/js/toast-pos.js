/* Toasts no bloqueantes del POS -- pila fija arriba a la derecha.
   A diferencia de dialogoPOS() (config-auth.js), que reusa un solo
   nodo del DOM para un modal a la vez, aqui cada llamada crea su
   propio nodo -- puede haber varios toasts visibles al mismo tiempo. */

const TOAST_POS_MAX_VISIBLES = 5;
const TOAST_POS_AUTOCIERRE_MS = 3500;

const TOAST_POS_ICONOS = {
 info: "i",
 exito: "OK",
 alerta: "!",
 peligro: "!"
};

function contenedorToastPOS() {
 let contenedor =
 document.getElementById("toastStackPOS");

 if (!contenedor) {
 contenedor = document.createElement("div");
 contenedor.id = "toastStackPOS";
 contenedor.className = "toast-pos-stack";
 document.body.appendChild(contenedor);
 }

 return contenedor;
}

function escaparToastPOS(valor) {
 return String(valor ?? "")
 .replace(/&/g, "&amp;")
 .replace(/</g, "&lt;")
 .replace(/>/g, "&gt;")
 .replace(/"/g, "&quot;");
}

function cerrarToastPOS(tarjeta) {
 if (!tarjeta || tarjeta.dataset.cerrando === "1") return;

 tarjeta.dataset.cerrando = "1";
 tarjeta.classList.add("saliendo");

 setTimeout(() => tarjeta.remove(), 180);
}

function mostrarToastPOS(mensaje, opciones = {}) {
 const {
 titulo = "Aviso",
 tipo = "info",
 autoDismiss = null,
 accion = null
 } = typeof opciones === "string"
 ? { titulo: opciones }
 : opciones;

 const contenedor =
 contenedorToastPOS();

 while (contenedor.children.length >= TOAST_POS_MAX_VISIBLES) {
 cerrarToastPOS(contenedor.firstElementChild);
 }

 const tarjeta =
 document.createElement("div");

 tarjeta.className = `toast-pos-card toast-${tipo}`;

 tarjeta.innerHTML = `
 <div class="toast-pos-icon">${TOAST_POS_ICONOS[tipo] || "i"}</div>
 <div class="toast-pos-body">
 <strong>${escaparToastPOS(titulo)}</strong>
 <p>${escaparToastPOS(mensaje)}</p>
 ${
 accion
 ? `<a href="#" class="toast-pos-accion">${escaparToastPOS(accion.texto || "Ver mas")}</a>`
 : ""
 }
 </div>
 <button type="button" class="toast-pos-cerrar" aria-label="Cerrar">&times;</button>
 `;

 contenedor.appendChild(tarjeta);

 tarjeta.querySelector(".toast-pos-cerrar")
 ?.addEventListener("click", () => cerrarToastPOS(tarjeta));

 if (accion?.onClick) {
 tarjeta.querySelector(".toast-pos-accion")
 ?.addEventListener("click", event => {
 event.preventDefault();
 cerrarToastPOS(tarjeta);
 accion.onClick();
 });
 }

 const cierreAutomatico =
 autoDismiss !== null
 ? autoDismiss
 : (tipo === "exito" || tipo === "info")
 ? TOAST_POS_AUTOCIERRE_MS
 : null;

 if (cierreAutomatico) {
 setTimeout(() => cerrarToastPOS(tarjeta), cierreAutomatico);
 }

 return tarjeta;
}

window.mostrarToastPOS = mostrarToastPOS;

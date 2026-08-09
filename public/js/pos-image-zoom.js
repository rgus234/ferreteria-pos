/* Zoom de imagen de producto al hacer clic en la miniatura del carrito --
   solo lectura, sin dependencias externas. Mismo patron de modal
   crear/reusar que pos-weight-modal.js (id fijo, display flex/none,
   Escape y clic afuera cierran). */

function ampliarImagenProductoPOS(imgEl) {
 if (!imgEl?.src) return;

 const nombre =
 imgEl.dataset.fallbackNombre || "";

 let modal =
 document.getElementById("modalImagenZoomPOS");

 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalImagenZoomPOS";
  modal.className = "modal-personalizado modal-imagen-zoom-pos";
  document.body.appendChild(modal);
 }

 const cerrar = () => {
  modal.style.display = "none";
  modal.innerHTML = "";
  document.removeEventListener("keydown", manejarTeclado, true);
 };

 const manejarTeclado = event => {
  if (modal.style.display === "none") return;
  if (event.key === "Escape") {
   event.preventDefault();
   cerrar();
  }
 };

 modal.innerHTML = `
 <div class="imagen-zoom-card">
  <button type="button" class="imagen-zoom-cerrar" aria-label="Cerrar">Cerrar</button>
  <img src="${imgEl.src}" alt="${escaparPOS(nombre)}">
  ${nombre ? `<p class="imagen-zoom-nombre">${escaparPOS(nombre)}</p>` : ""}
 </div>
 `;

 modal.style.display = "flex";

 modal.onclick = event => {
  if (event.target === modal) cerrar();
 };

 modal.querySelector(".imagen-zoom-cerrar").onclick = cerrar;

 document.addEventListener("keydown", manejarTeclado, true);
}

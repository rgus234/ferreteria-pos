/* Zoom de imagen de producto al hacer clic en la miniatura del carrito --
   mismo patron de modal crear/reusar que pos-weight-modal.js (id fijo,
   display flex/none, Escape y clic afuera cierran). Ademas de la foto
   ampliada, trae la galeria completa del codigo (Banco de Nexo /
   catalogo del fabricante) y el boton de Proyectar -- mismo criterio
   que Ver detalles, Recepcion Inteligente y Explorar Nexo. */

function ampliarImagenProductoPOS(imgEl) {
 if (!imgEl?.src) return;

 const nombre =
 imgEl.dataset.fallbackNombre || "";

 const codigo =
 imgEl.dataset.codigo || "";

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
  <div class="imagen-zoom-foto" id="imagenZoomFotoPrincipal"><img src="${imgEl.src}" alt="${escaparPOS(nombre)}"></div>
  <div class="imagen-zoom-galeria" id="imagenZoomGaleria"></div>
  ${nombre ? `<p class="imagen-zoom-nombre">${escaparPOS(nombre)}</p>` : ""}
  <button type="button" class="imagen-zoom-proyectar" onclick="pantallaClienteAbrirProyeccion()">📽️ Proyectar</button>
 </div>
 `;

 modal.style.display = "flex";

 modal.onclick = event => {
  if (event.target === modal) cerrar();
 };

 modal.querySelector(".imagen-zoom-cerrar").onclick = cerrar;

 document.addEventListener("keydown", manejarTeclado, true);

 // Pantalla del cliente: al confirmar visualmente un producto que ya
 // esta en la venta, se manda a mostrar alla tambien (mismo criterio
 // que el resto del POS).
 if (typeof pantallaClienteMostrar === "function") {
  pantallaClienteMostrar({
   nombre,
   foto: imgEl.src,
   precio: imgEl.dataset.precio ? Number(imgEl.dataset.precio) : null,
   marca: imgEl.dataset.marca || null,
   origen: "punto-venta"
  });
 }

 if (codigo && typeof explorarNexoResolverGaleria === "function") {
  explorarNexoResolverGaleria(codigo).then(fotos => {
   if (modal.style.display === "none" || !fotos.length) return;

   const galeria = document.getElementById("imagenZoomGaleria");
   if (galeria) {
    galeria.innerHTML = fotos.map(url =>
     `<button type="button" class="imagen-zoom-galeria-item" data-imagen-zoom-foto="${escaparPOS(url)}"><img src="${url}" alt=""></button>`
    ).join("");

    galeria.addEventListener("click", event => {
     const boton = event.target.closest("[data-imagen-zoom-foto]");
     if (!boton) return;
     const principal = document.getElementById("imagenZoomFotoPrincipal");
     if (principal) principal.innerHTML = `<img src="${boton.dataset.imagenZoomFoto}" alt="">`;
    });
   }

   // La foto principal que ya se mostraba (propia del negocio) sigue
   // mandando -- el banco solo aporta vistas adicionales a la pantalla
   // del cliente, nunca la reemplaza.
   if (typeof pantallaClienteMostrar === "function") {
    pantallaClienteMostrar({
     nombre,
     foto: imgEl.src,
     fotos: [imgEl.src, ...fotos],
     precio: imgEl.dataset.precio ? Number(imgEl.dataset.precio) : null,
     marca: imgEl.dataset.marca || null,
     origen: "punto-venta"
    });
   }
  });
 }
}

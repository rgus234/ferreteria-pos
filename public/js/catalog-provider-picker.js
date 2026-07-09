/* Selector visual de proveedor antes de leer un catalogo: elegir el tile
   correcto enruta el parseo por su adaptador especifico (catalog-parsers.js).
   "Otro proveedor" conserva el flujo de siempre (texto libre + parser
   generico), sin cambiar nada para el caso no cubierto por un adaptador. */

const PROVEEDORES_CATALOGO_TILES = [
 { id: "diprofer", nombre: "Diprofer", icono: "D" },
 { id: "gafi", nombre: "Gafi", icono: "G" },
 { id: "truper", nombre: "Truper", icono: "T" },
 { id: "volteck", nombre: "Volteck", icono: "V" }
];

function abrirSelectorProveedorCatalogo() {
 return new Promise(resolve => {
  let modal =
  document.getElementById("modalProveedorCatalogo");

  if (!modal) {
   modal = document.createElement("div");
   modal.id = "modalProveedorCatalogo";
   modal.className = "modal-proveedor-catalogo";
   document.body.appendChild(modal);
  }

  modal.innerHTML = `
  <div class="proveedor-catalogo-card">
   <h2>De que proveedor es este catalogo?</h2>
   <p>Elige el proveedor para usar su formato de lectura correcto.</p>
   <div class="proveedor-catalogo-tiles">
    ${PROVEEDORES_CATALOGO_TILES.map(p => `
    <button type="button" class="proveedor-catalogo-tile" data-proveedor="${p.id}">
     <span class="proveedor-catalogo-icono">${p.icono}</span>
     <strong>${p.nombre}</strong>
    </button>
    `).join("")}
    <button type="button" class="proveedor-catalogo-tile proveedor-catalogo-otro" data-proveedor="otro">
     <span class="proveedor-catalogo-icono">+</span>
     <strong>Otro proveedor</strong>
    </button>
   </div>
   <button type="button" class="proveedor-catalogo-cancelar" id="cancelarProveedorCatalogo">Cancelar</button>
  </div>
  `;

  modal.style.display = "flex";

  const cerrar = valor => {
   modal.style.display = "none";
   resolve(valor);
  };

  modal.querySelectorAll(".proveedor-catalogo-tile").forEach(boton => {
   boton.onclick = () => {
    const id = boton.dataset.proveedor;

    if (id === "otro") {
     cerrar({ parser: "generico" });
     return;
    }

    const info =
    PROVEEDORES_CATALOGO_TILES.find(p => p.id === id);

    cerrar({ parser: id, proveedor: info?.nombre || "" });
   };
  });

  modal.querySelector("#cancelarProveedorCatalogo").onclick = () => cerrar(null);
 });
}

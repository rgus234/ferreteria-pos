/* Busqueda inteligente del POS (IA-6). Apagado por defecto: la
   busqueda funciona exactamente igual que siempre (buscarProductos()
   en app-bootstrap.js). Encendido, si la busqueda local (y el
   catalogo de proveedor guardado en este dispositivo, si existe) no
   encuentra nada, se le pide a Nexo IA solo palabras clave -- nunca
   productos inventados -- y se vuelve a buscar local con esas
   palabras. Ver docs/refactor-arquitectura.md (IA-6) para el flujo
   completo. */

let busquedaIaActiva = false;
let busquedaIaTimeout = null;

function alternarBusquedaIA() {
 busquedaIaActiva = !busquedaIaActiva;

 const boton = document.getElementById("posBusquedaIaToggle");
 if (boton) {
  boton.classList.toggle("activo", busquedaIaActiva);
  boton.setAttribute("aria-pressed", String(busquedaIaActiva));
 }

 const campo = document.getElementById("busqueda");
 if (campo) {
  campo.placeholder = busquedaIaActiva
   ? "Describe el producto aunque no conozcas su nombre..."
   : "Buscar producto por nombre, codigo o codigo de barras...";
 }

 if (typeof buscarProductos === "function") buscarProductos();
}

function cancelarBusquedaIaPendiente() {
 if (busquedaIaTimeout) {
  clearTimeout(busquedaIaTimeout);
  busquedaIaTimeout = null;
 }
}

function programarBusquedaIA(texto) {
 cancelarBusquedaIaPendiente();
 busquedaIaTimeout = setTimeout(() => {
  busquedaIaTimeout = null;
  ejecutarBusquedaIA(texto);
 }, 700);
}

// Catalogo de proveedor guardado en localStorage de este dispositivo
// (supplier-catalog.js / supplier-catalog-view.js) -- puede haber
// varios catalogos importados, se revisan todos y se combinan hasta
// un puñado de sugerencias. Sin costo, sincrono.
function buscarProductosEnCatalogoLocalPOS(texto) {
 if (typeof catalogosGuardados !== "function" || typeof buscarProductosEnCatalogoGuardado !== "function") {
  return [];
 }

 const catalogos = catalogosGuardados();
 if (!Array.isArray(catalogos) || catalogos.length === 0) return [];

 const vistos = new Set();
 const resultados = [];

 for (let indice = 0; indice < catalogos.length && resultados.length < 5; indice++) {
  const encontrados = buscarProductosEnCatalogoGuardado(indice, texto, 5);
  for (const item of encontrados) {
   const clave = `${item.codigo}::${item.nombre}`;
   if (vistos.has(clave)) continue;
   vistos.add(clave);
   resultados.push({
    __origenCatalogo: true,
    codigo: item.codigo,
    nombre: item.nombre,
    marca: item.marca,
    precio: item.publico || 0
   });
   if (resultados.length >= 5) break;
  }
 }

 return resultados;
}

// Re-busca localmente (mismo criterio que la busqueda normal) por
// cada palabra clave que sugirio la IA, combina y deduplica por id.
// Las palabras clave suelen ser frases ("codo media pulgada") que
// casi nunca aparecen literal en el nombre real del producto ("Codo
// PVC 1/2 pulgada") -- se busca por cada palabra suelta dentro de la
// frase (ignorando palabras muy cortas/genericas), no por la frase
// completa.
function buscarProductosLocalesPorPalabras(palabras) {
 const vistos = new Set();
 const combinados = [];
 const terminosVistos = new Set();

 for (const frase of Array.isArray(palabras) ? palabras : []) {
  const palabrasSueltas = String(frase || "")
   .toLowerCase()
   .split(/\s+/)
   .filter(palabra => palabra.length >= 3);

  for (const termino of palabrasSueltas) {
   if (terminosVistos.has(termino)) continue;
   terminosVistos.add(termino);

   const coincidencias = todosProductos.filter(producto => productoCoincideConTexto(producto, termino));
   for (const producto of coincidencias) {
    if (vistos.has(producto.id)) continue;
    vistos.add(producto.id);
    combinados.push(producto);
   }
  }
 }

 return combinados;
}

async function ejecutarBusquedaIA(texto) {
 const campo = document.getElementById("busqueda");
 const sigueVigente = () => campo && campo.value.toLowerCase().trim() === texto;

 if (!sigueVigente()) return;

 try {
  const respuesta = await fetch("/ia/buscar-inteligente", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ descripcion: texto })
  });
  const datos = await respuesta.json();

  if (!sigueVigente()) return; // el usuario ya cambio el texto mientras esperabamos

  if (!respuesta.ok || !datos.ok) {
   mostrarFlyoutBusquedaPOS([], { textoVacio: datos.error || "Nexo IA no pudo buscar ahora mismo." });
   return;
  }

  if (datos.disponible === false) {
   mostrarFlyoutBusquedaPOS([], { textoVacio: "Busqueda con IA disponible desde el plan Plus." });
   return;
  }

  const encontrados = buscarProductosLocalesPorPalabras(datos.keywords);

  if (encontrados.length === 0) {
   mostrarFlyoutBusquedaPOS([], { textoVacio: `Nexo IA no encontro productos relacionados con "${texto}".`, mostrarArticuloRapido: true });
  } else {
   mostrarFlyoutBusquedaPOS(encontrados, { textoVacio: "", nota: "Nexo IA encontro estos productos relacionados" });
  }
 } catch (error) {
  if (sigueVigente()) {
   mostrarFlyoutBusquedaPOS([], { textoVacio: "No se pudo conectar con Nexo IA." });
  }
 }
}

document.addEventListener("DOMContentLoaded", () => {
 const boton = document.getElementById("posBusquedaIaToggle");
 if (boton && typeof iconoUISVG === "function") {
  boton.innerHTML = iconoUISVG("sparkle");
 }
});

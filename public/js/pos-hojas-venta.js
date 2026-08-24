/* Hojas de venta multiples del Punto de venta (pestanas tipo Excel/Eleventa).
   El carrito activo sigue siendo las 5 variables globales de siempre
   (carrito, clienteVentaActual, descuentoCarrito, metodoPagoSeleccionado,
   nivelPrecioActual, declaradas en app.js). Una "hoja" es solo un snapshot
   clonado de esas 5 variables. Cambiar de hoja = capturar snapshot de la
   hoja que se deja + aplicar snapshot de la hoja destino + actualizarCarrito().
   Ninguna funcion de venta/cobro/credito existente sabe que esto existe. */

const HOJAS_VENTA_POS_KEY = "hojasVentaFerreteriaPOS";
const HOJAS_VENTA_POS_LIMITE = 6;

let hojasVentaPOS = [];
let hojaVentaActivaIdPOS = null;

function crearHojaVentaPOS() {
 return {
  id: Date.now() + Math.floor(Math.random() * 1000),
  nombre: null,
  personalizado: false,
  carrito: [],
  clienteVentaActual: null,
  descuentoCarrito: { tipo: "ninguno", valor: 0 },
  metodoPagoSeleccionado: "efectivo",
  nivelPrecioActual: "mayoreo"
 };
}

// Nombre a mostrar en la pestana -- si el dueño nunca la renombro (doble
// clic), se recalcula segun la posicion actual en vez de quedar fija con
// el numero que tenia al crearse. Antes "Venta 6" se quedaba asi para
// siempre aunque borraras las otras 5 hojas y fuera la unica que quedaba.
function nombreMostradoHojaVentaPOS(hoja, indice) {
 return hoja.personalizado && hoja.nombre ? hoja.nombre : `Venta ${indice + 1}`;
}

function capturarSnapshotHojaActivaVentaPOS() {
 return {
  carrito: JSON.parse(JSON.stringify(carrito)),
  clienteVentaActual: clienteVentaActual ? JSON.parse(JSON.stringify(clienteVentaActual)) : null,
  descuentoCarrito: JSON.parse(JSON.stringify(descuentoCarrito)),
  metodoPagoSeleccionado,
  nivelPrecioActual
 };
}

function aplicarSnapshotHojaVentaPOS(hoja) {
 carrito = JSON.parse(JSON.stringify(hoja.carrito || []));
 clienteVentaActual = hoja.clienteVentaActual ? JSON.parse(JSON.stringify(hoja.clienteVentaActual)) : null;
 descuentoCarrito = JSON.parse(JSON.stringify(hoja.descuentoCarrito || { tipo: "ninguno", valor: 0 }));
 metodoPagoSeleccionado = hoja.metodoPagoSeleccionado || "efectivo";
 nivelPrecioActual = hoja.nivelPrecioActual || "mayoreo";
}

function guardarHojasVentaLocalStoragePOS() {
 localStorage.setItem(HOJAS_VENTA_POS_KEY, JSON.stringify({
  version: 1,
  hojaActivaId: hojaVentaActivaIdPOS,
  hojas: hojasVentaPOS
 }));
}

function cargarHojasVentaLocalStoragePOS() {
 try {
  const datos =
  JSON.parse(localStorage.getItem(HOJAS_VENTA_POS_KEY) || "null");

  if (!datos || !Array.isArray(datos.hojas) || datos.hojas.length === 0) return null;

  return datos;
 } catch (error) {
  return null;
 }
}

function sincronizarHojaActivaVentaPOS() {
 if (hojaVentaActivaIdPOS === null) return;

 const hoja =
 hojasVentaPOS.find(h => h.id === hojaVentaActivaIdPOS);

 if (!hoja) return;

 Object.assign(hoja, capturarSnapshotHojaActivaVentaPOS());

 guardarHojasVentaLocalStoragePOS();
 renderHojasVentaTabsPOS();
}

function inicializarHojasVentaPOS() {
 const datos =
 cargarHojasVentaLocalStoragePOS();

 if (datos) {
  hojasVentaPOS = datos.hojas;

  // Migracion de hojas guardadas antes de que "personalizado" existiera:
  // un nombre que sigue el patron "Venta N" se trata como generico (se
  // vuelve a numerar segun posicion); cualquier otro nombre se conserva
  // porque el dueño lo escribio a mano con "Renombrar hoja".
  hojasVentaPOS.forEach(hoja => {
   if (hoja.personalizado === undefined) {
    hoja.personalizado = !/^Venta \d+$/.test(hoja.nombre || "");
   }
  });

  const hojaActiva =
  hojasVentaPOS.find(h => h.id === datos.hojaActivaId) || hojasVentaPOS[0];

  hojaVentaActivaIdPOS = hojaActiva.id;
  aplicarSnapshotHojaVentaPOS(hojaActiva);
 } else {
  const hoja =
  crearHojaVentaPOS();

  hojasVentaPOS = [hoja];
  hojaVentaActivaIdPOS = hoja.id;
  aplicarSnapshotHojaVentaPOS(hoja);
  guardarHojasVentaLocalStoragePOS();
 }

 renderHojasVentaTabsPOS();
}

function cambiarHojaVentaActivaPOS(id) {
 if (id === hojaVentaActivaIdPOS) return;
 if (window.__cobrandoEnCursoPOS) return;

 const destino =
 hojasVentaPOS.find(h => h.id === id);

 if (!destino) return;

 sincronizarHojaActivaVentaPOS();

 hojaVentaActivaIdPOS = id;
 aplicarSnapshotHojaVentaPOS(destino);
 guardarHojasVentaLocalStoragePOS();

 actualizarCarrito();
 if (typeof actualizarClientePOS === "function") actualizarClientePOS();

 renderHojasVentaTabsPOS();
}

function nuevaHojaVentaPOS() {
 if (window.__cobrandoEnCursoPOS) return;

 if (hojasVentaPOS.length >= HOJAS_VENTA_POS_LIMITE) {
  alertaPOS(`Ya tienes el maximo de ${HOJAS_VENTA_POS_LIMITE} hojas de venta abiertas. Cierra alguna para abrir otra.`, "Limite de hojas", "alerta");
  return;
 }

 sincronizarHojaActivaVentaPOS();

 const hoja =
 crearHojaVentaPOS();

 hojasVentaPOS.push(hoja);
 hojaVentaActivaIdPOS = hoja.id;
 aplicarSnapshotHojaVentaPOS(hoja);
 guardarHojasVentaLocalStoragePOS();

 actualizarCarrito();
 if (typeof actualizarClientePOS === "function") actualizarClientePOS();

 renderHojasVentaTabsPOS();
}

async function cerrarHojaVentaPOS(id) {
 if (hojasVentaPOS.length <= 1) {
  await alertaPOS("Debe quedar al menos una hoja de venta abierta.", "No se puede cerrar", "alerta");
  return;
 }

 const hoja =
 hojasVentaPOS.find(h => h.id === id);

 if (!hoja) return;

 const tieneProductos =
 id === hojaVentaActivaIdPOS ? carrito.length > 0 : (hoja.carrito || []).length > 0;

 if (tieneProductos) {
  const confirmado =
  await confirmarPOS("Esta hoja tiene productos. Cerrarla los perdera. Continuar?", "Cerrar hoja");

  if (!confirmado) return;
 }

 const indice =
 hojasVentaPOS.findIndex(h => h.id === id);

 hojasVentaPOS.splice(indice, 1);

 if (id === hojaVentaActivaIdPOS) {
  const nuevaActiva =
  hojasVentaPOS[indice - 1] || hojasVentaPOS[0];

  hojaVentaActivaIdPOS = nuevaActiva.id;
  aplicarSnapshotHojaVentaPOS(nuevaActiva);
  actualizarCarrito();
  if (typeof actualizarClientePOS === "function") actualizarClientePOS();
 }

 guardarHojasVentaLocalStoragePOS();
 renderHojasVentaTabsPOS();
}

async function renombrarHojaVentaPOS(id) {
 const indice =
 hojasVentaPOS.findIndex(h => h.id === id);

 const hoja =
 hojasVentaPOS[indice];

 if (!hoja) return;

 const nombre =
 await pedirTextoPOS("Nombre para esta hoja de venta:", nombreMostradoHojaVentaPOS(hoja, indice), "Renombrar hoja");

 if (nombre === null) return;

 const nombreLimpio =
 nombre.trim();

 if (nombreLimpio) {
  hoja.nombre = nombreLimpio;
  hoja.personalizado = true;
 }

 guardarHojasVentaLocalStoragePOS();
 renderHojasVentaTabsPOS();
}

function renderHojasVentaTabsPOS() {
 const contenedor =
 document.getElementById("posHojasVentaTabsPOS");

 if (!contenedor) return;

 const botonesHojas =
 hojasVentaPOS.map((hoja, indice) => {
  const activa =
  hoja.id === hojaVentaActivaIdPOS;

  const cantidad =
  hoja.id === hojaVentaActivaIdPOS ? carrito.length : (hoja.carrito || []).length;

  return `
  <button type="button" class="pos-hojas-venta-tab ${activa ? "activo" : ""}"
   onclick="cambiarHojaVentaActivaPOS(${hoja.id})"
   ondblclick="renombrarHojaVentaPOS(${hoja.id})">
   <span>${escaparPOS(nombreMostradoHojaVentaPOS(hoja, indice))}</span>
   ${cantidad > 0 ? `<small>${cantidad}</small>` : ""}
   <span class="pos-hojas-venta-tab-cerrar" onclick="event.stopPropagation(); cerrarHojaVentaPOS(${hoja.id})">×</span>
  </button>
  `;
 }).join("");

 const limiteAlcanzado =
 hojasVentaPOS.length >= HOJAS_VENTA_POS_LIMITE;

 contenedor.innerHTML = `
 ${botonesHojas}
 <button type="button" class="pos-hojas-venta-nueva" onclick="nuevaHojaVentaPOS()" ${limiteAlcanzado ? "disabled" : ""} title="Nueva hoja de venta (F9)">+</button>
 `;
}

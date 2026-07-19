async function iniciarSesion() {
 if (!configuracionNegocio()) {
 await inicializarConfiguracionInicial();
 return;
 }

 const usuarios =
 asegurarUsuariosSistema();

 const usuarioTexto =
 normalizarTexto(
 document.getElementById("usuario").value
 );

 const pin =
 document.getElementById("password").value.trim();

 const negocioSlug =
 normalizarSlugNegocio(
 document.getElementById("negocioLogin")?.value ||
 configuracionNegocio()?.negocioSlug ||
 configuracionNegocio()?.nombre
 );

 guardarNegocioActivo(negocioSlug);

 const usuario =
 usuarios.find(item =>
 normalizarTexto(item.nombre) === usuarioTexto ||
 normalizarTexto(item.id) === usuarioTexto
 );

 if (!usuario || String(usuario.pin) !== String(pin)) {
 alert("Usuario o contrasena incorrectos");
 document.getElementById("password").focus();
 return;
 }

 if (document.getElementById("recordarSesionLogin")?.checked === false) {
 localStorage.removeItem(SESION_POS_KEY);
 } else {
 guardarSesionPersistente(usuario);
 }

 await entrarAlSistemaConUsuario(usuario);
}

async function cargarProductos() {

 const respuesta =
 await fetch("/productos");

 todosProductos =
 await respuesta.json();

 actualizarDashboard();

 actualizarInventarioBajo();

 actualizarDatalistCategorias();

 const pantallaInventario =
 document.getElementById("pantallaInventario");

 if (pantallaInventario && pantallaInventario.style.display !== "none") {
 poblarFiltroCategoriaInventario();
 cargarTablaInventario();
 }
}

function actualizarDashboard() {

 if (typeof iconoUISVG === "function") {
 document.querySelectorAll("#pantallaInicio .kpi-icono").forEach(el => {
 if (!el.innerHTML) el.innerHTML = iconoUISVG(el.dataset.kpiIcon);
 });
 }

 const total =
 document.getElementById(
 "totalProductos"
 );

 if (total) {

 total.textContent =
 todosProductos.length;
 }

 const bajos =
 todosProductos.filter(
 p =>
 Number(p.stock) <= 5
 );

 const visibles =
 bajos.slice(0, 3);

 const totalBajos =
 document.getElementById(
 "totalBajos"
 );

 if (totalBajos) {

 totalBajos.textContent =
 bajos.length;
 }
 const resumenProductos = document.getElementById("resumenProductos");
const resumenBajos = document.getElementById("resumenBajos");
const resumenSinStock = document.getElementById("resumenSinStock");
const resumenCriticos = document.getElementById("resumenCriticos");

if (resumenProductos) {
 resumenProductos.textContent = todosProductos.length;
}

if (resumenBajos) {
 resumenBajos.textContent = bajos.length;
}

if (resumenSinStock) {
 resumenSinStock.textContent =
 todosProductos.filter(p => Number(p.stock) <= 0).length;
}

if (resumenCriticos) {
 resumenCriticos.textContent =
 todosProductos.filter(p => Number(p.stock) < 0).length;
}
}

function actualizarInventarioBajo() {

 const contenedor =
 document.getElementById(
 "inventarioBajo"
 );

 if (!contenedor) return;

 const bajos =
 todosProductos.filter(
 p =>
 Number(p.stock) <= 5
 );

 contenedor.innerHTML = "";

  if (
  bajos.length === 0
  ) {

 contenedor.innerHTML =
 "<p> Sin alertas</p>";

  return;
  }

  const visibles =
  bajos.slice(0, 3);
 
  visibles.forEach(p => {
 const stock =
 Number(p.stock || 0);

 const clase =
 stock <= 0
 ? "critica"
 : stock <= 2
 ? "media"
 : "baja";

 contenedor.innerHTML += `
 <div class="alerta-inventario-card ${clase}" onclick="mostrarInventarioBajo()" role="button" tabindex="0">
 <span class="alerta-dot"></span>
 <span class="alerta-info">
 <strong>${p.nombre}</strong>
 <small>Stock actual: ${stock}</small>
 </span>
 <span class="alerta-chip">${stock <= 0 ? "!" : "Bajo"}</span>
 </div>
 `;
 });

 if (bajos.length > visibles.length) {
 contenedor.innerHTML += `
 <div class="alerta-inventario-card extra" onclick="mostrarInventarioBajo()" role="button" tabindex="0">
 <span class="alerta-dot"></span>
 <span class="alerta-info">
 <strong>${bajos.length - visibles.length} productos mas</strong>
 <small>Revisar inventario bajo</small>
 </span>
 <span class="alerta-chip">Ver</span>
 </div>
 `;
 }
}

function buscarProductos() {

 const texto =
 document.getElementById(
 "busqueda"
 ).value
 .toLowerCase()
 .trim();

 const filtrados =
 todosProductos.filter(
 producto => productoCoincideConTexto(producto, texto)
 );

 if (typeof cancelarBusquedaIaPendiente === "function") cancelarBusquedaIaPendiente();

 if (!texto) {
 if (typeof ocultarFlyoutBusquedaPOS === "function") ocultarFlyoutBusquedaPOS();
 } else if (filtrados.length > 0 || typeof busquedaIaActiva === "undefined" || !busquedaIaActiva) {
 if (typeof mostrarFlyoutBusquedaPOS === "function") {
  mostrarFlyoutBusquedaPOS(filtrados, { textoVacio: `Sin resultados para "${texto}"` });
 }
 } else {
 // busquedaIaActiva && filtrados.length === 0: intenta el catalogo
 // local (gratis, sincrono) antes de programar la llamada a IA.
 const delCatalogo = typeof buscarProductosEnCatalogoLocalPOS === "function"
  ? buscarProductosEnCatalogoLocalPOS(texto)
  : [];

 if (delCatalogo.length > 0 && typeof mostrarFlyoutBusquedaPOS === "function") {
  mostrarFlyoutBusquedaPOS(delCatalogo, { textoVacio: "", nota: "Del catalogo de proveedor (todavia no en tu inventario)" });
 } else if (typeof programarBusquedaIA === "function") {
  if (typeof mostrarFlyoutBusquedaPOS === "function") {
   mostrarFlyoutBusquedaPOS([], { textoVacio: "Buscando con Nexo IA..." });
  }
  programarBusquedaIA(texto);
 } else if (typeof mostrarFlyoutBusquedaPOS === "function") {
  mostrarFlyoutBusquedaPOS(filtrados, { textoVacio: `Sin resultados para "${texto}"` });
 }
 }

 programarLecturaCodigoBarras(texto);
}

window.onload =
 async () => {

 aplicarPreferenciaTema();

 if (await inicializarConfiguracionInicial()) {
 inicializarLoginUsuarios();
 await intentarRestaurarSesion();
 }

 actualizarCarrito();
 cargarHistorial().catch(error => console.warn("No se pudo cargar historial inicial", error));

}; 

function cobrarConEnter(
 event,
 total
) {
 if (
 event.key === "Enter"
 ) {

 event.preventDefault();

 cobrar(total);

 setTimeout(() => {

 document
 .getElementById(
 "busqueda"
 )
 ?.focus();

 }, 400);
 }
}
function dinero(valor) {
 return Number(valor || 0)
 .toLocaleString(
 "es-MX",
 {
 style: "currency",
 currency: "MXN"
 }
 );
}

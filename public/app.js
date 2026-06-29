const catalogo = [
 {
 codigo: "7500001",
 nombre: "Pinza electricista 9",
 distribuidor: 118,
 medioMayoreo: 129,
 publico: 149,
 stockMinimo: 3,
 altaRotacion: "si"
 }
];

let carrito = [];
let clienteVentaActual = null;
let descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
let grafica = null;
let graficaReporteVentas = null;
let graficaDashboardVentas = null;
let todosProductos = [];
let clientesCredito = [];
let proveedores = [];
let creditoActual = null;
let resolverFormularioCredito = null;
let productoEditandoId = null;
let temporizadorCodigoBarras = null;
let usuarioActual = null;
let logoConfiguracionTemporal = null;
let paginaInventario = 1;
let paginaInventarioBajo = 1;
let paginaReporteVentas = 1;
let categoriaModalActual = "";
let estadoSyncDesktopPOS = {
 disponible: false,
 online: typeof navigator === "undefined" ? true : navigator.onLine,
 pendiente: 0,
 error: 0,
 sincronizado: 0,
 ultimaRevision: null,
 sincronizando: false
};
const TAMANO_PAGINA_INVENTARIO = 10;
const TAMANO_PAGINA_REPORTES = 8;
const VERSION_NEXO_POS = "1.0.0";

const CONFIG_NEGOCIO_KEY = "configuracionNegocioPOS";
const TEMA_POS_KEY = "temaPOS";
const SESION_POS_KEY = "sesionUsuarioPOS";
const NEGOCIO_ACTIVO_KEY = "negocioActivoNexoPOS";
const CONTACTO_DESARROLLADOR_KEY = "contactoDesarrolladorNexoPOS";
const MODO_DESARROLLADOR_NEXO_KEY = "modoDesarrolladorNexoPOS";
const CONTACTO_DESARROLLADOR_DEFAULT = {
 nombre: "Soporte Nexo POS",
 telefono: "",
 whatsapp: "",
 correo: ""
};
let estadoLicenciaNexoPOS = {
 modo: "normal",
 estado: "activa",
 plan: "demo"
};

function normalizarSlugNegocio(valor) {
 return String(valor || "ferreteria-olimpico")
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g, "")
 .toLowerCase()
 .replace(/[^a-z0-9]+/g, "-")
 .replace(/^-+|-+$/g, "")
 .slice(0, 80) || "ferreteria-olimpico";
}

function negocioActivoSlug() {
 const configuracion =
 configuracionNegocio();

 return normalizarSlugNegocio(
 localStorage.getItem(NEGOCIO_ACTIVO_KEY) ||
 configuracion?.negocioSlug ||
 configuracion?.nombre ||
 "ferreteria-olimpico"
 );
}

function guardarNegocioActivo(slug) {
 const limpio =
 normalizarSlugNegocio(slug);

 localStorage.setItem(NEGOCIO_ACTIVO_KEY, limpio);
 return limpio;
}

function aplicarNegocioDesdeURL() {
 const parametros =
 new URLSearchParams(window.location.search);
 const negocio =
 parametros.get("negocio");

 if (negocio) {
 guardarNegocioActivo(negocio);
 }
}

function desktopCacheDisponible() {
 return Boolean(
 window.nexoDesktop &&
 typeof window.nexoDesktop.saveCache === "function" &&
 typeof window.nexoDesktop.getCache === "function"
 );
}

function desktopCacheEstructuradoDisponible() {
 return Boolean(
 window.nexoDesktop &&
 typeof window.nexoDesktop.getStructuredCache === "function"
 );
}

function desktopSyncDisponiblePOS() {
 return Boolean(
 window.nexoDesktop &&
 typeof window.nexoDesktop.syncStats === "function" &&
 typeof window.nexoDesktop.syncPush === "function"
 );
}

async function revisarLicenciaNexoPOS() {
 try {
  const respuesta = desktopSyncDisponiblePOS() && typeof window.nexoDesktop.licenseStatus === "function"
  ? await window.nexoDesktop.licenseStatus()
  : await fetch("/licencia/estado").then(res => res.json());

  const licencia = respuesta?.licencia || respuesta?.cached?.payload || {};
  estadoLicenciaNexoPOS = {
   ...estadoLicenciaNexoPOS,
   ...licencia,
   modo: licencia.modo || "normal"
  };

  if (["gracia", "limitado", "bloqueado"].includes(estadoLicenciaNexoPOS.modo)) {
   const mensaje = ["limitado", "bloqueado"].includes(estadoLicenciaNexoPOS.modo)
   ? "La licencia esta vencida. El POS queda en modo limitado hasta regularizar la suscripcion."
   : "La licencia esta en periodo de gracia. El POS sigue funcionando, pero conviene regularizar el pago.";
   alertaPOS(mensaje, "Licencia Nexo POS", ["limitado", "bloqueado"].includes(estadoLicenciaNexoPOS.modo) ? "alerta" : "info");
  }

  return estadoLicenciaNexoPOS;
 } catch (error) {
  console.warn("No se pudo revisar licencia", error);
  return estadoLicenciaNexoPOS;
 }
}

async function validarOperacionLicenciaNexoPOS(operacion = "esta accion") {
 if (!estadoLicenciaNexoPOS || estadoLicenciaNexoPOS.modo === "normal") {
  await revisarLicenciaNexoPOS();
 }

 if (!["limitado", "bloqueado"].includes(estadoLicenciaNexoPOS.modo)) return true;

 await alertaPOS(
  `No se puede continuar con ${operacion} porque la licencia esta en modo limitado. Tus datos siguen guardados.`,
  "Licencia vencida",
  "alerta"
 );
 return false;
}

function recursoCacheableDesktop(destino, metodo) {
 if (String(metodo || "GET").toUpperCase() !== "GET") return false;

 return [
 "/productos",
 "/creditos",
 "/historial",
 "/proveedores",
 "/categorias",
 "/configuracion"
 ].includes(destino.pathname);
}

function cacheKeyDesktop(destino) {
 return [
 negocioActivoSlug(),
 destino.pathname,
 destino.search || ""
 ].join("|");
}

async function guardarCacheDesktop(destino, respuesta) {
 if (!desktopCacheDisponible() || !respuesta?.ok) return;

 try {
 const data =
 await respuesta.clone().json();

 await window.nexoDesktop.saveCache({
 cacheKey: cacheKeyDesktop(destino),
 endpoint: `${destino.pathname}${destino.search || ""}`,
 payload: data
 });
 } catch (error) {
 console.warn("No se pudo guardar cache local", error);
 }
}

async function respuestaDesdeCacheDesktop(destino) {
 if (!desktopCacheDisponible()) return null;

 try {
 const resultado =
 await window.nexoDesktop.getCache({
 cacheKey: cacheKeyDesktop(destino)
 });

 if (!resultado?.ok || !resultado.cached) return null;

 return new Response(
 JSON.stringify(resultado.cached.payload),
 {
 status: 200,
 headers: {
 "content-type": "application/json",
 "x-nexo-cache": "desktop",
 "x-nexo-cache-saved-at": resultado.cached.savedAt || ""
 }
 }
 );
 } catch (error) {
 console.warn("No se pudo leer cache local", error);
 return null;
 }
}

async function respuestaDesdeCacheEstructuradoDesktop(destino) {
 if (!desktopCacheEstructuradoDisponible()) return null;

 try {
 const resultado =
 await window.nexoDesktop.getStructuredCache({
 endpoint: destino.pathname
 });

 if (!resultado?.ok || !resultado.data) return null;

 return new Response(
 JSON.stringify(resultado.data),
 {
 status: 200,
 headers: {
 "content-type": "application/json",
 "x-nexo-cache": "desktop-structured"
 }
 }
 );
 } catch (error) {
 console.warn("No se pudo leer cache estructurado local", error);
 return null;
 }
}

async function fallbackDesktopCache(destino, esCacheable) {
 if (!esCacheable) return null;

 const cache =
 await respuestaDesdeCacheDesktop(destino);

 if (cache) return cache;

 return respuestaDesdeCacheEstructuradoDesktop(destino);
}

function instalarContextoNegocioFetch() {
 if (window.__nexoFetchNegocioInstalado) return;

 window.__nexoFetchNegocioInstalado = true;

 const fetchOriginal =
 window.fetch.bind(window);

 window.fetch = async (input, init = {}) => {
 const url =
 typeof input === "string"
 ? input
 : input?.url || "";

 const destino =
 new URL(url || window.location.href, window.location.href);

 if (destino.origin !== window.location.origin) {
 return fetchOriginal(input, init);
 }

 const metodo =
 init.method ||
 (typeof input !== "string" && input?.method) ||
 "GET";

 const esCacheable =
 recursoCacheableDesktop(destino, metodo);

 const headers =
 new Headers(
 init.headers ||
 (typeof input !== "string" && input?.headers) ||
 {}
 );

 headers.set("x-negocio-slug", negocioActivoSlug());

 if (typeof input !== "string") {
 const request =
 new Request(input, { ...init, headers });

 try {
 const respuesta =
 await fetchOriginal(request);

 if (esCacheable) {
 await guardarCacheDesktop(destino, respuesta);
 }

 return respuesta;
 } catch (error) {
 const cache =
 await fallbackDesktopCache(destino, esCacheable);

 if (cache) return cache;

 throw error;
 }
 }

 try {
 const respuesta =
 await fetchOriginal(input, { ...init, headers });

 if (esCacheable) {
 await guardarCacheDesktop(destino, respuesta);
 }

 return respuesta;
 } catch (error) {
 const cache =
 await fallbackDesktopCache(destino, esCacheable);

 if (cache) return cache;

 throw error;
 }
 };
}

aplicarNegocioDesdeURL();
instalarContextoNegocioFetch();

function desktopNexoDisponible() {
 return Boolean(
 window.nexoDesktop &&
 typeof window.nexoDesktop.queueEvent === "function"
 );
}

function crearEventIdPOS(tipo) {
 return [
 negocioActivoSlug(),
 tipo || "evento",
 Date.now(),
 Math.random().toString(16).slice(2)
 ].join("-");
}

async function aplicarMappingsSyncFrontendPOS(resultadoSync) {
 const aplicados =
 Array.isArray(resultadoSync?.aplicados)
 ? resultadoSync.aplicados
 : [];

 if (aplicados.length === 0) return;

 let cambioProductos = false;
 let cambioClientes = false;

 aplicados.forEach(item => {
 if (item.localId && item.productoId) {
 todosProductos =
 todosProductos.map(producto =>
 String(producto.id) === String(item.localId)
 ? {
 ...producto,
 id: item.productoId,
 pendienteSync: false
 }
 : producto
 );
 cambioProductos = true;
 }

 if (item.localId && item.clienteId) {
 clientesCredito =
 clientesCredito.map(cliente =>
 String(cliente.id) === String(item.localId)
 ? {
 ...cliente,
 id: item.clienteId,
 pendienteSync: false
 }
 : cliente
 );
 cambioClientes = true;
 }
 });

 if (cambioProductos) {
 mostrarProductos(todosProductos);
 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
 }

 if (cambioClientes) {
 renderCreditos({
 clientes: clientesCredito,
 total: clientesCredito.reduce((suma, cliente) => suma + Number(cliente.saldo || 0), 0),
 clientesConAdeudo: clientesCredito.filter(cliente => Number(cliente.saldo || 0) > 0).length
 });

 if (document.getElementById("pantallaClientes")?.style.display === "block") {
 renderClientes();
 }
 }

 if (cambioProductos || cambioClientes) {
 await guardarCatalogosLocalesDesktopPOS();
 }

 refrescarEstadoSyncDesktopPOS({ silencioso: true });
}

async function registrarEventoDesktopPOS(tipo, entidad, entidadId, payload = {}) {
 if (!desktopNexoDisponible()) {
 return {
 ok: false,
 skipped: true
 };
 }

 try {
 const resultado =
 await window.nexoDesktop.queueEvent({
 eventId: payload.eventId || crearEventIdPOS(tipo),
 tipo,
 entidad,
 entidadId: entidadId ? String(entidadId) : "",
 payload: {
 negocioSlug: negocioActivoSlug(),
 usuario: usuarioActual?.nombre || "",
 fechaLocal: new Date().toISOString(),
 ...payload
 }
 });

 if (typeof window.nexoDesktop.syncPush === "function") {
 window.nexoDesktop.syncPush().then(aplicarMappingsSyncFrontendPOS).catch(error => {
 console.warn("No se pudo sincronizar evento desktop", error);
 }).finally(() => {
 refrescarEstadoSyncDesktopPOS({ silencioso: true });
 });
 }

 return resultado;
 } catch (error) {
 console.warn("No se pudo guardar evento desktop", error);
 return {
 ok: false,
 error: error.message
 };
 }
}

function pintarEstadoSyncDesktopPOS() {
 const chip = document.getElementById("chipSyncDesktopPOS");
 if (!chip) return;

 const pendiente = Number(estadoSyncDesktopPOS.pendiente || 0);
 const errores = Number(estadoSyncDesktopPOS.error || 0);
 const online = estadoSyncDesktopPOS.online !== false;

 chip.classList.toggle("sync-offline", !online);
 chip.classList.toggle("sync-pendiente", pendiente > 0);
 chip.classList.toggle("sync-error", errores > 0);
 chip.classList.toggle("sync-ok", online && pendiente === 0 && errores === 0);

 const estado = !online
 ? "Local"
 : estadoSyncDesktopPOS.sincronizando
 ? "Sincronizando"
 : errores > 0
 ? "Revisar sync"
 : pendiente > 0
 ? `${pendiente} pendiente${pendiente === 1 ? "" : "s"}`
 : "Sincronizado";

 const detalle = !online
 ? "Sin internet: guardando en esta PC"
 : errores > 0
 ? (estadoSyncDesktopPOS.ultimoError || `${errores} evento${errores === 1 ? "" : "s"} con error`)
 : pendiente > 0
 ? "Se subira al volver la conexion"
 : "Datos al dia";

 chip.innerHTML = `<span class="sync-dot"></span><span>${estado}</span><small>${detalle}</small>`;
 chip.title = detalle;
}

async function refrescarEstadoSyncDesktopPOS(opciones = {}) {
 estadoSyncDesktopPOS.disponible = desktopSyncDisponiblePOS();
 estadoSyncDesktopPOS.online = typeof navigator === "undefined" ? true : navigator.onLine;

 if (!estadoSyncDesktopPOS.disponible) {
  pintarEstadoSyncDesktopPOS();
  return estadoSyncDesktopPOS;
 }

 try {
  const resultado = await window.nexoDesktop.syncStats();
  const stats = resultado?.stats || {};
  estadoSyncDesktopPOS = {
   ...estadoSyncDesktopPOS,
   disponible: true,
   online: typeof navigator === "undefined" ? true : navigator.onLine,
   pendiente: Number(stats.pendiente || 0),
   error: Number(stats.error || 0),
   sincronizado: Number(stats.sincronizado || 0),
   ultimoError: stats.ultimoError || "",
   ultimaRevision: new Date().toISOString()
  };
 } catch (error) {
  estadoSyncDesktopPOS = {
   ...estadoSyncDesktopPOS,
   disponible: true,
   online: false,
   ultimaRevision: new Date().toISOString()
  };

  if (!opciones.silencioso) {
   console.warn("No se pudo leer estado de sync", error);
  }
 }

 pintarEstadoSyncDesktopPOS();
 return estadoSyncDesktopPOS;
}

async function sincronizarAhoraDesktopPOS() {
 if (!desktopSyncDisponiblePOS()) return;

 estadoSyncDesktopPOS.sincronizando = true;
 pintarEstadoSyncDesktopPOS();

 try {
  const hayErrores = Number(estadoSyncDesktopPOS.error || 0) > 0;
  const puedeReintentar = hayErrores && typeof window.nexoDesktop.syncRetry === "function";
  const resultadoPush = puedeReintentar
  ? await window.nexoDesktop.syncRetry()
  : await window.nexoDesktop.syncPush();
  await aplicarMappingsSyncFrontendPOS(resultadoPush);

  if (typeof window.nexoDesktop.syncPull === "function") {
   await window.nexoDesktop.syncPull();
  }

  if (typeof window.nexoDesktop.checkIn === "function") {
   await window.nexoDesktop.checkIn().catch(() => null);
  }

  await refrescarEstadoSyncDesktopPOS({ silencioso: true });
  alertaPOS("Sincronizacion lista", "Nexo POS reviso los pendientes de esta computadora.", "exito");
 } catch (error) {
  console.warn("No se pudo sincronizar ahora", error);
  estadoSyncDesktopPOS.online = false;
  alertaPOS("Sincronizacion pendiente", "Se seguira guardando localmente y se intentara despues.", "alerta");
 } finally {
  estadoSyncDesktopPOS.sincronizando = false;
  await refrescarEstadoSyncDesktopPOS({ silencioso: true });
 }
}

async function registrarVentaOfflineDesktopPOS(payload) {
 if (!desktopNexoDisponible()) {
 return {
 ok: false,
 offlineDisponible: false
 };
 }

 const resultado =
 await registrarEventoDesktopPOS(
 "venta_creada",
 "venta",
 "",
 {
 ...payload,
 ventaId: null,
 historialId: null,
 modoRegistro: "offline"
 }
 );

 return {
 ...resultado,
 offlineDisponible: true
 };
}

async function registrarCreditoOfflineDesktopPOS(payload) {
 if (!desktopNexoDisponible()) {
 return {
 ok: false,
 offlineDisponible: false
 };
 }

 const resultado =
 await registrarEventoDesktopPOS(
 "credito_cargo_creado",
 "credito",
 payload.clienteId || "",
 {
 ...payload,
 movimientoId: null,
 modoRegistro: "offline"
 }
 );

 return {
 ...resultado,
 offlineDisponible: true
 };
}

async function registrarCambioCatalogoOfflineDesktopPOS(tipo, entidad, entidadId, payload = {}) {
 if (!desktopNexoDisponible()) {
 return {
 ok: false,
 offlineDisponible: false
 };
 }

 const resultado =
 await registrarEventoDesktopPOS(
 tipo,
 entidad,
 entidadId || "",
 {
 ...payload,
 modoRegistro: "offline"
 }
 );

 return {
 ...resultado,
 offlineDisponible: true
 };
}

async function guardarCatalogosLocalesDesktopPOS() {
 if (!desktopCacheDisponible()) return;

 try {
 await window.nexoDesktop.saveCache({
 cacheKey: [
 negocioActivoSlug(),
 "/productos",
 ""
 ].join("|"),
 endpoint: "/productos",
 payload: todosProductos
 });

 await window.nexoDesktop.saveCache({
 cacheKey: [
 negocioActivoSlug(),
 "/creditos",
 ""
 ].join("|"),
 endpoint: "/creditos",
 payload: {
 clientes: clientesCredito,
 total: clientesCredito.reduce((suma, cliente) => suma + Number(cliente.saldo || 0), 0),
 clientesConAdeudo: clientesCredito.filter(cliente => Number(cliente.saldo || 0) > 0).length
 }
 });
 } catch (error) {
 console.warn("No se pudo actualizar cache local de catalogos", error);
 }
}

function descontarInventarioLocalPOS(productos = []) {
 if (!Array.isArray(todosProductos) || !Array.isArray(productos)) return;

 productos.forEach(item => {
 const producto =
 todosProductos.find(actual => Number(actual.id) === Number(item.id));

 if (!producto) return;

 const cantidad =
 Number(item.cantidad || 0);

 producto.stock =
 Math.max(
 0,
 Number(producto.stock || 0) - cantidad
 );
 });

 mostrarProductos(todosProductos);
 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
}

async function intentarRefrescarNubePOS(operacion, contexto = "operacion") {
 try {
 return await operacion();
 } catch (error) {
 console.warn(`No se pudo refrescar ${contexto}`, error);
 return null;
 }
}

const PLANTILLAS_GIRO_NEGOCIO = {
 ferreteria: {
 nombre: "Ferreteria",
 categorias: [
 "Tornilleria",
 "Herramienta manual",
 "Herramienta electrica",
 "Electrico",
 "Plomeria",
 "Pintura y solventes",
 "Construccion",
 "Cementos y morteros",
 "Adhesivos y selladores",
 "Seguridad industrial",
 "Jardineria",
 "Cerrajeria",
 "Fijacion y taquetes",
 "Ferreteria general",
 "Pinturas",
 "Seguridad"
 ],
 unidades: ["pieza", "metro", "kg", "litro", "caja", "paquete", "tramo", "saco", "bulto", "servicio"]
 },
 abarrotes: {
 nombre: "Abarrotes",
 categorias: [
 "Bebidas",
 "Lacteos",
 "Botanas",
 "Abarrotes secos",
 "Limpieza",
 "Higiene",
 "Dulces",
 "Granel",
 "Caducidad corta"
 ],
 unidades: ["pieza", "kg", "gramo", "litro", "caja", "paquete", "servicio"]
 },
 papeleria: {
 nombre: "Papeleria",
 categorias: [
 "Utiles escolares",
 "Oficina",
 "Arte",
 "Impresiones",
 "Copias",
 "Engargolado",
 "Servicios",
 "Tecnologia"
 ],
 unidades: ["pieza", "paquete", "caja", "servicio"]
 },
 vinateria: {
 nombre: "Vinateria",
 categorias: [
 "Cerveza",
 "Vinos",
 "Licores",
 "Refrescos",
 "Botanas",
 "Hielo",
 "Promociones",
 "Caja / six"
 ],
 unidades: ["pieza", "paquete", "caja", "litro", "servicio"]
 },
 general: {
 nombre: "General",
 categorias: [
 "Productos",
 "Servicios",
 "Promociones",
 "Granel",
 "Temporada",
 "Sin categoria"
 ],
 unidades: ["pieza", "kg", "gramo", "litro", "metro", "caja", "paquete", "servicio"]
 }
};

function plantillaGiroActual(config = configuracionNegocio() || {}) {
 return PLANTILLAS_GIRO_NEGOCIO[config.giroNegocio || "ferreteria"] ||
 PLANTILLAS_GIRO_NEGOCIO.ferreteria;
}

function dialogoPOS(opciones = {}) {
 const {
 tipo = "info",
 titulo = "Aviso",
 mensaje = "",
 textoAceptar = "Aceptar",
 textoCancelar = "Cancelar",
 mostrarCancelar = false,
 entrada = false,
 valorInicial = "",
 placeholder = ""
 } = opciones;

 return new Promise(resolve => {
 let modal =
 document.getElementById("modalDialogoPOS");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalDialogoPOS";
 modal.className = "dialogo-pos-overlay";
 document.body.appendChild(modal);
 }

 const limpiar =
 valor => String(valor ?? "")
 .replace(/&/g, "&amp;")
 .replace(/</g, "&lt;")
 .replace(/>/g, "&gt;")
 .replace(/"/g, "&quot;");

 const iconos = {
 info: "i",
 exito: "OK",
 alerta: "!",
 peligro: "!"
 };

 modal.innerHTML = `
 <div class="dialogo-pos-card dialogo-${tipo}">
 <div class="dialogo-pos-icon">${iconos[tipo] || "i"}</div>
 <div class="dialogo-pos-body">
 <h2>${limpiar(titulo)}</h2>
 <p>${limpiar(mensaje)}</p>
 ${
 entrada
 ? `<input id="dialogoPOSInput" value="${limpiar(valorInicial)}" placeholder="${limpiar(placeholder)}">`
 : ""
 }
 </div>
 <div class="dialogo-pos-actions">
 ${
 mostrarCancelar
 ? `<button type="button" class="dialogo-cancelar">${textoCancelar}</button>`
 : ""
 }
 <button type="button" class="dialogo-aceptar">${textoAceptar}</button>
 </div>
 </div>
 `;

 modal.style.display = "flex";

 const cerrar = valor => {
 modal.style.display = "none";
 resolve(valor);
 };

 const input =
 modal.querySelector("#dialogoPOSInput");

 modal.querySelector(".dialogo-aceptar")
 ?.addEventListener("click", () => {
 cerrar(entrada ? input.value : true);
 });

 modal.querySelector(".dialogo-cancelar")
 ?.addEventListener("click", () => {
 cerrar(entrada ? null : false);
 });

 modal.addEventListener(
 "click",
 event => {
 if (event.target === modal && mostrarCancelar) {
 cerrar(entrada ? null : false);
 }
 },
 { once: true }
 );

 modal.addEventListener(
 "keydown",
 event => {
 if (event.key === "Escape" && mostrarCancelar) {
 cerrar(entrada ? null : false);
 }

 if (event.key === "Enter") {
 cerrar(entrada ? input?.value : true);
 }
 },
 { once: true }
 );

 setTimeout(() => {
 (input || modal.querySelector(".dialogo-aceptar"))?.focus();
 input?.select();
 }, 40);
 });
}

function alertaPOS(mensaje, titulo = "Aviso", tipo = "info") {
 return dialogoPOS({
 tipo,
 titulo,
 mensaje,
 textoAceptar: "Entendido"
 });
}

function confirmarPOS(mensaje, titulo = "Confirmar", tipo = "alerta") {
 return dialogoPOS({
 tipo,
 titulo,
 mensaje,
 mostrarCancelar: true,
 textoAceptar: "Confirmar",
 textoCancelar: "Cancelar"
 });
}

function pedirTextoPOS(mensaje, valorInicial = "", titulo = "Completar dato") {
 return dialogoPOS({
 tipo: "info",
 titulo,
 mensaje,
 entrada: true,
 valorInicial,
 mostrarCancelar: true,
 textoAceptar: "Guardar",
 textoCancelar: "Cancelar"
 });
}

window.alert = mensaje => {
 alertaPOS(String(mensaje || ""));
};

const MODULOS_SISTEMA = [
 { clave: "inicio", nombre: "Inicio / Dashboard" },
 { clave: "puntoVenta", nombre: "Punto de venta" },
 { clave: "inventario", nombre: "Inventario" },
 { clave: "inventarioBajo", nombre: "Inventario bajo" },
 { clave: "reportes", nombre: "Reportes / Ventas" },
 { clave: "clientes", nombre: "Clientes" },
 { clave: "proveedores", nombre: "Proveedores" },
 { clave: "catalogo", nombre: "Catalogo proveedor" },
 { clave: "recepcion", nombre: "Recepcion" },
 { clave: "caja", nombre: "Caja" },
 { clave: "finanzas", nombre: "Finanzas" },
 { clave: "pedidos", nombre: "Pedidos" },
 { clave: "ajustes", nombre: "Ajustes" },
 { clave: "dueno", nombre: "App dueno" },
 { clave: "configuracion", nombre: "Configuracion" }
];

const WIDGETS_DASHBOARD = [
 { clave: "productos", nombre: "Productos" },
 { clave: "inventarioBajo", nombre: "Inventario bajo" },
 { clave: "ventas", nombre: "Ultimas ventas" },
 { clave: "credito", nombre: "Credito pendiente" },
 { clave: "alertas", nombre: "Alertas de inventario" },
 { clave: "ultimasVentas", nombre: "Lista de ultimas ventas" }
];

function configuracionNegocio() {
 try {
 return JSON.parse(
 localStorage.getItem(CONFIG_NEGOCIO_KEY) || "null"
 );
 } catch (error) {
 return null;
 }
}

function inicialesNegocio(nombre) {
 return String(nombre || "Ferreteria")
 .split(/\s+/)
 .filter(Boolean)
 .slice(0, 2)
 .map(parte => parte[0])
 .join("")
 .toUpperCase() || "POS";
}

function logoMarcaHtml(configuracion) {
 if (configuracion?.logo) {
 return `
 <img
 class="brand-logo-img"
 src="${configuracion.logo}"
 alt="Logo ${configuracion.nombre}"
 >
 `;
 }

 return `
 <span class="brand-logo-fallback">
 ${inicialesNegocio(configuracion?.nombre)}
 </span>
 `;
}

function aplicarConfiguracionNegocio(configuracion) {
 if (!configuracion) return;

 if (!configuracion.negocioSlug) {
 configuracion.negocioSlug =
 normalizarSlugNegocio(configuracion.nombre);

 localStorage.setItem(
 CONFIG_NEGOCIO_KEY,
 JSON.stringify(configuracion)
 );
 }

 guardarNegocioActivo(configuracion.negocioSlug);

 document.title =
 configuracion.nombre || "POS Ferreteria";

 document.documentElement.style.setProperty(
 "--brand-color",
 configuracion.color || "#0d6efd"
 );

 const marcaSidebar =
 document.getElementById("marcaSidebar");

 if (marcaSidebar) {
 marcaSidebar.innerHTML = `
 <div class="brand-sidebar">
 ${logoMarcaHtml(configuracion)}
 <span>${configuracion.nombre}</span>
 </div>
 `;
 }

 const loginMarca =
 document.getElementById("loginMarcaNegocio");

 if (loginMarca) {
 loginMarca.innerHTML = `
 <div class="login-brand-logo">
 ${logoMarcaHtml(configuracion)}
 </div>
 <strong>${configuracion.nombre}</strong>
 <span>${configuracion.slogan || "Sistema de punto de venta"}</span>
 `;
 }
}

function actualizarBotonModo() {
 const boton =
 document.getElementById("btnModoDashboard");

 if (!boton) return;

 boton.innerHTML =
 document.body.classList.contains("oscuro")
 ? " Modo claro"
 : " Modo oscuro";
}

function aplicarPreferenciaTema() {
 const tema =
 localStorage.getItem(TEMA_POS_KEY);

 document.body.classList.toggle(
 "oscuro",
 tema === "oscuro"
 );

 actualizarBotonModo();
}

function inicializarConfiguracionInicial() {
 const configuracion =
 configuracionNegocio();

 if (!configuracion) {
 document.getElementById("configuracionInicial").style.display =
 "flex";

 document.getElementById("login").style.display =
 "none";

 document.getElementById("sistema").style.display =
 "none";

 setTimeout(() => {
  document
  .getElementById("setupNombreNegocio")
  ?.focus();

  cambiarPasoSetup(0);
  }, 50);

 const campoNombre =
 document.getElementById("setupNombreNegocio");

 const campoCodigo =
 document.getElementById("setupCodigoNegocio");

 const campoColor =
 document.getElementById("setupColorNegocio");

 campoNombre?.addEventListener("input", () => {
 const preview =
 document.getElementById("previewLogoNegocio");

  if (preview && !logoConfiguracionTemporal) {
  preview.innerHTML =
  campoNombre.value.trim()
  ? inicialesNegocio(campoNombre.value)
  : `<img src="nexo-pos-icon.jpg" alt="Nexo POS">`;
  }
 });

 campoNombre?.addEventListener("input", () => {
 if (!campoCodigo || campoCodigo.dataset.editado === "true") return;
 campoCodigo.value = normalizarSlugNegocio(campoNombre.value);
 });

 campoCodigo?.addEventListener("input", () => {
 campoCodigo.dataset.editado = "true";
 campoCodigo.value = normalizarSlugNegocio(campoCodigo.value);
 });

 campoColor?.addEventListener("input", () => {
 document.documentElement.style.setProperty(
 "--brand-color",
 campoColor.value
 );
 });

 return false;
 }

 aplicarConfiguracionNegocio(configuracion);

 document.getElementById("configuracionInicial").style.display =
 "none";

 document.getElementById("login").style.display =
 "flex";

 const campoNegocioLogin =
 document.getElementById("negocioLogin");

 if (campoNegocioLogin) {
 campoNegocioLogin.value =
 negocioActivoSlug();
 }

 return true;
}

function cargarLogoConfiguracion(event) {
 const archivo =
 event.target.files?.[0];

 if (!archivo) return;

 const lector =
 new FileReader();

 lector.onload = e => {
 logoConfiguracionTemporal =
 e.target.result;

 const preview =
 document.getElementById("previewLogoNegocio");

 if (preview) {
 preview.innerHTML = `
 <img src="${logoConfiguracionTemporal}" alt="Logo">
 `;
 }
 };

  lector.readAsDataURL(archivo);
}

let pasoSetupActual = 0;

function cambiarPasoSetup(paso) {
 const pasos =
 Array.from(document.querySelectorAll("[data-setup-step]"));

 if (!pasos.length) return;

 pasoSetupActual =
 Math.max(0, Math.min(Number(paso || 0), pasos.length - 1));

 pasos.forEach((elemento, indice) => {
 elemento.classList.toggle("active", indice === pasoSetupActual);
 });

 document.querySelectorAll("[data-setup-dot]").forEach((elemento, indice) => {
 elemento.classList.toggle("active", indice === pasoSetupActual);
 elemento.classList.toggle("done", indice < pasoSetupActual);
 });

 const botonAtras =
 document.getElementById("setupBackButton");

 const botonSiguiente =
 document.getElementById("setupNextButton");

 const botonFinal =
 document.getElementById("setupFinishButton");

 if (botonAtras) botonAtras.disabled = pasoSetupActual === 0;
 if (botonSiguiente) botonSiguiente.style.display = pasoSetupActual === pasos.length - 1 ? "none" : "inline-flex";
 if (botonFinal) botonFinal.style.display = pasoSetupActual === pasos.length - 1 ? "inline-flex" : "none";
}

function setupSiguiente() {
 if (pasoSetupActual === 0) {
  const nombre =
  document.getElementById("setupNombreNegocio")?.value.trim();

  if (!nombre) {
   alert("Primero escribe el nombre del negocio.");
   return;
  }
 }

 cambiarPasoSetup(pasoSetupActual + 1);
}

function setupAnterior() {
 cambiarPasoSetup(pasoSetupActual - 1);
}

function guardarConfiguracionInicial() {
 const nombre =
 document.getElementById("setupNombreNegocio").value.trim();

 const negocioSlug =
 normalizarSlugNegocio(
 document.getElementById("setupCodigoNegocio")?.value ||
 nombre
 );

 const adminNombre =
 document.getElementById("setupAdminNombre").value.trim();

 const adminPin =
 document.getElementById("setupAdminPin").value.trim();

 if (!nombre || !adminNombre || adminPin.length < 4) {
 alert("Completa negocio, administrador y un PIN minimo de 4 digitos");
 return;
 }

 const configuracion = {
 negocioSlug,
 nombre,
 slogan: document.getElementById("setupSloganNegocio").value.trim(),
 telefono: document.getElementById("setupTelefonoNegocio").value.trim(),
 direccion: document.getElementById("setupDireccionNegocio").value.trim(),
 color: document.getElementById("setupColorNegocio").value || "#0d6efd",
 logo: logoConfiguracionTemporal,
 adminNombre,
 fechaConfiguracion: new Date().toISOString()
 };

 localStorage.setItem(
 CONFIG_NEGOCIO_KEY,
 JSON.stringify(configuracion)
 );

 guardarNegocioActivo(negocioSlug);

 const usuarios =
 asegurarUsuariosSistema();

 const admin =
 usuarios.find(usuario => usuario.id === "admin");

 if (admin) {
 admin.nombre = adminNombre;
 admin.pin = adminPin;
 }

 guardarUsuariosSistema(usuarios);
 aplicarConfiguracionNegocio(configuracion);
 logoConfiguracionTemporal = null;

 document.getElementById("configuracionInicial").style.display =
 "none";

 document.getElementById("login").style.display =
 "flex";

 document.getElementById("usuario").value =
 adminNombre;

 document.getElementById("password").value =
 "";

 inicializarLoginUsuarios();
}

function ocultarPantallasPrincipales() {
 [
 "pantallaInicio",
 "pantallaPuntoVenta",
 "pantallaInventario",
 "pantallaCategoriasInventario",
 "pantallaCatalogo",
 "pantallaClientes",
 "pantallaProveedores",
 "pantallaInventarioBajo",
 "pantallaReportes",
 "pantallaConfiguracion"
 ].forEach(id => {
 const pantalla =
 document.getElementById(id);

 if (pantalla) {
 pantalla.style.display = "none";
 }
 });

 [
 "modalCategoriaProductos",
 "modalSugerenciaPedido"
 ].forEach(id => {
 const modal =
 document.getElementById(id);

 if (modal) {
 modal.style.display = "none";
 }
 });
}

function opcionesUsuariosConfiguracion() {
 return asegurarUsuariosSistema()
 .map(usuario => `
 <div class="config-user-row">
 <div>
 <strong>${usuario.nombre}</strong>
 <span>${usuario.rol}</span>
 </div>
 <button type="button" onclick="abrirPermisosUsuario('${usuario.id}')">
 Permisos
 </button>
 </div>
 `)
 .join("");
}

function mostrarConfiguracion() {
 ocultarPantallasPrincipales();

 const pantalla =
 document.getElementById("pantallaConfiguracion");

 const config =
 configuracionNegocio() || {};

 pantalla.innerHTML = `
 <div class="config-shell">
 <div class="config-header">
 <div>
 <span>Centro de control</span>
 <h2>Configuracion</h2>
 <p>Personaliza empresa, marca, ticket y accesos del POS.</p>
 </div>
 <button type="button" onclick="guardarConfiguracionSistema()">
 Guardar cambios
 </button>
 </div>

 <div class="config-grid">
 <section class="config-panel config-panel-brand">
 <h3>Empresa</h3>
 <div class="config-brand-preview">
 <div id="configLogoPreview" class="setup-logo-preview">
 ${config.logo ? `<img src="${config.logo}" alt="Logo">` : inicialesNegocio(config.nombre)}
 </div>
 <div>
 <strong id="configNombrePreview">${config.nombre || "Mi ferreteria"}</strong>
 <span id="configSloganPreview">${config.slogan || "Sistema de punto de venta"}</span>
 </div>
 </div>

 <label>
 <span>Nombre del negocio</span>
 <input id="configNombreNegocio" value="${config.nombre || ""}" oninput="previewConfiguracionEmpresa()">
 </label>

 <label>
 <span>Slogan</span>
 <input id="configSloganNegocio" value="${config.slogan || ""}" oninput="previewConfiguracionEmpresa()">
 </label>

 <label>
 <span>Telefono</span>
 <input id="configTelefonoNegocio" value="${config.telefono || ""}">
 </label>

 <label>
 <span>Direccion</span>
 <input id="configDireccionNegocio" value="${config.direccion || ""}">
 </label>
 </section>

 <section class="config-panel">
 <h3>Apariencia</h3>
 <label>
 <span>Color principal</span>
 <input id="configColorNegocio" type="color" value="${config.color || "#0d6efd"}" oninput="previewColorConfiguracion()">
 </label>

 <label>
 <span>Logo</span>
 <input id="configLogoNegocio" type="file" accept="image/*" onchange="cargarLogoConfiguracionSistema(event)">
 </label>

 <div class="config-actions-stack">
 <button type="button" onclick="cambiarModo()">
 Cambiar claro / oscuro
 </button>
 <button type="button" onclick="restaurarLogoConfiguracion()">
 Quitar logo
 </button>
 </div>
 </section>

 <section class="config-panel">
 <h3>Ticket</h3>
 <label>
 <span>Mensaje final</span>
 <input id="configMensajeTicket" value="${config.mensajeTicket || "Gracias por su compra"}">
 </label>

 <label>
 <span>Moneda</span>
 <input id="configMoneda" value="${config.moneda || "MXN"}">
 </label>

 <label class="config-check">
 <input id="configMostrarTelefonoTicket" type="checkbox" ${config.mostrarTelefonoTicket === false ? "" : "checked"}>
 <span>Mostrar telefono en ticket</span>
 </label>
 </section>

 <section class="config-panel">
 <h3>Usuarios y permisos</h3>
 <div class="config-users-list">
 ${opcionesUsuariosConfiguracion()}
 </div>
 <button type="button" onclick="abrirNuevoUsuarioSistema()">
 Nuevo usuario
 </button>
 </section>
 </div>
 </div>
 `;

 pantalla.style.display = "block";
}

function previewConfiguracionEmpresa() {
 const nombre =
 document.getElementById("configNombreNegocio")?.value || "";

 const slogan =
 document.getElementById("configSloganNegocio")?.value || "";

 const previewNombre =
 document.getElementById("configNombrePreview");

 const previewSlogan =
 document.getElementById("configSloganPreview");

 const logoPreview =
 document.getElementById("configLogoPreview");

 if (previewNombre) {
 previewNombre.textContent = nombre || "Mi ferreteria";
 }

 if (previewSlogan) {
 previewSlogan.textContent = slogan || "Sistema de punto de venta";
 }

 if (logoPreview && !logoConfiguracionTemporal && !configuracionNegocio()?.logo) {
 logoPreview.textContent = inicialesNegocio(nombre);
 }
}

function previewColorConfiguracion() {
 const color =
 document.getElementById("configColorNegocio")?.value || "#0d6efd";

 document.documentElement.style.setProperty(
 "--brand-color",
 color
 );
}

function cargarLogoConfiguracionSistema(event) {
 const archivo =
 event.target.files?.[0];

 if (!archivo) return;

 const lector =
 new FileReader();

 lector.onload = e => {
 logoConfiguracionTemporal = e.target.result;

 const preview =
 document.getElementById("configLogoPreview");

 if (preview) {
 preview.innerHTML = `<img src="${logoConfiguracionTemporal}" alt="Logo">`;
 }
 };

 lector.readAsDataURL(archivo);
}

function restaurarLogoConfiguracion() {
 logoConfiguracionTemporal = "";

 const preview =
 document.getElementById("configLogoPreview");

 if (preview) {
 preview.textContent =
 inicialesNegocio(
 document.getElementById("configNombreNegocio")?.value
 );
 }
}

function guardarConfiguracionSistema() {
 const actual =
 configuracionNegocio() || {};

 const nombre =
 document.getElementById("configNombreNegocio").value.trim();

 if (!nombre) {
 alert("El nombre del negocio es obligatorio");
 return;
 }

 const nuevaConfig = {
 ...actual,
 nombre,
 slogan: document.getElementById("configSloganNegocio").value.trim(),
 telefono: document.getElementById("configTelefonoNegocio").value.trim(),
 direccion: document.getElementById("configDireccionNegocio").value.trim(),
 color: document.getElementById("configColorNegocio").value || "#0d6efd",
 logo: logoConfiguracionTemporal !== null
 ? logoConfiguracionTemporal
 : actual.logo,
 mensajeTicket: document.getElementById("configMensajeTicket").value.trim(),
 moneda: document.getElementById("configMoneda").value.trim() || "MXN",
 mostrarTelefonoTicket: document.getElementById("configMostrarTelefonoTicket").checked,
 actualizada: new Date().toISOString()
 };

 localStorage.setItem(
 CONFIG_NEGOCIO_KEY,
 JSON.stringify(nuevaConfig)
 );

 logoConfiguracionTemporal = null;
 aplicarConfiguracionNegocio(nuevaConfig);
 if (usuarioActual) {
 guardarSesionPersistente(usuarioActual);
 }
 mostrarConfiguracion();
 alert("Configuracion guardada");
}

function valorConfigCampo(id, respaldo = "") {
 const campo =
 document.getElementById(id);

 return campo ? campo.value : respaldo;
}

function checkConfigCampo(id, respaldo = true) {
 const campo =
 document.getElementById(id);

 return campo ? campo.checked : respaldo;
}

function valorTicketFormulario(config = configuracionNegocio() || {}) {
 return {
 ...config,
 nombre: valorConfigCampo("configNombreNegocio", config.nombre || "").trim(),
 slogan: valorConfigCampo("configSloganNegocio", config.slogan || "").trim(),
 telefono: valorConfigCampo("configTelefonoNegocio", config.telefono || "").trim(),
 direccion: valorConfigCampo("configDireccionNegocio", config.direccion || "").trim(),
 color: valorConfigCampo("configColorNegocio", config.color || "#0d6efd"),
 logo: logoConfiguracionTemporal !== null ? logoConfiguracionTemporal : config.logo,
 moneda: valorConfigCampo("configMoneda", config.moneda || "MXN").trim() || "MXN",
 giroNegocio: valorConfigCampo("configGiroNegocio", config.giroNegocio || "ferreteria"),
 sucursal: valorConfigCampo("configSucursal", config.sucursal || "").trim(),
 duracionSesionHoras: Number(valorConfigCampo("configDuracionSesion", config.duracionSesionHoras ?? 12)),
 ticketAncho: valorConfigCampo("configTicketAncho", config.ticketAncho || "80"),
 ticketAlineacion: valorConfigCampo("configTicketAlineacion", config.ticketAlineacion || "center"),
 ticketNombre: valorConfigCampo("configTicketNombre", config.ticketNombre || config.nombre || "").trim(),
 ticketSubtitulo: valorConfigCampo("configTicketSubtitulo", config.ticketSubtitulo || config.slogan || "").trim(),
 mensajeTicket: valorConfigCampo("configMensajeTicket", config.mensajeTicket || "Gracias por su compra").trim(),
 notaTicket: valorConfigCampo("configNotaTicket", config.notaTicket || "").trim(),
 mostrarLogoTicket: checkConfigCampo("configMostrarLogoTicket", config.mostrarLogoTicket !== false),
 mostrarNombreTicket: checkConfigCampo("configMostrarNombreTicket", config.mostrarNombreTicket !== false),
 mostrarDireccionTicket: checkConfigCampo("configMostrarDireccionTicket", config.mostrarDireccionTicket !== false),
 mostrarTelefonoTicket: checkConfigCampo("configMostrarTelefonoTicket", config.mostrarTelefonoTicket !== false),
 mostrarCajeroTicket: checkConfigCampo("configMostrarCajeroTicket", config.mostrarCajeroTicket !== false),
 mostrarBarcodeTicket: checkConfigCampo("configMostrarBarcodeTicket", config.mostrarBarcodeTicket === true),
 impresoraNombre: valorConfigCampo("configImpresoraNombre", config.impresoraNombre || "").trim(),
 impresionSilenciosa: checkConfigCampo("configImpresionSilenciosa", config.impresionSilenciosa === true),
 imprimirAutomatico: checkConfigCampo("configImprimirAutomatico", config.imprimirAutomatico !== false),
 abrirCajonDespuesTicket: checkConfigCampo("configAbrirCajonDespuesTicket", config.abrirCajonDespuesTicket === true),
 abrirCajonPrueba: checkConfigCampo("configAbrirCajonPrueba", config.abrirCajonPrueba === true),
 cortarPapelTicket: checkConfigCampo("configCortarPapelTicket", config.cortarPapelTicket !== false),
 ticketCopias: Math.max(1, Number(valorConfigCampo("configTicketCopias", config.ticketCopias || 1)) || 1)
 };
}

function cambiarTabConfiguracion(tab) {
 document.querySelectorAll(".config-tabs button").forEach(boton => {
 boton.classList.toggle(
 "activo",
 boton.dataset.configTab === tab
 );
 });

 document.querySelectorAll(".config-tab-panel").forEach(panel => {
 panel.classList.toggle(
 "activo",
 panel.dataset.configPanel === tab
 );
 });

 if (tab === "ticket") {
 renderVistaPreviaTicket();
 }
}

function mostrarConfiguracion() {
 ocultarPantallasPrincipales();

 const pantalla =
 document.getElementById("pantallaConfiguracion");

 const config =
 configuracionNegocio() || {};

 pantalla.innerHTML = `
 <div class="config-shell">
 <div class="config-header config-header-pro">
 <div>
 <span>Centro de control</span>
 <h2>Configuracion</h2>
 <p>Ajusta empresa, tema, ticket, usuarios y operacion del POS.</p>
 </div>
 <button type="button" onclick="guardarConfiguracionSistema()">
 Guardar cambios
 </button>
 </div>

 <div class="config-tabs" role="tablist">
 <button type="button" class="activo" data-config-tab="empresa" onclick="cambiarTabConfiguracion('empresa')">Empresa</button>
 <button type="button" data-config-tab="apariencia" onclick="cambiarTabConfiguracion('apariencia')">Apariencia</button>
 <button type="button" data-config-tab="ticket" onclick="cambiarTabConfiguracion('ticket')">Ticket</button>
 <button type="button" data-config-tab="hardware" onclick="cambiarTabConfiguracion('hardware')">Hardware</button>
 <button type="button" data-config-tab="usuarios" onclick="cambiarTabConfiguracion('usuarios')">Usuarios</button>
 <button type="button" data-config-tab="sistema" onclick="cambiarTabConfiguracion('sistema')">Sistema</button>
 </div>

 <div class="config-tab-panel activo" data-config-panel="empresa">
 <section class="config-panel config-panel-brand">
 <h3>Datos del negocio</h3>
 <div class="config-brand-preview">
 <div id="configLogoPreview" class="setup-logo-preview">
 ${config.logo ? `<img src="${config.logo}" alt="Logo">` : inicialesNegocio(config.nombre)}
 </div>
 <div>
 <strong id="configNombrePreview">${config.nombre || "Mi ferreteria"}</strong>
 <span id="configSloganPreview">${config.slogan || "Sistema de punto de venta"}</span>
 </div>
 </div>

 <div class="config-form-grid">
 <label>
 <span>Nombre del negocio</span>
 <input id="configNombreNegocio" value="${config.nombre || ""}" oninput="previewConfiguracionEmpresa(); renderVistaPreviaTicket();">
 </label>
 <label>
 <span>Slogan</span>
 <input id="configSloganNegocio" value="${config.slogan || ""}" oninput="previewConfiguracionEmpresa(); renderVistaPreviaTicket();">
 </label>
 <label>
 <span>Telefono</span>
 <input id="configTelefonoNegocio" value="${config.telefono || ""}" oninput="renderVistaPreviaTicket()">
 </label>
 <label>
 <span>Direccion</span>
 <input id="configDireccionNegocio" value="${config.direccion || ""}" oninput="renderVistaPreviaTicket()">
 </label>
 </div>
 </section>
 </div>

 <div class="config-tab-panel" data-config-panel="apariencia">
 <section class="config-panel">
 <h3>Apariencia del sistema</h3>
 <div class="config-form-grid">
 <label>
 <span>Color principal</span>
 <input id="configColorNegocio" type="color" value="${config.color || "#0d6efd"}" oninput="previewColorConfiguracion(); renderVistaPreviaTicket();">
 </label>
 <label>
 <span>Logo</span>
 <input id="configLogoNegocio" type="file" accept="image/*" onchange="cargarLogoConfiguracionSistema(event); renderVistaPreviaTicket();">
 </label>
 </div>
 <div class="config-theme-preview">
 <div>
 <strong>Vista rapida</strong>
 <span>El color se aplica a botones, menu, acentos y tarjetas.</span>
 </div>
 <button type="button">Boton principal</button>
 </div>
 <div class="config-actions-stack config-actions-row">
 <button type="button" onclick="cambiarModo()">Cambiar claro / oscuro</button>
 <button type="button" onclick="restaurarLogoConfiguracion(); renderVistaPreviaTicket();">Quitar logo</button>
 </div>
 </section>
 </div>

 <div class="config-tab-panel" data-config-panel="ticket">
 <div class="config-ticket-layout">
 <section class="config-panel">
 <h3>Diseno del ticket</h3>
 <div class="config-form-grid">
 <label>
 <span>Ancho</span>
 <select id="configTicketAncho" onchange="renderVistaPreviaTicket()">
 <option value="80" ${config.ticketAncho === "58" ? "" : "selected"}>80 mm</option>
 <option value="58" ${config.ticketAncho === "58" ? "selected" : ""}>58 mm</option>
 </select>
 </label>
 <label>
 <span>Alineacion encabezado</span>
 <select id="configTicketAlineacion" onchange="renderVistaPreviaTicket()">
 <option value="center" ${config.ticketAlineacion === "left" ? "" : "selected"}>Centrado</option>
 <option value="left" ${config.ticketAlineacion === "left" ? "selected" : ""}>Izquierda</option>
 </select>
 </label>
 <label>
 <span>Nombre en ticket</span>
 <input id="configTicketNombre" value="${config.ticketNombre || config.nombre || ""}" oninput="renderVistaPreviaTicket()">
 </label>
 <label>
 <span>Subtitulo</span>
 <input id="configTicketSubtitulo" value="${config.ticketSubtitulo || config.slogan || ""}" oninput="renderVistaPreviaTicket()">
 </label>
 <label>
 <span>Mensaje final</span>
 <input id="configMensajeTicket" value="${config.mensajeTicket || "Gracias por su compra"}" oninput="renderVistaPreviaTicket()">
 </label>
 <label>
 <span>Nota extra</span>
 <input id="configNotaTicket" value="${config.notaTicket || ""}" placeholder="Cambios solo con ticket, garantia, etc." oninput="renderVistaPreviaTicket()">
 </label>
 </div>

 <div class="ticket-options-grid">
 <label class="config-check"><input id="configMostrarLogoTicket" type="checkbox" ${config.mostrarLogoTicket === false ? "" : "checked"} onchange="renderVistaPreviaTicket()"> Logo</label>
 <label class="config-check"><input id="configMostrarNombreTicket" type="checkbox" ${config.mostrarNombreTicket === false ? "" : "checked"} onchange="renderVistaPreviaTicket()"> Nombre</label>
 <label class="config-check"><input id="configMostrarDireccionTicket" type="checkbox" ${config.mostrarDireccionTicket === false ? "" : "checked"} onchange="renderVistaPreviaTicket()"> Direccion</label>
 <label class="config-check"><input id="configMostrarTelefonoTicket" type="checkbox" ${config.mostrarTelefonoTicket === false ? "" : "checked"} onchange="renderVistaPreviaTicket()"> Telefono</label>
 <label class="config-check"><input id="configMostrarCajeroTicket" type="checkbox" ${config.mostrarCajeroTicket === false ? "" : "checked"} onchange="renderVistaPreviaTicket()"> Cajero</label>
 <label class="config-check"><input id="configMostrarBarcodeTicket" type="checkbox" ${config.mostrarBarcodeTicket === true ? "checked" : ""} onchange="renderVistaPreviaTicket()"> Codigo de barras</label>
 </div>
 </section>

 <aside class="config-panel ticket-preview-panel">
 <div>
 <h3>Vista previa</h3>
 <span>Asi se vera impreso el comprobante.</span>
 </div>
 <div id="ticketPreview" class="ticket-preview"></div>
 </aside>
 </div>
 </div>

 <div class="config-tab-panel" data-config-panel="hardware">
 <section class="config-panel config-hardware-panel">
 <div class="config-panel-head">
 <div>
 <h3>Impresora y cajon</h3>
 <span>Preparado para impresora termica 80 mm y cajon conectado a la impresora.</span>
 </div>
 <button type="button" onclick="cargarImpresorasPOS()">Buscar impresoras</button>
 </div>
 <div class="config-form-grid">
 <label>
 <span>Impresora</span>
 <select id="configImpresoraNombre">
 <option value="">Predeterminada del sistema</option>
 ${config.impresoraNombre ? `<option value="${config.impresoraNombre}" selected>${config.impresoraNombre}</option>` : ""}
 </select>
 </label>
 <label>
 <span>Copias del ticket</span>
 <input id="configTicketCopias" type="number" min="1" max="3" value="${config.ticketCopias || 1}">
 </label>
 </div>
 <div class="ticket-options-grid hardware-options-grid">
 <label class="config-check"><input id="configImpresionSilenciosa" type="checkbox" ${config.impresionSilenciosa === true ? "checked" : ""}> Impresion silenciosa</label>
 <label class="config-check"><input id="configImprimirAutomatico" type="checkbox" ${config.imprimirAutomatico === false ? "" : "checked"}> Imprimir al cobrar</label>
 <label class="config-check"><input id="configAbrirCajonDespuesTicket" type="checkbox" ${config.abrirCajonDespuesTicket === true ? "checked" : ""}> Abrir cajon al imprimir</label>
 <label class="config-check"><input id="configAbrirCajonPrueba" type="checkbox" ${config.abrirCajonPrueba === true ? "checked" : ""}> Abrir cajon en prueba</label>
 <label class="config-check"><input id="configCortarPapelTicket" type="checkbox" ${config.cortarPapelTicket === false ? "" : "checked"}> Cortar papel</label>
 </div>
 <div class="config-actions-stack config-actions-row hardware-actions">
 <button type="button" onclick="imprimirTicketPruebaPOS()">Impresion de prueba</button>
 <button type="button" onclick="abrirCajonPruebaPOS()">Abrir cajon</button>
 </div>
 <div class="config-note" id="estadoHardwarePOS">
 En navegador se abrira el dialogo de impresion. En la app de escritorio se puede imprimir directo y mandar pulso al cajon.
 </div>
 </section>
 </div>

 <div class="config-tab-panel" data-config-panel="usuarios">
 <section class="config-panel">
 <h3>Usuarios y permisos</h3>
 <div class="config-users-list">
 ${opcionesUsuariosConfiguracion()}
 </div>
 <button type="button" onclick="abrirNuevoUsuarioSistema()">Nuevo usuario</button>
 </section>
 </div>

 <div class="config-tab-panel" data-config-panel="sistema">
 <section class="config-panel">
 <h3>Operacion</h3>
 <div class="config-form-grid">
 <label>
 <span>Moneda</span>
 <input id="configMoneda" value="${config.moneda || "MXN"}" oninput="renderVistaPreviaTicket()">
 </label>
 <label>
 <span>Giro del negocio</span>
 <select id="configGiroNegocio">
 ${Object.entries(PLANTILLAS_GIRO_NEGOCIO).map(([clave, plantilla]) => `
 <option value="${clave}" ${(config.giroNegocio || "ferreteria") === clave ? "selected" : ""}>
 ${plantilla.nombre}
 </option>
 `).join("")}
 </select>
 </label>
 <label>
 <span>Sucursal</span>
 <input id="configSucursal" value="${config.sucursal || ""}">
 </label>
 <label>
 <span>Duracion de sesion</span>
 <select id="configDuracionSesion">
 <option value="0" ${duracionSesionHoras(config) === 0 ? "selected" : ""}>Pedir PIN cada vez</option>
 <option value="8" ${duracionSesionHoras(config) === 8 ? "selected" : ""}>8 horas</option>
 <option value="12" ${duracionSesionHoras(config) === 12 ? "selected" : ""}>12 horas</option>
 <option value="24" ${duracionSesionHoras(config) === 24 ? "selected" : ""}>1 dia</option>
 <option value="72" ${duracionSesionHoras(config) === 72 ? "selected" : ""}>3 dias</option>
 <option value="168" ${duracionSesionHoras(config) === 168 ? "selected" : ""}>1 semana</option>
 </select>
 </label>
 </div>
 <div class="config-note">
 Estos datos se guardan en esta computadora y se usan para inicio, menu, ticket y apariencia.
 </div>
 <div class="config-note config-giro-note">
 <strong>Plantilla comercial</strong>
 <span>El giro prepara categorias y unidades recomendadas. Sirve para ferreteria, abarrotes, papeleria, vinateria o negocios generales.</span>
 <button type="button" onclick="aplicarPlantillaGiroConfiguracion()">Aplicar categorias sugeridas</button>
 </div>
 <div class="config-danger-zone">
 <div>
 <strong>Restablecer configuracion inicial</strong>
 <span>Vuelve a mostrar la pantalla donde se captura nombre, logo, color y administrador. No borra inventario, ventas, clientes ni catalogos.</span>
 </div>
 <button type="button" onclick="restablecerConfiguracionInicial()">
 Restablecer inicio
 </button>
 </div>
 </section>
 </div>
 </div>
 `;

 pantalla.style.display = "block";
 renderVistaPreviaTicket();
 cargarImpresorasPOS({ silencioso: true });
}

function renderVistaPreviaTicket() {
 const preview =
 document.getElementById("ticketPreview");

 if (!preview) return;

 const config =
 valorTicketFormulario();

 const anchoClase =
 config.ticketAncho === "58" ? "ticket-58" : "ticket-80";

 const logo =
 config.logo && config.mostrarLogoTicket
 ? `<img src="${config.logo}" alt="Logo">`
 : "";

 const nombre =
 config.mostrarNombreTicket
 ? `<h4>${config.ticketNombre || config.nombre || "Ferreteria Olimpico"}</h4>`
 : "";

 const subtitulo =
 config.ticketSubtitulo
 ? `<p>${config.ticketSubtitulo}</p>`
 : "";

 const direccion =
 config.mostrarDireccionTicket && config.direccion
 ? `<p>${config.direccion}</p>`
 : "";

 const telefono =
 config.mostrarTelefonoTicket && config.telefono
 ? `<p>Tel. ${config.telefono}</p>`
 : "";

 const cajero =
 config.mostrarCajeroTicket
 ? `<p>Cajero: ${usuarioActual?.nombre || "Administrador"}</p>`
 : "";

 const barcode =
 config.mostrarBarcodeTicket
 ? `<div class="ticket-barcode">|||| ||| |||| || |||||</div>`
 : "";

 preview.className =
 `ticket-preview ${anchoClase}`;

 preview.innerHTML = `
 <div class="ticket-paper" style="text-align:${config.ticketAlineacion || "center"}">
 ${logo ? `<div class="ticket-logo">${logo}</div>` : ""}
 ${nombre}
 ${subtitulo}
 ${direccion}
 ${telefono}
 ${cajero}
 <div class="ticket-rule"></div>
 <div class="ticket-row"><span>Martillo una</span><strong>$120.00</strong></div>
 <div class="ticket-row"><span>Tornillo 1/2 x 50</span><strong>$50.00</strong></div>
 <div class="ticket-row"><span>Pintura blanca</span><strong>$250.00</strong></div>
 <div class="ticket-rule"></div>
 <div class="ticket-row total"><span>TOTAL</span><strong>$420.00</strong></div>
 <div class="ticket-row"><span>Recibido</span><strong>$500.00</strong></div>
 <div class="ticket-row cambio"><span>Cambio</span><strong>$80.00</strong></div>
 <div class="ticket-rule"></div>
 <strong>${config.mensajeTicket || "Gracias por su compra"}</strong>
 ${config.notaTicket ? `<p>${config.notaTicket}</p>` : ""}
 ${barcode}
 </div>
 `;
}

function actualizarEstadoHardwarePOS(mensaje, tipo = "info") {
 const estado =
 document.getElementById("estadoHardwarePOS");

 if (!estado) return;

 estado.textContent = mensaje;
 estado.dataset.estado = tipo;
}

async function cargarImpresorasPOS(opciones = {}) {
 const select =
 document.getElementById("configImpresoraNombre");

 if (!select) return;

 const actual =
 select.value || configuracionNegocio()?.impresoraNombre || "";

 if (!window.nexoDesktop || typeof window.nexoDesktop.listPrinters !== "function") {
  if (!opciones.silencioso) {
   actualizarEstadoHardwarePOS("Listado disponible solo en la app de escritorio. Se usara la impresora predeterminada del sistema.", "info");
  }
  return;
 }

 try {
  const resultado =
  await window.nexoDesktop.listPrinters();

  const impresoras =
  Array.isArray(resultado?.printers)
  ? resultado.printers
  : [];

  select.innerHTML =
  '<option value="">Predeterminada del sistema</option>' +
  impresoras.map(impresora => {
   const nombre =
   String(impresora.name || "");

   return `<option value="${nombre.replace(/"/g, "&quot;")}" ${nombre === actual ? "selected" : ""}>${nombre}${impresora.isDefault ? " (predeterminada)" : ""}</option>`;
  }).join("");

  if (actual && !impresoras.some(impresora => impresora.name === actual)) {
   select.insertAdjacentHTML(
   "beforeend",
   `<option value="${actual.replace(/"/g, "&quot;")}" selected>${actual}</option>`
   );
  }

  if (!opciones.silencioso) {
   actualizarEstadoHardwarePOS(
   impresoras.length
   ? `Se encontraron ${impresoras.length} impresoras.`
   : "No se encontraron impresoras instaladas.",
   impresoras.length ? "exito" : "alerta"
   );
  }
 } catch (error) {
  console.warn("No se pudieron listar impresoras", error);
  if (!opciones.silencioso) {
   actualizarEstadoHardwarePOS("No se pudieron leer las impresoras instaladas.", "alerta");
  }
 }
}

function opcionesImpresionPOS(config = configuracionNegocio() || {}) {
 return {
  printerName: config.impresoraNombre || "",
  silent: config.impresionSilenciosa === true,
  copies: Math.max(1, Number(config.ticketCopias || 1) || 1),
  openCashDrawer: config.abrirCajonDespuesTicket === true,
  cutPaper: config.cortarPapelTicket !== false,
  width: config.ticketAncho === "58" ? 58 : 80
 };
}

function ticketPruebaPOS() {
 const config =
 valorTicketFormulario();

 const fecha =
 new Date().toLocaleString("es-MX");

 return `
 <div style="width:${config.ticketAncho === "58" ? 230 : 300}px;font-family:monospace;padding:20px;color:black;text-align:${config.ticketAlineacion || "center"};">
 ${config.logo && config.mostrarLogoTicket ? `<img src="${config.logo}" style="width:58px;height:58px;object-fit:cover;border-radius:10px;margin-bottom:8px;">` : ""}
 ${config.mostrarNombreTicket ? `<h2 style="margin:0;font-size:22px;text-transform:uppercase;">${config.ticketNombre || config.nombre || "Ferreteria Olimpico"}</h2>` : ""}
 ${config.ticketSubtitulo ? `<div style="font-size:12px;">${config.ticketSubtitulo}</div>` : ""}
 ${config.mostrarDireccionTicket && config.direccion ? `<div>${config.direccion}</div>` : ""}
 ${config.mostrarTelefonoTicket && config.telefono ? `<div>Tel. ${config.telefono}</div>` : ""}
 <div>${fecha}</div>
 <hr>
 <div style="text-align:left;font-weight:bold;">PRUEBA DE IMPRESION</div>
 <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Ticket termico 80 mm</span><span>OK</span></div>
 <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Conexion cajon</span><span>${config.abrirCajonPrueba ? "Pulso" : "Sin pulso"}</span></div>
 <hr>
 <div style="font-weight:bold;">${config.mensajeTicket || "Gracias por su compra"}</div>
 ${config.notaTicket ? `<br><small>${config.notaTicket}</small>` : ""}
 </div>
 `;
}

async function imprimirTicketPruebaPOS() {
 const config =
 valorTicketFormulario();

 const nuevaConfig = {
  ...(configuracionNegocio() || {}),
  ...config,
  abrirCajonDespuesTicket: config.abrirCajonPrueba === true
 };

 localStorage.setItem(CONFIG_NEGOCIO_KEY, JSON.stringify(nuevaConfig));
 aplicarConfiguracionNegocio(nuevaConfig);

 const ok =
 await imprimirTicketPOS(ticketPruebaPOS(), nuevaConfig);

 actualizarEstadoHardwarePOS(
 ok
 ? "Prueba enviada a la impresora."
 : "No se pudo enviar la prueba. Revisa la impresora seleccionada.",
 ok ? "exito" : "alerta"
 );
}

async function abrirCajonPruebaPOS() {
 const config =
 valorTicketFormulario();

 if (window.nexoDesktop && typeof window.nexoDesktop.openCashDrawer === "function") {
  const resultado =
  await window.nexoDesktop.openCashDrawer({
   printerName: config.impresoraNombre || ""
  }).catch(error => ({ ok: false, error: error.message }));

  actualizarEstadoHardwarePOS(
  resultado?.ok
  ? "Pulso enviado al cajon."
  : (resultado?.error || "No se pudo abrir el cajon."),
  resultado?.ok ? "exito" : "alerta"
  );
  return;
 }

 actualizarEstadoHardwarePOS("El pulso del cajon requiere la app de escritorio.", "alerta");
}

function guardarConfiguracionSistema() {
 const actual =
 configuracionNegocio() || {};

 const nombre =
 valorConfigCampo("configNombreNegocio", actual.nombre || "").trim();

 if (!nombre) {
 alert("El nombre del negocio es obligatorio");
 return;
 }

 const datosPantalla =
 valorTicketFormulario(actual);

 const nuevaConfig = {
 ...actual,
 ...datosPantalla,
 nombre,
 logo: logoConfiguracionTemporal !== null
 ? logoConfiguracionTemporal
 : actual.logo,
 actualizada: new Date().toISOString()
 };

 localStorage.setItem(
 CONFIG_NEGOCIO_KEY,
 JSON.stringify(nuevaConfig)
 );

 logoConfiguracionTemporal = null;
 aplicarConfiguracionNegocio(nuevaConfig);
 mostrarConfiguracion();
 alert("Configuracion guardada");
}

async function restablecerConfiguracionInicial() {
 if (!usuarioActual || usuarioActual.rol !== "Administrador") {
 alert("Solo un administrador puede restablecer la configuracion inicial");
 return;
 }

 const confirmar =
 await confirmarPOS(
 "Vas a volver a la pantalla de configuracion inicial. No se borran inventario, ventas, clientes ni catalogos.",
 "Restablecer inicio",
 "peligro"
 );

 if (!confirmar) return;

 const confirmarFinal =
 await confirmarPOS(
 "Confirma otra vez: se reiniciaran datos de empresa, logo, tema de marca y usuarios de acceso.",
 "Confirmacion final",
 "peligro"
 );

 if (!confirmarFinal) return;

 const pinCorrecto =
 await pedirPinUsuario(usuarioActual);

 if (!pinCorrecto) return;

 localStorage.removeItem(CONFIG_NEGOCIO_KEY);
 localStorage.removeItem("usuariosSistema");
 localStorage.removeItem("usuarioActualSistema");
 localStorage.removeItem(SESION_POS_KEY);

 usuarioActual = null;
 logoConfiguracionTemporal = null;

 document.getElementById("sistema").style.display =
 "none";

 document.getElementById("login").style.display =
 "none";

 document.getElementById("configuracionInicial").style.display =
 "flex";

 const preview =
 document.getElementById("previewLogoNegocio");

 if (preview) {
 preview.textContent = "POS";
 }

 [
 "setupNombreNegocio",
 "setupSloganNegocio",
 "setupTelefonoNegocio",
 "setupDireccionNegocio",
 "setupAdminNombre",
 "setupAdminPin"
 ].forEach(id => {
 const campo =
 document.getElementById(id);

 if (campo) {
 campo.value = "";
 }
 });

 const color =
 document.getElementById("setupColorNegocio");

 if (color) {
 color.value = "#0d6efd";
 document.documentElement.style.setProperty("--brand-color", "#0d6efd");
 }

 setTimeout(() => {
 document.getElementById("setupNombreNegocio")?.focus();
 }, 50);
}

function permisosTodos(valor = true) {
 return MODULOS_SISTEMA.reduce((permisos, modulo) => {
 permisos[modulo.clave] = valor;
 return permisos;
 }, {});
}

function widgetsTodos(valor = true) {
 return WIDGETS_DASHBOARD.reduce((widgets, widget) => {
 widgets[widget.clave] = valor;
 return widgets;
 }, {});
}

function plantillaUsuario(rol) {
 if (rol === "Cajero") {
 return {
 permisos: {
 ...permisosTodos(false),
 inicio: true,
 puntoVenta: true,
 inventarioBajo: true,
 clientes: true
 },
 widgets: {
 ...widgetsTodos(false),
 ventas: true,
 credito: true,
 ultimasVentas: true
 }
 };
 }

 if (rol === "Inventario") {
 return {
 permisos: {
 ...permisosTodos(false),
 inicio: true,
 inventario: true,
 inventarioBajo: true,
 proveedores: true,
 catalogo: true
 },
 widgets: {
 ...widgetsTodos(false),
 productos: true,
 inventarioBajo: true,
 alertas: true
 }
 };
 }

 return {
 permisos: permisosTodos(true),
 widgets: widgetsTodos(true)
 };
}

function usuariosSistema() {
 try {
 const usuarios =
 JSON.parse(localStorage.getItem("usuariosSistema") || "[]");

 return Array.isArray(usuarios) ? usuarios : [];
 } catch (error) {
 return [];
 }
}

function guardarUsuariosSistema(usuarios) {
 localStorage.setItem(
 "usuariosSistema",
 JSON.stringify(usuarios)
 );
}

function asegurarUsuariosSistema() {
 let usuarios =
 usuariosSistema();

 if (usuarios.length === 0) {
 const admin =
 plantillaUsuario("Administrador");

 const caja =
 plantillaUsuario("Cajero");

 usuarios = [
 {
 id: "admin",
 nombre: "Gustavo",
 rol: "Administrador",
 pin: "1234",
 permisos: admin.permisos,
 widgets: admin.widgets
 },
 {
 id: "caja",
 nombre: "Caja",
 rol: "Cajero",
 pin: "0000",
 permisos: caja.permisos,
 widgets: caja.widgets
 }
 ];

 guardarUsuariosSistema(usuarios);
 }

 let actualizado = false;

 usuarios.forEach(usuario => {
 if (!usuario.permisos) {
 usuario.permisos = permisosTodos(usuario.rol === "Administrador");
 actualizado = true;
 }

 if (usuario.permisos.configuracion === undefined) {
 usuario.permisos.configuracion =
 usuario.rol === "Administrador";
 actualizado = true;
 }

 MODULOS_SISTEMA.forEach(modulo => {
 if (usuario.permisos[modulo.clave] === undefined) {
 usuario.permisos[modulo.clave] =
 usuario.rol === "Administrador";
 actualizado = true;
 }
 });

 if (!usuario.widgets) {
 usuario.widgets = widgetsTodos(true);
 actualizado = true;
 }
 });

 if (actualizado) {
 guardarUsuariosSistema(usuarios);
 }

 return usuarios;
}

function normalizarTexto(texto) {
 return String(texto || "")
 .toLowerCase()
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g, "")
 .trim();
}

function puedeEntrar(modulo) {
 if (!usuarioActual) return true;
 if (usuarioActual.rol === "Administrador") return true;
 return usuarioActual.permisos?.[modulo] !== false;
}

function configurarMenuPorModulos() {
 const botones =
 document.querySelectorAll(".sidebar button");

 botones.forEach(boton => {
 const moduloShell = boton.dataset.shellModule || moduloDesdeEtiquetaPOS(boton.dataset.navLabel || boton.textContent);
 const moduloPermiso = {
  inicio: "inicio",
  venta: "puntoVenta",
  inventario: "inventario",
  productos: "inventario",
  categorias: "inventario",
  "inventario-bajo": "inventarioBajo",
  reportes: "reportes",
  clientes: "clientes",
  proveedores: "proveedores",
  catalogo: "catalogo",
  recepcion: "inventario",
  caja: "reportes",
  finanzas: "reportes",
  pedidos: "proveedores",
  ajustes: "inventario",
  dueno: "reportes",
  configuracion: "configuracion"
 }[moduloShell] || moduloShell;

 boton.dataset.permModulo = moduloPermiso;

 if (moduloPermiso !== "configuracion" && !boton.dataset.ocultaConfig) {
 boton.dataset.ocultaConfig = "1";
 boton.addEventListener("click", () => {
 const pantalla =
 document.getElementById("pantallaConfiguracion");

 if (pantalla) {
 pantalla.style.display = "none";
 }
 });
 }
 });

 const botonConfiguracion =
 document.querySelector(".btn-configuracion-sidebar");

 if (botonConfiguracion) {
 botonConfiguracion.dataset.permModulo = "configuracion";
 }
}

function asignarWidgetsDashboard() {
 const mapa = [
 ["totalProductos", "productos"],
 ["totalBajos", "inventarioBajo"],
 ["conteoVentas", "ventas"],
 ["creditoPendiente", "credito"],
 ["inventarioBajo", "alertas"],
 ["ultimasVentas", "ultimasVentas"]
 ];

 mapa.forEach(([id, widget]) => {
 const elemento =
 document.getElementById(id);

 const caja =
 elemento?.closest(".caja");

 if (caja) {
 caja.dataset.widget = widget;
 }
 });
}

function aplicarPermisosUsuario() {
 configurarMenuPorModulos();

 document
 .querySelectorAll(".sidebar button[data-modulo]")
 .forEach(boton => {
 const modulo =
 boton.dataset.permModulo || boton.dataset.modulo;

 if (modulo === "configuracion") {
 boton.style.display = "";
 return;
 }

 boton.style.display =
 puedeEntrar(modulo) ? "" : "none";
 });

 aplicarWidgetsDashboard();
}

function aplicarWidgetsDashboard() {
 asignarWidgetsDashboard();

 document
 .querySelectorAll("[data-widget]")
 .forEach(caja => {
 const widget =
 caja.dataset.widget;

 const visible =
 usuarioActual?.widgets?.[widget] !== false;

 caja.style.display =
 visible ? "" : "none";
 });
}

function aplicarSesionUsuario(usuario) {
 usuarioActual = usuario;

 localStorage.setItem(
 "usuarioActualSistema",
 usuario.id
 );

 document.getElementById("saludoUsuario").textContent =
 `Bienvenido, ${usuario.nombre}`;

 renderSelectorUsuario();
 renderPanelUsuariosDashboard();
 aplicarPermisosUsuario();
}

function duracionSesionHoras(config = configuracionNegocio() || {}) {
 const horas =
 Number(config.duracionSesionHoras);

 if (!Number.isFinite(horas) || horas < 0) {
 return 12;
 }

 return horas;
}

function guardarSesionPersistente(usuario) {
 const horas =
 duracionSesionHoras();

 if (!horas) {
 localStorage.removeItem(SESION_POS_KEY);
 return;
 }

 localStorage.setItem(
 SESION_POS_KEY,
 JSON.stringify({
 usuarioId: usuario.id,
 negocioSlug: negocioActivoSlug(),
 expira: Date.now() + horas * 60 * 60 * 1000
 })
 );
}

function leerSesionPersistente() {
 try {
 const sesion =
 JSON.parse(localStorage.getItem(SESION_POS_KEY) || "null");

 if (!sesion || !sesion.usuarioId || Date.now() > Number(sesion.expira)) {
 localStorage.removeItem(SESION_POS_KEY);
 return null;
 }

 return sesion;
 } catch (error) {
 localStorage.removeItem(SESION_POS_KEY);
 return null;
 }
}

async function entrarAlSistemaConUsuario(usuario) {
 document.getElementById("login").style.display =
 "none";

 document.getElementById("sistema").style.display =
 "block";

 aplicarSesionUsuario(usuario);
 actualizarBotonModo();

 await revisarLicenciaNexoPOS();

 await cargarProductos();

 cargarHistorial();

 actualizarDashboard();

 cargarCreditos()
 .catch(error => {
 console.log(
 "Error cargando creditos:",
 error
 );
 });

 aplicarWidgetsDashboard();
}

async function intentarRestaurarSesion() {
 const sesion =
 leerSesionPersistente();

 if (!sesion) return false;

 if (sesion.negocioSlug) {
 guardarNegocioActivo(sesion.negocioSlug);
 }

 const usuario =
 asegurarUsuariosSistema()
 .find(item => item.id === sesion.usuarioId);

 if (!usuario) {
 localStorage.removeItem(SESION_POS_KEY);
 return false;
 }

 await entrarAlSistemaConUsuario(usuario);
 return true;
}

function asegurarPanelVentasDashboard() {
 const dashboardTop =
 document.querySelector("#pantallaInicio .dashboard-top");

 if (!dashboardTop) return;

 let contenedor =
 document.getElementById("dashboardMainGrid");

 if (!contenedor) {
 contenedor = document.createElement("div");
 contenedor.id = "dashboardMainGrid";
 contenedor.className = "dashboard-main-grid";
 dashboardTop.insertAdjacentElement("afterend", contenedor);
 }

 let panel =
 document.getElementById("dashboardVentasDia");

 if (!panel) {
 panel = document.createElement("div");

 panel.id = "dashboardVentasDia";
 panel.className = "dashboard-ventas-dia";
 panel.dataset.widget = "ventas";
 panel.innerHTML = `
 <div class="dashboard-chart-card">
 <div class="dashboard-card-head">
 <div>
 <span>Ventas del dia</span>
 <h2 id="ventasHoyMonto">$0.00</h2>
 </div>
 <strong id="ventasHoyEstado" class="estado-positivo">+0%</strong>
 </div>
 <canvas id="graficaDashboardVentas"></canvas>
 </div>

 <div class="dashboard-pulso">
 <div>
 <span>Transacciones hoy</span>
 <strong id="ventasHoyConteo">0</strong>
 </div>
 <div>
 <span>Ticket promedio</span>
 <strong id="ticketPromedioHoy">$0.00</strong>
 </div>
 <div>
 <span>Venta mas alta</span>
 <strong id="ventaAltaHoy">$0.00</strong>
 </div>
 </div>
 `;
 }

 contenedor.appendChild(panel);

 const alertas =
 document.getElementById("inventarioBajo")?.closest(".caja");

 const ultimas =
 document.getElementById("ultimasVentas")?.closest(".caja");

 [alertas, ultimas].forEach(caja => {
 if (!caja) return;
 caja.classList.add("dashboard-side-card");
 contenedor.appendChild(caja);
 });

 aplicarWidgetsDashboard();
}

function renderSelectorUsuario() {
 const contenedor =
 document.getElementById("rolUsuario");

 if (!contenedor || !usuarioActual) return;

 const usuarios =
 asegurarUsuariosSistema();

 contenedor.innerHTML = `
 <span class="usuario-rol-pill">${usuarioActual.rol}</span>
 <div class="usuario-switch">
 <select id="selectorUsuarioActivo" onchange="cambiarUsuarioActivo()">
 ${usuarios.map(usuario => `
 <option value="${usuario.id}" ${usuario.id === usuarioActual.id ? "selected" : ""}>
 ${usuario.nombre}
 </option>
 `).join("")}
 </select>
 ${
 usuarioActual.rol === "Administrador"
 ? `<button type="button" onclick="togglePanelUsuarios()">Usuarios</button>`
 : ""
 }
 </div>
 `;
}

async function cambiarUsuarioActivo() {
 const selector =
 document.getElementById("selectorUsuarioActivo");

 const usuarios =
 asegurarUsuariosSistema();

 const usuario =
 usuarios.find(item => item.id === selector.value);

 if (!usuario) return;

 const autorizado =
 await pedirPinUsuario(usuario);

 if (!autorizado) {
 selector.value = usuarioActual.id;
 return;
 }

 aplicarSesionUsuario(usuario);
 mostrarInicio();
}

async function pedirPinUsuario(usuario) {
 const datos =
 await abrirFormularioCredito({
 titulo: `Entrar como ${usuario.nombre}`,
 subtitulo: "Escribe el PIN de este usuario",
 campos: [
 {
 nombre: "pin",
 etiqueta: "PIN o contrasena",
 tipo: "password",
 requerido: true
 }
 ]
 });

 if (!datos) return false;

 if (String(datos.pin) !== String(usuario.pin)) {
 alert("PIN incorrecto");
 return false;
 }

 return true;
}

function asegurarPanelUsuariosDashboard() {
 if (document.getElementById("panelUsuariosDashboard")) return;

 const header =
 document.querySelector("#pantallaInicio .dashboard-header");

 if (!header) return;

 const panel =
 document.createElement("div");

 panel.id = "panelUsuariosDashboard";
 panel.className = "panel-usuarios-dashboard";
 panel.style.display = "none";

 header.insertAdjacentElement("afterend", panel);
}

function togglePanelUsuarios() {
 asegurarPanelUsuariosDashboard();

 const panel =
 document.getElementById("panelUsuariosDashboard");

 if (!panel) return;

 panel.style.display =
 panel.style.display === "none" ? "block" : "none";

 renderPanelUsuariosDashboard();
}

function renderPanelUsuariosDashboard() {
 asegurarPanelUsuariosDashboard();

 const panel =
 document.getElementById("panelUsuariosDashboard");

 if (!panel) return;

 if (usuarioActual?.rol !== "Administrador") {
 panel.style.display = "none";
 return;
 }

 const usuarios =
 asegurarUsuariosSistema();

 panel.innerHTML = `
 <div class="panel-usuarios-head">
 <div>
 <h2>Usuarios y permisos</h2>
 <p>Controla quien trabaja, que modulos ve y que tarjetas aparecen en inicio.</p>
 </div>
 <button type="button" onclick="abrirNuevoUsuarioSistema()">+ Nuevo usuario</button>
 </div>

 <div class="usuarios-grid">
 ${usuarios.map(usuario => `
 <div class="usuario-card ${usuario.id === usuarioActual.id ? "activo" : ""}">
 <div>
 <strong>${usuario.nombre}</strong>
 <span>${usuario.rol}</span>
 </div>
 <small>${resumenPermisosUsuario(usuario)}</small>
 <div class="usuario-card-acciones">
 <button type="button" onclick="abrirPermisosUsuario('${usuario.id}')">Permisos</button>
 <button type="button" onclick="cambiarPinUsuario('${usuario.id}')">PIN</button>
 ${
 usuario.id !== "admin"
 ? `<button type="button" onclick="eliminarUsuarioSistema('${usuario.id}')">Eliminar</button>`
 : ""
 }
 </div>
 </div>
 `).join("")}
 </div>
 `;
}

function resumenPermisosUsuario(usuario) {
 const modulos =
 MODULOS_SISTEMA.filter(modulo =>
 usuario.rol === "Administrador" ||
 usuario.permisos?.[modulo.clave] !== false
 ).length;

 const widgets =
 WIDGETS_DASHBOARD.filter(widget =>
 usuario.widgets?.[widget.clave] !== false
 ).length;

 return `${modulos} modulos activos - ${widgets} tarjetas de inicio`;
}

async function abrirNuevoUsuarioSistema() {
 const datos =
 await abrirFormularioCredito({
 titulo: "Nuevo usuario",
 subtitulo: "Crea un acceso para caja, inventario o administracion",
 campos: [
 {
 nombre: "nombre",
 etiqueta: "Nombre",
 placeholder: "Ej. Luis",
 requerido: true
 },
 {
 nombre: "rol",
 etiqueta: "Rol",
 tipo: "select",
 opciones: [
 { valor: "Cajero", etiqueta: "Cajero" },
 { valor: "Inventario", etiqueta: "Inventario" },
 { valor: "Administrador", etiqueta: "Administrador" }
 ],
 requerido: true
 },
 {
 nombre: "pin",
 etiqueta: "PIN o contrasena",
 tipo: "password",
 requerido: true
 }
 ]
 });

 if (!datos) return;

 const plantilla =
 plantillaUsuario(datos.rol);

 const usuarios =
 asegurarUsuariosSistema();

 usuarios.push({
 id: `usuario-${Date.now()}`,
 nombre: datos.nombre,
 rol: datos.rol,
 pin: datos.pin,
 permisos: plantilla.permisos,
 widgets: plantilla.widgets
 });

 guardarUsuariosSistema(usuarios);
 renderSelectorUsuario();
 renderPanelUsuariosDashboard();
}

async function cambiarPinUsuario(id) {
 const usuarios =
 asegurarUsuariosSistema();

 const usuario =
 usuarios.find(item => item.id === id);

 if (!usuario) return;

 const datos =
 await abrirFormularioCredito({
 titulo: `Cambiar PIN de ${usuario.nombre}`,
 subtitulo: "Guarda un PIN nuevo para este usuario",
 campos: [
 {
 nombre: "pin",
 etiqueta: "Nuevo PIN",
 tipo: "password",
 requerido: true
 }
 ]
 });

 if (!datos) return;

 usuario.pin = datos.pin;
 guardarUsuariosSistema(usuarios);
 renderPanelUsuariosDashboard();
}

function abrirPermisosUsuario(id) {
 const usuarios =
 asegurarUsuariosSistema();

 const usuario =
 usuarios.find(item => item.id === id);

 if (!usuario) return;

 let modal =
 document.getElementById("modalPermisosUsuario");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalPermisosUsuario";
 modal.className = "modal-permisos-usuario";
 document.body.appendChild(modal);
 }

 modal.innerHTML = `
 <div class="permisos-card">
 <div class="permisos-header">
 <div>
 <h2>${usuario.nombre}</h2>
 <p>Permisos de ${usuario.rol}</p>
 </div>
 <button type="button" onclick="cerrarPermisosUsuario()">Cerrar</button>
 </div>

 <div class="permisos-secciones">
 <section>
 <h3>Modulos del sistema</h3>
 ${MODULOS_SISTEMA.map(modulo => `
 <label class="permiso-check">
 <input
 type="checkbox"
 data-tipo="permisos"
 data-clave="${modulo.clave}"
 ${usuario.rol === "Administrador" || usuario.permisos?.[modulo.clave] !== false ? "checked" : ""}
 >
 <span>${modulo.nombre}</span>
 </label>
 `).join("")}
 </section>

 <section>
 <h3>Tarjetas del inicio</h3>
 ${WIDGETS_DASHBOARD.map(widget => `
 <label class="permiso-check">
 <input
 type="checkbox"
 data-tipo="widgets"
 data-clave="${widget.clave}"
 ${usuario.widgets?.[widget.clave] !== false ? "checked" : ""}
 >
 <span>${widget.nombre}</span>
 </label>
 `).join("")}
 </section>
 </div>

 <div class="permisos-acciones">
 <button type="button" onclick="cerrarPermisosUsuario()">Cancelar</button>
 <button type="button" onclick="guardarPermisosUsuario('${usuario.id}')">Guardar permisos</button>
 </div>
 </div>
 `;

 modal.style.display = "flex";
}

function cerrarPermisosUsuario() {
 const modal =
 document.getElementById("modalPermisosUsuario");

 if (modal) {
 modal.style.display = "none";
 }
}

function guardarPermisosUsuario(id) {
 const usuarios =
 asegurarUsuariosSistema();

 const usuario =
 usuarios.find(item => item.id === id);

 const modal =
 document.getElementById("modalPermisosUsuario");

 if (!usuario || !modal) return;

 usuario.permisos = permisosTodos(false);
 usuario.widgets = widgetsTodos(false);

 modal
 .querySelectorAll("input[type='checkbox']")
 .forEach(input => {
 usuario[input.dataset.tipo][input.dataset.clave] =
 input.checked;
 });

 guardarUsuariosSistema(usuarios);

 if (usuarioActual?.id === usuario.id) {
 aplicarSesionUsuario(usuario);
 }

 cerrarPermisosUsuario();
 renderPanelUsuariosDashboard();
}

async function eliminarUsuarioSistema(id) {
 const confirmar =
 await confirmarPOS(
 "Eliminar este usuario? Esta accion no afecta ventas ni inventario.",
 "Eliminar usuario",
 "peligro"
 );

 if (!confirmar) return;

 const usuarios =
 asegurarUsuariosSistema().filter(usuario => usuario.id !== id);

 guardarUsuariosSistema(usuarios);
 renderSelectorUsuario();
 renderPanelUsuariosDashboard();
}

function inicializarLoginUsuarios() {
 asegurarUsuariosSistema();
 aplicarConfiguracionNegocio(
 configuracionNegocio()
 );

 const usuarioGuardado =
 localStorage.getItem("usuarioActualSistema") || "admin";

 const usuario =
 document.getElementById("usuario");

 if (usuario && !usuario.value) {
 const encontrado =
 usuariosSistema().find(item => item.id === usuarioGuardado);

 usuario.value = encontrado?.nombre || "Gustavo";
 }

 ["usuario", "password"].forEach(id => {
 const campo =
 document.getElementById(id);

 if (!campo) return;

 campo.addEventListener("keydown", event => {
 if (event.key === "Enter") {
 iniciarSesion();
 }
 });
 });

 document.getElementById("password")?.focus();
}
const archivoCatalogo =
 document.getElementById("archivoCatalogo");

archivoCatalogo.addEventListener(
 "catalogo-antiguo-desactivado",
 function (e) {
 return;

 const archivo = e.target.files[0];

 if (!archivo) return;

 const lector = new FileReader();

 lector.onload = function (evento) {
 const texto = evento.target.result;

 localStorage.setItem(
 "catalogoProveedorCsv",
 texto
 );

 alert("Catalogo actualizado correctamente ");
 };

 lector.readAsText(archivo);
 }
);

archivoCatalogo.addEventListener(
 "change",
 function (e) {
 procesarArchivosCatalogo(e.target.files);
 }
);

function catalogosGuardados() {
 try {
 return JSON.parse(
 localStorage.getItem("catalogosProveedor") || "[]"
 );
 } catch (error) {
 return [];
 }
}

function plantillasCatalogoBase() {
 return [
 {
 id: "global-truper-csv",
 alcance: "global",
 giro: "Ferreteria",
 proveedor: "Truper",
 nombre: "Truper CSV oficial",
 mapeo: {
 codigoInterno: "codigo",
 claveProveedor: "clave",
 nombre: "descripcion",
 unidadVenta: "unidad",
 codigoBarras: "ean",
 costo: "precio distribuidor con IVA",
 medioMayoreo: "precio mayoreo con IVA",
 publico: "precio publico con IVA",
 marca: "Marca",
 categoria: "Descripcion SAT"
 }
 }
 ];
}

function plantillasCatalogoUsuario() {
 try {
 return JSON.parse(
 localStorage.getItem("plantillasCatalogo") || "[]"
 );
 } catch (error) {
 return [];
 }
}

function todasPlantillasCatalogo() {
 return [
 ...plantillasCatalogoBase(),
 ...plantillasCatalogoUsuario()
 ];
}

function guardarPlantillaCatalogo(plantilla) {
 const actuales =
 plantillasCatalogoUsuario();

 const id =
 plantilla.id ||
 `plantilla-${Date.now()}`;

 const nueva = {
 ...plantilla,
 id,
 alcance: "privada",
 fecha: new Date().toISOString()
 };

 const actualizadas = [
 nueva,
 ...actuales.filter(item => item.id !== id)
 ];

 localStorage.setItem(
 "plantillasCatalogo",
 JSON.stringify(actualizadas)
 );

 return nueva;
}

function normalizarNombreColumnaCatalogo(nombre) {
 return normalizarEncabezadoCatalogo(nombre);
}

function encabezadosCatalogo(csv) {
 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapa =
 detectarColumnasCatalogo(lineas);

 const indice =
 mapa.indice >= 0 ? mapa.indice : 0;

 return separarFilaCatalogo(lineas[indice] || "")
 .map((nombre, indiceColumna) => ({
 nombre: limpiarTextoCatalogo(nombre) || `Columna ${indiceColumna + 1}`,
 indice: indiceColumna
 }));
}

function buscarPlantillaPorProveedor(proveedor) {
 const texto =
 normalizarEncabezadoCatalogo(proveedor);

 return todasPlantillasCatalogo().find(plantilla =>
 normalizarEncabezadoCatalogo(plantilla.proveedor) === texto
 ) || null;
}

function indiceColumnaPorNombre(encabezados, nombre) {
 const buscado =
 normalizarNombreColumnaCatalogo(nombre);

 if (!buscado) return "";

 const encontrado =
 encabezados.find(columna =>
 normalizarNombreColumnaCatalogo(columna.nombre) === buscado
 );

 return encontrado ? encontrado.indice : "";
}

function mapeoDetectadoCatalogo(csv, plantilla = null) {
 const encabezados =
 encabezadosCatalogo(csv);

 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const detectado =
 detectarColumnasCatalogo(lineas).columnas || {};

 const desdePlantilla = {};

 if (plantilla?.mapeo) {
 Object.entries(plantilla.mapeo).forEach(([campo, columna]) => {
 desdePlantilla[campo] =
 indiceColumnaPorNombre(encabezados, columna);
 });
 }

 return {
 codigoInterno:
 desdePlantilla.codigoInterno !== undefined
 ? desdePlantilla.codigoInterno
 : (detectado.codigo ?? ""),
 claveProveedor:
 desdePlantilla.claveProveedor !== undefined
 ? desdePlantilla.claveProveedor
 : (detectado.codigoInterno ?? ""),
 nombre:
 desdePlantilla.nombre !== undefined
 ? desdePlantilla.nombre
 : (detectado.descripcion ?? detectado.nombre ?? ""),
 codigoBarras:
 desdePlantilla.codigoBarras !== undefined
 ? desdePlantilla.codigoBarras
 : (detectado.codigo ?? ""),
 unidadVenta:
 desdePlantilla.unidadVenta !== undefined
 ? desdePlantilla.unidadVenta
 : "",
 costo:
 desdePlantilla.costo !== undefined
 ? desdePlantilla.costo
 : (detectado.distribuidor ?? ""),
 medioMayoreo:
 desdePlantilla.medioMayoreo !== undefined
 ? desdePlantilla.medioMayoreo
 : (detectado.medioMayoreoIva ?? detectado.medioMayoreo ?? ""),
 publico:
 desdePlantilla.publico !== undefined
 ? desdePlantilla.publico
 : (detectado.publico ?? ""),
 marca:
 desdePlantilla.marca !== undefined
 ? desdePlantilla.marca
 : (detectado.marca ?? ""),
 categoria:
 desdePlantilla.categoria !== undefined
 ? desdePlantilla.categoria
 : (detectado.categoria ?? ""),
 ignorar: ""
 };
}

function guardarCatalogosProveedor(catalogos) {
 try {
 const catalogosListos =
 catalogos.map(prepararCatalogoParaGuardar);

 localStorage.removeItem("catalogoProveedorCsv");

 localStorage.setItem(
 "catalogosProveedor",
 JSON.stringify(catalogosListos)
 );

 localStorage.setItem(
 "catalogoProveedorCsv",
 catalogosListos[0]?.csv || ""
 );

 return true;
 } catch (error) {
 console.error("No se pudo guardar el catalogo", error);

 if (typeof alertaPOS === "function") {
 alertaPOS(
 "No se pudo guardar el catalogo porque el navegador se quedo sin espacio. Borra catalogos viejos o guarda menos archivos grandes por ahora.",
 "Catalogo no guardado",
 "error"
 );
 } else {
 alert("No se pudo guardar el catalogo porque el navegador se quedo sin espacio.");
 }

 return false;
 }
}

function ultimoProveedorCatalogo() {
 const catalogos =
 catalogosGuardados();

 return catalogos[0]?.proveedor || "";
}

function nombreProveedorDesdeArchivo(nombreArchivo) {
 return String(nombreArchivo || "Proveedor")
 .replace(/\.[^/.]+$/, "")
 .replace(/[-_]+/g, " ")
 .trim() || "Proveedor";
}

async function pedirNombreCatalogo(nombreArchivo) {
 const sugerido =
 nombreProveedorDesdeArchivo(nombreArchivo);

 const nombre =
 await pedirTextoPOS(
 "Nombre del proveedor o distribuidor de este catalogo:",
 sugerido,
 "Catalogo proveedor"
 );

 return nombre || sugerido;
}

function contarProductosCatalogo(csv) {
 return String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(linea => linea && linea.split(",").length > 2)
 .length;
}

async function abrirAsistenteCatalogo(archivo, csv) {
 const proveedorSugerido =
 nombreProveedorDesdeArchivo(archivo.name);

 const proveedor =
 await pedirTextoPOS(
 "Nombre del proveedor o distribuidor:",
 proveedorSugerido,
 "Catalogo proveedor"
 ) || proveedorSugerido;

 const plantilla =
 buscarPlantillaPorProveedor(proveedor);

 return abrirMapeoCatalogo({
 proveedor,
 archivo: archivo.name,
 csv,
 plantilla
 });
}

function opcionesColumnasCatalogo(encabezados, valorActual) {
 const opciones =
 [
 `<option value="">Ignorar / no usar</option>`,
 ...encabezados.map(columna => `
 <option value="${columna.indice}" ${String(valorActual) === String(columna.indice) ? "selected" : ""}>
 ${columna.nombre}
 </option>
 `)
 ];

 return opciones.join("");
}

async function abrirMapeoCatalogo({ proveedor, archivo, csv, plantilla }) {
 const encabezados =
 encabezadosCatalogo(csv);

 const mapeo =
 mapeoDetectadoCatalogo(csv, plantilla);

 const campos = [
 ["codigoBarras", "Codigo de barras"],
 ["codigoInterno", "Codigo interno"],
 ["claveProveedor", "Clave proveedor"],
 ["nombre", "Nombre / descripcion"],
 ["unidadVenta", "Unidad de venta"],
 ["costo", "Precio proveedor / costo"],
 ["medioMayoreo", "Precio medio mayoreo"],
 ["publico", "Precio publico"],
 ["marca", "Marca"],
 ["categoria", "Categoria"]
 ];

 const html =
 document.createElement("div");

 html.className =
 "catalogo-mapeo-modal";

 html.innerHTML = `
 <div class="catalogo-mapeo-card">
 <div class="catalogo-mapeo-head">
 <div>
 <span>Importador inteligente</span>
 <h2>${proveedor}</h2>
 <p>${archivo}</p>
 </div>
 <button type="button" id="cerrarMapeoCatalogo" class="modal-cerrar-x" aria-label="Cerrar mapeo">×</button>
 </div>

 <div class="catalogo-mapeo-grid">
 ${campos.map(([campo, etiqueta]) => `
 <label>
 <span>${etiqueta}</span>
 <select data-campo="${campo}">
 ${opcionesColumnasCatalogo(encabezados, mapeo[campo])}
 </select>
 </label>
 `).join("")}
 </div>

 <div class="catalogo-mapeo-preview">
 <h3>Vista previa</h3>
 <div id="previewMapeoCatalogo"></div>
 </div>

 <label class="catalogo-guardar-plantilla">
 <input type="checkbox" id="guardarPlantillaCatalogo" checked>
 Guardar plantilla para este proveedor
 </label>

 <div class="catalogo-mapeo-actions">
 <button type="button" id="cancelarMapeoCatalogo">Cancelar</button>
 <button type="button" id="confirmarMapeoCatalogo">Usar este mapeo</button>
 </div>
 </div>
 `;

 document.body.appendChild(html);

 const leerMapeo = () => {
 const resultado = {};

 html.querySelectorAll("[data-campo]").forEach(select => {
 resultado[select.dataset.campo] =
 select.value === "" ? "" : Number(select.value);
 });

 return resultado;
 };

 const renderPreview = () => {
 const resultado =
 leerMapeo();

 const muestra =
 productoPreviewConMapeo(csv, resultado);

 html.querySelector("#previewMapeoCatalogo").innerHTML = `
 <div><span>Codigo</span><strong>${muestra.codigoBarras || muestra.codigoInterno || "-"}</strong></div>
 <div><span>Nombre</span><strong>${muestra.nombre || "-"}</strong></div>
 <div><span>Costo</span><strong>${muestra.costo || "-"}</strong></div>
 <div><span>Medio mayoreo</span><strong>${muestra.medioMayoreo || "-"}</strong></div>
 <div><span>Publico</span><strong>${muestra.publico || "-"}</strong></div>
 <div><span>Marca</span><strong>${muestra.marca || "-"}</strong></div>
 `;
 };

 html.querySelectorAll("select").forEach(select =>
 select.addEventListener("change", renderPreview)
 );

 renderPreview();

 return new Promise(resolve => {
 const cerrar = valor => {
 html.remove();
 resolve(valor);
 };

 html.querySelector("#cerrarMapeoCatalogo")
 .addEventListener("click", () => cerrar(null));

 html.querySelector("#cancelarMapeoCatalogo")
 .addEventListener("click", () => cerrar(null));

 html.querySelector("#confirmarMapeoCatalogo")
 .addEventListener("click", () => {
 const mapeoFinal =
 leerMapeo();

 let plantillaGuardada = plantilla;

 if (html.querySelector("#guardarPlantillaCatalogo").checked) {
 const nombresMapeo = {};

 Object.entries(mapeoFinal).forEach(([campo, indice]) => {
 if (indice !== "") {
 nombresMapeo[campo] =
 encabezados[indice]?.nombre || "";
 }
 });

 plantillaGuardada =
 guardarPlantillaCatalogo({
 id: plantilla?.alcance === "privada"
 ? plantilla.id
 : `privada-${normalizarEncabezadoCatalogo(proveedor)}-${Date.now()}`,
 proveedor,
 nombre: `${proveedor} - plantilla`,
 giro: "General",
 mapeo: nombresMapeo
 });
 }

 cerrar({
 proveedor,
 plantillaId: plantillaGuardada?.id || "",
 mapeo: mapeoFinal
 });
 });
 });
}

function productoPreviewConMapeo(csv, mapeo) {
 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const encabezado =
 detectarColumnasCatalogo(lineas).indice;

 const linea =
 lineas.find((item, indice) =>
 indice !== encabezado &&
 separarFilaCatalogo(item).length > 2
 ) || "";

 const datos =
 separarFilaCatalogo(linea);

 const valor = campo => {
 const indice =
 mapeo[campo];

 return indice === "" || indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
 };

 return {
 codigoBarras: valor("codigoBarras"),
 codigoInterno: valor("codigoInterno"),
 nombre: valor("nombre"),
 costo: valor("costo"),
 medioMayoreo: valor("medioMayoreo"),
 publico: valor("publico"),
 marca: valor("marca")
 };
}

function procesarArchivosCatalogo(archivos) {
 const listaArchivos =
 Array.from(archivos || []);

 if (listaArchivos.length === 0) return;

 const lecturas =
 listaArchivos.map(async archivo => new Promise(async resolve => {
 const lector = new FileReader();

 lector.onload = async evento => {
 const csv =
 evento.target.result || "";

 const config =
 await abrirAsistenteCatalogo(archivo, csv);

 if (!config) {
 resolve(null);
 return;
 }

 resolve({
 id: `${Date.now()}-${archivo.name}`,
 proveedor: config.proveedor,
 archivo: archivo.name,
 fecha: new Date().toISOString(),
 productos: contarProductosCatalogo(csv),
 plantillaId: config.plantillaId || "",
 mapeo: config.mapeo || {},
 csv
 });
 };

 lector.readAsText(archivo);
 }));

 Promise.all(lecturas).then(nuevosCatalogos => {
 nuevosCatalogos =
 nuevosCatalogos.filter(Boolean);

 if (nuevosCatalogos.length === 0) return;

 const actuales =
 catalogosGuardados();

 const fusionados =
 [
 ...nuevosCatalogos,
 ...actuales.filter(actual =>
 !nuevosCatalogos.some(nuevo =>
 nuevo.proveedor.toLowerCase() ===
 actual.proveedor.toLowerCase()
 )
 )
 ];

 if (!guardarCatalogosProveedor(fusionados)) {
 return;
 }

 localStorage.setItem(
 "ultimoProveedorCatalogo",
 nuevosCatalogos[0]?.proveedor || ""
 );
 renderCatalogosProveedor();

 alertaPOS(
 "Catalogo actualizado correctamente",
 "Catalogo proveedor",
 "exito"
 );
 });
}
async function iniciarSesion() {
 if (!configuracionNegocio()) {
 inicializarConfiguracionInicial();
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

 guardarSesionPersistente(usuario);

 await entrarAlSistemaConUsuario(usuario);
}

async function cargarProductos() {

 const respuesta =
 await fetch("/productos");

 todosProductos =
 await respuesta.json();

 mostrarProductos(
 todosProductos
 );

 actualizarDashboard();

 actualizarInventarioBajo();

 actualizarDatalistCategorias();
}

function actualizarDashboard() {

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
 .toLowerCase();

 const filtrados =
 todosProductos.filter(
 producto =>

 producto.nombre
 .toLowerCase()
 .includes(texto)

 ||

 String(
 producto.codigo || ""
 ).includes(texto)

 ||

 String(
 producto.categoria || ""
 )
 .toLowerCase()
 .includes(texto)
 );

 mostrarProductos(
 filtrados
 );

 programarLecturaCodigoBarras(texto);
}

function normalizarCodigo(codigo) {
 return String(codigo || "")
 .replace(/[="'\s]/g, "")
 .trim();
}

function limpiarTextoCatalogo(valor) {
 return String(valor || "")
 .replace(/^=+/, "")
 .replace(/^"+|"+$/g, "")
 .trim();
}

function separarFilaCatalogo(linea) {
 const partes = [];
 let actual = "";
 let enComillas = false;
 const textoLinea =
 String(linea || "");

 const contarSeparador = separador => {
 let total = 0;
 let dentroComillas = false;

 for (let i = 0; i < textoLinea.length; i++) {
 const caracter = textoLinea[i];
 const siguiente = textoLinea[i + 1];

 if (caracter === '"' && siguiente === '"') {
 i++;
 continue;
 }

 if (caracter === '"') {
 dentroComillas = !dentroComillas;
 continue;
 }

 if (caracter === separador && !dentroComillas) {
 total++;
 }
 }

 return total;
 };

 const separador =
 [
 ",",
 ";",
 "\t"
 ].sort((a, b) => contarSeparador(b) - contarSeparador(a))[0] || ",";

 for (let i = 0; i < textoLinea.length; i++) {
 const caracter = textoLinea[i];
 const siguiente = textoLinea[i + 1];

 if (caracter === '"' && siguiente === '"') {
 actual += '"';
 i++;
 continue;
 }

 if (caracter === '"') {
 enComillas = !enComillas;
 continue;
 }

 if (caracter === separador && !enComillas) {
 partes.push(actual);
 actual = "";
 continue;
 }

 actual += caracter;
 }

 partes.push(actual);
 return partes.map(limpiarTextoCatalogo);
}

function normalizarEncabezadoCatalogo(valor) {
 return limpiarTextoCatalogo(valor)
 .toLowerCase()
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g, "")
 .replace(/[^a-z0-9]+/g, " ")
 .trim();
}

function numeroCatalogo(valor) {
 const limpio =
 limpiarTextoCatalogo(valor)
 .replace(/[^0-9.,-]/g, "")
 .replace(/,/g, "");

 const numero =
 Number(limpio);

 return Number.isFinite(numero) ? numero : "";
}

function detectarColumnasCatalogo(lineas) {
 const muestra =
 lineas.slice(0, 12);

 let mejor = {
 indice: -1,
 puntaje: 0,
 columnas: {}
 };

 const reglas = [
 {
 clave: "codigo",
 puntos: 5,
 prueba: texto => /\b(codigo|cod|clave|barcode|barra|barras|ean|upc)\b/.test(texto)
 },
 {
 clave: "nombre",
 puntos: 4,
 prueba: texto => /\b(producto|articulo|nombre|concepto|modelo)\b/.test(texto)
 },
 {
 clave: "descripcion",
 puntos: 5,
 prueba: texto => /\b(descripcion|desc|detalle|caracteristicas)\b/.test(texto)
 },
 {
 clave: "marca",
 puntos: 4,
 prueba: texto => /\b(marca|linea|fabricante)\b/.test(texto)
 },
 {
 clave: "codigoInterno",
 puntos: 4,
 prueba: texto => /\b(clave|sku|modelo|codigo interno|codigo proveedor|referencia|ref)\b/.test(texto)
 && !/\b(barra|barras|ean|upc)\b/.test(texto)
 },
 {
 clave: "categoria",
 puntos: 3,
 prueba: texto => /\b(categoria|familia|depto|departamento|grupo)\b/.test(texto)
 },
 {
 clave: "medioMayoreoIva",
 puntos: 8,
 prueba: texto =>
 /\b(mayoreo|may)\b/.test(texto) &&
 /(iva|impuesto|c iva|con iva)/.test(texto) &&
 !/\b(distribuidor|subdistribuidor|minimo|minima)\b/.test(texto)
 },
 {
 clave: "medioMayoreo",
 puntos: 6,
 prueba: texto =>
 /\b(mayoreo|may)\b/.test(texto) &&
 !/\b(distribuidor|subdistribuidor|minimo|minima|iva)\b/.test(texto)
 },
 {
 clave: "publico",
 puntos: 4,
 prueba: texto =>
 /\b(publico|pub|menudeo|lista)\b/.test(texto) &&
 !/\b(minimo|minima)\b/.test(texto)
 },
 {
 clave: "distribuidor",
 puntos: 4,
 prueba: texto =>
 /\b(distribuidor|costo|neto|proveedor)\b/.test(texto) &&
 !/\b(subdistribuidor)\b/.test(texto)
 },
 {
 clave: "stockMinimo",
 puntos: 3,
 prueba: texto => /stock/.test(texto) && /(minimo|min)/.test(texto)
 },
 {
 clave: "altaRotacion",
 puntos: 2,
 prueba: texto => /rotacion/.test(texto)
 }
 ];

 muestra.forEach((linea, indice) => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas = {};
 let puntaje = 0;

 datos.forEach((dato, columna) => {
 const texto =
 normalizarEncabezadoCatalogo(dato);

 reglas.forEach(regla => {
 if (columnas[regla.clave] === undefined && regla.prueba(texto)) {
 columnas[regla.clave] = columna;
 puntaje += regla.puntos;
 }
 });
 });

 if (puntaje > mejor.puntaje) {
 mejor = {
 indice,
 puntaje,
 columnas
 };
 }
 });

 return mejor.puntaje >= 6
 ? mejor
 : {
 indice: -1,
 puntaje: 0,
 columnas: {}
 };
}

function valorColumnaCatalogo(datos, columnas, clave) {
 const indice =
 columnas[clave];

 return indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
}

function valorMapeoCatalogo(datos, mapeo, clave) {
 const indice =
 mapeo?.[clave];

 return indice === "" || indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
}

const CAMPOS_CATALOGO_COMPACTO = [
 "codigoBarras",
 "codigoInterno",
 "claveProveedor",
 "codigosAlternos",
 "nombre",
 "unidadVenta",
 "costo",
 "medioMayoreo",
 "publico",
 "marca",
 "categoria"
];

const MAPEO_CATALOGO_COMPACTO =
 CAMPOS_CATALOGO_COMPACTO.reduce((mapa, campo, indice) => {
 mapa[campo] = indice;
 return mapa;
 }, {});

function escaparCsvCatalogo(valor) {
 const texto =
 limpiarTextoCatalogo(valor);

 return /[",\n\r]/.test(texto)
 ? `"${texto.replace(/"/g, '""')}"`
 : texto;
}

function esCatalogoCompacto(csv) {
 const primeraLinea =
 String(csv || "")
 .split("\n")
 .find(linea => linea.trim()) || "";

 return primeraLinea.includes("__pos_codigoBarras");
}

function valorCatalogoParaCompactar(datos, columnas, mapeo, campo) {
 if (campo === "codigosAlternos") {
 const codigos =
 datos
 .map(normalizarCodigo)
 .filter(codigo =>
 codigo &&
 /^\d{4,14}$/.test(codigo)
 );

 return [...new Set(codigos)].join("|");
 }

 const desdeMapeo =
 valorMapeoCatalogo(datos, mapeo, campo);

 if (desdeMapeo) return desdeMapeo;

 const equivalencias = {
 codigoBarras: "codigo",
 codigoInterno: "codigoInterno",
 claveProveedor: "codigoInterno",
 nombre: "nombre",
 costo: "distribuidor",
 medioMayoreo: "medioMayoreoIva",
 publico: "publico",
 marca: "marca",
 categoria: "categoria"
 };

 return valorColumnaCatalogo(
 datos,
 columnas,
 equivalencias[campo] || campo
 );
}

function compactarCsvCatalogo(csv, mapeo = {}) {
 if (esCatalogoCompacto(csv)) {
 const lineasCompactas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 return {
 csv,
 mapeo: { ...MAPEO_CATALOGO_COMPACTO },
 productos: Math.max(0, lineasCompactas.length - 1)
 };
 }

 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const encabezado =
 CAMPOS_CATALOGO_COMPACTO
 .map(campo => `__pos_${campo}`)
 .join(",");

 const filas =
 lineas
 .filter((linea, indice) => indice !== mapaColumnas.indice)
 .map(linea => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas =
 mapaColumnas.columnas || {};

 const valores =
 CAMPOS_CATALOGO_COMPACTO.map(campo =>
 valorCatalogoParaCompactar(
 datos,
 columnas,
 mapeo,
 campo
 )
 );

 const tieneIdentidad =
 valores[0] || valores[1] || valores[2] || valores[3];

 return tieneIdentidad
 ? valores.map(escaparCsvCatalogo).join(",")
 : "";
 })
 .filter(Boolean);

 return {
 csv: [encabezado, ...filas].join("\n"),
 mapeo: { ...MAPEO_CATALOGO_COMPACTO },
 productos: filas.length
 };
}

function prepararCatalogoParaGuardar(catalogo) {
 const compacto =
 compactarCsvCatalogo(
 catalogo.csv || "",
 catalogo.mapeo || {}
 );

 return {
 ...catalogo,
 csv: compacto.csv,
 mapeo: compacto.mapeo,
 productos: compacto.productos || catalogo.productos || 0
 };
}

function esValorNumericoCatalogo(valor) {
 const limpio =
 limpiarTextoCatalogo(valor)
 .replace(/[$,\s]/g, "");

 return limpio !== "" && !Number.isNaN(Number(limpio));
}

function nombreProductoDesdeFilaCatalogo(datos, indiceCodigo) {
 const candidatos =
 datos
 .map(limpiarTextoCatalogo)
 .filter((valor, indice) =>
 indice !== indiceCodigo
 &&
 valor.length >= 5
 &&
 !esValorNumericoCatalogo(valor)
 &&
 !/^\d{6,}$/.test(normalizarCodigo(valor))
 )
 .sort((a, b) => b.length - a.length);

 return candidatos[0] || "Producto sin nombre";
}

function detectarMarcaDesdeFilaCatalogo(datos) {
 const marcas =
 [
 "Truper",
 "Volteck",
 "Fiero",
 "Pretul",
 "Foset",
 "Hermex",
 "Klintek",
 "Expert",
 "Diprofer"
 ];

 const texto =
 datos
 .map(limpiarTextoCatalogo)
 .join(" ")
 .toLowerCase();

 return marcas.find(marca =>
 texto.includes(marca.toLowerCase())
 ) || "";
}

function inferirMarcaPorCodigo(codigo) {
 const limpio =
 normalizarCodigo(codigo);

 if (
 limpio.startsWith("75012066") ||
 limpio.startsWith("7506240")
 ) {
 return "Truper";
 }

 return "";
}

function codigoInternoDesdeFilaCatalogo(datos, codigoPrincipal) {
 const principal =
 normalizarCodigo(codigoPrincipal);

 const candidatos =
 datos
 .map(limpiarTextoCatalogo)
 .map(normalizarCodigo)
 .filter(codigo =>
 codigo &&
 codigo !== principal &&
 /^[a-zA-Z0-9]{3,10}$/.test(codigo) &&
 !/^\d{11,14}$/.test(codigo)
 )
 .sort((a, b) => a.length - b.length);

 return candidatos[0] || "";
}

function esCodigoBarras(texto) {
 const codigo =
 normalizarCodigo(texto);

 return /^\d{8,14}$/.test(codigo);
}

function codigosProducto(producto) {
 const codigos = [];

 if (producto?.codigo) codigos.push(producto.codigo);

 if (Array.isArray(producto?.codigos_relacionados)) {
 producto.codigos_relacionados.forEach(item => {
 if (item?.codigo) codigos.push(item.codigo);
 });
 }

 return codigos
 .map(normalizarCodigo)
 .filter(Boolean);
}

function buscarProductoLocalPorCodigo(codigo) {
 const limpio =
 normalizarCodigo(codigo);

 if (!limpio) return null;

 return todosProductos.find(producto =>
 normalizarCodigo(producto.id) === limpio ||
 codigosProducto(producto).includes(limpio)
 ) || null;
}

function precioVentaProducto(producto) {
 return Number(
 producto?.precio ||
 producto?.precio_mayoreo ||
 producto?.precio_publico ||
 producto?.precio_distribuidor ||
 0
 );
}

function unidadProducto(producto = {}) {
 return String(
 producto.unidad_venta ||
 producto.unidadVenta ||
 "pieza"
 ).toLowerCase();
}

function esUnidadDecimal(unidad) {
 return [
 "kg",
 "kilo",
 "gramo",
 "metro",
 "litro"
 ].includes(String(unidad || "").toLowerCase());
}

function pasoUnidad(unidad) {
 return esUnidadDecimal(unidad) ? 0.1 : 1;
}

function formatearCantidad(cantidad, unidad = "pieza") {
 const numero =
 Number(cantidad || 0);

 const decimales =
 esUnidadDecimal(unidad) ? 3 : 0;

 return `${Number(numero.toFixed(decimales))} ${unidad}`;
}

function generarCodigoInternoProducto(tipo = "manual", categoria = "") {
 const prefijoBase =
 tipo === "granel"
 ? "GR"
 : tipo === "servicio"
 ? "SRV"
 : "GEN";

 const categoriaLimpia =
 normalizarTexto(categoria)
 .replace(/[^a-z0-9]/g, "")
 .slice(0, 3)
 .toUpperCase();

 const prefijo =
 categoriaLimpia || prefijoBase;

 const consecutivo =
 String(Date.now()).slice(-6);

 return `${prefijo}-${consecutivo}`;
}

function esCodigoAutomaticoProducto(valor = "") {
 return /^(GEN|GR|[A-Z0-9]{1,3})-\d{6}$/.test(
 String(valor || "").trim().toUpperCase()
 );
}

function asignarCodigoAutomaticoProducto(tipoFinal) {
 const codigo =
 document.getElementById("nuevoCodigo");

 if (!codigo) return;

 const valorActual =
 codigo.value.trim();

 if (
 valorActual &&
 !codigo.dataset.codigoAutomatico &&
 !esCodigoAutomaticoProducto(valorActual)
 ) return;

 codigo.value =
 generarCodigoInternoProducto(
 tipoFinal,
 document.getElementById("nuevaCategoria")?.value || ""
 );

 codigo.dataset.codigoAutomatico =
 "1";
}

function seleccionarTipoProducto(tipo) {
 const tipoFinal =
 tipo || "catalogo";

 const campoTipo =
 document.getElementById("tipoProductoInventario");

 if (campoTipo) {
 campoTipo.value = tipoFinal;
 }

 document
 .querySelectorAll(".tipo-producto-card")
 .forEach(boton => {
 boton.classList.toggle(
 "activo",
 boton.dataset.tipoProducto === tipoFinal
 );
 });

 const codigo =
 document.getElementById("nuevoCodigo");

 const codigoInterno =
 document.getElementById("nuevoCodigoInterno");

 const unidad =
 document.getElementById("unidadVenta");

 const factor =
 document.getElementById("factorConversion");

 const bascula =
 document.getElementById("basculaDigital");

 if (tipoFinal === "manual") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico o codigo opcional";
 asignarCodigoAutomaticoProducto("manual");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave proveedor / modelo opcional";
 if (unidad && !unidad.value) unidad.value = "pieza";
 }

 if (tipoFinal === "granel") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico para granel";
 asignarCodigoAutomaticoProducto("granel");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave proveedor / referencia opcional";
 if (unidad) unidad.value = "kg";
 if (factor && !factor.value) factor.value = "1";
 if (bascula) bascula.value = "preparado";
 }

 if (tipoFinal === "servicio") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico del servicio";
 asignarCodigoAutomaticoProducto("servicio");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave interna opcional";
 if (unidad) unidad.value = "servicio";
 if (factor && !factor.value) factor.value = "1";
 if (bascula) bascula.value = "no";

 const stock =
 document.getElementById("nuevoStock");

 const stockMinimo =
 document.getElementById("stockMinimo");

 if (stock && !stock.value) stock.value = "1";
 if (stockMinimo && !stockMinimo.value) stockMinimo.value = "0";
 }

 if (tipoFinal === "catalogo" && codigo) {
 codigo.placeholder = "Codigo de barras";

 if (codigo.dataset.codigoAutomatico || esCodigoAutomaticoProducto(codigo.value)) {
 codigo.value = "";
 delete codigo.dataset.codigoAutomatico;
 }

 if (codigoInterno) {
 codigoInterno.placeholder = "Codigo interno / clave proveedor";
 }
 }
}

function programarLecturaCodigoBarras(texto) {
 clearTimeout(temporizadorCodigoBarras);

 if (!esCodigoBarras(texto)) return;

 temporizadorCodigoBarras =
 setTimeout(() => {
 procesarCodigoBarrasPos(
 normalizarCodigo(texto)
 );
 }, 220);
}

function productoDesdeCatalogo(codigo) {
 const codigoNormalizado =
 normalizarCodigo(codigo);

 const catalogos =
 catalogosGuardados();

 const fuentes =
 catalogos.length > 0
 ? catalogos
 : [
 {
 proveedor: "",
 csv: localStorage.getItem(
 "catalogoProveedorCsv"
 ) || ""
 }
 ];

 for (const catalogoProveedor of fuentes) {
 const catalogoGuardado =
 catalogoProveedor.csv || "";

 const lineas =
 catalogoGuardado
 .split("\n")
 .map(linea => linea.trim())
 .filter(linea => linea);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const mapeoCatalogo =
 catalogoProveedor.mapeo || {};

 for (const linea of lineas) {
 const datos =
 separarFilaCatalogo(linea);

 const indicesCodigo =
 [
 mapeoCatalogo.codigoBarras,
 mapeoCatalogo.codigoInterno,
 mapeoCatalogo.claveProveedor,
 mapaColumnas.columnas.codigo,
 mapaColumnas.columnas.codigoInterno
 ]
 .filter(indice => indice !== "" && indice !== undefined);

 let indiceCodigo =
 indicesCodigo.find(indice =>
 normalizarCodigo(datos[indice]) === codigoNormalizado
 );

 const codigosAlternos =
 valorMapeoCatalogo(
 datos,
 mapeoCatalogo,
 "codigosAlternos"
 )
 .split("|")
 .map(normalizarCodigo)
 .filter(Boolean);

 const coincideCodigoAlterno =
 codigosAlternos.includes(codigoNormalizado);

 if (indiceCodigo === undefined) {
 indiceCodigo =
 datos.findIndex(
 dato =>
 normalizarCodigo(dato) ===
 codigoNormalizado
 );
 }

 if (indiceCodigo >= 0 || coincideCodigoAlterno) {
 const indiceCodigoProducto =
 indiceCodigo >= 0
 ? indiceCodigo
 : (
 mapeoCatalogo.codigoBarras ??
 mapeoCatalogo.codigoInterno ??
 mapeoCatalogo.claveProveedor ??
 0
 );

 const columnas =
 mapaColumnas.columnas || {};

 const nombreColumna =
 valorMapeoCatalogo(datos, mapeoCatalogo, "nombre") ||
 valorColumnaCatalogo(datos, columnas, "nombre");

 const descripcionColumna =
 valorMapeoCatalogo(datos, mapeoCatalogo, "nombre") ||
 valorColumnaCatalogo(datos, columnas, "descripcion");

 const nombreLargo =
 nombreProductoDesdeFilaCatalogo(
 datos,
 indiceCodigoProducto
 );

 const nombreDetectado =
 [
 descripcionColumna,
 nombreLargo,
 nombreColumna
 ]
 .map(limpiarTextoCatalogo)
 .filter(Boolean)
 .sort((a, b) => b.length - a.length)[0] ||
 "Producto sin nombre";

 const medioMayoreoIva =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "medioMayoreo") ||
 valorColumnaCatalogo(
 datos,
 columnas,
 "medioMayoreoIva"
 )
 );

 let medioMayoreo =
 medioMayoreoIva ||
 numeroCatalogo(
 valorColumnaCatalogo(
 datos,
 columnas,
 "medioMayoreo"
 )
 );

 const distribuidor =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "costo") ||
 valorColumnaCatalogo(
 datos,
 columnas,
 "distribuidor"
 )
 );

 const publico =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "publico") ||
 valorColumnaCatalogo(
 datos,
 columnas,
 "publico"
 )
 );

 if (
 medioMayoreo &&
 distribuidor &&
 medioMayoreo < distribuidor
 ) {
 medioMayoreo =
 publico && publico >= distribuidor
 ? publico
 : distribuidor;
 }

 return {
 codigo:
 normalizarCodigo(datos[indiceCodigoProducto]) ||
 codigoNormalizado,
 nombre: nombreDetectado,
 descripcion:
 descripcionColumna ||
 nombreLargo ||
 nombreColumna,
 marca:
 valorMapeoCatalogo(datos, mapeoCatalogo, "marca") ||
 valorColumnaCatalogo(datos, columnas, "marca") ||
 detectarMarcaDesdeFilaCatalogo(datos) ||
 inferirMarcaPorCodigo(datos[indiceCodigoProducto]),
 categoria:
 valorMapeoCatalogo(datos, mapeoCatalogo, "categoria") ||
 valorColumnaCatalogo(datos, columnas, "categoria") ||
 "",
 unidadVenta:
 valorMapeoCatalogo(datos, mapeoCatalogo, "unidadVenta") ||
 "pieza",
 codigoInterno:
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoInterno") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "claveProveedor") ||
 valorColumnaCatalogo(datos, columnas, "codigoInterno") ||
 codigoInternoDesdeFilaCatalogo(
 datos,
 datos[indiceCodigoProducto]
 ),
 distribuidor,
 medioMayoreo,
 publico,
 proveedor:
 catalogoProveedor.proveedor ||
 localStorage.getItem("ultimoProveedorCatalogo") ||
 ultimoProveedorCatalogo(),
 stockMinimo:
 numeroCatalogo(
 valorColumnaCatalogo(
 datos,
 columnas,
 "stockMinimo"
 )
 ) || 3,
 altaRotacion:
 valorColumnaCatalogo(
 datos,
 columnas,
 "altaRotacion"
 ) || datos[12] || "",
 precioDetectado:
 medioMayoreoIva
 ? "medio mayoreo con IVA"
 : "medio mayoreo",
 codigosRelacionados:
 [
 ...datos
 .map(normalizarCodigo)
 .filter(item =>
 item &&
 item !== codigoNormalizado &&
 /^\d{3,14}$/.test(item)
 ),
 ...codigosAlternos.filter(item =>
 item && item !== codigoNormalizado
 )
 ].filter((item, indice, lista) =>
 lista.indexOf(item) === indice
 )
 };
 }
 }
 }

 return catalogo.find(
 item =>
 normalizarCodigo(item.codigo) ===
 codigoNormalizado
 ) || null;
}

function llenarFormularioConProductoCatalogo(producto) {
 mostrarInventario();
 mostrarFormularioAgregar();
 asegurarSelectorTipoPrecio();
 seleccionarTipoProducto("catalogo");

 if (!producto.proveedor) {
 producto.proveedor =
 localStorage.getItem("ultimoProveedorCatalogo") ||
 ultimoProveedorCatalogo() ||
 "Diprofer" ||
 "";
 }

 document.getElementById("nuevoCodigo").value =
 producto.codigo || "";

 document.getElementById("nuevoCodigo").setAttribute(
 "autocomplete",
 "off"
 );

 document.getElementById("nuevoStock").setAttribute(
 "autocomplete",
 "off"
 );

 document.getElementById("nuevoNombre").value =
 producto.nombre || "";

 document.getElementById("precioDistribuidor").value =
 producto.distribuidor || "";

 document.getElementById("precioMayoreo").value =
 producto.medioMayoreo || "";

 document.getElementById("precioPublico").value =
 producto.publico || "";

 const precioVenta =
 document.getElementById("nuevoPrecio");

 precioVenta.dataset.distribuidor =
 producto.distribuidor || "";

 precioVenta.dataset.medioMayoreo =
 producto.medioMayoreo || "";

 precioVenta.dataset.publico =
 producto.publico || "";

 precioVenta.dataset.precioDetectado =
 producto.precioDetectado || "medio mayoreo";

 document.getElementById("tipoPrecioVenta").value =
 "medioMayoreo";

 const opcionMedioMayoreo =
 document.querySelector("#tipoPrecioVenta option[value='medioMayoreo']");

 if (opcionMedioMayoreo) {
 opcionMedioMayoreo.textContent =
 producto.precioDetectado === "medio mayoreo con IVA"
 ? "Medio mayoreo con IVA"
 : "Medio mayoreo";
 }

 precioVenta.value =
 producto.medioMayoreo ||
 producto.publico ||
 producto.distribuidor ||
 "";

 document.getElementById("nuevoStock").value =
 "1";

 document.getElementById("nuevoProveedor").value =
 producto.proveedor || "";

 document.getElementById("nuevoCodigoInterno").value =
 producto.codigoInterno || "";

 document.getElementById("codigosRelacionados").value =
 (producto.codigosRelacionados || [])
 .join(", ");

 document.getElementById("nuevaCategoria").value =
 producto.categoria || "";

 document.getElementById("nuevaMarca").value =
 producto.marca || "";

 document.getElementById("nuevaDescripcion").value =
 producto.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto.unidadVenta || "pieza";

 document.getElementById("presentacionCompra").value =
 producto.presentacionCompra || "";

 document.getElementById("factorConversion").value =
 producto.factorConversion || "";

 document.getElementById("basculaDigital").value =
 producto.basculaDigital || "no";

 document.getElementById("stockMinimo").value =
 producto.stockMinimo || 3;

 document.getElementById("altaRotacion").value =
 producto.altaRotacion || "";

 enfocarStockNuevoProducto();
}

function enfocarStockNuevoProducto() {
 [80, 250, 500, 900].forEach(tiempo => {
 setTimeout(() => {
 const codigo =
 document.getElementById("nuevoCodigo");

 const stock =
 document.getElementById("nuevoStock");

 codigo?.blur();
 stock?.focus();
 stock?.select();
 }, tiempo);
 });
}

function asegurarSelectorTipoPrecio() {
 if (document.getElementById("tipoPrecioVenta")) return;

 const precio =
 document.getElementById("nuevoPrecio");

 if (!precio) return;

 const selector =
 document.createElement("select");

 selector.id =
 "tipoPrecioVenta";

 selector.innerHTML = `
 <option value="medioMayoreo">Medio mayoreo</option>
 <option value="publico">Publico</option>
 <option value="distribuidor">Mayoreo / distribuidor</option>
 `;

 selector.addEventListener(
 "change",
 cambiarTipoPrecioVenta
 );

 precio.insertAdjacentElement(
 "afterend",
 selector
 );
}

function asegurarEtiquetasFichaProducto() {
 const etiquetas = {
 nuevoCodigo: "Codigo de barras",
 nuevoNombre: "Nombre para vender",
 nuevoCodigoInterno: "Codigo interno / clave proveedor",
 codigosRelacionados: "Codigos alternos",
 nuevaCategoria: "Categoria",
 nuevaSubcategoria: "Subcategoria",
 nuevaMarca: "Marca",
 unidadVenta: "Unidad de venta",
 presentacionCompra: "Presentacion de compra",
 factorConversion: "Factor de conversion",
 precioDistribuidor: "Precio proveedor / costo",
 precioMayoreo: "Precio medio mayoreo",
 precioPublico: "Precio publico",
 nuevoPrecio: "Precio que usara el carrito",
 tipoPrecioVenta: "Tipo de precio",
 nuevoStock: "Stock actual",
 stockMinimo: "Stock minimo",
 nuevoProveedor: "Proveedor principal",
 nuevaUbicacion: "Ubicacion",
 basculaDigital: "Bascula digital",
 nuevaDescripcion: "Descripcion / notas",
 altaRotacion: "Alta rotacion"
 };

 Object.entries(etiquetas).forEach(([id, texto]) => {
 const campo =
 document.getElementById(id);

 if (!campo || campo.closest(".campo-ficha")) return;

 const wrapper =
 document.createElement("label");

 wrapper.className =
 "campo-ficha";

 const etiqueta =
 document.createElement("span");

 etiqueta.textContent =
 texto;

 campo.parentNode.insertBefore(wrapper, campo);
 wrapper.appendChild(etiqueta);
 wrapper.appendChild(campo);
 });
}

function cambiarTipoPrecioVenta() {
 const precio =
 document.getElementById("nuevoPrecio");

 const selector =
 document.getElementById("tipoPrecioVenta");

 if (!precio || !selector) return;

 const mapa = {
 distribuidor: precio.dataset.distribuidor,
 medioMayoreo: precio.dataset.medioMayoreo,
 publico: precio.dataset.publico
 };

 precio.value =
 mapa[selector.value] ||
 precio.value ||
 "";
}

function enfocarCampoStockAhora() {
 const stock =
 document.getElementById("nuevoStock");

 stock?.focus();
 stock?.select();
}

function buscarCodigoEnter(event) {

 if (
 event.key !== "Enter"
 ) return;

 event.preventDefault();

 clearTimeout(temporizadorCodigoBarras);

 procesarCodigoBarrasPos();
 return;

 const input =
 document.getElementById(
 "busqueda"
 );

 const codigo =
 normalizarCodigo(input.value);

 // Si esta vacio:
 // pasar a dinero
 if (!codigo) {

 document
 .getElementById(
 "dinero"
 )
 ?.focus();

 return;
 }

 const producto =
 todosProductos.find(
 p =>

 normalizarCodigo(p.codigo) === codigo

 ||

 normalizarCodigo(p.id) === codigo
 );

 if (!producto) {
 const productoCatalogo =
 productoDesdeCatalogo(codigo);

 if (productoCatalogo) {
 llenarFormularioConProductoCatalogo(
 productoCatalogo
 );

 input.value = "";
 enfocarStockNuevoProducto();
 return;
 }

 alert(
 "Producto no encontrado en inventario ni catalogo"
 );

 return;
 }

 agregar(
 producto.id,
 producto.nombre,
 producto.precio
);

// limpiar buscador
input.value = "";

buscarProductos();

// regresar al buscador
setTimeout(() => {

 document
 .getElementById(
 "busqueda"
 )
 ?.focus();

}, 50);

return;
}

function procesarCodigoBarrasPos(codigoManual) {
 const input =
 document.getElementById("busqueda");

 if (!input) return;

 const codigo =
 normalizarCodigo(codigoManual || input.value);

 if (!codigo) {
 document
 .getElementById("dinero")
 ?.focus();
 return;
 }

 const producto =
 buscarProductoLocalPorCodigo(codigo);

 if (!producto) {
 const productoCatalogo =
 productoDesdeCatalogo(codigo);

 if (productoCatalogo) {
 llenarFormularioConProductoCatalogo(
 productoCatalogo
 );

 alert(
 "Producto encontrado en catalogo. Revisa stock y guarda para venderlo."
 );

 input.value = "";
 return;
 }

 alert(
 "Producto no encontrado en inventario ni catalogo"
 );

 return;
 }

 agregar(
 producto.id,
 producto.nombre,
 precioVentaProducto(producto),
 producto
 );

 input.value = "";
 buscarProductos();

 setTimeout(() => {
 document
 .getElementById("busqueda")
 ?.focus();
 }, 50);
}

function mostrarProductos(productos) {

 const contenedor =
 document.getElementById(
 "productos"
 );

 if (!contenedor) return;

 contenedor.innerHTML = "";

 const destacados =
 productos
 .slice()
 .sort((a, b) =>
 Number(b.stock || 0) -
 Number(a.stock || 0)
 )
 .slice(0, 6);

 destacados.forEach(producto => {
 const unidad =
 unidadProducto(producto);

 contenedor.innerHTML += `

 <div class="producto">

 <div class="producto-icono">
 ${iconoProducto(producto.nombre)}
 </div>

 <h2>
 ${producto.nombre}
 </h2>

 <strong class="producto-precio">
 $${Number(producto.precio).toFixed(2)}
 </strong>

 <p class="producto-stock">
 Stock: ${producto.stock} ${unidad}
 </p>

 <button onclick="agregarProductoPorId(${Number(producto.id)})">
 Agregar
 </button>

 </div>
 `;
 });
}

function iconoProducto(nombre) {
 const texto =
 String(nombre || "").toLowerCase();

 let clave = "PR";

 if (texto.includes("martillo")) clave = "MT";
 else if (texto.includes("tornillo")) clave = "TR";
 else if (texto.includes("pintura")) clave = "PT";
 else if (texto.includes("taladro")) clave = "TD";
 else if (texto.includes("cinta")) clave = "CT";
 else if (texto.includes("pinza")) clave = "PZ";
 else if (texto.includes("cable")) clave = "CB";
 else if (texto.includes("cpvc") || texto.includes("codo") || texto.includes("tubo")) clave = "PV";

 return `<span class="producto-mini-icon" aria-hidden="true">${clave}</span>`;
}

function agregarProductoPorId(id) {
 const producto =
 todosProductos.find(p => Number(p.id) === Number(id));

 if (!producto) {
 alertaPOS("No se encontro el producto para agregar al carrito.", "Producto no disponible", "alerta");
 return;
 }

 agregar(
 producto.id,
 producto.nombre,
 precioVentaProducto(producto),
 producto
 );
}

function agregar(
 id,
 nombre,
 precio,
 producto = {}
) {
 const unidad =
 unidadProducto(producto);

 const existente =
 carrito.find(item => Number(item.id) === Number(id));

 if (existente) {
 existente.cantidad =
 Number(existente.cantidad || 0) + pasoUnidad(unidad);
 } else {
 carrito.push({
 id,
 nombre,
 precio: Number(precio || 0),
 cantidad: pasoUnidad(unidad),
 codigo: producto.codigo || "",
 unidadVenta: unidad,
 proveedor: producto.proveedor || "",
 tipoProducto: producto.tipo_producto || producto.tipoProducto || "",
 basculaDigital: producto.bascula_digital || producto.basculaDigital || "no"
 });
 }

 actualizarCarrito();
}

function eliminar(index) {

 carrito.splice(
 index,
 1
 );

 actualizarCarrito();
}

function quitarUnoCarrito(id) {
 const index =
 carrito.findIndex(
 producto => Number(producto.id) === Number(id)
 );

 if (index >= 0) {
 const producto =
 carrito[index];

 const nuevaCantidad =
 Number(producto.cantidad || 0) -
 pasoUnidad(producto.unidadVenta);

 if (nuevaCantidad > 0) {
 producto.cantidad =
 Number(nuevaCantidad.toFixed(3));
 } else {
 eliminar(index);
 return;
 }

 actualizarCarrito();
 }
}

async function limpiarCarrito() {

 if (carrito.length === 0) return;

 const confirmar =
 await confirmarPOS(
 "Vaciar todos los productos del carrito?",
 "Limpiar carrito",
 "alerta"
 );

 if (!confirmar) return;

 carrito = [];
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};

 actualizarCarrito();
}

function resumenCarritoPOS() {
 const subtotal =
 carrito.reduce((suma, producto) => {
  const cantidad = Number(producto.cantidad || 1);
  const precio = Number(producto.precio || 0);
  return suma + cantidad * precio;
 }, 0);

 const valorDescuento =
 Math.max(0, Number(descuentoCarrito.valor || 0));

 const descuento =
 descuentoCarrito.tipo === "porcentaje"
 ? subtotal * Math.min(valorDescuento, 100) / 100
 : descuentoCarrito.tipo === "monto"
 ? Math.min(valorDescuento, subtotal)
 : 0;

 const total =
 Math.max(0, subtotal - descuento);

 return {
 subtotal,
 descuento,
 total,
 descuentoTipo: descuentoCarrito.tipo,
 descuentoValor: valorDescuento
 };
}

function actualizarDescuentoCarrito(tipo, valor) {
 descuentoCarrito = {
 tipo: tipo || "ninguno",
 valor: Number(valor || 0)
 };
 actualizarCarrito();
}

function quitarDescuentoCarrito() {
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
 };
 actualizarCarrito();
}

function resumenClientePOS(cliente = clienteVentaActual) {
 if (!cliente) {
  return {
   nombre: "Publico general",
   detalle: "Venta de mostrador",
   saldo: 0,
   limite: 0,
   disponible: 0
  };
 }

 const saldo =
 Number(cliente.saldo || 0);

 const limite =
 Number(cliente.limite_credito || cliente.limiteCredito || 0);

 return {
  nombre: cliente.nombre || "Cliente",
  detalle: saldo > 0
  ? `Saldo ${dinero(saldo)}`
  : limite > 0
  ? `Disponible ${dinero(Math.max(0, limite - saldo))}`
  : "Sin adeudo",
  saldo,
  limite,
  disponible: Math.max(0, limite - saldo)
 };
}

function actualizarClientePOS() {
 const nombre =
 document.getElementById("clienteVentaNombre");

 const resumen =
 document.getElementById("clienteVentaResumen");

 const datos =
 resumenClientePOS();

 if (nombre) nombre.textContent = datos.nombre;
 if (resumen) resumen.textContent = datos.detalle;
}

function seleccionarClientePOS(id) {
 const clienteId = Number(id || 0);
 clienteVentaActual =
 clienteId > 0
 ? clientesCredito.find(cliente => Number(cliente.id) === clienteId) || null
 : null;

 actualizarClientePOS();
 cerrarSelectorClientePOS();
 actualizarCarrito();
}

async function crearClienteDesdePOS() {
 cerrarSelectorClientePOS();
 await abrirNuevoClienteCredito();
 await intentarRefrescarNubePOS(() => cargarCreditos(), "clientes");
 abrirSelectorClientePOS();
}

function cerrarSelectorClientePOS() {
 const modal =
 document.getElementById("modalClientePOS");

 if (modal) modal.style.display = "none";
}

async function abrirSelectorClientePOS() {
 let modal =
 document.getElementById("modalClientePOS");

 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalClientePOS";
  modal.className = "modal-personalizado modal-cliente-pos";
  document.body.appendChild(modal);
 }

 try {
  await intentarRefrescarNubePOS(() => cargarCreditos(), "clientes");
 } catch (error) {
  console.warn("No se pudieron refrescar clientes", error);
 }

 const clientes =
 [...clientesCredito].sort((a, b) =>
 String(a.nombre || "").localeCompare(String(b.nombre || ""))
 );

 const frecuentes =
 clientes.filter(cliente => Number(cliente.saldo || 0) > 0).slice(0, 4);

 const filas =
 clientes.length === 0
 ? '<div class="cliente-pos-empty">No hay clientes registrados.</div>'
 : clientes.map(cliente => {
  const datos = resumenClientePOS(cliente);
  const activo = clienteVentaActual && Number(clienteVentaActual.id) === Number(cliente.id);
  return `
  <button type="button" class="${activo ? "activo" : ""}" onclick="seleccionarClientePOS(${cliente.id})">
   <strong>${cliente.nombre}</strong>
   <span>Saldo ${dinero(datos.saldo)} · Disponible ${dinero(datos.disponible)}</span>
  </button>
  `;
 }).join("");

 modal.innerHTML = `
 <div class="modal-card cliente-pos-card">
  <div class="modal-card-header">
   <div>
    <span>Punto de venta</span>
    <h3>Seleccionar cliente</h3>
   </div>
   <button type="button" onclick="cerrarSelectorClientePOS()">Cerrar</button>
  </div>
  <div class="cliente-pos-resumen-grid">
   <button type="button" onclick="seleccionarClientePOS(0)">
    <strong>Publico general</strong>
    <span>Venta de mostrador sin credito</span>
   </button>
   <button type="button" onclick="crearClienteDesdePOS()">
    <strong>Crear cliente nuevo</strong>
    <span>Alta rapida desde el POS</span>
   </button>
  </div>
  <div class="cliente-pos-bloque">
   <h4>Clientes con credito</h4>
   <div class="cliente-pos-lista">${filas}</div>
  </div>
  ${
   frecuentes.length
   ? `<div class="cliente-pos-bloque"><h4>Atencion frecuente</h4><div class="cliente-pos-chips">${
    frecuentes.map(cliente => `<button onclick="seleccionarClientePOS(${cliente.id})">${cliente.nombre}</button>`).join("")
   }</div></div>`
   : ""
  }
 </div>
 `;

 modal.style.display = "flex";
}

function calcularCambio(total) {
 const resumen =
 resumenCarritoPOS();

 const totalReal =
 Number(total ?? resumen.total);

 const dinero =
 Number(
 document.getElementById(
 "dinero"
 )?.value || 0
 );

 const cambio =
 dinero - totalReal;

 const texto =
 document.getElementById(
 "cambioTexto"
 );

 if (!texto) return;

 texto.textContent =
 cambio >= 0
 ? `$${cambio.toFixed(2)}`
 : "Insuficiente";
}

function actualizarCarrito() {

 const contenedor =
 document.getElementById(
 "carrito"
 );

 if (!contenedor) return;

 contenedor.innerHTML = "";

 const resumen =
 resumenCarritoPOS();

 const total =
 resumen.total;

 let itemsHtml = "";

 if (carrito.length === 0) {
 itemsHtml = `
 <div class="carrito-vacio">
 <strong>Carrito vacio</strong>
 <span>Agrega productos para iniciar una venta.</span>
 </div>
 `;
 }

 carrito.forEach((p, index) => {
 const unidad =
 p.unidadVenta || "pieza";

 const cantidad =
 Number(p.cantidad || 1);

 const importe =
 Number(p.precio || 0) * cantidad;

 itemsHtml += `

 <div class="item-carrito">

 <div class="item-carrito-info">
 <span class="item-icono">
 ${iconoProducto(p.nombre)}
 </span>

 <div>
 <strong>${p.nombre}</strong>
 <small>$${Number(p.precio).toFixed(2)} por ${unidad}</small>
 </div>
 </div>

 <div class="item-cantidad">
 <button onclick="quitarUnoCarrito(${p.id})">-</button>
 <input
 type="number"
 min="0"
 step="${esUnidadDecimal(unidad) ? "0.001" : "1"}"
 value="${cantidad}"
 onchange="cambiarCantidadCarrito(${index}, this.value)"
 >
 <button onclick="sumarCantidadCarrito(${index})">+</button>
 </div>

 ${p.basculaDigital === "preparado" || esUnidadDecimal(unidad) ? `
 <button class="btn-bascula" onclick="capturarPesoManual(${index})">
 Bascula / peso
 </button>
 ` : ""}

 <strong class="item-total">
 ${formatearCantidad(cantidad, unidad)} - $${importe.toFixed(2)}
 </strong>

 </div>
 `;
 });

 contenedor.innerHTML = `

 <div class="carrito-items">
 ${itemsHtml}
 </div>

 <div class="resumen-cobro">

 <div class="resumen-linea">
 <span>Subtotal</span>
 <strong>$${resumen.subtotal.toFixed(2)}</strong>
 </div>

 <div class="resumen-descuento">
 <label>
 <span>Descuento</span>
 <select onchange="actualizarDescuentoCarrito(this.value, document.getElementById('valorDescuentoCarrito')?.value || 0)">
 <option value="ninguno" ${resumen.descuentoTipo === "ninguno" ? "selected" : ""}>Sin descuento</option>
 <option value="porcentaje" ${resumen.descuentoTipo === "porcentaje" ? "selected" : ""}>Porcentaje</option>
 <option value="monto" ${resumen.descuentoTipo === "monto" ? "selected" : ""}>Monto</option>
 </select>
 </label>
 <input
 id="valorDescuentoCarrito"
 type="number"
 min="0"
 step="0.01"
 value="${resumen.descuentoValor || ""}"
 placeholder="0"
 oninput="actualizarDescuentoCarrito(document.querySelector('.resumen-descuento select')?.value || 'ninguno', this.value)"
 >
 </div>

 <div class="resumen-linea">
 <span>Descuento aplicado</span>
 <strong>-$${resumen.descuento.toFixed(2)}</strong>
 </div>

 <div class="resumen-linea total-final">
 <span>Total final</span>
 <strong>$${total.toFixed(2)}</strong>
 </div>

 <label class="campo-recibido">
 <span>Recibido</span>
 <input
 type="number"
 id="dinero"
 placeholder="0.00"
 oninput="calcularCambio(${total})"
 onkeydown="cobrarConEnter(event, ${total})"
 >
 </label>

 <div class="resumen-linea cambio-linea">
 <span>Cambio</span>
 <strong id="cambioTexto">$0.00</strong>
 </div>

 <button class="btn-cobrar" onclick="cobrar(${total})">
 Cobrar
 </button>

 <button class="btn-credito-carrito" onclick="cobrarCredito(${total})">
 Mandar a credito
 </button>

 <button class="btn-limpiar" onclick="limpiarCarrito()">
 Limpiar carrito
 </button>
 </div>
 `;
}

function cambiarCantidadCarrito(index, valor) {
 const producto =
 carrito[index];

 if (!producto) return;

 const cantidad =
 Math.max(0, Number(valor || 0));

 if (cantidad <= 0) {
 carrito.splice(index, 1);
 } else {
 producto.cantidad =
 Number(cantidad.toFixed(3));
 }

 actualizarCarrito();
}

function sumarCantidadCarrito(index) {
 const producto =
 carrito[index];

 if (!producto) return;

 const cantidad =
 Number(producto.cantidad || 0) +
 pasoUnidad(producto.unidadVenta);

 producto.cantidad =
 Number(cantidad.toFixed(3));

 actualizarCarrito();
}

async function capturarPesoManual(index) {
 const producto =
 carrito[index];

 if (!producto) return;

 const valor =
 await pedirTextoPOS(
 `Cantidad en ${producto.unidadVenta || "unidad"}:`,
 String(producto.cantidad || 1),
 "Bascula / cantidad"
 );

 if (valor === null) return;

 cambiarCantidadCarrito(index, valor);
}

function productosCarritoAgrupados() {
 return carrito.map(producto => {
 const cantidad =
 Number(producto.cantidad || 1);

 const precio =
 Number(producto.precio || 0);

 return {
 id: producto.id,
 codigo: producto.codigo || "",
 nombre: producto.nombre,
 precio,
 cantidad,
 unidadVenta: producto.unidadVenta || "pieza",
 importe: cantidad * precio
 };
 });
}

async function imprimirTicketPOS(ticket, configOverride = null) {
 try {
  const negocio =
  configOverride || configuracionNegocio() || {};

  const anchoMm =
  negocio.ticketAncho === "58" ? 58 : 80;

  const anchoContenido =
  negocio.ticketAncho === "58" ? "52mm" : "72mm";

  if (negocio.imprimirAutomatico === false) {
   return true;
  }

  const htmlTicket = `
   <html>
   <head>
   <title>Ticket</title>
   <style>
   @page {
    size: ${anchoMm}mm auto;
    margin: 0;
   }

   * {
    box-sizing: border-box;
   }

   html,
   body {
    width: ${anchoMm}mm;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
   }

   body {
    display: block;
    font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    line-height: 1.25;
   }

   .ticket-print-page {
    width: ${anchoMm}mm;
    min-height: auto;
    padding: 3mm 3mm 5mm;
    background: #fff;
   }

   .ticket-print-page > div {
    width: ${anchoContenido} !important;
    max-width: ${anchoContenido} !important;
    padding: 0 !important;
    margin: 0 auto !important;
   }

   .ticket-print-page h1,
   .ticket-print-page h2,
   .ticket-print-page h3 {
    font-size: 15px !important;
    line-height: 1.05 !important;
    margin: 0 0 1.5mm !important;
   }

   .ticket-print-page img {
    max-width: 16mm !important;
    max-height: 16mm !important;
   }

   .ticket-print-page hr {
    border: 0;
    border-top: 1px dashed #000;
    margin: 2mm 0;
   }

   @media print {
    html,
    body {
     width: ${anchoMm}mm;
    }

    .ticket-print-page {
     width: ${anchoMm}mm;
    }
   }
   </style>
   </head>
   <body>
   <main class="ticket-print-page">
   ${ticket}
   </main>
   </body>
   </html>
  `;

  if (
   negocio.impresionSilenciosa === true &&
   window.nexoDesktop &&
   typeof window.nexoDesktop.printTicket === "function"
  ) {
   const resultado =
   await window.nexoDesktop.printTicket({
    html: htmlTicket,
    ...opcionesImpresionPOS(negocio)
   });

   return Boolean(resultado?.ok);
  }

  const iframe =
  document.createElement("iframe");

  iframe.title = "Ticket de venta";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";

  document.body.appendChild(iframe);

  const documento =
  iframe.contentWindow.document;

  documento.open();
  documento.write(htmlTicket);
  documento.close();

  setTimeout(() => {
   iframe.contentWindow.focus();
   iframe.contentWindow.print();

   if (
    negocio.abrirCajonDespuesTicket === true &&
    window.nexoDesktop &&
    typeof window.nexoDesktop.openCashDrawer === "function"
   ) {
    window.nexoDesktop.openCashDrawer({
     printerName: negocio.impresoraNombre || ""
    }).catch(error => console.warn("No se pudo abrir cajon", error));
   }

   setTimeout(() => {
    iframe.remove();
   }, 1200);
  }, 180);

  return true;
 } catch (error) {
  console.warn("No se pudo imprimir ticket", error);
  return false;
 }
}

async function cobrar(total) {

 if (!(await validarOperacionLicenciaNexoPOS("una venta"))) return;

 const resumen =
 resumenCarritoPOS();

 total =
 resumen.total;

 if (carrito.length === 0 || Number(total || 0) <= 0) {
 await alertaPOS("Agrega productos al carrito antes de cobrar.", "Carrito vacio", "alerta");
 return;
 }

 const dinero =
 Number(
 document.getElementById(
 "dinero"
 ).value || 0
 );

 if (dinero < total) {
 await alertaPOS(
 `Faltan ${(total - dinero).toFixed(2)} para completar la venta.`,
 "Dinero insuficiente",
 "alerta"
 );
 return;
 }

const cambio =
dinero - total;

let respuesta;
let ventaRegistrada = null;
let ventaOffline = false;
const productosVenta =
productosCarritoAgrupados();

try {
 respuesta = await fetch(
 "/ventas",
 {
 method: "POST",

 headers: {
 "Content-Type":
 "application/json"
 },

 body: JSON.stringify({
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 productos: productosVenta
 })
 }
 );
 } catch (error) {
 const offline =
 await registrarVentaOfflineDesktopPOS({
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 recibido: dinero,
 cambio,
 metodoPago: "efectivo",
 productos: productosVenta,
 errorConexion: error.message
 });

 if (offline.offlineDisponible && offline.ok) {
 ventaRegistrada = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 ventaOffline = true;
 } else {
 await alertaPOS("No se pudo conectar con el servidor para registrar la venta.", "Venta no registrada", "peligro");
 return;
 }
 }

 if (!ventaOffline && !respuesta.ok) {
 const offline =
 await registrarVentaOfflineDesktopPOS({
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 recibido: dinero,
 cambio,
 metodoPago: "efectivo",
 productos: productosVenta,
 errorServidor: respuesta.status
 });

 if (offline.offlineDisponible && offline.ok) {
 ventaRegistrada = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 ventaOffline = true;
 } else {
 await alertaPOS("El servidor no pudo registrar la venta. No se imprimio ticket para evitar errores de inventario.", "Venta no registrada", "peligro");
 return;
 }
 }

 if (!ventaRegistrada) {
 ventaRegistrada =
 await respuesta.json().catch(() => ({
 success: true
 }));
 }

 if (!ventaOffline) {
 await registrarEventoDesktopPOS(
 "venta_creada",
 "venta",
 ventaRegistrada.ventaId || ventaRegistrada.historialId || "",
 {
 ventaId: ventaRegistrada.ventaId || null,
 historialId: ventaRegistrada.historialId || null,
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 clienteId: clienteVentaActual?.id || null,
 recibido: dinero,
 cambio,
 metodoPago: "efectivo",
 productos: productosVenta,
 fechaServidor: ventaRegistrada.fecha || null
 }
 );
 }

 const cambioTexto =
 document.getElementById(
 "cambioTexto"
 );

if (cambioTexto) {

 cambioTexto.textContent =
 ventaOffline
 ? ` Venta offline guardada | Cambio: $${cambio}`
 : ` Venta realizada | Cambio: $${cambio}`;
}
const fecha =
 new Date()
 .toLocaleString(
 "es-MX"
 );

const negocio =
 configuracionNegocio() || {};

let ticket = `

<div style="
 width:300px;
 font-family:monospace;
 padding:20px;
 color:black;
">

 <div style="
 text-align:center;
 margin-bottom:12px;
 ">

 <h2 style="
 margin:0;
 font-size:22px;
 ">
 FERRETERIA
 </h2>

 <h2 style="
 margin:0;
 font-size:22px;
 ">
 OLIMPICO
 </h2>

 <div>
 Rio Grande, Zac.
 </div>

 <div>
 ${fecha}
 </div>

 </div>

 <hr>

`;

productosVenta.forEach(p => {

 ticket += `

 <div style="
 display:flex;
 justify-content:space-between;
 margin:6px 0;
 ">

 <span>
 ${p.nombre}<br>
 <small>${formatearCantidad(p.cantidad, p.unidadVenta)} x $${p.precio.toFixed(2)}</small>
 </span>

 <span>
 $${p.importe.toFixed(2)}
 </span>

 </div>
 `;
});

ticket += `

 <hr>

 ${
 resumen.descuento > 0
 ? `<div style="display:flex;justify-content:space-between;"><span>SUBTOTAL</span><span>$${resumen.subtotal.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;"><span>DESCUENTO</span><span>-$${resumen.descuento.toFixed(2)}</span></div>`
 : ""
 }

 <div style="
 display:flex;
 justify-content:space-between;
 font-weight:bold;
 ">
 <span>TOTAL</span>
 <span>$${total.toFixed(2)}</span>
 </div>

 <div style="
 display:flex;
 justify-content:space-between;
 ">
 <span>RECIBIDO</span>
 <span>$${dinero}</span>
 </div>

 <div style="
 display:flex;
 justify-content:space-between;
 ">
 <span>CAMBIO</span>
 <span>$${cambio}</span>
 </div>

 <hr>

 <div style="
 text-align:center;
 margin-top:12px;
 font-size:14px;
 ">

 Gracias por su compra 

 </div>

</div>
`;

if (negocio.nombre) {
 const separadorTicket =
 ticket.indexOf("<hr>");

 const desdeDetalle =
 separadorTicket >= 0
 ? ticket.slice(separadorTicket)
 : ticket;

 const anchoTicket =
 negocio.ticketAncho === "58" ? 230 : 300;

 const alineacionTicket =
 negocio.ticketAlineacion || "center";

 const logoTicket =
 negocio.logo && negocio.mostrarLogoTicket !== false
 ? `<img src="${negocio.logo}" style="width:58px;height:58px;object-fit:cover;border-radius:10px;margin-bottom:8px;">`
 : "";

 const nombreTicket =
 negocio.mostrarNombreTicket === false
 ? ""
 : `<h2 style="margin:0;font-size:22px;text-transform:uppercase;">${negocio.ticketNombre || negocio.nombre}</h2>`;

 const subtituloTicket =
 negocio.ticketSubtitulo
 ? `<div style="font-size:12px;">${negocio.ticketSubtitulo}</div>`
 : "";

 const direccionTicket =
 negocio.mostrarDireccionTicket === false || !negocio.direccion
 ? ""
 : `<div>${negocio.direccion}</div>`;

 const telefonoTicket =
 negocio.mostrarTelefonoTicket === false || !negocio.telefono
 ? ""
 : `<div>Tel. ${negocio.telefono}</div>`;

 const cajeroTicket =
 negocio.mostrarCajeroTicket === false
 ? ""
 : `<div>Cajero: ${usuarioActual?.nombre || "Administrador"}</div>`;

 ticket = `
 <div style="
 width:${anchoTicket}px;
 font-family:monospace;
 padding:20px;
 color:black;
 ">
 <div style="text-align:${alineacionTicket};margin-bottom:12px;">
 ${logoTicket}
 ${nombreTicket}
 ${subtituloTicket}
 ${direccionTicket}
 ${telefonoTicket}
 ${cajeroTicket}
 <div>${fecha}</div>
 </div>
 ${desdeDetalle}
 `;
}

const mensajeTicket =
 negocio.mensajeTicket || "Gracias por su compra";

let extraTicket =
 `${mensajeTicket}
 ${negocio.notaTicket ? `<br><small>${negocio.notaTicket}</small>` : ""}
 ${negocio.mostrarBarcodeTicket ? `<div style="margin-top:10px;font-size:22px;letter-spacing:2px;">|||| ||| |||| || |||||</div>` : ""}`;

if (ventaOffline) {
 extraTicket += `<br><small style="font-weight:bold;">PENDIENTE DE SINCRONIZAR</small>`;
}

ticket = ticket.replace(
 "Gracias por su compra",
 extraTicket
);

const ticketEnviado =
 await imprimirTicketPOS(ticket);

if (!ticketEnviado) {
 await alertaPOS(
 "La venta se registro, pero no se pudo abrir la impresion del ticket.",
 "Ticket no impreso",
 "alerta"
 );
}

if (ventaOffline) {
 await alertaPOS(
 "La venta quedo guardada en esta computadora y se sincronizara cuando vuelva el internet.",
 "Venta offline guardada",
 "exito"
 );
}

 carrito = [];
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
 clienteVentaActual = null;

 actualizarCarrito();
 actualizarClientePOS();

 if (ventaOffline) {
  descontarInventarioLocalPOS(productosVenta);
 } else {
  intentarRefrescarNubePOS(() => cargarProductos(), "productos");
  intentarRefrescarNubePOS(() => cargarHistorial(), "historial");
 }

 if (
 document.getElementById("pantallaReportes")?.style.display !== "none" &&
 typeof cargarReportesVentas === "function"
 ) {
  intentarRefrescarNubePOS(() => cargarReportesVentas(), "reportes de ventas");
 }

  if (typeof window.refrescarCaja7Metodos === "function") {
   intentarRefrescarNubePOS(() => window.refrescarCaja7Metodos(), "caja");
  }

 if (typeof enfocarBusquedaVentaRapida === "function") {
  enfocarBusquedaVentaRapida(true);
 }
}

async function cobrarCredito(total) {
 if (!(await validarOperacionLicenciaNexoPOS("una venta a credito"))) return;

 const resumen =
 resumenCarritoPOS();

 total =
 resumen.total;

 if (carrito.length === 0 || total <= 0) {
 alert("Agrega productos al carrito.");
 return;
 }

 await intentarRefrescarNubePOS(() => cargarCreditos(), "clientes de credito");

 if (clientesCredito.length === 0) {
 alert("Primero registra un cliente de credito o conecta internet para cargar la lista.");
 return;
 }

 const clienteInicial =
 clienteVentaActual && Number(clienteVentaActual.id)
 ? clienteVentaActual
 : null;

 const opciones =
 clientesCredito.map(cliente => ({
 nombre: String(cliente.id),
 etiqueta: cliente.nombre,
 valor: String(cliente.id)
 }));

 const datos =
 clienteInicial
 ? {
 clienteId: String(clienteInicial.id),
 concepto: "Venta de productos"
 }
 :
 await abrirFormularioCredito({
 titulo: "Venta a credito",
 subtitulo: `Total ${dinero(total)}`,
 campos: [
 {
 nombre: "clienteId",
 etiqueta: "Cliente",
 tipo: "select",
 opciones,
 requerido: true
 },
 {
 nombre: "concepto",
 etiqueta: "Concepto",
 valor: "Venta de productos"
 }
 ]
 });

 if (!datos) return;

 const clienteId =
 Number(datos.clienteId);

 const clienteSeleccionado =
 clientesCredito.find(cliente => Number(cliente.id) === clienteId);

 const productos =
 productosCarritoAgrupados();

 let respuesta;
 let creditoRegistrado = null;
 let creditoOffline = false;
 const conceptoCredito =
 datos.concepto || "Venta de productos";

 try {
 respuesta =
 await fetch(
 `/creditos/clientes/${clienteId}/cargos`,
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 monto: total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos
 })
 }
 );
 } catch (error) {
 const offline =
 await registrarCreditoOfflineDesktopPOS({
 clienteId,
 clienteNombre: clienteSeleccionado?.nombre || "",
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos,
 errorConexion: error.message
 });

 if (offline.offlineDisponible && offline.ok) {
 creditoRegistrado = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 creditoOffline = true;
 } else {
 alert("No se pudo registrar la venta a credito");
 return;
 }
 }

 if (!creditoOffline && !respuesta.ok) {
 const offline =
 await registrarCreditoOfflineDesktopPOS({
 clienteId,
 clienteNombre: clienteSeleccionado?.nombre || "",
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos,
 errorServidor: respuesta.status
 });

 if (offline.offlineDisponible && offline.ok) {
 creditoRegistrado = {
 success: true,
 offline: true,
 eventId: offline.eventId
 };
 creditoOffline = true;
 } else {
 alert("No se pudo registrar la venta a credito");
 return;
 }
 }

 if (!creditoRegistrado) {
 creditoRegistrado =
 await respuesta.json().catch(() => ({
 success: true
 }));
 }

 if (!creditoOffline) {
 await registrarEventoDesktopPOS(
 "credito_cargo_creado",
 "credito",
 creditoRegistrado.movimiento?.id || clienteId,
 {
 clienteId,
 clienteNombre: clienteSeleccionado?.nombre || "",
 movimientoId: creditoRegistrado.movimiento?.id || null,
 referencia: creditoRegistrado.movimiento?.referencia || null,
 total,
 subtotal: resumen.subtotal,
 descuento: resumen.descuento,
 descuentoTipo: resumen.descuentoTipo,
 descuentoValor: resumen.descuentoValor,
 concepto: conceptoCredito,
 productos,
 fechaServidor: creditoRegistrado.movimiento?.fecha || null
 }
 );
 }

 const fechaCredito =
 new Date().toLocaleString("es-MX");

 let ticketCredito = `
 <div style="width:300px;font-family:monospace;padding:20px;color:black;">
 <div style="text-align:center;margin-bottom:12px;">
 <h2 style="margin:0;font-size:20px;">${(configuracionNegocio()?.ticketNombre || configuracionNegocio()?.nombre || "Ferreteria").toUpperCase()}</h2>
 <div>VENTA A CREDITO</div>
 ${creditoOffline ? `<div style="font-weight:bold;font-size:12px;">PENDIENTE DE SINCRONIZAR</div>` : ""}
 <div>${fechaCredito}</div>
 <div>Cliente: ${clienteSeleccionado?.nombre || "Cliente"}</div>
 </div>
 <hr>
 `;

 productos.forEach(producto => {
  ticketCredito += `
  <div style="display:flex;justify-content:space-between;margin:6px 0;">
  <span>${producto.nombre}<br><small>${formatearCantidad(producto.cantidad, producto.unidadVenta)} x ${dinero(producto.precio || 0)}</small></span>
  <span>${dinero(producto.importe || 0)}</span>
  </div>
  `;
 });

 ticketCredito += `
 <hr>
 ${
 resumen.descuento > 0
 ? `<div style="display:flex;justify-content:space-between;"><span>SUBTOTAL</span><span>${dinero(resumen.subtotal)}</span></div><div style="display:flex;justify-content:space-between;"><span>DESCUENTO</span><span>-${dinero(resumen.descuento)}</span></div>`
 : ""
 }
 <div style="display:flex;justify-content:space-between;font-weight:bold;">
 <span>TOTAL CREDITO</span>
 <span>${dinero(total)}</span>
 </div>
 <div style="text-align:center;margin-top:12px;font-size:13px;">
 Firma / recibido
 <br><br>
 ______________________
 </div>
 </div>
 `;

 await imprimirTicketPOS(ticketCredito);

 carrito = [];
 descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
 clienteVentaActual = null;
 actualizarCarrito();
 actualizarClientePOS();

 if (creditoOffline) {
 descontarInventarioLocalPOS(productos);
 } else {
 await intentarRefrescarNubePOS(() => cargarProductos(), "productos");
 await intentarRefrescarNubePOS(() => cargarCreditos(), "creditos");
 await intentarRefrescarNubePOS(() => cargarHistorial(), "historial");
 }

 await alertaPOS(
 creditoOffline
 ? `Credito guardado offline para ${clienteSeleccionado?.nombre || "el cliente"} por ${dinero(total)}. Se sincronizara al volver el internet.`
 : `Venta a credito registrada para ${clienteSeleccionado?.nombre || "el cliente"} por ${dinero(total)}.`,
 creditoOffline ? "Credito offline guardado" : "Credito guardado",
 "exito"
 );

 if (typeof mostrarPuntoVenta === "function") {
  mostrarPuntoVenta();
 }

 if (typeof enfocarBusquedaVentaRapida === "function") {
  enfocarBusquedaVentaRapida(true);
 }
}

async function cargarHistorial() {

 const respuesta =
 await fetch(
 "/historial"
 );

 const historial =
 await respuesta.json();

 asegurarPanelVentasDashboard();
 actualizarPulsoVentasDashboard(historial);

 const contenedor =
 document.getElementById(
 "historial"
 );

 const ultimas =
 document.getElementById(
 "ultimasVentas"
 );

 const conteo =
 document.getElementById(
 "conteoVentas"
 );

 if (conteo) {

 conteo.textContent =
 historial.length;
 }

 if (contenedor) {

 contenedor.innerHTML = "";
 }

 if (ultimas) {

 ultimas.innerHTML = "";
 }

 historial.slice(0, 6).forEach(
 venta => {

 if (contenedor) {

 contenedor.innerHTML += `

 <div class="venta-reciente">
 <span>Venta</span>
 <strong>$${Number(venta.total).toFixed(2)}</strong>
 </div>
 `;
 }

 if (ultimas) {

 ultimas.innerHTML += `

 <div>
 Venta registrada
 </div>
 `;
 }
 }
 );

 if (ultimas) {
 ultimas.innerHTML =
 historial.slice(0, 6).map(venta => {
 const total =
 Number(venta.total || 0);

 return `
 <div class="venta-dashboard-item">
 <div>
 <strong>${dinero(total)}</strong>
 <span>${formatearFechaVenta(venta.fecha)}</span>
 </div>
 <b>Ingreso</b>
 </div>
 `;
 }).join("");
 }
}

function fechaVenta(valor) {
 const fecha =
 new Date(valor);

 return Number.isNaN(fecha.getTime())
 ? new Date()
 : fecha;
}

function mismaFecha(a, b) {
 return a.getFullYear() === b.getFullYear() &&
 a.getMonth() === b.getMonth() &&
 a.getDate() === b.getDate();
}

function formatearFechaVenta(valor) {
 const fecha =
 fechaVenta(valor);

 return fecha.toLocaleString("es-MX", {
 day: "2-digit",
 month: "short",
 hour: "2-digit",
 minute: "2-digit"
 });
}

function ventasDeFecha(historial, fechaObjetivo) {
 return historial.filter(venta =>
 mismaFecha(
 fechaVenta(venta.fecha),
 fechaObjetivo
 )
 );
}

function actualizarPulsoVentasDashboard(historial) {
 const hoy =
 new Date();

 const ayer =
 new Date();

 ayer.setDate(hoy.getDate() - 1);

 const ventasHoy =
 ventasDeFecha(historial, hoy);

 const ventasAyer =
 ventasDeFecha(historial, ayer);

 const totalHoy =
 ventasHoy.reduce(
 (suma, venta) => suma + Number(venta.total || 0),
 0
 );

 const totalAyer =
 ventasAyer.reduce(
 (suma, venta) => suma + Number(venta.total || 0),
 0
 );

 const ticketPromedio =
 ventasHoy.length
 ? totalHoy / ventasHoy.length
 : 0;

 const ventaAlta =
 ventasHoy.reduce(
 (mayor, venta) => Math.max(mayor, Number(venta.total || 0)),
 0
 );

 document.getElementById("ventasHoyMonto").textContent =
 dinero(totalHoy);

 document.getElementById("ventasHoyConteo").textContent =
 ventasHoy.length;

 document.getElementById("ticketPromedioHoy").textContent =
 dinero(ticketPromedio);

 document.getElementById("ventaAltaHoy").textContent =
 dinero(ventaAlta);

 const estado =
 document.getElementById("ventasHoyEstado");

 if (estado) {
 const diferencia =
 totalAyer > 0
 ? ((totalHoy - totalAyer) / totalAyer) * 100
 : totalHoy > 0 ? 100 : 0;

 estado.textContent =
 `${diferencia >= 0 ? "+" : ""}${diferencia.toFixed(0)}% vs ayer`;

 estado.className =
 diferencia >= 0 ? "estado-positivo" : "estado-negativo";
 }

 renderGraficaDashboardVentas(ventasHoy);
}

function renderGraficaDashboardVentas(ventasHoy) {
 const canvas =
 document.getElementById("graficaDashboardVentas");

 if (!canvas || typeof Chart === "undefined") return;

 const horas =
 Array.from({ length: 12 }, (_, indice) => indice + 8);

 const datos =
 horas.map(hora =>
 ventasHoy
 .filter(venta => fechaVenta(venta.fecha).getHours() === hora)
 .reduce((suma, venta) => suma + Number(venta.total || 0), 0)
 );

 if (graficaDashboardVentas) {
 graficaDashboardVentas.destroy();
 }

 graficaDashboardVentas = new Chart(canvas, {
 type: "line",
 data: {
 labels: horas.map(hora => `${hora}:00`),
 datasets: [
 {
 label: "Ventas",
 data: datos,
 borderColor: "#16a34a",
 backgroundColor: "rgba(22, 163, 74, .12)",
 borderWidth: 3,
 tension: .35,
 fill: true,
 pointRadius: 3,
 pointBackgroundColor: "#16a34a"
 }
 ]
 },
 options: {
 responsive: true,
 maintainAspectRatio: false,
 plugins: {
 legend: {
 display: false
 }
 },
 scales: {
 x: {
 grid: {
 display: false
 }
 },
 y: {
 beginAtZero: true,
 ticks: {
 callback: valor => dinero(valor)
 }
 }
 }
 }
 });
}

function mostrarInicio() {

 document.getElementById(
 "pantallaInicio"
 ).style.display = "block";

 document.getElementById(
 "pantallaPuntoVenta"
 ).style.display = "none";

 document.getElementById(
 "pantallaInventario"
 ).style.display = "none";

 document.getElementById("pantallaCategoriasInventario").style.display = "none";

 document.getElementById(
 "pantallaCatalogo"
 ).style.display = "none";

 document.getElementById(
 "pantallaClientes"
 ).style.display = "none";

 document.getElementById(
 "pantallaProveedores"
 ).style.display = "none";

 document.getElementById(
 "pantallaInventarioBajo"
 ).style.display = "none";

 document.getElementById(
 "pantallaReportes"
 ).style.display = "none";
}

function mostrarPuntoVenta() {

 document.getElementById(
 "pantallaInicio"
 ).style.display =
 "none";

 document.getElementById(
 "pantallaPuntoVenta"
 ).style.display =
 "block";

 document.getElementById(
 "pantallaInventario"
 ).style.display =
 "none";

 document.getElementById("pantallaCategoriasInventario").style.display = "none";

 document.getElementById(
 "pantallaCatalogo"
 ).style.display =
 "none";

 document.getElementById(
 "pantallaProveedores"
 ).style.display =
 "none";

 document.getElementById(
 "pantallaInventarioBajo"
 ).style.display =
 "none";

 document.getElementById(
 "pantallaReportes"
 ).style.display =
 "none";
}
function mostrarCatalogo() {
 asegurarPantallaCatalogo();

 document.getElementById(
 "pantallaInicio"
 ).style.display = "none";

 document.getElementById(
 "pantallaPuntoVenta"
 ).style.display = "none";

 document.getElementById(
 "pantallaInventario"
 ).style.display = "none";

 document.getElementById("pantallaCategoriasInventario").style.display = "none";

 document.getElementById(
 "pantallaCatalogo"
 ).style.display = "block";

 document.getElementById(
 "pantallaClientes"
 ).style.display = "none";

 document.getElementById(
 "pantallaProveedores"
 ).style.display = "none";

 document.getElementById(
 "pantallaInventarioBajo"
 ).style.display = "none";

 document.getElementById(
 "pantallaReportes"
 ).style.display = "none";

 renderCatalogosProveedor();
}
function mostrarInventarioBajo() {

 document.getElementById("pantallaInicio").style.display = "none";
 document.getElementById("pantallaPuntoVenta").style.display = "none";
 document.getElementById("pantallaInventario").style.display = "none";
 document.getElementById("pantallaCategoriasInventario").style.display = "none";
 document.getElementById("pantallaCatalogo").style.display = "none";
 document.getElementById("pantallaClientes").style.display = "none";
 document.getElementById("pantallaProveedores").style.display = "none";
 document.getElementById("pantallaInventarioBajo").style.display = "block";

 renderInventarioBajo();
}

function mostrarGraficas() {

 alert(
 " Reportes proximamente"
 );
}

function cambiarModo() {

 document.body.classList.toggle("oscuro");

 localStorage.setItem(
 TEMA_POS_KEY,
 document.body.classList.contains("oscuro")
 ? "oscuro"
 : "claro"
 );

 actualizarBotonModo();
}

async function agregarProductoNuevo() {

 if (!(await validarOperacionLicenciaNexoPOS("guardar productos"))) return;

 const nombre =
 document.getElementById(
 "nuevoNombre"
 ).value;

 const precio =
 document.getElementById(
 "nuevoPrecio"
 ).value;

 const stock =
 document.getElementById(
 "nuevoStock"
 ).value;

 const codigo =
 document.getElementById(
 "nuevoCodigo"
 ).value;
const proveedor =
document.getElementById("nuevoProveedor").value;

const ubicacion =
document.getElementById("nuevaUbicacion").value;

const categoria =
document.getElementById("nuevaCategoria")?.value || "";

const subcategoria =
document.getElementById("nuevaSubcategoria")?.value || "";

const marca =
document.getElementById("nuevaMarca")?.value || "";

const descripcion =
document.getElementById("nuevaDescripcion")?.value || "";

const unidadVenta =
document.getElementById("unidadVenta")?.value || "pieza";

const precioDistribuidor =
document.getElementById("precioDistribuidor")?.value || "";

const precioMayoreo =
document.getElementById("precioMayoreo")?.value || "";

const precioPublico =
document.getElementById("precioPublico")?.value || "";

const stockMinimo =
document.getElementById("stockMinimo")?.value || 3;

const altaRotacion =
document.getElementById("altaRotacion")?.value || "";

const codigoInterno =
document.getElementById("nuevoCodigoInterno")?.value || "";

const tipoProducto =
document.getElementById("tipoProductoInventario")?.value || "catalogo";

const presentacionCompra =
document.getElementById("presentacionCompra")?.value || "";

const factorConversion =
document.getElementById("factorConversion")?.value || "";

const basculaDigital =
document.getElementById("basculaDigital")?.value || "no";

const codigosRelacionadosTexto =
document.getElementById("codigosRelacionados")?.value || "";

const codigoFinal =
normalizarCodigo(codigo) ||
(
 tipoProducto === "manual" ||
 tipoProducto === "granel" ||
 tipoProducto === "servicio"
 ? generarCodigoInternoProducto(tipoProducto, categoria)
 : normalizarCodigo(codigoInterno)
);

const codigosRelacionados =
[
 codigoInterno,
 ...codigosRelacionadosTexto.split(/[\n,; ]+/)
]
 .map(normalizarCodigo)
 .filter(Boolean);

if (codigoFinal && !normalizarCodigo(codigo)) {
 document.getElementById("nuevoCodigo").value =
 codigoFinal;
 document.getElementById("nuevoCodigo").dataset.codigoAutomatico =
 "1";
}
 if (!String(nombre || "").trim()) {
 await alertaPOS("Escribe el nombre del producto.", "Falta nombre", "alerta");
 document.getElementById("nuevoNombre")?.focus();
 return;
 }

 if (precio === "" || Number(precio) < 0) {
 await alertaPOS("Escribe un precio valido para vender.", "Falta precio", "alerta");
 document.getElementById("nuevoPrecio")?.focus();
 return;
 }

 if (stock === "" || Number(stock) < 0) {
 await alertaPOS("Escribe el stock actual. Puede ser 0 si no hay existencia.", "Falta stock", "alerta");
 document.getElementById("nuevoStock")?.focus();
 return;
 }

 const esEdicion =
 Boolean(productoEditandoId);

 const url =
 esEdicion
 ? `/editar-producto/${productoEditandoId}`
 : "/agregar-producto";

 const metodo =
 esEdicion
 ? "PUT"
 : "POST";

 const payloadProducto = {
 nombre,
 precio,
 stock,
 codigo: codigoFinal,
 proveedor,
 ubicacion,
 categoria,
 subcategoria,
 marca,
 descripcion,
 unidadVenta,
 precioDistribuidor,
 precioMayoreo,
 precioPublico,
 stockMinimo,
 altaRotacion,
 tipoProducto,
 presentacionCompra,
 factorConversion,
 basculaDigital,
 codigosRelacionados
 };

 let respuesta;
 let productoGuardado = null;
 let productoOffline = false;

 try {
 respuesta = await fetch(
 url,
 {
 method: metodo,

 headers: {
 "Content-Type":
 "application/json"
 },

 body: JSON.stringify(payloadProducto)
 }
 );
 } catch (error) {
 const idLocal =
 esEdicion
 ? productoEditandoId
 : -Date.now();

 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 esEdicion ? "producto_actualizado" : "producto_creado",
 "producto",
 esEdicion ? productoEditandoId : "",
 {
 ...payloadProducto,
 productoId: esEdicion ? productoEditandoId : null,
 localId: idLocal,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 await alertaPOS("No se pudo conectar con el servidor para guardar el producto.", "Producto no guardado", "peligro");
 return;
 }

 productoGuardado = {
 ...payloadProducto,
 id: idLocal,
 precio_publico: precioPublico || precio || 0,
 precio_mayoreo: precioMayoreo || 0,
 precio_distribuidor: precioDistribuidor || 0,
 stock_minimo: stockMinimo || 3,
 unidad_venta: unidadVenta,
 tipo_producto: tipoProducto,
 codigos_relacionados: codigosRelacionados,
 pendienteSync: true
 };
 productoOffline = true;
 }

 if (!productoOffline && !respuesta.ok) {
 await alertaPOS("El servidor no pudo guardar el producto. Revisa que el codigo no este repetido y vuelve a intentar.", "Producto no guardado", "peligro");
 return;
 }

 if (!productoGuardado) {
 const datosGuardado =
 await respuesta.json().catch(() => ({}));

 productoGuardado =
 datosGuardado.producto || {
 ...payloadProducto,
 id: datosGuardado.productoId || productoEditandoId,
 precio_publico: precioPublico || precio || 0,
 precio_mayoreo: precioMayoreo || 0,
 precio_distribuidor: precioDistribuidor || 0,
 stock_minimo: stockMinimo || 3,
 unidad_venta: unidadVenta,
 tipo_producto: tipoProducto,
 codigos_relacionados: codigosRelacionados
 };
 }

 cerrarFormularioAgregar();

 if (productoOffline) {
 if (esEdicion) {
 todosProductos =
 todosProductos.map(producto =>
 Number(producto.id) === Number(productoEditandoId)
 ? {
 ...producto,
 ...productoGuardado
 }
 : producto
 );
 } else {
 todosProductos = [
 productoGuardado,
 ...todosProductos
 ];
 }

 mostrarProductos(todosProductos);
 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
 await guardarCatalogosLocalesDesktopPOS();
 } else {
 await cargarProductos();
 }

 await alertaPOS(
 productoOffline
 ? "Producto guardado offline. Se sincronizara cuando vuelva el internet."
 : (esEdicion ? "Producto actualizado correctamente." : "Producto agregado correctamente."),
 productoOffline ? "Producto offline guardado" : (esEdicion ? "Producto actualizado" : "Producto agregado"),
 "exito"
 );
}

function editarProducto(
 id,
 nombre,
 precio,
 stock,
 codigo
) {
 const producto =
 todosProductos.find(
 p =>
 Number(p.id) === Number(id)
 );

 nombre =
 nombre ?? producto?.nombre ?? "";

 precio =
 precio ?? producto?.precio ?? "";

 stock =
 stock ?? producto?.stock ?? "";

 codigo =
 codigo ?? producto?.codigo ?? "";

 productoEditandoId = id;

 mostrarFormularioAgregar();

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Editar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Actualizar producto";
 }

 document.getElementById(
 "nuevoNombre"
 ).value =
 nombre;

 document.getElementById(
 "nuevoPrecio"
 ).value =
 precio;

 document.getElementById(
 "nuevoStock"
 ).value =
 stock;

 document.getElementById(
 "nuevoCodigo"
 ).value =
 codigo || "";

 document.getElementById("nuevoProveedor").value =
 producto?.proveedor || "";

 document.getElementById("nuevaUbicacion").value =
 producto?.ubicacion || "";

 document.getElementById("nuevaCategoria").value =
 producto?.categoria || "";

 document.getElementById("nuevaSubcategoria").value =
 producto?.subcategoria || "";

 document.getElementById("nuevaMarca").value =
 producto?.marca || "";

 document.getElementById("nuevaDescripcion").value =
 producto?.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto?.unidad_venta || "pieza";

 document.getElementById("tipoProductoInventario").value =
 producto?.tipo_producto || "catalogo";

 seleccionarTipoProducto(
 producto?.tipo_producto || "catalogo"
 );

 document.getElementById("presentacionCompra").value =
 producto?.presentacion_compra || "";

 document.getElementById("factorConversion").value =
 producto?.factor_conversion || "";

 document.getElementById("basculaDigital").value =
 producto?.bascula_digital || "no";

 document.getElementById("unidadVenta").value =
 producto?.unidad_venta || "pieza";

 document.getElementById("precioDistribuidor").value =
 producto?.precio_distribuidor || "";

 document.getElementById("precioMayoreo").value =
 producto?.precio_mayoreo || "";

 document.getElementById("precioPublico").value =
 producto?.precio_publico || "";

 document.getElementById("stockMinimo").value =
 producto?.stock_minimo || 3;

 document.getElementById("altaRotacion").value =
 producto?.alta_rotacion || "";

 document.getElementById("codigosRelacionados").value =
 codigosProducto(producto)
 .filter(item => item !== normalizarCodigo(codigo || producto?.codigo))
 .join(", ");
}

async function eliminarProducto(id) {

 try {
 const respuesta =
 await fetch(
 `/eliminar-producto/${id}`,
 {
 method: "DELETE"
 }
 );

 if (!respuesta.ok) {
 await alertaPOS("No se pudo eliminar el producto.", "Producto no eliminado", "peligro");
 return;
 }

 await cargarProductos();
 return;
 } catch (error) {
 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "producto_eliminado",
 "producto",
 id,
 {
 productoId: id,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 await alertaPOS("No se pudo conectar con el servidor para eliminar el producto.", "Producto no eliminado", "peligro");
 return;
 }

 todosProductos =
 todosProductos.filter(producto => Number(producto.id) !== Number(id));

 mostrarProductos(todosProductos);
 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
 await guardarCatalogosLocalesDesktopPOS();

 await alertaPOS(
 "Producto dado de baja offline. Se sincronizara cuando vuelva el internet.",
 "Producto offline",
 "exito"
 );
 }
}

window.onload =
 async () => {

 aplicarPreferenciaTema();

 if (inicializarConfiguracionInicial()) {
 inicializarLoginUsuarios();
 await intentarRestaurarSesion();
 }

 actualizarCarrito();

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
function mostrarInventario() {
 ocultarPantallasPrincipales();

 document.getElementById(
 "pantallaInventario"
 ).style.display = "block";

 abrirSubmenuInventario();
 actualizarDatalistCategorias();
 cargarTablaInventario();

}

function categoriasInventarioGuardadas() {
 try {
 const guardadas =
 JSON.parse(localStorage.getItem("categoriasInventario") || "[]");

 if (Array.isArray(guardadas) && guardadas.length > 0) {
 return guardadas;
 }
 } catch (error) {
 console.warn("No se pudieron leer categorias", error);
 }

 const desdeProductos =
 todosProductos
 .map(producto => String(producto.categoria || "").trim())
 .filter(Boolean);

 return [...new Set([
 ...plantillaGiroActual().categorias,
 ...desdeProductos
 ])].map((nombre, indice) => ({
 id: `cat-${normalizarTexto(nombre).replace(/[^a-z0-9]/g, "-") || indice}`,
 nombre,
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][indice % 6]
 }));
}

function guardarCategoriasInventario(categorias) {
 localStorage.setItem(
 "categoriasInventario",
 JSON.stringify(categorias)
 );

 actualizarDatalistCategorias();
}

function actualizarDatalistCategorias() {
 const lista =
 document.getElementById("listaCategoriasProducto");

 if (!lista) return;

 lista.innerHTML =
 categoriasInventarioGuardadas()
 .map(categoria => `<option value="${categoria.nombre}"></option>`)
 .join("");
}

function aplicarCategoriasDeGiro(giro = "ferreteria", reemplazar = false) {
 const plantilla =
 PLANTILLAS_GIRO_NEGOCIO[giro] || PLANTILLAS_GIRO_NEGOCIO.ferreteria;

 const existentes =
 reemplazar ? [] : categoriasInventarioGuardadas();

 const combinadas =
 [...existentes];

 plantilla.categorias.forEach((nombre, indice) => {
 const existe =
 combinadas.some(categoria =>
 normalizarTexto(categoria.nombre) === normalizarTexto(nombre)
 );

 if (!existe) {
 combinadas.push({
 id: `cat-${normalizarTexto(nombre).replace(/[^a-z0-9]/g, "-") || Date.now()}`,
 nombre,
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][indice % 6]
 });
 }
 });

 guardarCategoriasInventario(combinadas);
 return combinadas;
}

async function aplicarPlantillaGiroConfiguracion() {
 const giro =
 document.getElementById("configGiroNegocio")?.value || "ferreteria";

 const plantilla =
 PLANTILLAS_GIRO_NEGOCIO[giro] || PLANTILLAS_GIRO_NEGOCIO.ferreteria;

 const confirmar =
 await confirmarPOS(
 `Se agregaran categorias sugeridas para ${plantilla.nombre}. No se borran productos ni categorias existentes.`,
 "Aplicar plantilla",
 "info"
 );

 if (!confirmar) return;

 aplicarCategoriasDeGiro(giro, false);

 alertaPOS(
 `Categorias de ${plantilla.nombre} listas para usar.`,
 "Plantilla aplicada",
 "exito"
 );
}

function abrirSubmenuInventario() {
 const submenu =
 document.getElementById("submenuInventario");

 if (submenu) {
 submenu.classList.add("abierto");
 }
}

function toggleSubmenuInventario() {
 const submenu =
 document.getElementById("submenuInventario");

 if (!submenu) {
 mostrarInventario();
 return;
 }

 submenu.classList.toggle("abierto");
}

function mostrarCategoriasInventario() {
 ocultarPantallasPrincipales();
 abrirSubmenuInventario();
 actualizarDatalistCategorias();

 document.getElementById("pantallaCategoriasInventario").style.display =
 "block";

 renderCategoriasInventario();
}

function productosPorCategoria(nombreCategoria) {
 const normalizada =
 normalizarTexto(nombreCategoria);

 return todosProductos.filter(producto =>
 normalizarTexto(producto.categoria || "") === normalizada
 );
}

function renderCategoriasInventario() {
 const contenedor =
 document.getElementById("listaCategoriasInventario");

 const resumen =
 document.getElementById("resumenCategoriasInventario");

 if (!contenedor) return;

 const categorias =
 categoriasInventarioGuardadas();

 if (resumen) {
 resumen.innerHTML = `
 <div><strong>${categorias.length}</strong><span>Categorias</span></div>
 <div><strong>${todosProductos.length}</strong><span>Productos</span></div>
 <div><strong>${todosProductos.filter(p => !p.categoria).length}</strong><span>Sin categoria</span></div>
 `;
 }

 contenedor.innerHTML =
 categorias.map(categoria => {
 const productos =
 productosPorCategoria(categoria.nombre);

 return `
 <div class="categoria-card">
 <div class="categoria-color" style="background:${categoria.color || "#0d6efd"}"></div>
 <div>
 <strong>${categoria.nombre}</strong>
 <span>${productos.length} productos</span>
 </div>
 <button onclick="abrirModalCategoriaProductos('${categoria.nombre.replace(/'/g, "\\'")}')">
 Ver productos
 </button>
 <button onclick="eliminarCategoriaInventario('${categoria.id}')">
 Eliminar
 </button>
 </div>
 `;
 }).join("");
}

async function abrirFormularioCategoria() {
 const nombre =
 await pedirTextoPOS(
 "Nombre de la categoria:",
 "",
 "Nueva categoria"
 );

 if (!nombre) return;

 const categorias =
 categoriasInventarioGuardadas();

 const existe =
 categorias.some(categoria =>
 normalizarTexto(categoria.nombre) === normalizarTexto(nombre)
 );

 if (existe) {
 alertaPOS("Esa categoria ya existe.", "Categorias", "info");
 return;
 }

 categorias.push({
 id: `cat-${Date.now()}`,
 nombre: nombre.trim(),
 color: "#0d6efd"
 });

 guardarCategoriasInventario(categorias);
 renderCategoriasInventario();
}

async function eliminarCategoriaInventario(id) {
 const confirmar =
 await confirmarPOS(
 "Eliminar esta categoria? Los productos no se borran.",
 "Eliminar categoria",
 "alerta"
 );

 if (!confirmar) return;

 guardarCategoriasInventario(
 categoriasInventarioGuardadas()
 .filter(categoria => categoria.id !== id)
 );

 renderCategoriasInventario();
}

function filtrarInventarioPorCategoria(nombreCategoria) {
 mostrarInventario();

 const campo =
 document.getElementById("buscarInventario");

 if (campo) {
 campo.value = nombreCategoria;
 }

 buscarInventario();
}

function abrirModalCategoriaProductos(nombreCategoria) {
 categoriaModalActual =
 nombreCategoria;

 const titulo =
 document.getElementById("tituloCategoriaProductos");

 const lista =
 document.getElementById("listaProductosCategoria");

 const modal =
 document.getElementById("modalCategoriaProductos");

 if (!titulo || !lista || !modal) return;

 const productos =
 productosPorCategoria(nombreCategoria);

 titulo.textContent =
 `${nombreCategoria} (${productos.length})`;

 lista.innerHTML =
 productos.length === 0
 ? `<div class="categoria-producto-vacio">No hay productos en esta categoria.</div>`
 : productos.slice(0, 12).map(producto => `
 <div class="categoria-producto-row">
 <div>
 <strong>${producto.nombre}</strong>
 <span>${producto.codigo || "Sin codigo"} &middot; ${producto.proveedor || "Sin proveedor"}</span>
 </div>
 <div>
 <small>Stock</small>
 <b>${producto.stock} ${unidadProducto(producto)}</b>
 </div>
 <div>
 <small>Precio</small>
 <b>${dinero(producto.precio || 0)}</b>
 </div>
 </div>
 `).join("");

 if (productos.length > 12) {
 lista.innerHTML += `
 <div class="categoria-producto-vacio">
 ${productos.length - 12} productos mas. Usa "Ver en inventario" para revisar todos.
 </div>
 `;
 }

 modal.style.display =
 "flex";
}

function cerrarModalCategoriaProductos() {
 const modal =
 document.getElementById("modalCategoriaProductos");

 if (modal) {
 modal.style.display = "none";
 }
}

function irInventarioDesdeCategoria() {
 cerrarModalCategoriaProductos();
 filtrarInventarioPorCategoria(categoriaModalActual);
}

function limpiarBusquedaInventario() {
 const campo =
 document.getElementById("buscarInventario");

 if (campo) {
 campo.value = "";
 campo.focus();
 }

 buscarInventario();
}

function limpiarBusquedaPos() {
 const campo =
 document.getElementById("busqueda");

 if (campo) {
 campo.value = "";
 campo.focus();
 }

 buscarProductos();
}

function enfocarBusquedaVentaRapida(limpiar = false) {
 const campo =
 document.getElementById("busqueda");

 if (!campo) return;

 if (limpiar) {
  campo.value = "";
  buscarProductos();
 }

 setTimeout(() => {
  campo.focus();
  campo.select();
 }, 120);
}

function mostrarPuntoVenta() {
 ocultarPantallasPrincipales();

 document.getElementById(
 "pantallaPuntoVenta"
 ).style.display = "block";

 actualizarClientePOS();
 enfocarBusquedaVentaRapida(false);
}

function productosInventarioFiltrados() {
 const campo =
 document.getElementById("buscarInventario");

 const texto =
 (campo?.value || "")
 .toLowerCase()
 .trim();

 if (!texto) return todosProductos;

 return todosProductos.filter(
 producto =>
 String(producto.codigo || "")
 .toLowerCase()
 .includes(texto)
 ||
 String(producto.nombre || "")
 .toLowerCase()
 .includes(texto)
 ||
 String(producto.precio || "")
 .toLowerCase()
 .includes(texto)
 ||
 String(producto.proveedor || "")
 .toLowerCase()
 .includes(texto)
 ||
 String(producto.categoria || "")
 .toLowerCase()
 .includes(texto)
 );
}

function buscarInventario() {
 paginaInventario = 1;
 cargarTablaInventario();
}

function toggleVistaProductosPOS() {
 const listado =
 document.getElementById("productos");

 if (!listado) return;

 listado.classList.toggle("productos-lista-pos");
}

function enfocarFiltroPOS() {
 const buscador =
 document.getElementById("busqueda");

 if (!buscador) return;

 buscador.focus();
 buscador.select();
 buscador.closest(".buscador-con-limpiar")?.classList.add("filtro-activo-pos");
 setTimeout(() => {
  buscador.closest(".buscador-con-limpiar")?.classList.remove("filtro-activo-pos");
 }, 1400);
}

function renderPaginacion(contenedorId, totalItems, paginaActual, tamanoPagina, funcionCambio) {
 const contenedor =
 document.getElementById(contenedorId);

 if (!contenedor) return;

 const totalPaginas =
 Math.max(1, Math.ceil(totalItems / tamanoPagina));

 if (totalPaginas <= 1) {
 contenedor.innerHTML = "";
 return;
 }

 const botones = [];

 for (let pagina = 1; pagina <= totalPaginas; pagina++) {
 botones.push(`
 <button
 class="${pagina === paginaActual ? "activo" : ""}"
 onclick="${funcionCambio}(${pagina})"
 >
 ${pagina}
 </button>
 `);
 }

 contenedor.innerHTML = `
 <button onclick="${funcionCambio}(${Math.max(1, paginaActual - 1)})">
 Anterior
 </button>
 ${botones.join("")}
 <button onclick="${funcionCambio}(${Math.min(totalPaginas, paginaActual + 1)})">
 Siguiente
 </button>
 `;
}

function cambiarPaginaInventario(pagina) {
 paginaInventario = pagina;
 cargarTablaInventario();
}

function cambiarPaginaInventarioBajo(pagina) {
 paginaInventarioBajo = pagina;
 renderInventarioBajo(false);
}

function cambiarPaginaReporteVentas(pagina) {
 paginaReporteVentas = pagina;
 cargarReportesVentas();
}

function productosBajoStock() {
 const texto =
 (document.getElementById("buscarInventarioBajo")?.value || "")
 .toLowerCase()
 .trim();

 const bajos =
 todosProductos.filter(
 producto =>
 Number(producto.stock) <= 5
 );

 if (!texto) return bajos;

 return bajos.filter(producto =>
 String(producto.codigo || "").toLowerCase().includes(texto)
 ||
 String(producto.nombre || "").toLowerCase().includes(texto)
 ||
 String(producto.proveedor || "").toLowerCase().includes(texto)
 );
}

function renderInventarioBajo(resetearPagina = true) {
 const tabla =
 document.getElementById("tablaInventarioBajo");

 if (!tabla) return;

 if (resetearPagina) {
 paginaInventarioBajo = 1;
 }

 const bajos =
 productosBajoStock();

 const todosBajos =
 todosProductos.filter(
 producto =>
 Number(producto.stock) <= 5
 );

 const sinStock =
 todosBajos.filter(
 producto =>
 Number(producto.stock) <= 0
 );

 const reposicion =
 todosBajos.reduce(
 (total, producto) =>
 total + Math.max(0, 10 - Number(producto.stock || 0)),
 0
 );

 document.getElementById("bajoTotal").textContent =
 todosBajos.length;

 document.getElementById("bajoSinStock").textContent =
 sinStock.length;

 document.getElementById("bajoReposicion").textContent =
 reposicion;

 if (bajos.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="bajo-vacio">
 No hay productos bajos con ese filtro.
 </td>
 </tr>
 `;
 renderPaginacion(
 "paginacionInventarioBajo",
 0,
 1,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaInventarioBajo"
 );
 return;
 }

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(bajos.length / TAMANO_PAGINA_INVENTARIO)
 );

 paginaInventarioBajo =
 Math.min(paginaInventarioBajo, totalPaginas);

 const inicio =
 (paginaInventarioBajo - 1) * TAMANO_PAGINA_INVENTARIO;

 const bajosPagina =
 bajos.slice(
 inicio,
 inicio + TAMANO_PAGINA_INVENTARIO
 );

 tabla.innerHTML =
 bajosPagina.map(producto => {
 const stock =
 Number(producto.stock || 0);

 const estado =
 stock <= 0
 ? "Sin existencia"
 : stock <= 2
 ? "Critico"
 : "Bajo";

 const clase =
 stock <= 0
 ? "sin-stock"
 : stock <= 2
 ? "critico"
 : "bajo";

 return `
 <tr>
 <td>
 <strong>${producto.nombre}</strong>
 <span>${dinero(producto.precio || 0)}</span>
 </td>
 <td>${producto.codigo || "-"}</td>
 <td>${producto.proveedor || "-"}</td>
 <td>
 <strong class="stock-bajo-numero">${stock}</strong>
 </td>
 <td>
 <span class="estado-bajo ${clase}">
 ${estado}
 </span>
 </td>
 <td class="acciones-bajo">
 <button onclick="abrirModalInventarioBajo(${producto.id})">
 Detalle
 </button>
 <button onclick="mostrarInventario(); document.getElementById('buscarInventario').value='${producto.nombre.replace(/'/g, "")}'; buscarInventario();">
 Ver
 </button>
 </td>
 </tr>
 `;
 }).join("");

 renderPaginacion(
 "paginacionInventarioBajo",
 bajos.length,
 paginaInventarioBajo,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaInventarioBajo"
 );
}

function asegurarModalInventarioBajo() {
 let modal =
 document.getElementById("modalInventarioBajoDetalle");

 if (modal) return modal;

 modal = document.createElement("div");
 modal.id = "modalInventarioBajoDetalle";
 modal.className = "modal-personalizado modal-inventario-bajo";
 modal.style.display = "none";
 document.body.appendChild(modal);
 return modal;
}

function abrirModalInventarioBajo(id) {
 const producto =
 todosProductos.find(item => Number(item.id) === Number(id));

 if (!producto) return;

 const stock =
 Number(producto.stock || 0);

 const minimo =
 Number(producto.stock_minimo ?? producto.stockMinimo ?? 5);

 const sugerido =
 Math.max(1, minimo * 2 - stock);

 const modal =
 asegurarModalInventarioBajo();

 modal.innerHTML = `
 <div class="modal-card inventario-bajo-card">
 <div class="modal-card-header">
 <div>
 <span>Inventario bajo</span>
 <h3>${producto.nombre || "Producto"}</h3>
 </div>
 <button type="button" onclick="cerrarModalInventarioBajo()">Cerrar</button>
 </div>
 <div class="inventario-bajo-detalle">
 <div><span>Codigo</span><strong>${producto.codigo || "-"}</strong></div>
 <div><span>Proveedor</span><strong>${producto.proveedor || "-"}</strong></div>
 <div><span>Stock actual</span><strong>${stock} ${unidadProducto(producto)}</strong></div>
 <div><span>Minimo</span><strong>${minimo} ${unidadProducto(producto)}</strong></div>
 <div><span>Sugerido</span><strong>${sugerido} ${unidadProducto(producto)}</strong></div>
 <div><span>Precio</span><strong>${dinero(producto.precio || 0)}</strong></div>
 </div>
 <div class="modal-actions-row">
 <button type="button" onclick="cerrarModalInventarioBajo()">Cerrar</button>
 <button type="button" class="btn-principal" onclick="cerrarModalInventarioBajo(); editarProducto(${producto.id})">Editar producto</button>
 </div>
 </div>
 `;

 modal.style.display = "flex";
}

function cerrarModalInventarioBajo() {
 const modal =
 document.getElementById("modalInventarioBajoDetalle");

 if (modal) modal.style.display = "none";
}

function generarSugerenciaPedido() {
 const bajos =
 productosBajoStock();

 if (bajos.length === 0) {
 alertaPOS(
 "No hay productos bajos para sugerir pedido.",
 "Sugerencia de pedido",
 "info"
 );
 return;
 }

 const contenedor =
 document.getElementById("listaSugerenciaPedido");

 if (!contenedor) return;

 contenedor.innerHTML =
 bajos.map(producto => {
 const stock =
 Number(producto.stock || 0);

 const cantidad =
 Math.max(1, 10 - stock);

 return `
 <div class="pedido-item">
 <div>
 <strong>${producto.nombre}</strong>
 <span>${producto.codigo || "Sin codigo"} &middot; ${producto.proveedor || "Sin proveedor"}</span>
 </div>
 <div>
 <small>Stock actual</small>
 <b>${stock} ${unidadProducto(producto)}</b>
 </div>
 <div>
 <small>Pedir</small>
 <b>${cantidad} ${unidadProducto(producto)}</b>
 </div>
 </div>
 `;
 }).join("");

 document.getElementById("modalSugerenciaPedido").style.display =
 "flex";
}

function cerrarSugerenciaPedido() {
 document.getElementById("modalSugerenciaPedido").style.display =
 "none";
}

function imprimirSugerenciaPedido() {
 const contenido =
 document.getElementById("listaSugerenciaPedido");

 if (!contenido || !contenido.innerHTML.trim()) {
  alertaPOS("Genera primero una sugerencia de pedido.", "Imprimir pedido", "info");
  return;
 }

 const negocio =
 configuracionNegocio() || {};

 const ventana =
 window.open("", "_blank", "width=900,height=720");

 ventana.document.write(`
 <html>
 <head>
 <title>Pedido sugerido</title>
 <style>
 body{font-family:Arial,sans-serif;color:#111827;padding:24px;}
 h1{font-size:22px;margin:0 0 4px;}
 p{margin:0 0 18px;color:#475467;}
 table{width:100%;border-collapse:collapse;}
 th,td{border-bottom:1px solid #d0d5dd;padding:8px;text-align:left;font-size:12px;}
 .pedido-item{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:12px;border-bottom:1px solid #d0d5dd;padding:10px 0;}
 .pedido-item span,.pedido-item small{display:block;color:#667085;font-size:12px;}
 </style>
 </head>
 <body>
 <h1>${negocio.nombre || "Pedido sugerido"}</h1>
 <p>${new Date().toLocaleString("es-MX")}</p>
 ${contenido.innerHTML}
 <script>window.print();</script>
 </body>
 </html>
 `);
 ventana.document.close();
}

function cargarTablaInventario() {
 const tabla =
 document.getElementById("tablaInventario");

 if (!tabla) return;

 tabla.innerHTML = "";

 const productos =
 productosInventarioFiltrados();

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(productos.length / TAMANO_PAGINA_INVENTARIO)
 );

 paginaInventario =
 Math.min(paginaInventario, totalPaginas);

 const inicio =
 (paginaInventario - 1) * TAMANO_PAGINA_INVENTARIO;

 const productosPagina =
 productos.slice(
 inicio,
 inicio + TAMANO_PAGINA_INVENTARIO
 );

 if (productos.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="inventario-vacio">
 No se encontraron productos.
 </td>
 </tr>
 `;
 renderPaginacion(
 "paginacionInventario",
 0,
 1,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaInventario"
 );
 return;
 }

 productosPagina.forEach((producto) => {
 const stock =
 Number(producto.stock);

 const unidad =
 unidadProducto(producto);

 const estadoClase =
 stock <= 0
 ? "sin-stock"
 : stock <= 5
 ? "bajo"
 : "ok";

 const estadoTexto =
 stock <= 0
 ? "Sin stock"
 : stock <= 5
 ? "Bajo"
 : "En stock";

 tabla.innerHTML += `
 <tr>
 <td>${producto.codigo || "-"}</td>
 <td>${producto.nombre}</td>
 <td>$${Number(producto.precio).toFixed(2)}</td>
 <td>${producto.stock} ${unidad}</td>
 <td>
 <span class="estado-inventario ${estadoClase}">
 ${estadoTexto}
 </span>
 </td>
 <td class="acciones-inventario">
 <button title="Editar" onclick="editarProducto(${producto.id})">
 Editar
 </button>

 <button title="Eliminar" onclick="eliminarProducto(${producto.id})">
 Eliminar
 </button>
 </td>
 </tr>
 `;
 });

 renderPaginacion(
 "paginacionInventario",
 productos.length,
 paginaInventario,
 TAMANO_PAGINA_INVENTARIO,
 "cambiarPaginaInventario"
 );
}
function mostrarFormularioAgregar() {
 asegurarSelectorTipoPrecio();
 asegurarEtiquetasFichaProducto();
 inicializarCampoCodigoProducto();

 document
 .getElementById("nuevoCodigo")
 ?.setAttribute("autocomplete", "off");

 document
 .getElementById("nuevoStock")
 ?.setAttribute("autocomplete", "off");

 if (!productoEditandoId) {
 seleccionarTipoProducto(
 document.getElementById("tipoProductoInventario")?.value ||
 "catalogo"
 );

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Agregar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Guardar producto";
 }
 }

 document.getElementById(
 "modalAgregar"
 ).style.display = "flex";

 setTimeout(() => {
 const campoCodigo =
 document.getElementById("nuevoCodigo");

 campoCodigo?.focus();
 campoCodigo?.select();
 }, 80);
}

function inicializarCampoCodigoProducto() {
 const campo =
 document.getElementById("nuevoCodigo");

 if (!campo || campo.dataset.lectorListo === "1") return;

 campo.dataset.lectorListo = "1";

 const buscarConPausa = () => {
 clearTimeout(campo._temporizadorCatalogo);
 campo._temporizadorCatalogo =
 setTimeout(buscarEnCatalogo, 80);
 };

 campo.addEventListener("input", buscarConPausa);
 campo.addEventListener("change", buscarEnCatalogo);
 campo.addEventListener("paste", buscarConPausa);
 campo.addEventListener("keydown", event => {
 if (event.key === "Enter") {
 event.preventDefault();
 buscarEnCatalogo();
 }
 });
}

function cerrarFormularioAgregar() {
 productoEditandoId = null;

 document.getElementById("nuevoCodigo").value = "";
 delete document.getElementById("nuevoCodigo").dataset.codigoAutomatico;
 document.getElementById("nuevoNombre").value = "";
 document.getElementById("precioDistribuidor").value = "";
 document.getElementById("precioMayoreo").value = "";
 document.getElementById("nuevoPrecio").value = "";
 document.getElementById("nuevoStock").value = "";
 document.getElementById("stockMinimo").value = "3";
 document.getElementById("nuevoProveedor").value = "";
 document.getElementById("nuevaUbicacion").value = "";
 document.getElementById("altaRotacion").value = "";
 document.getElementById("nuevoCodigoInterno").value = "";
 document.getElementById("codigosRelacionados").value = "";
 document.getElementById("nuevaCategoria").value = "";
 document.getElementById("nuevaSubcategoria").value = "";
 document.getElementById("nuevaMarca").value = "";
 document.getElementById("nuevaDescripcion").value = "";
 document.getElementById("unidadVenta").value = "pieza";
 document.getElementById("precioPublico").value = "";
 document.getElementById("tipoProductoInventario").value = "catalogo";
 document.getElementById("presentacionCompra").value = "";
 document.getElementById("factorConversion").value = "";
 document.getElementById("basculaDigital").value = "no";
 seleccionarTipoProducto("catalogo");

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Agregar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Guardar producto";
 }

 document.getElementById(
 "modalAgregar"
 ).style.display = "none";
}
function buscarEnCatalogo() {
 const codigo =
 normalizarCodigo(
 document
 .getElementById("nuevoCodigo")
 .value
 );

 if (!codigo) {
 document.getElementById("nuevoNombre").value = "";
 document.getElementById("precioDistribuidor").value = "";
 document.getElementById("precioMayoreo").value = "";
 document.getElementById("nuevoPrecio").value = "";
 document.getElementById("precioPublico").value = "";
 document.getElementById("nuevoProveedor").value = "";
 document.getElementById("nuevoCodigoInterno").value = "";
 document.getElementById("codigosRelacionados").value = "";
 document.getElementById("nuevaCategoria").value = "";
 document.getElementById("nuevaMarca").value = "";
 document.getElementById("nuevaDescripcion").value = "";
 document.getElementById("stockMinimo").value = "3";
 document.getElementById("altaRotacion").value = "";
 document.getElementById("presentacionCompra").value = "";
 document.getElementById("factorConversion").value = "";
 document.getElementById("basculaDigital").value = "no";
 return;
 }

 const producto =
 productoDesdeCatalogo(codigo);

 if (!producto) return;

 seleccionarTipoProducto("catalogo");

 document.getElementById(
 "nuevoNombre"
 ).value =
 producto.nombre || "";

 document.getElementById(
 "precioDistribuidor"
 ).value =
 producto.distribuidor || "";

 document.getElementById(
 "precioMayoreo"
 ).value =
 producto.medioMayoreo || "";

 document.getElementById(
 "nuevoPrecio"
 ).value =
 producto.medioMayoreo ||
 producto.publico ||
 producto.distribuidor ||
 "";

 document.getElementById("precioPublico").value =
 producto.publico || "";

 document.getElementById("nuevoPrecio").dataset.distribuidor =
 producto.distribuidor || "";

 document.getElementById("nuevoPrecio").dataset.medioMayoreo =
 producto.medioMayoreo || "";

 document.getElementById("nuevoPrecio").dataset.publico =
 producto.publico || "";

 document.getElementById("nuevoPrecio").dataset.precioDetectado =
 producto.precioDetectado || "medio mayoreo";

 document.getElementById("tipoPrecioVenta").value =
 "medioMayoreo";

 const opcionMedioMayoreo =
 document.querySelector("#tipoPrecioVenta option[value='medioMayoreo']");

 if (opcionMedioMayoreo) {
 opcionMedioMayoreo.textContent =
 producto.precioDetectado === "medio mayoreo con IVA"
 ? "Medio mayoreo con IVA"
 : "Medio mayoreo";
 }

 document.getElementById("nuevoProveedor").value =
 producto.proveedor ||
 localStorage.getItem("ultimoProveedorCatalogo") ||
 ultimoProveedorCatalogo() ||
 "Diprofer";

 document.getElementById("nuevoCodigoInterno").value =
 producto.codigoInterno || "";

 document.getElementById("codigosRelacionados").value =
 (producto.codigosRelacionados || [])
 .join(", ");

 document.getElementById("nuevaCategoria").value =
 producto.categoria || "";

 document.getElementById("nuevaMarca").value =
 producto.marca || "";

 document.getElementById("nuevaDescripcion").value =
 producto.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto.unidadVenta || "pieza";

 document.getElementById(
 "stockMinimo"
 ).value =
 producto.stockMinimo || 3;

 document.getElementById(
 "altaRotacion"
 ).value =
 producto.altaRotacion || "";

 enfocarStockNuevoProducto();

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

async function cargarCreditos() {
 const respuesta =
 await fetch("/creditos");

 if (!respuesta.ok) {
 const error =
 await respuesta.json()
 .catch(() => ({}));

 throw new Error(
 error.error ||
 "No se pudieron cargar los creditos"
 );
 }

 const datos =
 await respuesta.json();

 clientesCredito =
 datos.clientes || [];

 if (clienteVentaActual && Number(clienteVentaActual.id)) {
  clienteVentaActual =
  clientesCredito.find(cliente => Number(cliente.id) === Number(clienteVentaActual.id)) ||
  clienteVentaActual;
  actualizarClientePOS();
 }

 const creditoPendiente =
 document.getElementById(
 "creditoPendiente"
 );

 const clientesDeuda =
 document.getElementById(
 "clientesDeuda"
 );

 if (creditoPendiente) {
 const deudaReal =
 clientesCredito.reduce(
 (total, cliente) =>
 total + Math.max(0, Number(cliente.saldo || 0)),
 0
 );

 creditoPendiente.textContent =
 dinero(deudaReal);
 }

 if (clientesDeuda) {
 const conAdeudo =
 clientesCredito.filter(cliente =>
 Number(cliente.saldo || 0) > 0
 ).length;

 clientesDeuda.textContent =
 `${conAdeudo} clientes`;
 }

 renderCreditos(datos);

 if (
 document.getElementById("pantallaClientes")?.style.display === "block"
 ) {
 renderClientes();
 }
}

function renderCreditos(datos) {
 const lista =
 document.querySelector(
 ".creditos-principales"
 );

 const resumen =
 document.querySelector(
 "#listaCreditos .credito-resumen"
 );

 if (!lista || !resumen) return;

 if (clientesCredito.length === 0) {
 lista.innerHTML =
 `<div class="cliente-credito">
 <h3>Sin clientes</h3>
 <p>No hay cuentas de credito registradas.</p>
 </div>`;
 } else {
 lista.innerHTML =
 clientesCredito.map(cliente => `
 <div class="cliente-credito">
 <div class="cliente-credito-top">
 <span class="cliente-avatar"></span>
 <div>
 <h3>${cliente.nombre}</h3>
 <p>Saldo: <strong>${dinero(cliente.saldo)}</strong></p>
 </div>
 </div>
 <p class="estado-credito">
 ${Number(cliente.saldo) > 0 ? " Con adeudo" : " Sin adeudo"}
 </p>
 <button onclick="abrirCuentaCliente(${cliente.id})">
 Ver cuenta
 </button>
 </div>
 `).join("");
 }

 resumen.innerHTML = `
 <div>
 <strong>${dinero(datos.total)}</strong>
 <span>Credito total</span>
 </div>
 <div>
 <strong>${datos.clientesConAdeudo || 0}</strong>
 <span>Clientes con adeudo</span>
 </div>
 <div>
 <strong>${clientesCredito.length}</strong>
 <span>Clientes registrados</span>
 </div>
 <div>
 <strong>${clientesCredito.filter(c => Number(c.saldo) <= 0).length}</strong>
 <span>Sin adeudo</span>
 </div>
 `;
}

async function abrirCreditos() {
 document.getElementById(
 "modalCreditos"
 ).style.display = "flex";

 try {
 await cargarCreditos();
 } catch (error) {
 const lista =
 document.querySelector(
 ".creditos-principales"
 );

 if (lista) {
 lista.innerHTML =
 `<div class="cliente-credito">
 <h3>Error cargando creditos</h3>
 <p>${error.message}</p>
 </div>`;
 }

 alert(error.message);
 }
}

function cerrarCreditos() {
 document.getElementById("modalCreditos").style.display = "none";
 document.getElementById("listaCreditos").style.display = "grid";
 document.getElementById("detalleCliente").style.display = "none";
}

async function abrirCuentaCliente(id) {
 if (!id) {
 alert(
 "Primero carga o crea un cliente de credito."
 );
 return;
 }

 const respuesta =
 await fetch(`/creditos/clientes/${id}`);

 if (!respuesta.ok) {
 alert("No se pudo abrir la cuenta");
 return;
 }

 const datos =
 await respuesta.json();

 creditoActual =
 datos.cliente;

 const saldo =
 Number(datos.cliente.saldo || 0);

 const limite =
 Number(datos.cliente.limite_credito || 0);

 const disponible =
 limite - saldo;

 document.querySelector(
 "#detalleCliente .cliente-info h2"
 ).textContent =
 datos.cliente.nombre;

 document.querySelector(
 "#detalleCliente .cliente-info p"
 ).textContent =
 `Cliente desde: ${
 new Date(datos.cliente.created_at)
 .toLocaleDateString("es-MX")
 }`;

 document.querySelector(
 "#detalleCliente .limite-credito strong"
 ).textContent =
 dinero(limite);

 const tarjetas =
 document.querySelectorAll(
 "#detalleCliente .credito-resumen .resumen-card strong"
 );

 if (tarjetas.length >= 4) {
 tarjetas[0].textContent = dinero(saldo);
 tarjetas[1].textContent = dinero(saldo);
 tarjetas[2].textContent = dinero(disponible);
 tarjetas[3].textContent =
 saldo > limite && limite > 0
 ? "Excedido"
 : saldo > 0
 ? "Por vencer"
 : "Al corriente";
 }

 const cuerpo =
 document.querySelector(
 "#detalleCliente .tabla-creditos tbody"
 );

 let saldoAcumulado = 0;

 window.movimientosCreditoActuales =
 datos.movimientos || [];

 cuerpo.innerHTML =
 datos.movimientos.map((movimiento, indice) => {
 const monto =
 Number(movimiento.monto);

 const productosMovimiento =
 Array.isArray(movimiento.productos)
 ? movimiento.productos
 : [];

 saldoAcumulado +=
 movimiento.tipo === "venta"
 ? monto
 : -monto;

 return `
 <tr>
 <td>${
 new Date(movimiento.fecha)
 .toLocaleDateString("es-MX")
 }</td>
 <td>${
 movimiento.tipo === "venta"
 ? " Venta"
 : " Abono"
 }</td>
 <td>${movimiento.referencia || ""}</td>
 <td>
 ${movimiento.concepto || ""}
 ${
 productosMovimiento.length > 0
 ? `<br><button class="btn-ver-detalle-venta" onclick="verDetalleVentaCredito(${indice})">Ver detalle</button>`
 : ""
 }
 </td>
 <td>${
 movimiento.tipo === "venta"
 ? dinero(monto)
 : `-${dinero(monto)}`
 }</td>
 <td>${dinero(saldoAcumulado)}</td>
 </tr>
 `;
 }).join("");

 document.getElementById("listaCreditos").style.display = "none";
 document.getElementById("detalleCliente").style.display = "block";
}

function regresarListaCreditos() {
 document.getElementById("listaCreditos").style.display = "grid";
 document.getElementById("detalleCliente").style.display = "none";
}

function verDetalleVentaCredito(indice) {
 const movimiento =
 (window.movimientosCreditoActuales || [])[indice];

 if (!movimiento) return;

 const productos =
 Array.isArray(movimiento.productos)
 ? movimiento.productos
 : [];

 let modal =
 document.getElementById("modalDetalleVentaCredito");

 if (!modal) {
 modal =
 document.createElement("div");

 modal.id =
 "modalDetalleVentaCredito";

 modal.className =
 "modal-form-credito";

 document.body.appendChild(modal);
 }

 const total =
 productos.reduce(
 (suma, producto) =>
 suma + Number(producto.importe || 0),
 0
 );

 modal.innerHTML = `
 <div class="detalle-venta-card">
 <div class="detalle-venta-header">
 <button onclick="cerrarDetalleVentaCredito()">Regresar</button>
 <div>
 <h2>Detalle de venta ${movimiento.referencia || ""}</h2>
 <p>${new Date(movimiento.fecha).toLocaleDateString("es-MX")}</p>
 </div>
 </div>

 <div class="detalle-venta-resumen">
 <div>
 <span>Total de la venta</span>
 <strong>${dinero(movimiento.monto || total)}</strong>
 </div>
 <div>
 <span>Productos</span>
 <strong>${productos.length}</strong>
 </div>
 </div>

 <table class="tabla-detalle-venta">
 <thead>
 <tr>
 <th>Cantidad</th>
 <th>Producto</th>
 <th>Precio unitario</th>
 <th>Importe</th>
 </tr>
 </thead>
 <tbody>
 ${productos.map(producto => `
 <tr>
 <td>${producto.cantidad || 1}</td>
 <td>${producto.nombre}</td>
 <td>${dinero(producto.precio || 0)}</td>
 <td>${dinero(producto.importe || 0)}</td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 </div>
 `;

 modal.style.display =
 "flex";
}

function cerrarDetalleVentaCredito() {
 const modal =
 document.getElementById("modalDetalleVentaCredito");

 if (modal) {
 modal.style.display = "none";
 }
}

function abrirFormularioCredito(configuracion) {
 const modal =
 document.getElementById(
 "modalFormularioCredito"
 );

 const titulo =
 document.getElementById(
 "formCreditoTitulo"
 );

 const subtitulo =
 document.getElementById(
 "formCreditoSubtitulo"
 );

 const campos =
 document.getElementById(
 "formCreditoCampos"
 );

 titulo.textContent =
 configuracion.titulo;

 subtitulo.textContent =
 configuracion.subtitulo || "";

 campos.innerHTML =
 configuracion.campos.map(campo => `
 <label>
 <span>${campo.etiqueta}</span>
 ${
 campo.tipo === "select"
 ? `<select id="creditoCampo_${campo.nombre}" ${campo.requerido ? "required" : ""}>
 ${(campo.opciones || []).map(opcion => `
 <option value="${opcion.valor}">
 ${opcion.etiqueta}
 </option>
 `).join("")}
 </select>`
 : `<input
 id="creditoCampo_${campo.nombre}"
 type="${campo.tipo || "text"}"
 placeholder="${campo.placeholder || ""}"
 value="${campo.valor || ""}"
 ${campo.min !== undefined ? `min="${campo.min}"` : ""}
 ${campo.requerido ? "required" : ""}
 >`
 }
 </label>
 `).join("");

 campos.onsubmit = event => {
  event.preventDefault();
  guardarFormularioCredito();
 };

 campos.onkeydown = event => {
  if (event.key !== "Enter") return;
  if (event.target?.tagName === "TEXTAREA") return;

  event.preventDefault();
  guardarFormularioCredito();
 };

 modal.style.display = "flex";

 setTimeout(() => {
 const primerCampo =
 campos.querySelector("select, input");

 if (!primerCampo) return;

 primerCampo.focus();

 if (
 primerCampo.tagName === "INPUT" &&
 typeof primerCampo.setSelectionRange === "function"
 ) {
  const final =
  primerCampo.value.length;

  primerCampo.setSelectionRange(final, final);
 }
 }, 50);

 return new Promise(resolve => {
 resolverFormularioCredito = {
 resolve,
 campos: configuracion.campos
 };
 });
}

function cerrarFormularioCredito() {
 const modal =
 document.getElementById(
 "modalFormularioCredito"
 );

 modal.style.display = "none";

 if (resolverFormularioCredito) {
 resolverFormularioCredito.resolve(null);
 resolverFormularioCredito = null;
 }
}

function guardarFormularioCredito() {
 if (!resolverFormularioCredito) return;

 const datos = {};

 for (const campo of resolverFormularioCredito.campos) {
 const input =
 document.getElementById(
 `creditoCampo_${campo.nombre}`
 );

 const valor =
 input.value.trim();

 if (campo.requerido && !valor) {
 input.focus();
 return;
 }

 datos[campo.nombre] =
 campo.tipo === "number"
 ? Number(valor || 0)
 : valor;
 }

 const resolver =
 resolverFormularioCredito.resolve;

 resolverFormularioCredito = null;

 document.getElementById(
 "modalFormularioCredito"
 ).style.display = "none";

 resolver(datos);
}

async function abrirNuevoClienteCredito() {
 const datos =
 await abrirFormularioCredito({
 titulo: "Nuevo cliente",
 subtitulo: "Agrega una cuenta de credito",
 campos: [
 {
 nombre: "nombre",
 etiqueta: "Nombre del cliente",
 placeholder: "Ej. Constructora Lopez",
 requerido: true
 },
 {
 nombre: "telefono",
 etiqueta: "Telefono",
 placeholder: "Ej. 498 000 0000"
 },
 {
 nombre: "limiteCredito",
 etiqueta: "Limite de credito",
 tipo: "number",
 placeholder: "0",
 valor: "0",
 min: 0
 }
 ]
 });

 if (!datos) return;

 const payloadCliente = {
 nombre: datos.nombre,
 telefono: datos.telefono,
 limiteCredito: datos.limiteCredito
 };

 let respuesta;
 let clienteOffline = false;

 try {
 respuesta =
 await fetch(
 "/creditos/clientes",
 {
 method: "POST",
 headers: {
 "Content-Type":
 "application/json"
 },
 body: JSON.stringify(payloadCliente)
 }
 );
 } catch (error) {
 const idLocal =
 -Date.now();

 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "cliente_credito_creado",
 "cliente_credito",
 "",
 {
 ...payloadCliente,
 clienteId: null,
 localId: idLocal,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 alert("No se pudo crear el cliente");
 return;
 }

 clientesCredito = [
 {
 id: idLocal,
 nombre: payloadCliente.nombre,
 telefono: payloadCliente.telefono,
 limite_credito: payloadCliente.limiteCredito || 0,
 saldo: 0,
 created_at: new Date().toISOString(),
 pendienteSync: true
 },
 ...clientesCredito
 ];

 clienteOffline = true;
 }

 if (!clienteOffline && !respuesta.ok) {
 alert("No se pudo crear el cliente");
 return;
 }

 if (clienteOffline) {
 await guardarCatalogosLocalesDesktopPOS();
 renderCreditos({
 clientes: clientesCredito,
 total: clientesCredito.reduce((suma, cliente) => suma + Number(cliente.saldo || 0), 0),
 clientesConAdeudo: clientesCredito.filter(cliente => Number(cliente.saldo || 0) > 0).length
 });
 await alertaPOS("Cliente guardado offline. Se sincronizara cuando vuelva el internet.", "Cliente offline", "exito");
 } else {
 await cargarCreditos();
 }
}

async function registrarAbonoCredito() {
 if (!creditoActual) {
 alert(
 "Primero abre la cuenta de un cliente."
 );
 return;
 }

 const datos =
 await abrirFormularioCredito({
 titulo: "Registrar abono",
 subtitulo: creditoActual.nombre,
 campos: [
 {
 nombre: "monto",
 etiqueta: "Monto del abono",
 tipo: "number",
 placeholder: "0",
 valor: "0",
 min: 1,
 requerido: true
 },
 {
 nombre: "concepto",
 etiqueta: "Concepto",
 placeholder: "Pago parcial",
 valor: "Pago parcial"
 }
 ]
 });

 if (!datos) return;

 const monto =
 Number(datos.monto);

 if (monto <= 0) return;

 const concepto =
 datos.concepto ||
 "Pago parcial";

 await fetch(
 `/creditos/clientes/${creditoActual.id}/abonos`,
 {
 method: "POST",
 headers: {
 "Content-Type":
 "application/json"
 },
 body: JSON.stringify({
 monto,
 concepto
 })
 }
 );

 await cargarCreditos();
 await abrirCuentaCliente(creditoActual.id);
}

async function registrarCargoCredito() {
 if (!(await validarOperacionLicenciaNexoPOS("un cargo a credito"))) return;

 if (!creditoActual) {
 alert(
 "Primero abre la cuenta de un cliente."
 );
 return;
 }

 const datos =
 await abrirFormularioCredito({
 titulo: "Registrar cargo",
 subtitulo: creditoActual.nombre,
 campos: [
 {
 nombre: "monto",
 etiqueta: "Monto del cargo",
 tipo: "number",
 placeholder: "0",
 valor: "0",
 min: 1,
 requerido: true
 },
 {
 nombre: "concepto",
 etiqueta: "Concepto",
 placeholder: "Venta a credito",
 valor: "Venta a credito"
 }
 ]
 });

 if (!datos) return;

 const monto =
 Number(datos.monto);

 if (monto <= 0) return;

 const concepto =
 datos.concepto ||
 "Venta a credito";

 await fetch(
 `/creditos/clientes/${creditoActual.id}/cargos`,
 {
 method: "POST",
 headers: {
 "Content-Type":
 "application/json"
 },
 body: JSON.stringify({
 monto,
 concepto,
 productos: []
 })
 }
 );

 await cargarCreditos();
 await abrirCuentaCliente(creditoActual.id);
}

function verTodosCreditos() {
 cargarCreditos();
}

async function mostrarClientes() {
 document.getElementById("pantallaInicio").style.display = "none";
 document.getElementById("pantallaPuntoVenta").style.display = "none";
 document.getElementById("pantallaInventario").style.display = "none";
 document.getElementById("pantallaCategoriasInventario").style.display = "none";
 document.getElementById("pantallaCatalogo").style.display = "none";
 document.getElementById("pantallaProveedores").style.display = "none";
 document.getElementById("pantallaInventarioBajo").style.display = "none";
 document.getElementById("pantallaReportes").style.display = "none";
 document.getElementById("pantallaClientes").style.display = "block";

 await cargarCreditos();
 renderClientes();
}

function clientesFiltrados() {
 const texto =
 (document.getElementById("buscarClientes")?.value || "")
 .toLowerCase()
 .trim();

 if (!texto) return clientesCredito;

 return clientesCredito.filter(cliente =>
 String(cliente.nombre || "").toLowerCase().includes(texto)
 ||
 String(cliente.telefono || "").toLowerCase().includes(texto)
 ||
 String(cliente.saldo || "").toLowerCase().includes(texto)
 );
}

function buscarClientes() {
 renderClientes();
}

function renderClientes() {
 const tabla =
 document.getElementById("tablaClientes");

 if (!tabla) return;

 const clientes =
 clientesFiltrados();

 const total =
 clientesCredito.reduce(
 (suma, cliente) =>
 suma + Number(cliente.saldo || 0),
 0
 );

 document.getElementById("clientesTotal").textContent =
 clientesCredito.length;

 document.getElementById("clientesConAdeudo").textContent =
 clientesCredito.filter(
 cliente =>
 Number(cliente.saldo || 0) > 0
 ).length;

 document.getElementById("clientesCreditoTotal").textContent =
 dinero(total);

 if (clientes.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="clientes-vacio">
 No hay clientes para mostrar.
 </td>
 </tr>
 `;
 return;
 }

 tabla.innerHTML =
 clientes.map(cliente => {
 const saldo =
 Number(cliente.saldo || 0);

 return `
 <tr>
 <td>
 <strong>${cliente.nombre}</strong>
 <span>Cliente desde ${
 new Date(cliente.created_at)
 .toLocaleDateString("es-MX")
 }</span>
 </td>
 <td>${cliente.telefono || "-"}</td>
 <td class="${saldo > 0 ? "cliente-saldo-rojo" : "cliente-saldo-ok"}">
 ${dinero(saldo)}
 </td>
 <td>${dinero(cliente.limite_credito || 0)}</td>
 <td>
 <span class="estado-cliente ${saldo > 0 ? "adeudo" : "ok"}">
 ${saldo > 0 ? "Con adeudo" : "Al corriente"}
 </span>
 </td>
 <td class="acciones-clientes">
 <button onclick="verCreditoDesdeClientes(${cliente.id})">
 Cuenta
 </button>
 <button onclick="editarClienteCredito(${cliente.id})">
 Editar
 </button>
 <button onclick="desactivarClienteCredito(${cliente.id})">
 Baja
 </button>
 </td>
 </tr>
 `;
 }).join("");
}

async function verCreditoDesdeClientes(id) {
 await abrirCreditos();
 await abrirCuentaCliente(id);
}

async function editarClienteCredito(id) {
 const cliente =
 clientesCredito.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!cliente) return;

 const datos =
 await abrirFormularioCredito({
 titulo: "Editar cliente",
 subtitulo: "Actualiza los datos de credito",
 campos: [
 {
 nombre: "nombre",
 etiqueta: "Nombre del cliente",
 valor: cliente.nombre,
 requerido: true
 },
 {
 nombre: "telefono",
 etiqueta: "Telefono",
 valor: cliente.telefono || ""
 },
 {
 nombre: "limiteCredito",
 etiqueta: "Limite de credito",
 tipo: "number",
 valor: cliente.limite_credito || 0
 }
 ]
 });

 if (!datos) return;

 let respuesta;
 let clienteOffline = false;

 try {
 respuesta =
 await fetch(
 `/creditos/clientes/${id}`,
 {
 method: "PUT",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify(datos)
 }
 );
 } catch (error) {
 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "cliente_credito_actualizado",
 "cliente_credito",
 id,
 {
 ...datos,
 clienteId: id,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 alert("No se pudo editar el cliente");
 return;
 }

 clientesCredito =
 clientesCredito.map(item =>
 Number(item.id) === Number(id)
 ? {
 ...item,
 nombre: datos.nombre,
 telefono: datos.telefono,
 limite_credito: datos.limiteCredito,
 pendienteSync: true
 }
 : item
 );

 clienteOffline = true;
 }

 if (!clienteOffline && !respuesta.ok) {
 alert("No se pudo editar el cliente");
 return;
 }

 if (clienteOffline) {
 await guardarCatalogosLocalesDesktopPOS();
 } else {
 await cargarCreditos();
 }

 renderClientes();
}

async function desactivarClienteCredito(id) {
 const cliente =
 clientesCredito.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!cliente) return;

 const confirmar =
 await confirmarPOS(
 `Dar de baja a ${cliente.nombre}?`,
 "Baja de cliente",
 "peligro"
 );

 if (!confirmar) return;

 let respuesta;
 let clienteOffline = false;

 try {
 respuesta =
 await fetch(
 `/creditos/clientes/${id}`,
 {
 method: "DELETE"
 }
 );
 } catch (error) {
 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "cliente_credito_eliminado",
 "cliente_credito",
 id,
 {
 clienteId: id,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 alert("No se pudo dar de baja el cliente");
 return;
 }

 clientesCredito =
 clientesCredito.filter(item => Number(item.id) !== Number(id));

 clienteOffline = true;
 }

 if (!clienteOffline && !respuesta.ok) {
 alert("No se pudo dar de baja el cliente");
 return;
 }

 if (clienteOffline) {
 await guardarCatalogosLocalesDesktopPOS();
 } else {
 await cargarCreditos();
 }

 renderClientes();
}

async function cargarProveedores() {
 const respuesta =
 await fetch("/proveedores");

 if (!respuesta.ok) {
 throw new Error("No se pudieron cargar los proveedores");
 }

 const datos =
 await respuesta.json();

 proveedores =
 datos.proveedores || [];
}

async function mostrarProveedores() {
 document.getElementById("pantallaInicio").style.display = "none";
 document.getElementById("pantallaPuntoVenta").style.display = "none";
 document.getElementById("pantallaInventario").style.display = "none";
 document.getElementById("pantallaCategoriasInventario").style.display = "none";
 document.getElementById("pantallaCatalogo").style.display = "none";
 document.getElementById("pantallaClientes").style.display = "none";
 document.getElementById("pantallaInventarioBajo").style.display = "none";
 document.getElementById("pantallaReportes").style.display = "none";
 document.getElementById("pantallaProveedores").style.display = "block";

 try {
 await cargarProveedores();
 renderProveedores();
 } catch (error) {
 alert(error.message);
 }
}

function proveedoresFiltrados() {
 const texto =
 (document.getElementById("buscarProveedores")?.value || "")
 .toLowerCase()
 .trim();

 if (!texto) return proveedores;

 return proveedores.filter(proveedor =>
 String(proveedor.nombre || "").toLowerCase().includes(texto)
 ||
 String(proveedor.contacto || "").toLowerCase().includes(texto)
 ||
 String(proveedor.telefono || "").toLowerCase().includes(texto)
 ||
 String(proveedor.correo || "").toLowerCase().includes(texto)
 );
}

function buscarProveedores() {
 renderProveedores();
}

function renderProveedores() {
 const tabla =
 document.getElementById("tablaProveedores");

 if (!tabla) return;

 const filtrados =
 proveedoresFiltrados();

 document.getElementById("proveedoresTotal").textContent =
 proveedores.length;

 document.getElementById("proveedoresProductos").textContent =
 proveedores.reduce(
 (total, proveedor) =>
 total + Number(proveedor.productos || 0),
 0
 );

 document.getElementById("proveedoresSinContacto").textContent =
 proveedores.filter(
 proveedor =>
 !proveedor.telefono && !proveedor.correo
 ).length;

 if (filtrados.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="6" class="proveedores-vacio">
 No hay proveedores para mostrar.
 </td>
 </tr>
 `;
 return;
 }

 tabla.innerHTML =
 filtrados.map(proveedor => `
 <tr>
 <td>
 <strong>${proveedor.nombre}</strong>
 <span>${proveedor.notas || "Sin notas"}</span>
 </td>
 <td>${proveedor.contacto || "-"}</td>
 <td>${proveedor.telefono || "-"}</td>
 <td>${proveedor.correo || "-"}</td>
 <td>
 <span class="proveedor-productos">
 ${Number(proveedor.productos || 0)}
 </span>
 </td>
 <td class="acciones-proveedores">
 <button onclick="verProductosProveedor('${encodeURIComponent(proveedor.nombre)}')">
 Productos
 </button>
 <button onclick="editarProveedor(${proveedor.id})">
 Editar
 </button>
 <button onclick="desactivarProveedor(${proveedor.id})">
 Baja
 </button>
 </td>
 </tr>
 `).join("");
}

async function abrirNuevoProveedor() {
 const datos =
 await abrirFormularioCredito({
 titulo: "Nuevo proveedor",
 subtitulo: "Registra datos de contacto y surtido",
 campos: camposProveedor()
 });

 if (!datos) return;

 const respuesta =
 await fetch(
 "/proveedores",
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify(datos)
 }
 );

 if (!respuesta.ok) {
 alert("No se pudo crear el proveedor");
 return;
 }

 await cargarProveedores();
 renderProveedores();
}

async function editarProveedor(id) {
 const proveedor =
 proveedores.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!proveedor) return;

 const datos =
 await abrirFormularioCredito({
 titulo: "Editar proveedor",
 subtitulo: "Actualiza los datos del proveedor",
 campos: camposProveedor(proveedor)
 });

 if (!datos) return;

 const respuesta =
 await fetch(
 `/proveedores/${id}`,
 {
 method: "PUT",
 headers: {
 "Content-Type": "application/json"
 },
 body: JSON.stringify(datos)
 }
 );

 if (!respuesta.ok) {
 alert("No se pudo editar el proveedor");
 return;
 }

 await cargarProveedores();
 renderProveedores();
}

async function desactivarProveedor(id) {
 const proveedor =
 proveedores.find(
 item =>
 Number(item.id) === Number(id)
 );

 if (!proveedor) return;

 const confirmar =
 await confirmarPOS(
 `Dar de baja a ${proveedor.nombre}?`,
 "Baja de proveedor",
 "peligro"
 );

 if (!confirmar) return;

 const respuesta =
 await fetch(
 `/proveedores/${id}`,
 {
 method: "DELETE"
 }
 );

 if (!respuesta.ok) {
 alert("No se pudo dar de baja el proveedor");
 return;
 }

 await cargarProveedores();
 renderProveedores();
}

function verProductosProveedor(nombreCodificado) {
 const nombre =
 decodeURIComponent(nombreCodificado);

 mostrarInventario();

 const buscador =
 document.getElementById("buscarInventario");

 if (buscador) {
 buscador.value = nombre;
 buscarInventario();
 }
}

function camposProveedor(proveedor = {}) {
 return [
 {
 nombre: "nombre",
 etiqueta: "Nombre del proveedor",
 placeholder: "Ej. Truper, Urrea, Fiero",
 valor: proveedor.nombre || "",
 requerido: true
 },
 {
 nombre: "contacto",
 etiqueta: "Contacto",
 placeholder: "Nombre del vendedor",
 valor: proveedor.contacto || ""
 },
 {
 nombre: "telefono",
 etiqueta: "Telefono",
 placeholder: "Numero de contacto",
 valor: proveedor.telefono || ""
 },
 {
 nombre: "correo",
 etiqueta: "Correo",
 tipo: "email",
 placeholder: "ventas@proveedor.com",
 valor: proveedor.correo || ""
 },
 {
 nombre: "notas",
 etiqueta: "Notas",
 placeholder: "Dias de surtido, condiciones, ruta",
 valor: proveedor.notas || ""
 }
 ];
}

function asegurarPantallaCatalogo() {
 const pantalla =
 document.getElementById("pantallaCatalogo");

 if (!pantalla || pantalla.dataset.catalogoUi === "ok") return;

 pantalla.innerHTML = `
 <div class="catalogo-shell">
 <div class="catalogo-header">
 <div>
 <h2>Catalogo proveedor</h2>
 <p>Actualiza listas de precios y conecta codigos de barras con inventario.</p>
 </div>
 <div class="catalogo-actions">
 <button type="button" class="btn-catalogo-subir" onclick="abrirCargaCatalogo('nuevo')">
 Subir catalogo nuevo
 </button>
 <button type="button" class="btn-catalogo-actualizar" onclick="abrirCargaCatalogo('actualizar')">
 Actualizar catalogo
 </button>
 <input type="file" id="archivoCatalogoVista" multiple accept=".xlsx,.csv" hidden>
 </div>
 </div>

 <div class="catalogo-resumen">
 <div>
 <span>Catalogos cargados</span>
 <strong id="catalogosTotal">0</strong>
 </div>
 <div>
 <span>Productos en catalogos</span>
 <strong id="catalogosProductos">0</strong>
 </div>
 <div>
 <span>Ultima actualizacion</span>
 <strong id="catalogosUltima">Sin datos</strong>
 </div>
 </div>

 <div class="catalogo-grid">
 <div class="catalogo-panel">
 <div class="catalogo-panel-head">
 <h3>Catalogos por proveedor</h3>
 <button onclick="limpiarCatalogosProveedor()">Limpiar</button>
 </div>
 <div id="listaCatalogosProveedor"></div>
 </div>

 <div class="catalogo-panel">
 <h3>Lectura del catalogo</h3>
 <div id="vistaCatalogoProveedor" class="vista-catalogo">
 Sube un catalogo para revisar columnas, precios detectados y productos de muestra.
 </div>
 </div>
 </div>
 </div>
 `;

 pantalla.dataset.catalogoUi = "ok";

 document
 .getElementById("archivoCatalogoVista")
 .addEventListener("change", event => {
 procesarArchivosCatalogo(event.target.files);
 event.target.value = "";
 });
}

function abrirCargaCatalogo(modo = "nuevo") {
 const input =
 document.getElementById("archivoCatalogoVista") ||
 document.getElementById("archivoCatalogo");

 if (!input) return;

 input.dataset.modoCatalogo =
 modo;

 input.click();
}

function renderCatalogosProveedor() {
 const catalogos =
 catalogosGuardados();

 const totalProductos =
 catalogos.reduce(
 (total, item) =>
 total + Number(item.productos || 0),
 0
 );

 const ultimaFecha =
 catalogos
 .map(item => item.fecha)
 .filter(Boolean)
 .sort()
 .at(-1);

 const totalEl =
 document.getElementById("catalogosTotal");

 const productosEl =
 document.getElementById("catalogosProductos");

 const ultimaEl =
 document.getElementById("catalogosUltima");

 if (totalEl) totalEl.textContent = catalogos.length;
 if (productosEl) productosEl.textContent = totalProductos;
 if (ultimaEl) {
 ultimaEl.textContent =
 ultimaFecha
 ? new Date(ultimaFecha).toLocaleDateString("es-MX")
 : "Sin datos";
 }

 const lista =
 document.getElementById("listaCatalogosProveedor");

 if (!lista) return;

 if (catalogos.length === 0) {
 lista.innerHTML = `
 <div class="catalogo-vacio">
 Todavia no hay catalogos cargados.
 </div>
 `;
 renderVistaCatalogo(null);
 return;
 }

 lista.innerHTML =
 catalogos.map((catalogo, index) => `
 <div class="catalogo-item">
 <div>
 <strong>${catalogo.proveedor}</strong>
 <span>${catalogo.archivo}</span>
 <small>${catalogo.plantillaId ? "Plantilla aplicada" : "Sin plantilla guardada"}</small>
 </div>
 <div class="catalogo-item-meta">
 <b>${catalogo.productos || 0}</b>
 <span>productos</span>
 </div>
 <button onclick="renderVistaCatalogo(${index})">
 Ver
 </button>
 <button onclick="eliminarCatalogoProveedor(${index})">
 Baja
 </button>
 </div>
 `).join("");

 renderVistaCatalogo(0);
}

function productosDesdeCsvCatalogo(csv, limite = 12, mapeoCatalogo = {}) {
 const lineas =
 String(csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 return lineas
 .filter((linea, indice) => indice !== mapaColumnas.indice)
 .slice(0, limite)
 .map(linea => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas =
 mapaColumnas.columnas || {};

 const mayoreo =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "costo") ||
 valorColumnaCatalogo(datos, columnas, "distribuidor")
 ) || "";

 let medioMayoreo =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "medioMayoreo") ||
 valorColumnaCatalogo(datos, columnas, "medioMayoreoIva")
 ) ||
 numeroCatalogo(
 valorColumnaCatalogo(datos, columnas, "medioMayoreo")
 ) || "";

 const publico =
 numeroCatalogo(
 valorMapeoCatalogo(datos, mapeoCatalogo, "publico") ||
 valorColumnaCatalogo(datos, columnas, "publico")
 ) || "";

 if (medioMayoreo && mayoreo && medioMayoreo < mayoreo) {
 medioMayoreo =
 publico && publico >= mayoreo
 ? publico
 : mayoreo;
 }

 return {
 codigo:
 normalizarCodigo(
 valorColumnaCatalogo(datos, columnas, "codigo") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoBarras") ||
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigoInterno") ||
 datos[0]
 ),
 nombre:
 valorMapeoCatalogo(datos, mapeoCatalogo, "nombre") ||
 valorColumnaCatalogo(datos, columnas, "nombre") ||
 nombreProductoDesdeFilaCatalogo(datos, columnas.codigo ?? 0),
 mayoreo: medioMayoreo,
 publico
 };
 });
}

function nombreColumnaCatalogo(lineas, indiceEncabezado, indiceColumna) {
 if (indiceEncabezado < 0 || indiceColumna === undefined) {
 return "No detectada";
 }

 const encabezados =
 separarFilaCatalogo(lineas[indiceEncabezado] || "");

 return limpiarTextoCatalogo(encabezados[indiceColumna]) || "No detectada";
}

function diagnosticoCatalogo(catalogo) {
 const lineas =
 String(catalogo?.csv || "")
 .split("\n")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapa =
 detectarColumnasCatalogo(lineas);

 const columnas =
 mapa.columnas || {};

 const mapeo =
 catalogo?.mapeo || {};

 const nombreMapeado = campo => {
 const indice =
 mapeo[campo];

 return indice === "" || indice === undefined
 ? ""
 : nombreColumnaCatalogo(lineas, mapa.indice, indice);
 };

 return {
 filas: lineas.length,
 encabezado: mapa.indice >= 0 ? mapa.indice + 1 : "No detectado",
 codigo:
 nombreMapeado("codigoBarras") ||
 nombreMapeado("codigoInterno") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.codigo),
 nombre:
 nombreMapeado("nombre") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.nombre),
 mayoreo:
 nombreMapeado("costo") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.distribuidor),
 medioMayoreo:
 nombreMapeado("medioMayoreo") ||
 nombreColumnaCatalogo(
 lineas,
 mapa.indice,
 columnas.medioMayoreoIva ?? columnas.medioMayoreo
 ),
 publico:
 nombreMapeado("publico") ||
 nombreColumnaCatalogo(lineas, mapa.indice, columnas.publico),
 precioVenta: mapeo.medioMayoreo !== undefined && mapeo.medioMayoreo !== ""
 ? "Configurado por plantilla"
 : columnas.medioMayoreoIva !== undefined
 ? "Medio mayoreo con IVA"
 : columnas.medioMayoreo !== undefined
 ? "Medio mayoreo"
 : "Respaldo por columnas"
 };
}

function renderVistaCatalogo(indice) {
 const vista =
 document.getElementById("vistaCatalogoProveedor");

 if (!vista) return;

 const catalogos =
 catalogosGuardados();

 const catalogo =
 typeof indice === "number"
 ? catalogos[indice]
 : null;

 if (!catalogo) {
 vista.innerHTML = `
 <div class="catalogo-diagnostico-vacio">
 <strong>Sin catalogo seleccionado</strong>
 <span>Sube un catalogo nuevo o selecciona uno existente para revisar como se estan leyendo sus columnas.</span>
 </div>
 `;
 return;
 }

 const productos =
 productosDesdeCsvCatalogo(catalogo.csv, 12, catalogo.mapeo || {});

 const diagnostico =
 diagnosticoCatalogo(catalogo);

 vista.innerHTML = `
 <div class="vista-catalogo-header">
 <div>
 <strong>${catalogo.proveedor}</strong>
 <span>${catalogo.archivo}</span>
 </div>
 <span>${new Date(catalogo.fecha).toLocaleString("es-MX")}</span>
 </div>

 <div class="catalogo-diagnostico">
 <div>
 <span>Precio para venta</span>
 <strong>${diagnostico.precioVenta}</strong>
 </div>
 <div>
 <span>Columna codigo</span>
 <strong>${diagnostico.codigo}</strong>
 </div>
 <div>
 <span>Columna producto</span>
 <strong>${diagnostico.nombre}</strong>
 </div>
 <div>
 <span>Medio mayoreo</span>
 <strong>${diagnostico.medioMayoreo}</strong>
 </div>
 <div>
 <span>Publico</span>
 <strong>${diagnostico.publico}</strong>
 </div>
 <div>
 <span>Filas leidas</span>
 <strong>${diagnostico.filas}</strong>
 </div>
 </div>

 <h4 class="catalogo-muestra-titulo">Productos de muestra</h4>
 <table>
 <thead>
 <tr>
 <th>Codigo</th>
 <th>Producto</th>
 <th>Precio venta</th>
 <th>Publico</th>
 </tr>
 </thead>
 <tbody>
 ${productos.map(producto => `
 <tr>
 <td>${producto.codigo || "-"}</td>
 <td>${producto.nombre}</td>
 <td>${producto.mayoreo || "-"}</td>
 <td>${producto.publico || "-"}</td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 `;
}

function eliminarCatalogoProveedor(indice) {
 const catalogos =
 catalogosGuardados();

 catalogos.splice(indice, 1);
 guardarCatalogosProveedor(catalogos);
 renderCatalogosProveedor();
}

async function limpiarCatalogosProveedor() {
 const confirmar =
 await confirmarPOS(
 "Eliminar todos los catalogos guardados?",
 "Limpiar catalogos",
 "peligro"
 );

 if (!confirmar) return;

 guardarCatalogosProveedor([]);
 renderCatalogosProveedor();
}

function abrirActualizarCatalogo() {
 cerrarFormularioAgregar();
 mostrarCatalogo();

 setTimeout(() => {
 abrirCargaCatalogo("actualizar");
 }, 80);
}

function mostrarGraficas() {
 ocultarPantallasPrincipales();
 document.getElementById("pantallaReportes").style.display = "block";
 paginaReporteVentas = 1;

 cargarReportesVentas();
}

let periodoReporteVentas = "dia";

function cambiarPeriodoReporteVentas(periodo) {
 periodoReporteVentas = periodo || "dia";
 paginaReporteVentas = 1;
 document.querySelectorAll("[data-reporte-periodo]").forEach(boton => {
  boton.classList.toggle("activo", boton.dataset.reportePeriodo === periodoReporteVentas);
 });
 cargarReportesVentas();
}

async function cargarReportesVentas() {
 const params =
 new URLSearchParams();

 params.set("periodo", periodoReporteVentas || "dia");

 if (periodoReporteVentas === "rango") {
  const desde =
  document.getElementById("reporteDesde")?.value || "";

  const hasta =
  document.getElementById("reporteHasta")?.value || "";

  if (desde && hasta) {
   params.set("desde", desde);
   params.set("hasta", hasta);
  }
 }

 const respuesta =
 await fetch("/reportes/ventas?" + params.toString());

 if (!respuesta.ok) {
 alert("No se pudieron cargar los reportes");
 return;
 }

 const datos =
 await respuesta.json();

 const resumen =
 datos.resumen || {};

 const total =
 Number(resumen.total || 0);

 const transacciones =
 Number(resumen.transacciones || 0);

 document.getElementById("reporteTotalVentas").textContent =
 dinero(total);

 document.getElementById("reporteTransacciones").textContent =
 transacciones;

 document.getElementById("reporteTicketPromedio").textContent =
 dinero(resumen.ticket_promedio || 0);

 document.getElementById("reporteVentaMayor").textContent =
 dinero(resumen.venta_mayor || 0);

 renderGraficaReporteVentas(datos.porDia || []);
 renderUltimasVentasReporte(datos.ultimas || []);
 renderListaReporteCompacta("reporteMetodosPago", datos.metodosPago || [], item => ({
  titulo: item.metodo_pago || "efectivo",
  detalle: `${item.transacciones || 0} transacciones`,
  valor: dinero(item.total || 0)
 }));
 renderListaReporteCompacta("reporteProductosVendidos", datos.productosVendidos || [], item => ({
  titulo: item.nombre || "Producto",
  detalle: `${Number(item.cantidad || 0).toFixed(2)} vendidos`,
  valor: dinero(item.total || 0)
 }));
 renderListaReporteCompacta("reporteHorasVenta", datos.porHora || [], item => ({
  titulo: item.hora || "-",
  detalle: `${item.transacciones || 0} ventas`,
  valor: dinero(item.total || 0)
 }));
}

function renderListaReporteCompacta(id, items, adaptador) {
 const contenedor =
 document.getElementById(id);

 if (!contenedor) return;

 if (!items.length) {
  contenedor.innerHTML = '<div class="reporte-vacio">Sin datos para este periodo.</div>';
  return;
 }

 contenedor.innerHTML =
 items.map(item => {
  const vista = adaptador(item);
  return `
  <div class="reporte-mini-row">
   <div>
    <strong>${vista.titulo}</strong>
    <span>${vista.detalle}</span>
   </div>
   <b>${vista.valor}</b>
  </div>
  `;
 }).join("");
}

function renderGraficaReporteVentas(ventasPorDia) {
 const canvas =
 document.getElementById("graficaVentasReporte");

 if (!canvas || typeof Chart === "undefined") return;

 const contexto =
 canvas.getContext("2d");

 if (graficaReporteVentas) {
 graficaReporteVentas.destroy();
 }

 graficaReporteVentas = new Chart(contexto, {
 type: "bar",
 data: {
 labels: ventasPorDia.map(item => item.dia),
 datasets: [
 {
 label: "Ventas",
 data: ventasPorDia.map(item => Number(item.total || 0)),
 backgroundColor: "#c01855",
 borderRadius: 8
 }
 ]
 },
 options: {
 responsive: true,
 maintainAspectRatio: false,
 plugins: {
 legend: {
 display: false
 }
 },
 scales: {
 y: {
 beginAtZero: true
 }
 }
 }
 });
}

function renderUltimasVentasReporte(ventas) {
 const contenedor =
 document.getElementById("reporteUltimasVentas");

 if (!contenedor) return;

 if (ventas.length === 0) {
 contenedor.innerHTML =
 `<div class="reporte-vacio">Todavia no hay ventas registradas.</div>`;
 renderPaginacion(
 "paginacionReporteVentas",
 0,
 1,
 TAMANO_PAGINA_REPORTES,
 "cambiarPaginaReporteVentas"
 );
 return;
 }

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(ventas.length / TAMANO_PAGINA_REPORTES)
 );

 paginaReporteVentas =
 Math.min(paginaReporteVentas, totalPaginas);

 const inicio =
 (paginaReporteVentas - 1) * TAMANO_PAGINA_REPORTES;

 const ventasPagina =
 ventas.slice(
 inicio,
 inicio + TAMANO_PAGINA_REPORTES
 );

 contenedor.innerHTML =
 ventasPagina.map(venta => `
 <div class="reporte-venta-item">
 <div>
 <strong>${dinero(venta.total)}</strong>
 <span>${new Date(venta.fecha).toLocaleString("es-MX")}</span>
 </div>
 <b>#${venta.id}</b>
 </div>
 `).join("");

 renderPaginacion(
 "paginacionReporteVentas",
 ventas.length,
 paginaReporteVentas,
 TAMANO_PAGINA_REPORTES,
 "cambiarPaginaReporteVentas"
 );
}





/* Shell profesional Ferreteria Olimpico */
const RECORDATORIOS_POS_KEY = "recordatoriosFerreteriaPOS";
const NOTIFICACIONES_DESCARTADAS_POS_KEY = "notificacionesDescartadasPOS";
let contextoTopbarPOS = { titulo: "Inicio", subtitulo: "Resumen operativo de la ferreteria", modulo: "inicio" };

const AYUDA_MODULOS_POS = {
 inicio: "Muestra el resumen rapido del negocio: ventas, inventario bajo, creditos y alertas importantes.",
 venta: "Aqui se hacen las ventas del dia. Puedes elegir cliente, agregar productos, aplicar descuentos, cobrar o mandar a credito.",
 inventario: "Administra productos, precios, existencias, categorias y datos principales de mercancia.",
 productos: "Lista operativa de productos para buscar, editar, eliminar o revisar existencias.",
 categorias: "Organiza el inventario por familias para encontrar productos mas rapido.",
 catalogo: "Carga listas de proveedor y actualiza productos desde catalogos externos.",
 "inventario-bajo": "Revisa productos que necesitan compra, articulos criticos y posibles faltantes.",
 recepcion: "Registra mercancia recibida de proveedor y actualiza inventario desde compras.",
 ajustes: "Sirve para corregir existencias por conteo fisico, merma, entradas o salidas internas.",
 reportes: "Analiza ventas, metodos de pago, productos vendidos, horarios fuertes y desempeno del negocio.",
 caja: "Controla apertura, cierre, movimientos, ingresos, retiros y corte de caja.",
 finanzas: "Resume ingresos, egresos, utilidad y flujo de efectivo.",
 pedidos: "Ayuda a organizar pedidos pendientes y seguimiento de surtido.",
 clientes: "Administra clientes, creditos, saldos, historial y datos de contacto.",
 proveedores: "Guarda distribuidores, contactos y datos utiles para compras.",
 dueno: "Panel pensado para que el propietario consulte el negocio desde una vista resumida.",
 configuracion: "Ajusta datos del negocio, usuarios, permisos, tickets, soporte y apariencia."
};

function abrirAyudaModuloPOS() {
 const modulo =
 contextoTopbarPOS.modulo || "inicio";
 const titulo =
 contextoTopbarPOS.titulo || "Modulo";
 const mensaje =
 AYUDA_MODULOS_POS[modulo] ||
 contextoTopbarPOS.subtitulo ||
 "Este apartado concentra funciones operativas del POS.";
 alertaPOS(mensaje, "Que hace: " + titulo, "info");
}

function iconoUISVG(nombre) {
 const iconos = {
 home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V21h14V10.5"/><path d="M9 21v-6h6v6"/>',
 cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h10.8l2-7H7"/>',
 inventory: '<path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z"/><path d="M4 7.5v9L12 21l8-4.5v-9"/><path d="M12 12v9"/>',
 layers: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
 alert: '<path d="M10.3 4.2 2.7 17.4A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.6L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
 chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/>',
 users: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
 truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
 file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
 settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.1.1a2 2 0 1 1-3.8 0l-.1-.1a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.1-.1a2 2 0 1 1 0-3.8l.1-.1a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06A2 2 0 1 1 7.03 4.23l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.1-.1a2 2 0 1 1 3.8 0l.1.1a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.36.43.7.6 1l.1.1a2 2 0 1 1 0 3.8l-.1.1a1.7 1.7 0 0 0-.6 1Z"/>',
 bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
 plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
 check: '<path d="m20 6-11 11-5-5"/>',
 zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'
 };
 const cuerpo = iconos[nombre] || iconos.zap;
 return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + cuerpo + '</svg>';
}
function limpiarTextoUI(texto) { return String(texto || '').replace(/[\uFFFD]/g, '').replace(/\u00c3\u00a1/g, 'a').replace(/\u00c3\u00a9/g, 'e').replace(/\u00c3\u00ad/g, 'i').replace(/\u00c3\u00b3/g, 'o').replace(/\u00c3\u00ba/g, 'u').replace(/\u00c3\u00b1/g, 'n').replace(/\u00c3\u0161/g, 'U').replace(/\u00c3\u201a&middot;|\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7|&middot;/g, '-').replace(/[\u00f0][^\s]*/g, '').replace(/\s+/g, ' ').trim(); }
function moduloDesdeEtiquetaPOS(etiqueta) { const texto = limpiarTextoUI(etiqueta).toLowerCase(); if (texto.includes("inicio")) return "inicio"; if (texto.includes("punto")) return "venta"; if (texto === "inventario") return "inventario"; if (texto.includes("productos")) return "productos"; if (texto.includes("categorias")) return "categorias"; if (texto.includes("bajo")) return "inventario-bajo"; if (texto.includes("reporte") || texto.includes("ventas")) return "reportes"; if (texto.includes("clientes")) return "clientes"; if (texto.includes("proveedores")) return "proveedores"; if (texto.includes("catalogo")) return "catalogo"; if (texto.includes("recepcion")) return "recepcion"; if (texto.includes("caja")) return "caja"; if (texto.includes("finanzas")) return "finanzas"; if (texto.includes("pedidos")) return "pedidos"; if (texto.includes("ajustes")) return "ajustes"; if (texto.includes("configuracion")) return "configuracion"; if (texto.includes("dueno")) return "dueno"; return texto.replace(/[^a-z0-9]+/g, "-") || "modulo"; }
function iconoModuloPOS(modulo) { return { inicio:"home", venta:"cart", inventario:"inventory", productos:"inventory", categorias:"layers", "inventario-bajo":"alert", reportes:"chart", clientes:"users", proveedores:"truck", catalogo:"file", recepcion:"truck", caja:"zap", finanzas:"chart", pedidos:"file", ajustes:"settings", configuracion:"settings", dueno:"chart" }[modulo] || "zap"; }
function datosSidebarPOS(boton) {
 const etiqueta = limpiarTextoUI(boton.dataset.navLabel || boton.textContent);
 const modulo = boton.dataset.shellModule || moduloDesdeEtiquetaPOS(etiqueta) || boton.dataset.modulo;
 return { etiqueta, modulo, clave: modulo || etiqueta.toLowerCase() };
}
function deduplicarSidebarPOS() {
 const sidebar = document.querySelector(".sidebar");
 if (!sidebar) return;
 const vistos = new Set();
 Array.from(sidebar.children).forEach(elemento => {
  if (!elemento || elemento.tagName !== "BUTTON") return;
  const datos = datosSidebarPOS(elemento);
  if (!datos.clave) return;
  if (vistos.has(datos.clave)) {
   elemento.remove();
   return;
  }
  vistos.add(datos.clave);
 });
}
function asegurarBotonSidebarPOS(modulo, etiqueta, handler) {
 const sidebar = document.querySelector(".sidebar");
 if (!sidebar) return;
 const existe = Array.from(sidebar.querySelectorAll("button")).some(boton => datosSidebarPOS(boton).modulo === modulo);
 if (existe) return;
 const boton = document.createElement("button");
 boton.type = "button";
 boton.dataset.modulo = modulo;
 boton.dataset.shellModule = modulo;
 boton.dataset.navLabel = etiqueta;
 boton.addEventListener("click", handler);
 boton.innerHTML = iconoUISVG(iconoModuloPOS(modulo)) + '<span>' + etiqueta + '</span>';
 sidebar.appendChild(boton);
}
function ordenarSidebarPOS() {
 const sidebar = document.querySelector(".sidebar");
 if (!sidebar) return;
 const orden = [
  "inicio",
  "venta",
  "inventario",
  "productos",
  "categorias",
  "catalogo",
  "inventario-bajo",
  "recepcion",
  "ajustes",
  "reportes",
  "caja",
  "finanzas",
  "pedidos",
  "clientes",
  "proveedores",
  "dueno",
  "configuracion"
 ];
 const peso = boton => {
  const index = orden.indexOf(datosSidebarPOS(boton).modulo);
  return index === -1 ? 999 : index;
 };
 const botones = Array.from(sidebar.querySelectorAll(":scope > button"));
 botones
  .sort((a, b) => peso(a) - peso(b))
  .forEach(boton => {
   const modulo = datosSidebarPOS(boton).modulo;
   const submenuInventario = document.getElementById("submenuInventario");
   if (modulo === "inventario" && submenuInventario) {
    sidebar.appendChild(boton);
    sidebar.appendChild(submenuInventario);
   } else {
    sidebar.appendChild(boton);
   }
  });
}
function profesionalizarSidebarPOS() {
 asegurarBotonSidebarPOS("catalogo", "Catalogo proveedor", () => mostrarCatalogo());
 deduplicarSidebarPOS();
 document.querySelectorAll(".sidebar button").forEach(boton => {
  const datos = datosSidebarPOS(boton);
  boton.dataset.modulo = datos.modulo;
  boton.dataset.shellModule = datos.modulo;
  boton.dataset.navLabel = datos.etiqueta;
  boton.innerHTML = iconoUISVG(iconoModuloPOS(datos.modulo)) + '<span>' + datos.etiqueta + '</span>';
 });
 deduplicarSidebarPOS();
 ordenarSidebarPOS();
}
window.repararSidebarNexoPOS = function() {
 profesionalizarSidebarPOS();
 aplicarPermisosUsuario();
};
function actualizarModuloActivoPOS(modulo) { document.querySelectorAll(".sidebar button").forEach(boton => boton.classList.toggle("activo", boton.dataset.shellModule === modulo)); }
function recordatoriosPOSGuardados() { try { const datos = JSON.parse(localStorage.getItem(RECORDATORIOS_POS_KEY) || "[]"); return Array.isArray(datos) ? datos : []; } catch (error) { console.warn("No se pudieron leer recordatorios", error); return []; } }
function guardarRecordatoriosPOS(recordatorios) { localStorage.setItem(RECORDATORIOS_POS_KEY, JSON.stringify(recordatorios)); renderNotificacionesPOS(); }
function notificacionesDescartadasPOS() { try { const datos = JSON.parse(localStorage.getItem(NOTIFICACIONES_DESCARTADAS_POS_KEY) || "[]"); return Array.isArray(datos) ? datos : []; } catch (error) { console.warn("No se pudieron leer notificaciones descartadas", error); return []; } }
function guardarNotificacionesDescartadasPOS(ids) { localStorage.setItem(NOTIFICACIONES_DESCARTADAS_POS_KEY, JSON.stringify([...new Set(ids)])); renderNotificacionesPOS(); }
function productosInventarioBajoPOS() { return todosProductos.filter(producto => { const stock = Number(producto.stock || 0); const minimo = Number(producto.stock_minimo ?? producto.stockMinimo ?? 5); return stock <= minimo; }).sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0)); }
function creditosPendientesPOS() { return clientesCredito.filter(cliente => Number(cliente.saldo || 0) > 0).sort((a, b) => Number(b.saldo || 0) - Number(a.saldo || 0)); }
function notificacionesSistemaPOS() {
 const descartadas = new Set(notificacionesDescartadasPOS());
 const bajos = productosInventarioBajoPOS().slice(0, 6).map(producto => {
  const id = 'stock-' + (producto.id || producto.codigo || producto.nombre);
  return {
   id,
   tipo: "Inventario bajo",
   titulo: producto.nombre || "Producto sin nombre",
   detalle: 'Stock ' + Number(producto.stock || 0) + ' / minimo ' + Number(producto.stock_minimo ?? producto.stockMinimo ?? 5),
   prioridad: Number(producto.stock || 0) <= 0 ? "Alta" : "Media",
   icono: "alert",
   accion: { tipo: "inventarioBajo", productoId: producto.id || null, texto: producto.nombre || producto.codigo || "" }
  };
 }).filter(item => !descartadas.has(item.id));
 const creditos = creditosPendientesPOS().slice(0, 4).map(cliente => {
  const id = 'credito-' + cliente.id;
  return {
   id,
   tipo: "Credito pendiente",
   titulo: cliente.nombre || "Cliente",
   detalle: 'Saldo ' + dinero(cliente.saldo || 0),
   prioridad: "Media",
   icono: "users",
   accion: { tipo: "credito", clienteId: cliente.id }
  };
 }).filter(item => !descartadas.has(item.id));
 const recordatorios = recordatoriosPOSGuardados()
 .filter(item => !item.completado)
 .sort((a, b) => String((a.fecha || "9999") + " " + (a.hora || "99:99")).localeCompare(String((b.fecha || "9999") + " " + (b.hora || "99:99"))))
 .slice(0, 8)
 .map(item => ({
  id: item.id,
  tipo: "Recordatorio",
  titulo: item.titulo,
  detalle: [[item.fecha, item.horaTexto || item.hora].filter(Boolean).join(" "), item.prioridad].filter(Boolean).join(" / ") || "Pendiente",
  prioridad: item.prioridad || "Media",
  icono: "bell",
  recordatorio: true
 }));
 return [...recordatorios, ...bajos, ...creditos];
}
function asegurarTopbarPOS() { const main = document.querySelector(".contenido"); if (!main) return null; let topbar = document.getElementById("topbarPOS"); if (!topbar) { topbar = document.createElement("header"); topbar.id = "topbarPOS"; topbar.className = "topbar-pos"; main.prepend(topbar); } return topbar; }
function usuarioActualTopbarPOS() {
 if (usuarioActual) return usuarioActual;
 try {
 const sesion = JSON.parse(localStorage.getItem(SESION_POS_KEY) || "null");
 return sesion?.usuario || sesion || {};
 } catch (error) {
 return {};
 }
}
function renderTopbarPOS() {
 const topbar = asegurarTopbarPOS();
 if (!topbar) return;

 const notificaciones = notificacionesSistemaPOS();
 const logoSistema = '<img src="nexo-pos-icon.jpg" alt="Nexo POS" class="nexo-pos-logo">';
 const usuario = usuarioActualTopbarPOS();
 const nombreUsuario = usuario?.nombre || "Usuario";
 const negocio = negocioActivoSlug();
 const syncDesktop = desktopSyncDisponiblePOS()
 ? '<button type="button" id="btnSyncDesktopPOS" class="sync-desktop-chip" onclick="sincronizarAhoraDesktopPOS()" title="Sincronizar ahora"><span id="chipSyncDesktopPOS" class="sync-chip-inner"><span class="sync-dot"></span><span>Sync</span><small>Revisando</small></span></button>'
 : "";

 topbar.innerHTML =
 '<div class="topbar-title-block"><span class="topbar-eyebrow">Ferreteria Olimpico POS</span><strong id="topbarTituloPOS">' +
 contextoTopbarPOS.titulo +
 '</strong><small id="topbarSubtituloPOS">' +
 contextoTopbarPOS.subtitulo +
 '</small></div><div class="topbar-actions">' +
 syncDesktop +
 '<button type="button" class="topbar-help" onclick="abrirAyudaModuloPOS()" title="Que hace este modulo">?</button>' +
 '<button type="button" class="topbar-action" onclick="abrirRecordatorioPOS()" title="Nuevo recordatorio">' +
 iconoUISVG("plus") +
 '<span>Recordatorio</span></button><button type="button" id="btnNotificacionesPOS" class="topbar-bell" onclick="toggleNotificacionesPOS()" title="Notificaciones">' +
 iconoUISVG("bell") +
 '<span id="badgeNotificacionesPOS" class="notification-badge">' +
 notificaciones.length +
 '</span></button><div class="topbar-product-menu"><button type="button" id="btnMenuNexoPOS" class="topbar-brand-pill nexo-brand-pill nexo-brand-button" onclick="toggleMenuNexoPOS()" aria-haspopup="true" aria-expanded="false"><div class="topbar-logo nexo-topbar-logo">' +
 logoSistema +
 '</div><div><strong>Nexo POS</strong><span>' +
 nombreUsuario +
 ' · ' +
 negocio +
 '</span></div><span class="nexo-menu-caret">⌄</span></button><div id="menuNexoPOS" class="nexo-menu-panel"><div class="nexo-menu-head"><strong>Nexo POS</strong><span>Negocio: ' +
 negocio +
 '</span><span>Version ' +
 VERSION_NEXO_POS +
 '</span></div><button type="button" onclick="abrirContactoDesarrolladorPOS()">' +
 iconoUISVG("users") +
 '<span>Contactar desarrollador</span></button><button type="button" class="nexo-menu-danger" onclick="cerrarSesionPOS()">' +
 iconoUISVG("alert") +
 '<span>Cerrar sesion</span></button></div></div></div><div id="panelNotificacionesPOS" class="notificaciones-panel" aria-live="polite"></div>';

 renderNotificacionesPOS();
 refrescarEstadoSyncDesktopPOS({ silencioso: true });
}
function toggleMenuNexoPOS() { const menu = document.getElementById("menuNexoPOS"); const boton = document.getElementById("btnMenuNexoPOS"); if (!menu) return; const abierto = menu.classList.toggle("abierto"); if (boton) boton.setAttribute("aria-expanded", abierto ? "true" : "false"); cerrarNotificacionesPOS(); }
function cerrarMenuNexoPOS() { document.getElementById("menuNexoPOS")?.classList.remove("abierto"); document.getElementById("btnMenuNexoPOS")?.setAttribute("aria-expanded", "false"); }
async function cerrarSesionPOS() { cerrarMenuNexoPOS(); const confirmar = await confirmarPOS("Se cerrara la sesion actual y volveras al inicio de sesion.", "Cerrar sesion", "alerta"); if (!confirmar) return; localStorage.removeItem(SESION_POS_KEY); localStorage.removeItem("usuarioActualSistema"); usuarioActual = null; document.getElementById("sistema").style.display = "none"; document.getElementById("login").style.display = "flex"; document.getElementById("password").value = ""; const campoNegocio = document.getElementById("negocioLogin"); if (campoNegocio) campoNegocio.value = negocioActivoSlug(); inicializarLoginUsuarios(); setTimeout(() => document.getElementById("password")?.focus(), 80); }
function contactoDesarrolladorPOS() { try { return { ...CONTACTO_DESARROLLADOR_DEFAULT, ...JSON.parse(localStorage.getItem(CONTACTO_DESARROLLADOR_KEY) || "{}") }; } catch (error) { return { ...CONTACTO_DESARROLLADOR_DEFAULT }; } }
function modoDesarrolladorNexoPOS() { return localStorage.getItem(MODO_DESARROLLADOR_NEXO_KEY) === "true"; }
function activarModoDesarrolladorNexoPOS(clave) { if (String(clave || "") !== "nexo2026") { alertaPOS("Clave incorrecta", "No se activo el modo desarrollador.", "alerta"); return false; } localStorage.setItem(MODO_DESARROLLADOR_NEXO_KEY, "true"); alertaPOS("Modo desarrollador activo", "Ya puedes editar el contacto de soporte.", "exito"); return true; }
function desactivarModoDesarrolladorNexoPOS() { localStorage.removeItem(MODO_DESARROLLADOR_NEXO_KEY); alertaPOS("Modo desarrollador desactivado", "El cliente vera solo los datos de contacto.", "info"); }
async function alternarModoDesarrolladorNexoPOS() { if (modoDesarrolladorNexoPOS()) { const confirmar = await confirmarPOS("Ocultar las opciones de edicion del desarrollador?", "Modo desarrollador", "alerta"); if (!confirmar) return; desactivarModoDesarrolladorNexoPOS(); return; } const clave = await pedirTextoPOS("Escribe la clave de desarrollador", "", "Activar modo desarrollador"); if (clave === null) return; activarModoDesarrolladorNexoPOS(clave); }
function abrirContactoDesarrolladorPOS() {
 cerrarMenuNexoPOS();
 const contacto = contactoDesarrolladorPOS();
 const dev = modoDesarrolladorNexoPOS();
 let modal = document.getElementById("modalContactoDesarrolladorPOS");

 if (!modal) {
  modal = document.createElement("div");
  modal.id = "modalContactoDesarrolladorPOS";
  modal.className = "modal-personalizado";
  document.body.appendChild(modal);
 }

 const whatsappLimpio = String(contacto.whatsapp || "").replace(/\D/g, "");
 const whatsappLink = whatsappLimpio ? "https://wa.me/" + whatsappLimpio : "";
 const tieneContacto = contacto.telefono || contacto.correo || whatsappLink;

 const acciones = tieneContacto
 ? `${contacto.telefono ? `<a href="tel:${contacto.telefono}">Telefono: ${contacto.telefono}</a>` : ""}
 ${contacto.correo ? `<a href="mailto:${contacto.correo}">Correo: ${contacto.correo}</a>` : ""}
 ${whatsappLink ? `<a href="${whatsappLink}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ""}`
 : '<span>Datos de soporte por configurar.</span>';

 const editor = dev
 ? `<section class="contacto-dev-editor">
 <div class="contacto-dev-editor-title">
 <div>
 <strong>Modo desarrollador</strong>
 <span>Estos campos no aparecen para el cliente.</span>
 </div>
 </div>
 <div class="contacto-dev-form">
 <label>Nombre<input id="contactoDevNombrePOS" value="${contacto.nombre || ""}" placeholder="Ej. Gustavo Diaz"></label>
 <label>Telefono<input id="contactoDevTelefonoPOS" value="${contacto.telefono || ""}" placeholder="Ej. 498 123 4567"></label>
 <label>WhatsApp<input id="contactoDevWhatsappPOS" value="${contacto.whatsapp || ""}" placeholder="Ej. 524981234567"></label>
 <label>Correo<input id="contactoDevCorreoPOS" value="${contacto.correo || ""}" placeholder="correo@ejemplo.com"></label>
 </div>
 <div class="modal-actions-row">
 <button type="button" onclick="desactivarModoDesarrolladorNexoPOS(); abrirContactoDesarrolladorPOS()">Ocultar edicion</button>
 <button type="button" class="btn-principal" onclick="guardarContactoDesarrolladorPOS()">Guardar contacto</button>
 </div>
 </section>`
 : '<div class="modal-actions-row contacto-dev-final"><button type="button" class="btn-principal" onclick="cerrarContactoDesarrolladorPOS()">Listo</button></div>';

 modal.innerHTML = `
 <div class="modal-card contacto-dev-card ${dev ? "modo-dev" : "modo-cliente"}">
 <div class="contacto-dev-header">
 <div>
 <span>Nexo POS</span>
 <h3>Contacto del desarrollador</h3>
 </div>
 <button type="button" class="modal-cerrar-x" onclick="cerrarContactoDesarrolladorPOS()" aria-label="Cerrar contacto">×</button>
 </div>
 <div class="contacto-dev-resumen">
 <img src="nexo-pos-icon.jpg" alt="Nexo POS">
 <div>
 <strong>${contacto.nombre || "Soporte Nexo POS"}</strong>
 <span>Soporte, cambios y mejoras del sistema</span>
 </div>
 </div>
 <div class="contacto-dev-actions">${acciones}</div>
 ${editor}
 </div>`;
 modal.style.display = "flex";
}
function cerrarContactoDesarrolladorPOS() { const modal = document.getElementById("modalContactoDesarrolladorPOS"); if (modal) modal.style.display = "none"; }
function guardarContactoDesarrolladorPOS() { const contacto = { nombre: document.getElementById("contactoDevNombrePOS")?.value.trim() || "Desarrollador Nexo POS", telefono: document.getElementById("contactoDevTelefonoPOS")?.value.trim() || "", whatsapp: document.getElementById("contactoDevWhatsappPOS")?.value.trim() || "", correo: document.getElementById("contactoDevCorreoPOS")?.value.trim() || "" }; localStorage.setItem(CONTACTO_DESARROLLADOR_KEY, JSON.stringify(contacto)); cerrarContactoDesarrolladorPOS(); alertaPOS("Contacto guardado", "Los datos del desarrollador quedaron listos en Nexo POS.", "exito"); }
function instalarAtajoDesarrolladorNexoPOS() { if (window.__atajoDevNexoPOS) return; window.__atajoDevNexoPOS = true; document.addEventListener("keydown", event => { const tecla = String(event.key || "").toLowerCase(); if (event.ctrlKey && event.shiftKey && tecla === "d") { event.preventDefault(); alternarModoDesarrolladorNexoPOS(); } }); }
function instalarMonitorSyncDesktopPOS() {
 if (window.__monitorSyncDesktopPOS) return;
 window.__monitorSyncDesktopPOS = true;

 const refrescar = () => refrescarEstadoSyncDesktopPOS({ silencioso: true });
 window.addEventListener("online", refrescar);
 window.addEventListener("offline", refrescar);
 setInterval(refrescar, 30000);
 refrescar();
}
function actualizarTopbarContexto(titulo, subtitulo, modulo) { contextoTopbarPOS = { titulo, subtitulo, modulo: modulo || contextoTopbarPOS.modulo || "inicio" }; renderTopbarPOS(); if (modulo) actualizarModuloActivoPOS(modulo); }
function renderNotificacionesPOS() {
 const panel = document.getElementById("panelNotificacionesPOS");
 const badge = document.getElementById("badgeNotificacionesPOS");
 if (!panel || !badge) return;
 const items = notificacionesSistemaPOS();
 badge.textContent = items.length;
 badge.style.display = items.length ? "inline-flex" : "none";
  if (!items.length) {
  panel.innerHTML = '<div class="notificaciones-head"><div><strong>Centro de notificaciones</strong><span>Todo esta bajo control.</span></div><div class="notificaciones-head-actions"><button type="button" onclick="abrirRecordatorioPOS()">Nuevo</button></div></div><div class="notificaciones-empty">Sin alertas ni recordatorios pendientes.</div>';
  return;
  }
  const htmlItems = items.map(item => {
  const accion = item.recordatorio
  ? '<button type="button" onclick="completarRecordatorioPOS(' + JSON.stringify(item.id) + ')">' + iconoUISVG("check") + '</button>'
  : '<button type="button" onclick="ejecutarAccionNotificacionPOS(decodeURIComponent(' + JSON.stringify(encodeURIComponent(JSON.stringify(item.accion || {}))) + '))">Ver</button>';
  return '<article class="notificacion-item prioridad-' + String(item.prioridad || "media").toLowerCase() + '"><div class="notificacion-icono">' + iconoUISVG(item.icono || "bell") + '</div><div><span>' + item.tipo + '</span><strong>' + item.titulo + '</strong><small>' + item.detalle + '</small></div>' + accion + '</article>';
  }).join("");
  panel.innerHTML = '<div class="notificaciones-head"><div><strong>Centro de notificaciones</strong><span>' + items.length + ' pendientes de operacion</span></div><div class="notificaciones-head-actions"><button type="button" onclick="abrirRecordatorioPOS()">Nuevo</button><button type="button" class="btn-limpiar-notificaciones" onclick="limpiarTodasNotificacionesPOS()">Limpiar</button></div></div><div class="notificaciones-lista">' + htmlItems + '</div>';
 }
function toggleNotificacionesPOS() { const panel = document.getElementById("panelNotificacionesPOS"); if (!panel) return; panel.classList.toggle("abierto"); renderNotificacionesPOS(); }
function cerrarNotificacionesPOS() { document.getElementById("panelNotificacionesPOS")?.classList.remove("abierto"); }
function ejecutarAccionNotificacionPOS(accion) {
 cerrarNotificacionesPOS();
 if (!accion) return;
 try {
  const datos = typeof accion === "string" ? JSON.parse(accion) : accion;
  if (datos.tipo === "inventarioBajo") {
   mostrarInventarioBajo();
   setTimeout(() => {
    const campo = document.getElementById("buscarInventarioBajo");
    if (campo && datos.texto) {
     campo.value = datos.texto;
     renderInventarioBajo();
    }
   }, 120);
   return;
  }
  if (datos.tipo === "credito") {
   abrirCuentaCliente(datos.clienteId);
   return;
  }
 } catch (error) {
  console.warn("No se pudo ejecutar accion", error);
 }
}
function opcionesHorasRecordatorioPOS() { return Array.from({ length: 12 }, (_, indice) => { const hora = indice + 1; return '<option value="' + hora + '">' + hora + '</option>'; }).join(""); }
function opcionesMinutosRecordatorioPOS() { return Array.from({ length: 12 }, (_, indice) => String(indice * 5).padStart(2, "0")).map(minuto => '<option value="' + minuto + '">' + minuto + '</option>').join(""); }
function actualizarVistaHoraRecordatorioPOS() { const hora = document.getElementById("recordatorioHoraNumeroPOS")?.value || "9"; const minutos = document.getElementById("recordatorioMinutosPOS")?.value || "00"; const periodo = document.getElementById("recordatorioPeriodoPOS")?.value || "AM"; const texto = document.getElementById("recordatorioVistaHoraPOS"); if (texto) texto.textContent = "Recordarme a las " + hora + ":" + minutos + " " + periodo; }
function horaRecordatorio24hPOS() { const hora = Number(document.getElementById("recordatorioHoraNumeroPOS")?.value || 9); const minutos = document.getElementById("recordatorioMinutosPOS")?.value || "00"; const periodo = document.getElementById("recordatorioPeriodoPOS")?.value || "AM"; const hora24 = periodo === "PM" ? (hora === 12 ? 12 : hora + 12) : (hora === 12 ? 0 : hora); return String(hora24).padStart(2, "0") + ":" + minutos; }
function asegurarModalRecordatorioPOS() { let modal = document.getElementById("modalRecordatorioPOS"); if (modal) return modal; modal = document.createElement("div"); modal.id = "modalRecordatorioPOS"; modal.className = "modal-personalizado"; modal.style.display = "none"; modal.innerHTML = '<div class="modal-card recordatorio-card"><div class="modal-card-header"><div><span>Agenda operativa</span><h3>Nuevo recordatorio</h3></div><button type="button" onclick="cerrarRecordatorioPOS()">Cerrar</button></div><div class="recordatorio-form"><label>Tarea<input id="recordatorioTituloPOS" type="text" placeholder="Ej. llamar proveedor Truper"></label><label>Fecha<input id="recordatorioFechaPOS" type="date"></label><div class="recordatorio-hora-card"><span>Hora del aviso</span><div class="recordatorio-hora-grid"><label>Hora<select id="recordatorioHoraNumeroPOS" onchange="actualizarVistaHoraRecordatorioPOS()">' + opcionesHorasRecordatorioPOS() + '</select></label><label>Minutos<select id="recordatorioMinutosPOS" onchange="actualizarVistaHoraRecordatorioPOS()">' + opcionesMinutosRecordatorioPOS() + '</select></label><label>Turno<select id="recordatorioPeriodoPOS" onchange="actualizarVistaHoraRecordatorioPOS()"><option>AM</option><option>PM</option></select></label></div><strong id="recordatorioVistaHoraPOS">Recordarme a las 9:00 AM</strong></div><label>Prioridad<select id="recordatorioPrioridadPOS"><option>Media</option><option>Alta</option><option>Baja</option></select></label></div><div class="modal-actions-row"><button type="button" onclick="cerrarRecordatorioPOS()">Cancelar</button><button type="button" class="btn-principal" onclick="guardarRecordatorioDesdeModalPOS()">Guardar recordatorio</button></div></div>'; document.body.appendChild(modal); return modal; }
function abrirRecordatorioPOS() { const modal = asegurarModalRecordatorioPOS(); modal.style.display = "flex"; actualizarVistaHoraRecordatorioPOS(); setTimeout(() => document.getElementById("recordatorioTituloPOS")?.focus(), 80); }
function cerrarRecordatorioPOS() { const modal = document.getElementById("modalRecordatorioPOS"); if (modal) modal.style.display = "none"; }
function guardarRecordatorioDesdeModalPOS() { const titulo = document.getElementById("recordatorioTituloPOS")?.value.trim(); const fecha = document.getElementById("recordatorioFechaPOS")?.value; const hora = horaRecordatorio24hPOS(); const horaTexto = document.getElementById("recordatorioVistaHoraPOS")?.textContent.replace("Recordarme a las ", "") || hora; const prioridad = document.getElementById("recordatorioPrioridadPOS")?.value || "Media"; if (!titulo) { alertaPOS("Falta informacion", "Escribe la tarea del recordatorio."); return; } const recordatorios = recordatoriosPOSGuardados(); recordatorios.unshift({ id: 'rec-' + Date.now(), titulo, fecha, hora, horaTexto, prioridad, completado: false, creado: new Date().toISOString() }); guardarRecordatoriosPOS(recordatorios); cerrarRecordatorioPOS(); alertaPOS("Recordatorio guardado", [fecha, horaTexto].filter(Boolean).join(" ") || "Aparecera en el centro de notificaciones."); }
function completarRecordatorioPOS(id) { guardarRecordatoriosPOS(recordatoriosPOSGuardados().map(item => item.id === id ? { ...item, completado: true, completadoEn: new Date().toISOString() } : item)); }
async function limpiarTodasNotificacionesPOS() {
 const items = notificacionesSistemaPOS();
 if (!items.length) return;
 const primera = await confirmarPOS("Se ocultaran las notificaciones actuales y se completaran los recordatorios visibles.", "Limpiar notificaciones", "alerta");
 if (!primera) return;
 const segunda = await confirmarPOS("Confirmar limpieza total del centro de notificaciones?", "Confirmar limpieza", "peligro");
 if (!segunda) return;
 const idsAutomaticos = items.filter(item => !item.recordatorio).map(item => item.id);
 if (idsAutomaticos.length) {
  guardarNotificacionesDescartadasPOS([...notificacionesDescartadasPOS(), ...idsAutomaticos]);
 }
 const idsRecordatorios = new Set(items.filter(item => item.recordatorio).map(item => item.id));
 if (idsRecordatorios.size) {
  guardarRecordatoriosPOS(recordatoriosPOSGuardados().map(item => idsRecordatorios.has(item.id) ? { ...item, completado: true, completadoEn: new Date().toISOString() } : item));
 }
 renderTopbarPOS();
 alertaPOS("Notificaciones limpiadas", "El centro quedo listo.", "exito");
}
function instalarWrappersShellPOS() { const wrappers = { mostrarInicio:["Inicio","Resumen operativo de ventas, creditos e inventario","inicio"], mostrarPuntoVenta:["Punto de venta","Venta rapida, cobro, credito y carrito ferretero","venta"], mostrarInventario:["Inventario","Productos, categorias, stock y precios de ferreteria","inventario"], mostrarCategoriasInventario:["Categorias","Organizacion ferretera por familias de producto","categorias"], mostrarInventarioBajo:["Inventario bajo","Alertas y sugerencias para reabastecer","inventario-bajo"], mostrarGraficas:["Reportes y ventas","Indicadores reales de operacion y caja","reportes"], mostrarClientes:["Clientes","Cuentas, historial y relacion comercial","clientes"], mostrarProveedores:["Proveedores","Distribuidores, contactos y catalogos","proveedores"], mostrarCatalogo:["Catalogo proveedor","Carga, mapeo y mantenimiento de listas","catalogo"], mostrarConfiguracion:["Configuracion","Empresa, usuarios, tickets y apariencia","configuracion"] }; Object.entries(wrappers).forEach(([nombre, contexto]) => { const original = window[nombre]; if (typeof original !== "function" || original.__shellPOS) return; const envuelta = function(...args) { const resultado = original.apply(this, args); setTimeout(() => { actualizarTopbarContexto(contexto[0], contexto[1], contexto[2]); cerrarNotificacionesPOS(); }, 20); return resultado; }; envuelta.__shellPOS = true; window[nombre] = envuelta; }); ["cargarProductos", "cargarCreditos"].forEach(nombre => { const original = window[nombre]; if (typeof original !== "function" || original.__notifyPOS) return; const envuelta = function(...args) { const resultado = original.apply(this, args); Promise.resolve(resultado).finally(() => setTimeout(() => { renderTopbarPOS(); renderNotificacionesPOS(); }, 30)); return resultado; }; envuelta.__notifyPOS = true; window[nombre] = envuelta; }); }
function iniciarShellFerreteroPOS() { profesionalizarSidebarPOS(); [900, 1500, 2600, 4200].forEach(ms => setTimeout(() => { if (typeof window.repararSidebarNexoPOS === "function") window.repararSidebarNexoPOS(); else profesionalizarSidebarPOS(); }, ms)); renderTopbarPOS(); instalarWrappersShellPOS(); instalarAtajoDesarrolladorNexoPOS(); instalarMonitorSyncDesktopPOS(); actualizarModuloActivoPOS("inicio"); if (!window.__clickShellPOS) { window.__clickShellPOS = true; document.addEventListener("click", event => { const panel = document.getElementById("panelNotificacionesPOS"); const boton = document.getElementById("btnNotificacionesPOS"); const menuNexo = document.getElementById("menuNexoPOS"); const botonNexo = document.getElementById("btnMenuNexoPOS"); if (panel && boton && !panel.contains(event.target) && !boton.contains(event.target)) panel.classList.remove("abierto"); if (menuNexo && botonNexo && !menuNexo.contains(event.target) && !botonNexo.contains(event.target)) cerrarMenuNexoPOS(); }); } }
(function conectarShellFerreteroPOS() { const onloadOriginal = window.onload; window.onload = async function(...args) { if (typeof onloadOriginal === "function") await onloadOriginal.apply(this, args); iniciarShellFerreteroPOS(); }; if (document.readyState !== "loading") setTimeout(iniciarShellFerreteroPOS, 60); else document.addEventListener("DOMContentLoaded", () => setTimeout(iniciarShellFerreteroPOS, 60)); })();



/* Captura global de lector USB */
(function instalarScannerUsbPOS() {
 if (window.__scannerUsbPOS) return;
 window.__scannerUsbPOS = true;

 let buffer = "";
 let ultimoTiempo = 0;
 let temporizador = null;

 function puntoVentaVisible() {
  const pantalla =
  document.getElementById("pantallaPuntoVenta");

  return pantalla && pantalla.style.display !== "none";
 }

 function modalOperativoAbierto() {
  return Boolean(
  document.querySelector('.modal-overlay[style*="flex"], .modal-personalizado[style*="flex"], .modal-form-credito[style*="flex"]')
  );
 }

 function reiniciar() {
  buffer = "";
  ultimoTiempo = 0;
  clearTimeout(temporizador);
  temporizador = null;
 }

 function enviarCodigo() {
  const codigo =
  normalizarCodigo(buffer);

  reiniciar();

  if (!codigo || codigo.length < 4) return;

  if (typeof procesarCodigoBarrasPos === "function") {
   procesarCodigoBarrasPos(codigo);
  }
 }

 document.addEventListener("keydown", event => {
  if (!puntoVentaVisible() || modalOperativoAbierto()) return;

  const objetivo =
  event.target;

  const escribiendo =
  objetivo && ["INPUT", "TEXTAREA", "SELECT"].includes(objetivo.tagName);

  if (escribiendo && objetivo.id !== "busqueda") return;

  const ahora =
  Date.now();

  if (ahora - ultimoTiempo > 80) {
   buffer = "";
  }

  ultimoTiempo = ahora;

  if (event.key === "Enter") {
   if (buffer.length >= 4) {
    event.preventDefault();
    enviarCodigo();
   }
   return;
  }

  if (/^[a-zA-Z0-9]$/.test(event.key)) {
   buffer += event.key;
   clearTimeout(temporizador);
   temporizador = setTimeout(reiniciar, 140);

   if (!escribiendo) {
    event.preventDefault();
   }
  }
 });
})();


/* Limpieza final de texto visible */
function limpiarTextoUI(texto) { return String(texto || '').replace(/[\uFFFD]/g, '').replace(/\u00c3\u00a1/g, 'a').replace(/\u00c3\u00a9/g, 'e').replace(/\u00c3\u00ad/g, 'i').replace(/\u00c3\u00b3/g, 'o').replace(/\u00c3\u00ba/g, 'u').replace(/\u00c3\u00b1/g, 'n').replace(/\u00c3\u0161/g, 'U').replace(/\u00c3\u201a&middot;|\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7|&middot;/g, '-').replace(/[\u00f0][^\s]*/g, '').replace(/\s+/g, ' ').trim(); }


/* Fase 2 - Flujo ferretero de producto y carrito */
(function instalarFlujoFerreteroPOS(){
 if (window.__flujoFerreteroPOSV2) return;
 window.__flujoFerreteroPOSV2 = true;

 const tipoInfo = {
  catalogo: ["Producto con codigo", "Escanea el codigo de barras o escribe la clave. Si existe en catalogos, se llena nombre, proveedor, marca y precios.", "Al encontrarlo, el cursor salta directo a Stock actual."],
  manual: ["Producto sin codigo", "Para articulos genericos o sueltos. El sistema genera un codigo interno automatico para venderlo y controlarlo.", "Ideal para escobas genericas, piezas sin etiqueta o producto local."],
  granel: ["Venta a granel", "Preparado para kilo, metro, litro o tramo. El carrito acepta cantidades decimales y queda listo para bascula digital.", "Ideal para cable, clavos, manguera, cadena, tubo o liquidos."],
  servicio: ["Servicio", "Para mano de obra, cortes, ajustes, instalacion o cargos sin inventario fisico.", "Se cobra desde el POS sin depender de stock real."]
 };

 function seguro(texto) {
  return String(limpiarTextoUI(texto || ""))
   .replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");
 }

 function unidadNombre(unidad) {
  const mapa = {
   pieza: "pieza", metro: "metro", kg: "kg", kilo: "kg", gramo: "gramo", litro: "litro",
   caja: "caja", paquete: "paquete", tramo: "tramo", saco: "saco", bulto: "bulto", servicio: "servicio"
  };
  return mapa[String(unidad || "pieza").toLowerCase()] || String(unidad || "pieza");
 }

 function asegurarAyudaTipoProducto() {
  const selector = document.querySelector("#modalAgregar .tipo-producto-selector");
  if (!selector) return null;

  let ayuda = document.getElementById("ayudaTipoProductoPOS");
  if (!ayuda) {
   ayuda = document.createElement("div");
   ayuda.id = "ayudaTipoProductoPOS";
   ayuda.className = "producto-tipo-ayuda";
   selector.insertAdjacentElement("afterend", ayuda);
  }
  return ayuda;
 }

 function mejorarTarjetasTipoProducto() {
  const defs = {
   catalogo: ["barcode", "Con codigo", "Escaner o catalogo"],
   manual: ["inventory", "Sin codigo", "Generar interno"],
   granel: ["scale", "Granel", "Kg, metro o litro"],
   servicio: ["settings", "Servicio", "Mano de obra"]
  };

  document.querySelectorAll("#modalAgregar .tipo-producto-card").forEach(boton => {
   const tipo = boton.dataset.tipoProducto || "catalogo";
   const def = defs[tipo];
   if (!def || boton.dataset.ferreteroUi === "1") return;

   boton.dataset.ferreteroUi = "1";
   boton.innerHTML =
    '<span class="tipo-producto-icon">' +
    (typeof iconoUISVG === "function" ? iconoUISVG(def[0]) : "") +
    '</span><span class="tipo-producto-copy"><strong>' +
    def[1] +
    "</strong><small>" +
    def[2] +
    "</small></span>";
  });
 }

 function actualizarAyudaTipoProducto(tipo) {
  const ayuda = asegurarAyudaTipoProducto();
  if (!ayuda) return;

  const info = tipoInfo[tipo || "catalogo"] || tipoInfo.catalogo;
  ayuda.innerHTML =
   "<div><strong>" +
   seguro(info[0]) +
   "</strong><span>" +
   seguro(info[1]) +
   "</span></div><small>" +
   seguro(info[2]) +
   "</small>";
 }

 const seleccionarBase = window.seleccionarTipoProducto;
 window.seleccionarTipoProducto = function(tipo) {
  const tipoFinal = tipo || "catalogo";
  if (typeof seleccionarBase === "function") seleccionarBase(tipoFinal);

  mejorarTarjetasTipoProducto();
  actualizarAyudaTipoProducto(tipoFinal);

  const codigo = document.getElementById("nuevoCodigo");
  const stock = document.getElementById("nuevoStock");
  const unidad = document.getElementById("unidadVenta");
  const bascula = document.getElementById("basculaDigital");
  const precio = document.getElementById("nuevoPrecio");

  if (codigo) {
   codigo.autocomplete = "off";
   codigo.inputMode = tipoFinal === "catalogo" ? "numeric" : "text";
  }

  if (tipoFinal === "manual") {
   if (codigo && (!codigo.value || codigo.dataset.codigoAutomatico === "1")) {
    codigo.value = generarCodigoInternoProducto("manual", document.getElementById("nuevaCategoria")?.value || "");
    codigo.dataset.codigoAutomatico = "1";
   }
   if (stock && !stock.value) stock.value = "1";
  }

 if (tipoFinal === "granel") {
   if (unidad && !["kg", "metro", "litro", "gramo"].includes(unidad.value)) unidad.value = "kg";
   if (bascula) bascula.value = "preparado";
   if (stock) stock.step = "0.001";
   if (precio) precio.placeholder = "Precio por unidad de venta";
  } else if (stock) {
   stock.step = esUnidadDecimal(unidad?.value) ? "0.001" : "1";
  }
 };

 function organizarFormularioProductoTabs() {
  const form = document.querySelector("#modalAgregar .ficha-producto");
  if (!form || form.dataset.tabsProducto === "1") return;

  if (typeof asegurarEtiquetasFichaProducto === "function") {
   asegurarEtiquetasFichaProducto();
  }

  const grupos = [
   ["basico", "Basico", ["nuevoCodigo", "nuevoNombre", "nuevoCodigoInterno", "nuevaCategoria", "nuevaSubcategoria", "nuevaMarca"]],
   ["precios", "Precios", ["tipoPrecioVenta", "precioDistribuidor", "precioMayoreo", "nuevoPrecio", "precioPublico"]],
   ["inventario", "Inventario", ["nuevoStock", "stockMinimo", "nuevoProveedor", "nuevaUbicacion", "altaRotacion"]],
   ["unidades", "Unidades", ["unidadVenta", "presentacionCompra", "factorConversion", "basculaDigital"]],
   ["codigos", "Codigos", ["codigosRelacionados"]],
   ["avanzado", "Avanzado", ["nuevaDescripcion"]]
  ];

  const tabs = document.createElement("div");
  tabs.className = "producto-tabs";
  tabs.innerHTML = grupos.map((grupo, index) =>
   '<button type="button" class="' + (index === 0 ? "activo" : "") + '" data-producto-tab="' + grupo[0] + '" onclick="cambiarTabProductoPOS(\'' + grupo[0] + '\')">' + grupo[1] + '</button>'
  ).join("");

  form.parentNode.insertBefore(tabs, form);

  grupos.forEach((grupo, index) => {
   const panel = document.createElement("div");
   panel.className = "producto-tab-panel " + (index === 0 ? "activo" : "");
   panel.dataset.productoPanel = grupo[0];

   grupo[2].forEach(id => {
    const campo = document.getElementById(id);
    const wrapper = campo?.closest(".campo-ficha");
    if (wrapper) panel.appendChild(wrapper);
    else if (campo) panel.appendChild(campo);
   });

   form.appendChild(panel);
  });

  const ocultos = ["tipoProductoInventario"];
  ocultos.forEach(id => {
   const campo = document.getElementById(id);
   if (campo) form.insertBefore(campo, form.firstChild);
  });

  form.dataset.tabsProducto = "1";
 }

 window.cambiarTabProductoPOS = function(tab) {
  document.querySelectorAll(".producto-tabs button").forEach(boton => {
   boton.classList.toggle("activo", boton.dataset.productoTab === tab);
  });
  document.querySelectorAll(".producto-tab-panel").forEach(panel => {
   panel.classList.toggle("activo", panel.dataset.productoPanel === tab);
  });
 };

 const mostrarBase = window.mostrarFormularioAgregar;
 window.mostrarFormularioAgregar = function() {
  if (typeof mostrarBase === "function") mostrarBase();
  if (typeof asegurarEtiquetasFichaProducto === "function") {
   asegurarEtiquetasFichaProducto();
  }
  const modalAgregar =
   document.getElementById("modalAgregar");

  if (modalAgregar && modalAgregar.parentElement !== document.body) {
   document.body.appendChild(modalAgregar);
  }

  if (modalAgregar) {
   modalAgregar.style.display = "flex";
  }

  organizarFormularioProductoTabs();
  mejorarTarjetasTipoProducto();
  actualizarAyudaTipoProducto(document.getElementById("tipoProductoInventario")?.value || "catalogo");

  setTimeout(() => {
   const codigo = document.getElementById("nuevoCodigo");
   if (codigo && document.getElementById("modalAgregar")?.style.display !== "none") {
    codigo.focus();
    codigo.select();
   }
  }, 120);
 };

 const cerrarBase = window.cerrarFormularioAgregar;
 window.cerrarFormularioAgregar = function() {
  if (typeof cerrarBase === "function") cerrarBase();
  actualizarAyudaTipoProducto("catalogo");
 };

 window.aplicarCantidadRapidaCarrito = function(index, cantidad) {
  if (!carrito[index]) return;
  cambiarCantidadCarrito(index, cantidad);
 };

 window.actualizarCarrito = function() {
  const contenedor = document.getElementById("carrito");
  if (!contenedor) return;

  const resumen = typeof resumenCarritoPOS === "function"
   ? resumenCarritoPOS()
   : { subtotal: carrito.reduce((suma, item) => suma + Number(item.precio || 0) * Number(item.cantidad || 0), 0), descuento: 0, total: 0, descuentoTipo: "ninguno", descuentoValor: 0 };
  if (!Number.isFinite(Number(resumen.total))) resumen.total = Math.max(0, Number(resumen.subtotal || 0) - Number(resumen.descuento || 0));
  const total = resumen.total;
  const itemsHtml = carrito.length === 0
   ? '<div class="carrito-vacio carrito-vacio-ferretero"><strong>Carrito vacio</strong><span>Escanea, busca o agrega productos para iniciar una venta.</span></div>'
   : carrito.map((p, index) => {
    const unidad = unidadNombre(p.unidadVenta || "pieza");
    const cantidad = Number(p.cantidad || 1);
    const importe = Number(p.precio || 0) * cantidad;
    const decimal = esUnidadDecimal(unidad);
    const botones = decimal
     ? '<div class="cantidad-rapida"><button onclick="aplicarCantidadRapidaCarrito(' + index + ', 0.25)">0.25</button><button onclick="aplicarCantidadRapidaCarrito(' + index + ', 0.5)">0.5</button><button onclick="aplicarCantidadRapidaCarrito(' + index + ', 1)">1</button></div>'
     : "";

    return '<article class="item-carrito item-carrito-ferretero"><div class="item-carrito-info"><span class="item-icono">' +
     iconoProducto(p.nombre) +
     '</span><div><strong>' +
     seguro(p.nombre) +
     "</strong><small>" +
     dinero(p.precio) +
     " por " +
     seguro(unidad) +
     (p.codigo ? " - " + seguro(p.codigo) : "") +
     '</small></div></div><div class="item-cantidad item-cantidad-ferretera"><button title="Quitar" onclick="quitarUnoCarrito(' +
     p.id +
     ')">-</button><input type="number" min="0" step="' +
     (decimal ? "0.001" : "1") +
     '" value="' +
     cantidad +
     '" onchange="cambiarCantidadCarrito(' +
     index +
     ', this.value)"><button title="Agregar" onclick="sumarCantidadCarrito(' +
     index +
     ')">+</button></div><div class="item-carrito-meta"><span>' +
     formatearCantidad(cantidad, unidad) +
     "</span><strong>" +
     dinero(importe) +
     "</strong></div>" +
     botones +
     (p.basculaDigital === "preparado" || decimal
      ? '<button class="btn-bascula" onclick="capturarPesoManual(' + index + ')">Capturar ' + seguro(unidad) + " / bascula</button>"
      : "") +
     "</article>";
   }).join("");

  contenedor.innerHTML =
   '<div class="carrito-items">' +
   itemsHtml +
   '</div><div class="resumen-cobro resumen-cobro-ferretero"><div class="resumen-linea"><span>Subtotal</span><strong>' +
   dinero(resumen.subtotal) +
   '</strong></div><div class="resumen-descuento"><label><span>Descuento</span><select onchange="actualizarDescuentoCarrito(this.value, document.getElementById(\'valorDescuentoCarrito\')?.value || 0)"><option value="ninguno" ' +
   (resumen.descuentoTipo === "ninguno" ? "selected" : "") +
   '>Sin descuento</option><option value="porcentaje" ' +
   (resumen.descuentoTipo === "porcentaje" ? "selected" : "") +
   '>Porcentaje</option><option value="monto" ' +
   (resumen.descuentoTipo === "monto" ? "selected" : "") +
   '>Monto</option></select></label><input id="valorDescuentoCarrito" type="number" min="0" step="0.01" value="' +
   (resumen.descuentoValor || "") +
   '" placeholder="0" onchange="actualizarDescuentoCarrito(document.querySelector(\'.resumen-descuento select\')?.value || \'ninguno\', this.value)"></div><div class="resumen-linea"><span>Descuento</span><strong>-' +
   dinero(resumen.descuento) +
   '</strong></div><div class="resumen-linea total-ferretero"><span>Total final</span><strong>' +
   dinero(total) +
   '</strong></div><label class="campo-recibido"><span>Recibido</span><input type="number" id="dinero" placeholder="0.00" oninput="calcularCambio(' +
   total +
   ')" onkeydown="cobrarConEnter(event, ' +
   total +
   ')"></label><div class="resumen-linea cambio-linea"><span>Cambio</span><strong id="cambioTexto">$0.00</strong></div><button class="btn-cobrar" onclick="cobrar(' +
   total +
   ')">Cobrar</button><button class="btn-credito-carrito" onclick="cobrarCredito(' +
   total +
   ')">Mandar a credito</button><button class="btn-limpiar" onclick="limpiarCarrito()">Limpiar carrito</button></div>';
 };

 document.addEventListener("change", event => {
  if (event.target?.id === "unidadVenta") {
   window.seleccionarTipoProducto(document.getElementById("tipoProductoInventario")?.value || "catalogo");
  }
 });

 setTimeout(() => {
  mejorarTarjetasTipoProducto();
  actualizarAyudaTipoProducto(document.getElementById("tipoProductoInventario")?.value || "catalogo");
  if (Array.isArray(carrito)) window.actualizarCarrito();
 }, 300);
})();

/* Fase 2 - Pedido inteligente ferretero */
(function instalarPedidoInteligenteFerretero(){
 if (window.__pedidoInteligenteFerreteroV2) return;
 window.__pedidoInteligenteFerreteroV2 = true;

 function textoSeguro(valor) {
  return String(typeof limpiarTextoUI === "function" ? limpiarTextoUI(valor || "") : (valor || ""))
   .replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");
 }

 function productosBajosParaPedido() {
  const base = typeof productosBajoStock === "function" ? productosBajoStock() : [];
  return base.map(producto => {
   const stock = Number(producto.stock || 0);
   const minimo = Number(producto.stock_minimo ?? producto.stockMinimo ?? 3);
   const objetivo = Math.max(minimo * 2, minimo + 5, 6);
   const sugerido = Math.max(1, Math.ceil(objetivo - stock));
   const proveedor = producto.proveedor || producto.proveedor_principal || producto.distribuidor || "Sin proveedor";
   return { ...producto, stock, minimo, objetivo, sugerido, proveedor };
  }).sort((a, b) => String(a.proveedor).localeCompare(String(b.proveedor)) || a.stock - b.stock);
 }

 function proveedoresBajos(lista) {
  return [...new Set(lista.map(item => item.proveedor || "Sin proveedor"))].sort((a, b) => a.localeCompare(b));
 }

 function renderPedidoInteligente(proveedorSeleccionado) {
  const contenedor = document.getElementById("listaSugerenciaPedido");
  if (!contenedor) return;

  const lista = productosBajosParaPedido();
  const proveedores = proveedoresBajos(lista);
  const proveedor = proveedorSeleccionado || proveedores[0] || "Todos";
  const filtrados = proveedor === "Todos" ? lista : lista.filter(item => item.proveedor === proveedor);
  const unidades = filtrados.reduce((suma, item) => suma + Number(item.sugerido || 0), 0);
  const sinStock = filtrados.filter(item => Number(item.stock || 0) <= 0).length;

  if (!lista.length) {
   contenedor.innerHTML = '<div class="pedido-empty"><strong>Inventario saludable</strong><span>No hay productos debajo del minimo.</span></div>';
   return;
  }

  const opciones = ['<option value="Todos">Todos los proveedores</option>']
   .concat(proveedores.map(nombre => '<option value="' + textoSeguro(nombre) + '"' + (nombre === proveedor ? " selected" : "") + '>' + textoSeguro(nombre) + '</option>'))
   .join("");

  const filas = filtrados.map(item => {
   const unidad = typeof unidadProducto === "function" ? unidadProducto(item) : (item.unidadVenta || "pieza");
   const estado = item.stock <= 0 ? "Sin existencia" : "Bajo minimo";
   const prioridad = item.stock <= 0 ? "alta" : "media";
   return '<tr><td><strong>' + textoSeguro(item.nombre || "Producto") + '</strong><small>' + textoSeguro(item.categoria || item.marca || "Ferreteria") + '</small></td><td>' +
    textoSeguro(item.codigo || item.codigo_interno || "Sin codigo") + '</td><td>' +
    textoSeguro(item.proveedor || "Sin proveedor") + '</td><td>' +
    textoSeguro(item.stock) + ' ' + textoSeguro(unidad) + '</td><td>' +
    textoSeguro(item.minimo) + '</td><td><b>' +
    textoSeguro(item.sugerido) + ' ' + textoSeguro(unidad) + '</b></td><td><span class="pedido-prioridad ' + prioridad + '">' + estado + '</span></td></tr>';
  }).join("");

  contenedor.innerHTML =
   '<div class="pedido-control"><label>Distribuidor<select id="pedidoProveedorFiltro" onchange="renderPedidoInteligenteFerretero(this.value)">' +
   opciones +
   '</select></label><div class="pedido-kpis"><div><span>Productos</span><strong>' + filtrados.length + '</strong></div><div><span>Sin stock</span><strong>' + sinStock + '</strong></div><div><span>Piezas sugeridas</span><strong>' + unidades + '</strong></div></div></div>' +
   '<div class="pedido-tabla-wrap"><table class="pedido-tabla"><thead><tr><th>Producto</th><th>Codigo</th><th>Proveedor</th><th>Actual</th><th>Minimo</th><th>Pedir</th><th>Prioridad</th></tr></thead><tbody>' +
   filas +
   '</tbody></table></div>';
 }

 window.renderPedidoInteligenteFerretero = renderPedidoInteligente;

 window.generarSugerenciaPedido = function() {
  const lista = productosBajosParaPedido();
  if (!lista.length) {
   alertaPOS("Inventario saludable", "No hay productos por debajo del stock minimo.", "info");
   return;
  }
  renderPedidoInteligente("Todos");
  const modal = document.getElementById("modalSugerenciaPedido");
  if (modal) modal.style.display = "flex";
 };

 const cerrarBase = window.cerrarSugerenciaPedido;
 window.cerrarSugerenciaPedido = function() {
  const modal = document.getElementById("modalSugerenciaPedido");
  if (modal) modal.style.display = "none";
  if (typeof cerrarBase === "function") {
   try { cerrarBase(); } catch (error) { console.warn(error); }
  }
 };

 function cerrarOverlaysOperativos() {
  document.getElementById("modalCategoriaProductos")?.style && (document.getElementById("modalCategoriaProductos").style.display = "none");
  document.getElementById("modalSugerenciaPedido")?.style && (document.getElementById("modalSugerenciaPedido").style.display = "none");
  document.getElementById("modalRecordatorioPOS")?.style && (document.getElementById("modalRecordatorioPOS").style.display = "none");
 }

 ["mostrarInicio", "mostrarPuntoVenta", "mostrarInventario", "mostrarInventarioBajo", "mostrarGraficas", "mostrarClientes", "mostrarProveedores", "mostrarCatalogo", "mostrarConfiguracion"].forEach(nombre => {
  const original = window[nombre];
  if (typeof original !== "function" || original.__cierraOverlaysFerreteria) return;
  const envuelta = function(...args) {
   cerrarOverlaysOperativos();
   return original.apply(this, args);
  };
  envuelta.__cierraOverlaysFerreteria = true;
  window[nombre] = envuelta;
 });
})();

/* Fase 3 - Recepcion inteligente de mercancia */
(function instalarRecepcionInteligenteMercancia(){
 if (window.__recepcionMercanciaV1) return;
 window.__recepcionMercanciaV1 = true;

  const estadoRecepcion = {
   archivo: null,
   proveedor: "",
   documento: {
    tipo: "Factura",
    folio: "",
    fecha: "",
    subtotal: 0,
    iva: 0,
    total: 0
   },
   conceptos: []
  };

 function textoSeguro(valor) {
  return String(typeof limpiarTextoUI === "function" ? limpiarTextoUI(valor || "") : (valor || ""))
   .replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");
 }

 function numero(valor) {
  const n = Number(String(valor ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
 }

 function codigoLimpio(valor) {
  if (typeof normalizarCodigo === "function") return normalizarCodigo(valor);
  return String(valor || "").replace(/[^a-zA-Z0-9]/g, "").trim();
 }

 function productoId(producto) {
  return codigoLimpio(producto?.codigo || producto?.codigo_interno || producto?.id || "");
 }

 function asegurarPantallaRecepcion() {
  let pantalla = document.getElementById("pantallaRecepcionMercancia");
  if (pantalla) return pantalla;

  const main = document.querySelector("main.contenido") || document.getElementById("sistema");
  pantalla = document.createElement("section");
  pantalla.id = "pantallaRecepcionMercancia";
  pantalla.style.display = "none";
  pantalla.innerHTML = `
   <div class="recepcion-shell">
    <div class="recepcion-header">
     <div>
      <span>Compras ferreteras</span>
      <h2>Recepcion de mercancia</h2>
      <p>Registra factura o remision, compara contra inventario y actualiza existencias con vista previa.</p>
     </div>
     <button type="button" onclick="limpiarRecepcionMercancia()">Nueva recepcion</button>
    </div>

    <div class="recepcion-grid">
     <section class="recepcion-panel recepcion-carga">
      <h3>Archivo de compra</h3>
       <p>Prioridad recomendada: XML CFDI. Tambien acepta CSV exportado desde Excel con columnas de factura.</p>
       <label class="recepcion-drop">
        <input id="archivoRecepcionMercancia" type="file" accept=".xml,.csv,.txt,.xlsx,.xls,.pdf" onchange="leerArchivoRecepcionMercancia(this.files[0])">
        <strong>Seleccionar archivo</strong>
        <span id="recepcionArchivoNombre">XML CFDI, CSV o Excel</span>
       </label>
       <div class="recepcion-form">
        <label>Proveedor
         <input id="recepcionProveedor" placeholder="Ej. Truper, Diprofer, proveedor local" oninput="estadoRecepcionProveedor(this.value)">
        </label>
        <label>Folio / factura
         <input id="recepcionFolio" placeholder="Ej. A1143646" oninput="estadoRecepcionDocumento('folio', this.value)">
        </label>
        <label>Fecha del documento
         <input id="recepcionFecha" type="date" onchange="estadoRecepcionDocumento('fecha', this.value)">
        </label>
        <label>Categoria para productos nuevos
         <input id="recepcionCategoriaDefault" placeholder="Ej. Electricos, Tornilleria, Plomeria">
        </label>
       </div>
      <div class="recepcion-ayuda">
       <strong>Como trabaja</strong>
       <span>Si encuentra codigo o nombre, suma stock. Si no existe, prepara el producto para crearlo con datos minimos.</span>
      </div>
     </section>

     <section class="recepcion-panel">
      <h3>Resumen</h3>
      <div class="recepcion-kpis">
       <div><span>Conceptos</span><strong id="recepcionTotalConceptos">0</strong></div>
       <div><span>Existentes</span><strong id="recepcionExistentes">0</strong></div>
       <div><span>Nuevos</span><strong id="recepcionNuevos">0</strong></div>
        <div><span>Subtotal</span><strong id="recepcionSubtotal">$0.00</strong></div>
        <div><span>IVA</span><strong id="recepcionIva">$0.00</strong></div>
        <div><span>Total</span><strong id="recepcionImporte">$0.00</strong></div>
       </div>
       <div class="recepcion-documento-resumen">
        <span id="recepcionDocumentoResumen">Sin documento cargado</span>
       </div>
       <button type="button" class="btn-recepcion-confirmar" onclick="confirmarRecepcionMercancia()">Confirmar entrada</button>
      </section>
    </div>

    <section class="recepcion-panel recepcion-preview">
     <div class="recepcion-preview-head">
      <div>
       <h3>Vista previa</h3>
       <p>Revisa cantidades y costos antes de tocar inventario.</p>
      </div>
      <button type="button" onclick="renderRecepcionMercancia()">Recalcular</button>
     </div>
     <div id="tablaRecepcionMercancia" class="recepcion-tabla-wrap">
      <div class="recepcion-empty">Carga un XML CFDI o CSV para comenzar.</div>
     </div>
    </section>
   </div>
  `;
  main.appendChild(pantalla);
  return pantalla;
 }

 function instalarBotonRecepcion() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || sidebar.querySelector('[data-modulo="recepcion"]')) return;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.dataset.modulo = "recepcion";
  boton.setAttribute("onclick", "mostrarRecepcionMercancia()");
  boton.innerHTML = (typeof iconoUISVG === "function" ? iconoUISVG("truck") : "") + "<span>Recepcion</span>";

  const catalogo = [...sidebar.querySelectorAll("button")].find(btn => /Catalogo proveedor/i.test(btn.textContent || ""));
  if (catalogo) catalogo.insertAdjacentElement("beforebegin", boton);
  else sidebar.appendChild(boton);
 }

 function ocultarTodoRecepcion() {
  [
   "pantallaInicio", "pantallaPuntoVenta", "pantallaInventario", "pantallaCategoriasInventario",
   "pantallaCatalogo", "pantallaClientes", "pantallaProveedores", "pantallaInventarioBajo",
   "pantallaReportes", "pantallaConfiguracion", "pantallaRecepcionMercancia"
  ].forEach(id => {
   const el = document.getElementById(id);
   if (el) el.style.display = "none";
  });
  document.getElementById("modalCategoriaProductos")?.style && (document.getElementById("modalCategoriaProductos").style.display = "none");
  document.getElementById("modalSugerenciaPedido")?.style && (document.getElementById("modalSugerenciaPedido").style.display = "none");
 }

 window.mostrarRecepcionMercancia = async function() {
  asegurarPantallaRecepcion();
  instalarBotonRecepcion();
  ocultarTodoRecepcion();
  const pantalla = document.getElementById("pantallaRecepcionMercancia");
  if (pantalla) pantalla.style.display = "block";
  if (typeof actualizarModuloActivoPOS === "function") actualizarModuloActivoPOS("recepcion");
  if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Recepcion de mercancia", "Entrada de compras, XML CFDI y actualizacion de inventario", "recepcion");
  if (!Array.isArray(todosProductos) || !todosProductos.length) {
   try { await cargarProductos(); } catch (error) { console.warn(error); }
  }
  renderRecepcionMercancia();
 };

  window.estadoRecepcionProveedor = function(valor) {
   estadoRecepcion.proveedor = valor || "";
   renderRecepcionMercancia();
  };

  window.estadoRecepcionDocumento = function(campo, valor) {
   estadoRecepcion.documento[campo] = campo === "subtotal" || campo === "iva" || campo === "total" ? numero(valor) : (valor || "");
   renderRecepcionMercancia();
  };

  function aplicarDocumentoRecepcion(datos = {}) {
   estadoRecepcion.documento = {
    ...estadoRecepcion.documento,
    ...datos
   };
   const folio = document.getElementById("recepcionFolio");
   const fecha = document.getElementById("recepcionFecha");
   if (folio && datos.folio !== undefined) folio.value = datos.folio || "";
   if (fecha && datos.fecha !== undefined) fecha.value = datos.fecha || "";
  }

  function conceptosDesdeXml(texto) {
   const doc = new DOMParser().parseFromString(texto, "text/xml");
   const error = doc.querySelector("parsererror");
   if (error) throw new Error("XML invalido");

   const comprobante = doc.getElementsByTagNameNS("*", "Comprobante")[0] || doc.getElementsByTagName("cfdi:Comprobante")[0] || doc.documentElement;
   const emisor = doc.getElementsByTagNameNS("*", "Emisor")[0] || doc.getElementsByTagName("cfdi:Emisor")[0];
   const proveedor = emisor?.getAttribute("Nombre") || emisor?.getAttribute("Rfc") || "";
   if (proveedor && !estadoRecepcion.proveedor) {
    estadoRecepcion.proveedor = proveedor;
   const input = document.getElementById("recepcionProveedor");
    if (input) input.value = proveedor;
   }

   const impuestos = doc.getElementsByTagNameNS("*", "Impuestos")[0] || doc.getElementsByTagName("cfdi:Impuestos")[0];
   const fechaXml = comprobante?.getAttribute("Fecha") || "";
   aplicarDocumentoRecepcion({
    tipo: "Factura",
    folio: comprobante?.getAttribute("Folio") || comprobante?.getAttribute("Serie") || estadoRecepcion.documento.folio || "",
    fecha: fechaXml ? fechaXml.slice(0, 10) : estadoRecepcion.documento.fecha,
    subtotal: numero(comprobante?.getAttribute("SubTotal") || 0),
    iva: numero(impuestos?.getAttribute("TotalImpuestosTrasladados") || 0),
    total: numero(comprobante?.getAttribute("Total") || 0)
   });

  const nodos = [
   ...doc.getElementsByTagNameNS("*", "Concepto"),
   ...doc.getElementsByTagName("cfdi:Concepto")
  ];

  return nodos.map(nodo => ({
   codigo: codigoLimpio(nodo.getAttribute("NoIdentificacion") || nodo.getAttribute("ClaveProdServ") || ""),
   descripcion: nodo.getAttribute("Descripcion") || "Producto sin descripcion",
   cantidad: numero(nodo.getAttribute("Cantidad") || 1),
   costo: numero(nodo.getAttribute("ValorUnitario") || 0),
   importe: numero(nodo.getAttribute("Importe") || 0),
   unidad: nodo.getAttribute("Unidad") || nodo.getAttribute("ClaveUnidad") || "pieza"
  })).filter(item => item.descripcion || item.codigo);
 }

 function separarCsvLinea(linea) {
  const partes = [];
  let actual = "";
  let comillas = false;
  for (const char of linea) {
   if (char === '"') { comillas = !comillas; continue; }
   if ((char === "," || char === ";") && !comillas) {
    partes.push(actual.trim());
    actual = "";
   } else {
    actual += char;
   }
  }
  partes.push(actual.trim());
  return partes;
 }

 function indicePorEncabezado(headers, patrones) {
  return headers.findIndex(h => patrones.some(p => p.test(h)));
 }

  function conceptosDesdeCsv(texto) {
  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lineas.length) return [];
  const headersRaw = separarCsvLinea(lineas[0]);
  const headers = headersRaw.map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const idxCodigo = indicePorEncabezado(headers, [/codigo/, /clave/, /sku/, /no.?ident/]);
  const idxDesc = indicePorEncabezado(headers, [/descripcion/, /producto/, /nombre/, /concepto/]);
  const idxCant = indicePorEncabezado(headers, [/cantidad/, /cant/, /existencia/]);
  const idxCosto = indicePorEncabezado(headers, [/valor.?unit/, /costo/, /precio/, /unitario/]);
   const idxImporte = indicePorEncabezado(headers, [/importe/, /total/]);
   const idxUnidad = indicePorEncabezado(headers, [/unidad/, /medida/]);
   const idxFolio = indicePorEncabezado(headers, [/folio/, /factura/, /documento/]);
   const idxFecha = indicePorEncabezado(headers, [/fecha/]);
   const idxProveedor = indicePorEncabezado(headers, [/proveedor/, /emisor/]);

   const primera = separarCsvLinea(lineas[1] || "");
   if (idxProveedor >= 0 && primera[idxProveedor] && !estadoRecepcion.proveedor) {
    estadoRecepcion.proveedor = primera[idxProveedor];
    const input = document.getElementById("recepcionProveedor");
    if (input) input.value = primera[idxProveedor];
   }
   aplicarDocumentoRecepcion({
    folio: idxFolio >= 0 ? primera[idxFolio] || estadoRecepcion.documento.folio : estadoRecepcion.documento.folio,
    fecha: idxFecha >= 0 ? primera[idxFecha] || estadoRecepcion.documento.fecha : estadoRecepcion.documento.fecha
   });

  return lineas.slice(1).map(linea => {
   const cols = separarCsvLinea(linea);
   return {
    codigo: codigoLimpio(cols[idxCodigo] || ""),
    descripcion: cols[idxDesc] || cols[1] || "Producto sin descripcion",
    cantidad: numero(cols[idxCant] || 1),
    costo: numero(cols[idxCosto] || 0),
    importe: numero(cols[idxImporte] || 0),
    unidad: cols[idxUnidad] || "pieza"
   };
  }).filter(item => item.descripcion || item.codigo);
 }

 window.leerArchivoRecepcionMercancia = async function(archivo) {
  if (!archivo) return;
  estadoRecepcion.archivo = archivo;
  const nombre = document.getElementById("recepcionArchivoNombre");
  if (nombre) nombre.textContent = archivo.name;

   const extension = archivo.name.toLowerCase().split(".").pop();
   if (extension === "pdf") {
    alertaPOS("PDF detectado", "Para aplicar inventario usa el XML CFDI de la factura o exporta la tabla a CSV. El PDF servira como referencia visual en la siguiente fase.", "info");
    estadoRecepcion.conceptos = [];
    renderRecepcionMercancia();
    return;
   }

   if (["xlsx", "xls"].includes(extension)) {
    alertaPOS("Excel detectado", "Por ahora exportalo como CSV para lectura directa. Despues agregaremos lector XLSX directo.", "info");
    estadoRecepcion.conceptos = [];
    renderRecepcionMercancia();
    return;
  }

  const texto = await archivo.text();
  try {
   estadoRecepcion.conceptos = extension === "xml" ? conceptosDesdeXml(texto) : conceptosDesdeCsv(texto);
   if (!estadoRecepcion.conceptos.length) throw new Error("Sin conceptos");
   renderRecepcionMercancia();
   alertaPOS("Archivo analizado", "Revisa la vista previa antes de confirmar inventario.", "success");
  } catch (error) {
   console.error(error);
   estadoRecepcion.conceptos = [];
   renderRecepcionMercancia();
   alertaPOS("No se pudo leer", "El archivo no tiene estructura reconocible para esta recepcion.", "error");
  }
 };

 function buscarProductoConcepto(concepto) {
  const codigo = codigoLimpio(concepto.codigo);
  const nombre = String(concepto.descripcion || "").toLowerCase();
  return (todosProductos || []).find(p => {
   const codigos = [p.codigo, p.codigo_interno, ...(Array.isArray(p.codigos_relacionados) ? p.codigos_relacionados.map(c => c.codigo) : [])].map(codigoLimpio).filter(Boolean);
   return (codigo && codigos.includes(codigo)) || (nombre && String(p.nombre || "").toLowerCase() === nombre);
  }) || null;
 }

 function conceptosPreparados() {
  return estadoRecepcion.conceptos.map(concepto => {
   const producto = buscarProductoConcepto(concepto);
   return {
    ...concepto,
    producto,
    existe: Boolean(producto),
    proveedor: estadoRecepcion.proveedor || producto?.proveedor || ""
   };
  });
 }

 window.renderRecepcionMercancia = function() {
  asegurarPantallaRecepcion();
  const contenedor = document.getElementById("tablaRecepcionMercancia");
  if (!contenedor) return;

  const lista = conceptosPreparados();
  const existentes = lista.filter(i => i.existe).length;
  const nuevos = lista.length - existentes;
   const importe = lista.reduce((sum, i) => sum + (Number(i.importe || 0) || Number(i.costo || 0) * Number(i.cantidad || 0)), 0);
   const subtotal = Number(estadoRecepcion.documento.subtotal || 0) || importe;
   const iva = Number(estadoRecepcion.documento.iva || 0);
   const total = Number(estadoRecepcion.documento.total || 0) || (subtotal + iva);
   const formatoDinero = valor => typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2);

  const setText = (id, valor) => {
   const el = document.getElementById(id);
   if (el) el.textContent = valor;
  };
  setText("recepcionTotalConceptos", lista.length);
  setText("recepcionExistentes", existentes);
  setText("recepcionNuevos", nuevos);
   setText("recepcionSubtotal", formatoDinero(subtotal));
   setText("recepcionIva", formatoDinero(iva));
   setText("recepcionImporte", formatoDinero(total));
   setText("recepcionDocumentoResumen", [
    estadoRecepcion.documento.tipo || "Documento",
    estadoRecepcion.documento.folio ? "Folio " + estadoRecepcion.documento.folio : "",
    estadoRecepcion.documento.fecha || "",
    estadoRecepcion.proveedor || ""
   ].filter(Boolean).join(" · ") || "Sin documento cargado");

  if (!lista.length) {
   contenedor.innerHTML = '<div class="recepcion-empty">Carga un XML CFDI o CSV para comenzar.</div>';
   return;
  }

  const filas = lista.map((item, index) => {
   const producto = item.producto;
   const stockActual = Number(producto?.stock || 0);
   const stockNuevo = stockActual + Number(item.cantidad || 0);
    const importeLinea = Number(item.importe || 0) || Number(item.costo || 0) * Number(item.cantidad || 0);
    return '<tr class="' + (item.existe ? "existente" : "nuevo") + '"><td><strong>' + textoSeguro(item.codigo || producto?.codigo || "Sin codigo") + '</strong><small>' + textoSeguro(item.unidad || "pieza") + '</small></td><td><strong>' + textoSeguro(item.descripcion) + '</strong><small>' + (item.existe ? "Actualizar stock" : "Crear producto") + '</small></td><td><input type="number" step="0.001" value="' + textoSeguro(item.cantidad || 0) + '" onchange="editarConceptoRecepcion(' + index + ', \'cantidad\', this.value)"></td><td><input type="number" step="0.01" value="' + textoSeguro(item.costo || 0) + '" onchange="editarConceptoRecepcion(' + index + ', \'costo\', this.value)"></td><td>' + formatoDinero(importeLinea) + '</td><td>' +
     textoSeguro(item.existe ? stockActual + " -> " + stockNuevo : "Nuevo") + '</td><td><span class="recepcion-estado ' + (item.existe ? "ok" : "nuevo") + '">' +
     (item.existe ? "Encontrado" : "Nuevo") + '</span></td></tr>';
   }).join("");

   contenedor.innerHTML = '<table class="recepcion-tabla"><thead><tr><th>Codigo</th><th>Descripcion</th><th>Cantidad</th><th>Costo</th><th>Importe</th><th>Stock</th><th>Estado</th></tr></thead><tbody>' + filas + '</tbody></table>';
 };

 window.editarConceptoRecepcion = function(index, campo, valor) {
  if (!estadoRecepcion.conceptos[index]) return;
  estadoRecepcion.conceptos[index][campo] = campo === "cantidad" || campo === "costo" ? numero(valor) : valor;
  renderRecepcionMercancia();
 };

 function productoPayloadDesdeExistente(producto, item) {
  return {
   nombre: producto.nombre,
   precio: producto.precio,
   stock: Number(producto.stock || 0) + Number(item.cantidad || 0),
   codigo: producto.codigo || item.codigo || "",
   proveedor: producto.proveedor || item.proveedor || "",
   ubicacion: producto.ubicacion || "",
   categoria: producto.categoria || "",
   subcategoria: producto.subcategoria || "",
   marca: producto.marca || "",
   descripcion: producto.descripcion || item.descripcion || "",
   unidadVenta: producto.unidad_venta || producto.unidadVenta || "pieza",
   precioDistribuidor: item.costo || producto.precio_distribuidor || "",
   precioMayoreo: producto.precio_mayoreo || "",
   precioPublico: producto.precio_publico || producto.precio || "",
   stockMinimo: producto.stock_minimo ?? producto.stockMinimo ?? 3,
   altaRotacion: producto.alta_rotacion || producto.altaRotacion || "",
   tipoProducto: producto.tipo_producto || producto.tipoProducto || "catalogo",
   presentacionCompra: producto.presentacion_compra || "",
   factorConversion: producto.factor_conversion || "",
   basculaDigital: producto.bascula_digital || "no",
   codigosRelacionados: []
  };
 }

 function productoPayloadNuevo(item) {
  const categoria = document.getElementById("recepcionCategoriaDefault")?.value || "";
  return {
   nombre: item.descripcion || "Producto nuevo",
   precio: item.costo || 0,
   stock: item.cantidad || 0,
   codigo: item.codigo || "",
   proveedor: item.proveedor || estadoRecepcion.proveedor || "",
   ubicacion: "",
   categoria,
   subcategoria: "",
   marca: "",
   descripcion: item.descripcion || "",
   unidadVenta: "pieza",
   precioDistribuidor: item.costo || "",
   precioMayoreo: "",
   precioPublico: item.costo || "",
   stockMinimo: 3,
   altaRotacion: "",
   tipoProducto: "catalogo",
   presentacionCompra: "",
   factorConversion: "",
   basculaDigital: "no",
   codigosRelacionados: []
  };
 }

 window.confirmarRecepcionMercancia = async function() {
  const lista = conceptosPreparados();
  if (!lista.length) {
   alertaPOS("Sin conceptos", "Carga un archivo antes de confirmar.", "info");
   return;
  }

  const ok = await confirmarPOS("Confirmar recepcion", "Se actualizaran existencias y se crearan productos nuevos cuando haga falta.");
  if (!ok) return;

  let actualizados = 0;
  let creados = 0;
  try {
   for (const item of lista) {
    if (item.existe && item.producto?.id) {
     const respuesta = await fetch("/editar-producto/" + item.producto.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productoPayloadDesdeExistente(item.producto, item))
     });
     if (!respuesta.ok) throw new Error("No se pudo actualizar " + item.descripcion);
     actualizados++;
    } else {
     const respuesta = await fetch("/agregar-producto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productoPayloadNuevo(item))
     });
     if (!respuesta.ok) throw new Error("No se pudo crear " + item.descripcion);
     creados++;
    }
   }
   await cargarProductos();
   limpiarRecepcionMercancia();
   alertaPOS("Recepcion aplicada", actualizados + " actualizados, " + creados + " creados.", "success");
  } catch (error) {
   console.error(error);
   alertaPOS("Recepcion incompleta", error.message || "Revisa la conexion y vuelve a intentar.", "error");
  }
 };

 window.limpiarRecepcionMercancia = function() {
   estadoRecepcion.archivo = null;
   estadoRecepcion.proveedor = "";
   estadoRecepcion.documento = { tipo: "Factura", folio: "", fecha: "", subtotal: 0, iva: 0, total: 0 };
   estadoRecepcion.conceptos = [];
   const archivo = document.getElementById("archivoRecepcionMercancia");
   if (archivo) archivo.value = "";
   const nombre = document.getElementById("recepcionArchivoNombre");
   if (nombre) nombre.textContent = "XML CFDI, CSV o Excel";
   const proveedor = document.getElementById("recepcionProveedor");
   const folio = document.getElementById("recepcionFolio");
   const fecha = document.getElementById("recepcionFecha");
   if (proveedor) proveedor.value = "";
   if (folio) folio.value = "";
   if (fecha) fecha.value = "";
   renderRecepcionMercancia();
  };

 const ocultarBase = window.ocultarPantallasPrincipales;
 if (typeof ocultarBase === "function" && !ocultarBase.__recepcionMercancia) {
  const envuelta = function(...args) {
   const resultado = ocultarBase.apply(this, args);
   document.getElementById("pantallaRecepcionMercancia")?.style && (document.getElementById("pantallaRecepcionMercancia").style.display = "none");
   return resultado;
  };
  envuelta.__recepcionMercancia = true;
  window.ocultarPantallasPrincipales = envuelta;
 }

 setTimeout(() => {
  asegurarPantallaRecepcion();
  instalarBotonRecepcion();
  if (typeof profesionalizarSidebarPOS === "function") profesionalizarSidebarPOS();
 }, 500);
})();

(()=>{if(!window.__fase4Loader){window.__fase4Loader=true;const s=document.createElement("script");s.src="fase4.js?v=20260620";document.body.appendChild(s);}})();
(()=>{if(!window.__fase5Loader){window.__fase5Loader=true;const s=document.createElement("script");s.src="fase5.js?v=20260620";document.body.appendChild(s);}})();
(()=>{if(!window.__fixNavDynamicLoader){window.__fixNavDynamicLoader=true;const s=document.createElement("script");s.src="fix-navegacion.js?v=20260620-1";document.body.appendChild(s);}})();
(()=>{if(!window.__fase6Loader){window.__fase6Loader=true;const s=document.createElement("script");s.src="fase6.js?v=20260620";document.body.appendChild(s);}})();
(()=>{if(!window.__fase7Loader){window.__fase7Loader=true;const s=document.createElement("script");s.src="fase7-pagos.js?v=20260621-4";document.body.appendChild(s);}})();
(()=>{if(!window.__fase7CajaUILoader){window.__fase7CajaUILoader=true;const s=document.createElement("script");s.src="fase7-caja-ui.js?v=20260621";document.body.appendChild(s);}})();

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

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
 creditos: "Consulta creditos pendientes, abonos y el estado de cuenta de cada cliente.",
 proveedores: "Guarda distribuidores, contactos y datos utiles para compras.",
 dueno: "Panel pensado para que el propietario consulte el negocio desde una vista resumida.",
 configuracion: "Ajusta datos del negocio, usuarios, permisos, tickets, soporte y apariencia.",
 cuenta: "Muestra el plan, el estado de la suscripcion y el correo de contacto del negocio."
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
 zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
 credit: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
 sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
 moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
 wrench: '<path d="M21 7.5a5.5 5.5 0 0 1-7.4 5.2L6 20.3 3.7 18l7.6-7.6A5.5 5.5 0 1 1 21 7.5Z"/>',
 drop: '<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Z"/><path d="M12 12v7a2 2 0 0 1-4 0"/>',
 roller: '<rect x="3" y="4" width="12" height="6" rx="1.5"/><path d="M7 10v4h4"/><rect x="9" y="14" width="4" height="6" rx="1"/>',
 toolbox: '<rect x="2" y="8" width="20" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/>',
 leaf: '<path d="M5 21c8 0 14-6 14-14V5h-2C9 5 5 11 5 19v2Z"/><path d="M5 21 19 7"/>',
 grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 bag: '<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
 gift: '<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M12 9v12M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M12 9c-1.4 0-4-.8-4-3a2 2 0 0 1 4-1 2 2 0 0 1 4 1c0 2.2-2.6 3-4 3Z"/>',
 receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
 edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
 trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
 shield: '<path d="M12 3 4 6v6c0 5 3.5 7.8 8 9 4.5-1.2 8-4 8-9V6Z"/>',
 building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1"/>',
 tag: '<path d="M12.6 2H4a2 2 0 0 0-2 2v8.6a2 2 0 0 0 .6 1.4l8.4 8.4a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8L13 2.6a2 2 0 0 0-1.4-.6Z"/><path d="M7 7h.01"/>',
 chevronDown: '<path d="m6 9 6 6 6-6"/>',
 chevronRight: '<path d="m9 6 6 6-6 6"/>',
 chevronLeft: '<path d="m15 6-6 6 6 6"/>',
 threeDots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
 wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4"/><path d="M15 12h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a2 2 0 0 1 0-4Z"/>',
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
 clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h4"/>',
 arrowDownBox: '<path d="M12 3v10"/><path d="m8 9 4 4 4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
 arrowUpBox: '<path d="M12 21V11"/><path d="m8 15 4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
 clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
 swap: '<path d="M7 4v13"/><path d="m3 8 4-4 4 4"/><path d="M17 20V7"/><path d="m21 16-4 4-4-4"/>',
 lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
 eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>',
 eyeOff: '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>'
 };
 const cuerpo = iconos[nombre] || iconos.zap;
 return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + cuerpo + '</svg>';
}

function moduloDesdeEtiquetaPOS(etiqueta) { const texto = limpiarTextoUI(etiqueta).toLowerCase(); if (texto.includes("inicio")) return "inicio"; if (texto.includes("punto")) return "venta"; if (texto === "inventario") return "inventario"; if (texto.includes("productos")) return "productos"; if (texto.includes("categorias")) return "categorias"; if (texto.includes("bajo")) return "inventario-bajo"; if (texto.includes("reporte") || texto.includes("ventas")) return "reportes"; if (texto.includes("credito")) return "creditos"; if (texto.includes("clientes")) return "clientes"; if (texto.includes("proveedores")) return "proveedores"; if (texto.includes("catalogo")) return "catalogo"; if (texto.includes("recepcion")) return "recepcion"; if (texto.includes("caja")) return "caja"; if (texto.includes("finanzas")) return "finanzas"; if (texto.includes("pedidos")) return "pedidos"; if (texto.includes("ajustes")) return "ajustes"; if (texto.includes("configuracion")) return "configuracion"; if (texto.includes("dueno")) return "dueno"; return texto.replace(/[^a-z0-9]+/g, "-") || "modulo"; }
function iconoModuloPOS(modulo) { return { inicio:"home", venta:"cart", inventario:"inventory", productos:"inventory", categorias:"layers", "inventario-bajo":"alert", reportes:"chart", creditos:"credit", clientes:"users", proveedores:"truck", catalogo:"file", recepcion:"truck", caja:"zap", finanzas:"chart", pedidos:"file", ajustes:"settings", configuracion:"settings", dueno:"chart", cuenta:"wallet" }[modulo] || "zap"; }
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
  "creditos",
  "proveedores",
  "dueno",
  "configuracion",
  "cuenta"
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
 renderSidebarFooterPOS();
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
function inicialesUsuarioPOS(nombre) {
 return String(nombre || "Usuario").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(parte => parte[0]).join("").toUpperCase() || "U";
}
function nombreNegocioTopbarPOS() {
 try {
 const configuracion = typeof configuracionNegocio === "function" ? configuracionNegocio() : null;
 return configuracion?.nombre || negocioActivoSlug();
 } catch (error) {
 return negocioActivoSlug();
 }
}
function temaIconoDestinoPOS() { return document.body.classList.contains("oscuro") ? "sun" : "moon"; }
function renderTopbarPOS() {
 const topbar = asegurarTopbarPOS();
 if (!topbar) return;

 const notificaciones = notificacionesSistemaPOS();
 const usuario = usuarioActualTopbarPOS();
 const nombreUsuario = usuario?.nombre || "Usuario";
 const rolUsuario = usuario?.rol || "Usuario";
 const negocio = nombreNegocioTopbarPOS();

 topbar.innerHTML =
 '<div class="topbar-title-block"><span class="topbar-eyebrow">Ferreteria Olimpico POS</span><strong id="topbarTituloPOS">' +
 contextoTopbarPOS.titulo +
 '</strong><small id="topbarSubtituloPOS">' +
 contextoTopbarPOS.subtitulo +
 '</small></div><div class="topbar-actions">' +
 '<button type="button" class="topbar-icon-btn" onclick="abrirRecordatorioPOS()" title="Nuevo recordatorio">' +
 iconoUISVG("plus") +
 '</button><button type="button" id="btnTemaPOS" class="topbar-icon-btn" onclick="cambiarModo()" title="Cambiar tema">' +
 iconoUISVG(temaIconoDestinoPOS()) +
 '</button><button type="button" id="btnNotificacionesPOS" class="topbar-icon-btn topbar-bell" onclick="toggleNotificacionesPOS()" title="Notificaciones">' +
 iconoUISVG("bell") +
 '<span id="badgeNotificacionesPOS" class="notification-badge">' +
 notificaciones.length +
 '</span></button><button type="button" class="topbar-icon-btn topbar-help" onclick="abrirAyudaModuloPOS()" title="Que hace este modulo">?</button>' +
 '<div class="topbar-product-menu"><button type="button" id="btnMenuNexoPOS" class="topbar-user-trigger" onclick="toggleMenuNexoPOS()" aria-haspopup="true" aria-expanded="false"><span class="topbar-user-avatar">' +
 inicialesUsuarioPOS(nombreUsuario) +
 '</span><span class="topbar-user-text"><strong>' +
 rolUsuario +
 '</strong><small>' +
 negocio +
 '</small></span></button><div id="menuNexoPOS" class="nexo-menu-panel"><div class="nexo-menu-head"><strong>' +
 nombreUsuario +
 '</strong><span>' +
 rolUsuario +
 ' · ' +
 negocio +
 '</span><span>Nexo POS · Version ' +
 VERSION_NEXO_POS +
 '</span></div><button type="button" onclick="abrirContactoDesarrolladorPOS()">' +
 iconoUISVG("users") +
 '<span>Contactar desarrollador</span></button><button type="button" class="nexo-menu-danger" onclick="cerrarSesionPOS()">' +
 iconoUISVG("alert") +
 '<span>Cerrar sesion</span></button></div></div></div><div id="panelNotificacionesPOS" class="notificaciones-panel" aria-live="polite"></div>';

 renderNotificacionesPOS();
 refrescarEstadoSyncDesktopPOS({ silencioso: true });
}
function renderSidebarFooterPOS() {
 const sidebar = document.querySelector(".sidebar");
 if (!sidebar) return;
 let footer = document.getElementById("sidebarFooterPOS");
 if (!footer) {
  footer = document.createElement("div");
  footer.id = "sidebarFooterPOS";
  footer.className = "sidebar-footer";
  const version = typeof VERSION_NEXO_POS !== "undefined" ? VERSION_NEXO_POS : "1.0.0";
  const syncHtml = typeof desktopSyncDisponiblePOS === "function" && desktopSyncDisponiblePOS()
   ? '<button type="button" id="btnSyncDesktopPOS" class="sync-desktop-chip" onclick="sincronizarAhoraDesktopPOS()" title="Sincronizar ahora"><span id="chipSyncDesktopPOS" class="sync-chip-inner"><span class="sync-dot"></span><span>Sync</span><small>Revisando</small></span></button>'
   : "";
  footer.innerHTML = '<div class="sidebar-powered-by"><span>Con la tecnologia de</span><img src="nexo-pos-icon.jpg" alt="Nexo POS"></div><span class="sidebar-footer-version">NEXO POS v' + version + '</span>' + syncHtml;
 }
 sidebar.appendChild(footer);
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
  ? '<button type="button" onclick="completarRecordatorioPOS(&quot;' + String(item.id).replace(/[^a-zA-Z0-9_-]/g, "") + '&quot;)">' + iconoUISVG("check") + '</button>'
  : '<button type="button" onclick="ejecutarAccionNotificacionPOS(decodeURIComponent(&quot;' + encodeURIComponent(JSON.stringify(item.accion || {})) + '&quot;))">Ver</button>';
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
function iniciarShellFerreteroPOS() { profesionalizarSidebarPOS(); renderSidebarFooterPOS(); [900, 1500, 2600, 4200].forEach(ms => setTimeout(() => { if (typeof window.repararSidebarNexoPOS === "function") window.repararSidebarNexoPOS(); else profesionalizarSidebarPOS(); }, ms)); renderTopbarPOS(); instalarWrappersShellPOS(); instalarAtajoDesarrolladorNexoPOS(); instalarMonitorSyncDesktopPOS(); actualizarModuloActivoPOS("inicio"); if (!window.__clickShellPOS) { window.__clickShellPOS = true; document.addEventListener("click", event => { const panel = document.getElementById("panelNotificacionesPOS"); const boton = document.getElementById("btnNotificacionesPOS"); const menuNexo = document.getElementById("menuNexoPOS"); const botonNexo = document.getElementById("btnMenuNexoPOS"); if (panel && boton && !panel.contains(event.target) && !boton.contains(event.target)) panel.classList.remove("abierto"); if (menuNexo && botonNexo && !menuNexo.contains(event.target) && !botonNexo.contains(event.target)) cerrarMenuNexoPOS(); }); } }
(function conectarShellFerreteroPOS() { const onloadOriginal = window.onload; window.onload = async function(...args) { if (typeof onloadOriginal === "function") await onloadOriginal.apply(this, args); iniciarShellFerreteroPOS(); }; if (document.readyState !== "loading") setTimeout(iniciarShellFerreteroPOS, 60); else document.addEventListener("DOMContentLoaded", () => setTimeout(iniciarShellFerreteroPOS, 60)); })();

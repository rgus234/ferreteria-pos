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

 if (boton) {
 boton.innerHTML =
 document.body.classList.contains("oscuro")
 ? " Modo claro"
 : " Modo oscuro";
 }

 const botonTopbar =
 document.getElementById("btnTemaPOS");

 if (botonTopbar && typeof iconoUISVG === "function" && typeof temaIconoDestinoPOS === "function") {
 botonTopbar.innerHTML = iconoUISVG(temaIconoDestinoPOS());
 }
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

 if (typeof iconoUISVG === "function") {
 document.querySelectorAll("#login [data-kpi-icon]").forEach(el => {
 if (!el.innerHTML) el.innerHTML = iconoUISVG(el.dataset.kpiIcon);
 });
 }

 const versionLogin =
 document.getElementById("loginVersionTexto");

 if (versionLogin && typeof VERSION_NEXO_POS !== "undefined") {
 versionLogin.textContent =
 `Version ${VERSION_NEXO_POS}`;
 }

 return true;
}

function alternarVerPasswordLogin() {
 const campo =
 document.getElementById("password");

 const boton =
 document.querySelector(".login-ver-password");

 if (!campo || !boton) return;

 const mostrar =
 campo.type === "password";

 campo.type =
 mostrar ? "text" : "password";

 if (typeof iconoUISVG === "function") {
 boton.innerHTML =
 iconoUISVG(mostrar ? "eyeOff" : "eye");
 }

 boton.classList.toggle("activo", mostrar);
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
 "pantallaCreditos",
 "pantallaProveedores",
 "pantallaInventarioBajo",
 "pantallaReportes",
 "pantallaConfiguracion",
 "pantallaRecepcionMercancia",
 "pantallaPedidosProveedor",
 "pantallaAjustesInventario",
 "pantallaCaja",
 "pantallaFinanzas"
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
 <span>Preparado para impresora termica 58 mm / 80 mm y cajon conectado a la impresora.</span>
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
 <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>Ticket termico ${config.ticketAncho === "58" ? "58 mm" : "80 mm"}</span><span>OK</span></div>
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
 <h3>Rol del usuario</h3>
 ${
 usuario.id === "admin"
 ? `<p class="permisos-rol-nota">El administrador principal no puede cambiar de rol.</p>`
 : `<select id="permisosRolSeleccionado" class="permisos-rol-select" onchange="actualizarChecksPorRolSeleccionado()">
 <option value="Cajero" ${usuario.rol === "Cajero" ? "selected" : ""}>Cajero</option>
 <option value="Inventario" ${usuario.rol === "Inventario" ? "selected" : ""}>Inventario</option>
 <option value="Administrador" ${usuario.rol === "Administrador" ? "selected" : ""}>Administrador</option>
 </select>
 <p class="permisos-rol-nota">Al cambiar el rol se ajustan los modulos y tarjetas de abajo a los valores tipicos de ese rol. Puedes ajustarlos antes de guardar.</p>`
 }
 </section>

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

function actualizarChecksPorRolSeleccionado() {
 const select =
 document.getElementById("permisosRolSeleccionado");

 const modal =
 document.getElementById("modalPermisosUsuario");

 if (!select || !modal) return;

 const plantilla =
 plantillaUsuario(select.value);

 modal
 .querySelectorAll("input[type='checkbox']")
 .forEach(input => {
 input.checked =
 select.value === "Administrador" ||
 plantilla[input.dataset.tipo]?.[input.dataset.clave] !== false;
 });
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

 const selectRol =
 document.getElementById("permisosRolSeleccionado");

 if (selectRol && selectRol.value) {
 usuario.rol = selectRol.value;
 }

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

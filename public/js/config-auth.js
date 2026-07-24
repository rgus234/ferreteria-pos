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
 placeholder = "",
 tipoEntrada = "text"
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
 ? `<input id="dialogoPOSInput" type="${limpiar(tipoEntrada)}" value="${limpiar(valorInicial)}" placeholder="${limpiar(placeholder)}">`
 : ""
 }
 <div class="dialogo-pos-actions">
 ${
 mostrarCancelar
 ? `<button type="button" class="dialogo-cancelar">${textoCancelar}</button>`
 : ""
 }
 <button type="button" class="dialogo-aceptar">${textoAceptar}</button>
 </div>
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

 (input || modal.querySelector(".dialogo-aceptar"))?.focus();
 input?.select();
 });
}

function alertaPOS(mensaje, titulo = "Aviso", tipo = "info") {
 mostrarToastPOS(mensaje, { titulo, tipo });
 return Promise.resolve(true);
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

function pedirPasswordPOS(mensaje, titulo = "Completar dato") {
 return dialogoPOS({
 tipo: "info",
 titulo,
 mensaje,
 entrada: true,
 tipoEntrada: "password",
 mostrarCancelar: true,
 textoAceptar: "Continuar",
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

function guardarConfiguracionNegocioDesdeServidor(negocio) {
 const configuracionReconstruida = {
 negocioSlug: negocio.slug,
 nombre: negocio.nombre,
 slogan: "",
 telefono: negocio.telefono || "",
 direccion: negocio.direccion || "",
 color: "#0d6efd",
 logo: null,
 adminNombre: "",
 fechaConfiguracion: new Date().toISOString()
 };

 localStorage.setItem(
 CONFIG_NEGOCIO_KEY,
 JSON.stringify(configuracionReconstruida)
 );

 guardarNegocioActivo(negocio.slug);

 return configuracionReconstruida;
}

async function intentarReconexionAutomaticaNegocio() {
 try {
 if (!window.nexoDesktop || typeof window.nexoDesktop.getConfig !== "function") return false;

 const configDesktop =
 await window.nexoDesktop.getConfig();

 if (!configDesktop?.activatedAt) return false;

 const respuesta =
 await fetch("/negocio-actual");

 if (!respuesta.ok) return false;

 const datos =
 await respuesta.json();

 const negocio =
 datos?.negocio;

 if (!datos?.ok || !negocio?.nombre || !negocio?.slug) return false;

 guardarConfiguracionNegocioDesdeServidor(negocio);

 return true;
 } catch (error) {
 console.warn("No se pudo reconectar automaticamente con el negocio activado", error);
 return false;
 }
}

async function abrirBuscarNegocioSetup() {
 let modal =
 document.getElementById("modalBuscarNegocioSetup");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalBuscarNegocioSetup";
 modal.className = "modal-personalizado modal-buscar-negocio";
 document.body.appendChild(modal);
 }

 modal.innerHTML = `
 <div class="modal-card buscar-negocio-card">
 <div class="modal-card-header">
 <div>
 <span>Reconectar</span>
 <h3>Inicia sesion</h3>
 </div>
 <button type="button" onclick="cerrarBuscarNegocioSetup()">Cerrar</button>
 </div>
 <p class="buscar-negocio-ayuda">Entra con el correo y la contrasena de tu cuenta de Nexo POS.</p>

 <div id="loginCuentaError" class="login-cuenta-error" style="display:none;"></div>

 <label class="login-cuenta-campo">
 Correo
 <input type="email" id="loginCuentaCorreo" placeholder="tu@correo.com" autocomplete="username">
 </label>
 <label class="login-cuenta-campo">
 Contrasena
 <input type="password" id="loginCuentaPassword" placeholder="Tu contrasena" autocomplete="current-password">
 </label>

 <button type="button" class="btn-login-cuenta" id="btnLoginCuenta" onclick="iniciarSesionCuenta()">Entrar</button>

 <div class="buscar-negocio-enlaces">
 <button type="button" onclick="abrirOlvidePasswordCuenta()">¿Olvidaste tu contrasena?</button>
 <button type="button" onclick="alternarBusquedaNegocioSetup()">No recuerdo mi correo, buscar por nombre o telefono</button>
 </div>

 <div id="buscarNegocioSetupSeccion" style="display:none;">
 <input type="text" id="buscarNegocioSetupInput" placeholder="Nombre o telefono del negocio..." oninput="buscarNegocioSetup(this.value)">
 <div id="resultadosBuscarNegocioSetup" class="buscar-negocio-resultados"></div>
 </div>
 </div>
 `;

 modal.style.display = "flex";

 setTimeout(() => document.getElementById("loginCuentaCorreo")?.focus(), 50);
}

function alternarBusquedaNegocioSetup() {
 const seccion =
 document.getElementById("buscarNegocioSetupSeccion");

 if (!seccion) return;

 const mostrar =
 seccion.style.display === "none";

 seccion.style.display = mostrar ? "block" : "none";

 if (mostrar) {
 setTimeout(() => document.getElementById("buscarNegocioSetupInput")?.focus(), 50);
 }
}

async function iniciarSesionCuenta() {
 const correo =
 document.getElementById("loginCuentaCorreo")?.value.trim();

 const password =
 document.getElementById("loginCuentaPassword")?.value || "";

 const cajaError =
 document.getElementById("loginCuentaError");

 const boton =
 document.getElementById("btnLoginCuenta");

 if (cajaError) cajaError.style.display = "none";

 if (!correo || !password) {
 if (cajaError) {
 cajaError.textContent = "Escribe tu correo y tu contrasena.";
 cajaError.style.display = "block";
 }
 return;
 }

 if (boton) {
 boton.disabled = true;
 boton.textContent = "Entrando...";
 }

 try {
 const respuesta =
 await fetch("/cuenta/login", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ correo, password })
 });

 const datos =
 await respuesta.json();

 if (!datos.ok) {
 if (cajaError) {
 cajaError.textContent = datos.error || "No se pudo iniciar sesion.";
 cajaError.style.display = "block";
 }

 if (datos.correoSinVerificar) {
 const reenviar = await confirmarPOS(
 "¿Quieres que te reenviemos el correo de verificacion?",
 "Correo sin verificar"
 );

 if (reenviar) {
 try {
 await fetch("/cuenta/reenviar-verificacion", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ correo })
 });
 await alertaPOS("Te mandamos un nuevo correo de verificacion. Revisa tu bandeja de entrada.", "Listo", "exito");
 } catch (error) {
 await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 }
 }
 }

 return;
 }

 localStorage.setItem(CUENTA_SESION_TOKEN_KEY, datos.token);

 guardarConfiguracionNegocioDesdeServidor(datos.negocio);

 try {
 await vincularDispositivoActual(datos.token);
 } catch (error) {
 await alertaPOS(
 "Iniciaste sesion pero no se pudo vincular este equipo. Intenta de nuevo cuando tengas internet.",
 "Aviso",
 "alerta"
 );
 }

 cerrarBuscarNegocioSetup();

 await inicializarConfiguracionInicial();
 } catch (error) {
 if (cajaError) {
 cajaError.textContent = "No se pudo conectar. Revisa tu internet e intenta de nuevo.";
 cajaError.style.display = "block";
 }
 } finally {
 if (boton) {
 boton.disabled = false;
 boton.textContent = "Entrar";
 }
 }
}

async function pedirCodigoRecuperacionCuenta(correo) {
 try {
 await fetch("/cuenta/olvide-password", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ correo })
 });
 return true;
 } catch (error) {
 await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 return false;
 }
}

async function abrirOlvidePasswordCuenta() {
 const correoPrellenado =
 document.getElementById("loginCuentaCorreo")?.value.trim() || "";

 const correo = await pedirTextoPOS(
 "Escribe el correo de tu cuenta. Te mandaremos un codigo de 6 digitos.",
 correoPrellenado,
 "Recuperar contrasena"
 );

 if (!correo) return;

 const correoLimpio = correo.trim();

 if (!(await pedirCodigoRecuperacionCuenta(correoLimpio))) return;

 await alertaPOS(
 "Si el correo esta registrado, te enviamos un codigo de 6 digitos. Revisa tu bandeja de entrada (y spam).",
 "Revisa tu correo",
 "exito"
 );

 let tokenRestablecimiento = null;

 while (!tokenRestablecimiento) {
 const codigo = await pedirTextoPOS(
 "Escribe el codigo de 6 digitos que te enviamos por correo.",
 "",
 "Verificar codigo"
 );

 if (!codigo) return;

 try {
 const respuesta = await fetch("/cuenta/verificar-codigo-reset", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ correo: correoLimpio, codigo: codigo.trim() })
 });

 const datos = await respuesta.json();

 if (!datos.ok) {
 const reenviar = await confirmarPOS(
 `${datos.error || "Codigo invalido o vencido."} ¿Quieres que te mandemos un codigo nuevo?`,
 "No se pudo verificar"
 );

 if (reenviar) {
 if (!(await pedirCodigoRecuperacionCuenta(correoLimpio))) return;
 await alertaPOS("Te mandamos un codigo nuevo. Revisa tu correo.", "Codigo reenviado", "exito");
 }

 continue;
 }

 tokenRestablecimiento = datos.tokenRestablecimiento;
 } catch (error) {
 await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 return;
 }
 }

 while (true) {
 const nuevaPassword = await pedirPasswordPOS(
 "Escribe tu nueva contrasena (minimo 8 caracteres).",
 "Nueva contrasena"
 );

 if (!nuevaPassword) return;

 const confirmarPassword = await pedirPasswordPOS(
 "Escribe de nuevo tu nueva contrasena para confirmarla.",
 "Confirmar contrasena"
 );

 if (!confirmarPassword) return;

 try {
 const respuesta = await fetch("/cuenta/restablecer-password", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ tokenRestablecimiento, password: nuevaPassword, confirmarPassword })
 });

 const datos = await respuesta.json();

 if (!datos.ok) {
 await alertaPOS(datos.error || "No se pudo cambiar la contrasena.", "Intenta de nuevo", "alerta");
 continue;
 }

 await alertaPOS("Tu contrasena se cambio correctamente. Ya puedes iniciar sesion con ella.", "Listo", "exito");

 const campoCorreo = document.getElementById("loginCuentaCorreo");
 const campoPassword = document.getElementById("loginCuentaPassword");

 if (campoCorreo) campoCorreo.value = correo.trim();
 if (campoPassword) campoPassword.value = "";

 return;
 } catch (error) {
 await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 return;
 }
 }
}

function cerrarBuscarNegocioSetup() {
 const modal =
 document.getElementById("modalBuscarNegocioSetup");

 if (modal) modal.style.display = "none";
}

let temporizadorBusquedaNegocioSetup = null;

function buscarNegocioSetup(texto) {
 clearTimeout(temporizadorBusquedaNegocioSetup);

 const contenedor =
 document.getElementById("resultadosBuscarNegocioSetup");

 if (!contenedor) return;

 const limpio =
 String(texto || "").trim();

 if (limpio.length < 3) {
 contenedor.innerHTML =
 limpio ? `<div class="buscar-negocio-vacio">Escribe al menos 3 letras.</div>` : "";
 return;
 }

 contenedor.innerHTML =
 `<div class="buscar-negocio-vacio">Buscando...</div>`;

 temporizadorBusquedaNegocioSetup = setTimeout(async () => {
 try {
 const respuesta =
 await fetch(`/negocios/buscar?q=${encodeURIComponent(limpio)}`);

 const datos =
 await respuesta.json();

 const negocios =
 datos?.negocios || [];

 if (!negocios.length) {
 contenedor.innerHTML =
 `<div class="buscar-negocio-vacio">Sin resultados para "${escaparPOS(limpio)}".</div>`;
 return;
 }

 contenedor.innerHTML =
 negocios.map(n => `
 <button type="button" class="buscar-negocio-resultado" onclick="seleccionarNegocioEncontradoSetup('${encodeURIComponent(n.slug)}')">
 ${escaparPOS(n.nombre)}
 </button>
 `).join("");
 } catch (error) {
 contenedor.innerHTML =
 `<div class="buscar-negocio-vacio">No se pudo buscar. Revisa tu conexion.</div>`;
 }
 }, 300);
}

async function seleccionarNegocioEncontradoSetup(slugCodificado) {
 const slug =
 decodeURIComponent(slugCodificado);

 guardarNegocioActivo(slug);

 const respuesta =
 await fetch("/negocio-actual");

 const datos =
 await respuesta.json().catch(() => null);

 const negocio =
 datos?.negocio;

 if (!datos?.ok || !negocio) {
 await alertaPOS("No se pudo conectar con ese negocio. Intenta de nuevo.", "Reconectar", "peligro");
 return;
 }

 guardarConfiguracionNegocioDesdeServidor(negocio);

 cerrarBuscarNegocioSetup();

 await inicializarConfiguracionInicial();
}

async function inicializarConfiguracionInicial() {
 let configuracion =
 configuracionNegocio();

 if (!configuracion && await intentarReconexionAutomaticaNegocio()) {
 configuracion = configuracionNegocio();
 }

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

  if (new URLSearchParams(window.location.search).get("accion") === "iniciar-sesion") {
  abrirBuscarNegocioSetup();
  }
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

 mostrarPantallaDeEntradaPOS();

 return true;
}

// Decide cual de las 3 pantallas dentro de #login mostrar: seleccion
// de perfil (equipo ya vinculado), vincular equipo (tiene negocio
// local pero nunca inicio sesion con correo/contrasena en esta
// computadora), o el formulario clasico como respaldo si algo sale
// mal cargando los perfiles.
async function mostrarPantallaDeEntradaPOS() {
 const panelVincular =
 document.getElementById("loginVincularEquipo");

 const panelPerfiles =
 document.getElementById("loginSeleccionPerfil");

 const panelClasico =
 document.getElementById("loginFormularioClasico");

 if (panelVincular) panelVincular.style.display = "none";
 if (panelPerfiles) panelPerfiles.style.display = "none";
 if (panelClasico) panelClasico.style.display = "none";

 if (!dispositivoTokenActual()) {
 if (panelVincular) panelVincular.style.display = "block";
 return;
 }

 if (navigator.onLine) {
 sincronizarEmpleadosDispositivo();
 }

 const hayPerfilesSincronizados =
 usuariosSistema().length > 0;

 const divisorAcceso =
 document.getElementById("loginDivisorAcceso");

 const botonAccesoRapido =
 document.getElementById("loginBotonAccesoRapido");

 if (divisorAcceso) divisorAcceso.style.display = hayPerfilesSincronizados ? "flex" : "none";
 if (botonAccesoRapido) botonAccesoRapido.style.display = hayPerfilesSincronizados ? "block" : "none";

 if (!hayPerfilesSincronizados) {
 // Vinculado pero sin empleados todavia sincronizados/creados --
 // el formulario clasico sirve de respaldo hasta que haya al
 // menos uno (o hasta que la sincronizacion en segundo plano
 // termine).
 if (panelClasico) panelClasico.style.display = "block";
 return;
 }

 if (panelPerfiles) panelPerfiles.style.display = "block";
 renderSeleccionPerfilPOS();
}

function mostrarSeleccionPerfilDesdeClasico() {
 const panelClasico =
 document.getElementById("loginFormularioClasico");

 const panelPerfiles =
 document.getElementById("loginSeleccionPerfil");

 if (panelClasico) panelClasico.style.display = "none";
 if (panelPerfiles) panelPerfiles.style.display = "block";

 renderSeleccionPerfilPOS();
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
 "pantallaFinanzas",
 "pantallaReglasPrecios",
 "pantallaAplicarPrecios",
 "pantallaCuenta",
 "pantallaNexoIA"
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
 transferTitular: valorConfigCampo("configTransferTitular", config.transferTitular || "").trim(),
 transferBanco: valorConfigCampo("configTransferBanco", config.transferBanco || "").trim(),
 transferCuenta: valorConfigCampo("configTransferCuenta", config.transferCuenta || "").trim(),
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

 <section class="config-panel">
 <h3>Datos para transferencia</h3>
 <p class="config-panel-hint">Se muestran al cajero cuando el cliente paga por transferencia, para que sepa a que cuenta pedirle el deposito.</p>
 <div class="config-form-grid">
 <label>
 <span>Titular de la cuenta</span>
 <input id="configTransferTitular" value="${config.transferTitular || ""}">
 </label>
 <label>
 <span>Banco</span>
 <input id="configTransferBanco" value="${config.transferBanco || ""}">
 </label>
 <label>
 <span>CLABE o numero de cuenta</span>
 <input id="configTransferCuenta" value="${config.transferCuenta || ""}">
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

// Los empleados ya no viven solo en localStorage -- se administran en
// el servidor (/cuenta/empleados/*) y cada equipo vinculado guarda
// una copia sincronizada para poder entrar sin internet. Se mantiene
// el nombre usuariosSistema() sin cambios porque el resto del codigo
// (permisos, ventas, widgets) ya lo llama asi.
function empleadosCache() {
 try {
 const datos =
 JSON.parse(localStorage.getItem(EMPLEADOS_CACHE_KEY) || "null");

 if (!datos || !Array.isArray(datos.empleados)) {
 return { empleados: [], sincronizadoAt: null };
 }

 return datos;
 } catch (error) {
 return { empleados: [], sincronizadoAt: null };
 }
}

function guardarEmpleadosCache(empleados) {
 localStorage.setItem(
 EMPLEADOS_CACHE_KEY,
 JSON.stringify({ empleados, sincronizadoAt: Date.now() })
 );
}

function usuariosSistema() {
 return empleadosCache().empleados;
}

function dispositivoTokenActual() {
 return localStorage.getItem(DISPOSITIVO_TOKEN_KEY);
}

function limpiarVinculacionDispositivo() {
 localStorage.removeItem(DISPOSITIVO_TOKEN_KEY);
 localStorage.removeItem(EMPLEADOS_CACHE_KEY);
}

// Copia de la lista de cajeros locales tal como vivia antes de este
// cambio (localStorage plano, PIN en claro) -- se usa una sola vez,
// al vincular el equipo, para migrarlos al servidor sin que nadie
// tenga que volver a crearlos a mano.
function leerCajerosLocalesLegado() {
 try {
 const usuarios =
 JSON.parse(localStorage.getItem("usuariosSistema") || "[]");

 return Array.isArray(usuarios) ? usuarios : [];
 } catch (error) {
 return [];
 }
}

async function sincronizarEmpleadosDispositivo() {
 const token =
 dispositivoTokenActual();

 if (!token) return false;

 try {
 const respuesta =
 await fetch("/dispositivo/empleados", {
 headers: { "x-dispositivo-token": token }
 });

 const datos =
 await respuesta.json();

 if (!datos.ok) return false;

 guardarEmpleadosCache(datos.empleados);
 return true;
 } catch (error) {
 return false;
 }
}

async function vincularDispositivoActual(cuentaToken) {
 const respuesta =
 await fetch("/dispositivo/vincular", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Authorization: `Bearer ${cuentaToken}`
 },
 body: JSON.stringify({
 nombreDispositivo: `${navigator.platform || "Equipo"} -- ${new Date().toLocaleDateString("es-MX")}`
 })
 });

 const datos =
 await respuesta.json();

 if (!datos.ok) {
 throw new Error(datos.error || "No se pudo vincular este equipo");
 }

 localStorage.setItem(DISPOSITIVO_TOKEN_KEY, datos.token);

 const cajerosLocales =
 leerCajerosLocalesLegado();

 if (cajerosLocales.length > 0) {
 try {
 await fetch("/cuenta/empleados/importar-locales", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Authorization: `Bearer ${cuentaToken}`
 },
 body: JSON.stringify({
 empleados: cajerosLocales.map(usuario => ({
 nombre: usuario.nombre,
 rol: usuario.rol,
 pin: usuario.pin,
 permisos: usuario.permisos,
 widgets: usuario.widgets
 }))
 })
 });
 } catch (error) {
 // La migracion es un extra -- si falla, el admin puede crear a
 // sus empleados a mano desde la pantalla de Empleados.
 }
 }

 await sincronizarEmpleadosDispositivo();
}

async function calcularVerificadorPinOfflineCliente(pin, saltHex, iteraciones) {
 const saltBytes =
 new Uint8Array((saltHex.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));

 const materialClave =
 await crypto.subtle.importKey(
 "raw",
 new TextEncoder().encode(String(pin)),
 { name: "PBKDF2" },
 false,
 ["deriveBits"]
 );

 const bits =
 await crypto.subtle.deriveBits(
 { name: "PBKDF2", salt: saltBytes, iterations: iteraciones, hash: "SHA-256" },
 materialClave,
 32 * 8
 );

 return Array.from(new Uint8Array(bits))
 .map(byte => byte.toString(16).padStart(2, "0"))
 .join("");
}

async function verificarPinEmpleadoOffline(empleado, pin) {
 if (!empleado?.pinOffline?.salt || !empleado?.pinOffline?.verificador) {
 return false;
 }

 const calculado =
 await calcularVerificadorPinOfflineCliente(
 pin,
 empleado.pinOffline.salt,
 empleado.pinOffline.iteraciones || 100000
 );

 return calculado === empleado.pinOffline.verificador;
}

// Punto de entrada unico para revisar un PIN: intenta en linea primero
// (mas rapido de invalidar si alguien cambio su PIN o fue dado de
// baja), y si no hay conexion cae al verificador cacheado localmente.
async function verificarPinEmpleado(empleadoId, pin) {
 const token =
 dispositivoTokenActual();

 if (navigator.onLine && token) {
 try {
 const respuesta =
 await fetch("/dispositivo/empleados/verificar-pin", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 "x-dispositivo-token": token
 },
 body: JSON.stringify({ empleadoId, pin })
 });

 if (respuesta.status === 401) {
 const datos = await respuesta.json();
 return { ok: false, error: datos.error || "PIN incorrecto" };
 }

 if (respuesta.status === 429) {
 const datos = await respuesta.json();
 return { ok: false, error: datos.error || "Demasiados intentos" };
 }

 const datos =
 await respuesta.json();

 if (datos.ok) {
 const cache = empleadosCache();
 const indice = cache.empleados.findIndex(item => item.id === datos.empleado.id);

 if (indice >= 0) cache.empleados[indice] = datos.empleado;
 else cache.empleados.push(datos.empleado);

 guardarEmpleadosCache(cache.empleados);
 return { ok: true, empleado: datos.empleado };
 }
 } catch (error) {
 // Sin conexion real pese a navigator.onLine -- sigue abajo con
 // el verificador offline cacheado.
 }
 }

 const empleado =
 empleadosCache().empleados.find(item => item.id === Number(empleadoId));

 if (!empleado) {
 return { ok: false, error: "Este perfil no esta disponible sin internet todavia. Conectate para sincronizar." };
 }

 const valido =
 await verificarPinEmpleadoOffline(empleado, pin);

 if (!valido) {
 return { ok: false, error: "PIN incorrecto" };
 }

 return { ok: true, empleado };
}

// Usado por pantallas que piden "PIN de administrador" como
// confirmacion rapida (ej. ajustar el total de una nota de venta) sin
// pasar por la pantalla completa de seleccion de perfil. Revisa contra
// la cache local -- no necesita internet.
async function buscarAdminPorPinLocal(pin) {
 const candidatos =
 usuariosSistema().filter(usuario => usuario.rol === "Administrador");

 for (const candidato of candidatos) {
 if (await verificarPinEmpleadoOffline(candidato, pin)) {
 return candidato;
 }
 }

 return null;
}

function asegurarUsuariosSistema() {
 const usuarios =
 usuariosSistema();

 usuarios.forEach(usuario => {
 if (!usuario.permisos) {
 usuario.permisos = permisosTodos(usuario.rol === "Administrador");
 }

 if (usuario.permisos.configuracion === undefined) {
 usuario.permisos.configuracion =
 usuario.rol === "Administrador";
 }

 MODULOS_SISTEMA.forEach(modulo => {
 if (usuario.permisos[modulo.clave] === undefined) {
 usuario.permisos[modulo.clave] =
 usuario.rol === "Administrador";
 }
 });

 if (!usuario.widgets) {
 usuario.widgets = widgetsTodos(true);
 }
 });

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

async function abrirDesvincularEquipoPOS() {
 const confirmar =
 await confirmarPOS(
 "Se va a desvincular este equipo del negocio. Vas a necesitar el correo y la contrasena del administrador para volver a usarlo (aqui mismo o con otro negocio).",
 "Cambiar de negocio o desvincular equipo",
 "peligro"
 );

 if (!confirmar) return;

 const correo =
 await pedirTextoPOS(
 "Escribe el correo de la cuenta del administrador para confirmar.",
 "",
 "Confirmar identidad"
 );

 if (!correo) return;

 const password =
 await pedirPasswordPOS(
 "Escribe la contrasena de esa cuenta.",
 "Confirmar identidad"
 );

 if (!password) return;

 const token =
 dispositivoTokenActual();

 try {
 const respuesta =
 await fetch("/dispositivo/desvincular", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 "x-dispositivo-token": token || ""
 },
 body: JSON.stringify({ correo: correo.trim(), password })
 });

 const datos =
 await respuesta.json();

 if (!datos.ok) {
 await alertaPOS(datos.error || "No se pudo desvincular el equipo.", "No se pudo confirmar", "alerta");
 return;
 }

 localStorage.removeItem(CONFIG_NEGOCIO_KEY);
 localStorage.removeItem(CUENTA_SESION_TOKEN_KEY);
 localStorage.removeItem(SESION_POS_KEY);
 localStorage.removeItem("usuarioActualSistema");
 limpiarVinculacionDispositivo();

 window.location.reload();
 } catch (error) {
 await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 }
}

let empleadoSeleccionadoPinPOS = null;
let bufferPinPerfilPOS = "";

function renderSeleccionPerfilPOS() {
 const grid =
 document.getElementById("gridPerfilesPOS");

 if (!grid) return;

 const empleados =
 usuariosSistema();

 grid.innerHTML = empleados.map(empleado => `
 <button type="button" class="perfil-tarjeta" onclick="abrirPinPerfilPOS(${empleado.id})">
 <span class="perfil-avatar" style="background:${escaparPOS(empleado.colorAvatar || "#0d6efd")};">${escaparPOS(inicialesNegocio(empleado.nombre))}</span>
 <strong>${escaparPOS(empleado.nombre)}</strong>
 <span>${escaparPOS(empleado.rol || "")}</span>
 </button>
 `).join("");
}

function abrirPinPerfilPOS(empleadoId) {
 const empleado =
 usuariosSistema().find(item => item.id === Number(empleadoId));

 if (!empleado) return;

 empleadoSeleccionadoPinPOS = empleado;
 bufferPinPerfilPOS = "";

 document.getElementById("loginSeleccionPerfil").style.display = "none";
 document.getElementById("loginPinPerfil").style.display = "block";

 const avatar =
 document.getElementById("pinPerfilAvatar");

 if (avatar) {
 avatar.style.background = empleado.colorAvatar || "#0d6efd";
 avatar.textContent = inicialesNegocio(empleado.nombre);
 }

 const nombre = document.getElementById("pinPerfilNombre");
 if (nombre) nombre.textContent = empleado.nombre;

 const rol = document.getElementById("pinPerfilRol");
 if (rol) rol.textContent = empleado.rol || "";

 const error = document.getElementById("pinPerfilError");
 if (error) error.style.display = "none";

 renderPuntosPinPerfilPOS();
}

function cerrarPinPerfilPOS() {
 empleadoSeleccionadoPinPOS = null;
 bufferPinPerfilPOS = "";

 document.getElementById("loginPinPerfil").style.display = "none";
 document.getElementById("loginSeleccionPerfil").style.display = "block";
}

function renderPuntosPinPerfilPOS() {
 const contenedor =
 document.getElementById("pinPerfilPuntos");

 if (!contenedor) return;

 const max = 6;

 contenedor.innerHTML = Array.from({ length: max }, (_, indice) => `
 <span class="pin-perfil-casilla ${indice < bufferPinPerfilPOS.length ? "llena" : ""}">${indice < bufferPinPerfilPOS.length ? "&bull;" : ""}</span>
 `).join("");

 const boton =
 document.getElementById("pinPerfilConfirmar");

 if (boton) boton.disabled = bufferPinPerfilPOS.length < 4;
}

function tecleoPinPerfilPOS(digito) {
 if (bufferPinPerfilPOS.length >= 6) return;

 bufferPinPerfilPOS += digito;
 renderPuntosPinPerfilPOS();

 if (bufferPinPerfilPOS.length === 6) {
 confirmarPinPerfilPOS();
 }
}

function borrarPinPerfilPOS() {
 bufferPinPerfilPOS = bufferPinPerfilPOS.slice(0, -1);
 renderPuntosPinPerfilPOS();
}

async function confirmarPinPerfilPOS() {
 if (!empleadoSeleccionadoPinPOS || bufferPinPerfilPOS.length < 4) return;

 const boton =
 document.getElementById("pinPerfilConfirmar");

 const error =
 document.getElementById("pinPerfilError");

 if (error) error.style.display = "none";
 if (boton) boton.disabled = true;

 const resultado =
 await verificarPinEmpleado(empleadoSeleccionadoPinPOS.id, bufferPinPerfilPOS);

 if (!resultado.ok) {
 if (error) {
 error.textContent = resultado.error || "PIN incorrecto";
 error.style.display = "block";
 }

 bufferPinPerfilPOS = "";
 renderPuntosPinPerfilPOS();
 return;
 }

 bufferPinPerfilPOS = "";
 empleadoSeleccionadoPinPOS = null;

 guardarSesionPersistente(resultado.empleado);

 await entrarAlSistemaConUsuario(resultado.empleado);
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
 usuarios.find(item => item.id === Number(selector.value));

 if (!usuario) return;

 const usuarioVerificado =
 await pedirPinUsuario(usuario);

 if (!usuarioVerificado) {
 selector.value = usuarioActual.id;
 return;
 }

 aplicarSesionUsuario(usuarioVerificado);
 mostrarInicio();
}

// Regresa el empleado (mas fresco, si hubo conexion) si el PIN es
// correcto, o null si no. Usado por el selector rapido de usuario
// dentro del sistema (no la pantalla de entrada).
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

 if (!datos) return null;

 const resultado =
 await verificarPinEmpleado(usuario.id, datos.pin);

 if (!resultado.ok) {
 await alertaPOS(resultado.error || "PIN incorrecto", "No se pudo verificar", "alerta");
 return null;
 }

 return resultado.empleado;
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
 <button type="button" onclick="abrirPermisosUsuario(${usuario.id})">Permisos</button>
 <button type="button" onclick="cambiarPinUsuario(${usuario.id})">PIN</button>
 <button type="button" onclick="eliminarUsuarioSistema(${usuario.id})">Eliminar</button>
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

 try {
 const respuesta =
 await cuentaFetchAutenticado("/cuenta/empleados", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 nombre: datos.nombre,
 rol: datos.rol,
 pin: datos.pin,
 permisos: plantilla.permisos,
 widgets: plantilla.widgets
 })
 });

 if (!respuesta.ok) {
 throw new Error(respuesta.error || "No se pudo crear el usuario");
 }

 await sincronizarEmpleadosDispositivo();
 renderSelectorUsuario();
 renderPanelUsuariosDashboard();
 } catch (error) {
 await alertaPOS(error.message || "No se pudo crear el usuario.", "Error", "alerta");
 }
}

async function cambiarPinUsuario(id) {
 const usuarios =
 asegurarUsuariosSistema();

 const usuario =
 usuarios.find(item => item.id === Number(id));

 if (!usuario) return;

 const datos =
 await abrirFormularioCredito({
 titulo: `Cambiar PIN de ${usuario.nombre}`,
 subtitulo: "Guarda un PIN nuevo para este usuario (4 a 6 digitos)",
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

 try {
 const respuesta =
 await cuentaFetchAutenticado(`/cuenta/empleados/${usuario.id}`, {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ pin: datos.pin })
 });

 if (!respuesta.ok) {
 throw new Error(respuesta.error || "No se pudo cambiar el PIN");
 }

 await sincronizarEmpleadosDispositivo();
 renderPanelUsuariosDashboard();
 } catch (error) {
 await alertaPOS(error.message || "No se pudo cambiar el PIN.", "Error", "alerta");
 }
}

function abrirPermisosUsuario(id) {
 const usuarios =
 asegurarUsuariosSistema();

 const usuario =
 usuarios.find(item => item.id === Number(id));

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
 <select id="permisosRolSeleccionado" class="permisos-rol-select" onchange="actualizarChecksPorRolSeleccionado()">
 <option value="Cajero" ${usuario.rol === "Cajero" ? "selected" : ""}>Cajero</option>
 <option value="Inventario" ${usuario.rol === "Inventario" ? "selected" : ""}>Inventario</option>
 <option value="Administrador" ${usuario.rol === "Administrador" ? "selected" : ""}>Administrador</option>
 </select>
 <p class="permisos-rol-nota">Al cambiar el rol se ajustan los modulos y tarjetas de abajo a los valores tipicos de ese rol. Puedes ajustarlos antes de guardar.</p>
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
 <button type="button" onclick="guardarPermisosUsuario(${usuario.id})">Guardar permisos</button>
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

async function guardarPermisosUsuario(id) {
 const usuarios =
 asegurarUsuariosSistema();

 const usuario =
 usuarios.find(item => item.id === Number(id));

 const modal =
 document.getElementById("modalPermisosUsuario");

 if (!usuario || !modal) return;

 const selectRol =
 document.getElementById("permisosRolSeleccionado");

 const rol =
 selectRol?.value || usuario.rol;

 const permisos =
 permisosTodos(false);

 const widgets =
 widgetsTodos(false);

 modal
 .querySelectorAll("input[type='checkbox']")
 .forEach(input => {
 (input.dataset.tipo === "widgets" ? widgets : permisos)[input.dataset.clave] =
 input.checked;
 });

 try {
 const respuesta =
 await cuentaFetchAutenticado(`/cuenta/empleados/${usuario.id}`, {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ rol, permisos, widgets })
 });

 if (!respuesta.ok) {
 throw new Error(respuesta.error || "No se pudieron guardar los permisos");
 }

 await sincronizarEmpleadosDispositivo();

 if (usuarioActual?.id === usuario.id) {
 aplicarSesionUsuario(respuesta.empleado);
 }

 cerrarPermisosUsuario();
 renderPanelUsuariosDashboard();
 } catch (error) {
 await alertaPOS(error.message || "No se pudieron guardar los permisos.", "Error", "alerta");
 }
}

async function eliminarUsuarioSistema(id) {
 const confirmar =
 await confirmarPOS(
 "Eliminar este usuario? Esta accion no afecta ventas ni inventario.",
 "Eliminar usuario",
 "peligro"
 );

 if (!confirmar) return;

 try {
 const respuesta =
 await cuentaFetchAutenticado(`/cuenta/empleados/${Number(id)}`, { method: "DELETE" });

 if (!respuesta.ok) {
 throw new Error(respuesta.error || "No se pudo eliminar el usuario");
 }

 await sincronizarEmpleadosDispositivo();
 renderSelectorUsuario();
 renderPanelUsuariosDashboard();
 } catch (error) {
 await alertaPOS(error.message || "No se pudo eliminar el usuario.", "Error", "alerta");
 }
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

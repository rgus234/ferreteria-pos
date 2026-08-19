// Nexo Market -- shell movil/PWA de "Mi cuenta" con mascota "Nexo" (12
// pantallas, ver plan stateless-doodling-tarjan.md). Alcance confirmado
// con el dueño: SOLO movil/PWA -- /market/mi-cuenta en escritorio sigue
// sirviendo market-cuenta-server.js (servirCuentaMarket) sin ningun
// cambio. La deteccion es server-side por User-Agent porque no existe
// ningun mecanismo de deteccion de viewport/PWA en el proyecto.
//
// Fase 2 (esta fase): solo el esqueleto navegable -- 12 secciones con
// mascota/copy real y botones que navegan entre pantallas, SIN llamar
// a ningun endpoint todavia. Fase 3 conecta registro/login reales,
// Fase 4 la verificacion bloqueante, Fase 5 el elegir modo, Fase 6 el
// restablecimiento de contrasena, Fase 7 el home/drawer reales.

const { crearResolverSesionPersonaOpcional, listarNegociosAdministrados, mintearSesionParaNegocioDePersona } = require("./personas-server");
const { contarSenalCompradora } = require("./public-site-server");
const { paginaEntrandoAdminMarketHtml, paginaElegirNegocioMarketHtml } = require("./market-cuenta-server");

const REGEX_USER_AGENT_MOVIL = /Mobi|Android|iPhone|iPad/i;

// ?vista=app / ?vista=escritorio -- override manual para QA (permite
// probar cualquiera de las 2 vistas desde cualquier dispositivo, y es
// lo que usa el script de verificacion de esta fase).
function esVistaMovilMarket(req) {
    const forzado = String((req.query && req.query.vista) || "").toLowerCase();
    if (forzado === "app") return true;
    if (forzado === "escritorio") return false;
    return REGEX_USER_AGENT_MOVIL.test(req.headers["user-agent"] || "");
}

function escaparHtml(valor) {
    return String(valor == null ? "" : valor)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const ESTILOS_WIZARD_MARKET = `
.wizard-body{ margin:0; background:var(--paper); }
.wizard-shell{ max-width:440px; margin:0 auto; min-height:100vh; background:#fff; display:flex; flex-direction:column; position:relative; box-shadow:var(--shadow); }
.wizard-topbar{ display:flex; align-items:center; gap:10px; padding:16px 18px; }
.wizard-topbar-atras{ width:36px; height:36px; border-radius:999px; border:1px solid var(--line); background:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink); font-size:16px; }
.wizard-topbar-atras[hidden]{ display:none; }
.wizard-screen{ flex:1; display:flex; flex-direction:column; padding:8px 26px 32px; text-align:center; }
.wizard-screen[hidden]{ display:none; }
.wizard-screen-scroll{ text-align:left; padding-bottom:100px; }
.wizard-mascota{ width:112px; height:112px; border-radius:50%; object-fit:cover; margin:18px auto 22px; box-shadow:0 14px 30px rgba(16,103,232,.22); }
.wizard-mascota-chica{ width:64px; height:64px; margin:0 0 14px; }
.wizard-titulo{ font-size:22px; font-weight:800; color:var(--ink); margin:0 0 10px; }
.wizard-texto{ font-size:14.5px; color:var(--muted); line-height:1.55; margin:0 0 28px; }
.wizard-spacer{ flex:1; }
.wizard-acciones{ display:flex; flex-direction:column; gap:12px; margin-top:auto; }
.wizard-btn-primario{ display:inline-flex; align-items:center; justify-content:center; padding:14px 24px; border:none; border-radius:999px; background:linear-gradient(135deg, var(--blue), var(--blue-dark)); color:#fff; font-weight:800; font-size:15px; cursor:pointer; box-shadow:0 14px 28px rgba(16,103,232,.28); }
.wizard-btn-secundario{ display:inline-flex; align-items:center; justify-content:center; padding:14px 24px; border-radius:999px; background:var(--glass); border:1px solid var(--line); color:var(--ink); font-weight:700; font-size:15px; cursor:pointer; }
.wizard-link{ background:none; border:none; padding:8px; font-size:13px; font-weight:700; color:var(--blue); text-decoration:underline; cursor:pointer; }
.wizard-card{ text-align:left; border:1px solid var(--line); border-radius:16px; padding:16px 18px; margin-bottom:14px; }
.wizard-card-titulo{ font-weight:800; font-size:14.5px; color:var(--ink); margin:0 0 4px; }
.wizard-card-texto{ font-size:13px; color:var(--muted); margin:0; }
.wizard-form{ display:grid; gap:14px; text-align:left; margin-bottom:20px; }
.wizard-form label{ display:grid; gap:6px; font-size:13px; font-weight:700; color:var(--muted); }
.wizard-form input, .wizard-form select{ padding:13px 14px; border-radius:12px; border:1px solid var(--line); font-size:15px; background:#fff; }
.wizard-form input:disabled{ opacity:.55; }
.wizard-oauth{ display:flex; flex-direction:column; gap:10px; margin:6px 0 20px; }
.wizard-btn-oauth{ display:flex; align-items:center; justify-content:center; gap:10px; padding:13px 20px; border-radius:999px; border:1px solid var(--line); background:#fff; color:var(--ink); font-weight:700; font-size:14px; cursor:not-allowed; opacity:.55; }
.wizard-separador{ display:flex; align-items:center; gap:10px; color:var(--muted); font-size:12px; margin:4px 0 16px; }
.wizard-separador::before, .wizard-separador::after{ content:""; flex:1; height:1px; background:var(--line); }
.wizard-fuerza{ display:flex; align-items:center; gap:8px; margin:-6px 0 14px; }
.wizard-fuerza-barra{ flex:1; height:5px; border-radius:999px; background:var(--line); overflow:hidden; }
.wizard-fuerza-relleno{ height:100%; width:0%; border-radius:999px; background:#c0392b; transition:width .2s ease, background .2s ease; }
.wizard-fuerza span{ font-size:11.5px; font-weight:700; color:var(--muted); min-width:56px; text-align:right; }
.wizard-resultado{ font-size:13px; font-weight:700; min-height:18px; margin-top:2px; }
.wizard-resultado[data-tipo="error"]{ color:#c0392b; }
.wizard-resultado[data-tipo="ok"]{ color:var(--mint); }
.wizard-elegir-grid{ display:grid; gap:14px; }
.wizard-elegir-opcion{ display:flex; align-items:center; gap:14px; padding:18px; border:1px solid var(--line); border-radius:18px; background:#fff; cursor:pointer; text-align:left; }
.wizard-elegir-opcion span.icono{ font-size:26px; }
.wizard-elegir-opcion strong{ display:block; font-size:14.5px; color:var(--ink); }
.wizard-elegir-opcion small{ color:var(--muted); font-size:12.5px; }

.wizard-home{ padding:0 0 78px; text-align:left; }
.wizard-home-header{ padding:20px 22px 10px; display:flex; align-items:center; justify-content:space-between; }
.wizard-home-saludo{ font-size:18px; font-weight:800; color:var(--ink); margin:0; }
.wizard-menu-boton{ width:38px; height:38px; border-radius:999px; border:1px solid var(--line); background:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:17px; }
.wizard-sugerencia{ margin:6px 22px 18px; padding:16px; border-radius:16px; background:linear-gradient(135deg, rgba(16,103,232,.08), rgba(24,184,143,.08)); display:flex; gap:12px; align-items:center; }
.wizard-sugerencia img{ width:44px; height:44px; border-radius:50%; object-fit:cover; flex-shrink:0; }
.wizard-sugerencia p{ margin:0; font-size:13px; color:var(--ink); font-weight:600; }
.wizard-home-cuerpo{ padding:0 22px; }
.wizard-bottom-nav{ position:fixed; left:50%; transform:translateX(-50%); bottom:0; width:100%; max-width:440px; display:flex; background:#fff; border-top:1px solid var(--line); box-shadow:0 -8px 24px rgba(20,32,51,.08); z-index:5; }
.wizard-bottom-nav button{ flex:1; border:none; background:none; padding:10px 4px 12px; display:flex; flex-direction:column; align-items:center; gap:4px; font-size:11px; font-weight:700; color:var(--muted); cursor:pointer; }
.wizard-bottom-nav button.activo{ color:var(--blue); }
.wizard-bottom-nav button .icono{ font-size:19px; }

.wizard-drawer-overlay{ position:fixed; inset:0; background:rgba(20,32,51,.42); z-index:20; }
.wizard-drawer-overlay[hidden]{ display:none; }
.wizard-drawer{ position:absolute; top:0; left:0; bottom:0; width:82%; max-width:340px; background:#fff; padding:24px 20px; overflow-y:auto; }
.wizard-drawer-perfil{ display:flex; align-items:center; gap:12px; margin-bottom:22px; }
.wizard-drawer-avatar{ width:52px; height:52px; border-radius:50%; object-fit:cover; }
.wizard-drawer-nombre{ font-weight:800; font-size:15px; color:var(--ink); margin:0; }
.wizard-drawer-correo{ font-size:12.5px; color:var(--muted); margin:0; }
.wizard-drawer-titulo{ font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:18px 0 8px; }
.wizard-drawer-link{ display:flex; align-items:center; gap:12px; padding:11px 4px; font-size:14px; color:var(--ink); text-decoration:none; font-weight:600; }
.wizard-drawer-cerrar{ position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:999px; border:1px solid var(--line); background:#fff; cursor:pointer; }

@keyframes wizardCaerConfetti{
  0%{ transform:translateY(0) rotate(0deg); opacity:.9; }
  100%{ transform:translateY(110vh) rotate(540deg); opacity:0; }
}
`;

const MASCOTA = {
    feliz: "/img/nexo-ia/feliz.jpg",
    pensando: "/img/nexo-ia/pensando.jpg",
    alerta: "/img/nexo-ia/alerta.jpg",
    celebrando: "/img/nexo-ia/celebrando.jpg",
    neutral: "/img/nexo-ia/neutral.jpg"
};

function mascotaImgHtml(estado, clase) {
    return `<img class="wizard-mascota${clase ? " " + clase : ""}" src="${MASCOTA[estado] || MASCOTA.neutral}" alt="Nexo">`;
}

function cabezaWizardMarketHtml() {
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Mi cuenta -- Nexo</title>
<meta name="description" content="Tu cuenta Nexo: pedidos, favoritos, credito y las ferreterias donde compras.">
<meta name="theme-color" content="#1067e8">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="apple-touch-icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_WIZARD_MARKET}</style>`;
}

// --- Pantallas 1-10: wizard de bienvenida/registro/login (visitante o
// persona recien registrada) -------------------------------------------

function pantallasWizardAuthHtml() {
    return `
<section class="wizard-screen" data-screen="bienvenida">
${mascotaImgHtml("feliz")}
<h1 class="wizard-titulo">Hola, soy Nexo</h1>
<p class="wizard-texto">Tu asistente para comprar y administrar en las ferreterias de tu zona, todo desde una sola cuenta.</p>
<div class="wizard-spacer"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" data-ir="que-es-market">Comenzar</button>
<button type="button" class="wizard-btn-secundario" data-ir="iniciar-sesion">Ya tengo cuenta</button>
</div>
</section>

<section class="wizard-screen" data-screen="que-es-market">
${mascotaImgHtml("neutral")}
<h1 class="wizard-titulo">¿Que es Nexo Market?</h1>
<p class="wizard-texto">Es el lugar donde encuentras productos de ferreterias reales cerca de ti: comparas precios, pides tus productos y les das seguimiento hasta que los recoges.</p>
<div class="wizard-spacer"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" data-ir="elegir-registro">Continuar</button>
</div>
</section>

<section class="wizard-screen" data-screen="elegir-registro">
${mascotaImgHtml("feliz")}
<h1 class="wizard-titulo">Crea tu cuenta Nexo</h1>
<p class="wizard-texto">Con una sola cuenta compras en Nexo Market y, si tienes una ferreteria, tambien la administras.</p>
<div class="wizard-spacer"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" data-ir="crear-cuenta">Crear cuenta</button>
<button type="button" class="wizard-btn-secundario" data-ir="iniciar-sesion">Ya tengo cuenta</button>
</div>
</section>

<section class="wizard-screen wizard-screen-scroll" data-screen="crear-cuenta">
<h1 class="wizard-titulo" style="text-align:left;">Crea tu cuenta</h1>
<p class="wizard-texto" style="text-align:left;">Es gratis y toma un minuto.</p>
<div class="wizard-oauth">
<button type="button" class="wizard-btn-oauth" disabled>🔵 Continuar con Google (Proximamente)</button>
<button type="button" class="wizard-btn-oauth" disabled>⬛ Continuar con Apple (Proximamente)</button>
</div>
<div class="wizard-separador">o con tu correo</div>
<form class="wizard-form" id="wizardCrearCuentaForm">
<label>Tu nombre<input id="wizardRegistroNombre" type="text" placeholder="Ej. Gustavo" required></label>
<label>Correo (opcional si dejas telefono)<input id="wizardRegistroCorreo" type="email" placeholder="tu@correo.com"></label>
<label>Telefono (opcional si dejas correo)<input id="wizardRegistroTelefono" type="tel" placeholder="4421234567"></label>
<label>Contrasena<input id="wizardRegistroPassword" type="password" minlength="8" placeholder="Minimo 8 caracteres" required></label>
</form>
<div class="wizard-fuerza" id="wizardFuerzaPassword" hidden>
<div class="wizard-fuerza-barra"><div class="wizard-fuerza-relleno" id="wizardFuerzaRelleno"></div></div>
<span id="wizardFuerzaTexto"></span>
</div>
<div class="wizard-resultado" id="wizardCrearCuentaResultado"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" id="wizardCrearCuentaBoton">Crear mi cuenta Nexo</button>
</div>
</section>

<section class="wizard-screen" data-screen="verificacion">
${mascotaImgHtml("pensando")}
<h1 class="wizard-titulo">Revisa tu correo</h1>
<p class="wizard-texto" id="wizardVerificacionTexto">Te enviamos un enlace para confirmar tu cuenta. Abrelo desde este mismo telefono y regresa aqui.</p>
<div class="wizard-resultado" id="wizardVerificacionResultado"></div>
<form class="wizard-form" id="wizardCambiarCorreoForm" hidden style="text-align:left; margin-top:8px;">
<label>Nuevo correo<input id="wizardCambiarCorreoInput" type="email" placeholder="tu@correo.com" required></label>
</form>
<div class="wizard-spacer"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-secundario" id="wizardYaVerifiqueBoton" hidden>Ya verifique mi correo</button>
<button type="button" class="wizard-link" id="wizardReenviarVerificacionBoton">Reenviar correo</button>
<button type="button" class="wizard-link" id="wizardCambiarCorreoBoton">Cambiar correo</button>
</div>
</section>

<section class="wizard-screen" data-screen="cuenta-creada">
${mascotaImgHtml("celebrando")}
<h1 class="wizard-titulo">Cuenta creada 🎉</h1>
<p class="wizard-texto">Tu correo quedo verificado. Ya puedes usar tu cuenta Nexo.</p>
<div class="wizard-spacer"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" data-ir="una-cuenta">Continuar</button>
</div>
</section>

<section class="wizard-screen" data-screen="una-cuenta">
${mascotaImgHtml("feliz")}
<h1 class="wizard-titulo">Una cuenta. Todo Nexo.</h1>
<p class="wizard-texto">Con tu cuenta puedes comprar en cualquier ferreteria de Nexo Market y, si administras un negocio, entrar a Nexo para negocios -- sin crear otra cuenta.</p>
<div class="wizard-spacer"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" data-ir="elegir-modo">Continuar</button>
</div>
</section>

<section class="wizard-screen" data-screen="elegir-modo">
<h1 class="wizard-titulo">¿Como quieres continuar?</h1>
<p class="wizard-texto">Puedes cambiar de modo cuando quieras desde tu cuenta.</p>
<div class="wizard-elegir-grid">
<button type="button" class="wizard-elegir-opcion" id="wizardElegirComprar"><span class="icono">🛒</span><span><strong>Comprar</strong><small>Explora Nexo Market</small></span></button>
<button type="button" class="wizard-elegir-opcion" id="wizardElegirAdministrar"><span class="icono">🏬</span><span><strong>Administrar mi negocio</strong><small>Entra a Nexo para negocios</small></span></button>
</div>
</section>

<section class="wizard-screen wizard-screen-scroll" data-screen="iniciar-sesion">
<h1 class="wizard-titulo" style="text-align:left;">Inicia sesion</h1>
<div class="wizard-oauth">
<button type="button" class="wizard-btn-oauth" disabled>🔵 Continuar con Google (Proximamente)</button>
<button type="button" class="wizard-btn-oauth" disabled>⬛ Continuar con Apple (Proximamente)</button>
</div>
<div class="wizard-separador">o con tu correo</div>
<form class="wizard-form" id="wizardLoginForm">
<label>Correo o telefono<input id="wizardLoginIdentificador" type="text" placeholder="tu@correo.com o 4421234567" required></label>
<label>Contrasena<input id="wizardLoginPassword" type="password" placeholder="Tu contrasena" required></label>
</form>
<div class="wizard-resultado" id="wizardLoginResultado"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" id="wizardLoginBoton">Entrar</button>
<button type="button" class="wizard-link" data-ir="recuperar-password">¿Olvidaste tu contrasena?</button>
<button type="button" class="wizard-link" data-ir="crear-cuenta">Crear cuenta nueva</button>
</div>
</section>

<section class="wizard-screen wizard-screen-scroll" data-screen="recuperar-password">
<div id="wizardRecuperarPaso1">
<h1 class="wizard-titulo" style="text-align:left;">Recupera tu contrasena</h1>
<p class="wizard-texto" style="text-align:left;">Escribe el correo con el que te registraste. Si existe una cuenta, te enviamos un codigo de 6 digitos.</p>
<form class="wizard-form" id="wizardRecuperarForm">
<label>Correo<input id="wizardRecuperarCorreo" type="email" placeholder="tu@correo.com" required></label>
</form>
<div class="wizard-resultado" id="wizardRecuperarResultado"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" id="wizardRecuperarBoton">Enviar codigo</button>
</div>
</div>
<div id="wizardRecuperarPaso2" hidden>
<h1 class="wizard-titulo" style="text-align:left;">Escribe el codigo</h1>
<p class="wizard-texto" style="text-align:left;">Revisa tu correo, valido por 15 minutos.</p>
<form class="wizard-form" id="wizardRecuperarCodigoForm">
<label>Codigo de 6 digitos<input id="wizardRecuperarCodigo" type="text" inputmode="numeric" maxlength="6" placeholder="123456" required></label>
</form>
<div class="wizard-resultado" id="wizardRecuperarCodigoResultado"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" id="wizardRecuperarCodigoBoton">Verificar codigo</button>
</div>
</div>
<div id="wizardRecuperarPaso3" hidden>
<h1 class="wizard-titulo" style="text-align:left;">Nueva contrasena</h1>
<form class="wizard-form" id="wizardRecuperarNuevaForm">
<label>Nueva contrasena<input id="wizardRecuperarNuevaPassword" type="password" minlength="8" placeholder="Minimo 8 caracteres" required></label>
<label>Confirmar contrasena<input id="wizardRecuperarConfirmarPassword" type="password" minlength="8" placeholder="Repite tu nueva contrasena" required></label>
</form>
<div class="wizard-resultado" id="wizardRecuperarNuevaResultado"></div>
<div class="wizard-acciones">
<button type="button" class="wizard-btn-primario" id="wizardRecuperarNuevaBoton">Restablecer contrasena</button>
</div>
</div>
</section>`;
}

// --- Pantallas 11-12: home (logueado) + drawer -------------------------

function pantallaHomeHtml(persona) {
    const nombre = escaparHtml((persona && persona.nombre) || "");
    return `
<section class="wizard-screen wizard-home" data-screen="home">
<div class="wizard-home-header">
<p class="wizard-home-saludo">Hola, ${nombre || "de nuevo"} 👋</p>
<button type="button" class="wizard-menu-boton" id="wizardAbrirDrawer" aria-label="Abrir menu">☰</button>
</div>
<div class="wizard-sugerencia">
<img src="${MASCOTA.neutral}" alt="Nexo" style="width:44px; height:44px; border-radius:50%; object-fit:cover; flex-shrink:0;">
<p id="wizardSugerenciaTexto">Nexo siempre te acompaña -- pronto veras aqui sugerencias segun tus compras.</p>
</div>
<div class="wizard-home-cuerpo">
<div class="wizard-card"><p class="wizard-card-titulo">Explora Nexo Market</p><p class="wizard-card-texto">Busca productos en las ferreterias de tu zona.</p></div>
</div>
</section>`;
}

function bottomNavHtml() {
    return `<nav class="wizard-bottom-nav" id="wizardBottomNav">
<button type="button" class="activo" data-tab="inicio"><span class="icono">🏠</span>Inicio</button>
<button type="button" data-tab="favoritos"><span class="icono">❤️</span>Favoritos</button>
<button type="button" data-tab="pedidos"><span class="icono">📦</span>Pedidos</button>
<button type="button" data-tab="cuenta"><span class="icono">👤</span>Cuenta</button>
</nav>`;
}

function pantallaDrawerHtml(persona) {
    const nombre = escaparHtml((persona && persona.nombre) || "Tu cuenta");
    const correo = escaparHtml((persona && (persona.correo || persona.telefono)) || "");
    return `
<div class="wizard-drawer-overlay" id="wizardDrawerOverlay" hidden>
<div class="wizard-drawer">
<button type="button" class="wizard-drawer-cerrar" id="wizardCerrarDrawer" aria-label="Cerrar menu">✕</button>
<div class="wizard-drawer-perfil">
<img class="wizard-drawer-avatar" src="${MASCOTA.feliz}" alt="">
<div><p class="wizard-drawer-nombre">${nombre}</p><p class="wizard-drawer-correo">${correo}</p></div>
</div>
<p class="wizard-drawer-titulo">Explorar Nexo</p>
<a class="wizard-drawer-link" href="/market">🛒 Nexo Market</a>
<a class="wizard-drawer-link" href="https://app.nexoposoficial.com/dueno">🏬 Nexo para negocios</a>
<p class="wizard-drawer-titulo">Cuenta</p>
<a class="wizard-drawer-link" href="#" data-ir-drawer="home">👤 Mi perfil</a>
<a class="wizard-drawer-link" href="#" data-ir-drawer="home">📍 Direcciones</a>
<a class="wizard-drawer-link" href="#" data-ir-drawer="home">💳 Metodos de pago</a>
<a class="wizard-drawer-link" href="#" id="wizardCerrarSesion">🚪 Cerrar sesion</a>
</div>
</div>`;
}

function scriptWizardMarketHtml(pantallaInicial) {
    return `
var wizardPila = [${JSON.stringify(pantallaInicial)}];

var wizardEstadoVerificacion = { correo: null, credenciales: null };

function wizardMostrar(pantalla) {
    document.querySelectorAll(".wizard-screen").forEach(function(s) { s.hidden = s.dataset.screen !== pantalla; });
    document.getElementById("wizardTopbarAtras").hidden = (wizardPila.length <= 1) || pantalla === "home";
    if (typeof wizardAlEntrarPantalla === "function") wizardAlEntrarPantalla(pantalla);
}

function wizardIrA(pantalla) {
    if (wizardPila[wizardPila.length - 1] === pantalla) return;
    wizardPila.push(pantalla);
    history.pushState({ wizardPantalla: pantalla }, "", "#" + pantalla);
    wizardMostrar(pantalla);
}

function wizardAtras() {
    if (wizardPila.length <= 1) return;
    history.back();
}

window.addEventListener("popstate", function(evento) {
    if (wizardPila.length > 1) wizardPila.pop();
    wizardMostrar(wizardPila[wizardPila.length - 1] || ${JSON.stringify(pantallaInicial)});
});

document.getElementById("wizardTopbarAtras").addEventListener("click", wizardAtras);

document.querySelectorAll("[data-ir]").forEach(function(boton) {
    boton.addEventListener("click", function() { wizardIrA(boton.dataset.ir); });
});

// Deep-link ?tab=registro/login (mismo parametro que ya usaba el
// formulario de escritorio) -- solo aplica a un invitado (nunca pisa
// la pantalla "home" de una persona ya logueada).
var wizardPantallaArranque = ${JSON.stringify(pantallaInicial)};
if (wizardPantallaArranque === "bienvenida") {
    var wizardTabInicial = new URLSearchParams(window.location.search).get("tab");
    if (wizardTabInicial === "registro") wizardPantallaArranque = "crear-cuenta";
    else if (wizardTabInicial === "login") wizardPantallaArranque = "iniciar-sesion";
}
if (wizardPantallaArranque !== wizardPila[0]) wizardPila[0] = wizardPantallaArranque;

wizardMostrar(wizardPantallaArranque);
history.replaceState({ wizardPantalla: wizardPantallaArranque }, "", "#" + wizardPantallaArranque);

// Drawer (pantalla 12) -- overlay independiente de la pila de pantallas.
var wizardDrawerOverlay = document.getElementById("wizardDrawerOverlay");
if (wizardDrawerOverlay) {
    var abrirDrawer = document.getElementById("wizardAbrirDrawer");
    var cerrarDrawer = document.getElementById("wizardCerrarDrawer");
    if (abrirDrawer) abrirDrawer.addEventListener("click", function() { wizardDrawerOverlay.hidden = false; });
    if (cerrarDrawer) cerrarDrawer.addEventListener("click", function() { wizardDrawerOverlay.hidden = true; });
    wizardDrawerOverlay.addEventListener("click", function(evento) { if (evento.target === wizardDrawerOverlay) wizardDrawerOverlay.hidden = true; });
}

// Enlaces del drawer que hoy no tienen pantalla propia (Mi perfil,
// Direcciones, Metodos de pago) -- mismo criterio "Proximamente" que
// ya usa el hub de escritorio para estas mismas secciones. Solo
// cierran el drawer.
document.querySelectorAll("[data-ir-drawer]").forEach(function(enlace) {
    enlace.addEventListener("click", function(evento) {
        evento.preventDefault();
        if (wizardDrawerOverlay) wizardDrawerOverlay.hidden = true;
    });
});

var wizardBotonCerrarSesion = document.getElementById("wizardCerrarSesion");
if (wizardBotonCerrarSesion) {
    wizardBotonCerrarSesion.addEventListener("click", async function(evento) {
        evento.preventDefault();
        try { await wizardLlamar("/personas/logout", { method: "POST" }); } catch (error) { /* continua igual */ }
        window.location.href = "/market/mi-cuenta";
    });
}

// Bottom-nav (pantalla 11): Favoritos y Pedidos navegan a las paginas
// reales ya existentes (fuera del wizard, ver plan -- este shell nuevo
// no duplica esas pantallas); Cuenta abre el mismo drawer que el
// boton hamburguesa.
var wizardBottomNav = document.getElementById("wizardBottomNav");
if (wizardBottomNav) {
    wizardBottomNav.querySelectorAll("[data-tab]").forEach(function(boton) {
        boton.addEventListener("click", function() {
            var destino = boton.dataset.tab;
            if (destino === "favoritos") { window.location.href = "/favoritos"; return; }
            if (destino === "pedidos") { window.location.href = "/market/mis-pedidos"; return; }
            if (destino === "cuenta") { if (wizardDrawerOverlay) wizardDrawerOverlay.hidden = false; return; }
        });
    });
}

async function wizardLlamar(ruta, opciones) {
    var respuesta = await fetch(ruta, Object.assign({ credentials: "include", headers: { "Content-Type": "application/json" } }, opciones || {}));
    return respuesta.json();
}

function wizardResultado(elementoId, mensaje, tipo) {
    var el = document.getElementById(elementoId);
    if (!el) return;
    el.textContent = mensaje || "";
    if (tipo) el.dataset.tipo = tipo; else el.removeAttribute("data-tipo");
}

// Medidor de fuerza de contrasena (pantalla 4) -- calculo local, sin
// libreria: longitud + variedad de caracteres.
var wizardCampoPassword = document.getElementById("wizardRegistroPassword");
if (wizardCampoPassword) {
    wizardCampoPassword.addEventListener("input", function() {
        var valor = wizardCampoPassword.value;
        var caja = document.getElementById("wizardFuerzaPassword");
        var relleno = document.getElementById("wizardFuerzaRelleno");
        var texto = document.getElementById("wizardFuerzaTexto");
        if (!valor) { caja.hidden = true; return; }
        caja.hidden = false;
        var puntos = 0;
        if (valor.length >= 8) puntos++;
        if (valor.length >= 12) puntos++;
        if (/[a-z]/.test(valor) && /[A-Z]/.test(valor)) puntos++;
        if (/[0-9]/.test(valor)) puntos++;
        if (/[^a-zA-Z0-9]/.test(valor)) puntos++;
        var niveles = [
            { hasta: 1, ancho: "20%", color: "#c0392b", texto: "Muy debil" },
            { hasta: 2, ancho: "45%", color: "#e08a1b", texto: "Debil" },
            { hasta: 3, ancho: "65%", color: "#f3a21b", texto: "Regular" },
            { hasta: 4, ancho: "85%", color: "#18b88f", texto: "Fuerte" },
            { hasta: 5, ancho: "100%", color: "#18b88f", texto: "Muy fuerte" }
        ];
        var nivel = niveles[Math.min(Math.max(puntos, 1), 5) - 1];
        relleno.style.width = nivel.ancho;
        relleno.style.background = nivel.color;
        texto.textContent = nivel.texto;
    });
}

// Crear cuenta (pantalla 4) -- POST /personas/registro real.
var wizardBotonCrearCuenta = document.getElementById("wizardCrearCuentaBoton");
if (wizardBotonCrearCuenta) {
    wizardBotonCrearCuenta.addEventListener("click", async function() {
        var nombre = document.getElementById("wizardRegistroNombre").value.trim();
        var correo = document.getElementById("wizardRegistroCorreo").value.trim();
        var telefono = document.getElementById("wizardRegistroTelefono").value.trim();
        var password = document.getElementById("wizardRegistroPassword").value;
        if (!nombre || !password) { wizardResultado("wizardCrearCuentaResultado", "Escribe tu nombre y una contrasena.", "error"); return; }
        if (!correo && !telefono) { wizardResultado("wizardCrearCuentaResultado", "Escribe un correo o un telefono.", "error"); return; }
        wizardResultado("wizardCrearCuentaResultado", "Creando tu cuenta...");
        wizardBotonCrearCuenta.disabled = true;
        try {
            var datos = await wizardLlamar("/personas/registro", {
                method: "POST",
                body: JSON.stringify({ nombre: nombre, correo: correo, telefono: telefono, password: password })
            });
            if (!datos.ok) { wizardResultado("wizardCrearCuentaResultado", datos.error || "No se pudo crear tu cuenta.", "error"); return; }
            wizardResultado("wizardCrearCuentaResultado", "");
            if (datos.requiereVerificacionCorreo) {
                var textoVerif = document.getElementById("wizardVerificacionTexto");
                if (textoVerif) textoVerif.textContent = "Te enviamos un enlace a " + correo + ". Abrelo desde este mismo telefono y regresa aqui.";
                wizardEstadoVerificacion.correo = correo;
                wizardEstadoVerificacion.credenciales = null;
                wizardIrA("verificacion");
            } else {
                wizardIrA("cuenta-creada");
            }
        } catch (error) {
            wizardResultado("wizardCrearCuentaResultado", "Ocurrio un error. Intenta de nuevo.", "error");
        } finally {
            wizardBotonCrearCuenta.disabled = false;
        }
    });
}

// Iniciar sesion (pantalla 9) -- POST /personas/login real.
var wizardBotonLogin = document.getElementById("wizardLoginBoton");
if (wizardBotonLogin) {
    wizardBotonLogin.addEventListener("click", async function() {
        var identificador = document.getElementById("wizardLoginIdentificador").value.trim();
        var password = document.getElementById("wizardLoginPassword").value;
        if (!identificador || !password) { wizardResultado("wizardLoginResultado", "Escribe tu correo/telefono y tu contrasena.", "error"); return; }
        wizardResultado("wizardLoginResultado", "Entrando...");
        wizardBotonLogin.disabled = true;
        try {
            var datos = await wizardLlamar("/personas/login", {
                method: "POST",
                body: JSON.stringify({ identificador: identificador, password: password })
            });
            if (!datos.ok) {
                if (datos.correoSinVerificar) {
                    var textoVerif2 = document.getElementById("wizardVerificacionTexto");
                    if (textoVerif2) textoVerif2.textContent = "Tu correo todavia no esta verificado. Revisa tu bandeja de entrada o pide que te reenviemos el enlace.";
                    wizardEstadoVerificacion.correo = identificador.includes("@") ? identificador : null;
                    wizardEstadoVerificacion.credenciales = { identificador: identificador, password: password };
                    wizardIrA("verificacion");
                } else {
                    wizardResultado("wizardLoginResultado", datos.error || "No se pudo iniciar sesion.", "error");
                }
                return;
            }
            window.location.reload();
        } catch (error) {
            wizardResultado("wizardLoginResultado", "Ocurrio un error. Intenta de nuevo.", "error");
        } finally {
            wizardBotonLogin.disabled = false;
        }
    });
}

// Pantalla 11 -- sugerencia proactiva real: reusa /market/inicio-json
// (ya calcula recomendados por oficio, sin duplicar esa logica aqui)
// + window.NEXO_PERSONA_OFICIO (inyectado por el servidor) -- nunca
// inventa datos que no vengan del servidor.
if (${JSON.stringify(pantallaInicial)} === "home") {
    (async function() {
        var elemento = document.getElementById("wizardSugerenciaTexto");
        if (!elemento) return;
        try {
            var datos = await wizardLlamar("/market/inicio-json");
            if (!datos || !datos.ok) return;
            var oficio = window.NEXO_PERSONA_OFICIO || "";
            var totalRecomendados = (datos.recomendados || []).length;
            if (oficio && totalRecomendados > 0) {
                elemento.textContent = "Como trabajas en " + oficio + ", tenemos " + totalRecomendados + " producto" + (totalRecomendados === 1 ? "" : "s") + " recomendados para ti.";
            } else if (!oficio) {
                elemento.textContent = "Cuentanos a que te dedicas desde tu cuenta para ver recomendaciones a tu medida.";
            } else {
                elemento.textContent = "Explora Nexo Market -- ferreterias reales cerca de ti.";
            }
        } catch (error) { /* deja el texto por defecto */ }
    })();
}

// Pantalla 10 -- recuperar contrasena en 3 pasos, mismo backend que ya
// usaba el formulario clasico de escritorio (market-cuenta-server.js):
// POST /personas/olvide-password -> POST /personas/verificar-codigo-reset
// -> POST /personas/restablecer-password. Sin cambios de servidor.
var wizardTokenRestablecimiento = "";

var wizardBotonRecuperar = document.getElementById("wizardRecuperarBoton");
if (wizardBotonRecuperar) {
    wizardBotonRecuperar.addEventListener("click", async function() {
        var correo = document.getElementById("wizardRecuperarCorreo").value.trim();
        if (!correo) { wizardResultado("wizardRecuperarResultado", "Escribe tu correo.", "error"); return; }
        wizardResultado("wizardRecuperarResultado", "Enviando...");
        wizardBotonRecuperar.disabled = true;
        try {
            var datos = await wizardLlamar("/personas/olvide-password", { method: "POST", body: JSON.stringify({ correo: correo }) });
            if (!datos.ok) { wizardResultado("wizardRecuperarResultado", datos.error || "No se pudo enviar el codigo.", "error"); return; }
            document.getElementById("wizardRecuperarPaso1").hidden = true;
            document.getElementById("wizardRecuperarPaso2").hidden = false;
        } catch (error) {
            wizardResultado("wizardRecuperarResultado", "Ocurrio un error. Intenta de nuevo.", "error");
        } finally {
            wizardBotonRecuperar.disabled = false;
        }
    });
}

var wizardBotonRecuperarCodigo = document.getElementById("wizardRecuperarCodigoBoton");
if (wizardBotonRecuperarCodigo) {
    wizardBotonRecuperarCodigo.addEventListener("click", async function() {
        var correo = document.getElementById("wizardRecuperarCorreo").value.trim();
        var codigo = document.getElementById("wizardRecuperarCodigo").value.trim();
        if (!codigo) { wizardResultado("wizardRecuperarCodigoResultado", "Escribe el codigo.", "error"); return; }
        wizardResultado("wizardRecuperarCodigoResultado", "Verificando...");
        wizardBotonRecuperarCodigo.disabled = true;
        try {
            var datos = await wizardLlamar("/personas/verificar-codigo-reset", { method: "POST", body: JSON.stringify({ correo: correo, codigo: codigo }) });
            if (!datos.ok) { wizardResultado("wizardRecuperarCodigoResultado", datos.error || "Codigo invalido o vencido.", "error"); return; }
            wizardTokenRestablecimiento = datos.tokenRestablecimiento;
            document.getElementById("wizardRecuperarPaso2").hidden = true;
            document.getElementById("wizardRecuperarPaso3").hidden = false;
        } catch (error) {
            wizardResultado("wizardRecuperarCodigoResultado", "Ocurrio un error. Intenta de nuevo.", "error");
        } finally {
            wizardBotonRecuperarCodigo.disabled = false;
        }
    });
}

var wizardBotonRecuperarNueva = document.getElementById("wizardRecuperarNuevaBoton");
if (wizardBotonRecuperarNueva) {
    wizardBotonRecuperarNueva.addEventListener("click", async function() {
        var password = document.getElementById("wizardRecuperarNuevaPassword").value;
        var confirmarPassword = document.getElementById("wizardRecuperarConfirmarPassword").value;
        if (password.length < 8) { wizardResultado("wizardRecuperarNuevaResultado", "Minimo 8 caracteres.", "error"); return; }
        wizardResultado("wizardRecuperarNuevaResultado", "Guardando...");
        wizardBotonRecuperarNueva.disabled = true;
        try {
            var datos = await wizardLlamar("/personas/restablecer-password", {
                method: "POST",
                body: JSON.stringify({ tokenRestablecimiento: wizardTokenRestablecimiento, password: password, confirmarPassword: confirmarPassword })
            });
            if (!datos.ok) { wizardResultado("wizardRecuperarNuevaResultado", datos.error || "No se pudo restablecer tu contrasena.", "error"); return; }
            wizardResultado("wizardRecuperarNuevaResultado", "Contrasena actualizada. Ya puedes iniciar sesion.", "ok");
            setTimeout(function() { wizardIrA("iniciar-sesion"); }, 1200);
        } catch (error) {
            wizardResultado("wizardRecuperarNuevaResultado", "Ocurrio un error. Intenta de nuevo.", "error");
        } finally {
            wizardBotonRecuperarNueva.disabled = false;
        }
    });
}

// Pantalla 8 (elegir modo) -- ambas opciones recargan /market/mi-cuenta
// de verdad (no SPA): la seccion "home" solo existe en el HTML cuando
// el servidor ya renderizo con persona, y un invitado recien
// registrado nunca la tiene en el DOM todavia. Dejar que el servidor
// decida de nuevo tambien cubre el caso "Administrar mi negocio" sin
// duplicar el auto-routing (ver servirCuentaMarketApp).
var wizardBotonElegirComprar = document.getElementById("wizardElegirComprar");
if (wizardBotonElegirComprar) wizardBotonElegirComprar.addEventListener("click", function() { window.location.href = "/market/mi-cuenta"; });

var wizardBotonElegirAdministrar = document.getElementById("wizardElegirAdministrar");
if (wizardBotonElegirAdministrar) wizardBotonElegirAdministrar.addEventListener("click", function() { window.location.href = "/market/mi-cuenta"; });

// Pantalla 5 -- verificacion bloqueante: polling real a GET
// /personas/estado (solo funciona si hay sesion viva, caso del
// registro recien hecho -- el login bloqueado no mintea sesion, por
// eso el boton manual "Ya verifique" existe como alternativa).
var wizardPollingVerificacion = null;

function wizardDetenerPolling() {
    if (wizardPollingVerificacion) { clearInterval(wizardPollingVerificacion); wizardPollingVerificacion = null; }
}

async function wizardRevisarVerificacion() {
    try {
        var estado = await wizardLlamar("/personas/estado");
        if (estado && estado.ok && estado.persona && estado.persona.correoVerificado) {
            wizardDetenerPolling();
            wizardIrA("cuenta-creada");
            return true;
        }
    } catch (error) { /* sin sesion o sin red -- se reintenta solo */ }
    return false;
}

async function wizardAlEntrarPantalla(pantalla) {
    if (pantalla === "verificacion") {
        var botonYaVerifique = document.getElementById("wizardYaVerifiqueBoton");
        if (botonYaVerifique) botonYaVerifique.hidden = false;
        wizardDetenerPolling();
        var yaVerificado = await wizardRevisarVerificacion();
        if (!yaVerificado) wizardPollingVerificacion = setInterval(wizardRevisarVerificacion, 4000);
    } else {
        wizardDetenerPolling();
    }
    if (pantalla === "cuenta-creada") wizardConfetti();
}

var wizardBotonYaVerifique = document.getElementById("wizardYaVerifiqueBoton");
if (wizardBotonYaVerifique) {
    wizardBotonYaVerifique.addEventListener("click", async function() {
        wizardResultado("wizardVerificacionResultado", "Revisando...");
        if (wizardEstadoVerificacion.credenciales) {
            var datosLogin = await wizardLlamar("/personas/login", {
                method: "POST",
                body: JSON.stringify(wizardEstadoVerificacion.credenciales)
            });
            if (datosLogin.ok) { window.location.reload(); return; }
            wizardResultado("wizardVerificacionResultado", datosLogin.correoSinVerificar ? "Todavia no. Revisa tu correo e intenta de nuevo." : (datosLogin.error || "No se pudo verificar."), "error");
            return;
        }
        var verificado = await wizardRevisarVerificacion();
        if (!verificado) wizardResultado("wizardVerificacionResultado", "Todavia no. Revisa tu correo e intenta de nuevo.", "error");
    });
}

var wizardBotonReenviar = document.getElementById("wizardReenviarVerificacionBoton");
if (wizardBotonReenviar) {
    wizardBotonReenviar.addEventListener("click", async function() {
        if (!wizardEstadoVerificacion.correo) { wizardResultado("wizardVerificacionResultado", "No tenemos un correo para reenviar.", "error"); return; }
        wizardResultado("wizardVerificacionResultado", "Reenviando...");
        await wizardLlamar("/personas/reenviar-verificacion", { method: "POST", body: JSON.stringify({ correo: wizardEstadoVerificacion.correo }) });
        wizardResultado("wizardVerificacionResultado", "Si tu correo existe, te reenviamos el enlace.", "ok");
    });
}

var wizardBotonCambiarCorreo = document.getElementById("wizardCambiarCorreoBoton");
if (wizardBotonCambiarCorreo) {
    wizardBotonCambiarCorreo.addEventListener("click", async function() {
        var formulario = document.getElementById("wizardCambiarCorreoForm");
        if (formulario.hidden) { formulario.hidden = false; return; }
        var nuevoCorreo = document.getElementById("wizardCambiarCorreoInput").value.trim();
        if (!nuevoCorreo) return;
        wizardResultado("wizardVerificacionResultado", "Actualizando...");
        var datos = await wizardLlamar("/personas/correo", { method: "PATCH", body: JSON.stringify({ correo: nuevoCorreo }) });
        if (!datos.ok) { wizardResultado("wizardVerificacionResultado", datos.error || "No se pudo cambiar el correo.", "error"); return; }
        wizardEstadoVerificacion.correo = nuevoCorreo;
        wizardEstadoVerificacion.credenciales = null;
        var textoVerif3 = document.getElementById("wizardVerificacionTexto");
        if (textoVerif3) textoVerif3.textContent = "Te enviamos un enlace a " + nuevoCorreo + ". Abrelo desde este mismo telefono y regresa aqui.";
        formulario.hidden = true;
        wizardResultado("wizardVerificacionResultado", "Correo actualizado.", "ok");
        wizardDetenerPolling();
        wizardPollingVerificacion = setInterval(wizardRevisarVerificacion, 4000);
    });
}

// Pantalla 6 -- confetti CSS/JS puro, sin dependencias.
function wizardConfetti() {
    var colores = ["#1067e8", "#18b88f", "#f3a21b", "#073f9a"];
    var contenedor = document.createElement("div");
    contenedor.style.cssText = "position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:30;";
    for (var i = 0; i < 60; i++) {
        var pieza = document.createElement("span");
        var izquierda = Math.random() * 100;
        var retraso = Math.random() * 0.4;
        var duracion = 1.8 + Math.random() * 1.2;
        var color = colores[i % colores.length];
        pieza.style.cssText = "position:absolute; top:-12px; left:" + izquierda + "%; width:8px; height:14px; background:" + color + "; opacity:.9; transform:rotate(" + (Math.random() * 360) + "deg); animation:wizardCaerConfetti " + duracion + "s ease-in " + retraso + "s forwards;";
        contenedor.appendChild(pieza);
    }
    document.body.appendChild(contenedor);
    setTimeout(function() { contenedor.remove(); }, 3500);
}
`;
}

function paginaWizardMarketHtml(persona, pantallaInicial) {
    const seccionesAuth = persona ? "" : pantallasWizardAuthHtml();
    const seccionHome = persona ? pantallaHomeHtml(persona) : "";
    const seccionDrawer = persona ? pantallaDrawerHtml(persona) : "";
    const seccionBottomNav = persona ? bottomNavHtml() : "";

    return `<!doctype html>
<html lang="es">
<head>
${cabezaWizardMarketHtml()}
</head>
<body class="wizard-body">
<div class="wizard-shell">
<div class="wizard-topbar"><button type="button" class="wizard-topbar-atras" id="wizardTopbarAtras" aria-label="Atras">←</button></div>
${seccionesAuth}
${seccionHome}
</div>
${seccionBottomNav}
${seccionDrawer}
<script>window.NEXO_PERSONA_OFICIO = ${JSON.stringify((persona && persona.oficio) || "").replace(/<\//g, "<\\/")};</script>
<script>${scriptWizardMarketHtml(pantallaInicial)}</script>
</body>
</html>`;
}

async function servirCuentaMarketApp(pool, req, res) {
    try {
        const resolverPersonaOpcional = crearResolverSesionPersonaOpcional(pool);
        await new Promise(continuar => resolverPersonaOpcional(req, res, continuar));

        // Mismo atajo que servirCuentaMarket (escritorio, ver plan
        // "arquitectura de navegacion del comprador"): una persona que
        // solo administra negocios (sin ninguna señal de comprador)
        // nunca ve el wizard de comprador -- espejado aqui para que el
        // comportamiento sea identico en movil y escritorio (decision de
        // alcance confirmada: el auto-routing existente no se toca).
        if (req.persona) {
            const [negociosAdministrados, senalCompradora] = await Promise.all([
                listarNegociosAdministrados(pool, req.persona.id),
                contarSenalCompradora(pool, req.persona.id)
            ]);

            if (negociosAdministrados.length > 0 && senalCompradora === 0) {
                if (negociosAdministrados.length === 1) {
                    const resultado = await mintearSesionParaNegocioDePersona(pool, req.persona.id, negociosAdministrados[0].id, req);
                    if (resultado) {
                        res.set("Content-Type", "text/html; charset=utf-8").send(paginaEntrandoAdminMarketHtml(resultado.token));
                        return;
                    }
                } else {
                    res.set("Content-Type", "text/html; charset=utf-8").send(paginaElegirNegocioMarketHtml(negociosAdministrados));
                    return;
                }
            }
        }

        const pantallaInicial = req.persona ? "home" : "bienvenida";
        res.set("Content-Type", "text/html; charset=utf-8").send(paginaWizardMarketHtml(req.persona, pantallaInicial));
    } catch (error) {
        console.warn("Error sirviendo /market/mi-cuenta (app movil):", error.message);
        res.status(500).send("Error");
    }
}

module.exports = { esVistaMovilMarket, servirCuentaMarketApp };

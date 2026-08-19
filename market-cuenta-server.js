// Nexo Market -- /market/mi-cuenta (Fase 1 "arquitectura de navegacion
// del comprador", ver plan). Misma costura que market-tienda-server.js:
// importa el shell fijo de Market (marketHeaderHtml/marketFooterHtml/
// scriptMarketHeaderHtml) y el lenguaje visual "tipo Amazon" ya
// validado en /portal-cliente (estilosPortalClienteHtml + iconos),
// nunca duplicados.
//
// Requisito no negociable: cuando ya hay sesion de persona, esta pagina
// renderiza el hub de cuenta DIRECTAMENTE -- nunca la pantalla "Elige a
// donde quieres entrar" (esa pantalla vieja, public/site/mi-cuenta.html,
// se retira en el mismo cambio que activa /market/mi-cuenta). El panel
// de administrador solo aparece si la persona ya administra 1+ negocio.

const {
    estilosPortalClienteHtml,
    ICONO_PORTAL_RESUMEN,
    ICONO_PORTAL_PEDIDOS,
    ICONO_PORTAL_CREDITO,
    ICONO_PORTAL_DIRECCION,
    ICONO_PORTAL_USUARIO,
    ICONO_PORTAL_SEGURIDAD,
    ICONO_PORTAL_AYUDA,
    ICONO_PORTAL_SALIR,
    ICONO_TENANT_FAVORITO
} = require("./public-site-server");

const {
    crearResolverSesionPersonaOpcional,
    listarNegociosAdministrados,
    mintearSesionParaNegocioDePersona
} = require("./personas-server");

const { contarSenalCompradora } = require("./public-site-server");

const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml, metaInstalableMarketHtml } = require("./market-server");

// Mismo patron de escape local que el resto de modulos del sitio
// publico -- copiado, no importado.
function escaparHtml(valor) {
    return String(valor == null ? "" : valor)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Estilos exclusivos de esta pagina -- el resto (.portal-*) viene de
// estilosPortalClienteHtml(), reusado tal cual.
const ESTILOS_CUENTA_MARKET = `
.market-cuenta-scope{ max-width:1200px; margin:0 auto; padding:28px clamp(18px,4vw,48px) 60px; }
.market-cuenta-admin-card{ display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:14px; padding:18px 22px; margin-bottom:24px; border-radius:18px; background:linear-gradient(135deg,#101826,#1c2c47); color:#fff; }
.market-cuenta-admin-card p{ margin:0; font-size:13.5px; color:rgba(255,255,255,.8); }
.market-cuenta-admin-card strong{ display:block; font-size:15px; margin-bottom:2px; }
.market-cuenta-admin-lista{ display:flex; flex-wrap:wrap; gap:10px; }
.market-cuenta-admin-lista button{ padding:9px 16px; border-radius:999px; border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.1); color:#fff; font-weight:700; font-size:12.5px; cursor:pointer; }
.market-cuenta-panel[hidden]{ display:none; }
.market-cuenta-login{ max-width:920px; margin:0 auto; padding:40px clamp(18px,4vw,48px) 60px; }
.market-cuenta-login .contact{ grid-template-columns:minmax(0,1fr); padding-left:0; padding-right:0; gap:28px; }
.market-cuenta-login .contact-panel-wrap{ max-width:420px; }
.market-cuenta-config-form{ display:grid; gap:14px; max-width:420px; }
.market-cuenta-config-form label{ display:grid; gap:6px; font-size:13px; font-weight:700; color:var(--muted); }
.market-cuenta-config-form input, .market-cuenta-config-form select{ padding:10px 12px; border-radius:10px; border:1px solid var(--line); font-size:13.5px; }
.market-cuenta-link-olvide{ background:none; border:none; padding:0; margin-top:2px; font-size:12.5px; font-weight:700; color:var(--primary,#1c2c47); text-decoration:underline; cursor:pointer; text-align:left; }
.market-cuenta-link-volver{ background:none; border:none; padding:0; margin-top:14px; font-size:12.5px; font-weight:700; color:var(--muted); text-decoration:underline; cursor:pointer; }
.market-cuenta-olvide-paso[hidden]{ display:none; }
`;

function cabezaCuentaMarketHtml() {
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi cuenta -- Nexo Market</title>
<meta name="description" content="Tu cuenta Nexo: pedidos, favoritos, credito y las ferreterias donde compras, todo dentro de Nexo Market.">
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}</style>
<style>${estilosPortalClienteHtml()}</style>
<style>${ESTILOS_CUENTA_MARKET}</style>`;
}

// Pantalla de login/registro -- mismos campos y rutas que la vieja
// public/site/mi-cuenta.html, reubicados dentro del marco de Market.
function paginaLoginCuentaMarketHtml() {
    const contenido = `<section class="contact" style="padding-top:0;">
<div class="contact-intro">
<p class="eyebrow">Tu cuenta Nexo</p>
<h2>Una sola cuenta para comprar y administrar.</h2>
<p>Entra con tu correo o telefono. Desde aqui puedes ver tus pedidos, tu credito y las ferreterias donde ya eres cliente, sin salir de Nexo Market.</p>
</div>
<div class="contact-panel-wrap">
<div class="contact-tabs" role="tablist">
<button type="button" class="contact-tab active" data-tab="login" role="tab" aria-selected="true">Iniciar sesion</button>
<button type="button" class="contact-tab" data-tab="registro" role="tab" aria-selected="false">Crear cuenta</button>
</div>
<div class="contact-panel" id="panelLogin" role="tabpanel">
<form class="lead-form" id="cuentaMarketLoginForm">
<label>Correo o telefono<input id="loginIdentificador" type="text" placeholder="Ej. tu@correo.com o 4421234567" required></label>
<label>Contrasena<input id="loginPassword" type="password" placeholder="Tu contrasena" required></label>
<button class="btn primary" type="submit">Entrar</button>
<button type="button" class="market-cuenta-link-olvide" id="botonOlvidePassword">¿Olvidaste tu contrasena?</button>
<div id="loginResultado" class="lead-result" aria-live="polite"></div>
</form>
</div>
<div class="contact-panel" id="panelOlvide" role="tabpanel" hidden>
<form class="lead-form market-cuenta-olvide-paso" id="cuentaMarketOlvideForm">
<p style="margin:0 0 4px; color:var(--muted); font-size:13px;">Escribe el correo con el que te registraste. Si existe una cuenta, te enviamos un codigo de 6 digitos.</p>
<label>Correo<input id="olvideCorreo" type="email" placeholder="tu@correo.com" required></label>
<button class="btn primary" type="submit">Enviar codigo</button>
<div id="olvideResultado" class="lead-result" aria-live="polite"></div>
</form>
<form class="lead-form market-cuenta-olvide-paso" id="cuentaMarketCodigoForm" hidden>
<label>Codigo de 6 digitos<input id="olvideCodigo" type="text" inputmode="numeric" maxlength="6" placeholder="123456" required></label>
<button class="btn primary" type="submit">Verificar codigo</button>
<div id="olvideCodigoResultado" class="lead-result" aria-live="polite"></div>
</form>
<form class="lead-form market-cuenta-olvide-paso" id="cuentaMarketNuevaPasswordForm" hidden>
<label>Nueva contrasena<input id="olvideNuevaPassword" type="password" minlength="8" placeholder="Minimo 8 caracteres" required></label>
<label>Confirmar contrasena<input id="olvideConfirmarPassword" type="password" minlength="8" placeholder="Repite tu nueva contrasena" required></label>
<button class="btn primary" type="submit">Restablecer contrasena</button>
<div id="olvideNuevaPasswordResultado" class="lead-result" aria-live="polite"></div>
</form>
<button type="button" class="market-cuenta-link-volver" id="botonVolverLogin">&larr; Volver a iniciar sesion</button>
</div>
<div class="contact-panel" id="panelRegistro" role="tabpanel" hidden>
<form class="lead-form" id="cuentaMarketRegistroForm">
<label>Tu nombre<input id="registroNombre" type="text" placeholder="Ej. Gustavo" required></label>
<label>Correo (opcional si dejas telefono)<input id="registroCorreoPersona" type="email" placeholder="Ej. tu@correo.com"></label>
<label>Telefono (opcional si dejas correo)<input id="registroTelefonoPersona" type="tel" placeholder="Ej. 4421234567"></label>
<label>Contrasena<input id="registroPasswordPersona" type="password" placeholder="Minimo 8 caracteres" minlength="8" required></label>
<label>¿A que te dedicas? (opcional)
<select id="registroOficioPersona">
<option value="">Prefiero no decirlo</option>
<option value="herramientas">Herramientas</option>
<option value="construccion">Construccion</option>
<option value="electrico">Electrico</option>
<option value="plomeria">Plomeria</option>
<option value="pintura">Pintura</option>
<option value="seguridad">Seguridad</option>
<option value="jardin">Jardin</option>
<option value="limpieza">Limpieza</option>
<option value="otro">Otro</option>
</select>
</label>
<button class="btn primary" type="submit">Crear mi cuenta Nexo</button>
<div id="registroResultadoPersona" class="lead-result" aria-live="polite"></div>
</form>
</div>
</div>
</section>`;

    return `<!doctype html>
<html lang="es">
<head>
${cabezaCuentaMarketHtml()}
</head>
<body>
${marketHeaderHtml({})}
<div class="market-cuenta-login">
${contenido}
</div>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>${scriptLoginCuentaMarketHtml()}</script>
</body>
</html>`;
}

function scriptLoginCuentaMarketHtml() {
    return `
document.querySelectorAll(".contact-tab").forEach(function(tab) {
    tab.addEventListener("click", function() {
        document.querySelectorAll(".contact-tab").forEach(function(t) { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        document.getElementById("panelLogin").hidden = tab.dataset.tab !== "login";
        document.getElementById("panelRegistro").hidden = tab.dataset.tab !== "registro";
        document.getElementById("panelOlvide").hidden = true;
    });
});

async function cuentaMarketLlamar(ruta, opciones) {
    const respuesta = await fetch(ruta, Object.assign({ credentials: "include", headers: { "Content-Type": "application/json" } }, opciones || {}));
    return respuesta.json();
}

document.getElementById("cuentaMarketLoginForm").addEventListener("submit", async function(evento) {
    evento.preventDefault();
    const resultado = document.getElementById("loginResultado");
    resultado.textContent = "Entrando...";
    const datos = await cuentaMarketLlamar("/personas/login", {
        method: "POST",
        body: JSON.stringify({
            identificador: document.getElementById("loginIdentificador").value,
            password: document.getElementById("loginPassword").value
        })
    });
    if (!datos.ok) { resultado.textContent = datos.error || "No se pudo iniciar sesion."; return; }
    window.location.reload();
});

document.getElementById("cuentaMarketRegistroForm").addEventListener("submit", async function(evento) {
    evento.preventDefault();
    const resultado = document.getElementById("registroResultadoPersona");
    resultado.textContent = "Creando tu cuenta...";
    const datos = await cuentaMarketLlamar("/personas/registro", {
        method: "POST",
        body: JSON.stringify({
            nombre: document.getElementById("registroNombre").value,
            correo: document.getElementById("registroCorreoPersona").value,
            telefono: document.getElementById("registroTelefonoPersona").value,
            password: document.getElementById("registroPasswordPersona").value,
            oficio: document.getElementById("registroOficioPersona").value
        })
    });
    if (!datos.ok) { resultado.textContent = datos.error || "No se pudo crear tu cuenta."; return; }
    window.location.reload();
});

var olvideTokenRestablecimiento = "";

function mostrarPanelOlvide() {
    document.getElementById("panelLogin").hidden = true;
    document.getElementById("panelRegistro").hidden = true;
    document.getElementById("panelOlvide").hidden = false;
    document.getElementById("cuentaMarketOlvideForm").hidden = false;
    document.getElementById("cuentaMarketCodigoForm").hidden = true;
    document.getElementById("cuentaMarketNuevaPasswordForm").hidden = true;
}

document.getElementById("botonOlvidePassword").addEventListener("click", mostrarPanelOlvide);

document.getElementById("botonVolverLogin").addEventListener("click", function() {
    document.getElementById("panelOlvide").hidden = true;
    document.querySelectorAll(".contact-tab").forEach(function(t) {
        const esLogin = t.dataset.tab === "login";
        t.classList.toggle("active", esLogin);
        t.setAttribute("aria-selected", esLogin ? "true" : "false");
    });
    document.getElementById("panelLogin").hidden = false;
    document.getElementById("panelRegistro").hidden = true;
});

document.getElementById("cuentaMarketOlvideForm").addEventListener("submit", async function(evento) {
    evento.preventDefault();
    const resultado = document.getElementById("olvideResultado");
    resultado.textContent = "Enviando...";
    const datos = await cuentaMarketLlamar("/personas/olvide-password", {
        method: "POST",
        body: JSON.stringify({ correo: document.getElementById("olvideCorreo").value })
    });
    if (!datos.ok) { resultado.textContent = datos.error || "No se pudo enviar el codigo."; return; }
    resultado.textContent = "Si existe una cuenta con ese correo, te enviamos un codigo. Revisa tu bandeja de entrada.";
    document.getElementById("cuentaMarketOlvideForm").hidden = true;
    document.getElementById("cuentaMarketCodigoForm").hidden = false;
});

document.getElementById("cuentaMarketCodigoForm").addEventListener("submit", async function(evento) {
    evento.preventDefault();
    const resultado = document.getElementById("olvideCodigoResultado");
    resultado.textContent = "Verificando...";
    const datos = await cuentaMarketLlamar("/personas/verificar-codigo-reset", {
        method: "POST",
        body: JSON.stringify({
            correo: document.getElementById("olvideCorreo").value,
            codigo: document.getElementById("olvideCodigo").value
        })
    });
    if (!datos.ok) { resultado.textContent = datos.error || "Codigo invalido o vencido."; return; }
    olvideTokenRestablecimiento = datos.tokenRestablecimiento;
    resultado.textContent = "";
    document.getElementById("cuentaMarketCodigoForm").hidden = true;
    document.getElementById("cuentaMarketNuevaPasswordForm").hidden = false;
});

document.getElementById("cuentaMarketNuevaPasswordForm").addEventListener("submit", async function(evento) {
    evento.preventDefault();
    const resultado = document.getElementById("olvideNuevaPasswordResultado");
    resultado.textContent = "Guardando...";
    const datos = await cuentaMarketLlamar("/personas/restablecer-password", {
        method: "POST",
        body: JSON.stringify({
            tokenRestablecimiento: olvideTokenRestablecimiento,
            password: document.getElementById("olvideNuevaPassword").value,
            confirmarPassword: document.getElementById("olvideConfirmarPassword").value
        })
    });
    if (!datos.ok) { resultado.textContent = datos.error || "No se pudo restablecer tu contrasena."; return; }
    resultado.textContent = "Tu contrasena se actualizo. Ya puedes iniciar sesion.";
    setTimeout(function() { document.getElementById("botonVolverLogin").click(); }, 1500);
});

(function preseleccionarDesdeMarket() {
    const parametros = new URLSearchParams(window.location.search);
    const oficio = parametros.get("oficio");
    const tab = parametros.get("tab");
    if (tab === "registro") {
        document.querySelectorAll(".contact-tab").forEach(function(t) {
            const esRegistro = t.dataset.tab === "registro";
            t.classList.toggle("active", esRegistro);
            t.setAttribute("aria-selected", esRegistro ? "true" : "false");
        });
        document.getElementById("panelLogin").hidden = true;
        document.getElementById("panelRegistro").hidden = false;
    }
    if (oficio) {
        const select = document.getElementById("registroOficioPersona");
        if (select && Array.from(select.options).some(function(o) { return o.value === oficio; })) {
            select.value = oficio;
        }
    }
})();
`;
}

// Cuenta puramente administradora (1 negocio, ninguna señal de
// comprador): se mintea la sesion server-side y se redirige de
// inmediato a /dueno -- nunca se pinta el hub de comprador ni se
// muestra ningun mensaje tipo "entraste como administrador" (el dueño
// pidio explicitamente evitar esa confusion). Doble redirect
// (meta refresh + JS) para que funcione incluso si JS tarda en correr.
function paginaEntrandoAdminMarketHtml(token) {
    const destino = "https://app.nexoposoficial.com/dueno?entrar=" + encodeURIComponent(token);
    return `<!doctype html>
<html lang="es">
<head>
${cabezaCuentaMarketHtml()}
<meta http-equiv="refresh" content="0;url=${escaparHtml(destino)}">
</head>
<body>
<div style="min-height:70vh; display:flex; align-items:center; justify-content:center; font-weight:700; color:var(--muted);">Entrando a tu panel...</div>
<script>window.location.replace(${JSON.stringify(destino)});</script>
</body>
</html>`;
}

// Cuenta administradora de 2+ negocios y ninguna señal de comprador: no
// se puede auto-elegir cual, asi que se pide -- pantalla corta, sin el
// resto del hub de comprador debajo (mismo motivo que la de arriba).
function paginaElegirNegocioMarketHtml(negocios) {
    const botones = negocios.map(n =>
        `<button type="button" data-negocio-id="${n.id}">Entrar a ${escaparHtml(n.nombre)}</button>`
    ).join("");

    const contenido = `<div class="market-cuenta-login">
<div class="contact-intro" style="margin-bottom:24px;">
<p class="eyebrow">Tu cuenta Nexo</p>
<h2>Administras varios negocios</h2>
<p>Elige a cual quieres entrar.</p>
</div>
<div class="market-cuenta-admin-card" style="display:block;">
<div class="market-cuenta-admin-lista" id="elegirNegocioLista" style="gap:12px;">${botones}</div>
</div>
<div id="elegirNegocioResultado" class="lead-result" aria-live="polite" style="margin-top:16px;"></div>
</div>`;

    return `<!doctype html>
<html lang="es">
<head>
${cabezaCuentaMarketHtml()}
</head>
<body>
${marketHeaderHtml({})}
${contenido}
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>
document.querySelectorAll("#elegirNegocioLista button").forEach(function(boton) {
    boton.addEventListener("click", async function() {
        const resultado = document.getElementById("elegirNegocioResultado");
        resultado.textContent = "Entrando...";
        try {
            const respuesta = await fetch("/personas/negocios/" + boton.dataset.negocioId + "/entrar", { method: "POST", credentials: "include" });
            const datos = await respuesta.json();
            if (!datos.ok) { resultado.textContent = datos.error || "No se pudo entrar a ese negocio."; return; }
            window.location.href = "https://app.nexoposoficial.com/dueno?entrar=" + encodeURIComponent(datos.token);
        } catch (error) {
            resultado.textContent = "Ocurrio un error. Intenta de nuevo.";
        }
    });
});
</script>
</body>
</html>`;
}

// Hub de cuenta -- se renderiza directo cuando ya hay sesion de
// persona, sin pantalla intermedia. Todo dato real llega por fetch()
// despues de cargar (nombre/correo/telefono de la persona son la unica
// excepcion, ya vienen del servidor porque no hay forma de que un
// visitante sin sesion vea este HTML).
function paginaHubCuentaMarketHtml(persona, pestanaInicial = "resumen") {
    const nombreSeguro = escaparHtml(persona.nombre);
    const correoSeguro = escaparHtml(persona.correo || "Sin correo registrado");
    const telefonoSeguro = escaparHtml(persona.telefono || "Sin telefono registrado");
    const oficioActual = escaparHtml(persona.oficio || "");

    // Que pestana abre por defecto viene del servidor (nunca de un hash
    // en la URL) -- un fragmento "#pedidos" nunca llega al servidor, asi
    // que si /market/mis-pedidos dependiera de eso para decidir que
    // pintar, cualquier logica de servidor que corra antes (como el
    // atajo a la app del dueno de abajo) lo pisaria sin que el cliente
    // pueda evitarlo. Cada ruta que quiera abrir en una pestana concreta
    // debe pasarla aqui explicitamente.
    const claseActiva = tab => tab === pestanaInicial ? ' class="activo"' : '';
    const oculto = tab => tab === pestanaInicial ? '' : ' hidden';

    const contenido = `<div class="market-cuenta-scope">
<div id="cuentaMarketAdminCard"></div>
<div class="portal-shell">
<aside class="portal-sidebar">
<div class="portal-sidebar-titulo">Mi cuenta</div>
<a href="#resumen" data-tab="resumen"${claseActiva("resumen")}>${ICONO_PORTAL_RESUMEN}Resumen</a>
<a href="#pedidos" data-tab="pedidos"${claseActiva("pedidos")}>${ICONO_PORTAL_PEDIDOS}Mis pedidos</a>
<a href="#favoritos" data-tab="favoritos"${claseActiva("favoritos")}>${ICONO_TENANT_FAVORITO}Favoritos</a>
<a href="#credito" data-tab="credito"${claseActiva("credito")}>${ICONO_PORTAL_CREDITO}Mi credito</a>
<a href="#ferreterias" data-tab="ferreterias"${claseActiva("ferreterias")}>${ICONO_PORTAL_DIRECCION}Ferreterias</a>
<div class="portal-sidebar-titulo">Proximamente</div>
<span class="portal-sidebar-proximamente">${ICONO_PORTAL_DIRECCION}Direcciones<span class="etiqueta">Pronto</span></span>
<div class="portal-sidebar-titulo">Cuenta</div>
<a href="#configuracion" data-tab="configuracion"${claseActiva("configuracion")}>${ICONO_PORTAL_SEGURIDAD}Configuracion</a>
<a href="/site#contacto">${ICONO_PORTAL_AYUDA}Ayuda y soporte</a>
<div class="portal-sidebar-salir">
<button type="button" id="cuentaMarketLogoutBoton">${ICONO_PORTAL_SALIR}Cerrar sesion</button>
</div>
</aside>
<div>

<section class="market-cuenta-panel" data-panel="resumen"${oculto("resumen")}>
<div class="portal-header-card">
<div><p class="portal-header-saludo">Hola, ${nombreSeguro} 👋</p><span class="portal-header-badge">Cuenta Nexo</span></div>
</div>
<div class="portal-stats-grid">
<div class="portal-stat-card"><div class="portal-stat-card-titulo">${ICONO_PORTAL_PEDIDOS}Mis pedidos</div><div class="portal-stat-card-valor" id="resumenPedidosValor">--</div></div>
<div class="portal-stat-card"><div class="portal-stat-card-titulo">${ICONO_TENANT_FAVORITO}Favoritos</div><div class="portal-stat-card-valor" id="resumenFavoritosValor">--</div></div>
<div class="portal-stat-card"><div class="portal-stat-card-titulo">${ICONO_PORTAL_CREDITO}Credito disponible</div><div class="portal-stat-card-valor" id="resumenCreditoValor">--</div></div>
<div class="portal-stat-card"><div class="portal-stat-card-titulo">${ICONO_PORTAL_DIRECCION}Ferreterias</div><div class="portal-stat-card-valor" id="resumenFerreteriasValor">--</div></div>
</div>
</section>

<section class="market-cuenta-panel" data-panel="pedidos"${oculto("pedidos")}>
<div class="portal-card"><div class="portal-card-header"><h2>Mis pedidos</h2></div><div id="cuentaMarketPedidosLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="favoritos"${oculto("favoritos")}>
<div class="portal-card"><div class="portal-card-header"><h2>Favoritos</h2></div><div id="cuentaMarketFavoritosLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="credito"${oculto("credito")}>
<div class="portal-card"><div class="portal-card-header"><h2>Mi credito</h2></div><div id="cuentaMarketCreditoLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="ferreterias"${oculto("ferreterias")}>
<div class="portal-card"><div class="portal-card-header"><h2>Ferreterias donde eres cliente</h2></div><div id="cuentaMarketFerreteriasLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="configuracion"${oculto("configuracion")}>
<div class="portal-card" style="margin-bottom:20px;">
<div class="portal-card-header"><h2>Datos personales</h2></div>
<div class="portal-datos-fila"><span>Correo</span><span>${correoSeguro}</span></div>
<div class="portal-datos-fila"><span>Telefono</span><span>${telefonoSeguro}</span></div>
</div>
<div class="portal-card" style="margin-bottom:20px;">
<div class="portal-card-header"><h2>Tu oficio o interes</h2></div>
<form class="market-cuenta-config-form" id="cuentaMarketOficioForm">
<label>Nos ayuda a mostrarte productos relacionados en Nexo Market
<select id="cuentaMarketOficio">
<option value="">Prefiero no decirlo</option>
<option value="herramientas">Herramientas</option>
<option value="construccion">Construccion</option>
<option value="electrico">Electrico</option>
<option value="plomeria">Plomeria</option>
<option value="pintura">Pintura</option>
<option value="seguridad">Seguridad</option>
<option value="jardin">Jardin</option>
<option value="limpieza">Limpieza</option>
<option value="otro">Otro</option>
</select>
</label>
</form>
<div id="cuentaMarketOficioResultado" class="lead-result" aria-live="polite"></div>
</div>
<div class="portal-card" style="margin-bottom:20px;">
<div class="portal-card-header"><h2>Notificaciones</h2></div>
<p class="portal-credito-vacio" style="text-align:left; padding:0 0 12px;">Recibe un aviso en este dispositivo cuando cambie el estado de tus pedidos (listo para recoger, etc.).</p>
<button type="button" class="btn secondary" id="cuentaMarketPushBoton">🔕 Activar notificaciones</button>
</div>
<div class="portal-card">
<div class="portal-card-header"><h2>Acceso y seguridad</h2></div>
<form class="market-cuenta-config-form" id="cuentaMarketPasswordForm">
<label>Contrasena actual<input type="password" id="passwordActual" required></label>
<label>Contrasena nueva<input type="password" id="passwordNueva" minlength="8" required></label>
<button class="btn primary" type="submit">Cambiar contrasena</button>
<div id="cuentaMarketPasswordResultado" class="lead-result" aria-live="polite"></div>
</form>
</div>
</section>

</div>
</div>
</div>`;

    return `<!doctype html>
<html lang="es">
<head>
${cabezaCuentaMarketHtml()}
</head>
<body>
${marketHeaderHtml({})}
${contenido}
${marketFooterHtml()}
<script>window.NEXO_CUENTA_OFICIO_ACTUAL = ${JSON.stringify(oficioActual).replace(/<\//g, "<\\/")};</script>
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>${scriptHubCuentaMarketHtml()}</script>
</body>
</html>`;
}

// Todo dato del servidor se pinta con textContent, nunca innerHTML con
// el valor crudo -- misma disciplina que el resto del sitio publico.
function scriptHubCuentaMarketHtml() {
    return `
function cuentaMarketEscapar(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function cuentaMarketDinero(valor) {
    const numero = Number(valor) || 0;
    return "$" + numero.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function cuentaMarketLlamar(ruta, opciones) {
    const respuesta = await fetch(ruta, Object.assign({ credentials: "include", headers: { "Content-Type": "application/json" } }, opciones || {}));
    return respuesta.json();
}

document.querySelectorAll(".portal-sidebar a[data-tab]").forEach(function(link) {
    link.addEventListener("click", function(evento) {
        evento.preventDefault();
        const tab = link.dataset.tab;
        document.querySelectorAll(".portal-sidebar a[data-tab]").forEach(function(l) { l.classList.toggle("activo", l === link); });
        document.querySelectorAll(".market-cuenta-panel").forEach(function(panel) { panel.hidden = panel.dataset.panel !== tab; });
    });
});

// /market/mis-pedidos redirige aqui con #pedidos -- los enlaces del
// sidebar ya son anclas reales (href="#pedidos"), pero solo el click
// dispara el cambio de panel. Si la pagina carga directo con un hash
// (en vez de por click), se simula el click una sola vez al cargar.
(function(){
    const hashTab = window.location.hash.replace("#", "");
    if (!hashTab) return;
    const enlace = document.querySelector('.portal-sidebar a[data-tab="' + hashTab + '"]');
    if (enlace) enlace.click();
})();

async function cuentaMarketCargarResumenPedidosFavoritos() {
    const pedidos = await cuentaMarketLlamar("/personas/mis-pedidos");
    const totalPedidos = pedidos.ok ? new Set(pedidos.pedidos.map(function(p) { return p.grupo_id || p.id; })).size : 0;
    document.getElementById("resumenPedidosValor").textContent = String(totalPedidos);

    const listaPedidos = document.getElementById("cuentaMarketPedidosLista");
    if (!pedidos.ok || pedidos.pedidos.length === 0) {
        listaPedidos.innerHTML = "";
        listaPedidos.appendChild(Object.assign(document.createElement("p"), { className: "portal-credito-vacio", textContent: "Todavia no tienes pedidos con tu cuenta Nexo." }));
        return;
    }

    const grupos = new Map();
    pedidos.pedidos.forEach(function(p) {
        const clave = p.grupo_id || ("solo-" + p.id);
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(p);
    });

    var ETIQUETAS_ESTADO_MARKET = {
        pendiente: "Recibido", recibido: "Recibido", confirmado: "Preparando", preparando: "Preparando",
        listo: "Listo para recoger", entregado: "Entregado", cancelado: "Cancelado"
    };

    listaPedidos.innerHTML = "";
    grupos.forEach(function(items) {
        const primero = items[0];
        const esPedidoMarket = !!primero.codigo_recogida;
        const fila = document.createElement(esPedidoMarket ? "a" : "div");
        fila.className = "portal-pedido-fila";
        if (esPedidoMarket) {
            fila.href = "/market/pedido/" + encodeURIComponent(primero.codigo_recogida);
            fila.style.textDecoration = "none";
        }
        const nombres = items.map(function(it) { return it.producto_nombre; }).join(", ");
        const etiquetaEstado = esPedidoMarket
            ? (ETIQUETAS_ESTADO_MARKET[primero.estado_pedido_market] || primero.estado_pedido_market)
            : primero.estado;
        fila.innerHTML =
            '<div class="portal-pedido-icono">' + '${ICONO_PORTAL_PEDIDOS}' + '</div>' +
            '<div class="portal-pedido-info"><div class="portal-pedido-nombre"></div><div class="portal-pedido-fecha"></div></div>' +
            '<div class="portal-pedido-precio"></div>';
        fila.querySelector(".portal-pedido-nombre").textContent = nombres;
        fila.querySelector(".portal-pedido-fecha").textContent =
            cuentaMarketEscapar(primero.tienda) + " -- " + new Date(primero.created_at).toLocaleDateString("es-MX") + " -- " + etiquetaEstado;
        fila.querySelector(".portal-pedido-precio").textContent = primero.precio_cotizado ? cuentaMarketDinero(primero.precio_cotizado) : "";
        listaPedidos.appendChild(fila);
    });
}

async function cuentaMarketCargarFavoritos() {
    let lista = [];
    try { lista = JSON.parse(localStorage.getItem("nexoMarketFavoritos") || "[]"); } catch (error) { lista = []; }
    if (!Array.isArray(lista)) lista = [];

    document.getElementById("resumenFavoritosValor").textContent = String(lista.length);
    const contenedor = document.getElementById("cuentaMarketFavoritosLista");

    if (lista.length === 0) {
        contenedor.innerHTML = "";
        contenedor.appendChild(Object.assign(document.createElement("p"), { className: "portal-credito-vacio", textContent: "Todavia no guardas productos favoritos." }));
        return;
    }

    const datos = await cuentaMarketLlamar("/market/favoritos-json", { method: "POST", body: JSON.stringify({ items: lista }) });
    const productos = datos.ok ? datos.productos : [];

    contenedor.innerHTML = "";
    if (productos.length === 0) {
        contenedor.appendChild(Object.assign(document.createElement("p"), { className: "portal-credito-vacio", textContent: "Tus favoritos ya no estan disponibles." }));
        return;
    }

    productos.forEach(function(p) {
        const fila = document.createElement("a");
        fila.className = "portal-pedido-fila";
        fila.href = "/market/ferreteria/" + encodeURIComponent(p.slug) + "/catalogo/" + encodeURIComponent(p.codigo);
        fila.style.textDecoration = "none";
        fila.innerHTML =
            '<div class="portal-pedido-icono">' + '${ICONO_TENANT_FAVORITO}' + '</div>' +
            '<div class="portal-pedido-info"><div class="portal-pedido-nombre"></div><div class="portal-pedido-fecha"></div></div>' +
            '<div class="portal-pedido-precio"></div>';
        fila.querySelector(".portal-pedido-nombre").textContent = p.nombre;
        fila.querySelector(".portal-pedido-fecha").textContent = p.tienda;
        fila.querySelector(".portal-pedido-precio").textContent = p.precio != null ? cuentaMarketDinero(p.precioOferta != null ? p.precioOferta : p.precio) : "";
        contenedor.appendChild(fila);
    });
}

async function cuentaMarketCargarCredito() {
    const datos = await cuentaMarketLlamar("/personas/mi-credito");
    const contenedor = document.getElementById("cuentaMarketCreditoLista");
    const creditos = datos.ok ? datos.creditos : [];

    const disponibleTotal = creditos.reduce(function(suma, c) { return suma + Math.max(0, c.limiteCredito - c.saldo); }, 0);
    document.getElementById("resumenCreditoValor").textContent = creditos.length ? cuentaMarketDinero(disponibleTotal) : "--";

    contenedor.innerHTML = "";
    if (creditos.length === 0) {
        contenedor.appendChild(Object.assign(document.createElement("p"), { className: "portal-credito-vacio", textContent: "Todavia no eres cliente de credito vinculado en ninguna ferreteria." }));
        return;
    }

    creditos.forEach(function(c) {
        const disponible = Math.max(0, c.limiteCredito - c.saldo);
        const pct = c.limiteCredito > 0 ? Math.min(100, Math.round((disponible / c.limiteCredito) * 100)) : 0;
        const bloque = document.createElement("div");
        bloque.style.marginBottom = "22px";
        bloque.innerHTML =
            '<div class="portal-credito-gauge-wrap">' +
            '<div class="portal-credito-gauge"><span class="portal-credito-gauge-texto"></span></div>' +
            '<div class="portal-credito-lineas">' +
            '<div class="portal-datos-fila" style="border:none; padding:2px 0;"><strong style="font-size:14px;"></strong></div>' +
            '<div class="portal-credito-linea"><span>Limite</span><strong></strong></div>' +
            '<div class="portal-credito-linea"><span>Usado</span><strong></strong></div>' +
            '</div></div>';
        bloque.querySelector(".portal-credito-gauge").style.background =
            "conic-gradient(var(--blue) " + pct + "%, rgba(20,32,51,.12) 0)";
        bloque.querySelector(".portal-credito-gauge-texto").textContent = cuentaMarketDinero(disponible);
        bloque.querySelector(".portal-datos-fila strong").textContent = c.negocio.nombre;
        const lineas = bloque.querySelectorAll(".portal-credito-linea strong");
        lineas[0].textContent = cuentaMarketDinero(c.limiteCredito);
        lineas[1].textContent = cuentaMarketDinero(c.saldo);
        if (c.vencido) {
            const estado = document.createElement("span");
            estado.className = "portal-credito-estado vencido";
            estado.textContent = "Vencido -- " + cuentaMarketDinero(c.totalVencido);
            bloque.appendChild(estado);
        }
        contenedor.appendChild(bloque);
    });
}

async function cuentaMarketCargarFerreterias() {
    const datos = await cuentaMarketLlamar("/personas/negocios-cliente");
    const contenedor = document.getElementById("cuentaMarketFerreteriasLista");
    const negocios = datos.ok ? datos.negocios : [];

    document.getElementById("resumenFerreteriasValor").textContent = String(negocios.length);

    contenedor.innerHTML = "";
    if (negocios.length === 0) {
        contenedor.appendChild(Object.assign(document.createElement("p"), { className: "portal-credito-vacio", textContent: "Todavia no eres cliente en ninguna ferreteria Nexo." }));
        return;
    }

    negocios.forEach(function(n) {
        const fila = document.createElement("div");
        fila.className = "portal-tienda-fila";
        fila.innerHTML = '${ICONO_PORTAL_DIRECCION}<strong></strong><a></a>';
        fila.querySelector("strong").textContent = n.nombre;
        const link = fila.querySelector("a");
        link.textContent = "Ver tienda";
        link.href = "/market/ferreteria/" + encodeURIComponent(n.slug);
        contenedor.appendChild(fila);
    });
}

async function cuentaMarketCargarAdmin() {
    const datos = await cuentaMarketLlamar("/personas/negocios");
    if (!datos.ok || datos.negocios.length === 0) return;

    const tarjeta = document.getElementById("cuentaMarketAdminCard");
    const card = document.createElement("div");
    card.className = "market-cuenta-admin-card";
    card.innerHTML = '<div><strong>Panel de administrador</strong><p>Tambien administras ' + datos.negocios.length + ' negocio(s) en Nexo.</p></div><div class="market-cuenta-admin-lista"></div>';
    const lista = card.querySelector(".market-cuenta-admin-lista");

    datos.negocios.forEach(function(n) {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.textContent = "Entrar a " + n.nombre;
        boton.addEventListener("click", async function() {
            const resultado = await cuentaMarketLlamar("/personas/negocios/" + n.id + "/entrar", { method: "POST" });
            if (!resultado.ok) { alert(resultado.error || "No se pudo entrar a ese negocio."); return; }
            window.location.href = "https://app.nexoposoficial.com/dueno?entrar=" + encodeURIComponent(resultado.token);
        });
        lista.appendChild(boton);
    });

    tarjeta.appendChild(card);
}

document.getElementById("cuentaMarketOficio").value = window.NEXO_CUENTA_OFICIO_ACTUAL || "";
document.getElementById("cuentaMarketOficioForm").addEventListener("change", async function() {
    const resultado = document.getElementById("cuentaMarketOficioResultado");
    resultado.textContent = "Guardando...";
    const datos = await cuentaMarketLlamar("/personas/oficio", {
        method: "PATCH",
        body: JSON.stringify({ oficio: document.getElementById("cuentaMarketOficio").value })
    });
    resultado.textContent = datos.ok ? "Guardado." : (datos.error || "No se pudo guardar.");
});

document.getElementById("cuentaMarketPasswordForm").addEventListener("submit", async function(evento) {
    evento.preventDefault();
    const resultado = document.getElementById("cuentaMarketPasswordResultado");
    resultado.textContent = "Guardando...";
    const datos = await cuentaMarketLlamar("/personas/password", {
        method: "PATCH",
        body: JSON.stringify({
            passwordActual: document.getElementById("passwordActual").value,
            passwordNueva: document.getElementById("passwordNueva").value
        })
    });
    resultado.textContent = datos.ok ? "Contrasena actualizada." : (datos.error || "No se pudo cambiar la contrasena.");
    if (datos.ok) evento.target.reset();
});

document.getElementById("cuentaMarketLogoutBoton").addEventListener("click", async function() {
    await cuentaMarketLlamar("/personas/logout", { method: "POST" });
    window.location.href = "/market";
});

function cuentaMarketBase64UrlAUint8Array(base64Url) {
    var relleno = "=".repeat((4 - base64Url.length % 4) % 4);
    var base64 = (base64Url + relleno).replace(/-/g, "+").replace(/_/g, "/");
    var bruto = atob(base64);
    var salida = new Uint8Array(bruto.length);
    for (var i = 0; i < bruto.length; i++) salida[i] = bruto.charCodeAt(i);
    return salida;
}

function cuentaMarketActualizarBotonPush() {
    var boton = document.getElementById("cuentaMarketPushBoton");
    if (!boton) return;
    var activado = typeof Notification !== "undefined" && Notification.permission === "granted" && localStorage.getItem("nexoMarketPushActivado") === "1";
    boton.textContent = activado ? "🔔 Notificaciones activadas" : "🔕 Activar notificaciones";
    boton.disabled = activado;
}

document.getElementById("cuentaMarketPushBoton").addEventListener("click", async function() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("Este navegador no soporta notificaciones push.");
        return;
    }

    try {
        var permiso = await Notification.requestPermission();
        if (permiso !== "granted") {
            alert("No se activaron las notificaciones -- el permiso fue denegado.");
            return;
        }

        var respuestaClave = await fetch("/push/vapid-public-key").then(function(r) { return r.json(); });
        if (!respuestaClave.ok) {
            alert("Las notificaciones push no estan configuradas en el servidor todavia.");
            return;
        }

        var registro = await navigator.serviceWorker.register("/market-sw.js", { scope: "/market/" });
        var suscripcion = await registro.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: cuentaMarketBase64UrlAUint8Array(respuestaClave.publicKey)
        });

        await cuentaMarketLlamar("/personas/push/suscribir", { method: "POST", body: JSON.stringify(suscripcion.toJSON()) });

        localStorage.setItem("nexoMarketPushActivado", "1");
        cuentaMarketActualizarBotonPush();
    } catch (error) {
        alert("No se pudieron activar las notificaciones push en este dispositivo.");
    }
});

cuentaMarketActualizarBotonPush();
cuentaMarketCargarResumenPedidosFavoritos();
cuentaMarketCargarFavoritos();
cuentaMarketCargarCredito();
cuentaMarketCargarFerreterias();
cuentaMarketCargarAdmin();
`;
}

async function servirCuentaMarket(pool, req, res) {
    try {
        const resolverPersonaOpcional = crearResolverSesionPersonaOpcional(pool);
        await new Promise(continuar => resolverPersonaOpcional(req, res, continuar));

        if (!req.persona) {
            res.set("Content-Type", "text/html; charset=utf-8").send(paginaLoginCuentaMarketHtml());
            return;
        }

        // Cuenta puramente administradora (administra 1+ negocio y no
        // tiene ninguna señal real de comprador en ninguna ferreteria):
        // se salta el hub de comprador por completo, tal como pidio el
        // dueño. Cualquier otra combinacion (comprador puro, o comprador
        // que tambien administra) sigue viendo el hub de siempre.
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

        res.set("Content-Type", "text/html; charset=utf-8").send(paginaHubCuentaMarketHtml(req.persona));
    } catch (error) {
        console.warn("Error sirviendo /market/mi-cuenta:", error.message);
        res.status(500).send("Error");
    }
}

// /market/mis-pedidos -- a proposito NO pasa por el atajo de
// servirCuentaMarket que salta directo a la app del dueno para cuentas
// puramente administradoras. Ese atajo tiene sentido quando alguien le
// da clic al icono de la cuenta (quiere entrar a administrar), pero
// "Mis pedidos" siempre es una intencion de comprador -- alguien que
// tambien administra una ferreteria puede perfectamente haber comprado
// algo en otra. Bug real reportado: entrar aqui rebotaba a la app del
// dueno sin mostrar nunca los pedidos. Por el mismo motivo, la pestana
// inicial se decide en el servidor (pestanaInicial="pedidos"), no con
// un hash en la URL -- un fragmento nunca llega al servidor.
async function servirMisPedidosMarket(pool, req, res) {
    try {
        const resolverPersonaOpcional = crearResolverSesionPersonaOpcional(pool);
        await new Promise(continuar => resolverPersonaOpcional(req, res, continuar));

        if (!req.persona) {
            res.set("Content-Type", "text/html; charset=utf-8").send(paginaLoginCuentaMarketHtml());
            return;
        }

        res.set("Content-Type", "text/html; charset=utf-8").send(paginaHubCuentaMarketHtml(req.persona, "pedidos"));
    } catch (error) {
        console.warn("Error sirviendo /market/mis-pedidos:", error.message);
        res.status(500).send("Error");
    }
}

module.exports = { servirCuentaMarket, servirMisPedidosMarket, paginaEntrandoAdminMarketHtml, paginaElegirNegocioMarketHtml };

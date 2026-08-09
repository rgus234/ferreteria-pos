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

const { crearResolverSesionPersonaOpcional } = require("./personas-server");

const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml } = require("./market-server");

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
.market-cuenta-config-form{ display:grid; gap:14px; max-width:420px; }
.market-cuenta-config-form label{ display:grid; gap:6px; font-size:13px; font-weight:700; color:var(--muted); }
.market-cuenta-config-form input, .market-cuenta-config-form select{ padding:10px 12px; border-radius:10px; border:1px solid var(--line); font-size:13.5px; }
`;

function cabezaCuentaMarketHtml() {
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi cuenta -- Nexo Market</title>
<meta name="description" content="Tu cuenta Nexo: pedidos, favoritos, credito y las ferreterias donde compras, todo dentro de Nexo Market.">
<link rel="icon" href="/nexo-pos-icon.jpg">
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
<div id="loginResultado" class="lead-result" aria-live="polite"></div>
</form>
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

// Hub de cuenta -- se renderiza directo cuando ya hay sesion de
// persona, sin pantalla intermedia. Todo dato real llega por fetch()
// despues de cargar (nombre/correo/telefono de la persona son la unica
// excepcion, ya vienen del servidor porque no hay forma de que un
// visitante sin sesion vea este HTML).
function paginaHubCuentaMarketHtml(persona) {
    const nombreSeguro = escaparHtml(persona.nombre);
    const correoSeguro = escaparHtml(persona.correo || "Sin correo registrado");
    const telefonoSeguro = escaparHtml(persona.telefono || "Sin telefono registrado");
    const oficioActual = escaparHtml(persona.oficio || "");

    const contenido = `<div class="market-cuenta-scope">
<div id="cuentaMarketAdminCard"></div>
<div class="portal-shell">
<aside class="portal-sidebar">
<div class="portal-sidebar-titulo">Mi cuenta</div>
<a href="#resumen" data-tab="resumen" class="activo">${ICONO_PORTAL_RESUMEN}Resumen</a>
<a href="#pedidos" data-tab="pedidos">${ICONO_PORTAL_PEDIDOS}Mis pedidos</a>
<a href="#favoritos" data-tab="favoritos">${ICONO_TENANT_FAVORITO}Favoritos</a>
<a href="#credito" data-tab="credito">${ICONO_PORTAL_CREDITO}Mi credito</a>
<a href="#ferreterias" data-tab="ferreterias">${ICONO_PORTAL_DIRECCION}Ferreterias</a>
<div class="portal-sidebar-titulo">Proximamente</div>
<span class="portal-sidebar-proximamente">${ICONO_PORTAL_DIRECCION}Direcciones<span class="etiqueta">Pronto</span></span>
<div class="portal-sidebar-titulo">Cuenta</div>
<a href="#configuracion" data-tab="configuracion">${ICONO_PORTAL_SEGURIDAD}Configuracion</a>
<a href="/site#contacto">${ICONO_PORTAL_AYUDA}Ayuda y soporte</a>
<div class="portal-sidebar-salir">
<button type="button" id="cuentaMarketLogoutBoton">${ICONO_PORTAL_SALIR}Cerrar sesion</button>
</div>
</aside>
<div>

<section class="market-cuenta-panel" data-panel="resumen">
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

<section class="market-cuenta-panel" data-panel="pedidos" hidden>
<div class="portal-card"><div class="portal-card-header"><h2>Mis pedidos</h2></div><div id="cuentaMarketPedidosLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="favoritos" hidden>
<div class="portal-card"><div class="portal-card-header"><h2>Favoritos</h2></div><div id="cuentaMarketFavoritosLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="credito" hidden>
<div class="portal-card"><div class="portal-card-header"><h2>Mi credito</h2></div><div id="cuentaMarketCreditoLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="ferreterias" hidden>
<div class="portal-card"><div class="portal-card-header"><h2>Ferreterias donde eres cliente</h2></div><div id="cuentaMarketFerreteriasLista"><p class="portal-credito-vacio">Cargando...</p></div></div>
</section>

<section class="market-cuenta-panel" data-panel="configuracion" hidden>
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

    listaPedidos.innerHTML = "";
    grupos.forEach(function(items) {
        const primero = items[0];
        const fila = document.createElement("div");
        fila.className = "portal-pedido-fila";
        const nombres = items.map(function(it) { return it.producto_nombre; }).join(", ");
        fila.innerHTML =
            '<div class="portal-pedido-icono">' + '${ICONO_PORTAL_PEDIDOS}' + '</div>' +
            '<div class="portal-pedido-info"><div class="portal-pedido-nombre"></div><div class="portal-pedido-fecha"></div></div>' +
            '<div class="portal-pedido-precio"></div>';
        fila.querySelector(".portal-pedido-nombre").textContent = nombres;
        fila.querySelector(".portal-pedido-fecha").textContent =
            cuentaMarketEscapar(primero.tienda) + " -- " + new Date(primero.created_at).toLocaleDateString("es-MX") + " -- " + primero.estado;
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
            localStorage.setItem("nexoCuentaSesionToken", resultado.token);
            window.location.href = "https://app.nexoposoficial.com/";
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

        const html = req.persona
            ? paginaHubCuentaMarketHtml(req.persona)
            : paginaLoginCuentaMarketHtml();

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo /market/mi-cuenta:", error.message);
        res.status(500).send("Error");
    }
}

module.exports = { servirCuentaMarket };

// Nexo Market -- "Ayuda" y "Vende en Nexo", ahora dentro del mismo
// shell de Market (mismo header/footer que /market) en vez de mandar
// a /site (el sitio comercial, otro diseño/dominio conceptual por
// completo) -- pedido explicito del dueño: tocar estos enlaces no
// debe "sacar" al usuario de Nexo Market.
//
// El backend/los formularios NUNCA se duplican: se reusan tal cual
// los mismos endpoints que ya usaba public/site/index.html
// (/api/contacto-landing para el lead de ayuda, /api/clientes/registro
// para dar de alta una ferreteria nueva) -- este archivo solo reempaca
// el mismo formulario dentro del header/footer de Market. Ver el
// detalle completo de precios/planes se deja como enlace consciente a
// /site#planes -- portar toda la tabla comparativa + el modal de
// planes es una pieza mucho mas grande, fuera de esta pasada.

const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml, metaInstalableMarketHtml } = require("./market-server");

function escaparHtml(valor) {
    return String(valor == null ? "" : valor)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function cabezaMarketPaginaHtml(titulo, descripcion) {
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escaparHtml(titulo)}</title>
<meta name="description" content="${escaparHtml(descripcion)}">
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}
.market-pagina-simple{ max-width:640px; margin:0 auto; padding:32px 20px 60px; }
.market-pagina-simple .contact{ padding:0; }
</style>`;
}

function paginaMarketAyudaHtml() {
    return `<!doctype html>
<html lang="es">
<head>
${cabezaMarketPaginaHtml("Ayuda -- Nexo Market", "Contacta a Nexo: resuelve dudas sobre tus pedidos, tu cuenta o como comprar en Nexo Market.")}
</head>
<body>
${marketHeaderHtml({ activo: "ayuda" })}
<main class="market-pagina-simple">
<section class="contact">
<div class="contact-intro">
<p class="eyebrow">Ayuda</p>
<h2>¿En que te podemos ayudar?</h2>
<p>Escribenos si tienes dudas sobre un pedido, tu cuenta, o cualquier ferreteria de Nexo Market -- te contactamos por telefono o correo.</p>
<a class="contact-whatsapp" href="https://wa.me/524424950495?text=Hola%2C%20tengo%20una%20duda%20sobre%20Nexo%20Market." target="_blank" rel="noopener">
<span>¿Prefieres WhatsApp?</span>
<strong>Escribenos directo</strong>
</a>
</div>
<div class="contact-panel-wrap">
<div class="contact-panel" id="panelInfo">
<form class="lead-form" id="contactoLeadForm">
<input type="text" id="contactoEmpresaWeb" name="empresaWeb" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" aria-hidden="true">
<label>Tu nombre<input id="contactoNombre" type="text" placeholder="Ej. Gustavo" required></label>
<label>Negocio (si tu duda es sobre una ferreteria)<input id="contactoNegocio" type="text" placeholder="Ej. Ferreteria Olimpico"></label>
<label>Telefono<input id="contactoTelefono" type="tel" placeholder="Ej. 442 123 4567"></label>
<label>Correo<input id="contactoCorreo" type="email" placeholder="Ej. tu@correo.com"></label>
<label>Mensaje<input id="contactoMensaje" type="text" placeholder="Cuentanos que necesitas" required></label>
<button class="btn primary" type="submit" id="contactoSubmit">Enviar</button>
<div id="contactoResultado" class="lead-result" aria-live="polite"></div>
</form>
</div>
</div>
</section>
</main>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>${scriptFormularioAyudaHtml()}</script>
</body>
</html>`;
}

function paginaMarketVenderHtml() {
    return `<!doctype html>
<html lang="es">
<head>
${cabezaMarketPaginaHtml("Vende en Nexo Market", "Da de alta tu ferreteria en Nexo Market: administra tu inventario con Nexo POS y vendele a mas clientes.")}
</head>
<body>
${marketHeaderHtml({ activo: "vender" })}
<main class="market-pagina-simple">
<section class="contact">
<div class="contact-intro">
<p class="eyebrow">Para ferreterias</p>
<h2>Vende en Nexo Market</h2>
<p>Da de alta tu ferreteria: administras tu inventario con Nexo POS y tus productos aparecen para miles de compradores en Nexo Market. <a href="/site#planes">Ver planes y precios en detalle</a>.</p>
</div>
<div class="contact-panel-wrap">
<div class="contact-panel" id="panelCuenta">
<form class="lead-form" id="registroClienteForm">
<input type="text" id="registroEmpresaWeb" name="empresaWeb" autocomplete="off" tabindex="-1" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" aria-hidden="true">
<label>Nombre del negocio<input id="registroNegocio" type="text" placeholder="Ej. Ferreteria Olimpico" required></label>
<label>Telefono<input id="registroTelefono" type="tel" placeholder="Ej. 498 123 4567" required></label>
<label>Correo<input id="registroCorreo" type="email" placeholder="Ej. dueno@tunegocio.com" required></label>
<label>Contrasena<input id="registroPassword" type="password" placeholder="Minimo 8 caracteres" minlength="8" required></label>
<label>Confirmar contrasena<input id="registroConfirmarPassword" type="password" placeholder="Repite tu contrasena" minlength="8" required></label>
<label>Ciudad<input id="registroCiudad" type="text" placeholder="Ej. Rio Grande, Zac."></label>
<label>Contacto<input id="registroContacto" type="text" placeholder="Ej. Gustavo"></label>
<label class="lead-consent">
<input id="registroAceptaTerminos" type="checkbox" required>
<span>Acepto los <a href="/terminos" target="_blank" rel="noopener">Terminos de Servicio</a> y el <a href="/privacidad" target="_blank" rel="noopener">Aviso de Privacidad</a> de Nexo.</span>
</label>
<button class="btn primary" type="submit" id="registroSubmit">Solicitar licencia</button>
<div id="registroResultado" class="lead-result" aria-live="polite"></div>
</form>
</div>
</div>
</section>
</main>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>${scriptFormularioVenderHtml()}</script>
</body>
</html>`;
}

// Mismo formulario/logica que ya usaba public/site/index.html
// (contactoLeadForm -> POST /api/contacto-landing), copiado tal cual.
function scriptFormularioAyudaHtml() {
    return `
function marketPaginaEscapeHtml(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

var contactoForm = document.getElementById("contactoLeadForm");
var contactoButton = document.getElementById("contactoSubmit");
var contactoResultado = document.getElementById("contactoResultado");

function renderContacto(mensaje, esError) {
    contactoResultado.classList.toggle("error", Boolean(esError));
    contactoResultado.innerHTML = mensaje;
}

contactoForm.addEventListener("submit", async function(evento) {
    evento.preventDefault();
    contactoButton.disabled = true;
    renderContacto("Enviando...");

    try {
        var respuesta = await fetch("/api/contacto-landing", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                nombre: document.getElementById("contactoNombre").value,
                negocio: document.getElementById("contactoNegocio").value,
                telefono: document.getElementById("contactoTelefono").value,
                correo: document.getElementById("contactoCorreo").value,
                mensaje: document.getElementById("contactoMensaje").value,
                empresaWeb: document.getElementById("contactoEmpresaWeb").value
            })
        });
        var datos = await respuesta.json();
        if (!respuesta.ok || datos.ok === false) throw new Error(datos.error || "No se pudo enviar tu mensaje.");
        renderContacto("<strong>Listo, recibimos tu mensaje.</strong><span>Te contactamos en cuanto podamos.</span>");
        contactoForm.reset();
    } catch (error) {
        renderContacto(error.message, true);
    } finally {
        contactoButton.disabled = false;
    }
});
`;
}

// Mismo formulario/logica que ya usaba public/site/index.html
// (registroClienteForm -> POST /api/clientes/registro), copiado tal
// cual -- crea negocio + licencia real, no es un simple lead.
function scriptFormularioVenderHtml() {
    return `
function marketPaginaEscapeHtml(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

var registroForm = document.getElementById("registroClienteForm");
var registroButton = document.getElementById("registroSubmit");
var registroResultado = document.getElementById("registroResultado");

function renderRegistro(mensaje, esError) {
    registroResultado.classList.toggle("error", Boolean(esError));
    registroResultado.innerHTML = mensaje;
}

registroForm.addEventListener("submit", async function(evento) {
    evento.preventDefault();

    var password = document.getElementById("registroPassword").value;
    var confirmarPassword = document.getElementById("registroConfirmarPassword").value;
    if (password !== confirmarPassword) {
        renderRegistro("Las contrasenas no coinciden.", true);
        return;
    }

    registroButton.disabled = true;
    renderRegistro("Creando cliente y licencia...");

    try {
        var respuesta = await fetch("/api/clientes/registro", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                nombreNegocio: document.getElementById("registroNegocio").value,
                telefono: document.getElementById("registroTelefono").value,
                correo: document.getElementById("registroCorreo").value,
                password: password,
                confirmarPassword: confirmarPassword,
                ciudad: document.getElementById("registroCiudad").value,
                nombreContacto: document.getElementById("registroContacto").value,
                empresaWeb: document.getElementById("registroEmpresaWeb").value,
                giro: "ferreteria"
            })
        });
        var datos = await respuesta.json();
        if (!respuesta.ok || datos.ok === false) throw new Error(datos.error || "No se pudo generar la licencia.");

        renderRegistro(
            "<strong>Licencia creada</strong>" +
            "<span>Negocio: " + marketPaginaEscapeHtml(datos.negocio.nombre) + "</span>" +
            "<span>Clave: <b>" + marketPaginaEscapeHtml(datos.licencia.licenseKey) + "</b></span>" +
            "<span>Revisa tu correo (" + marketPaginaEscapeHtml(datos.negocio.correo) + ") para verificar tu cuenta.</span>" +
            "<div class=\\"registro-acceso-inicial\\">" +
            "<strong>Para entrar por primera vez:</strong>" +
            "<span>Abre la app y entra con el correo y la contrasena que acabas de crear.</span>" +
            "<span>Ahi mismo eliges el nombre y el PIN de tu primer usuario administrador.</span>" +
            "</div>" +
            "<a class=\\"btn secondary\\" href=\\"" + marketPaginaEscapeHtml(datos.instalador.url) + "\\" download>Descargar instalador</a>"
        );
        registroForm.reset();
    } catch (error) {
        renderRegistro(error.message, true);
    } finally {
        registroButton.disabled = false;
    }
});
`;
}

async function servirMarketAyuda(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaMarketAyudaHtml());
}

async function servirMarketVender(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaMarketVenderHtml());
}

module.exports = { servirMarketAyuda, servirMarketVender };

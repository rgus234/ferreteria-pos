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

// Terminos especificos de Nexo Market (compra/recoleccion/pagos/
// devoluciones entre comprador y tienda) -- distintos de /terminos
// (el contrato del software Nexo POS, para quien administra un
// negocio). Cada dato operativo de este documento (comision 3%,
// cancelacion solo en "pendiente", recoleccion en tienda sin entrega
// a domicilio, credito por tienda) viene directo de como el sistema
// ya funciona (ver COMISION_NEXO_MARKETPLACE en stripe-connect-server.js
// y cancelarPedidoMarketPorCliente en market-pedidos-server.js) --
// nada se inventa aqui salvo la seccion de devoluciones/garantia, que
// es una decision de negocio confirmada explicitamente con el dueño.
function paginaMarketTerminosHtml() {
    return `<!doctype html>
<html lang="es">
<head>
${cabezaMarketPaginaHtml("Terminos de Nexo Market", "Terminos y condiciones de Nexo Market: como funciona una compra, pagos, cancelaciones y devoluciones entre comprador y tienda.")}
</head>
<body>
${marketHeaderHtml({ activo: "" })}
<main>
<article class="legal-page">
<span class="eyebrow">Documento legal</span>
<h1>Terminos de Nexo Market</h1>
<p class="legal-meta">Ultima actualizacion: 24 de agosto de 2026.</p>

<div class="legal-notice">
Estos terminos son especificos de Nexo Market (comprar productos de
ferreterias reales). Si administras un negocio en Nexo, el contrato
del software esta en <a href="/terminos">Terminos de Nexo</a>.
</div>

<div class="legal-toc">
<p>Contenido</p>
<ol>
<li><a href="#que-es">Que es Nexo Market</a></li>
<li><a href="#tu-cuenta">Tu cuenta</a></li>
<li><a href="#como-compras">Como funciona una compra</a></li>
<li><a href="#precios">Precios y disponibilidad</a></li>
<li><a href="#pagos">Pagos</a></li>
<li><a href="#devoluciones">Devoluciones, cambios y garantia</a></li>
<li><a href="#responsable">Quien responde por el producto</a></li>
<li><a href="#uso-aceptable">Uso aceptable</a></li>
<li><a href="#cambios">Cambios a estos terminos</a></li>
<li><a href="#ley">Ley aplicable</a></li>
<li><a href="#contacto-legal">Contacto</a></li>
</ol>
</div>

<h2 id="que-es">1. Que es Nexo Market</h2>
<p>Nexo Market es el buscador de productos entre varias ferreterias Nexo. Cada resultado es un producto real de una ferreteria real: comparas precio y disponibilidad entre varias tiendas, pero compras directo con la tienda que elijas -- Nexo no es quien te vende el producto, es la plataforma que te ayuda a encontrarlo.</p>

<h2 id="tu-cuenta">2. Tu cuenta</h2>
<p>Con una sola cuenta Nexo puedes comprar en cualquier ferreteria de Nexo Market y, si tienes tu propia ferreteria, tambien administrarla -- sin crear cuentas separadas. Eres responsable de mantener tu contrasena en secreto y de todo lo que ocurra con tu cuenta.</p>

<h2 id="como-compras">3. Como funciona una compra</h2>
<p>Buscas y comparas productos entre varias ferreterias, compras directo con la tienda elegida, y recibes un codigo de recogida (con QR) para recoger tu pedido en la tienda fisica. Nexo Market funciona por recoleccion en tienda -- no hay entrega a domicilio salvo que la ferreteria lo ofrezca por su cuenta.</p>
<p><strong>Cancelar un pedido:</strong> puedes cancelarlo tu mismo desde el seguimiento de tu pedido solo mientras siga en estado "pendiente" (antes de que la tienda lo confirme). Una vez que la tienda empieza a prepararlo, para cancelarlo tienes que contactarla directamente.</p>

<h2 id="precios">4. Precios y disponibilidad</h2>
<p>Cada ferreteria es responsable de su propio inventario, precio y existencia -- Nexo Market muestra esa informacion tal como la tienda la mantiene, pero no la garantiza en tiempo real al 100%: puede haber diferencias si la tienda no ha actualizado su sistema.</p>

<h2 id="pagos">5. Pagos</h2>
<p>Puedes pagar con tarjeta (el cobro se procesa directo a la cuenta de la tienda que elegiste; Nexo cobra una comision del 3% a la tienda por ese servicio) o, si ya eres cliente de credito de esa tienda en particular, a tu credito con ella. El credito que tengas con una tienda es solo con esa tienda -- no es un credito general de Nexo Market que puedas usar en cualquier ferreteria.</p>

<h2 id="devoluciones">6. Devoluciones, cambios y garantia</h2>
<p>Cada ferreteria define su propia politica de cambios, devoluciones y garantia sobre lo que vende -- Nexo Market no fabrica ni almacena los productos, asi que no impone una regla unica para todas (una ferreteria no trata igual un cambio de tornilleria que de una herramienta electrica). Si la tienda no tiene su propia politica publicada, aplican las protecciones que ya te da la ley mexicana de proteccion al consumidor, sin importar lo que diga cualquier otro documento.</p>
<p>Si tienes un problema con tu compra, contacta primero directo a la ferreteria (sus datos estan en tu pedido). Si no logras una respuesta, escribenos a Nexo y te ayudamos a mediar; si detectamos que una tienda incumple de forma repetida, podemos suspenderla de la plataforma.</p>

<h2 id="responsable">7. Quien responde por el producto</h2>
<p>La ferreteria que vende el producto es responsable de que exista, de su calidad, y de entregarlo como se describio. Nexo Market es la plataforma tecnologica que conecta comprador y tienda -- no es el vendedor, no fabrica ni almacena los productos, y no responde por defectos o incumplimientos de la tienda (mas alla de ayudarte a contactarla o, si aplica, suspenderla de la plataforma).</p>

<h2 id="uso-aceptable">8. Uso aceptable</h2>
<p>Al usar Nexo Market te comprometes a no usarlo para fines ilegales, no intentar acceder a cuentas o pedidos que no son tuyos, y no abusar del sistema de codigos de recogida o de cancelaciones.</p>

<h2 id="cambios">9. Cambios a estos terminos</h2>
<p>Podemos actualizar estos terminos conforme Nexo Market crezca. Si el cambio es importante te avisamos por correo o dentro de la app antes de que entre en vigor.</p>

<h2 id="ley">10. Ley aplicable</h2>
<p>Estos terminos se rigen por las leyes de los Estados Unidos Mexicanos.</p>

<h2 id="contacto-legal">11. Contacto</h2>
<p>Dudas sobre estos terminos: <a href="mailto:soporte@nexoposoficial.com">soporte@nexoposoficial.com</a> -- o desde la misma app, en Nexo Market → <a href="/market/ayuda">Ayuda</a>.</p>
</article>
</main>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
</body>
</html>`;
}

async function servirMarketAyuda(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaMarketAyudaHtml());
}

async function servirMarketVender(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaMarketVenderHtml());
}

async function servirMarketTerminos(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaMarketTerminosHtml());
}

module.exports = { servirMarketAyuda, servirMarketVender, servirMarketTerminos };

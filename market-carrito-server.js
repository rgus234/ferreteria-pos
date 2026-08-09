// Nexo Market -- /market/carrito y /market/checkout (Fase 1
// "arquitectura de navegacion del comprador", ver plan). No existe
// carrito unificado en el servidor -- cada tienda sigue guardando el
// suyo en localStorage (nexoCarrito_{slug}, ver scriptCarritoTenantHtml
// en public-site-server.js), asi que estas paginas son honestas sobre
// esa realidad: agrupan por tienda lo que YA hay en el navegador, y el
// envio real sigue siendo el mismo POST por tienda que ya existe
// (/market/ferreteria/{slug}/catalogo/pedido-carrito). No hay pago --
// no se inventa un checkout unificado que no tiene backend detras.

const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml } = require("./market-server");

const ESTILOS_CARRITO_MARKET = `
.market-carrito-scope{ max-width:920px; margin:0 auto; padding:32px clamp(18px,4vw,48px) 60px; }
.market-carrito-grupo{ margin-bottom:22px; padding:20px 22px; border-radius:18px; background:var(--glass); border:1px solid var(--line); }
.market-carrito-grupo-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.market-carrito-grupo-header h3{ margin:0; font-size:15.5px; }
.market-carrito-item{ display:flex; justify-content:space-between; padding:8px 0; border-top:1px solid var(--line); font-size:13.5px; }
.market-carrito-item:first-child{ border-top:none; }
.market-carrito-vacio{ color:var(--muted); font-size:14px; text-align:center; padding:40px 0; }
.market-checkout-form{ display:grid; gap:14px; max-width:460px; margin:0 auto; }
.market-checkout-form label{ display:grid; gap:6px; font-size:13px; font-weight:700; color:var(--muted); }
.market-checkout-form input, .market-checkout-form textarea{ padding:10px 12px; border-radius:10px; border:1px solid var(--line); font-size:13.5px; font-family:inherit; }
.market-checkout-botones{ display:flex; gap:10px; flex-wrap:wrap; }
`;

function cabezaCarritoMarketHtml(titulo) {
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} -- Nexo Market</title>
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}</style>
<style>${ESTILOS_CARRITO_MARKET}</style>`;
}

function paginaCarritoMarketHtml() {
    return `<!doctype html>
<html lang="es">
<head>
${cabezaCarritoMarketHtml("Tu carrito")}
</head>
<body>
${marketHeaderHtml({})}
<div class="market-carrito-scope">
<h1 style="font-size:22px;">Tu carrito</h1>
<div id="marketCarritoLista"><p class="market-carrito-vacio">Cargando...</p></div>
</div>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>${scriptCarritoListaMarketHtml()}</script>
</body>
</html>`;
}

function scriptCarritoListaMarketHtml() {
    return `
function marketCarritoEscapar(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function marketCarritoLeerTodos() {
    const grupos = [];
    for (let i = 0; i < localStorage.length; i++) {
        const clave = localStorage.key(i);
        if (!clave || clave.indexOf("nexoCarrito_") !== 0) continue;
        let items = [];
        try { items = JSON.parse(localStorage.getItem(clave) || "[]"); } catch (error) { items = []; }
        if (!Array.isArray(items) || items.length === 0) continue;
        grupos.push({ slug: clave.slice("nexoCarrito_".length), items: items });
    }
    return grupos;
}

async function marketCarritoCargar() {
    const contenedor = document.getElementById("marketCarritoLista");
    const grupos = marketCarritoLeerTodos();

    if (grupos.length === 0) {
        contenedor.innerHTML = "";
        contenedor.appendChild(Object.assign(document.createElement("p"), { className: "market-carrito-vacio", textContent: "Tu carrito esta vacio. Agrega productos desde cualquier tienda en Nexo Market." }));
        return;
    }

    const respuesta = await fetch("/market/carrito-tiendas-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: grupos.map(function(g) { return g.slug; }) })
    });
    const datos = await respuesta.json();
    const nombresPorSlug = {};
    (datos.ok ? datos.tiendas : []).forEach(function(t) { nombresPorSlug[t.slug] = t.nombre; });

    contenedor.innerHTML = "";
    grupos.forEach(function(grupo) {
        const nombre = nombresPorSlug[grupo.slug];
        if (!nombre) return;

        const total = grupo.items.reduce(function(suma, it) { return suma + (Number(it.cantidad) || 0); }, 0);
        const bloque = document.createElement("div");
        bloque.className = "market-carrito-grupo";
        bloque.innerHTML =
            '<div class="market-carrito-grupo-header"><h3></h3><a class="btn primary" href=""></a></div>' +
            '<div class="market-carrito-items"></div>';
        bloque.querySelector("h3").textContent = nombre;
        const link = bloque.querySelector("a");
        link.textContent = "Continuar (" + total + ")";
        link.href = "/market/checkout?tienda=" + encodeURIComponent(grupo.slug);

        const lista = bloque.querySelector(".market-carrito-items");
        grupo.items.forEach(function(item) {
            const fila = document.createElement("div");
            fila.className = "market-carrito-item";
            fila.innerHTML = "<span></span><span></span>";
            fila.children[0].textContent = item.nombre || item.codigo;
            fila.children[1].textContent = "x" + (Number(item.cantidad) || 1);
            lista.appendChild(fila);
        });

        contenedor.appendChild(bloque);
    });

    if (!contenedor.children.length) {
        contenedor.appendChild(Object.assign(document.createElement("p"), { className: "market-carrito-vacio", textContent: "Tu carrito esta vacio. Agrega productos desde cualquier tienda en Nexo Market." }));
    }
}

marketCarritoCargar();
`;
}

function paginaCheckoutMarketHtml(slug) {
    const slugSeguro = JSON.stringify(String(slug || "")).replace(/<\//g, "<\\/");

    return `<!doctype html>
<html lang="es">
<head>
${cabezaCarritoMarketHtml("Finalizar pedido")}
</head>
<body>
${marketHeaderHtml({})}
<div class="market-carrito-scope">
<h1 style="font-size:22px;">Finalizar pedido</h1>
<div id="marketCheckoutResumen"><p class="market-carrito-vacio">Cargando...</p></div>
<form class="market-checkout-form" id="marketCheckoutForm" style="display:none; margin-top:22px;">
<div style="position:absolute; left:-9999px;" aria-hidden="true"><label>No llenar<input type="text" id="checkoutHoneypot" tabindex="-1" autocomplete="off"></label></div>
<label>Tu nombre<input type="text" id="checkoutNombre" maxlength="140" required></label>
<label>Telefono<input type="text" id="checkoutTelefono" maxlength="40" placeholder="10 digitos"></label>
<label>Correo (opcional)<input type="text" id="checkoutCorreo" maxlength="140"></label>
<label>Mensaje (opcional)<textarea id="checkoutMensaje" maxlength="500" rows="3"></textarea></label>
<p id="marketCheckoutAviso" style="color:#e2434d; font-size:13px; margin:0;"></p>
<div class="market-checkout-botones">
<button class="btn primary" type="submit" data-tipo="pedido">Enviar pedido</button>
<button class="btn secondary" type="submit" data-tipo="cotizacion">Solicitar cotizacion</button>
</div>
</form>
<div id="marketCheckoutExito" style="display:none;"></div>
</div>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>window.NEXO_CHECKOUT_SLUG = ${slugSeguro};</script>
<script>${scriptCheckoutMarketHtml()}</script>
</body>
</html>`;
}

function scriptCheckoutMarketHtml() {
    return `
function marketCheckoutLeerCarrito(slug) {
    try {
        const datos = JSON.parse(localStorage.getItem("nexoCarrito_" + slug) || "[]");
        return Array.isArray(datos) ? datos : [];
    } catch (error) { return []; }
}

(function marketCheckoutInicio() {
    const slug = window.NEXO_CHECKOUT_SLUG;
    const resumen = document.getElementById("marketCheckoutResumen");

    if (!slug) {
        resumen.innerHTML = "";
        resumen.appendChild(Object.assign(document.createElement("p"), { className: "market-carrito-vacio", textContent: "Elige una tienda desde tu carrito para continuar." }));
        const link = document.createElement("a");
        link.className = "btn primary";
        link.href = "/market/carrito";
        link.textContent = "Ver mi carrito";
        resumen.appendChild(link);
        return;
    }

    const items = marketCheckoutLeerCarrito(slug);
    if (items.length === 0) {
        resumen.innerHTML = "";
        resumen.appendChild(Object.assign(document.createElement("p"), { className: "market-carrito-vacio", textContent: "Ya no hay productos de esta tienda en tu carrito." }));
        return;
    }

    resumen.innerHTML = "";
    const lista = document.createElement("div");
    lista.className = "market-carrito-grupo";
    items.forEach(function(item) {
        const fila = document.createElement("div");
        fila.className = "market-carrito-item";
        fila.innerHTML = "<span></span><span></span>";
        fila.children[0].textContent = item.nombre || item.codigo;
        fila.children[1].textContent = "x" + (Number(item.cantidad) || 1);
        lista.appendChild(fila);
    });
    resumen.appendChild(lista);
    document.getElementById("marketCheckoutForm").style.display = "grid";

    document.getElementById("marketCheckoutForm").addEventListener("submit", async function(evento) {
        evento.preventDefault();
        const aviso = document.getElementById("marketCheckoutAviso");
        aviso.textContent = "";
        const tipo = evento.submitter && evento.submitter.dataset && evento.submitter.dataset.tipo === "cotizacion" ? "cotizacion" : "pedido";

        const body = {
            items: marketCheckoutLeerCarrito(slug).map(function(it) { return { codigo: it.codigo, cantidad: it.cantidad }; }),
            clienteNombre: document.getElementById("checkoutNombre").value.trim(),
            clienteTelefono: document.getElementById("checkoutTelefono").value.trim(),
            clienteCorreo: document.getElementById("checkoutCorreo").value.trim(),
            mensaje: document.getElementById("checkoutMensaje").value.trim(),
            sitioExtra: document.getElementById("checkoutHoneypot").value,
            tipo: tipo
        };

        try {
            const respuesta = await fetch("/market/ferreteria/" + encodeURIComponent(slug) + "/catalogo/pedido-carrito", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const datos = await respuesta.json();
            if (!datos.ok) { aviso.textContent = datos.error || "No se pudo enviar el pedido."; return; }

            localStorage.removeItem("nexoCarrito_" + slug);
            document.getElementById("marketCheckoutForm").style.display = "none";
            resumen.style.display = "none";
            const exito = document.getElementById("marketCheckoutExito");
            exito.style.display = "";
            exito.innerHTML = "";
            const p = document.createElement("p");
            p.textContent = tipo === "cotizacion" ? "Solicitud enviada. La tienda te va a contactar con el precio." : "Pedido enviado. La tienda te va a contactar para confirmar.";
            exito.appendChild(p);
            const link = document.createElement("a");
            link.className = "btn secondary";
            link.href = "/market/ferreteria/" + encodeURIComponent(slug);
            link.textContent = "Volver a la tienda";
            exito.appendChild(link);
        } catch (error) {
            aviso.textContent = "No se pudo enviar el pedido. Intenta de nuevo.";
        }
    });
})();
`;
}

async function servirCarritoMarket(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaCarritoMarketHtml());
}

async function servirCheckoutMarket(req, res) {
    const slug = String(req.query.tienda || "").trim().slice(0, 120);
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaCheckoutMarketHtml(slug));
}

module.exports = { servirCarritoMarket, servirCheckoutMarket };

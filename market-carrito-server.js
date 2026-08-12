// Nexo Market -- /market/carrito y /market/checkout (Fase 1
// "arquitectura de navegacion del comprador", ver plan). No existe
// carrito unificado en el servidor -- cada tienda sigue guardando el
// suyo en localStorage (nexoCarrito_{slug}, ver scriptCarritoTenantHtml
// en public-site-server.js), asi que estas paginas son honestas sobre
// esa realidad: agrupan por tienda lo que YA hay en el navegador, y el
// envio real sigue siendo el mismo POST por tienda que ya existe
// (/market/ferreteria/{slug}/catalogo/pedido-carrito). No hay pago --
// no se inventa un checkout unificado que no tiene backend detras.

const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml, metaInstalableMarketHtml } = require("./market-server");

const ESTILOS_CARRITO_MARKET = `
.market-carrito-scope{ max-width:1200px; margin:0 auto; padding:28px clamp(18px,4vw,48px) 60px; }
.market-carrito-titulo{ font-size:24px; margin:0 0 20px; }

/* Usadas por /market/checkout (paginaCheckoutMarketHtml/scriptCheckoutMarketHtml) --
   no tocar sin revisar ese flujo tambien. */
.market-carrito-grupo{ margin-bottom:22px; padding:20px 22px; border-radius:18px; background:var(--glass); border:1px solid var(--line); }
.market-carrito-grupo-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.market-carrito-grupo-header h3{ margin:0; font-size:15.5px; }
.market-carrito-item{ display:flex; justify-content:space-between; padding:8px 0; border-top:1px solid var(--line); font-size:13.5px; }
.market-carrito-item:first-child{ border-top:none; }
.market-checkout-form{ display:grid; gap:14px; max-width:460px; margin:0 auto; }
.market-checkout-form label{ display:grid; gap:6px; font-size:13px; font-weight:700; color:var(--muted); }
.market-checkout-form input, .market-checkout-form textarea{ padding:10px 12px; border-radius:10px; border:1px solid var(--line); font-size:13.5px; font-family:inherit; }
.market-checkout-botones{ display:flex; gap:10px; flex-wrap:wrap; }
.market-checkout-disponibilidad{ margin:0; padding:10px 14px; border-radius:10px; font-size:13px; font-weight:700; background:rgba(24,184,143,.12); color:var(--mint); }
.market-checkout-disponibilidad.incierto{ background:rgba(230,162,60,.14); color:var(--amber); }
.market-checkout-entrega{ display:grid; gap:8px; padding:14px 16px; border-radius:12px; border:1px solid var(--line); background:var(--paper); }
.market-checkout-entrega > span{ font-size:13px; font-weight:700; color:var(--muted); }
.market-checkout-entrega-opcion{ display:flex; align-items:center; gap:8px; font-size:13.5px; font-weight:600; }

.market-carrito-vacio{ color:var(--muted); font-size:14px; text-align:center; padding:60px 0; display:grid; gap:16px; justify-items:center; }

/* Rediseno tipo Amazon de /market/carrito (lista de productos con foto/precio real) */
.market-carrito-layout{ display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:24px; align-items:start; }
.market-carrito-tienda-card{ margin-bottom:20px; padding:20px 22px; border-radius:18px; background:#fff; border:1px solid var(--line); box-shadow:0 14px 36px rgba(20,32,51,.06); }
.market-carrito-tienda-card:last-child{ margin-bottom:0; }
.market-carrito-tienda-header{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; padding-bottom:14px; border-bottom:1px solid var(--line); }
.market-carrito-tienda-header a{ font-weight:900; font-size:15.5px; color:var(--ink); }
.market-carrito-tienda-header a:hover{ color:var(--blue); }
.market-cart-item-fila{ display:grid; grid-template-columns:140px 1fr; gap:18px; padding:18px 0; border-bottom:1px solid var(--line); }
.market-cart-item-fila:last-child{ border-bottom:none; padding-bottom:0; }
.market-cart-item-foto{ width:140px; aspect-ratio:1/1; border-radius:12px; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden; color:var(--muted); }
.market-cart-item-foto img{ width:100%; height:100%; object-fit:cover; }
.market-cart-item-foto svg{ width:34px; height:34px; }
.market-cart-item-info{ display:flex; flex-direction:column; gap:6px; min-width:0; }
.market-cart-item-nombre{ font-weight:800; font-size:14.5px; line-height:1.35; color:var(--ink); }
.market-cart-item-precios{ display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.market-cart-item-acciones{ display:flex; align-items:center; gap:16px; margin-top:6px; flex-wrap:wrap; }
.market-cart-item-cantidad{ display:flex; align-items:center; gap:6px; font-size:13px; color:var(--muted); }
.market-cart-item-cantidad input{ width:56px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; font:inherit; font-size:13px; }
.market-cart-item-eliminar{ border:none; background:none; color:var(--blue); font-weight:700; font-size:13px; cursor:pointer; padding:0; }
.market-cart-item-eliminar:hover{ text-decoration:underline; }
.market-carrito-resumen-columna{ display:grid; gap:20px; position:sticky; top:150px; }
.market-carrito-resumen{ padding:20px 22px; border-radius:18px; background:var(--glass); border:1px solid var(--line); display:grid; gap:12px; }
.market-carrito-resumen h3{ margin:0; font-size:15px; }
.market-carrito-resumen-linea{ display:flex; justify-content:space-between; gap:10px; font-size:13.5px; color:var(--muted); }
.market-carrito-resumen-linea.ahorro{ color:var(--mint); font-weight:700; }
.market-carrito-resumen-total{ display:flex; justify-content:space-between; gap:10px; font-size:16px; font-weight:900; color:var(--ink); padding-top:10px; border-top:1px solid var(--line); }
.market-carrito-resumen-nota{ margin:0; font-size:12px; color:var(--muted); }
.market-carrito-resumen .btn{ width:100%; }
@media (max-width:860px){
  .market-carrito-layout{ grid-template-columns:1fr; }
  .market-carrito-resumen-columna{ position:static; }
}
@media (max-width:520px){
  .market-cart-item-fila{ grid-template-columns:96px 1fr; }
  .market-cart-item-foto{ width:96px; }
}
`;

function cabezaCarritoMarketHtml(titulo) {
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} -- Nexo Market</title>
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
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
<h1 class="market-carrito-titulo" id="marketCarritoTitulo">Tu carrito</h1>
<div id="marketCarritoLista"><p class="market-carrito-vacio">Cargando...</p></div>
<section class="market-seccion" id="marketCarritoRelacionados" style="display:none;">
<div class="market-seccion-header"><h3>También te puede interesar</h3></div>
<div class="market-productos-grid" id="marketCarritoRelacionadosGrid"></div>
</section>
</div>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>${scriptCarritoListaMarketHtml()}</script>
</body>
</html>`;
}

// Rediseno tipo Amazon (foto/precio/oferta/existencia reales, resumen por
// tienda, "Tambien te puede interesar") -- ver plan. marketCarritoEstado
// guarda en memoria lo que ya resolvio el servidor (slug:codigo -> producto)
// para que cambiar cantidad recalcule el resumen sin volver a pedir nada;
// solo "Eliminar" vuelve a cargar todo (mas simple y sigue siendo barato).
// Icono de foto generica copiado tal cual del que ya usa market-server.js
// (ICONO_FOTO_GENERICA) -- vive en un <script> de pagina distinto, no se
// puede importar, mismo criterio de "copiado, no importado" del resto del
// proyecto.
function scriptCarritoListaMarketHtml() {
    return `
var ICONO_FOTO_GENERICA_CARRITO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';
var marketCarritoEstado = {};

function marketCarritoEscapar(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function marketCarritoFormatoDinero(numero) {
    return "$" + Number(numero).toFixed(2);
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

function marketCarritoVacioHtml() {
    return '<div class="market-carrito-vacio"><p>Tu carrito esta vacio. Agrega productos desde cualquier tienda en Nexo Market.</p><a class="btn primary" href="/market">Ir a Nexo Market</a></div>';
}

function marketCarritoBloquePrecioHtml(p) {
    const tieneOferta = p.precioOferta !== null && p.precioOferta !== undefined
        && p.precio !== null && p.precio !== undefined && p.precioOferta < p.precio;

    if (tieneOferta) {
        const descuento = Math.round((1 - (p.precioOferta / p.precio)) * 100);
        return '<span class="market-precio-actual">' + marketCarritoFormatoDinero(p.precioOferta) + '</span>' +
            '<span class="market-producto-precio-tachado">' + marketCarritoFormatoDinero(p.precio) + '</span>' +
            (descuento > 0 ? '<span class="market-producto-badge-oferta">-' + descuento + '%</span>' : '');
    }

    if (p.precio !== null && p.precio !== undefined) {
        return '<span class="market-precio-actual">' + marketCarritoFormatoDinero(p.precio) + '</span>';
    }

    return '';
}

function marketCarritoExistenciaHtml(p) {
    if (p.stock === null || p.stock === undefined) {
        return '<span class="market-producto-existencia bajo-pedido">Bajo pedido -- confirma con la tienda</span>';
    }
    return '<span class="market-producto-existencia' + (p.stock <= 0 ? ' agotado' : '') + '">' +
        (p.stock <= 0 ? 'Agotado' : p.stock + ' disponibles') + '</span>';
}

function marketCarritoEnlaceProducto(p) {
    return '/market/ferreteria/' + encodeURIComponent(p.slug) + '/catalogo/' + encodeURIComponent(p.codigo);
}

function marketCarritoFilaProductoHtml(p) {
    const fotoHtml = p.fotoUrl ? '<img src="' + p.fotoUrl + '" alt="" loading="lazy">' : ICONO_FOTO_GENERICA_CARRITO;
    const link = marketCarritoEnlaceProducto(p);

    return '<div class="market-cart-item-fila" data-slug="' + marketCarritoEscapar(p.slug) + '" data-codigo="' + marketCarritoEscapar(p.codigo) + '">' +
        '<a class="market-cart-item-foto" href="' + link + '">' + fotoHtml + '</a>' +
        '<div class="market-cart-item-info">' +
        '<a class="market-cart-item-nombre" href="' + link + '">' + marketCarritoEscapar(p.nombre) + '</a>' +
        '<div class="market-cart-item-precios">' + marketCarritoBloquePrecioHtml(p) + '</div>' +
        marketCarritoExistenciaHtml(p) +
        '<div class="market-cart-item-acciones">' +
        '<label class="market-cart-item-cantidad">Cantidad <input type="number" min="1" max="9999" value="' + p.cantidad + '" class="marketCarritoCantidadInput"></label>' +
        '<button type="button" class="market-cart-item-eliminar">Eliminar</button>' +
        '</div>' +
        '</div>' +
        '</div>';
}

function marketCarritoTarjetaTiendaHtml(slug, items) {
    const tienda = items[0].tienda;
    return '<div class="market-carrito-tienda-card">' +
        '<div class="market-carrito-tienda-header"><a href="/market/ferreteria/' + encodeURIComponent(slug) + '">' + marketCarritoEscapar(tienda) + '</a></div>' +
        items.map(marketCarritoFilaProductoHtml).join('') +
        '</div>';
}

// Texto honesto de politica de envio segun lo que el dueno declaro en
// Sitio web -- todos los productos de una misma tienda comparten el
// mismo envioModo (viene del JOIN a sitio_web_config, no de
// productos), asi que tomar el primer item es seguro. Mismo criterio
// que lineaEnvioHtml en public-site-server.js, copiado en vez de
// importado por ser una funcion chica (ver plan "Politica de envio
// por tienda").
function marketCarritoNotaEnvioHtml(item) {
    if (item.envioModo === 'solo_recoleccion') {
        return 'Esta tienda solo entrega en su local -- no hace envios.';
    }
    if (item.envioModo === 'tarifa_fija' && item.envioTarifa !== null && item.envioTarifa !== undefined) {
        const notas = item.envioNotas ? ' ' + marketCarritoEscapar(item.envioNotas) : '';
        return 'Envio con costo fijo: ' + marketCarritoFormatoDinero(item.envioTarifa) + '.' + notas;
    }
    return 'El envio se coordina directamente con la tienda.';
}

function marketCarritoResumenTiendaHtml(slug, items) {
    const tienda = items[0].tienda;
    const conPrecio = items.every(function(p) { return p.precio !== null && p.precio !== undefined; });
    const totalUnidades = items.reduce(function(suma, p) { return suma + p.cantidad; }, 0);

    let cuerpo;
    if (!conPrecio) {
        cuerpo = '<p class="market-carrito-resumen-nota">Esta tienda no publica precios en linea -- consulta directo con ' + marketCarritoEscapar(tienda) + '.</p>';
    } else {
        const subtotal = items.reduce(function(suma, p) { return suma + (p.precioOferta !== null && p.precioOferta !== undefined ? p.precioOferta : p.precio) * p.cantidad; }, 0);
        const ahorro = items.reduce(function(suma, p) { return suma + (p.precioOferta !== null && p.precioOferta !== undefined ? (p.precio - p.precioOferta) * p.cantidad : 0); }, 0);

        cuerpo =
            '<div class="market-carrito-resumen-linea"><span>Subtotal (' + totalUnidades + ' ' + (totalUnidades === 1 ? 'producto' : 'productos') + ')</span><span>' + marketCarritoFormatoDinero(subtotal) + '</span></div>' +
            (ahorro > 0 ? '<div class="market-carrito-resumen-linea ahorro"><span>Ahorras</span><span>-' + marketCarritoFormatoDinero(ahorro) + '</span></div>' : '') +
            '<div class="market-carrito-resumen-total"><span>Total estimado</span><span>' + marketCarritoFormatoDinero(subtotal) + '</span></div>';
    }

    return '<div class="market-carrito-resumen" data-tienda-resumen="' + marketCarritoEscapar(slug) + '">' +
        '<h3>' + marketCarritoEscapar(tienda) + '</h3>' +
        cuerpo +
        '<p class="market-carrito-resumen-nota">' + marketCarritoNotaEnvioHtml(items[0]) + '</p>' +
        '<a class="btn primary" href="/market/checkout?tienda=' + encodeURIComponent(slug) + '">Continuar pedido</a>' +
        '</div>';
}

function marketCarritoRelacionadoTarjetaHtml(p) {
    const fotoHtml = p.fotoUrl ? '<img src="' + p.fotoUrl + '" alt="" loading="lazy">' : ICONO_FOTO_GENERICA_CARRITO;
    const link = marketCarritoEnlaceProducto(p);

    return '<div class="market-producto-card">' +
        '<a href="' + link + '" class="market-producto-foto">' + fotoHtml + '</a>' +
        '<span class="market-producto-nombre">' + marketCarritoEscapar(p.nombre) + '</span>' +
        '<span class="market-producto-precios">' + marketCarritoBloquePrecioHtml(p) + '</span>' +
        marketCarritoExistenciaHtml(p) +
        '<span class="market-producto-tienda">' + marketCarritoEscapar(p.tienda) + '</span>' +
        '<a class="btn primary" href="' + link + '">Ver en ' + marketCarritoEscapar(p.tienda) + '</a>' +
        '</div>';
}

function marketCarritoPintarRelacionados(relacionados) {
    const seccion = document.getElementById("marketCarritoRelacionados");
    const grid = document.getElementById("marketCarritoRelacionadosGrid");
    if (!relacionados || relacionados.length === 0) { seccion.style.display = "none"; return; }
    grid.innerHTML = relacionados.map(marketCarritoRelacionadoTarjetaHtml).join('');
    seccion.style.display = "";
}

function marketCarritoRecalcularResumenTienda(slug) {
    const items = Object.keys(marketCarritoEstado)
        .filter(function(clave) { return clave.indexOf(slug + ":") === 0; })
        .map(function(clave) { return marketCarritoEstado[clave]; });
    const contenedorResumen = document.querySelector('[data-tienda-resumen="' + slug.replace(/"/g, '\\\\"') + '"]');
    if (contenedorResumen && items.length) contenedorResumen.outerHTML = marketCarritoResumenTiendaHtml(slug, items);
}

function marketCarritoCambiarCantidad(slug, codigo, valor) {
    const cantidad = Math.min(9999, Math.max(1, parseInt(valor, 10) || 1));
    const items = JSON.parse(localStorage.getItem("nexoCarrito_" + slug) || "[]");
    const item = items.find(function(it) { return it.codigo === codigo; });
    if (item) {
        item.cantidad = cantidad;
        localStorage.setItem("nexoCarrito_" + slug, JSON.stringify(items));
    }

    const clave = slug + ":" + codigo;
    if (marketCarritoEstado[clave]) marketCarritoEstado[clave].cantidad = cantidad;
    marketCarritoRecalcularResumenTienda(slug);
}

function marketCarritoEliminar(slug, codigo) {
    const items = JSON.parse(localStorage.getItem("nexoCarrito_" + slug) || "[]").filter(function(it) { return it.codigo !== codigo; });
    if (items.length) localStorage.setItem("nexoCarrito_" + slug, JSON.stringify(items));
    else localStorage.removeItem("nexoCarrito_" + slug);
    marketCarritoCargar();
}

function marketCarritoEngancharEventos() {
    document.querySelectorAll(".marketCarritoCantidadInput").forEach(function(input) {
        input.addEventListener("change", function() {
            const fila = input.closest(".market-cart-item-fila");
            marketCarritoCambiarCantidad(fila.dataset.slug, fila.dataset.codigo, input.value);
        });
    });
    document.querySelectorAll(".market-cart-item-eliminar").forEach(function(boton) {
        boton.addEventListener("click", function() {
            const fila = boton.closest(".market-cart-item-fila");
            marketCarritoEliminar(fila.dataset.slug, fila.dataset.codigo);
        });
    });
}

async function marketCarritoCargar() {
    const contenedor = document.getElementById("marketCarritoLista");
    const titulo = document.getElementById("marketCarritoTitulo");
    const grupos = marketCarritoLeerTodos();

    if (grupos.length === 0) {
        titulo.textContent = "Tu carrito";
        contenedor.innerHTML = marketCarritoVacioHtml();
        marketCarritoPintarRelacionados([]);
        return;
    }

    const itemsPlano = [];
    grupos.forEach(function(g) {
        g.items.forEach(function(it) { itemsPlano.push({ slug: g.slug, codigo: it.codigo, cantidad: it.cantidad }); });
    });

    let datos;
    try {
        const respuesta = await fetch("/market/carrito-productos-json", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: itemsPlano })
        });
        datos = await respuesta.json();
    } catch (error) {
        datos = { ok: false };
    }

    const productos = (datos && datos.ok) ? datos.productos : [];
    const relacionados = (datos && datos.ok) ? datos.relacionados : [];

    if (productos.length === 0) {
        titulo.textContent = "Tu carrito";
        contenedor.innerHTML = marketCarritoVacioHtml();
        marketCarritoPintarRelacionados([]);
        return;
    }

    marketCarritoEstado = {};
    productos.forEach(function(p) { marketCarritoEstado[p.slug + ":" + p.codigo] = p; });

    const porTienda = {};
    const ordenTiendas = [];
    productos.forEach(function(p) {
        if (!porTienda[p.slug]) { porTienda[p.slug] = []; ordenTiendas.push(p.slug); }
        porTienda[p.slug].push(p);
    });

    const totalUnidades = productos.reduce(function(suma, p) { return suma + p.cantidad; }, 0);
    titulo.textContent = "Tu carrito (" + totalUnidades + (totalUnidades === 1 ? " producto)" : " productos)");

    let columnaProductosHtml = "";
    let columnaResumenHtml = "";
    ordenTiendas.forEach(function(slug) {
        const items = porTienda[slug];
        columnaProductosHtml += marketCarritoTarjetaTiendaHtml(slug, items);
        columnaResumenHtml += marketCarritoResumenTiendaHtml(slug, items);
    });

    contenedor.innerHTML =
        '<div class="market-carrito-layout">' +
        '<div class="market-carrito-productos">' + columnaProductosHtml + '</div>' +
        '<div class="market-carrito-resumen-columna">' + columnaResumenHtml + '</div>' +
        '</div>';

    marketCarritoEngancharEventos();
    marketCarritoPintarRelacionados(relacionados);
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
<div class="market-checkout-entrega" id="marketCheckoutEntrega" hidden>
<span>Como quieres recibirlo?</span>
<label class="market-checkout-entrega-opcion"><input type="radio" name="entrega" value="recoleccion" checked> Recoger en tienda</label>
<label class="market-checkout-entrega-opcion" id="marketCheckoutEntregaDomicilioWrap" hidden><input type="radio" name="entrega" value="domicilio"> <span id="marketCheckoutEntregaDomicilioTexto">Domicilio</span></label>
</div>
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
function marketCarritoFormatoDinero(numero) {
    return "$" + Number(numero).toFixed(2);
}

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

    // Consulta el stock real (mismo endpoint que ya usa /market/carrito)
    // para saber si todo el pedido esta disponible en tienda o si algo
    // esta bajo pedido/sin existencia confirmada -- orienta al cliente
    // sobre cual boton conviene usar, sin cambiar el "tipo" que se manda
    // al servidor.
    fetch("/market/carrito-productos-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map(function(it) { return { slug: slug, codigo: it.codigo, cantidad: it.cantidad }; }) })
    }).then(function(r) { return r.json(); }).catch(function() { return { ok: false }; }).then(function(datos) {
        const productos = (datos && datos.ok) ? datos.productos : [];
        if (productos.length === 0) return;

        const todoDisponible = productos.every(function(p) { return p.stock !== null && p.stock !== undefined && p.stock > 0; });
        const algunoIncierto = productos.some(function(p) { return p.stock === null || p.stock === undefined || p.stock <= 0; });

        const aviso = document.createElement("p");
        aviso.className = "market-checkout-disponibilidad" + (algunoIncierto ? " incierto" : "");
        aviso.textContent = todoDisponible
            ? "Todos los productos de tu pedido estan disponibles en tienda. Puedes enviar tu pedido directo."
            : "Uno o mas productos estan bajo pedido o sin existencia confirmada -- te recomendamos solicitar cotizacion primero para confirmar con la tienda.";

        const contenedorBotones = document.querySelector(".market-checkout-botones");
        const botonPedido = contenedorBotones.querySelector('[data-tipo="pedido"]');
        const botonCotizacion = contenedorBotones.querySelector('[data-tipo="cotizacion"]');
        contenedorBotones.parentNode.insertBefore(aviso, contenedorBotones);

        // Recoger en tienda / domicilio -- solo se ofrece "Domicilio" si la
        // tienda lo tiene habilitado en Sitio web (envioModo), mismo
        // criterio ya usado para la nota informativa de /market/carrito.
        const envioModo = productos[0].envioModo;
        const entregaBloque = document.getElementById("marketCheckoutEntrega");
        const domicilioWrap = document.getElementById("marketCheckoutEntregaDomicilioWrap");
        const domicilioTexto = document.getElementById("marketCheckoutEntregaDomicilioTexto");
        entregaBloque.hidden = false;
        if (envioModo === "solo_recoleccion") {
            domicilioWrap.hidden = true;
        } else {
            domicilioWrap.hidden = false;
            if (envioModo === "tarifa_fija" && productos[0].envioTarifa !== null && productos[0].envioTarifa !== undefined) {
                domicilioTexto.textContent = "Domicilio (costo fijo: " + marketCarritoFormatoDinero(productos[0].envioTarifa) + ")";
            } else {
                domicilioTexto.textContent = "Domicilio (se coordina con la tienda)";
            }
        }

        if (todoDisponible) {
            botonPedido.textContent = "Realizar pedido";
            botonPedido.className = "btn primary";
            botonCotizacion.className = "btn secondary";
            contenedorBotones.appendChild(botonPedido);
            contenedorBotones.appendChild(botonCotizacion);
        } else {
            botonCotizacion.textContent = "Solicitar pedido (sujeto a confirmacion)";
            botonCotizacion.className = "btn primary";
            botonPedido.className = "btn secondary";
            contenedorBotones.appendChild(botonCotizacion);
            contenedorBotones.appendChild(botonPedido);
        }
    });

    document.getElementById("marketCheckoutForm").addEventListener("submit", async function(evento) {
        evento.preventDefault();
        const aviso = document.getElementById("marketCheckoutAviso");
        aviso.textContent = "";
        const tipo = evento.submitter && evento.submitter.dataset && evento.submitter.dataset.tipo === "cotizacion" ? "cotizacion" : "pedido";
        const entregaInput = document.querySelector('input[name="entrega"]:checked');

        const body = {
            items: marketCheckoutLeerCarrito(slug).map(function(it) { return { codigo: it.codigo, cantidad: it.cantidad }; }),
            clienteNombre: document.getElementById("checkoutNombre").value.trim(),
            clienteTelefono: document.getElementById("checkoutTelefono").value.trim(),
            clienteCorreo: document.getElementById("checkoutCorreo").value.trim(),
            mensaje: document.getElementById("checkoutMensaje").value.trim(),
            sitioExtra: document.getElementById("checkoutHoneypot").value,
            tipo: tipo,
            entrega: entregaInput ? entregaInput.value : null
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

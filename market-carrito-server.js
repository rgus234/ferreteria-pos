// Nexo Market -- /market/carrito y /market/checkout (Fase 1
// "arquitectura de navegacion del comprador", ver plan). No existe
// carrito unificado en el servidor -- cada tienda sigue guardando el
// suyo en localStorage (nexoCarrito_{slug}, ver scriptCarritoTenantHtml
// en public-site-server.js), asi que estas paginas son honestas sobre
// esa realidad: agrupan por tienda lo que YA hay en el navegador, y el
// envio real sigue siendo el mismo POST por tienda que ya existe
// (/market/ferreteria/{slug}/catalogo/pedido-carrito). El pago real
// (Stripe Connect, ver plan "Nexo Market: pagos reales con Stripe
// Connect") se agrega en el checkout SOLO cuando la tienda tiene cobros
// activos (stripe-connect-server.js) -- si no, sigue el flujo de
// pedido/cotizacion sin cobro de siempre, sin romper nada.

const { config } = require("./config");
const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml, metaInstalableMarketHtml } = require("./market-server");
const { crearResolverSesionPersonaOpcional } = require("./personas-server");

function escaparHtmlAtributo(valor) {
    return String(valor == null ? "" : valor)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
.market-checkout-pago{ display:grid; gap:8px; padding:14px 16px; border-radius:12px; border:1px solid var(--line); background:var(--paper); }
.market-checkout-pago > span{ font-size:13px; font-weight:700; color:var(--muted); }

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

/* Rediseno de /market/checkout -- referencia visual dada por el dueno
   (4 pasos, tarjetas, columna lateral con resumen). El asistente solo
   tiene 2 pantallas reales (info+recoger fusionadas, y resumen) -- los
   pasos "Recoger" y "Confirmacion" del indicador son visuales (2 se
   marca alcanzado al avanzar, 4 es la pagina de seguimiento a la que
   se redirige tras enviar, ver /market/pedido/:codigo). */
.market-checkout-scope{ max-width:1080px; }
.market-checkout-volver{ display:inline-block; margin-bottom:14px; font-size:13px; font-weight:700; color:var(--blue); }
.market-checkout-pasos{ display:flex; align-items:center; gap:10px; margin:18px 0 26px; flex-wrap:wrap; }
.market-checkout-paso{ display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:700; color:var(--muted); }
.market-checkout-paso-num{ width:26px; height:26px; border-radius:999px; border:2px solid var(--line); display:flex; align-items:center; justify-content:center; font-size:12px; flex:0 0 auto; }
.market-checkout-paso.activo{ color:var(--ink); }
.market-checkout-paso.activo .market-checkout-paso-num{ border-color:var(--blue); background:var(--blue); color:#fff; }
.market-checkout-paso.hecho .market-checkout-paso-num{ border-color:var(--mint); background:var(--mint); color:#fff; }
.market-checkout-paso-linea{ width:32px; height:2px; background:var(--line); flex:0 0 auto; }
.market-checkout-layout{ display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:24px; align-items:start; }
.market-checkout-columna-lateral{ display:grid; gap:20px; position:sticky; top:150px; }
.market-checkout-card{ padding:20px 22px; border-radius:18px; background:#fff; border:1px solid var(--line); margin-bottom:18px; }
.market-checkout-card:last-child{ margin-bottom:0; }
.market-checkout-card h2{ margin:0 0 14px; font-size:15.5px; display:flex; align-items:center; gap:8px; }
.market-checkout-campo-grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.market-checkout-check{ display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); font-weight:600; margin-top:10px; }
.market-checkout-recoger-tienda{ font-weight:900; font-size:14.5px; color:var(--ink); margin-bottom:4px; }
.market-checkout-recoger-linea{ display:flex; justify-content:space-between; gap:16px; padding:14px 0; border-top:1px solid var(--line); font-size:13px; }
.market-checkout-recoger-linea:first-of-type{ border-top:none; padding-top:0; }
.market-checkout-recoger-linea span:first-child{ color:var(--muted); }
.market-checkout-recoger-linea strong{ color:var(--ink); }
.market-checkout-recoger-aprox{ color:var(--blue); font-weight:800; }
.market-checkout-textarea-wrap{ position:relative; }
.market-checkout-contador{ position:absolute; right:10px; bottom:8px; font-size:11px; color:var(--muted); }
.market-checkout-actualiza-opcion{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border-radius:12px; border:1px solid var(--blue); background:rgba(16,103,232,.06); font-size:13.5px; font-weight:700; }
.market-checkout-actualiza-badge{ font-size:11px; font-weight:800; color:#fff; background:var(--mint); padding:2px 9px; border-radius:999px; }
.market-checkout-resumen-item{ display:flex; gap:14px; padding:14px 0; border-top:1px solid var(--line); }
.market-checkout-resumen-item:first-child{ border-top:none; padding-top:0; }
.market-checkout-resumen-foto{ width:64px; height:64px; border-radius:10px; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden; color:var(--muted); flex:0 0 auto; }
.market-checkout-resumen-foto img{ width:100%; height:100%; object-fit:cover; }
.market-checkout-resumen-info{ flex:1; min-width:0; display:grid; gap:2px; }
.market-checkout-resumen-info strong{ font-size:13.5px; line-height:1.35; }
.market-checkout-resumen-info small{ color:var(--muted); font-size:12px; }
.market-checkout-resumen-precio{ font-weight:900; font-size:13.5px; white-space:nowrap; }
.market-checkout-confianza{ display:grid; gap:10px; margin-top:16px; padding-top:16px; border-top:1px solid var(--line); }
.market-checkout-confianza-item{ display:flex; gap:10px; font-size:12.5px; }
.market-checkout-confianza-item strong{ display:block; font-size:13px; }
.market-checkout-confianza-item span{ color:var(--muted); }
.market-checkout-ayuda-card{ padding:18px 20px; border-radius:16px; background:var(--paper); border:1px solid var(--line); }
.market-checkout-ayuda-card h3{ margin:0 0 12px; font-size:14px; }
.market-checkout-ayuda-item{ display:flex; gap:10px; padding:10px 0; font-size:12.5px; color:var(--ink); border-top:1px solid var(--line); }
.market-checkout-ayuda-item:first-of-type{ border-top:none; padding-top:0; }
.market-checkout-ayuda-item a{ color:inherit; text-decoration:none; }
.market-checkout-ayuda-item a:hover{ color:var(--blue); }
.market-checkout-ayuda-item strong{ display:block; }
.market-checkout-ayuda-item span{ color:var(--muted); }
.market-checkout-revision-linea{ display:flex; justify-content:space-between; gap:14px; padding:8px 0; font-size:13px; border-top:1px solid var(--line); }
.market-checkout-revision-linea:first-child{ border-top:none; padding-top:0; }
.market-checkout-revision-linea span:first-child{ color:var(--muted); }
@media (max-width:860px){
  .market-checkout-layout{ grid-template-columns:1fr; }
  .market-checkout-columna-lateral{ position:static; }
  .market-checkout-campo-grid{ grid-template-columns:1fr; }
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

// Iconos SVG en linea, mismo criterio "copiado no importado" del resto
// del sitio -- solo los que este checkout necesita.
const ICONO_CHECKOUT_PERSONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg>';
const ICONO_CHECKOUT_TIENDA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M3 9l1-5h16l1 5"></path><path d="M4 9v10h16V9"></path><path d="M9 21v-6h6v6"></path></svg>';
const ICONO_CHECKOUT_MENSAJE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
const ICONO_CHECKOUT_CORREO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m2 7 10 6 10-6"></path></svg>';
const ICONO_CHECKOUT_ESCUDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"></path></svg>';
const ICONO_CHECKOUT_CANDADO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
const ICONO_CHECKOUT_CASA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="m3 9 9-7 9 7"></path><path d="M5 10v10h14V10"></path></svg>';
const ICONO_CHECKOUT_AYUDA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"></path><path d="M12 17h.01"></path></svg>';
const ICONO_CHECKOUT_WHATSAPP = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-3-.2-.3A8 8 0 1 1 12 20Zm4.4-6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.7.9-.3.2-.5.1a6.5 6.5 0 0 1-1.9-1.2 7.2 7.2 0 0 1-1.3-1.7c-.1-.2 0-.3.1-.4l.4-.4.2-.3v-.3l-.6-1.4c-.1-.4-.3-.3-.5-.3h-.4a.9.9 0 0 0-.6.3 2.6 2.6 0 0 0-.8 1.9 4.5 4.5 0 0 0 1 2.4 10.2 10.2 0 0 0 3.9 3.5c.5.2 1 .4 1.3.5a3.1 3.1 0 0 0 1.5.1 2.4 2.4 0 0 0 1.6-1.1 2 2 0 0 0 .1-1.1c-.1-.1-.2-.2-.4-.3Z"></path></svg>';

function paginaCheckoutMarketHtml(slug, persona) {
    const slugSeguro = JSON.stringify(String(slug || "")).replace(/<\//g, "<\\/");
    const valorNombre = persona?.nombre ? ` value="${escaparHtmlAtributo(persona.nombre)}"` : "";
    const valorTelefono = persona?.telefono ? ` value="${escaparHtmlAtributo(persona.telefono)}"` : "";
    const valorCorreo = persona?.correo ? ` value="${escaparHtmlAtributo(persona.correo)}"` : "";

    return `<!doctype html>
<html lang="es">
<head>
${cabezaCarritoMarketHtml("Finalizar pedido")}
</head>
<body>
${marketHeaderHtml({})}
<div class="market-carrito-scope market-checkout-scope">
<a class="market-checkout-volver" href="/market/carrito">&larr; Volver al carrito</a>
<h1 class="market-carrito-titulo">Finalizar pedido</h1>
<div class="market-checkout-pasos" id="marketCheckoutPasos">
<div class="market-checkout-paso" data-paso="info"><span class="market-checkout-paso-num">1</span>Informacion</div>
<div class="market-checkout-paso-linea"></div>
<div class="market-checkout-paso" data-paso="recoger"><span class="market-checkout-paso-num">2</span>Recoger</div>
<div class="market-checkout-paso-linea"></div>
<div class="market-checkout-paso" data-paso="resumen"><span class="market-checkout-paso-num">3</span>Resumen</div>
<div class="market-checkout-paso-linea"></div>
<div class="market-checkout-paso" data-paso="confirmacion"><span class="market-checkout-paso-num">4</span>Confirmacion</div>
</div>

<div id="marketCheckoutResumen"><p class="market-carrito-vacio">Cargando...</p></div>

<form id="marketCheckoutForm" style="display:none;">
<div style="position:absolute; left:-9999px;" aria-hidden="true"><label>No llenar<input type="text" id="checkoutHoneypot" tabindex="-1" autocomplete="off"></label></div>
<div class="market-checkout-layout">
<div>

<div class="market-checkout-pantalla" data-pantalla="info">

<div class="market-checkout-card">
<h2>${ICONO_CHECKOUT_PERSONA}Tus datos</h2>
<div class="market-checkout-campo-grid">
<label>Tu nombre<input type="text" id="checkoutNombre" maxlength="140" required${valorNombre}></label>
<label>Telefono<input type="text" id="checkoutTelefono" maxlength="40" placeholder="10 digitos"${valorTelefono}></label>
</div>
<div class="market-checkout-campo-grid" style="margin-top:14px;">
<label>Correo electronico<input type="text" id="checkoutCorreo" maxlength="140"${valorCorreo}></label>
</div>
<label class="market-checkout-check"><input type="checkbox" id="checkoutQuiereActualizaciones" checked> Quiero recibir actualizaciones de mi pedido por correo</label>
</div>

<div class="market-checkout-card" id="marketCheckoutRecogerCard" hidden>
<h2>${ICONO_CHECKOUT_TIENDA}Recoger en tienda</h2>
<div class="market-checkout-recoger-tienda" id="marketCheckoutTiendaNombre"></div>
<div class="market-checkout-recoger-linea" id="marketCheckoutTiendaDireccionLinea" hidden><span>Direccion</span><strong id="marketCheckoutTiendaDireccion"></strong></div>
<div class="market-checkout-recoger-linea"><span>Tiempo estimado de preparacion</span><strong id="marketCheckoutTiendaPrep"></strong></div>
<div class="market-checkout-recoger-linea"><span>Recogida aproximada</span><strong class="market-checkout-recoger-aprox" id="marketCheckoutTiendaRecogida"></strong></div>
<div class="market-checkout-entrega" id="marketCheckoutEntrega" hidden style="margin-top:14px;">
<span>Como quieres recibirlo?</span>
<label class="market-checkout-entrega-opcion"><input type="radio" name="entrega" value="recoleccion" checked> Recoger en tienda</label>
<label class="market-checkout-entrega-opcion" id="marketCheckoutEntregaDomicilioWrap" hidden><input type="radio" name="entrega" value="domicilio"> <span id="marketCheckoutEntregaDomicilioTexto">Domicilio</span></label>
</div>
</div>

<div class="market-checkout-card">
<h2>${ICONO_CHECKOUT_MENSAJE}Mensaje para la ferreteria (opcional)</h2>
<div class="market-checkout-textarea-wrap">
<textarea id="checkoutMensaje" maxlength="250" rows="3" placeholder="Ej. Necesito factura, horario especial, indicaciones, etc." style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--line); font:inherit; font-size:13.5px; resize:vertical;"></textarea>
<span class="market-checkout-contador" id="marketCheckoutContadorMensaje">0/250</span>
</div>
</div>

<div class="market-checkout-card">
<h2>${ICONO_CHECKOUT_CORREO}Como quieres recibir actualizaciones?</h2>
<div class="market-checkout-actualiza-opcion"><span>Por correo electronico</span><span class="market-checkout-actualiza-badge">Recomendado</span></div>
</div>

<p id="marketCheckoutAvisoInfo" style="color:#e2434d; font-size:13px; margin:0 0 14px;"></p>
<button type="button" class="btn primary" id="marketCheckoutContinuar" style="width:100%;">Continuar al resumen</button>
</div>

<div class="market-checkout-pantalla" data-pantalla="resumen" hidden>
<div class="market-checkout-card">
<h2>Revisa tu pedido</h2>
<div class="market-checkout-revision-linea"><span>Nombre</span><span id="marketCheckoutRevisionNombre"></span></div>
<div class="market-checkout-revision-linea"><span>Contacto</span><span id="marketCheckoutRevisionContacto"></span></div>
<div class="market-checkout-revision-linea"><span>Recoger en</span><span id="marketCheckoutRevisionRecoger"></span></div>
<button type="button" class="btn secondary" id="marketCheckoutVolver" style="margin-top:14px;">Volver</button>
</div>
<div class="market-checkout-card" id="marketCheckoutPago" hidden>
<h2>Pago con tarjeta</h2>
<div id="marketPagoElement"></div>
<p id="marketCheckoutPagoError" style="color:#e2434d; font-size:13px; margin:6px 0 0;"></p>
</div>
<p id="marketCheckoutPagoProximamente" style="color:#5a6b8c; font-size:13px; margin:0 0 14px;">Pago en linea proximamente. Por ahora pagas directo en la tienda al recoger tu pedido.</p>
<p id="marketCheckoutAviso" style="color:#e2434d; font-size:13px; margin:0 0 10px;"></p>
<div class="market-checkout-botones">
<button class="btn primary" type="submit" data-tipo="pedido">Enviar pedido</button>
<button class="btn secondary" type="submit" data-tipo="cotizacion">Solicitar cotizacion</button>
</div>
</div>

</div>
<div class="market-checkout-columna-lateral">
<div class="market-carrito-resumen" id="marketCheckoutResumenLateral"></div>
<div class="market-checkout-ayuda-card">
<h3>Dudas sobre tu pedido?</h3>
<div class="market-checkout-ayuda-item"><span>${ICONO_CHECKOUT_AYUDA}</span><a href="/site#contacto"><strong>Centro de ayuda</strong><span>Resuelve tus dudas</span></a></div>
<div class="market-checkout-ayuda-item" id="marketCheckoutAyudaWhatsapp" hidden><span>${ICONO_CHECKOUT_WHATSAPP}</span><a href="#" target="_blank" rel="noopener" id="marketCheckoutAyudaWhatsappLink"><strong>Contactar ferreteria</strong><span>Habla directamente con la tienda</span></a></div>
</div>
</div>
</div>
</form>
<div id="marketCheckoutExito" style="display:none;"></div>
</div>
${marketFooterHtml()}
<script src="https://js.stripe.com/v3/"></script>
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>window.NEXO_CHECKOUT_SLUG = ${slugSeguro}; window.NEXO_STRIPE_PK = ${JSON.stringify(config.stripePublishableKey || "")};</script>
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

var ICONO_FOTO_GENERICA_CHECKOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';

// Pago real (Stripe Connect) -- solo se pide si la tienda tiene cobros
// activos, y solo hasta que el comprador llega a la pantalla de resumen
// (no en cuanto carga la pagina): asi no se crea un PaymentIntent por
// cada quien que entra a llenar el formulario y nunca continua, y el
// Payment Element de Stripe nunca se monta en un contenedor oculto.
var marketStripe = null;
var marketStripeElements = null;
var marketCheckoutPagoIniciado = false;
var marketCheckoutProductos = [];

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

    // Consulta el stock, precio, foto y datos de la tienda reales (mismo
    // endpoint que ya usa /market/carrito) antes de mostrar el formulario.
    fetch("/market/carrito-productos-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map(function(it) { return { slug: slug, codigo: it.codigo, cantidad: it.cantidad }; }) })
    }).then(function(r) { return r.json(); }).catch(function() { return { ok: false }; }).then(function(datos) {
        const productos = (datos && datos.ok) ? datos.productos : [];
        if (productos.length === 0) {
            resumen.innerHTML = "";
            resumen.appendChild(Object.assign(document.createElement("p"), { className: "market-carrito-vacio", textContent: "Ya no hay productos de esta tienda en tu carrito." }));
            return;
        }

        marketCheckoutProductos = productos;
        resumen.style.display = "none";
        document.getElementById("marketCheckoutForm").style.display = "block";

        marketCheckoutPintarTienda(productos);
        marketCheckoutPintarResumenLateral();

        const todoDisponible = productos.every(function(p) { return p.stock !== null && p.stock !== undefined && p.stock > 0; });
        const algunoIncierto = productos.some(function(p) { return p.stock === null || p.stock === undefined || p.stock <= 0; });

        const aviso = document.createElement("p");
        aviso.className = "market-checkout-disponibilidad" + (algunoIncierto ? " incierto" : "");
        aviso.textContent = todoDisponible
            ? "Todos los productos de tu pedido estan disponibles en tienda. Puedes enviar tu pedido directo."
            : "Uno o mas productos estan bajo pedido o sin existencia confirmada -- te recomendamos solicitar cotizacion primero para confirmar con la tienda.";
        document.getElementById("marketCheckoutAvisoInfo").parentNode.insertBefore(aviso, document.getElementById("marketCheckoutAvisoInfo"));

        const contenedorBotones = document.querySelector(".market-checkout-botones");
        const botonPedido = contenedorBotones.querySelector('[data-tipo="pedido"]');
        const botonCotizacion = contenedorBotones.querySelector('[data-tipo="cotizacion"]');

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
        document.querySelectorAll('input[name="entrega"]').forEach(function(input) {
            input.addEventListener("change", marketCheckoutPintarResumenLateral);
        });

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

    const contadorMensaje = document.getElementById("marketCheckoutContadorMensaje");
    document.getElementById("checkoutMensaje").addEventListener("input", function(evento) {
        contadorMensaje.textContent = evento.target.value.length + "/250";
    });

    document.getElementById("marketCheckoutContinuar").addEventListener("click", function() {
        const avisoInfo = document.getElementById("marketCheckoutAvisoInfo");
        avisoInfo.textContent = "";

        const nombre = document.getElementById("checkoutNombre").value.trim();
        if (!nombre) {
            avisoInfo.textContent = "Escribe tu nombre para continuar.";
            document.getElementById("checkoutNombre").focus();
            return;
        }

        const correo = document.getElementById("checkoutCorreo").value.trim();
        if (document.getElementById("checkoutQuiereActualizaciones").checked && !correo) {
            avisoInfo.textContent = "Escribe tu correo para recibir actualizaciones, o desmarca la casilla.";
            document.getElementById("checkoutCorreo").focus();
            return;
        }

        document.getElementById("marketCheckoutRevisionNombre").textContent = nombre;
        document.getElementById("marketCheckoutRevisionContacto").textContent =
            [correo, document.getElementById("checkoutTelefono").value.trim()].filter(Boolean).join(" -- ") || "Sin datos de contacto";
        const entregaInput = document.querySelector('input[name="entrega"]:checked');
        document.getElementById("marketCheckoutRevisionRecoger").textContent =
            (entregaInput && entregaInput.value === "domicilio")
                ? "Domicilio"
                : (marketCheckoutProductos[0] ? marketCheckoutProductos[0].tienda : "La tienda");

        marketCheckoutCambiarPantalla("resumen");
        marketCheckoutIniciarPago();
    });

    document.getElementById("marketCheckoutVolver").addEventListener("click", function() {
        marketCheckoutCambiarPantalla("info");
    });

    document.getElementById("marketCheckoutForm").addEventListener("submit", async function(evento) {
        evento.preventDefault();
        const slugActual = window.NEXO_CHECKOUT_SLUG;
        const aviso = document.getElementById("marketCheckoutAviso");
        const pagoError = document.getElementById("marketCheckoutPagoError");
        aviso.textContent = "";
        pagoError.textContent = "";
        const tipo = evento.submitter && evento.submitter.dataset && evento.submitter.dataset.tipo === "cotizacion" ? "cotizacion" : "pedido";
        const entregaInput = document.querySelector('input[name="entrega"]:checked');
        const botonUsado = evento.submitter;

        const body = {
            items: marketCheckoutLeerCarrito(slugActual).map(function(it) { return { codigo: it.codigo, cantidad: it.cantidad }; }),
            clienteNombre: document.getElementById("checkoutNombre").value.trim(),
            clienteTelefono: document.getElementById("checkoutTelefono").value.trim(),
            clienteCorreo: document.getElementById("checkoutCorreo").value.trim(),
            mensaje: document.getElementById("checkoutMensaje").value.trim(),
            sitioExtra: document.getElementById("checkoutHoneypot").value,
            tipo: tipo,
            entrega: entregaInput ? entregaInput.value : null
        };

        // Solo "pedido" (compra real) exige el pago -- "cotizacion" sigue
        // siendo una solicitud sin cobro, aunque la tienda ya tenga
        // Stripe Connect activo.
        if (tipo === "pedido" && marketStripe && marketStripeElements) {
            if (botonUsado) botonUsado.disabled = true;

            const resultadoPago = await marketStripe.confirmPayment({ elements: marketStripeElements, redirect: "if_required" });

            if (resultadoPago.error) {
                pagoError.textContent = resultadoPago.error.message || "No se pudo procesar el pago.";
                if (botonUsado) botonUsado.disabled = false;
                return;
            }

            body.stripePaymentIntentId = resultadoPago.paymentIntent && resultadoPago.paymentIntent.id;
        }

        try {
            const respuesta = await fetch("/market/ferreteria/" + encodeURIComponent(slugActual) + "/catalogo/pedido-carrito", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const datos = await respuesta.json();
            if (!datos.ok) {
                aviso.textContent = datos.error || "No se pudo enviar el pedido.";
                if (botonUsado) botonUsado.disabled = false;
                return;
            }

            localStorage.removeItem("nexoCarrito_" + slugActual);

            if (tipo === "pedido" && datos.codigoRecogida) {
                window.location.href = "/market/pedido/" + encodeURIComponent(datos.codigoRecogida);
                return;
            }

            document.getElementById("marketCheckoutForm").style.display = "none";
            const exito = document.getElementById("marketCheckoutExito");
            exito.style.display = "";
            exito.innerHTML = "";
            const p = document.createElement("p");
            p.textContent = tipo === "cotizacion"
                ? "Solicitud enviada. La tienda te va a contactar con el precio."
                : (body.stripePaymentIntentId ? "Pago confirmado. Tu pedido fue enviado a la tienda." : "Pedido enviado. La tienda te va a contactar para confirmar.");
            exito.appendChild(p);
            const link = document.createElement("a");
            link.className = "btn secondary";
            link.href = "/market/ferreteria/" + encodeURIComponent(slugActual);
            link.textContent = "Volver a la tienda";
            exito.appendChild(link);
        } catch (error) {
            aviso.textContent = "No se pudo enviar el pedido. Intenta de nuevo.";
            if (botonUsado) botonUsado.disabled = false;
        }
    });
})();

// Nombre/direccion/tiempo de preparacion son datos reales del negocio
// (n.pedido_prep_min/max, ver migraciones del rediseno de pedidos) --
// la "recogida aproximada" es un calculo del navegador (hora actual +
// tiempo de preparacion), lo mismo que calcula el servidor al crear el
// pedido, asi que es una vista previa honesta, no un dato inventado.
function marketCheckoutPintarTienda(productos) {
    const tienda = productos[0];
    document.getElementById("marketCheckoutTiendaNombre").textContent = tienda.tienda || "";

    if (tienda.direccion) {
        document.getElementById("marketCheckoutTiendaDireccionLinea").hidden = false;
        document.getElementById("marketCheckoutTiendaDireccion").textContent = tienda.direccion;
    }

    const prepMin = tienda.pedidoPrepMin, prepMax = tienda.pedidoPrepMax;
    if (prepMin != null && prepMax != null) {
        document.getElementById("marketCheckoutTiendaPrep").textContent = prepMin + " - " + prepMax + " min";
        const ahora = new Date();
        const desde = new Date(ahora.getTime() + prepMin * 60000);
        const hasta = new Date(ahora.getTime() + prepMax * 60000);
        const fmt = function(d) { return d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }); };
        document.getElementById("marketCheckoutTiendaRecogida").textContent = "Hoy, " + fmt(desde) + " - " + fmt(hasta);
    }

    document.getElementById("marketCheckoutRecogerCard").hidden = false;

    if (tienda.whatsappUrl) {
        document.getElementById("marketCheckoutAyudaWhatsapp").hidden = false;
        document.getElementById("marketCheckoutAyudaWhatsappLink").href =
            tienda.whatsappUrl + "?text=" + encodeURIComponent("Hola, tengo una duda sobre mi pedido en " + (tienda.tienda || ""));
    }
}

function marketCheckoutPintarResumenLateral() {
    const contenedor = document.getElementById("marketCheckoutResumenLateral");
    contenedor.innerHTML = "";

    const titulo = document.createElement("h3");
    titulo.textContent = "Resumen de tu pedido";
    contenedor.appendChild(titulo);

    let subtotal = 0;
    marketCheckoutProductos.forEach(function(p) {
        const precioUnit = p.precioOferta != null ? p.precioOferta : (p.precio != null ? p.precio : 0);
        subtotal += precioUnit * p.cantidad;

        const fila = document.createElement("div");
        fila.className = "market-checkout-resumen-item";

        const foto = document.createElement("div");
        foto.className = "market-checkout-resumen-foto";
        foto.innerHTML = p.fotoUrl ? "" : ICONO_FOTO_GENERICA_CHECKOUT;
        if (p.fotoUrl) {
            const img = document.createElement("img");
            img.src = p.fotoUrl;
            img.alt = "";
            foto.appendChild(img);
        }

        const info = document.createElement("div");
        info.className = "market-checkout-resumen-info";
        const nombre = document.createElement("strong");
        nombre.textContent = p.nombre;
        const detalle = document.createElement("small");
        detalle.textContent = [p.marca, "Cantidad: " + p.cantidad].filter(Boolean).join(", ");
        info.appendChild(nombre);
        info.appendChild(detalle);

        const precio = document.createElement("div");
        precio.className = "market-checkout-resumen-precio";
        precio.textContent = marketCarritoFormatoDinero(precioUnit * p.cantidad);

        fila.appendChild(foto);
        fila.appendChild(info);
        fila.appendChild(precio);
        contenedor.appendChild(fila);
    });

    const entregaInput = document.querySelector('input[name="entrega"]:checked');
    const esDomicilio = entregaInput && entregaInput.value === "domicilio";
    const envioTarifa = marketCheckoutProductos[0] ? marketCheckoutProductos[0].envioTarifa : null;
    const envioTexto = !esDomicilio
        ? "Gratis"
        : (envioTarifa !== null && envioTarifa !== undefined ? marketCarritoFormatoDinero(envioTarifa) : "Se coordina con la tienda");
    const envioMonto = (!esDomicilio || envioTarifa === null || envioTarifa === undefined) ? 0 : Number(envioTarifa);

    const bloqueTotales = document.createElement("div");
    bloqueTotales.innerHTML =
        '<div class="market-carrito-resumen-linea"><span>Subtotal</span><span></span></div>' +
        '<div class="market-carrito-resumen-linea"><span>' + (esDomicilio ? "Envio" : "Recoger en tienda") + '</span><span></span></div>' +
        '<div class="market-carrito-resumen-total"><span>Total</span><span></span></div>';
    bloqueTotales.children[0].children[1].textContent = marketCarritoFormatoDinero(subtotal);
    bloqueTotales.children[1].children[1].textContent = envioTexto;
    bloqueTotales.children[2].children[1].textContent = marketCarritoFormatoDinero(subtotal + envioMonto);
    contenedor.appendChild(bloqueTotales);

    const confianza = document.createElement("div");
    confianza.className = "market-checkout-confianza";
    confianza.innerHTML =
        '<div class="market-checkout-confianza-item"><span>${ICONO_CHECKOUT_ESCUDO}</span><div><strong>Compra segura</strong><span>Tu conexion con Nexo esta cifrada</span></div></div>' +
        '<div class="market-checkout-confianza-item"><span>${ICONO_CHECKOUT_CANDADO}</span><div><strong>Sin cargos ocultos</strong><span>El precio que ves es el que pagas</span></div></div>' +
        '<div class="market-checkout-confianza-item"><span>${ICONO_CHECKOUT_CASA}</span><div><strong>Directo con la ferreteria</strong><span>Tu pedido llega directo a la tienda</span></div></div>';
    contenedor.appendChild(confianza);
}

function marketCheckoutCambiarPantalla(pantalla) {
    document.querySelectorAll(".market-checkout-pantalla").forEach(function(el) {
        el.hidden = el.dataset.pantalla !== pantalla;
    });

    document.querySelectorAll("#marketCheckoutPasos .market-checkout-paso").forEach(function(el) {
        const orden = ["info", "recoger", "resumen", "confirmacion"];
        const actualIndice = orden.indexOf(pantalla === "resumen" ? "resumen" : "info");
        const esteIndice = orden.indexOf(el.dataset.paso);
        el.classList.toggle("activo", esteIndice === actualIndice);
        el.classList.toggle("hecho", esteIndice < actualIndice);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function marketCheckoutIniciarPago() {
    if (marketCheckoutPagoIniciado) return;
    marketCheckoutPagoIniciado = true;

    if (!window.NEXO_STRIPE_PK || typeof Stripe === "undefined") return;

    const slug = window.NEXO_CHECKOUT_SLUG;
    const items = marketCheckoutLeerCarrito(slug);

    // Pago real (Stripe Connect) -- solo se ofrece si la tienda ya tiene
    // cobros activos. Si crear-intento-pago responde ok:false (tienda
    // sin cuenta verificada), no pasa nada visible: el comprador sigue
    // viendo el flujo de pedido/cotizacion de siempre, sin cobro. El
    // total se recalcula server-side, nunca se manda un monto desde aqui.
    fetch("/market/ferreteria/" + encodeURIComponent(slug) + "/catalogo/crear-intento-pago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map(function(it) { return { codigo: it.codigo, cantidad: it.cantidad }; }) })
    }).then(function(r) { return r.json(); }).catch(function() { return { ok: false }; }).then(function(datosPago) {
        if (!datosPago || !datosPago.ok || !datosPago.clientSecret) return;

        marketStripe = Stripe(window.NEXO_STRIPE_PK);
        marketStripeElements = marketStripe.elements({
            clientSecret: datosPago.clientSecret,
            appearance: { theme: "stripe", variables: { colorPrimary: "#1067e8", fontFamily: "inherit" } }
        });
        marketStripeElements.create("payment").mount("#marketPagoElement");
        document.getElementById("marketCheckoutPago").hidden = false;
        document.getElementById("marketCheckoutPagoProximamente").hidden = true;

        const botonPedidoPago = document.querySelector('.market-checkout-botones [data-tipo="pedido"]');
        if (botonPedidoPago) botonPedidoPago.textContent = "Pagar y realizar pedido";
    });
}
`;
}

async function servirCarritoMarket(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaCarritoMarketHtml());
}

// pool es opcional (llamador viejo sigue funcionando: simplemente no
// prellena datos de persona) -- mismo criterio "degrada, no truena" ya
// usado en itemsDePedidos con slug/firmarTokenImagen.
async function servirCheckoutMarket(req, res, pool) {
    const slug = String(req.query.tienda || "").trim().slice(0, 120);
    let persona = null;

    if (pool) {
        try {
            const resolver = crearResolverSesionPersonaOpcional(pool);
            await new Promise(resolve => resolver(req, res, resolve));
            persona = req.persona || null;
        } catch (error) {
            persona = null;
        }
    }

    res.set("Content-Type", "text/html; charset=utf-8").send(paginaCheckoutMarketHtml(slug, persona));
}

module.exports = { servirCarritoMarket, servirCheckoutMarket };

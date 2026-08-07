// Nexo Market -- la costura entre Market y el sitio de cada tienda
// (Fase 1 "Market embebido", ver plan). Vive aparte de market-server.js
// (que ya tiene 1400+ lineas) y de public-site-server.js porque su
// unico trabajo es unir los dos: importa el shell (header/footer fijos
// de Market) de uno y los datos/vistas de tienda del otro. server.js ya
// importa ambos modulos, asi que este archivo no genera ciclos de
// require.
//
// Requisito no negociable de esta fase: la barra de Market
// (marketHeaderHtml) es identica sin importar que tienda se este
// viendo -- el color propio de la tienda NUNCA debe tocarla. Por eso
// estilosBaseTenant(color, ".market-tienda-scope") scopea las
// variables --blue/--blue-dark a un <div> de contenido, nunca a
// :root -- la marca de la tienda (franjaTiendaMarketHtml) vive DENTRO
// de ese div, como contenido, no como encabezado.

const {
    resolverSitioPublico,
    cargarInicioTenant,
    cargarCatalogoTenant,
    cargarProductoTenant,
    vistaCatalogoTenantHtml,
    vistaProductoTenantHtml,
    categoriasTenantHtml,
    destacadosTenantHtml,
    beneficiosTenantHtml,
    bannerPromocionHtml,
    estilosBaseTenant,
    scriptCarritoTenantHtml,
    modalCarritoTenantHtml
} = require("./public-site-server");

const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml } = require("./market-server");

// Mismo patron de escape local usado en el resto de modulos del sitio
// publico (public-site-server.js, market-server.js, email.js) --
// copiado, no importado.
function escaparHtml(valor) {
    return String(valor == null ? "" : valor)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const ICONO_TIENDA_PIN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
const ICONO_TIENDA_TELEFONO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"></path></svg>`;
const ICONO_TIENDA_RELOJ = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;

// Estilos exclusivos de la franja de marca de tienda dentro de Market --
// separados de ESTILOS_MARKET (que es de la barra fija, nunca cambia)
// para dejar claro que esto es contenido, no encabezado. Todo usa
// var(--blue)/var(--line)/etc: var(--blue) esta scopeada a
// .market-tienda-scope (ver estilosBaseTenant mas abajo), asi que aqui
// SI se ve el color propio de la tienda -- es la franja, no la barra.
const ESTILOS_TIENDA_MARKET = `
.market-tienda-scope{ max-width:1680px; margin:0 auto; }
.market-tienda-franja{ display:flex; flex-wrap:wrap; align-items:center; gap:16px 24px; padding:20px clamp(18px,4vw,48px); border-bottom:1px solid var(--line); background:var(--paper); }
.market-tienda-franja-marca{ display:flex; align-items:center; gap:12px; flex:0 0 auto; }
.market-tienda-franja-logo{ width:48px; height:48px; border-radius:12px; overflow:hidden; background:var(--glass); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.market-tienda-franja-logo img{ width:100%; height:100%; object-fit:cover; }
.market-tienda-franja-inicial{ font-weight:900; font-size:20px; color:var(--blue); }
.market-tienda-franja-info{ display:flex; flex-direction:column; gap:2px; }
.market-tienda-franja-nombre{ font-size:18px; }
.market-tienda-franja-giro{ color:var(--muted); font-size:12.5px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
.market-tienda-franja-chips{ display:flex; flex-wrap:wrap; gap:8px; flex:1; min-width:200px; }
.market-tienda-franja-chip{ display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border:1px solid var(--line); border-radius:999px; background:#fff; font-size:12.5px; color:var(--ink); }
.market-tienda-franja-chip svg{ color:var(--blue); flex-shrink:0; }
.market-tienda-franja-nav{ display:flex; gap:6px; flex:0 0 auto; }
.market-tienda-franja-nav a{ padding:8px 14px; border-radius:999px; font-weight:700; font-size:13px; color:var(--ink); background:var(--glass); border:1px solid var(--line); }
.market-tienda-franja-nav a.activo{ background:var(--blue); border-color:var(--blue); color:#fff; }
.market-tienda-franja-completo{ flex:0 0 auto; font-weight:700; font-size:12.5px; color:var(--blue); }
@media (max-width:720px){
  .market-tienda-franja{ flex-direction:column; align-items:flex-start; }
}
`;

// Franja de marca de la tienda -- logo/inicial, nombre, giro, chips de
// direccion/telefono/horario reales (nunca inventados, mismo criterio
// que el resto del sitio publico), mini-nav de la tienda (solo lo que
// existe en esta fase: Inicio/Catalogo/Ofertas) y el link honesto "Ver
// el sitio completo de {tienda}" hacia el subdominio real -- ahi viven
// favoritos/comparador/credito/portal de cliente mientras esta fase no
// los trae a Market (ver "Fuera de alcance" del plan).
function franjaTiendaMarketHtml(sitio, paginaActiva, basePath) {
    const negocio = sitio.negocio;
    const nombre = escaparHtml(negocio.nombre);
    const inicial = escaparHtml((String(negocio.nombre || "").trim().charAt(0) || "?").toUpperCase());
    const logoHtml = negocio.logo
        ? `<img src="${escaparHtml(negocio.logo)}" alt="Logo ${nombre}">`
        : `<span class="market-tienda-franja-inicial">${inicial}</span>`;

    const chips = [
        negocio.direccion ? `<span class="market-tienda-franja-chip">${ICONO_TIENDA_PIN}${escaparHtml(negocio.direccion)}</span>` : "",
        negocio.telefono ? `<span class="market-tienda-franja-chip">${ICONO_TIENDA_TELEFONO}${escaparHtml(negocio.telefono)}</span>` : "",
        sitio.config.horarioTexto ? `<span class="market-tienda-franja-chip">${ICONO_TIENDA_RELOJ}${escaparHtml(sitio.config.horarioTexto)}</span>` : ""
    ].filter(Boolean).join("");

    return `<div class="market-tienda-franja">
<div class="market-tienda-franja-marca">
<div class="market-tienda-franja-logo">${logoHtml}</div>
<div class="market-tienda-franja-info">
<strong class="market-tienda-franja-nombre">${nombre}</strong>
${negocio.giro ? `<span class="market-tienda-franja-giro">${escaparHtml(negocio.giro)}</span>` : ""}
</div>
</div>
${chips ? `<div class="market-tienda-franja-chips">${chips}</div>` : ""}
<nav class="market-tienda-franja-nav">
<a href="${basePath}"${paginaActiva === "inicio" ? ' class="activo"' : ""}>Inicio</a>
<a href="${basePath}/catalogo"${paginaActiva === "catalogo" ? ' class="activo"' : ""}>Catalogo</a>
<a href="${basePath}/catalogo?ofertas=1">Ofertas</a>
</nav>
<a class="market-tienda-franja-completo" href="https://${escaparHtml(negocio.slug)}.nexoposoficial.com" target="_blank" rel="noopener">Ver el sitio completo de ${nombre}</a>
</div>`;
}

// <head> compartido por las 3 paginas de tienda embebidas en Market --
// mismo /site/styles.css + ESTILOS_MARKET (fijo) que /market, mas los
// estilos de la franja y estilosBaseTenant scopeado a
// .market-tienda-scope (nunca a :root -- es el fix del hallazgo critico
// de fuga de color de la Fase 1).
function cabezaTiendaMarketHtml({ titulo, descripcion, color }) {
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<meta name="description" content="${descripcion}">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}</style>
<style>${ESTILOS_TIENDA_MARKET}</style>
<style>${estilosBaseTenant(color, ".market-tienda-scope")}</style>`;
}

// Envoltura comun de las 3 paginas: barra fija de Market (marketHeaderHtml,
// jamas cambia por tienda) + franja/banner/contenido dentro de
// .market-tienda-scope + footer de Market + modal de carrito + scripts
// (scriptMarketHeaderHtml para que el buscador de la barra funcione
// igual, scriptCarritoTenantHtml con basePath para que el carrito real
// pegue a /market/{slug}/catalogo/pedido-carrito).
function paginaTiendaMarketHtml({ sitio, slug, basePath, paginaActiva, titulo, descripcion, contenidoHtml }) {
    return `<!doctype html>
<html lang="es">
<head>
${cabezaTiendaMarketHtml({ titulo, descripcion, color: sitio.negocio.color })}
</head>
<body>
${marketHeaderHtml({ slugTienda: slug, nombreTienda: sitio.negocio.nombre, baseAnclas: "/market" })}
<div class="market-tienda-scope">
${franjaTiendaMarketHtml(sitio, paginaActiva, basePath)}
${bannerPromocionHtml(sitio.config)}
<main class="tenant-main">
${contenidoHtml}
</main>
</div>
${marketFooterHtml()}
${modalCarritoTenantHtml(slug)}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>${scriptCarritoTenantHtml(slug, basePath)}</script>
</body>
</html>`;
}

async function servirInicioTiendaMarket(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const basePath = `/market/${encodeURIComponent(slug)}`;
        const datos = await cargarInicioTenant(pool, sitio, slug, firmarTokenImagen);
        const nombre = escaparHtml(sitio.negocio.nombre);

        const franjaCatalogoHtml = datos.totalProductos > 0
            ? `<div class="tenant-catalogo-franja"><div><strong>${datos.totalProductos} producto${datos.totalProductos === 1 ? "" : "s"} en catalogo</strong><span>Consulta precios y existencias en linea</span></div><a class="tenant-btn-primario" href="${basePath}/catalogo">Ver catalogo</a></div>`
            : "";

        const contenidoHtml = `${categoriasTenantHtml(datos.categorias, basePath)}
${destacadosTenantHtml(datos.destacados, basePath)}
${beneficiosTenantHtml(sitio.config)}
${franjaCatalogoHtml}`;

        const html = paginaTiendaMarketHtml({
            sitio, slug, basePath, paginaActiva: "inicio",
            titulo: `${nombre} -- Nexo Market`,
            descripcion: `${nombre} en Nexo Market -- catalogo, precios y disponibilidad reales.`,
            contenidoHtml
        });

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo inicio de tienda en Market:", error.message);
        res.status(500).send("Error");
    }
}

async function servirCatalogoTiendaMarket(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const basePath = `/market/${encodeURIComponent(slug)}`;
        const filtros = {
            buscar: String(req.query.buscar || "").trim().slice(0, 120),
            categoria: String(req.query.categoria || "").trim().slice(0, 120),
            marca: String(req.query.marca || "").trim().slice(0, 120),
            ofertas: req.query.ofertas === "1" && sitio.config.mostrarPrecios,
            pagina: Math.max(1, parseInt(req.query.pagina, 10) || 1)
        };

        const datos = await cargarCatalogoTenant(pool, sitio, slug, filtros, firmarTokenImagen);
        const contenidoHtml = vistaCatalogoTenantHtml({ sitio, datos, filtros, basePath });
        const nombre = escaparHtml(sitio.negocio.nombre);

        const html = paginaTiendaMarketHtml({
            sitio, slug, basePath, paginaActiva: "catalogo",
            titulo: `Catalogo de ${nombre} -- Nexo Market`,
            descripcion: `Catalogo de productos de ${nombre} en Nexo Market.`,
            contenidoHtml
        });

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo catalogo de tienda en Market:", error.message);
        res.status(500).send("Error");
    }
}

async function servirProductoTiendaMarket(pool, req, res, slug, codigo, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const basePath = `/market/${encodeURIComponent(slug)}`;
        const datos = await cargarProductoTenant(pool, sitio, slug, codigo, firmarTokenImagen);

        if (!datos) {
            res.status(404).send("No encontrado");
            return;
        }

        const estadoPedido = String(req.query.pedido || "").trim().slice(0, 20);
        const contenidoHtml = vistaProductoTenantHtml({ sitio, datos, basePath, estadoPedido });
        const nombre = escaparHtml(sitio.negocio.nombre);
        const nombreProducto = escaparHtml(datos.producto.nombre);

        const html = paginaTiendaMarketHtml({
            sitio, slug, basePath, paginaActiva: "catalogo",
            titulo: `${nombreProducto} -- ${nombre} -- Nexo Market`,
            descripcion: `${nombreProducto} disponible en ${nombre}, en Nexo Market.`,
            contenidoHtml
        });

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo producto de tienda en Market:", error.message);
        res.status(500).send("Error");
    }
}

module.exports = {
    servirInicioTiendaMarket,
    servirCatalogoTiendaMarket,
    servirProductoTiendaMarket
};

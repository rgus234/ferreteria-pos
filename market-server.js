// Nexo Market -- buscador cruzado de productos entre negocios, servido
// en el dominio corporativo (nexoposoficial.com/market), separado del
// sitio de venta del software y de los sitios individuales de cada
// negocio ({slug}.nexoposoficial.com, que se quedan intactos).
//
// Cada resultado es un producto real de un negocio real (modelo
// Amazon/Mercado Libre) -- no se intenta emparejar "el mismo producto"
// entre negocios distintos. Reusa el mismo indice pg_trgm y el mismo
// gate de plan (funcionDelPlan) que ya usa el sitio de cada negocio,
// sin inventar un sistema nuevo.

const { funcionDelPlan } = require("./plan-enforcement");

const CLAVE_FUNCION_SITIO_WEB = "sitio_web.pagina";
const PRODUCTOS_POR_PAGINA_MARKET = 24;

// Mismo patron de escape local usado en el resto de modulos del sitio
// publico (public-site-server.js, email.js) -- copiado, no importado.
function escaparHtml(valor) {
    return String(valor == null ? "" : valor)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Cache corto en memoria (mismo criterio que CACHE_FUNCIONES_PLAN en
// plan-enforcement.js) -- evita repetir el chequeo de plan por negocio
// en cada busqueda. A este volumen (unos pocos negocios), es barato de
// mantener correcto sin inline-ar la logica de plan_funciones en SQL.
let cacheTiendas = { negocios: null, expiraEn: 0 };
const CACHE_TIENDAS_TTL_MS = 60 * 1000;

async function tiendasPermitidasMarket(pool) {
    if (cacheTiendas.negocios && cacheTiendas.expiraEn > Date.now()) {
        return cacheTiendas.negocios;
    }

    const candidatas = await pool.query(`
        SELECT n.id, n.slug, n.nombre, n.giro, n.direccion
        FROM public.negocios n
        JOIN public.sitio_web_config c ON c.negocio_id = n.id
        WHERE n.estado = 'activo' AND c.activo = true
        ORDER BY n.nombre
    `);

    const permitidas = [];
    for (const negocio of candidatas.rows) {
        const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);
        if (acceso.incluido) permitidas.push(negocio);
    }

    cacheTiendas = { negocios: permitidas, expiraEn: Date.now() + CACHE_TIENDAS_TTL_MS };
    return permitidas;
}

function tarjetaTiendaMarketHtml(negocio) {
    const direccionHtml = negocio.direccion
        ? `<span class="market-tienda-direccion">${escaparHtml(negocio.direccion)}</span>`
        : "";
    return `<div class="market-tienda-card">
<strong>${escaparHtml(negocio.nombre)}</strong>
${negocio.giro ? `<span class="market-tienda-giro">${escaparHtml(negocio.giro)}</span>` : ""}
${direccionHtml}
<a class="btn secondary" href="https://${escaparHtml(negocio.slug)}.nexoposoficial.com" target="_blank" rel="noopener">Ver tienda</a>
</div>`;
}

function tarjetaProductoMarketHtml(producto) {
    const precioHtml = producto.precio !== null && producto.precio !== undefined
        ? `<span class="market-producto-precio">$${Number(producto.precio).toFixed(2)}</span>`
        : "";
    const existenciaHtml = producto.stock !== null && producto.stock !== undefined
        ? `<span class="market-producto-existencia${producto.stock <= 0 ? " agotado" : ""}">${producto.stock <= 0 ? "Agotado" : `${producto.stock} disponibles`}</span>`
        : "";

    return `<div class="market-producto-card">
<span class="market-producto-nombre">${escaparHtml(producto.nombre)}</span>
${precioHtml}
${existenciaHtml}
<span class="market-producto-tienda">${escaparHtml(producto.tienda)}${producto.direccion ? ` &middot; ${escaparHtml(producto.direccion)}` : ""}</span>
<a class="btn primary" href="https://${escaparHtml(producto.slug)}.nexoposoficial.com/catalogo/${encodeURIComponent(producto.codigo)}" target="_blank" rel="noopener">Ver en ${escaparHtml(producto.tienda)}</a>
</div>`;
}

async function buscarProductosMarket(pool, buscar, pagina) {
    const tiendas = await tiendasPermitidasMarket(pool);
    if (tiendas.length === 0) return { productos: [], total: 0 };

    const idsPermitidos = tiendas.map(t => t.id);
    const offset = Math.max(0, (pagina - 1) * PRODUCTOS_POR_PAGINA_MARKET);
    const textoIlike = `%${buscar}%`;

    const resultado = await pool.query(
        `
        SELECT p.codigo, p.nombre, p.categoria, p.marca, n.slug, n.nombre AS tienda, n.direccion,
               CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
               CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
               COUNT(*) OVER() AS total
        FROM public.productos p
        JOIN public.negocios n ON n.id = p.negocio_id
        JOIN public.sitio_web_config c ON c.negocio_id = n.id
        WHERE p.negocio_id = ANY($1::int[])
          AND (p.nombre % $2 OR p.codigo ILIKE $3 OR p.marca ILIKE $3)
        ORDER BY similarity(p.nombre, $2) DESC
        LIMIT $4 OFFSET $5
        `,
        [idsPermitidos, buscar, textoIlike, PRODUCTOS_POR_PAGINA_MARKET, offset]
    );

    return {
        productos: resultado.rows.map(fila => ({
            codigo: fila.codigo,
            nombre: fila.nombre,
            categoria: fila.categoria,
            marca: fila.marca,
            slug: fila.slug,
            tienda: fila.tienda,
            direccion: fila.direccion,
            precio: fila.precio !== null ? Number(fila.precio) : null,
            stock: fila.stock !== null ? Number(fila.stock) : null
        })),
        total: resultado.rows.length > 0 ? Number(resultado.rows[0].total) : 0
    };
}

// JSON consumido por el buscador de /market -- sin buscar, regresa el
// directorio de tiendas; con buscar, regresa productos cruzados.
async function buscarMarketJson(pool, req, res) {
    try {
        const buscar = String(req.query?.buscar || "").trim().slice(0, 120);
        const pagina = Math.max(1, parseInt(req.query?.pagina, 10) || 1);

        if (!buscar) {
            const tiendas = await tiendasPermitidasMarket(pool);
            res.json({ ok: true, tiendas });
            return;
        }

        const { productos, total } = await buscarProductosMarket(pool, buscar, pagina);
        res.json({ ok: true, productos, total, pagina });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudo completar la busqueda." });
    }
}

const ESTILOS_MARKET = `
.market-header-sesion{ display:flex; align-items:center; gap:12px; font-weight:700; }
.market-buscador{ display:flex; gap:10px; max-width:640px; margin:0 auto 32px; }
.market-buscador input{ flex:1; padding:14px 18px; border-radius:999px; border:1px solid var(--line); background:var(--glass); font:inherit; }
.market-buscador button{ border-radius:999px; }
.market-tiendas-grid, .market-productos-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:16px; }
.market-tienda-card, .market-producto-card{ display:grid; gap:8px; align-content:start; padding:20px; border:1px solid rgba(255,255,255,.72); border-radius:22px; background:var(--glass); box-shadow:0 18px 48px rgba(20,32,51,.08); }
.market-tienda-giro{ color:var(--muted); font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
.market-tienda-direccion{ color:var(--muted); font-size:13.5px; }
.market-producto-nombre{ font-weight:800; font-size:16px; }
.market-producto-precio{ font-weight:900; color:var(--blue); font-size:18px; }
.market-producto-existencia{ color:var(--mint); font-size:13px; font-weight:700; }
.market-producto-existencia.agotado{ color:#c0392b; }
.market-producto-tienda{ color:var(--muted); font-size:13px; }
.market-vacio{ text-align:center; color:var(--muted); padding:40px 0; }
@media (max-width:560px){ .market-buscador{ flex-direction:column; } }
`;

function paginaMarketHtml() {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nexo Market -- busca productos entre ferreterias</title>
<meta name="description" content="Busca productos entre varias ferreterias Nexo, compara precio y disponibilidad, y entra directo al catalogo de la tienda que elijas.">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}</style>
</head>
<body>
<header class="site-header">
<a class="brand" href="/site" aria-label="Nexo">
<img src="/nexo-pos-icon.jpg" alt="Nexo">
<span>Nexo Market</span>
</a>
<div class="market-header-sesion" id="marketSesion">
<a class="btn secondary" href="/mi-cuenta">Iniciar sesion</a>
</div>
</header>

<main class="contact" style="padding-top:48px;">
<div class="contact-intro" style="text-align:center;">
<p class="eyebrow">Nexo Market</p>
<h2>Encuentra productos en las ferreterias Nexo.</h2>
<p>Busca por nombre, codigo o marca -- cada resultado te lleva directo al catalogo real de la tienda.</p>
</div>

<form class="market-buscador" id="marketBuscadorForm">
<input type="text" id="marketBuscarInput" placeholder="Ej. taladro, codo pvc 1/2, Truper..." maxlength="120">
<button class="btn primary" type="submit">Buscar</button>
</form>

<div id="marketResultados"><p class="market-vacio">Cargando...</p></div>
</main>

<footer>
<div class="brand">
<img src="/nexo-pos-icon.jpg" alt="Nexo">
<span>Nexo</span>
</div>
<span>Sistema comercial para punto de venta.</span>
<nav aria-label="Legal">
<a href="/terminos">Terminos</a>
<a href="/privacidad">Privacidad</a>
</nav>
</footer>

<script>
function escapeHtml(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function marketLlamar(ruta) {
    const respuesta = await fetch(ruta, { credentials: "include" });
    return respuesta.json();
}

async function marketCargarSesion() {
    const estado = await marketLlamar("/personas/estado");
    if (!estado.ok) return;
    document.getElementById("marketSesion").innerHTML =
        '<a class="btn secondary" href="/mi-cuenta">Hola, ' + escapeHtml(estado.persona.nombre) + '</a>';
}

function marketTarjetaTienda(t) {
    return '<div class="market-tienda-card"><strong>' + escapeHtml(t.nombre) + '</strong>' +
        (t.giro ? '<span class="market-tienda-giro">' + escapeHtml(t.giro) + '</span>' : '') +
        (t.direccion ? '<span class="market-tienda-direccion">' + escapeHtml(t.direccion) + '</span>' : '') +
        '<a class="btn secondary" href="https://' + escapeHtml(t.slug) + '.nexoposoficial.com" target="_blank" rel="noopener">Ver tienda</a></div>';
}

function marketTarjetaProducto(p) {
    const precioHtml = p.precio !== null && p.precio !== undefined
        ? '<span class="market-producto-precio">$' + Number(p.precio).toFixed(2) + '</span>' : '';
    const existenciaHtml = p.stock !== null && p.stock !== undefined
        ? '<span class="market-producto-existencia' + (p.stock <= 0 ? ' agotado' : '') + '">' + (p.stock <= 0 ? 'Agotado' : p.stock + ' disponibles') + '</span>' : '';
    return '<div class="market-producto-card"><span class="market-producto-nombre">' + escapeHtml(p.nombre) + '</span>' +
        precioHtml + existenciaHtml +
        '<span class="market-producto-tienda">' + escapeHtml(p.tienda) + (p.direccion ? ' &middot; ' + escapeHtml(p.direccion) : '') + '</span>' +
        '<a class="btn primary" href="https://' + escapeHtml(p.slug) + '.nexoposoficial.com/catalogo/' + encodeURIComponent(p.codigo) + '" target="_blank" rel="noopener">Ver en ' + escapeHtml(p.tienda) + '</a></div>';
}

async function marketBuscar(texto) {
    const contenedor = document.getElementById("marketResultados");
    contenedor.innerHTML = '<p class="market-vacio">Buscando...</p>';

    const datos = await marketLlamar("/market/buscar-json?buscar=" + encodeURIComponent(texto));

    if (!texto) {
        if (!datos.ok || datos.tiendas.length === 0) {
            contenedor.innerHTML = '<p class="market-vacio">Todavia no hay tiendas Nexo activas para mostrar aqui.</p>';
            return;
        }
        contenedor.innerHTML = '<div class="market-tiendas-grid">' + datos.tiendas.map(marketTarjetaTienda).join('') + '</div>';
        return;
    }

    if (!datos.ok || datos.productos.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio">No encontramos productos para "' + escapeHtml(texto) + '".</p>';
        return;
    }

    contenedor.innerHTML = '<div class="market-productos-grid">' + datos.productos.map(marketTarjetaProducto).join('') + '</div>';
}

document.getElementById("marketBuscadorForm").addEventListener("submit", evento => {
    evento.preventDefault();
    marketBuscar(document.getElementById("marketBuscarInput").value.trim());
});

marketCargarSesion();
marketBuscar("");
</script>
</body>
</html>`;
}

async function servirMarketPagina(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(paginaMarketHtml());
}

module.exports = { servirMarketPagina, buscarMarketJson, tiendasPermitidasMarket };

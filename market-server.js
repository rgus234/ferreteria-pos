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
//
// v2 (rediseno tipo marketplace): agrega personalizacion por oficio
// (categoria coincide con el oficio de la persona logueada, nunca un
// query param del cliente -- siempre la sesion del servidor) y
// secciones reales de categorias/ofertas -- cada seccion solo se pinta
// si tiene contenido real, nunca un placeholder inventado.

const { funcionDelPlan } = require("./plan-enforcement");
const { crearResolverSesionPersonaOpcional } = require("./personas-server");
const { OFICIOS_PERSONA } = require("./oficios-persona");

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

// Cache corto de las categorias mas pobladas cruzando todas las
// tiendas permitidas -- mismo TTL/criterio que cacheTiendas.
let cacheCategorias = { categorias: null, expiraEn: 0 };
const CACHE_CATEGORIAS_TTL_MS = 60 * 1000;

async function categoriasMarket(pool) {
    if (cacheCategorias.categorias && cacheCategorias.expiraEn > Date.now()) {
        return cacheCategorias.categorias;
    }

    const tiendas = await tiendasPermitidasMarket(pool);
    if (tiendas.length === 0) return [];

    const idsPermitidos = tiendas.map(t => t.id);
    const resultado = await pool.query(
        `SELECT categoria, COUNT(*) AS total
         FROM public.productos
         WHERE negocio_id = ANY($1::int[]) AND categoria <> ''
         GROUP BY categoria
         ORDER BY COUNT(*) DESC
         LIMIT 12`,
        [idsPermitidos]
    );

    const categorias = resultado.rows.map(f => f.categoria);
    cacheCategorias = { categorias, expiraEn: Date.now() + CACHE_CATEGORIAS_TTL_MS };
    return categorias;
}

// Mismo shape de fila -> objeto de producto usado por las 3 consultas
// de productos de este archivo (buscar, recomendados, ofertas) -- un
// solo lugar que decide como se mapea, sin duplicar 3 veces.
function mapearFilasProducto(rows) {
    return rows.map(fila => ({
        codigo: fila.codigo,
        nombre: fila.nombre,
        categoria: fila.categoria,
        marca: fila.marca,
        slug: fila.slug,
        tienda: fila.tienda,
        direccion: fila.direccion,
        precio: fila.precio !== null && fila.precio !== undefined ? Number(fila.precio) : null,
        precioOferta: fila.precio_oferta !== null && fila.precio_oferta !== undefined ? Number(fila.precio_oferta) : null,
        stock: fila.stock !== null && fila.stock !== undefined ? Number(fila.stock) : null
    }));
}

// Personalizacion por oficio -- si la persona no tiene sesion o no
// eligio oficio (o eligio "otro"), regresa [] sin consultar (mismo
// criterio de "nunca inventar/rellenar" ya usado en el resto del
// proyecto, ej. destacadosTenantHtml). El patron regex del oficio se
// manda como texto al operador ~* de Postgres (case-insensitive,
// mismo criterio que el regex de JS).
async function recomendadosMarket(pool, idsPermitidos, claveOficio) {
    if (!claveOficio || idsPermitidos.length === 0) return [];

    const oficio = OFICIOS_PERSONA.find(o => o.clave === claveOficio);
    if (!oficio || !oficio.patron) return [];

    const resultado = await pool.query(
        `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.slug, n.nombre AS tienda, n.direccion,
                CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                CASE WHEN c.mostrar_existencias THEN p.stock END AS stock
         FROM public.productos p
         JOIN public.negocios n ON n.id = p.negocio_id
         JOIN public.sitio_web_config c ON c.negocio_id = n.id
         WHERE p.negocio_id = ANY($1::int[]) AND p.categoria ~* $2
         LIMIT 12`,
        [idsPermitidos, oficio.patron.source]
    );

    return mapearFilasProducto(resultado.rows);
}

// Mismo criterio de "oferta real" que ya usa servirCatalogoNegocio en
// public-site-server.js -- sin ofertas reales, regresa [] y la
// seccion simplemente no se pinta (nunca inventado).
async function ofertasMarket(pool, idsPermitidos) {
    if (idsPermitidos.length === 0) return [];

    const resultado = await pool.query(
        `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.slug, n.nombre AS tienda, n.direccion,
                CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                CASE WHEN c.mostrar_existencias THEN p.stock END AS stock
         FROM public.productos p
         JOIN public.negocios n ON n.id = p.negocio_id
         JOIN public.sitio_web_config c ON c.negocio_id = n.id
         WHERE p.negocio_id = ANY($1::int[])
           AND p.precio_oferta IS NOT NULL
           AND p.precio_oferta < COALESCE(p.precio_publico, p.precio)
         LIMIT 12`,
        [idsPermitidos]
    );

    return mapearFilasProducto(resultado.rows);
}

function tarjetaTiendaMarketHtml(negocio) {
    const direccionHtml = negocio.direccion
        ? `<span class="market-tienda-direccion">${escaparHtml(negocio.direccion)}</span>`
        : "";
    return `<div class="market-tienda-card">
<strong>${escaparHtml(negocio.nombre)}</strong>
${negocio.giro ? `<span class="market-tienda-giro">${escaparHtml(negocio.giro)}</span>` : ""}
${direccionHtml}
<a class="btn secondary" href="https://${escaparHtml(negocio.slug)}.nexoposoficial.com">Ver tienda</a>
</div>`;
}

// Tarjeta de producto densa (v2) -- precio de oferta tachado + precio
// nuevo + badge cuando aplica, mismo criterio (nunca inventado) que
// el resto del proyecto: sin precioOferta valido, solo se ve el
// precio normal, igual que antes.
function tarjetaProductoMarketHtml(producto) {
    const tieneOferta = producto.precioOferta !== null && producto.precioOferta !== undefined
        && producto.precio !== null && producto.precio !== undefined
        && producto.precioOferta < producto.precio;

    let precioHtml = "";
    if (tieneOferta) {
        precioHtml = `<span class="market-producto-precio-tachado">$${Number(producto.precio).toFixed(2)}</span><span class="market-precio-actual">$${Number(producto.precioOferta).toFixed(2)}</span><span class="market-producto-badge-oferta">Oferta</span>`;
    } else if (producto.precio !== null && producto.precio !== undefined) {
        precioHtml = `<span class="market-precio-actual">$${Number(producto.precio).toFixed(2)}</span>`;
    }

    const existenciaHtml = producto.stock !== null && producto.stock !== undefined
        ? `<span class="market-producto-existencia${producto.stock <= 0 ? " agotado" : ""}">${producto.stock <= 0 ? "Agotado" : `${producto.stock} disponibles`}</span>`
        : "";

    return `<div class="market-producto-card">
<span class="market-producto-nombre">${escaparHtml(producto.nombre)}</span>
<span class="market-producto-precios">${precioHtml}</span>
${existenciaHtml}
<span class="market-producto-tienda">${escaparHtml(producto.tienda)}${producto.direccion ? ` &middot; ${escaparHtml(producto.direccion)}` : ""}</span>
<a class="btn primary" href="https://${escaparHtml(producto.slug)}.nexoposoficial.com/catalogo/${encodeURIComponent(producto.codigo)}">Ver en ${escaparHtml(producto.tienda)}</a>
</div>`;
}

// Busqueda/exploracion -- WHERE condicional (mismo patron que
// servirCatalogoNegocio): sin buscar ni categoria, lista todo
// paginado; con cualquiera de los dos, filtra. Ya no exige texto de
// busqueda para correr (alimenta tanto el buscador como "explorar
// por categoria" desde un chip del inicio).
async function buscarProductosMarket(pool, { buscar = "", categoria = "", pagina = 1 } = {}) {
    const tiendas = await tiendasPermitidasMarket(pool);
    if (tiendas.length === 0) return { productos: [], total: 0 };

    const idsPermitidos = tiendas.map(t => t.id);
    const offset = Math.max(0, (pagina - 1) * PRODUCTOS_POR_PAGINA_MARKET);

    const condiciones = ["p.negocio_id = ANY($1::int[])"];
    const parametros = [idsPermitidos];
    let orden = "p.nombre ASC";

    if (buscar) {
        parametros.push(buscar);
        const indiceBuscar = parametros.length;
        parametros.push(`%${buscar}%`);
        const indiceIlike = parametros.length;
        condiciones.push(`(p.nombre % $${indiceBuscar} OR p.codigo ILIKE $${indiceIlike} OR p.marca ILIKE $${indiceIlike})`);
        orden = `similarity(p.nombre, $${indiceBuscar}) DESC`;
    }

    if (categoria) {
        parametros.push(categoria);
        condiciones.push(`p.categoria = $${parametros.length}`);
    }

    parametros.push(PRODUCTOS_POR_PAGINA_MARKET);
    const indiceLimit = parametros.length;
    parametros.push(offset);
    const indiceOffset = parametros.length;

    const resultado = await pool.query(
        `
        SELECT p.codigo, p.nombre, p.categoria, p.marca, n.slug, n.nombre AS tienda, n.direccion,
               CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
               CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
               CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
               COUNT(*) OVER() AS total
        FROM public.productos p
        JOIN public.negocios n ON n.id = p.negocio_id
        JOIN public.sitio_web_config c ON c.negocio_id = n.id
        WHERE ${condiciones.join(" AND ")}
        ORDER BY ${orden}
        LIMIT $${indiceLimit} OFFSET $${indiceOffset}
        `,
        parametros
    );

    return {
        productos: mapearFilasProducto(resultado.rows),
        total: resultado.rows.length > 0 ? Number(resultado.rows[0].total) : 0
    };
}

// GET /market/inicio-json -- secciones del inicio (categorias,
// recomendados por oficio, ofertas reales, directorio de tiendas).
// La personalizacion se resuelve SIEMPRE desde la sesion del servidor
// (cookie de persona), nunca desde un query param del cliente.
async function inicioMarketJson(pool, req, res) {
    try {
        const resolverSesionOpcional = crearResolverSesionPersonaOpcional(pool);
        await new Promise(continuar => resolverSesionOpcional(req, res, continuar));

        const tiendas = await tiendasPermitidasMarket(pool);
        const idsPermitidos = tiendas.map(t => t.id);
        const claveOficio = req.persona?.oficio || null;

        const [categorias, recomendados, ofertas] = await Promise.all([
            categoriasMarket(pool),
            recomendadosMarket(pool, idsPermitidos, claveOficio),
            ofertasMarket(pool, idsPermitidos)
        ]);

        res.json({ ok: true, categorias, recomendados, ofertas, tiendas });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudo cargar el inicio de Nexo Market." });
    }
}

// GET /market/buscar-json?buscar=&categoria=&pagina= -- siempre
// productos paginados, ya no regresa el directorio de tiendas (se
// movio a inicio-json).
async function buscarMarketJson(pool, req, res) {
    try {
        const buscar = String(req.query?.buscar || "").trim().slice(0, 120);
        const categoria = String(req.query?.categoria || "").trim().slice(0, 120);
        const pagina = Math.max(1, parseInt(req.query?.pagina, 10) || 1);

        const { productos, total } = await buscarProductosMarket(pool, { buscar, categoria, pagina });
        res.json({ ok: true, productos, total, pagina });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudo completar la busqueda." });
    }
}

const ESTILOS_MARKET = `
.market-header-sesion{ display:flex; align-items:center; gap:12px; font-weight:700; }
.market-buscador{ display:flex; gap:10px; max-width:640px; margin:0 auto 28px; }
.market-buscador input{ flex:1; padding:14px 18px; border-radius:999px; border:1px solid var(--line); background:var(--glass); font:inherit; }
.market-buscador button{ border-radius:999px; }
.market-categorias-tira{ display:flex; gap:10px; overflow-x:auto; padding:4px 2px 20px; margin-bottom:8px; }
.market-categoria-chip{ display:flex; align-items:center; gap:8px; flex:0 0 auto; padding:9px 16px; border-radius:999px; border:1px solid var(--line); background:var(--glass); color:var(--ink); font:inherit; font-weight:700; font-size:13.5px; cursor:pointer; white-space:nowrap; }
.market-categoria-chip:hover{ border-color:var(--blue); color:var(--blue); }
.market-categoria-chip svg{ width:16px; height:16px; flex:0 0 auto; }
.market-seccion{ margin:0 0 36px; }
.market-seccion-header{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:14px; }
.market-seccion-header h3{ margin:0; font-size:19px; }
.market-tiendas-grid, .market-productos-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px; }
.market-tienda-card, .market-producto-card{ display:grid; gap:8px; align-content:start; padding:18px; border:1px solid rgba(255,255,255,.72); border-radius:20px; background:var(--glass); box-shadow:0 18px 48px rgba(20,32,51,.08); }
.market-tienda-giro{ color:var(--muted); font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
.market-tienda-direccion{ color:var(--muted); font-size:13.5px; }
.market-producto-nombre{ font-weight:800; font-size:15px; line-height:1.3; }
.market-producto-precios{ display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.market-precio-actual{ color:var(--blue-dark); font-weight:900; font-size:17px; }
.market-producto-precio-tachado{ color:var(--muted); text-decoration:line-through; font-size:13.5px; }
.market-producto-badge-oferta{ background:var(--amber); color:#fff; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; padding:2px 8px; border-radius:999px; }
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

<div id="marketInicio"><p class="market-vacio">Cargando...</p></div>
<div id="marketResultadosBusqueda" hidden></div>
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
        '<a class="btn secondary" href="https://' + escapeHtml(t.slug) + '.nexoposoficial.com">Ver tienda</a></div>';
}

function marketTarjetaProducto(p) {
    const tieneOferta = p.precioOferta !== null && p.precioOferta !== undefined
        && p.precio !== null && p.precio !== undefined && p.precioOferta < p.precio;

    let precioHtml = '';
    if (tieneOferta) {
        precioHtml = '<span class="market-producto-precio-tachado">$' + Number(p.precio).toFixed(2) + '</span>' +
            '<span class="market-precio-actual">$' + Number(p.precioOferta).toFixed(2) + '</span>' +
            '<span class="market-producto-badge-oferta">Oferta</span>';
    } else if (p.precio !== null && p.precio !== undefined) {
        precioHtml = '<span class="market-precio-actual">$' + Number(p.precio).toFixed(2) + '</span>';
    }

    const existenciaHtml = p.stock !== null && p.stock !== undefined
        ? '<span class="market-producto-existencia' + (p.stock <= 0 ? ' agotado' : '') + '">' + (p.stock <= 0 ? 'Agotado' : p.stock + ' disponibles') + '</span>' : '';

    return '<div class="market-producto-card"><span class="market-producto-nombre">' + escapeHtml(p.nombre) + '</span>' +
        '<span class="market-producto-precios">' + precioHtml + '</span>' +
        existenciaHtml +
        '<span class="market-producto-tienda">' + escapeHtml(p.tienda) + (p.direccion ? ' &middot; ' + escapeHtml(p.direccion) : '') + '</span>' +
        '<a class="btn primary" href="https://' + escapeHtml(p.slug) + '.nexoposoficial.com/catalogo/' + encodeURIComponent(p.codigo) + '">Ver en ' + escapeHtml(p.tienda) + '</a></div>';
}

function marketGridProductos(productos) {
    if (!productos || productos.length === 0) return '';
    return '<div class="market-productos-grid">' + productos.map(marketTarjetaProducto).join('') + '</div>';
}

function marketSeccion(titulo, contenidoHtml) {
    if (!contenidoHtml) return '';
    return '<section class="market-seccion"><div class="market-seccion-header"><h3>' + escapeHtml(titulo) + '</h3></div>' + contenidoHtml + '</section>';
}

var MARKET_ICONOS_CATEGORIA = [
    { patron: /herramient/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>' },
    { patron: /construc|alba|cemento|block|acero|ladrillo|varilla/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 21v-6h6v6"></path></svg>' },
    { patron: /electric|foco|lampara|cable/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 11 14 11 22 21 10 13 10 13 2"></polygon></svg>' },
    { patron: /plomer|tuber|agua|valvula|grifo/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c4 5 6 8.5 6 12a6 6 0 0 1-12 0c0-3.5 2-7 6-12Z"></path></svg>' },
    { patron: /pintura|barniz|brocha/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3 21 6l-9.5 9.5-4-4L18 3Z"></path><path d="M7 12 4 21l9-3"></path></svg>' },
    { patron: /segur|proteccion|casco|guante/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 6v6c0 5 4 8.5 9 10 5-1.5 9-5 9-10V6l-9-4Z"></path></svg>' },
    { patron: /jardin|planta|riego|pasto/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 4 13c0-4 4-9 7-11 3 2 7 7 7 11a7 7 0 0 1-7 7Z"></path></svg>' },
    { patron: /limpieza|escoba|detergente/i, svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 9-9"></path><path d="M12.5 4.5c1.5-1.5 4-1.5 5.5 0s1.5 4 0 5.5L9 19l-5.5 1.5L5 15l9-9Z"></path></svg>' }
];
var MARKET_ICONO_GENERICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>';

function marketIconoCategoria(nombre) {
    var match = MARKET_ICONOS_CATEGORIA.find(function(e) { return e.patron.test(nombre); });
    return match ? match.svg : MARKET_ICONO_GENERICO;
}

function marketTiraCategorias(categorias) {
    if (!categorias || categorias.length === 0) return '';
    var chips = categorias.map(function(cat) {
        return '<button type="button" class="market-categoria-chip" data-categoria="' + escapeHtml(cat) + '">' + marketIconoCategoria(cat) + '<span>' + escapeHtml(cat) + '</span></button>';
    }).join('');
    return '<div class="market-categorias-tira">' + chips + '</div>';
}

function marketMostrarInicio() {
    document.getElementById("marketInicio").style.display = "";
    document.getElementById("marketResultadosBusqueda").hidden = true;
}

function marketMostrarResultados() {
    document.getElementById("marketInicio").style.display = "none";
    document.getElementById("marketResultadosBusqueda").hidden = false;
}

async function marketCargarInicio() {
    const contenedor = document.getElementById("marketInicio");
    const datos = await marketLlamar("/market/inicio-json");

    if (!datos.ok) {
        contenedor.innerHTML = '<p class="market-vacio">No se pudo cargar Nexo Market.</p>';
        return;
    }

    let html = "";
    html += marketTiraCategorias(datos.categorias);
    html += marketSeccion("Recomendado para ti", marketGridProductos(datos.recomendados));
    html += marketSeccion("Ofertas", marketGridProductos(datos.ofertas));
    if (datos.tiendas && datos.tiendas.length > 0) {
        html += marketSeccion("Tiendas Nexo", '<div class="market-tiendas-grid">' + datos.tiendas.map(marketTarjetaTienda).join("") + '</div>');
    }

    contenedor.innerHTML = html || '<p class="market-vacio">Todavia no hay tiendas Nexo activas para mostrar aqui.</p>';

    document.querySelectorAll(".market-categoria-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.getElementById("marketBuscarInput").value = "";
            marketBuscarPorCategoria(chip.dataset.categoria);
        });
    });
}

async function marketBuscar(texto) {
    if (!texto) { marketMostrarInicio(); return; }

    marketMostrarResultados();
    const contenedor = document.getElementById("marketResultadosBusqueda");
    contenedor.innerHTML = '<p class="market-vacio">Buscando...</p>';

    const datos = await marketLlamar("/market/buscar-json?buscar=" + encodeURIComponent(texto));

    if (!datos.ok || datos.productos.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio">No encontramos productos para "' + escapeHtml(texto) + '".</p>';
        return;
    }

    contenedor.innerHTML = marketGridProductos(datos.productos);
}

async function marketBuscarPorCategoria(categoria) {
    marketMostrarResultados();
    const contenedor = document.getElementById("marketResultadosBusqueda");
    contenedor.innerHTML = '<p class="market-vacio">Buscando...</p>';

    const datos = await marketLlamar("/market/buscar-json?categoria=" + encodeURIComponent(categoria));

    if (!datos.ok || datos.productos.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio">No encontramos productos en "' + escapeHtml(categoria) + '".</p>';
        return;
    }

    contenedor.innerHTML = marketGridProductos(datos.productos);
}

document.getElementById("marketBuscadorForm").addEventListener("submit", evento => {
    evento.preventDefault();
    marketBuscar(document.getElementById("marketBuscarInput").value.trim());
});

marketCargarSesion();
marketCargarInicio();
</script>
</body>
</html>`;
}

async function servirMarketPagina(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(paginaMarketHtml());
}

module.exports = { servirMarketPagina, buscarMarketJson, inicioMarketJson, tiendasPermitidasMarket };

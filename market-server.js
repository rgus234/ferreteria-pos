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
// v2 (rediseno tipo marketplace): personalizacion por oficio (siempre
// desde la sesion del servidor, nunca un query param del cliente) +
// secciones reales de categorias/ofertas -- cada seccion solo se pinta
// si tiene contenido real, nunca un placeholder inventado.
//
// v3 (mockup tipo Amazon/Mercado Libre, marca propia): fotos reales de
// producto (reusa firmarTokenImagen tal cual, cross-tenant por diseño
// desde siempre), hero con foto real, picker de oficio inline, tira de
// categorias mas grande, carruseles, favoritos cruzados entre tiendas
// (100% cliente), y sidebar honesto donde no hay dato real (mapa,
// cronometro de oferta -- se avisa, nunca se inventa ni se oculta).

const { funcionDelPlan } = require("./plan-enforcement");
const { crearResolverSesionPersonaOpcional } = require("./personas-server");
const { OFICIOS_PERSONA } = require("./oficios-persona");
const { normalizarSlug } = require("./tenant");
const {
    estilosPortalClienteHtml,
    ICONO_PORTAL_PEDIDOS,
    ICONO_PORTAL_DIRECCION
} = require("./public-site-server");

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

// Mismo normalizador que ya usa public-site-server.js para armar
// enlaces wa.me reales (contacto directo, no mensajeria automatica) --
// copiado, no importado, mismo criterio del resto del proyecto.
function normalizarTelefonoWhatsAppMarket(telefono) {
    const digitos = String(telefono || "").replace(/\D/g, "");
    if (!digitos) return null;
    if (digitos.length === 10) return `52${digitos}`;
    return digitos.length >= 10 ? digitos : null;
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
        SELECT n.id, n.slug, n.nombre, n.giro, n.direccion, n.direccion_lat, n.direccion_lng, c.aceptar_solicitudes_credito AS acepta_credito
        FROM public.negocios n
        JOIN public.sitio_web_config c ON c.negocio_id = n.id
        WHERE n.estado = 'activo' AND c.activo = true AND n.visible_en_market = true
        ORDER BY n.nombre
    `);

    const permitidas = [];
    for (const negocio of candidatas.rows) {
        const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);
        if (acceso.incluido) {
            permitidas.push({
                id: negocio.id,
                slug: negocio.slug,
                nombre: negocio.nombre,
                giro: negocio.giro,
                direccion: negocio.direccion,
                lat: negocio.direccion_lat,
                lng: negocio.direccion_lng,
                aceptaCredito: Boolean(negocio.acepta_credito)
            });
        }
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

// Mismo shape de fila -> objeto de producto usado por las 4 consultas
// de productos de este archivo (buscar, recomendados, ofertas,
// favoritos) -- un solo lugar que decide como se mapea, sin duplicar.
// fotoUrl reusa firmarTokenImagen tal cual (server.js), el mismo
// mecanismo cross-tenant que ya sirven las fotos de cada sitio tenant
// -- sin foto real, fotoUrl queda en null, nunca se inventa una.
function mapearFilasProducto(rows, firmarTokenImagen) {
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
        stock: fila.stock !== null && fila.stock !== undefined ? Number(fila.stock) : null,
        fotoUrl: (fila.foto_actualizado_at && typeof firmarTokenImagen === "function")
            ? `/fotos-producto/${encodeURIComponent(fila.codigo)}/principal?negocio=${encodeURIComponent(fila.slug)}&v=${new Date(fila.foto_actualizado_at).getTime()}&token=${firmarTokenImagen(fila.negocio_id, fila.codigo)}`
            : null,
        envioModo: fila.envio_modo,
        envioTarifa: fila.envio_tarifa !== null && fila.envio_tarifa !== undefined ? Number(fila.envio_tarifa) : null,
        envioNotas: fila.envio_notas
    }));
}

// Personalizacion por oficio -- si la persona no tiene sesion o no
// eligio oficio (o eligio "otro"), regresa [] sin consultar (mismo
// criterio de "nunca inventar/rellenar" ya usado en el resto del
// proyecto, ej. destacadosTenantHtml). El patron regex del oficio se
// manda como texto al operador ~* de Postgres (case-insensitive,
// mismo criterio que el regex de JS).
async function recomendadosMarket(pool, idsPermitidos, claveOficio, firmarTokenImagen) {
    if (!claveOficio || idsPermitidos.length === 0) return [];

    const oficio = OFICIOS_PERSONA.find(o => o.clave === claveOficio);
    if (!oficio || !oficio.patron) return [];

    const resultado = await pool.query(
        `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.id AS negocio_id, n.slug, n.nombre AS tienda, n.direccion,
                CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
                fp.actualizado_at AS foto_actualizado_at, c.envio_modo, c.envio_tarifa, c.envio_notas
         FROM public.productos p
         JOIN public.negocios n ON n.id = p.negocio_id
         JOIN public.sitio_web_config c ON c.negocio_id = n.id
         LEFT JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
         WHERE p.negocio_id = ANY($1::int[]) AND p.categoria ~* $2
         LIMIT 12`,
        [idsPermitidos, oficio.patron.source]
    );

    return mapearFilasProducto(resultado.rows, firmarTokenImagen);
}

// Mismo criterio de "oferta real" que ya usa servirCatalogoNegocio en
// public-site-server.js -- sin ofertas reales, regresa [] (el sidebar
// pinta un aviso honesto en vez de una tarjeta inventada).
async function ofertasMarket(pool, idsPermitidos, firmarTokenImagen) {
    if (idsPermitidos.length === 0) return [];

    const resultado = await pool.query(
        `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.id AS negocio_id, n.slug, n.nombre AS tienda, n.direccion,
                CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
                fp.actualizado_at AS foto_actualizado_at, c.envio_modo, c.envio_tarifa, c.envio_notas
         FROM public.productos p
         JOIN public.negocios n ON n.id = p.negocio_id
         JOIN public.sitio_web_config c ON c.negocio_id = n.id
         LEFT JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
         WHERE p.negocio_id = ANY($1::int[])
           AND p.precio_oferta IS NOT NULL
           AND p.precio_oferta < COALESCE(p.precio_publico, p.precio)
         LIMIT 12`,
        [idsPermitidos]
    );

    return mapearFilasProducto(resultado.rows, firmarTokenImagen);
}

// Un producto real con foto para la imagen grande del hero -- rota al
// azar entre lo que de verdad existe. Si ningun negocio permitido
// tiene ningun producto con foto, regresa null y el hero cae a un
// fondo de gradiente (mismo fallback que ya usan los sitios tenant
// sin portada) en vez de una imagen inventada.
async function heroProductoMarket(pool, idsPermitidos, firmarTokenImagen) {
    if (idsPermitidos.length === 0 || typeof firmarTokenImagen !== "function") return null;

    const resultado = await pool.query(
        `SELECT p.codigo, p.nombre, n.id AS negocio_id, n.slug, n.nombre AS tienda, fp.actualizado_at AS foto_actualizado_at
         FROM public.productos p
         JOIN public.negocios n ON n.id = p.negocio_id
         JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
         WHERE p.negocio_id = ANY($1::int[])
         ORDER BY RANDOM()
         LIMIT 1`,
        [idsPermitidos]
    );

    if (resultado.rows.length === 0) return null;
    const fila = resultado.rows[0];

    return {
        codigo: fila.codigo,
        nombre: fila.nombre,
        tienda: fila.tienda,
        fotoUrl: `/fotos-producto/${encodeURIComponent(fila.codigo)}/principal?negocio=${encodeURIComponent(fila.slug)}&v=${new Date(fila.foto_actualizado_at).getTime()}&token=${firmarTokenImagen(fila.negocio_id, fila.codigo)}`
    };
}

// Una foto real por categoria para las tarjetas de "Explora por
// categoria" (pagina /market/explora) -- un producto al azar de esa
// categoria que si tenga foto real subida. Sin ningun producto con foto
// en la categoria, fotoUrl queda null y la tarjeta cae al icono
// generico (mismo criterio de honestidad que heroProductoMarket: nunca
// una imagen inventada ni repetida a la fuerza).
async function categoriasConFotoMarket(pool, firmarTokenImagen) {
    const categorias = await categoriasMarket(pool);
    if (categorias.length === 0) return [];
    if (typeof firmarTokenImagen !== "function") return categorias.map(nombre => ({ nombre, fotoUrl: null }));

    const tiendas = await tiendasPermitidasMarket(pool);
    const idsPermitidos = tiendas.map(t => t.id);

    const resultado = await pool.query(
        `SELECT DISTINCT ON (p.categoria) p.categoria, p.codigo, n.id AS negocio_id, n.slug, fp.actualizado_at AS foto_actualizado_at
         FROM public.productos p
         JOIN public.negocios n ON n.id = p.negocio_id
         JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
         WHERE p.negocio_id = ANY($1::int[]) AND p.categoria = ANY($2::text[])
         ORDER BY p.categoria, RANDOM()`,
        [idsPermitidos, categorias]
    );

    const fotoPorCategoria = new Map(resultado.rows.map(fila => [
        fila.categoria,
        `/fotos-producto/${encodeURIComponent(fila.codigo)}/principal?negocio=${encodeURIComponent(fila.slug)}&v=${new Date(fila.foto_actualizado_at).getTime()}&token=${firmarTokenImagen(fila.negocio_id, fila.codigo)}`
    ]));

    return categorias.map(nombre => ({ nombre, fotoUrl: fotoPorCategoria.get(nombre) || null }));
}

// "Productos populares" para /market/explora. No existe ningun conteo
// real de vistas ni de ventas cruzado entre tiendas en el sistema (ver
// nota en marketTarjetaOfertaDelDia mas abajo, mismo criterio) -- inventar
// un numero de "popularidad" seria mentirle al comprador. En su lugar se
// prioriza lo unico real y honesto que existe: productos que el propio
// dueño de cada tienda marco como destacados en su catalogo (columna
// "destacado", ver Fase F9), y se completa con productos con foto real
// de cualquier tienda para que la seccion no se quede vacia si pocos
// dueños han marcado destacados todavia. Siempre requiere foto real
// (INNER JOIN) -- nunca un producto sin imagen en esta seccion.
async function popularesMarket(pool, idsPermitidos, firmarTokenImagen, limite = 10) {
    if (idsPermitidos.length === 0) return [];

    const resultado = await pool.query(
        `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.id AS negocio_id, n.slug, n.nombre AS tienda, n.direccion,
                CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
                fp.actualizado_at AS foto_actualizado_at, c.envio_modo, c.envio_tarifa, c.envio_notas
         FROM public.productos p
         JOIN public.negocios n ON n.id = p.negocio_id
         JOIN public.sitio_web_config c ON c.negocio_id = n.id
         JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
         WHERE p.negocio_id = ANY($1::int[])
         ORDER BY p.destacado DESC, RANDOM()
         LIMIT $2`,
        [idsPermitidos, limite]
    );

    return mapearFilasProducto(resultado.rows, firmarTokenImagen);
}

// Busqueda/exploracion -- WHERE condicional (mismo patron que
// servirCatalogoNegocio): sin buscar ni categoria, lista todo
// paginado; con cualquiera de los dos, filtra. orden="recientes"
// (p.id DESC, proxy real de recencia -- productos no tiene columna de
// fecha de creacion) alimenta "Explora productos"/"Nuevos"; se ignora
// si hay texto de busqueda (la relevancia del texto manda).
async function buscarProductosMarket(pool, { buscar = "", categoria = "", ofertas = false, marcas = [], precioMin = null, precioMax = null, pagina = 1, orden = "relevancia", limite = PRODUCTOS_POR_PAGINA_MARKET } = {}, firmarTokenImagen) {
    const tiendas = await tiendasPermitidasMarket(pool);
    if (tiendas.length === 0) return { productos: [], total: 0 };

    const idsPermitidos = tiendas.map(t => t.id);
    const offset = Math.max(0, (pagina - 1) * limite);

    const condiciones = ["p.negocio_id = ANY($1::int[])"];
    const parametros = [idsPermitidos];
    let ordenSql = orden === "recientes" ? "p.id DESC"
        : orden === "precio_asc" ? "COALESCE(p.precio_oferta, p.precio_publico, p.precio) ASC NULLS LAST"
        : orden === "precio_desc" ? "COALESCE(p.precio_oferta, p.precio_publico, p.precio) DESC NULLS LAST"
        : "p.nombre ASC";

    if (buscar) {
        parametros.push(buscar);
        const indiceBuscar = parametros.length;
        parametros.push(`%${buscar}%`);
        const indiceIlike = parametros.length;
        // p.nombre % (similitud pg_trgm) por si solo, contra nombres largos
        // ("Dado punta corta bristol M12, cuadro 1/2', TRUPER"), diluye el
        // puntaje de una palabra corta bajo el umbral por defecto y no
        // encuentra nada aunque la palabra si este ahi -- se agrega ILIKE
        // sobre el nombre tambien para garantizar coincidencia literal
        // real ("bomba" siempre encuentra "Bomba..."), la similitud sigue
        // aportando tolerancia a errores de escritura y el orden de relevancia.
        condiciones.push(`(p.nombre % $${indiceBuscar} OR p.nombre ILIKE $${indiceIlike} OR p.codigo ILIKE $${indiceIlike} OR p.marca ILIKE $${indiceIlike})`);
        if (orden === "relevancia") ordenSql = `similarity(p.nombre, $${indiceBuscar}) DESC`;
    }

    if (categoria) {
        parametros.push(categoria);
        condiciones.push(`p.categoria = $${parametros.length}`);
    }

    // Misma condicion real que ya usa ofertasMarket() -- nunca se
    // inventa una regla distinta de "producto en oferta".
    if (ofertas) {
        condiciones.push(`p.precio_oferta IS NOT NULL AND p.precio_oferta < COALESCE(p.precio_publico, p.precio)`);
    }

    if (marcas.length > 0) {
        parametros.push(marcas);
        condiciones.push(`p.marca = ANY($${parametros.length}::text[])`);
    }

    // Nunca se excluye un producto por precio si esa tienda oculta
    // precios (mostrar_precios=false) -- filtrar/ordenar por un dato
    // que no se muestra seria una fuga de informacion indirecta.
    if (precioMin !== null) {
        parametros.push(precioMin);
        condiciones.push(`(NOT c.mostrar_precios OR COALESCE(p.precio_oferta, p.precio_publico, p.precio) >= $${parametros.length})`);
    }
    if (precioMax !== null) {
        parametros.push(precioMax);
        condiciones.push(`(NOT c.mostrar_precios OR COALESCE(p.precio_oferta, p.precio_publico, p.precio) <= $${parametros.length})`);
    }

    parametros.push(limite);
    const indiceLimit = parametros.length;
    parametros.push(offset);
    const indiceOffset = parametros.length;

    const resultado = await pool.query(
        `
        SELECT p.codigo, p.nombre, p.categoria, p.marca, n.id AS negocio_id, n.slug, n.nombre AS tienda, n.direccion,
               CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
               CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
               CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
               fp.actualizado_at AS foto_actualizado_at,
               c.envio_modo, c.envio_tarifa, c.envio_notas,
               COUNT(*) OVER() AS total
        FROM public.productos p
        JOIN public.negocios n ON n.id = p.negocio_id
        JOIN public.sitio_web_config c ON c.negocio_id = n.id
        LEFT JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
        WHERE ${condiciones.join(" AND ")}
        ORDER BY ${ordenSql}
        LIMIT $${indiceLimit} OFFSET $${indiceOffset}
        `,
        parametros
    );

    return {
        productos: mapearFilasProducto(resultado.rows, firmarTokenImagen),
        total: resultado.rows.length > 0 ? Number(resultado.rows[0].total) : 0
    };
}

// Facetas reales (marcas con conteo + rango de precio) calculadas
// sobre buscar+categoria unicamente (no sobre marca/precio elegidos) --
// asi los checkboxes de marca no se autolimitan entre si, mismo criterio
// de faceted search estandar. Sin datos reales, regresa listas vacias
// (nunca se inventan marcas ni un rango de precio de relleno).
async function facetasMarket(pool, idsPermitidos, { buscar = "", categoria = "", ofertas = false } = {}) {
    if (idsPermitidos.length === 0) return { marcas: [], precioMin: null, precioMax: null };

    const condiciones = ["p.negocio_id = ANY($1::int[])"];
    const parametros = [idsPermitidos];

    if (buscar) {
        parametros.push(buscar);
        const indiceBuscar = parametros.length;
        parametros.push(`%${buscar}%`);
        const indiceIlike = parametros.length;
        // Mismo fix que buscarProductosMarket: ILIKE sobre nombre
        // garantiza match literal aunque pg_trgm diluya palabras cortas
        // contra nombres largos.
        condiciones.push(`(p.nombre % $${indiceBuscar} OR p.nombre ILIKE $${indiceIlike} OR p.codigo ILIKE $${indiceIlike} OR p.marca ILIKE $${indiceIlike})`);
    }

    if (categoria) {
        parametros.push(categoria);
        condiciones.push(`p.categoria = $${parametros.length}`);
    }

    if (ofertas) {
        condiciones.push(`p.precio_oferta IS NOT NULL AND p.precio_oferta < COALESCE(p.precio_publico, p.precio)`);
    }

    const whereBase = condiciones.join(" AND ");

    const [marcasRes, precioRes] = await Promise.all([
        pool.query(
            `SELECT p.marca, COUNT(*) AS total
             FROM public.productos p
             WHERE ${whereBase} AND p.marca <> ''
             GROUP BY p.marca
             ORDER BY COUNT(*) DESC
             LIMIT 12`,
            parametros
        ),
        pool.query(
            `SELECT MIN(COALESCE(p.precio_oferta, p.precio_publico, p.precio)) AS min,
                    MAX(COALESCE(p.precio_oferta, p.precio_publico, p.precio)) AS max
             FROM public.productos p
             JOIN public.sitio_web_config c ON c.negocio_id = p.negocio_id
             WHERE ${whereBase} AND c.mostrar_precios = true`,
            parametros
        )
    ]);

    return {
        marcas: marcasRes.rows.map(f => ({ marca: f.marca, total: Number(f.total) })),
        precioMin: precioRes.rows[0]?.min != null ? Number(precioRes.rows[0].min) : null,
        precioMax: precioRes.rows[0]?.max != null ? Number(precioRes.rows[0].max) : null
    };
}

// GET /market/inicio-json -- secciones del inicio (hero, categorias,
// recomendados por oficio, ofertas reales, directorio de tiendas). La
// personalizacion se resuelve SIEMPRE desde la sesion del servidor
// (cookie de persona), nunca desde un query param del cliente.
async function inicioMarketJson(pool, req, res, firmarTokenImagen) {
    try {
        const resolverSesionOpcional = crearResolverSesionPersonaOpcional(pool);
        await new Promise(continuar => resolverSesionOpcional(req, res, continuar));

        const tiendas = await tiendasPermitidasMarket(pool);
        const idsPermitidos = tiendas.map(t => t.id);
        const claveOficio = req.persona?.oficio || null;

        const [categorias, recomendados, ofertas, hero] = await Promise.all([
            categoriasMarket(pool),
            recomendadosMarket(pool, idsPermitidos, claveOficio, firmarTokenImagen),
            ofertasMarket(pool, idsPermitidos, firmarTokenImagen),
            heroProductoMarket(pool, idsPermitidos, firmarTokenImagen)
        ]);

        res.json({
            ok: true,
            hero,
            categorias,
            recomendados,
            ofertas,
            tiendas,
            persona: req.persona ? { oficio: req.persona.oficio || null } : null
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudo cargar el inicio de Nexo Market." });
    }
}

// GET /market/buscar-json?buscar=&categoria=&pagina=&orden= -- siempre
// productos paginados, ya no regresa el directorio de tiendas (se
// movio a inicio-json).
async function buscarMarketJson(pool, req, res, firmarTokenImagen) {
    try {
        const buscar = String(req.query?.buscar || "").trim().slice(0, 120);
        const categoria = String(req.query?.categoria || "").trim().slice(0, 120);
        const ofertas = req.query?.ofertas === "1";
        const marcas = String(req.query?.marcas || "").split(",").map(m => m.trim()).filter(Boolean).slice(0, 12);
        const precioMinCrudo = req.query?.precioMin !== undefined ? Number(req.query.precioMin) : NaN;
        const precioMaxCrudo = req.query?.precioMax !== undefined ? Number(req.query.precioMax) : NaN;
        const precioMin = Number.isFinite(precioMinCrudo) && precioMinCrudo >= 0 ? precioMinCrudo : null;
        const precioMax = Number.isFinite(precioMaxCrudo) && precioMaxCrudo >= 0 ? precioMaxCrudo : null;
        const pagina = Math.max(1, parseInt(req.query?.pagina, 10) || 1);
        const ordenesValidos = new Set(["relevancia", "recientes", "precio_asc", "precio_desc", "nombre"]);
        const orden = ordenesValidos.has(req.query?.orden) ? req.query.orden : "relevancia";

        const tiendas = await tiendasPermitidasMarket(pool);
        const idsPermitidos = tiendas.map(t => t.id);

        const [{ productos, total }, facetas] = await Promise.all([
            buscarProductosMarket(pool, { buscar, categoria, ofertas, marcas, precioMin, precioMax, pagina, orden }, firmarTokenImagen),
            facetasMarket(pool, idsPermitidos, { buscar, categoria, ofertas })
        ]);

        res.json({ ok: true, productos, total, pagina, facetas });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudo completar la busqueda." });
    }
}

// GET /market/sugerencias-json?buscar= -- version ligera de la busqueda
// para el buscador en vivo (conforme se escribe): mismo motor real de
// busqueda cruzada (pg_trgm sobre nombre + ILIKE sobre codigo/marca,
// SIN IA), pero sin calcular facetas (serian trabajo de sobra en cada
// tecla) y con un limite chico. "bomba" encuentra todo tipo de bombas
// por el mismo indice de similitud que ya usa la busqueda completa.
async function sugerenciasMarketJson(pool, req, res, firmarTokenImagen) {
    try {
        const buscar = String(req.query?.buscar || "").trim().slice(0, 120);
        if (!buscar) { res.json({ ok: true, productos: [] }); return; }

        const { productos } = await buscarProductosMarket(pool, { buscar, limite: 8 }, firmarTokenImagen);
        res.json({ ok: true, productos });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudieron cargar sugerencias." });
    }
}

// POST /market/favoritos-json -- favoritos de Market son 100% cliente
// (localStorage, cruzan tiendas a proposito, ver marketFavoritosLeer
// en el script del inicio). Recibe los pares {slug,codigo} guardados
// y regresa datos frescos (precio/stock/foto actuales); un slug fuera
// de las tiendas permitidas o un codigo que ya no existe simplemente
// no aparece en la respuesta, nunca un error.
async function favoritosMarketJson(pool, req, res, firmarTokenImagen) {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
        if (items.length === 0) { res.json({ ok: true, productos: [] }); return; }

        const tiendas = await tiendasPermitidasMarket(pool);
        const idPorSlug = new Map(tiendas.map(t => [t.slug, t.id]));

        const paresValidos = items.filter(it =>
            it && typeof it.slug === "string" && typeof it.codigo === "string" && idPorSlug.has(it.slug)
        );

        if (paresValidos.length === 0) { res.json({ ok: true, productos: [] }); return; }

        const negociosIds = [...new Set(paresValidos.map(p => idPorSlug.get(p.slug)))];
        const codigos = [...new Set(paresValidos.map(p => p.codigo))];

        const resultado = await pool.query(
            `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.id AS negocio_id, n.slug, n.nombre AS tienda, n.direccion,
                    CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                    CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                    CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
                    fp.actualizado_at AS foto_actualizado_at, c.envio_modo, c.envio_tarifa, c.envio_notas
             FROM public.productos p
             JOIN public.negocios n ON n.id = p.negocio_id
             JOIN public.sitio_web_config c ON c.negocio_id = n.id
             LEFT JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
             WHERE p.negocio_id = ANY($1::int[]) AND p.codigo = ANY($2::text[])`,
            [negociosIds, codigos]
        );

        // El filtro de arriba es por negocio_id+codigo -- si el mismo
        // codigo existe en 2 tiendas distintas puede traer de mas, se
        // recorta aqui a exactamente los pares slug+codigo pedidos.
        const pedidos = new Set(paresValidos.map(p => `${p.slug}:${p.codigo}`));
        const filas = resultado.rows.filter(f => pedidos.has(`${f.slug}:${f.codigo}`));

        res.json({ ok: true, productos: mapearFilasProducto(filas, firmarTokenImagen) });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudieron cargar tus favoritos." });
    }
}

// /market/carrito lee el carrito de cada tienda desde localStorage
// (nexoCarrito_{slug}, uno por tienda visitada, items {codigo,nombre,cantidad}
// sin precio/foto) -- esta ruta resuelve esos pares slug+codigo contra
// datos reales (precio, oferta, existencia, foto), mismo patron cruzado
// entre tiendas que favoritosMarketJson (misma query, mismo filtro final
// por pares exactos para no confundir un codigo que coincide en 2
// tiendas distintas). "cantidad" no se valida contra nada -- no existe
// tabla de carrito en el servidor, sigue siendo 100% localStorage, solo
// se hace eco de vuelta pegada a cada producto ya resuelto.
async function carritoProductosMarketJson(pool, req, res, firmarTokenImagen) {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
        if (items.length === 0) { res.json({ ok: true, productos: [], relacionados: [] }); return; }

        const tiendas = await tiendasPermitidasMarket(pool);
        const idPorSlug = new Map(tiendas.map(t => [t.slug, t.id]));

        const paresValidos = items.filter(it =>
            it && typeof it.slug === "string" && typeof it.codigo === "string" && idPorSlug.has(it.slug)
        );

        if (paresValidos.length === 0) { res.json({ ok: true, productos: [], relacionados: [] }); return; }

        const negociosIds = [...new Set(paresValidos.map(p => idPorSlug.get(p.slug)))];
        const codigos = [...new Set(paresValidos.map(p => p.codigo))];

        const resultado = await pool.query(
            `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.id AS negocio_id, n.slug, n.nombre AS tienda, n.direccion,
                    n.pedido_prep_min, n.pedido_prep_max, c.whatsapp,
                    CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                    CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                    CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
                    fp.actualizado_at AS foto_actualizado_at, c.envio_modo, c.envio_tarifa, c.envio_notas
             FROM public.productos p
             JOIN public.negocios n ON n.id = p.negocio_id
             JOIN public.sitio_web_config c ON c.negocio_id = n.id
             LEFT JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
             WHERE p.negocio_id = ANY($1::int[]) AND p.codigo = ANY($2::text[])`,
            [negociosIds, codigos]
        );

        const cantidadPorPar = new Map(paresValidos.map(p => [`${p.slug}:${p.codigo}`, Math.min(9999, Math.max(1, parseInt(p.cantidad, 10) || 1))]));
        const filas = resultado.rows.filter(f => cantidadPorPar.has(`${f.slug}:${f.codigo}`));

        // pedidoPrepMin/Max y whatsappUrl son a nivel de negocio (igual
        // que envioModo/envioTarifa arriba), pegados a cada fila -- el
        // checkout de una sola tienda los lee del primer producto.
        const extrasPorPar = new Map(filas.map(f => [`${f.slug}:${f.codigo}`, {
            pedidoPrepMin: f.pedido_prep_min,
            pedidoPrepMax: f.pedido_prep_max,
            whatsappUrl: normalizarTelefonoWhatsAppMarket(f.whatsapp) ? `https://wa.me/${normalizarTelefonoWhatsAppMarket(f.whatsapp)}` : null
        }]));

        const productos = mapearFilasProducto(filas, firmarTokenImagen).map(p => ({
            ...p,
            cantidad: cantidadPorPar.get(`${p.slug}:${p.codigo}`),
            ...extrasPorPar.get(`${p.slug}:${p.codigo}`)
        }));

        const categorias = [...new Set(productos.map(p => p.categoria).filter(Boolean))];
        let relacionados = [];

        if (categorias.length > 0) {
            const codigosExcluir = productos.map(p => p.codigo);
            const filasRelacionadas = await pool.query(
                `SELECT p.codigo, p.nombre, p.categoria, p.marca, n.id AS negocio_id, n.slug, n.nombre AS tienda, n.direccion,
                        CASE WHEN c.mostrar_precios THEN COALESCE(p.precio_publico, p.precio) END AS precio,
                        CASE WHEN c.mostrar_precios THEN p.precio_oferta END AS precio_oferta,
                        CASE WHEN c.mostrar_existencias THEN p.stock END AS stock,
                        fp.actualizado_at AS foto_actualizado_at, c.envio_modo, c.envio_tarifa, c.envio_notas
                 FROM public.productos p
                 JOIN public.negocios n ON n.id = p.negocio_id
                 JOIN public.sitio_web_config c ON c.negocio_id = n.id
                 LEFT JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = p.codigo
                 WHERE p.negocio_id = ANY($1::int[]) AND p.categoria = ANY($2::text[]) AND p.codigo <> ALL($3::text[])
                 LIMIT 8`,
                [[...idPorSlug.values()], categorias, codigosExcluir]
            );
            relacionados = mapearFilasProducto(filasRelacionadas.rows, firmarTokenImagen);
        }

        res.json({ ok: true, productos, relacionados });
    } catch (error) {
        res.status(500).json({ ok: false, error: "No se pudieron cargar los productos de tu carrito." });
    }
}

// Meta/link tags + registro del Service Worker que hacen a Nexo Market
// instalable en el celular ("Agregar a pantalla de inicio"), mismo
// patron ya validado en /dueno (manifest.json + dueno-sw.js) pero con
// su propio manifest/icono de marca "Nexo Market". Se inserta en las 4
// paginas que arman su propio <head> (esta misma, market-tienda-server.js,
// market-carrito-server.js, market-cuenta-server.js) justo despues del
// <link rel="icon"> -- mismo criterio de reuso que marketHeaderHtml.
function metaInstalableMarketHtml() {
    return `<link rel="manifest" href="/manifest-market.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Nexo Market">
<link rel="apple-touch-icon" href="/icons/nexo-pos-icon-192.png">
<meta name="theme-color" content="#1067e8">
<script>if ("serviceWorker" in navigator) { navigator.serviceWorker.register("/market-sw.js", { scope: "/market/" }).catch(function() {}); }</script>`;
}

const ESTILOS_MARKET = `
.market-header{ position:sticky; top:0; z-index:30; background:linear-gradient(180deg,#101826,#0b1220); border-bottom:1px solid rgba(255,255,255,.08); box-shadow:0 10px 30px rgba(6,10,18,.28); }
.market-header-top{ display:flex; align-items:center; gap:18px; padding:14px clamp(18px,4vw,48px); max-width:1680px; margin:0 auto; }
.market-logo{ display:inline-flex; align-items:center; gap:10px; font-weight:950; font-size:18px; flex:0 0 auto; color:#fff; }
.market-logo img{ width:38px; height:38px; border-radius:11px; object-fit:cover; }
.market-search-wrap{ position:relative; flex:1; min-width:0; }
.market-search-bar{ display:flex; width:100%; min-width:0; border:1px solid rgba(255,255,255,.14); border-radius:999px; overflow:hidden; background:#fff; box-shadow:0 10px 26px rgba(4,8,16,.32); }
.market-search-bar select{ border:none; background:var(--paper); padding:0 14px; font:inherit; font-size:13px; color:var(--muted); max-width:170px; border-right:1px solid var(--line); }
.market-search-bar input{ flex:1; min-width:0; border:none; padding:12px 14px; font:inherit; outline:none; }
.market-search-bar button{ border:none; background:var(--blue); color:#fff; padding:0 20px; cursor:pointer; display:flex; align-items:center; }
.market-search-bar button svg{ width:18px; height:18px; }
.market-sugerencias{ position:absolute; top:calc(100% + 10px); left:0; right:0; background:#fff; border-radius:18px; box-shadow:0 22px 50px rgba(4,8,16,.28); overflow:hidden; z-index:40; }
.market-sugerencia-item{ display:flex; align-items:center; gap:12px; padding:10px 14px; color:var(--ink); border-bottom:1px solid var(--line); }
.market-sugerencia-item:last-of-type{ border-bottom:none; }
.market-sugerencia-item:hover{ background:var(--paper); }
.market-sugerencia-foto{ width:42px; height:42px; flex:0 0 auto; border-radius:10px; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden; color:var(--muted); }
.market-sugerencia-foto img{ width:100%; height:100%; object-fit:cover; }
.market-sugerencia-foto svg{ width:20px; height:20px; }
.market-sugerencia-texto{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.market-sugerencia-texto strong{ font-size:13.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.market-sugerencia-texto small{ color:var(--muted); font-size:12px; }
.market-sugerencia-precio{ flex:0 0 auto; font-weight:900; color:var(--blue-dark); font-size:13.5px; }
.market-sugerencias-vacio{ padding:16px 14px; color:var(--muted); font-size:13px; margin:0; text-align:center; }
.market-sugerencias-vertodo{ display:block; width:100%; border:none; background:var(--paper); color:var(--blue); font-weight:700; font-size:13px; padding:12px 14px; cursor:pointer; text-align:center; }
.market-sugerencias-vertodo:hover{ background:var(--glass); }
.market-header-acciones{ display:flex; align-items:center; gap:16px; flex:0 0 auto; }
.market-header-link{ display:inline-flex; align-items:center; gap:6px; font-weight:700; font-size:13.5px; white-space:nowrap; position:relative; color:rgba(255,255,255,.86); }
.market-header-link:hover{ color:#fff; }
.market-header-link svg{ width:19px; height:19px; }
.market-favoritos-contador{ background:var(--blue); color:#fff; font-size:10.5px; font-weight:800; border-radius:999px; padding:1px 6px; min-width:16px; text-align:center; }
.market-header-nav{ display:flex; gap:22px; padding:6px clamp(18px,4vw,48px) 13px; max-width:1680px; margin:0 auto; overflow-x:auto; background:transparent; border:none; border-radius:0; }
.market-header-nav a{ font-size:13.5px; font-weight:700; color:#fff; white-space:nowrap; opacity:.88; padding-bottom:2px; border-bottom:2px solid transparent; background:none; border-radius:0; }
.market-header-nav a:hover,
.market-header-nav a:focus,
.market-header-nav a:active{ opacity:1; border-bottom-color:rgba(255,255,255,.6); color:#fff; background:none; }
.market-header-nav a.activo{ opacity:1; border-bottom-color:#fff; font-weight:800; color:#fff; }
.market-banners-scope{ max-width:1680px; margin:24px auto 0; padding:0 clamp(18px,4vw,48px); }
.market-banners-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:18px; }
.market-banner-card{ position:relative; display:block; min-height:180px; border-radius:18px; overflow:hidden; color:#fff; box-shadow:0 16px 40px rgba(20,32,51,.14); }
.market-banner-card img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.market-banner-overlay{ position:relative; height:100%; min-height:180px; display:flex; flex-direction:column; justify-content:center; gap:8px; padding:24px clamp(20px,4vw,36px); background:linear-gradient(120deg, rgba(0,0,0,.62), rgba(0,0,0,.18) 70%); }
.market-banner-card.tema-azul .market-banner-overlay{ background:linear-gradient(120deg, rgba(7,63,154,.82), rgba(16,103,232,.35)); }
.market-banner-card.tema-negro .market-banner-overlay{ background:linear-gradient(120deg, rgba(11,18,32,.86), rgba(31,41,55,.4)); }
.market-banner-card.tema-rojo .market-banner-overlay{ background:linear-gradient(120deg, rgba(127,29,29,.82), rgba(220,38,38,.35)); }
.market-banner-card.tema-verde .market-banner-overlay{ background:linear-gradient(120deg, rgba(20,83,45,.82), rgba(22,163,74,.35)); }
.market-banner-card.tema-morado .market-banner-overlay{ background:linear-gradient(120deg, rgba(76,29,149,.82), rgba(124,58,237,.35)); }
.market-banner-card.tema-naranja .market-banner-overlay{ background:linear-gradient(120deg, rgba(154,52,18,.82), rgba(249,115,22,.35)); }
.market-banner-overlay h3{ margin:0; font-size:22px; line-height:1.2; }
.market-banner-overlay p{ margin:0; font-size:13.5px; opacity:.92; max-width:320px; }
.market-banner-btn{ display:inline-flex; width:fit-content; margin-top:6px; }
.market-ofertas-dia-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; overflow-x:visible; }
.market-oferta-agregar-carrito{ width:100%; border:none; font-size:12.5px; }
.market-oferta-agregar-carrito:disabled{ opacity:.55; cursor:not-allowed; }
@media (max-width:640px){
  .market-banners-grid{ grid-template-columns:1fr; }
}
.market-hero{ display:grid; grid-template-columns:1.1fr .9fr; gap:32px; align-items:center; max-width:1680px; margin:28px auto; padding:0 clamp(18px,4vw,48px); min-width:0; }
.market-hero > *{ min-width:0; }
.market-hero-texto h1{ font-size:clamp(28px,3.4vw,42px); margin:0 0 12px; line-height:1.1; }
.market-hero-texto p{ color:var(--muted); font-size:15.5px; max-width:520px; margin:0 0 18px; }
.market-hero-chips{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:22px; }
.market-hero-chips span{ background:var(--glass); border:1px solid var(--line); border-radius:999px; padding:7px 14px; font-size:12.5px; font-weight:700; }
.market-hero-acciones{ display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
.market-hero-como{ font-weight:700; font-size:13.5px; text-decoration:underline; }
.market-hero-imagen{ position:relative; border-radius:26px; overflow:hidden; min-height:280px; box-shadow:var(--shadow); background:linear-gradient(135deg,var(--ink),var(--blue-dark)); display:flex; align-items:flex-end; }
.market-hero-imagen img{ width:100%; height:100%; object-fit:cover; position:absolute; inset:0; }
.market-hero-imagen-tienda{ position:relative; z-index:1; margin:16px; padding:6px 14px; background:rgba(20,32,51,.66); color:#fff; border-radius:999px; font-size:12px; font-weight:700; }
.market-anchor{ display:block; scroll-margin-top:130px; }
#marketInicio, #marketResultadosBusqueda{ animation:marketPantallaFade .28s ease; }
@keyframes marketPantallaFade{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:translateY(0); } }
.market-layout{ display:grid; grid-template-columns:1fr 320px; gap:32px; max-width:1680px; margin:0 auto; padding:0 clamp(18px,4vw,48px) 60px; align-items:start; min-width:0; }
.market-contenido, .market-sidebar{ min-width:0; }
.market-sidebar{ position:sticky; top:150px; display:grid; gap:18px; }
.market-sidebar-card{ background:#fff; border:1px solid var(--line); border-radius:20px; padding:18px; box-shadow:0 18px 48px rgba(20,32,51,.1); }
.market-sidebar-card h4{ margin:0 0 12px; font-size:15px; }
.market-mapa-tiendas{ height:220px; border-radius:16px; overflow:hidden; margin-bottom:14px; border:1px solid var(--line); }
.market-vacio-chico{ color:var(--muted); font-size:13px; margin:0; }
.market-tienda-fila{ display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); font-size:13.5px; }
.market-tienda-fila:last-child{ border-bottom:none; }
.market-tienda-fila-numero{ color:var(--muted); font-weight:800; width:16px; }
.market-tienda-fila-nombre{ font-weight:700; flex:1; }
.market-tienda-fila-giro{ color:var(--muted); font-size:12px; }
.market-tienda-fila-distancia{ background:var(--paper); color:var(--blue); font-weight:700; font-size:11.5px; padding:3px 9px; border-radius:999px; white-space:nowrap; }
.market-ubicacion-boton{ display:block; width:100%; border:1px solid var(--line); background:#fff; color:var(--blue); font-weight:700; font-size:12.5px; padding:9px 10px; border-radius:12px; cursor:pointer; margin-bottom:10px; }
.market-ubicacion-boton:hover{ border-color:var(--blue); }
.market-oferta-nombre{ display:block; font-size:14px; margin-bottom:8px; }
.market-oferta-precios{ display:flex; align-items:baseline; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
.market-credito-lista{ list-style:none; margin:8px 0 0; padding:0; display:grid; gap:8px; }
.market-credito-lista a{ font-weight:700; font-size:13.5px; }
.market-categorias-tira, .market-categorias-grid{ display:flex; gap:14px; overflow-x:auto; padding:6px 2px 22px; }
.market-categorias-grid{ flex-wrap:wrap; overflow-x:visible; }
.market-categoria-tile{ display:flex; flex-direction:column; align-items:center; gap:8px; flex:0 0 auto; width:104px; padding:14px 8px; border-radius:16px; border:1px solid var(--line); background:#fff; cursor:pointer; }
.market-categoria-tile:hover{ border-color:var(--blue); }
.market-categoria-tile-icono{ width:38px; height:38px; display:flex; align-items:center; justify-content:center; border-radius:12px; background:var(--paper); color:var(--blue); }
.market-categoria-tile-icono svg{ width:20px; height:20px; }
.market-categoria-tile-label{ font-size:12px; font-weight:700; text-align:center; line-height:1.25; }

/* Explora por categoria (foto real) + Productos populares + Ferreterias
   cerca de ti -- pagina /market/explora. */
.market-categorias-grid-foto{ display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:16px; }
.market-categoria-tile-foto{ display:flex; flex-direction:column; gap:10px; padding:12px; border-radius:16px; border:1px solid var(--line); background:#fff; box-shadow:0 10px 26px rgba(20,32,51,.06); transition:transform .16s ease, box-shadow .16s ease; }
.market-categoria-tile-foto:hover{ transform:translateY(-2px); box-shadow:0 16px 34px rgba(20,32,51,.12); border-color:var(--blue); }
.market-categoria-tile-imagen{ aspect-ratio:1; border-radius:12px; overflow:hidden; background:var(--paper); display:flex; align-items:center; justify-content:center; }
.market-categoria-tile-imagen img{ width:100%; height:100%; object-fit:cover; }
.market-categoria-tile-icono-generico{ color:var(--muted); width:36px; height:36px; }
.market-categoria-tile-icono-generico svg{ width:100%; height:100%; }
.market-categoria-tile-foto .market-categoria-tile-label{ text-align:left; }
.market-explora-seccion{ margin-top:38px; }
.market-explora-seccion h2{ margin:0 0 16px; font-size:19px; }
.market-productos-grid-wrap{ display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); overflow-x:visible; }
.market-productos-grid-wrap .market-producto-card{ flex:none; width:auto; }
.market-explora-cerca-header{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
.market-explora-cerca-header h2{ margin:0; }
.market-ubicacion-boton-inline{ display:inline-block; width:auto; margin-bottom:0; }
.market-tiendas-cerca-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; }
.market-tienda-cerca-card{ display:flex; flex-direction:column; gap:8px; padding:16px; border:1px solid var(--line); border-radius:18px; background:#fff; box-shadow:0 14px 36px rgba(20,32,51,.08); color:var(--ink); transition:transform .16s ease, box-shadow .16s ease; }
.market-tienda-cerca-card:hover{ transform:translateY(-3px); box-shadow:0 20px 44px rgba(20,32,51,.14); border-color:var(--blue); }
.market-tienda-cerca-avatar{ width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:15px; }
.market-tienda-cerca-distancia{ color:var(--blue); font-weight:700; font-size:12.5px; }
.market-oficio{ margin:0 0 32px; padding:20px; border-radius:20px; background:var(--glass); border:1px solid var(--line); }
.market-oficio h3{ margin:0 0 4px; font-size:17px; }
.market-oficio p{ margin:0 0 14px; color:var(--muted); font-size:13.5px; }
.market-oficio-chips{ display:flex; flex-wrap:wrap; gap:10px; }
.market-oficio-chip{ display:flex; align-items:center; gap:8px; padding:9px 14px; border-radius:999px; border:1px solid var(--line); background:#fff; font:inherit; font-weight:700; font-size:13px; cursor:pointer; }
.market-oficio-chip:hover{ border-color:var(--blue); color:var(--blue); }
.market-oficio-chip svg{ width:16px; height:16px; }
.market-seccion{ margin:0 0 36px; }
.market-seccion-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.market-seccion-header h3{ margin:0; font-size:19px; }
.market-carousel-flechas{ display:flex; gap:8px; }
.market-carousel-flecha{ width:32px; height:32px; border-radius:999px; border:1px solid var(--line); background:#fff; cursor:pointer; font-size:15px; }
.market-carousel-flecha:hover{ border-color:var(--blue); color:var(--blue); }
.market-tiendas-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; }
.market-productos-grid{ display:flex; gap:14px; overflow-x:auto; scroll-snap-type:x proximity; padding-bottom:6px; }
.market-tienda-card, .market-producto-card{ display:grid; gap:8px; align-content:start; padding:16px; border:1px solid var(--line); border-radius:18px; background:#fff; box-shadow:0 14px 36px rgba(20,32,51,.08); transition:transform .16s ease, box-shadow .16s ease; }
.market-producto-card{ position:relative; flex:0 0 200px; scroll-snap-align:start; }
.market-producto-card:hover{ transform:translateY(-3px); box-shadow:0 20px 44px rgba(20,32,51,.14); }
.market-tiendas-grid .market-tienda-card{ background:var(--glass); }
.market-tienda-giro{ color:var(--muted); font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; }
.market-tienda-direccion{ color:var(--muted); font-size:13.5px; }
.market-producto-foto{ width:100%; aspect-ratio:1/1; border-radius:12px; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden; color:var(--muted); }
.market-producto-foto img{ width:100%; height:100%; object-fit:cover; }
.market-producto-foto svg{ width:34px; height:34px; }
.market-producto-favorito{ position:absolute; top:10px; right:10px; width:32px; height:32px; border-radius:999px; border:none; background:rgba(255,255,255,.9); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; color:var(--ink); cursor:pointer; }
.market-producto-favorito svg{ width:16px; height:16px; }
.market-producto-favorito.activo{ color:#e2434d; }
.market-producto-favorito.activo svg{ fill:currentColor; }
.market-producto-nombre{ font-weight:800; font-size:14.5px; line-height:1.3; min-height:38px; }
.market-producto-precios{ display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.market-precio-actual{ color:var(--blue-dark); font-weight:900; font-size:17px; }
.market-producto-precio-tachado{ color:var(--muted); text-decoration:line-through; font-size:13.5px; }
.market-producto-badge-oferta{ background:var(--amber); color:#fff; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; padding:2px 8px; border-radius:999px; }
.market-producto-existencia{ color:var(--mint); font-size:13px; font-weight:700; }
.market-producto-existencia.agotado{ color:#c0392b; }
.market-producto-existencia.bajo-pedido{ color:var(--amber); }
.market-producto-tienda{ color:var(--muted); font-size:12.5px; }
.market-como{ max-width:1680px; margin:0 auto 60px; padding:0 clamp(18px,4vw,48px); }
.market-como h3{ font-size:19px; margin:0 0 18px; }
.market-como-pasos{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
.market-como-pasos > div{ background:var(--glass); border:1px solid var(--line); border-radius:16px; padding:16px; }
.market-como-pasos strong{ display:block; margin-bottom:6px; }
.market-como-pasos span{ color:var(--muted); font-size:13.5px; }
.market-badges{ display:flex; flex-wrap:wrap; gap:24px; justify-content:center; padding:26px clamp(18px,4vw,48px); border-top:1px solid var(--line); max-width:1680px; margin:0 auto; }
.market-badges span{ display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:700; color:var(--muted); }
.market-vacio{ text-align:center; color:var(--muted); padding:40px 0; }
.market-resultados-layout{ display:grid; grid-template-columns:220px minmax(0,1fr); gap:28px; align-items:start; min-width:0; }
.market-resultados-filtros{ position:sticky; top:150px; display:grid; gap:20px; min-width:0; }
.market-filtro-header{ display:flex; align-items:center; justify-content:space-between; }
.market-filtro-header h4{ margin:0; font-size:15px; }
.market-filtro-header button{ border:none; background:none; color:var(--blue); font-weight:700; font-size:12.5px; cursor:pointer; padding:0; }
.market-filtro-grupo{ border-top:1px solid var(--line); padding-top:16px; }
.market-filtro-grupo:first-of-type{ border-top:none; padding-top:0; }
.market-filtro-grupo h5{ margin:0 0 10px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
.market-filtro-categoria-actual{ display:inline-flex; align-items:center; gap:6px; background:var(--blue); color:#fff; border-radius:999px; padding:6px 12px; font-size:12.5px; font-weight:700; }
.market-filtro-categoria-actual button{ border:none; background:none; color:#fff; cursor:pointer; font-size:14px; line-height:1; padding:0; }
.market-filtro-marca-fila{ display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13.5px; cursor:pointer; }
.market-filtro-marca-fila .market-filtro-marca-cuenta{ color:var(--muted); font-size:12px; }
.market-filtro-precio{ display:flex; gap:8px; margin-bottom:10px; }
.market-filtro-precio input{ width:0; flex:1; padding:8px 10px; border:1px solid var(--line); border-radius:10px; font:inherit; font-size:13px; }
.market-filtro-precio-btn{ width:100%; border:1px solid var(--line); background:#fff; border-radius:10px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; }
.market-filtro-precio-btn:hover{ border-color:var(--blue); color:var(--blue); }
.market-breadcrumb{ font-size:12.5px; color:var(--muted); margin:0 0 10px; }
.market-breadcrumb a{ color:var(--muted); }
.market-breadcrumb a:hover{ color:var(--blue); }
.market-resultados-principal{ min-width:0; }
.market-resultados-header{ display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
.market-resultados-header h2{ margin:0 0 4px; font-size:21px; }
.market-resultados-conteo{ color:var(--muted); font-size:13.5px; }
.market-orden-select{ border:1px solid var(--line); border-radius:10px; padding:8px 12px; font:inherit; font-size:13px; background:#fff; }
.market-resultados-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; }
.market-resultados-cargar-mas{ display:flex; justify-content:center; margin-top:26px; }
.market-resultados-cargar-mas button{ border:1px solid var(--line); background:#fff; border-radius:999px; padding:10px 24px; font-weight:700; font-size:13.5px; cursor:pointer; }
.market-resultados-cargar-mas button:hover{ border-color:var(--blue); color:var(--blue); }
@media (max-width:980px){
  .market-hero{ grid-template-columns:1fr; }
  .market-hero-imagen{ min-height:200px; }
  .market-layout{ grid-template-columns:1fr; }
  .market-sidebar{ position:static; }
  .market-como-pasos{ grid-template-columns:1fr; }
}
@media (max-width:860px){
  .market-resultados-layout{ grid-template-columns:1fr; }
  .market-resultados-filtros{ position:static; }
}
@media (max-width:560px){
  .market-header-top{ flex-wrap:wrap; row-gap:12px; gap:10px; padding:12px 14px; }
  .market-logo{ order:1; }
  .market-logo span{ display:none; }
  .market-header-acciones{ order:2; margin-left:auto; gap:14px; }
  .market-header-acciones .market-header-link span{ display:none; }
  .market-search-wrap{ order:3; flex:1 1 100%; }
  .market-search-bar select{ display:none; }
  .market-header-nav{ padding-left:14px; padding-right:14px; }
}
`;

// Barra inferior + cajon de Cuenta -- SOLO se inyecta dentro de
// paginaMarketHtml() (nunca en ESTILOS_MARKET compartido, para no
// afectar /market/explora, /market/ferreterias, /market/credito-nexo,
// que no reciben esta barra en esta fase). display:none arriba de
// 640px -- breakpoint propio, no esVistaMovilMarket: /market ya es
// responsive por CSS sin ninguna rama de servidor, mezclar UA-sniffing
// aqui crearia dos fuentes de verdad sobre "es movil".
const ESTILOS_MARKET_NAV_MOVIL = `
.market-bottom-nav{ display:none; }
.market-drawer-overlay{ display:none; }
@media (max-width:640px){
  main{ padding-bottom:calc(72px + env(safe-area-inset-bottom)); }
  .market-bottom-nav{ position:fixed; left:0; right:0; bottom:0; display:flex; padding-bottom:env(safe-area-inset-bottom); background:#fff; border-top:1px solid var(--line); box-shadow:0 -8px 24px rgba(20,32,51,.08); z-index:2000; -webkit-transform:translateZ(0); transform:translateZ(0); }
  .market-bottom-nav button{ flex:1; border:none; background:none; padding:10px 4px 12px; display:flex; flex-direction:column; align-items:center; gap:4px; font-size:11px; font-weight:700; color:var(--muted); cursor:pointer; }
  .market-bottom-nav button.activo{ color:var(--blue); }
  .market-bottom-nav button .icono{ font-size:19px; }
  .market-drawer-overlay:not([hidden]){ position:fixed; inset:0; background:rgba(20,32,51,.42); z-index:2000; display:block; }
}
.market-drawer{ position:absolute; top:0; left:0; bottom:0; width:82%; max-width:340px; background:#fff; padding:24px 20px calc(24px + env(safe-area-inset-bottom)); overflow-y:auto; }
.market-drawer-cerrar{ position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:999px; border:1px solid var(--line); background:#fff; cursor:pointer; }
.market-drawer-perfil{ display:flex; align-items:center; gap:12px; margin-bottom:18px; }
.market-drawer-nombre{ font-weight:800; font-size:15px; color:var(--ink); margin:0; }
.market-drawer-correo{ font-size:12.5px; color:var(--muted); margin:0; }
.market-drawer-titulo{ font-weight:800; font-size:16px; color:var(--ink); margin:20px 0 8px; }
.market-drawer-texto{ font-size:13.5px; color:var(--muted); line-height:1.5; margin:0 0 16px; }
.market-drawer-cta{ display:inline-flex; align-items:center; justify-content:center; padding:12px 22px; border-radius:999px; background:linear-gradient(135deg, var(--blue), var(--blue-dark)); color:#fff; font-weight:800; font-size:14px; text-decoration:none; }
.market-drawer-seccion{ font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:18px 0 8px; }
.market-drawer-link{ display:flex; align-items:center; gap:12px; padding:11px 4px; font-size:14px; color:var(--ink); text-decoration:none; font-weight:600; }
`;

// Header + nav de Nexo Market (Fase 1 "Market embebido") -- extraido tal
// cual del markup que antes vivia pegado dentro de paginaMarketHtml(),
// parametrizado para poder reusarse desde una pagina de tienda dentro de
// /market/{slug}/... sin duplicar el markup:
//   - baseAnclas: prefijo para los anchors internos (#marketOfertas, etc)
//     -- vacio en /market (se queda igual), "/market" cuando este header
//     se pinta dentro de una pagina de tienda (para que el anchor navegue
//     de vuelta a /market#... en vez de intentar hacer scroll en una
//     pagina que no tiene esas secciones).
//   - slugTienda/nombreTienda: cuando slugTienda es truthy, se agrega el
//     boton de carrito real (mismos ids que ya usa encabezadoTenantHtml
//     en public-site-server.js: tenantCarritoAbrirBoton/carritoContador)
//     dentro de .market-header-acciones -- es la unica diferencia de
//     markup entre la tienda A y la tienda B (ver verificacion de la
//     Fase 1: el resto del bloque <header class="market-header"> debe
//     ser string-identico entre tiendas).
function marketHeaderHtml({ slugTienda = null, nombreTienda = "", baseAnclas = "", activo = null } = {}) {
    const claseActiva = clave => clave === activo ? ' class="activo"' : '';
    const carritoBotonHtml = slugTienda
        ? `<button type="button" class="tenant-carrito-boton-nav" id="tenantCarritoAbrirBoton" data-slug-tienda="${escaparHtml(slugTienda)}" aria-label="Ver carrito de ${escaparHtml(nombreTienda)}">Carrito<span id="carritoContador" class="tenant-carrito-contador">0</span></button>`
        : "";

    return `<header class="market-header">
<div class="market-header-top">
<a class="market-logo" href="/market" aria-label="Nexo Market">
<img src="/nexo-pos-icon.jpg" alt="Nexo">
<span>Nexo Market</span>
</a>
<div class="market-search-wrap">
<form class="market-search-bar" id="marketBuscadorForm" autocomplete="off">
<select id="marketCategoriaSelect"><option value="">Todas las categorias</option></select>
<input type="text" id="marketBuscarInput" placeholder="Buscar productos, marcas o categorias..." maxlength="120" autocomplete="off">
<button type="submit" aria-label="Buscar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.35-4.35"></path></svg></button>
</form>
<div class="market-sugerencias" id="marketSugerencias" hidden></div>
</div>
<div class="market-header-acciones">
<a class="market-header-link" href="#" id="marketFavoritosLink"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg><span>Favoritos</span><span class="market-favoritos-contador" id="marketFavoritosContador">0</span></a>
<a class="market-header-link" href="/market/mis-pedidos" id="marketPedidosLink"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg><span>Mis pedidos</span></a>
<a class="market-header-link" href="/market/carrito"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg><span>Carrito</span></a>
<div class="market-header-sesion" id="marketSesion"><a class="market-header-link" href="/market/mi-cuenta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg><span>Inicia sesion</span></a></div><div id="marketAdminLink"></div>${carritoBotonHtml}
</div>
</div>
<nav class="market-header-nav">
<a href="/market/ofertas"${claseActiva('ofertas')}>Ofertas</a>
<a href="/market/explora"${claseActiva('explora')}>Explora</a>
<a href="/market/nuevos"${claseActiva('nuevos')}>Nuevos</a>
<a href="/market/ferreterias"${claseActiva('ferreterias')}>Ferreterias</a>
<a href="/market/credito-nexo"${claseActiva('credito')}>Credito Nexo</a>
<a href="/site#contacto">Ayuda</a>
<a href="/site#planes">Vende en Nexo</a>
</nav>
</header>`;
}

// Footer de Nexo Market -- extraido tal cual, sin parametros (identico
// en cualquier pagina de la familia Market).
function marketFooterHtml() {
    return `<footer>
<div class="brand">
<img src="/nexo-pos-icon.jpg" alt="Nexo">
<span>Nexo</span>
</div>
<span>Sistema comercial para punto de venta.</span>
<nav aria-label="Legal">
<a href="/terminos">Terminos</a>
<a href="/privacidad">Privacidad</a>
</nav>
</footer>`;
}

// Barra inferior + cajon de Cuenta -- SOLO dentro de paginaMarketHtml()
// (/market, /market/buscar, /market/ofertas, /market/nuevos, categorias).
// Antes esto vivia aparte, en /market/mi-cuenta (market-cuenta-app-server.js,
// shell "wizard"), como si fuera otra app: su "Inicio" era una tarjeta
// muerta, "Favoritos" apuntaba a una ruta que truena fuera de un
// subdominio de tienda, y "Pedidos" mandaba al hub de escritorio (otro
// diseno). Ahora vive aqui, dentro de Market mismo -- Favoritos reusa
// marketMostrarVistaFavoritos() tal cual (arregla el enlace roto de
// origen), Pedidos/Cuenta pintan con los mismos endpoints e iconos
// .portal-* que ya usaba (solo) el hub de escritorio
// (market-cuenta-server.js), nunca duplicados.
function marketBottomNavMovilHtml() {
    return `<nav class="market-bottom-nav" id="marketBottomNav">
<button type="button" class="activo" data-tab="inicio"><span class="icono">🏠</span>Inicio</button>
<button type="button" data-tab="favoritos"><span class="icono">❤️</span>Favoritos</button>
<button type="button" data-tab="pedidos"><span class="icono">📦</span>Pedidos</button>
<button type="button" data-tab="cuenta"><span class="icono">👤</span>Cuenta</button>
</nav>`;
}

function marketDrawerCuentaHtml() {
    return `<div class="market-drawer-overlay" id="marketDrawerOverlay" hidden>
<div class="market-drawer">
<button type="button" class="market-drawer-cerrar" id="marketDrawerCerrar" aria-label="Cerrar menu">✕</button>
<div id="marketDrawerInvitado" hidden>
<p class="market-drawer-titulo">Tu cuenta</p>
<p class="market-drawer-texto">Inicia sesion para ver tus pedidos, tu credito y las ferreterias donde compras.</p>
<a class="market-drawer-cta" href="/market/mi-cuenta">Iniciar sesion</a>
</div>
<div id="marketDrawerPersona" hidden>
<div class="market-drawer-perfil">
<div>
<p class="market-drawer-nombre" id="marketDrawerNombre"></p>
<p class="market-drawer-correo" id="marketDrawerCorreo"></p>
</div>
</div>
<p class="market-drawer-seccion">Credito Nexo</p>
<div id="marketDrawerCredito"><p class="portal-credito-vacio">Cargando...</p></div>
<p class="market-drawer-seccion">Ferreterias donde compras</p>
<div id="marketDrawerFerreterias"><p class="portal-credito-vacio">Cargando...</p></div>
<p class="market-drawer-seccion">Cuenta</p>
<a class="market-drawer-link" href="#" data-ir-proximamente>👤 Mi perfil</a>
<a class="market-drawer-link" href="#" data-ir-proximamente>📍 Direcciones</a>
<a class="market-drawer-link" href="#" data-ir-proximamente>💳 Metodos de pago</a>
<a class="market-drawer-link" href="https://app.nexoposoficial.com/dueno">🏬 Nexo para negocios</a>
<a class="market-drawer-link" href="#" id="marketDrawerCerrarSesion">🚪 Cerrar sesion</a>
</div>
</div>
</div>`;
}

// Script minimo de la barra fija de Market (sesion + buscador con
// sugerencias en vivo + link de favoritos) -- pensado para reusarse tal
// cual dentro de una pagina de tienda (/market/{slug}/...), donde NO se
// carga el script grande de abajo (marketCargarInicio, marketMostrarBusqueda,
// etc., que son exclusivos de /market). /market NO consume esta funcion
// -- su propio script (mas abajo, sin tocar) ya resuelve lo mismo en
// pagina, por eso queda intacto byte a byte en el refactor de esta fase.
//
// navegarABusqueda=true (paginas de tienda): enviar el buscador o tocar
// Favoritos navega a /market?buscar=...|/market?vista=favoritos -- no
// hay pantalla de resultados propia ahi todavia (Fase 1, fuera de
// alcance). navegarABusqueda=false: intenta usar las funciones del
// script grande si existen (mismo criterio defensivo, en caso de reuso
// futuro), sin asumir que existen.
function scriptMarketHeaderHtml({ navegarABusqueda = false } = {}) {
    const irABusquedaJs = navegarABusqueda
        ? "marketHeaderIrABusqueda(texto, categoria);"
        : "if (typeof marketMostrarBusqueda === \"function\") { if (!texto && !categoria) { if (typeof marketMostrarInicio === \"function\") marketMostrarInicio(); } else { marketMostrarBusqueda({ buscar: texto, categoria: categoria }); } }";
    const verTodoJs = navegarABusqueda
        ? "marketHeaderIrABusqueda(texto, categoria);"
        : "if (typeof marketMostrarBusqueda === \"function\") { marketMostrarBusqueda({ buscar: texto, categoria: categoria }); }";
    const favoritosJs = navegarABusqueda
        ? "location.href = \"/market/buscar?vista=favoritos\";"
        : "document.getElementById(\"marketBuscarInput\").value = \"\"; document.getElementById(\"marketCategoriaSelect\").value = \"\"; if (typeof marketMostrarVistaFavoritos === \"function\") marketMostrarVistaFavoritos();";

    return `
function marketHeaderEscapeHtml(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function marketHeaderLlamar(ruta, opciones) {
    const respuesta = await fetch(ruta, Object.assign({ credentials: "include" }, opciones || {}));
    return respuesta.json();
}

async function marketHeaderCargarSesion() {
    const estado = await marketHeaderLlamar("/personas/estado");
    if (!estado.ok) return;
    document.getElementById("marketSesion").innerHTML =
        '<a class="market-header-link" href="/market/mi-cuenta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg><span>Hola, ' + marketHeaderEscapeHtml(estado.persona.nombre) + '</span></a>';
    marketHeaderCargarAdmin();
}
marketHeaderCargarSesion();

// Link "Administrar mi negocio" visible en TODO Market (no solo
// /market/mi-cuenta) -- mismo endpoint y mismo patron de "entrar" que ya
// usa cuentaMarketCargarAdmin() en market-cuenta-server.js, generalizado
// aqui porque este header se comparte en todas las paginas de la familia.
async function marketHeaderCargarAdmin() {
    const datos = await marketHeaderLlamar("/personas/negocios");
    const contenedor = document.getElementById("marketAdminLink");
    if (!contenedor || !datos.ok || !datos.negocios || datos.negocios.length === 0) return;

    if (datos.negocios.length === 1) {
        const negocioId = datos.negocios[0].id;
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "market-header-link market-header-admin-boton";
        boton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg><span>Administrar mi negocio</span>';
        boton.addEventListener("click", async function() {
            const resultado = await marketHeaderLlamar("/personas/negocios/" + negocioId + "/entrar", { method: "POST" });
            if (!resultado.ok) return;
            location.href = "https://app.nexoposoficial.com/dueno?entrar=" + encodeURIComponent(resultado.token);
        });
        contenedor.appendChild(boton);
        return;
    }

    contenedor.innerHTML = '<a class="market-header-link" href="/market/mi-cuenta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg><span>Administrar mi negocio</span></a>';
}

function marketHeaderIrABusqueda(texto, categoria) {
    var params = [];
    if (texto) params.push("buscar=" + encodeURIComponent(texto));
    if (categoria) params.push("categoria=" + encodeURIComponent(categoria));
    location.href = "/market/buscar" + (params.length ? "?" + params.join("&") : "");
}

var ICONO_FOTO_GENERICA_HEADER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';

function marketHeaderSugerenciaItemHtml(p) {
    var fotoHtml = p.fotoUrl
        ? '<img src="' + p.fotoUrl + '" alt="" loading="lazy">'
        : ICONO_FOTO_GENERICA_HEADER;
    var precioMostrado = (p.precioOferta !== null && p.precioOferta !== undefined) ? p.precioOferta : p.precio;
    var precioHtml = (precioMostrado !== null && precioMostrado !== undefined)
        ? '<span class="market-sugerencia-precio">$' + Number(precioMostrado).toFixed(2) + '</span>' : '';

    return '<a class="market-sugerencia-item" href="/market/' + encodeURIComponent(p.slug) + '/catalogo/' + encodeURIComponent(p.codigo) + '">' +
        '<span class="market-sugerencia-foto">' + fotoHtml + '</span>' +
        '<span class="market-sugerencia-texto"><strong>' + marketHeaderEscapeHtml(p.nombre) + '</strong><small>' + marketHeaderEscapeHtml(p.tienda) + '</small></span>' +
        precioHtml + '</a>';
}

var marketHeaderSugerenciasTimeout = null;
var marketHeaderSugerenciasTextoVigente = "";

function marketHeaderOcultarSugerencias() {
    var panel = document.getElementById("marketSugerencias");
    panel.hidden = true;
    panel.innerHTML = "";
}

async function marketHeaderBuscarSugerencias(texto) {
    marketHeaderSugerenciasTextoVigente = texto;
    var datos = await marketHeaderLlamar("/market/sugerencias-json?buscar=" + encodeURIComponent(texto));
    if (marketHeaderSugerenciasTextoVigente !== texto) return;

    var panel = document.getElementById("marketSugerencias");
    if (!datos.ok || datos.productos.length === 0) {
        panel.innerHTML = '<p class="market-sugerencias-vacio">No encontramos productos para "' + marketHeaderEscapeHtml(texto) + '".</p>';
        panel.hidden = false;
        return;
    }
    panel.innerHTML = datos.productos.map(marketHeaderSugerenciaItemHtml).join('') +
        '<button type="button" class="market-sugerencias-vertodo" id="marketHeaderVerTodoSugerencias">Ver todos los resultados para "' + marketHeaderEscapeHtml(texto) + '"</button>';
    panel.hidden = false;
}

document.getElementById("marketBuscarInput").addEventListener("input", function(evento) {
    var texto = evento.target.value.trim();
    clearTimeout(marketHeaderSugerenciasTimeout);
    if (texto.length < 2) { marketHeaderOcultarSugerencias(); return; }
    marketHeaderSugerenciasTimeout = setTimeout(function() { marketHeaderBuscarSugerencias(texto); }, 280);
});

document.getElementById("marketBuscarInput").addEventListener("keydown", function(evento) {
    if (evento.key === "Escape") marketHeaderOcultarSugerencias();
});

document.addEventListener("click", function(evento) {
    var verTodo = evento.target.closest("#marketHeaderVerTodoSugerencias");
    if (verTodo) {
        var texto = document.getElementById("marketBuscarInput").value.trim();
        var categoria = document.getElementById("marketCategoriaSelect").value;
        marketHeaderOcultarSugerencias();
        ${verTodoJs}
        return;
    }
    if (!evento.target.closest(".market-search-wrap")) {
        marketHeaderOcultarSugerencias();
    }
});

document.getElementById("marketBuscadorForm").addEventListener("submit", function(evento) {
    evento.preventDefault();
    marketHeaderOcultarSugerencias();
    var texto = document.getElementById("marketBuscarInput").value.trim();
    var categoria = document.getElementById("marketCategoriaSelect").value;
    ${irABusquedaJs}
});

document.getElementById("marketFavoritosLink").addEventListener("click", function(evento) {
    evento.preventDefault();
    ${favoritosJs}
});
`;
}

function paginaMarketHtml(opciones) {
    opciones = opciones || {};
    const categoriaInicial = String(opciones.categoriaInicial || "").trim().slice(0, 120);
    const ofertasInicial = Boolean(opciones.ofertasInicial);
    const ordenInicial = String(opciones.ordenInicial || "").trim();
    // Mismo mecanismo sin-flash construido para categorias, generalizado:
    // cualquier filtro inicial (categoria, ofertas, o "nuevos" via
    // orden=recientes) arranca la pagina ya en modo resultados.
    const modoResultados = Boolean(categoriaInicial) || ofertasInicial || ordenInicial === "recientes";
    const etiquetaModo = categoriaInicial || (ofertasInicial ? "Ofertas" : (ordenInicial === "recientes" ? "Nuevos" : ""));
    const activoNav = ofertasInicial ? "ofertas" : (ordenInicial === "recientes" ? "nuevos" : null);

    const tituloPagina = modoResultados
        ? `${etiquetaModo} -- Nexo Market`
        : "Nexo Market -- todo para construir, instalar y reparar";
    const descripcionPagina = modoResultados
        ? `${etiquetaModo} en Nexo Market: compara precio y disponibilidad entre varias ferreterias y compra directo con la tienda.`
        : "Busca productos entre varias ferreterias Nexo, compara precio y disponibilidad, y compra directo con la tienda que elijas.";

    // Cuando la pagina arranca ya en modo resultados (categoria, ofertas
    // o nuevos -- por ruta canonica o por el alias con query string
    // /market/buscar?...), el cascaron de inicio (hero, banners, tira de
    // categorias, Explora por categoria, Como funciona) se manda oculto
    // desde el primer HTML -- nunca se pinta y luego se esconde con JS,
    // que es justo lo que daba la sensacion de "regreso al inicio y
    // luego bajo" reportada.
    const ocultoInicialAttr = modoResultados ? ' style="display:none"' : '';
    const resultadosHiddenAttr = modoResultados ? '' : ' hidden';
    const resultadosContenidoInicial = modoResultados
        ? `<p class="market-vacio">Cargando ${escaparHtml(etiquetaModo)}...</p>`
        : '';

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escaparHtml(tituloPagina)}</title>
<meta name="description" content="${escaparHtml(descripcionPagina)}">
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
<link rel="stylesheet" href="/site/styles.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>${ESTILOS_MARKET}${ESTILOS_MARKET_NAV_MOVIL}${estilosPortalClienteHtml()}</style>
</head>
<body>
${marketHeaderHtml({ activo: activoNav })}

<main>
<div class="market-banners-scope market-oculto-en-busqueda" id="marketBannersDestacados"${ocultoInicialAttr}></div>
<section class="market-hero market-oculto-en-busqueda"${ocultoInicialAttr}>
<div class="market-hero-texto">
<h1>Todo para construir, instalar y reparar.</h1>
<p>Busca en varias ferreterias Nexo, compara precio y disponibilidad, y compra directo con la tienda.</p>
<div class="market-hero-chips">
<span>Compara precios</span>
<span>Elige tu ferreteria</span>
<span>Compra directo con la tienda</span>
</div>
<div class="market-hero-acciones">
<a class="btn primary" href="#marketTiendas">Ver ferreterias Nexo</a>
<a class="market-hero-como" href="#marketComoFunciona">Como funciona</a>
</div>
</div>
<div class="market-hero-imagen" id="marketHeroImagen"></div>
</section>

<div class="market-layout">
<div class="market-contenido">
<div id="marketCategoriasTop" class="market-oculto-en-busqueda"${ocultoInicialAttr}></div>

<section class="market-oficio market-oculto-en-busqueda" id="marketOficio" hidden>
<h3>Cuentanos a que te dedicas</h3>
<p>Elegir tu oficio nos ayuda a recomendarte lo que realmente necesitas.</p>
<div class="market-oficio-chips" id="marketOficioChips"></div>
</section>

<span class="market-anchor" id="marketOfertas"></span>
<span class="market-anchor" id="marketExplora"></span>
<div id="marketInicio"${ocultoInicialAttr}><p class="market-vacio">Cargando...</p></div>
<div id="marketResultadosBusqueda"${resultadosHiddenAttr}>${resultadosContenidoInicial}</div>

<section class="market-seccion market-oculto-en-busqueda" id="marketSeccionExplora"${ocultoInicialAttr}>
<div class="market-seccion-header"><h3>Explora por categoria</h3></div>
<div id="marketExploraCategorias"></div>
</section>

<section id="marketComoFunciona" class="market-como market-oculto-en-busqueda"${ocultoInicialAttr}>
<h3>Como funciona</h3>
<div class="market-como-pasos">
<div><strong>1. Busca</strong><span>Encuentra productos en varias ferreterias Nexo a la vez.</span></div>
<div><strong>2. Compara</strong><span>Revisa precio y existencia real de cada tienda.</span></div>
<div><strong>3. Compra</strong><span>Termina tu compra directo en el catalogo de la tienda.</span></div>
</div>
</section>
</div>

<aside class="market-sidebar">
<div class="market-sidebar-card">
<h4 id="marketTiendas">Ferreterias Nexo</h4>
<div id="marketMapaTiendas" class="market-mapa-tiendas" hidden></div>
<button type="button" id="marketUbicacionBoton" class="market-ubicacion-boton" onclick="marketSolicitarUbicacion()">Usar mi ubicacion para ver que tan cerca estan</button>
<p id="marketUbicacionEstado" class="market-vacio-chico" hidden></p>
<div id="marketTiendasLista"></div>
</div>
<div class="market-sidebar-card">
<h4>Oferta del dia</h4>
<div id="marketSidebarOfertaContenido"><p class="market-vacio-chico">Cargando...</p></div>
</div>
<div class="market-sidebar-card">
<h4 id="marketCredito">Paga con Credito Nexo</h4>
<div id="marketSidebarCreditoContenido"><p class="market-vacio-chico">Cargando...</p></div>
</div>
</aside>
</div>

<div class="market-badges">
<span>Precios reales de cada tienda</span>
<span>Compra directo con la tienda</span>
<span>Solo ferreterias activas en Nexo</span>
<span>Soporte Nexo</span>
</div>
</main>

${marketFooterHtml()}
${marketBottomNavMovilHtml()}
${marketDrawerCuentaHtml()}

<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var marketFiltroInicialSSR = { categoria: ${JSON.stringify(categoriaInicial)}, ofertas: ${JSON.stringify(ofertasInicial)}, orden: ${JSON.stringify(ordenInicial)} };

function escapeHtml(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function marketLlamar(ruta, opciones) {
    const respuesta = await fetch(ruta, Object.assign({ credentials: "include" }, opciones || {}));
    return respuesta.json();
}

async function marketCargarSesion() {
    const estado = await marketLlamar("/personas/estado");
    if (!estado.ok) return;
    document.getElementById("marketSesion").innerHTML =
        '<a class="market-header-link" href="/market/mi-cuenta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg><span>Hola, ' + escapeHtml(estado.persona.nombre) + '</span></a>';
    marketCargarAdmin();
}

// Link "Administrar mi negocio" -- misma logica que marketHeaderCargarAdmin()
// (scriptMarketHeaderHtml, usado por el resto de las paginas de Market),
// duplicada aqui porque /market corre su propio script grande en vez del
// header compartido.
async function marketCargarAdmin() {
    const datos = await marketLlamar("/personas/negocios");
    const contenedor = document.getElementById("marketAdminLink");
    if (!contenedor || !datos.ok || !datos.negocios || datos.negocios.length === 0) return;

    if (datos.negocios.length === 1) {
        const negocioId = datos.negocios[0].id;
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "market-header-link market-header-admin-boton";
        boton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg><span>Administrar mi negocio</span>';
        boton.addEventListener("click", async function() {
            const resultado = await marketLlamar("/personas/negocios/" + negocioId + "/entrar", { method: "POST" });
            if (!resultado.ok) return;
            location.href = "https://app.nexoposoficial.com/dueno?entrar=" + encodeURIComponent(resultado.token);
        });
        contenedor.appendChild(boton);
        return;
    }

    contenedor.innerHTML = '<a class="market-header-link" href="/market/mi-cuenta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg><span>Administrar mi negocio</span></a>';
}

var ICONO_CORAZON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>';
var ICONO_FOTO_GENERICA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';

function marketTarjetaTienda(t) {
    return '<div class="market-tienda-card"><strong>' + escapeHtml(t.nombre) + '</strong>' +
        (t.giro ? '<span class="market-tienda-giro">' + escapeHtml(t.giro) + '</span>' : '') +
        (t.direccion ? '<span class="market-tienda-direccion">' + escapeHtml(t.direccion) + '</span>' : '') +
        '<a class="btn secondary" href="/market/' + encodeURIComponent(t.slug) + '">Ver tienda</a></div>';
}

function marketTarjetaTiendaSidebar(t, indice) {
    return '<a class="market-tienda-fila" href="/market/' + encodeURIComponent(t.slug) + '">' +
        '<span class="market-tienda-fila-numero">' + (indice + 1) + '</span>' +
        '<span class="market-tienda-fila-nombre">' + escapeHtml(t.nombre) + '</span>' +
        (t.giro ? '<span class="market-tienda-fila-giro">' + escapeHtml(t.giro) + '</span>' : '') +
        (typeof t.distanciaKm === "number" ? '<span class="market-tienda-fila-distancia">a ' + t.distanciaKm + ' km</span>' : '') +
        '</a>';
}

// Distancia del usuario a cada tienda (ver ejemplo confirmado con el
// usuario): linea recta (formula de Haversine), calculada 100% en el
// navegador con la ubicacion que el propio navegador reporta -- nunca
// se manda al servidor. Sin permiso, o sin coordenadas reales de la
// tienda, no se muestra ninguna distancia -- nunca una inventada.
var marketUbicacionUsuario = null;
var marketUltimasTiendas = [];

function marketDistanciaKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
}

function marketPintarListaTiendasSidebar(tiendas) {
    marketUltimasTiendas = tiendas || [];
    var conUbicacion = [];
    var sinCoordenadas = [];

    marketUltimasTiendas.forEach(function(t) {
        if (marketUbicacionUsuario && typeof t.lat === "number" && typeof t.lng === "number") {
            var copia = Object.assign({}, t);
            copia.distanciaKm = marketDistanciaKm(marketUbicacionUsuario.lat, marketUbicacionUsuario.lng, t.lat, t.lng);
            conUbicacion.push(copia);
        } else {
            sinCoordenadas.push(t);
        }
    });

    conUbicacion.sort(function(a, b) { return a.distanciaKm - b.distanciaKm; });
    var ordenadas = conUbicacion.concat(sinCoordenadas);

    document.getElementById("marketTiendasLista").innerHTML = ordenadas.length > 0
        ? ordenadas.map(marketTarjetaTiendaSidebar).join("")
        : '<p class="market-vacio-chico">Todavia no hay tiendas Nexo activas.</p>';

    var boton = document.getElementById("marketUbicacionBoton");
    if (boton) boton.hidden = Boolean(marketUbicacionUsuario);
}

function marketSolicitarUbicacion() {
    var estado = document.getElementById("marketUbicacionEstado");
    if (!navigator.geolocation) {
        if (estado) { estado.hidden = false; estado.textContent = "Tu navegador no permite compartir ubicacion."; }
        return;
    }

    navigator.geolocation.getCurrentPosition(function(posicion) {
        marketUbicacionUsuario = { lat: posicion.coords.latitude, lng: posicion.coords.longitude };
        if (estado) estado.hidden = true;
        marketPintarListaTiendasSidebar(marketUltimasTiendas);
    }, function() {
        if (estado) { estado.hidden = false; estado.textContent = "No pudimos usar tu ubicacion. Revisa el permiso del navegador."; }
    });
}

var marketMapaTiendasInstancia = null;

// Mapa real de tiendas con coordenadas (ver plan) -- gratis, sin API
// key, con Leaflet + tiles de OpenStreetMap. Solo pinta tiendas que ya
// geocodificaron su direccion real desde "Sitio web" en el POS -- nunca
// un pin inventado. Sin ninguna coordenada real, el contenedor se queda
// oculto y la lista de texto de siempre sigue funcionando igual.
function marketPintarMapaTiendas(tiendas) {
    var contenedor = document.getElementById("marketMapaTiendas");
    if (!contenedor || typeof L === "undefined") return;

    var conUbicacion = (tiendas || []).filter(function(t) {
        return typeof t.lat === "number" && typeof t.lng === "number" && !isNaN(t.lat) && !isNaN(t.lng);
    });

    if (conUbicacion.length === 0) {
        contenedor.hidden = true;
        return;
    }

    contenedor.hidden = false;

    if (!marketMapaTiendasInstancia) {
        marketMapaTiendasInstancia = L.map("marketMapaTiendas", { scrollWheelZoom: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19
        }).addTo(marketMapaTiendasInstancia);
    }

    var marcadores = conUbicacion.map(function(t) {
        var marcador = L.marker([t.lat, t.lng]).addTo(marketMapaTiendasInstancia);
        marcador.bindPopup('<strong>' + escapeHtml(t.nombre) + '</strong><br><a href="/market/' + encodeURIComponent(t.slug) + '">Ver tienda</a>');
        return marcador;
    });

    if (marcadores.length === 1) {
        marketMapaTiendasInstancia.setView([conUbicacion[0].lat, conUbicacion[0].lng], 14);
    } else {
        marketMapaTiendasInstancia.fitBounds(L.featureGroup(marcadores).getBounds().pad(0.2));
    }
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
        ? '<span class="market-producto-existencia' + (p.stock <= 0 ? ' agotado' : '') + '">' + (p.stock <= 0 ? 'Agotado' : p.stock + ' disponibles') + '</span>'
        : '<span class="market-producto-existencia bajo-pedido">Bajo pedido -- confirma con la tienda</span>';

    const fotoHtml = p.fotoUrl
        ? '<img src="' + p.fotoUrl + '" alt="' + escapeHtml(p.nombre) + '" loading="lazy">'
        : ICONO_FOTO_GENERICA;

    return '<div class="market-producto-card">' +
        '<button type="button" class="market-producto-favorito" data-slug="' + escapeHtml(p.slug) + '" data-codigo="' + escapeHtml(p.codigo) + '" aria-label="Guardar en favoritos">' + ICONO_CORAZON + '</button>' +
        '<a href="/market/' + encodeURIComponent(p.slug) + '/catalogo/' + encodeURIComponent(p.codigo) + '" class="market-producto-foto">' + fotoHtml + '</a>' +
        '<span class="market-producto-nombre">' + escapeHtml(p.nombre) + '</span>' +
        '<span class="market-producto-precios">' + precioHtml + '</span>' +
        existenciaHtml +
        '<span class="market-producto-tienda">' + escapeHtml(p.tienda) + '</span>' +
        '<a class="btn primary" href="/market/' + encodeURIComponent(p.slug) + '/catalogo/' + encodeURIComponent(p.codigo) + '">Ver en ' + escapeHtml(p.tienda) + '</a></div>';
}

function marketGridProductos(productos) {
    if (!productos || productos.length === 0) return '';
    return '<div class="market-productos-grid">' + productos.map(marketTarjetaProducto).join('') + '</div>';
}

// Banners de Nexo Market (Fase "Ofertas destacadas", ver plan) --
// promos generales del marketplace creadas en /admin, nunca ligadas a
// una tienda. Sin banners activos, la seccion no se pinta (nunca un
// placeholder inventado).
function marketBannerTarjetaHtml(b) {
    var fondoHtml = b.tieneImagen
        ? '<img src="/banners-market/' + b.id + '/imagen?v=' + encodeURIComponent(b.actualizadoAt || '') + '" alt="" loading="lazy">'
        : '';
    return '<a class="market-banner-card tema-' + escapeHtml(b.temaColor) + '" href="' + escapeHtml(b.enlace) + '">' +
        fondoHtml +
        '<div class="market-banner-overlay">' +
        '<h3>' + escapeHtml(b.titulo) + '</h3>' +
        (b.subtitulo ? '<p>' + escapeHtml(b.subtitulo) + '</p>' : '') +
        '<span class="btn primary market-banner-btn">' + escapeHtml(b.textoBoton) + '</span>' +
        '</div></a>';
}

function marketBannersHtml(banners) {
    if (!banners || banners.length === 0) return '';
    return '<div class="market-banners-grid">' + banners.map(marketBannerTarjetaHtml).join('') + '</div>';
}

// "Ofertas del dia" (Fase "Ofertas destacadas", ver plan) -- mismos
// datos reales de ofertasMarket() que ya usaba el carrusel generico,
// pero en grid dedicado con el badge de descuento -XX% (mismo calculo
// que ya usa marketPintarOfertaDelDia mas abajo) y un boton real
// "Agregar al carrito" que escribe directo a nexoCarrito_{slug}, mismo
// formato que ya usa carritoAgregar en public-site-server.js. Sin
// estrellas ni conteo de resenas -- no existen en ningun lado del
// sistema.
function marketTarjetaOfertaDelDia(p) {
    var tieneOferta = p.precioOferta !== null && p.precioOferta !== undefined
        && p.precio !== null && p.precio !== undefined && p.precioOferta < p.precio;

    var precioHtml = '';
    if (tieneOferta) {
        var descuento = Math.round((1 - (p.precioOferta / p.precio)) * 100);
        precioHtml = '<span class="market-precio-actual">$' + Number(p.precioOferta).toFixed(2) + '</span>' +
            '<span class="market-producto-precio-tachado">$' + Number(p.precio).toFixed(2) + '</span>' +
            (descuento > 0 ? '<span class="market-producto-badge-oferta">-' + descuento + '%</span>' : '');
    } else if (p.precio !== null && p.precio !== undefined) {
        precioHtml = '<span class="market-precio-actual">$' + Number(p.precio).toFixed(2) + '</span>';
    }

    var agotado = p.stock !== null && p.stock !== undefined && p.stock <= 0;
    var existenciaHtml = p.stock !== null && p.stock !== undefined
        ? '<span class="market-producto-existencia' + (agotado ? ' agotado' : '') + '">' + (agotado ? 'Agotado' : p.stock + ' disponibles') + '</span>'
        : '<span class="market-producto-existencia bajo-pedido">Bajo pedido -- confirma con la tienda</span>';

    var link = '/market/ferreteria/' + encodeURIComponent(p.slug) + '/catalogo/' + encodeURIComponent(p.codigo);
    var fotoHtml = p.fotoUrl
        ? '<img src="' + p.fotoUrl + '" alt="' + escapeHtml(p.nombre) + '" loading="lazy">'
        : ICONO_FOTO_GENERICA;

    return '<div class="market-producto-card">' +
        '<a href="' + link + '" class="market-producto-foto">' + fotoHtml + '</a>' +
        '<span class="market-producto-nombre">' + escapeHtml(p.nombre) + '</span>' +
        '<span class="market-producto-precios">' + precioHtml + '</span>' +
        existenciaHtml +
        '<span class="market-producto-tienda">' + escapeHtml(p.tienda) + '</span>' +
        '<button type="button" class="btn primary market-oferta-agregar-carrito" data-slug="' + escapeHtml(p.slug) + '" data-codigo="' + escapeHtml(p.codigo) + '" data-nombre="' + escapeHtml(p.nombre) + '"' + (agotado ? ' disabled' : '') + '>Agregar al carrito</button>' +
        '</div>';
}

function marketGridOfertasDelDia(productos) {
    if (!productos || productos.length === 0) return '';
    return '<div class="market-productos-grid market-ofertas-dia-grid">' + productos.map(marketTarjetaOfertaDelDia).join('') + '</div>';
}

function marketAgregarOfertaAlCarrito(boton) {
    var slug = boton.dataset.slug;
    var codigo = boton.dataset.codigo;
    var nombre = boton.dataset.nombre;
    var clave = "nexoCarrito_" + slug;

    var items = [];
    try { items = JSON.parse(localStorage.getItem(clave) || "[]"); } catch (error) { items = []; }

    var existente = items.find(function(it) { return it.codigo === codigo; });
    if (existente) {
        existente.cantidad = (Number(existente.cantidad) || 0) + 1;
    } else {
        items.push({ codigo: codigo, nombre: nombre, cantidad: 1 });
    }

    localStorage.setItem(clave, JSON.stringify(items));

    var textoOriginal = boton.textContent;
    boton.textContent = "Agregado";
    boton.disabled = true;
    setTimeout(function() {
        boton.textContent = textoOriginal;
        boton.disabled = false;
    }, 1400);
}

function marketSeccion(titulo, contenidoHtml) {
    if (!contenidoHtml) return '';
    return '<section class="market-seccion"><div class="market-seccion-header"><h3>' + escapeHtml(titulo) + '</h3>' +
        '<div class="market-carousel-flechas"><button type="button" class="market-carousel-flecha izquierda" aria-label="Anterior">&larr;</button><button type="button" class="market-carousel-flecha derecha" aria-label="Siguiente">&rarr;</button></div></div>' +
        contenidoHtml + '</section>';
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

function marketCategoriaTileHtml(cat) {
    return '<button type="button" class="market-categoria-tile" data-categoria="' + escapeHtml(cat) + '">' +
        '<span class="market-categoria-tile-icono">' + marketIconoCategoria(cat) + '</span>' +
        '<span class="market-categoria-tile-label">' + escapeHtml(cat) + '</span></button>';
}

function marketCategoriasHtml(categorias) {
    if (!categorias || categorias.length === 0) return '';
    return categorias.map(marketCategoriaTileHtml).join('');
}

function marketPintarSelectCategorias(categorias) {
    var select = document.getElementById("marketCategoriaSelect");
    var actual = select.value;
    select.innerHTML = '<option value="">Todas las categorias</option>' +
        (categorias || []).map(function(c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join('');
    select.value = actual;
}

function marketPintarHero(hero) {
    var contenedor = document.getElementById("marketHeroImagen");
    if (hero && hero.fotoUrl) {
        contenedor.innerHTML = '<img src="' + hero.fotoUrl + '" alt="' + escapeHtml(hero.nombre) + '">' +
            '<span class="market-hero-imagen-tienda">' + escapeHtml(hero.tienda) + '</span>';
    } else {
        contenedor.innerHTML = '';
    }
}

var MARKET_OFICIOS = [
    { clave: "herramientas", etiqueta: "Herramientas" },
    { clave: "construccion", etiqueta: "Construccion" },
    { clave: "electrico", etiqueta: "Electrico" },
    { clave: "plomeria", etiqueta: "Plomeria" },
    { clave: "pintura", etiqueta: "Pintura" },
    { clave: "seguridad", etiqueta: "Seguridad" },
    { clave: "jardin", etiqueta: "Jardin" },
    { clave: "limpieza", etiqueta: "Limpieza" },
    { clave: "otro", etiqueta: "Otro oficio" }
];

var marketPersonaActual = null;

function marketPintarOficioPicker() {
    var seccion = document.getElementById("marketOficio");
    if (marketPersonaActual && marketPersonaActual.oficio) {
        seccion.hidden = true;
        return;
    }
    seccion.hidden = false;
    document.getElementById("marketOficioChips").innerHTML = MARKET_OFICIOS.map(function(o) {
        return '<button type="button" class="market-oficio-chip" data-oficio="' + o.clave + '">' + marketIconoCategoria(o.etiqueta) + '<span>' + escapeHtml(o.etiqueta) + '</span></button>';
    }).join('');
}

async function marketElegirOficio(clave) {
    if (!marketPersonaActual) {
        window.location.href = "/market/mi-cuenta?oficio=" + encodeURIComponent(clave) + "&tab=registro";
        return;
    }
    var datos = await marketLlamar("/personas/oficio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oficio: clave })
    });
    if (datos.ok) {
        marketPersonaActual = { oficio: datos.oficio };
        marketCargarInicio();
    }
}

function marketPintarOfertaDelDia(ofertas) {
    var contenedor = document.getElementById("marketSidebarOfertaContenido");
    if (!ofertas || ofertas.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio-chico">Sin ofertas activas por ahora.</p>';
        return;
    }
    var p = ofertas[0];
    var descuento = (p.precio && p.precioOferta) ? Math.round((1 - (p.precioOferta / p.precio)) * 100) : null;
    contenedor.innerHTML =
        '<strong class="market-oferta-nombre">' + escapeHtml(p.nombre) + '</strong>' +
        '<div class="market-oferta-precios">' +
            '<span class="market-precio-actual">$' + Number(p.precioOferta).toFixed(2) + '</span>' +
            '<span class="market-producto-precio-tachado">$' + Number(p.precio).toFixed(2) + '</span>' +
            (descuento ? '<span class="market-producto-badge-oferta">-' + descuento + '%</span>' : '') +
        '</div>' +
        '<a class="btn primary" href="/market/' + encodeURIComponent(p.slug) + '/catalogo/' + encodeURIComponent(p.codigo) + '">Ver oferta</a>';
}

function marketPintarCreditoNexo(tiendas) {
    var contenedor = document.getElementById("marketSidebarCreditoContenido");
    var conCredito = (tiendas || []).filter(function(t) { return t.aceptaCredito; });
    if (conCredito.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio-chico">Ninguna ferreteria Nexo acepta solicitudes de credito por ahora.</p>';
        return;
    }
    contenedor.innerHTML = '<p class="market-vacio-chico">Estas ferreterias aceptan solicitudes de credito directo en su tienda:</p>' +
        '<ul class="market-credito-lista">' + conCredito.map(function(t) {
            return '<li><a href="https://' + escapeHtml(t.slug) + '.nexoposoficial.com/solicitud-credito">' + escapeHtml(t.nombre) + '</a></li>';
        }).join('') + '</ul>';
}

var MARKET_FAVORITOS_CLAVE = "nexoMarketFavoritos";

function marketFavoritosLeer() {
    try {
        var datos = JSON.parse(localStorage.getItem(MARKET_FAVORITOS_CLAVE) || "[]");
        return Array.isArray(datos) ? datos : [];
    } catch (e) { return []; }
}

function marketFavoritosGuardar(lista) {
    localStorage.setItem(MARKET_FAVORITOS_CLAVE, JSON.stringify(lista));
    marketFavoritosActualizarContador();
}

function marketFavoritosActualizarContador() {
    var badge = document.getElementById("marketFavoritosContador");
    if (badge) badge.textContent = String(marketFavoritosLeer().length);
}

function marketEsFavorito(slug, codigo) {
    return marketFavoritosLeer().some(function(f) { return f.slug === slug && f.codigo === codigo; });
}

function marketToggleFavorito(slug, codigo, boton) {
    var lista = marketFavoritosLeer();
    var indice = lista.findIndex(function(f) { return f.slug === slug && f.codigo === codigo; });
    var quedoActivo = indice === -1;
    if (quedoActivo) { lista.push({ slug: slug, codigo: codigo }); } else { lista.splice(indice, 1); }
    marketFavoritosGuardar(lista);
    if (boton) boton.classList.toggle("activo", quedoActivo);
}

function marketMarcarFavoritosBotones() {
    document.querySelectorAll(".market-producto-favorito").forEach(function(boton) {
        boton.classList.toggle("activo", marketEsFavorito(boton.dataset.slug, boton.dataset.codigo));
    });
}

// Sincroniza la URL visible con la vista actual (inicio, categoria,
// busqueda) via pushState -- asi cada categoria tiene su propio link
// compartible/recargable y el boton atras/adelante del navegador
// funciona, sin recargar la pagina en cada clic. "marketSincronizandoHistorial"
// evita que restaurar una vista desde un evento popstate dispare otro
// pushState (lo que rompería atras/adelante metiendo entradas de mas).
var marketSincronizandoHistorial = false;

function marketSlugificar(texto) {
    return String(texto || "")
        .normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function marketUrlDesdeFiltros(f) {
    if (f.buscar) {
        var params = ["buscar=" + encodeURIComponent(f.buscar)];
        if (f.categoria) params.push("categoria=" + encodeURIComponent(f.categoria));
        if (f.orden && f.orden !== "relevancia") params.push("orden=" + encodeURIComponent(f.orden));
        return "/market/buscar?" + params.join("&");
    }
    if (f.categoria) {
        var extra = [];
        if (f.orden && f.orden !== "relevancia") extra.push("orden=" + encodeURIComponent(f.orden));
        return "/market/categorias/" + encodeURIComponent(marketSlugificar(f.categoria)) + (extra.length ? "?" + extra.join("&") : "");
    }
    if (f.ofertas) return "/market/ofertas";
    if (f.orden === "recientes") return "/market/nuevos";
    return "/market";
}

function marketActualizarUrl(url) {
    if (marketSincronizandoHistorial) return;
    if (location.pathname + location.search === url) return;
    history.pushState({ marketUrl: url }, "", url);
}

// Sincroniza el resaltado de la barra inferior con la vista realmente
// visible -- se llama desde cada funcion marketMostrar*, no solo desde
// el click del boton, para que quede correcto sin importar como se
// llegue ahi (tocar la barra, el enlace "Mis pedidos"/Favoritos del
// header, el boton atras/adelante del navegador, o la carga inicial
// con ?vista=... en la URL). Antes solo se marcaba dentro del click de
// la barra, asi que llegar por cualquier otro camino dejaba "Inicio"
// resaltado aunque la vista real fuera otra.
function marketMarcarTabActiva(tab) {
    var nav = document.getElementById("marketBottomNav");
    if (!nav) return;
    nav.querySelectorAll("[data-tab]").forEach(function(boton) { boton.classList.toggle("activo", boton.dataset.tab === tab); });
}

function marketMostrarInicio() {
    document.getElementById("marketInicio").style.display = "";
    document.getElementById("marketResultadosBusqueda").hidden = true;
    document.querySelectorAll(".market-oculto-en-busqueda").forEach(function(el) { el.style.display = ""; });
    // Instantaneo, no animado -- el salto suave se sentia como que "se
    // cortaba" al cambiar de pestaña en movil (iOS recalcula el header
    // fijo a medio scroll animado); cambiar de pestaña en la barra
    // inferior debe sentirse como Amazon/Mercado Libre: instantaneo.
    window.scrollTo(0, 0);
    marketActualizarUrl("/market");
    marketMarcarTabActiva("inicio");
}

function marketMostrarResultados() {
    document.getElementById("marketInicio").style.display = "none";
    document.getElementById("marketResultadosBusqueda").hidden = false;
    // Se ocultan las secciones de inicio (Cuentanos a que te dedicas, tira de
    // categorias, Explora por categoria, Como funciona) para que la busqueda
    // se sienta como una pantalla propia, no como contenido pegado debajo
    // del inicio -- mismo espiritu que "cambiar de pagina".
    document.querySelectorAll(".market-oculto-en-busqueda").forEach(function(el) { el.style.display = "none"; });
    window.scrollTo(0, 0);
}

var marketFiltrosActuales = { buscar: "", categoria: "", ofertas: false, marcas: [], precioMin: null, precioMax: null, orden: "relevancia", pagina: 1 };
var marketResultadosAcumulados = [];
var marketResultadosTotal = 0;

function marketRenderFiltros(facetas) {
    var f = marketFiltrosActuales;

    var categoriaHtml = f.categoria
        ? '<div class="market-filtro-categoria-actual"><span>' + escapeHtml(f.categoria) + '</span><button type="button" id="marketQuitarCategoria" aria-label="Quitar filtro de categoria">&times;</button></div>'
        : '<p class="market-vacio-chico">Sin filtro de categoria.</p>';

    var marcasHtml = (facetas.marcas && facetas.marcas.length > 0)
        ? facetas.marcas.map(function(m) {
            var marcado = f.marcas.indexOf(m.marca) !== -1;
            return '<label class="market-filtro-marca-fila"><input type="checkbox" class="market-filtro-marca-check" value="' + escapeHtml(m.marca) + '"' + (marcado ? ' checked' : '') + '> ' + escapeHtml(m.marca) + ' <span class="market-filtro-marca-cuenta">(' + m.total + ')</span></label>';
        }).join('')
        : '<p class="market-vacio-chico">Sin marcas para filtrar.</p>';

    var hayFiltrosActivos = Boolean(f.categoria) || f.marcas.length > 0 || f.precioMin !== null || f.precioMax !== null;

    return '<aside class="market-resultados-filtros">' +
        '<div class="market-filtro-header"><h4>Filtros</h4>' + (hayFiltrosActivos ? '<button type="button" id="marketLimpiarFiltros">Limpiar todo</button>' : '') + '</div>' +
        '<div class="market-filtro-grupo"><h5>Categoria</h5>' + categoriaHtml + '</div>' +
        '<div class="market-filtro-grupo"><h5>Marca</h5>' + marcasHtml + '</div>' +
        '<div class="market-filtro-grupo"><h5>Precio</h5>' +
        '<div class="market-filtro-precio">' +
        '<input type="number" min="0" id="marketPrecioMinInput" placeholder="Minimo" value="' + (f.precioMin !== null ? f.precioMin : '') + '">' +
        '<input type="number" min="0" id="marketPrecioMaxInput" placeholder="Maximo" value="' + (f.precioMax !== null ? f.precioMax : '') + '">' +
        '</div>' +
        '<button type="button" class="market-filtro-precio-btn" id="marketAplicarPrecioBtn">Aplicar</button>' +
        '</div></aside>';
}

function marketRenderResultados(facetas) {
    var f = marketFiltrosActuales;
    var tituloTexto = f.buscar ? 'Resultados para “' + escapeHtml(f.buscar) + '”'
        : f.categoria ? escapeHtml(f.categoria)
        : f.ofertas ? 'Ofertas'
        : f.orden === 'recientes' ? 'Nuevos'
        : 'Todos los productos';
    var breadcrumb = '<nav class="market-breadcrumb"><a href="#" id="marketBreadcrumbInicio">Inicio</a> &rsaquo; ' + tituloTexto + '</nav>';
    var conteoTexto = marketResultadosTotal === 1 ? '1 producto encontrado' : marketResultadosTotal + ' productos encontrados';

    var gridHtml = marketResultadosAcumulados.length > 0
        ? '<div class="market-resultados-grid">' + marketResultadosAcumulados.map(marketTarjetaProducto).join('') + '</div>'
        : '<p class="market-vacio">No encontramos productos' + (f.buscar ? ' para "' + escapeHtml(f.buscar) + '"' : '') + '. Intenta con otras palabras o quita algun filtro.</p>';

    var hayMas = marketResultadosAcumulados.length < marketResultadosTotal;
    var cargarMasHtml = hayMas
        ? '<div class="market-resultados-cargar-mas"><button type="button" id="marketCargarMasBtn">Cargar mas resultados</button></div>' : '';

    var ordenSelectHtml = '<select class="market-orden-select" id="marketOrdenSelect">' +
        '<option value="relevancia"' + (f.orden === 'relevancia' ? ' selected' : '') + '>Ordenar por: Relevancia</option>' +
        '<option value="recientes"' + (f.orden === 'recientes' ? ' selected' : '') + '>Mas recientes</option>' +
        '<option value="precio_asc"' + (f.orden === 'precio_asc' ? ' selected' : '') + '>Precio: menor a mayor</option>' +
        '<option value="precio_desc"' + (f.orden === 'precio_desc' ? ' selected' : '') + '>Precio: mayor a menor</option>' +
        '<option value="nombre"' + (f.orden === 'nombre' ? ' selected' : '') + '>Nombre A-Z</option>' +
        '</select>';

    return '<div class="market-resultados-layout">' +
        marketRenderFiltros(facetas) +
        '<div class="market-resultados-principal">' +
        breadcrumb +
        '<div class="market-resultados-header"><div><h2>' + tituloTexto + '</h2>' +
        (marketResultadosTotal > 0 ? '<span class="market-resultados-conteo">' + conteoTexto + '</span>' : '') +
        '</div>' + ordenSelectHtml + '</div>' +
        gridHtml + cargarMasHtml +
        '</div></div>';
}

async function marketMostrarBusqueda(opciones, agregarMas) {
    opciones = opciones || {};

    if (!agregarMas) {
        marketFiltrosActuales = {
            buscar: opciones.buscar !== undefined ? opciones.buscar : marketFiltrosActuales.buscar,
            categoria: opciones.categoria !== undefined ? opciones.categoria : marketFiltrosActuales.categoria,
            ofertas: opciones.ofertas !== undefined ? Boolean(opciones.ofertas) : false,
            marcas: opciones.marcas !== undefined ? opciones.marcas : [],
            precioMin: opciones.precioMin !== undefined ? opciones.precioMin : null,
            precioMax: opciones.precioMax !== undefined ? opciones.precioMax : null,
            orden: opciones.orden !== undefined ? opciones.orden : "relevancia",
            pagina: 1
        };
        marketResultadosAcumulados = [];
        marketActualizarUrl(marketUrlDesdeFiltros(marketFiltrosActuales));
    } else {
        marketFiltrosActuales.pagina += 1;
    }

    marketMostrarResultados();
    var contenedor = document.getElementById("marketResultadosBusqueda");
    if (!agregarMas) contenedor.innerHTML = '<p class="market-vacio">Buscando...</p>';

    var f = marketFiltrosActuales;
    var params = [];
    if (f.buscar) params.push("buscar=" + encodeURIComponent(f.buscar));
    if (f.categoria) params.push("categoria=" + encodeURIComponent(f.categoria));
    if (f.ofertas) params.push("ofertas=1");
    if (f.marcas.length) params.push("marcas=" + encodeURIComponent(f.marcas.join(",")));
    if (f.precioMin !== null) params.push("precioMin=" + encodeURIComponent(f.precioMin));
    if (f.precioMax !== null) params.push("precioMax=" + encodeURIComponent(f.precioMax));
    if (f.orden) params.push("orden=" + encodeURIComponent(f.orden));
    params.push("pagina=" + f.pagina);

    var datos = await marketLlamar("/market/buscar-json?" + params.join("&"));

    if (!datos.ok) {
        contenedor.innerHTML = '<p class="market-vacio">No se pudo completar la busqueda.</p>';
        return;
    }

    marketResultadosAcumulados = agregarMas ? marketResultadosAcumulados.concat(datos.productos) : datos.productos;
    marketResultadosTotal = datos.total;

    contenedor.innerHTML = marketRenderResultados(datos.facetas || { marcas: [], precioMin: null, precioMax: null });
    marketMarcarFavoritosBotones();
}

async function marketMostrarVistaFavoritos() {
    marketMostrarResultados();
    marketActualizarUrl("/market/buscar?vista=favoritos");
    marketMarcarTabActiva("favoritos");
    var contenedor = document.getElementById("marketResultadosBusqueda");
    var lista = marketFavoritosLeer();
    if (lista.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio">Todavia no tienes favoritos. Toca el corazon de un producto para guardarlo.</p>';
        return;
    }
    contenedor.innerHTML = '<p class="market-vacio">Cargando tus favoritos...</p>';
    var datos = await marketLlamar("/market/favoritos-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lista })
    });
    if (!datos.ok || datos.productos.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio">No encontramos tus favoritos guardados.</p>';
        return;
    }
    contenedor.innerHTML = marketGridProductos(datos.productos);
    marketMarcarFavoritosBotones();
}

function marketDinero(valor) {
    var numero = Number(valor) || 0;
    return "$" + numero.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

var ETIQUETAS_ESTADO_MARKET_NAV = {
    pendiente: "Recibido", recibido: "Recibido", confirmado: "Preparando", preparando: "Preparando",
    listo: "Listo para recoger", entregado: "Entregado", cancelado: "Cancelado"
};

// Mismo patron que cuentaMarketCargarResumenPedidosFavoritos()
// (market-cuenta-server.js, hub de escritorio) para /personas/mis-pedidos
// -- adaptado aqui, no compartido via <script src>, mismo criterio que
// ya usa este archivo para no acoplar los dos scripts grandes.
async function marketMostrarVistaPedidos() {
    marketMostrarResultados();
    marketActualizarUrl("/market/buscar?vista=pedidos");
    marketMarcarTabActiva("pedidos");
    var contenedor = document.getElementById("marketResultadosBusqueda");
    contenedor.innerHTML = '<p class="market-vacio">Cargando tus pedidos...</p>';

    var datos = await marketLlamar("/personas/mis-pedidos");
    if (!datos.ok) {
        contenedor.innerHTML = '<p class="market-vacio">Inicia sesion para ver tus pedidos. <a href="/market/mi-cuenta">Iniciar sesion</a></p>';
        return;
    }
    if (datos.pedidos.length === 0) {
        contenedor.innerHTML = '<p class="market-vacio">Todavia no tienes pedidos con tu cuenta Nexo.</p>';
        return;
    }

    var grupos = new Map();
    datos.pedidos.forEach(function(p) {
        var clave = p.grupo_id || ("solo-" + p.id);
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(p);
    });

    var lista = document.createElement("div");
    lista.className = "market-pedidos-lista";
    grupos.forEach(function(items) {
        var primero = items[0];
        var esPedidoMarket = Boolean(primero.codigo_recogida);
        var fila = document.createElement(esPedidoMarket ? "a" : "div");
        fila.className = "portal-pedido-fila";
        if (esPedidoMarket) {
            fila.href = "/market/pedido/" + encodeURIComponent(primero.codigo_recogida);
            fila.style.textDecoration = "none";
        }
        var nombres = items.map(function(it) { return it.producto_nombre; }).join(", ");
        var etiquetaEstado = esPedidoMarket
            ? (ETIQUETAS_ESTADO_MARKET_NAV[primero.estado_pedido_market] || primero.estado_pedido_market)
            : primero.estado;
        fila.innerHTML =
            '<div class="portal-pedido-icono">${ICONO_PORTAL_PEDIDOS}</div>' +
            '<div class="portal-pedido-info"><div class="portal-pedido-nombre"></div><div class="portal-pedido-fecha"></div></div>' +
            '<div class="portal-pedido-precio"></div>';
        fila.querySelector(".portal-pedido-nombre").textContent = nombres;
        fila.querySelector(".portal-pedido-fecha").textContent =
            primero.tienda + " -- " + new Date(primero.created_at).toLocaleDateString("es-MX") + " -- " + etiquetaEstado;
        fila.querySelector(".portal-pedido-precio").textContent = primero.precio_cotizado ? marketDinero(primero.precio_cotizado) : "";
        lista.appendChild(fila);
    });
    contenedor.innerHTML = "";
    contenedor.appendChild(lista);
}

async function marketCargarInicio() {
    var contenedor = document.getElementById("marketInicio");
    var resultados = await Promise.all([
        marketLlamar("/market/inicio-json"),
        marketLlamar("/market/buscar-json?orden=recientes"),
        marketLlamar("/market/banners-json")
    ]);
    var datos = resultados[0];
    var explora = resultados[1];
    var banners = resultados[2];

    if (!datos.ok) {
        contenedor.innerHTML = '<p class="market-vacio">No se pudo cargar Nexo Market.</p>';
        return;
    }

    document.getElementById("marketBannersDestacados").innerHTML =
        (banners.ok && banners.banners) ? marketBannersHtml(banners.banners) : "";

    marketPersonaActual = datos.persona;
    marketPintarHero(datos.hero);
    marketPintarSelectCategorias(datos.categorias);
    marketPintarOficioPicker();

    document.getElementById("marketCategoriasTop").innerHTML = marketCategoriasHtml(datos.categorias)
        ? '<div class="market-categorias-tira">' + marketCategoriasHtml(datos.categorias) + '</div>' : '';
    document.getElementById("marketExploraCategorias").innerHTML = marketCategoriasHtml(datos.categorias)
        ? '<div class="market-categorias-grid">' + marketCategoriasHtml(datos.categorias) + '</div>'
        : '<p class="market-vacio">Todavia no hay categorias para mostrar.</p>';

    var html = "";
    html += marketSeccion("Recomendado para ti", marketGridProductos(datos.recomendados));
    html += marketSeccion("Ofertas del dia", marketGridOfertasDelDia(datos.ofertas));
    html += marketSeccion("Explora productos", explora.ok ? marketGridProductos(explora.productos) : "");
    contenedor.innerHTML = html || '<p class="market-vacio">Todavia no hay productos para mostrar aqui.</p>';

    marketPintarListaTiendasSidebar(datos.tiendas);
    marketPintarMapaTiendas(datos.tiendas);
    marketPintarOfertaDelDia(datos.ofertas);
    marketPintarCreditoNexo(datos.tiendas);

    marketFavoritosActualizarContador();
    marketMarcarFavoritosBotones();
}

document.addEventListener("click", function(evento) {
    var botonAgregar = evento.target.closest(".market-oferta-agregar-carrito");
    if (botonAgregar) {
        evento.preventDefault();
        if (!botonAgregar.disabled) marketAgregarOfertaAlCarrito(botonAgregar);
        return;
    }

    var tile = evento.target.closest(".market-categoria-tile");
    if (tile) {
        document.getElementById("marketBuscarInput").value = "";
        document.getElementById("marketCategoriaSelect").value = tile.dataset.categoria;
        marketMostrarBusqueda({ buscar: "", categoria: tile.dataset.categoria });
        return;
    }

    var oficioBtn = evento.target.closest(".market-oficio-chip");
    if (oficioBtn) {
        marketElegirOficio(oficioBtn.dataset.oficio);
        return;
    }

    var favBtn = evento.target.closest(".market-producto-favorito");
    if (favBtn) {
        evento.preventDefault();
        marketToggleFavorito(favBtn.dataset.slug, favBtn.dataset.codigo, favBtn);
        return;
    }

    var flecha = evento.target.closest(".market-carousel-flecha");
    if (flecha) {
        var seccion = flecha.closest(".market-seccion");
        var carrusel = seccion ? seccion.querySelector(".market-productos-grid") : null;
        if (carrusel) carrusel.scrollBy({ left: flecha.classList.contains("izquierda") ? -320 : 320, behavior: "smooth" });
        return;
    }

    var quitarCategoria = evento.target.closest("#marketQuitarCategoria");
    if (quitarCategoria) {
        document.getElementById("marketCategoriaSelect").value = "";
        marketMostrarBusqueda(Object.assign({}, marketFiltrosActuales, { categoria: "" }));
        return;
    }

    var limpiarFiltros = evento.target.closest("#marketLimpiarFiltros");
    if (limpiarFiltros) {
        document.getElementById("marketCategoriaSelect").value = "";
        marketMostrarBusqueda({ buscar: marketFiltrosActuales.buscar, categoria: "", marcas: [], precioMin: null, precioMax: null, orden: "relevancia" });
        return;
    }

    var aplicarPrecio = evento.target.closest("#marketAplicarPrecioBtn");
    if (aplicarPrecio) {
        var minVal = document.getElementById("marketPrecioMinInput").value;
        var maxVal = document.getElementById("marketPrecioMaxInput").value;
        marketMostrarBusqueda(Object.assign({}, marketFiltrosActuales, {
            precioMin: minVal !== "" ? Number(minVal) : null,
            precioMax: maxVal !== "" ? Number(maxVal) : null
        }));
        return;
    }

    var cargarMas = evento.target.closest("#marketCargarMasBtn");
    if (cargarMas) {
        marketMostrarBusqueda(null, true);
        return;
    }

    var breadcrumbInicio = evento.target.closest("#marketBreadcrumbInicio");
    if (breadcrumbInicio) {
        evento.preventDefault();
        document.getElementById("marketBuscarInput").value = "";
        document.getElementById("marketCategoriaSelect").value = "";
        marketMostrarInicio();
        return;
    }
});

document.addEventListener("change", function(evento) {
    if (evento.target.classList && evento.target.classList.contains("market-filtro-marca-check")) {
        var seleccionadas = Array.prototype.map.call(document.querySelectorAll(".market-filtro-marca-check:checked"), function(el) { return el.value; });
        marketMostrarBusqueda(Object.assign({}, marketFiltrosActuales, { marcas: seleccionadas }));
        return;
    }

    if (evento.target.id === "marketOrdenSelect") {
        marketMostrarBusqueda(Object.assign({}, marketFiltrosActuales, { orden: evento.target.value }));
        return;
    }
});

document.getElementById("marketFavoritosLink").addEventListener("click", function(evento) {
    evento.preventDefault();
    document.getElementById("marketBuscarInput").value = "";
    document.getElementById("marketCategoriaSelect").value = "";
    marketMostrarVistaFavoritos();
});

// En movil (mismo breakpoint que la barra inferior), "Mis pedidos" del
// header pinta el panel en pagina en vez de mandar al hub de
// escritorio -- mismo trato que Favoritos ya recibe arriba. En
// escritorio se deja el enlace normal, sin cambios.
var marketPedidosHeaderLink = document.getElementById("marketPedidosLink");
if (marketPedidosHeaderLink) {
    marketPedidosHeaderLink.addEventListener("click", function(evento) {
        if (!window.matchMedia("(max-width:640px)").matches) return;
        evento.preventDefault();
        marketMostrarVistaPedidos();
    });
}

// Barra inferior movil (Inicio/Favoritos/Pedidos/Cuenta) -- reemplaza
// al shell aparte que antes vivia en /market/mi-cuenta. Cuenta abre el
// cajon en vez de navegar; el resto reusa las mismas funciones de
// vista que ya usa el resto de esta pagina.
var marketBottomNavEl = document.getElementById("marketBottomNav");
if (marketBottomNavEl) {
    marketBottomNavEl.querySelectorAll("[data-tab]").forEach(function(boton) {
        boton.addEventListener("click", function() {
            var destino = boton.dataset.tab;
            if (destino === "inicio") { marketMostrarInicio(); return; }
            if (destino === "favoritos") { marketMostrarVistaFavoritos(); return; }
            if (destino === "pedidos") { marketMostrarVistaPedidos(); return; }
            if (destino === "cuenta") { marketAbrirDrawer(); return; }
        });
    });
}

var marketDrawerOverlayEl = document.getElementById("marketDrawerOverlay");
var marketDrawerCargado = false;

function marketAbrirDrawer() {
    if (marketDrawerOverlayEl) marketDrawerOverlayEl.hidden = false;
    marketMarcarTabActiva("cuenta");
    if (!marketDrawerCargado) { marketDrawerCargado = true; marketCargarDrawer(); }
}

function marketCerrarDrawer() {
    if (marketDrawerOverlayEl) marketDrawerOverlayEl.hidden = true;
}

if (marketDrawerOverlayEl) {
    var marketDrawerCerrarBoton = document.getElementById("marketDrawerCerrar");
    if (marketDrawerCerrarBoton) marketDrawerCerrarBoton.addEventListener("click", marketCerrarDrawer);
    marketDrawerOverlayEl.addEventListener("click", function(evento) { if (evento.target === marketDrawerOverlayEl) marketCerrarDrawer(); });
}

// En movil, el link de sesion del header ("Inicia sesion" / "Hola,
// NOMBRE") abre el cajon de Cuenta en vez de navegar a
// /market/mi-cuenta -- que ya no tiene una pantalla propia que mostrar
// (redirige de vuelta aqui). En escritorio se deja intacto. Delegado
// en el contenedor porque marketCargarSesion() reemplaza el <a> de
// adentro por innerHTML.
document.getElementById("marketSesion").addEventListener("click", function(evento) {
    if (!window.matchMedia("(max-width:640px)").matches) return;
    var enlace = evento.target.closest("a");
    if (!enlace) return;
    var estado = document.getElementById("marketDrawerPersona");
    if (!estado || estado.hidden) return; // invitado: deja el link normal a /market/mi-cuenta
    evento.preventDefault();
    marketAbrirDrawer();
});

async function marketCargarDrawer() {
    var invitado = document.getElementById("marketDrawerInvitado");
    var persona = document.getElementById("marketDrawerPersona");
    var estado = await marketLlamar("/personas/estado");

    if (!estado.ok) {
        invitado.hidden = false;
        persona.hidden = true;
        return;
    }

    invitado.hidden = true;
    persona.hidden = false;
    document.getElementById("marketDrawerNombre").textContent = estado.persona.nombre || "";
    document.getElementById("marketDrawerCorreo").textContent = estado.persona.correo || estado.persona.telefono || "";

    marketCargarDrawerCredito();
    marketCargarDrawerFerreterias();
}

async function marketCargarDrawerCredito() {
    var datos = await marketLlamar("/personas/mi-credito");
    var contenedor = document.getElementById("marketDrawerCredito");
    var creditos = datos.ok ? datos.creditos : [];

    if (creditos.length === 0) {
        contenedor.innerHTML = '<p class="portal-credito-vacio">Todavia no eres cliente de credito vinculado en ninguna ferreteria.</p>';
        return;
    }

    contenedor.innerHTML = "";
    creditos.forEach(function(c) {
        var disponible = Math.max(0, c.limiteCredito - c.saldo);
        var bloque = document.createElement("div");
        bloque.style.marginBottom = "16px";
        bloque.innerHTML =
            '<div class="portal-datos-fila" style="border:none; padding:2px 0;"><strong style="font-size:14px;"></strong></div>' +
            '<div class="portal-credito-linea"><span>Disponible</span><strong></strong></div>' +
            '<div class="portal-credito-linea"><span>Limite</span><strong></strong></div>';
        bloque.querySelector(".portal-datos-fila strong").textContent = c.negocio.nombre;
        var lineas = bloque.querySelectorAll(".portal-credito-linea strong");
        lineas[0].textContent = marketDinero(disponible);
        lineas[1].textContent = marketDinero(c.limiteCredito);
        if (c.vencido) {
            var aviso = document.createElement("span");
            aviso.className = "portal-credito-estado vencido";
            aviso.textContent = "Vencido -- " + marketDinero(c.totalVencido);
            bloque.appendChild(aviso);
        }
        contenedor.appendChild(bloque);
    });
}

async function marketCargarDrawerFerreterias() {
    var datos = await marketLlamar("/personas/negocios-cliente");
    var contenedor = document.getElementById("marketDrawerFerreterias");
    var negocios = datos.ok ? datos.negocios : [];

    if (negocios.length === 0) {
        contenedor.innerHTML = '<p class="portal-credito-vacio">Todavia no eres cliente en ninguna ferreteria Nexo.</p>';
        return;
    }

    contenedor.innerHTML = "";
    negocios.forEach(function(n) {
        var fila = document.createElement("div");
        fila.className = "portal-tienda-fila";
        fila.innerHTML = '${ICONO_PORTAL_DIRECCION}<strong></strong><a></a>';
        fila.querySelector("strong").textContent = n.nombre;
        var link = fila.querySelector("a");
        link.textContent = "Ver tienda";
        link.href = "/market/ferreteria/" + encodeURIComponent(n.slug);
        contenedor.appendChild(fila);
    });
}

document.querySelectorAll("[data-ir-proximamente]").forEach(function(enlace) {
    enlace.addEventListener("click", function(evento) { evento.preventDefault(); });
});

var marketDrawerCerrarSesionBoton = document.getElementById("marketDrawerCerrarSesion");
if (marketDrawerCerrarSesionBoton) {
    marketDrawerCerrarSesionBoton.addEventListener("click", async function(evento) {
        evento.preventDefault();
        try { await marketLlamar("/personas/logout", { method: "POST" }); } catch (error) { /* continua igual */ }
        window.location.reload();
    });
}

document.getElementById("marketBuscadorForm").addEventListener("submit", function(evento) {
    evento.preventDefault();
    marketOcultarSugerencias();
    var texto = document.getElementById("marketBuscarInput").value.trim();
    var categoria = document.getElementById("marketCategoriaSelect").value;
    if (!texto && !categoria) { marketMostrarInicio(); return; }
    marketMostrarBusqueda({ buscar: texto, categoria: categoria });
});

// Buscador en vivo (sin IA): mientras se escribe, se consulta el mismo
// motor real de busqueda cruzada (pg_trgm sobre nombre + ILIKE sobre
// codigo/marca) que ya usa la busqueda completa -- "bomba" encuentra
// todo tipo de bombas por similitud real, no por un modelo de lenguaje.
var marketSugerenciasTimeout = null;
var marketSugerenciasTextoVigente = "";

function marketOcultarSugerencias() {
    var panel = document.getElementById("marketSugerencias");
    panel.hidden = true;
    panel.innerHTML = "";
}

function marketSugerenciaItemHtml(p) {
    var fotoHtml = p.fotoUrl
        ? '<img src="' + p.fotoUrl + '" alt="" loading="lazy">'
        : ICONO_FOTO_GENERICA;
    var precioMostrado = (p.precioOferta !== null && p.precioOferta !== undefined) ? p.precioOferta : p.precio;
    var precioHtml = (precioMostrado !== null && precioMostrado !== undefined)
        ? '<span class="market-sugerencia-precio">$' + Number(precioMostrado).toFixed(2) + '</span>' : '';

    return '<a class="market-sugerencia-item" href="/market/' + encodeURIComponent(p.slug) + '/catalogo/' + encodeURIComponent(p.codigo) + '">' +
        '<span class="market-sugerencia-foto">' + fotoHtml + '</span>' +
        '<span class="market-sugerencia-texto"><strong>' + escapeHtml(p.nombre) + '</strong><small>' + escapeHtml(p.tienda) + '</small></span>' +
        precioHtml + '</a>';
}

async function marketBuscarSugerencias(texto) {
    marketSugerenciasTextoVigente = texto;
    var datos = await marketLlamar("/market/sugerencias-json?buscar=" + encodeURIComponent(texto));
    // El usuario pudo seguir escribiendo mientras esperabamos la
    // respuesta -- solo se pinta si el texto sigue siendo el vigente.
    if (marketSugerenciasTextoVigente !== texto) return;

    var panel = document.getElementById("marketSugerencias");
    if (!datos.ok || datos.productos.length === 0) {
        panel.innerHTML = '<p class="market-sugerencias-vacio">No encontramos productos para "' + escapeHtml(texto) + '".</p>';
        panel.hidden = false;
        return;
    }
    panel.innerHTML = datos.productos.map(marketSugerenciaItemHtml).join('') +
        '<button type="button" class="market-sugerencias-vertodo" id="marketVerTodoSugerencias">Ver todos los resultados para "' + escapeHtml(texto) + '"</button>';
    panel.hidden = false;
}

document.getElementById("marketBuscarInput").addEventListener("input", function(evento) {
    var texto = evento.target.value.trim();
    clearTimeout(marketSugerenciasTimeout);
    if (texto.length < 2) { marketOcultarSugerencias(); return; }
    marketSugerenciasTimeout = setTimeout(function() { marketBuscarSugerencias(texto); }, 280);
});

document.getElementById("marketBuscarInput").addEventListener("keydown", function(evento) {
    if (evento.key === "Escape") marketOcultarSugerencias();
});

document.addEventListener("click", function(evento) {
    var verTodo = evento.target.closest("#marketVerTodoSugerencias");
    if (verTodo) {
        var texto = document.getElementById("marketBuscarInput").value.trim();
        var categoria = document.getElementById("marketCategoriaSelect").value;
        marketOcultarSugerencias();
        marketMostrarBusqueda({ buscar: texto, categoria: categoria });
        return;
    }
    if (!evento.target.closest(".market-search-wrap")) {
        marketOcultarSugerencias();
    }
});

marketCargarSesion();
marketCargarInicio();

// Bootstrap de deep-link (Fase 1 "Market embebido"): el buscador de la
// barra fija sigue siendo el mismo en cualquier pagina de tienda bajo
// /market/{slug}/..., pero ahi no existe pantalla de resultados propia
// todavia -- enviar una busqueda desde ahi navega de vuelta a
// /market?buscar=...|?categoria=...|?vista=favoritos (ver scriptMarketHeaderHtml).
// Esto hace que esa navegacion aterrice ya con los resultados abiertos.
var marketParamsIniciales = new URLSearchParams(location.search);
var marketOrdenInicialSSR = marketFiltroInicialSSR.orden || marketParamsIniciales.get("orden") || "relevancia";
var marketOfertasInicialSSR = marketFiltroInicialSSR.ofertas || marketParamsIniciales.get("ofertas") === "1";
if (marketParamsIniciales.get("vista") === "favoritos") {
    marketMostrarVistaFavoritos();
} else if (marketParamsIniciales.get("vista") === "pedidos") {
    marketMostrarVistaPedidos();
} else if (marketFiltroInicialSSR.categoria || marketOfertasInicialSSR || marketParamsIniciales.get("buscar") || marketParamsIniciales.get("categoria") || marketParamsIniciales.get("orden")) {
    var marketBuscarInicial = marketParamsIniciales.get("buscar") || "";
    var marketCategoriaInicial = marketFiltroInicialSSR.categoria || marketParamsIniciales.get("categoria") || "";
    document.getElementById("marketBuscarInput").value = marketBuscarInicial;
    document.getElementById("marketCategoriaSelect").value = marketCategoriaInicial;
    marketMostrarBusqueda({ buscar: marketBuscarInicial, categoria: marketCategoriaInicial, ofertas: marketOfertasInicialSSR, orden: marketOrdenInicialSSR });
}

// Boton atras/adelante del navegador -- restaura la vista (inicio,
// categoria via /market/categorias/{slug}, busqueda por query string o
// favoritos) segun la URL a la que se volvio, sin volver a empujar otra
// entrada al historial (marketSincronizandoHistorial).
window.addEventListener("popstate", function() {
    marketSincronizandoHistorial = true;
    var params = new URLSearchParams(location.search);
    var matchCategoria = location.pathname.match(/^\\/market\\/categorias\\/([^\\/]+)$/);

    document.getElementById("marketBuscarInput").value = "";
    document.getElementById("marketCategoriaSelect").value = "";

    if (params.get("vista") === "favoritos") {
        marketMostrarVistaFavoritos();
    } else if (params.get("vista") === "pedidos") {
        marketMostrarVistaPedidos();
    } else if (matchCategoria) {
        var slugBuscado = decodeURIComponent(matchCategoria[1]);
        var categoriaResuelta = "";
        document.querySelectorAll("#marketCategoriaSelect option").forEach(function(opcion) {
            if (opcion.value && marketSlugificar(opcion.value) === slugBuscado) categoriaResuelta = opcion.value;
        });
        document.getElementById("marketCategoriaSelect").value = categoriaResuelta;
        marketMostrarBusqueda({ buscar: "", categoria: categoriaResuelta, orden: params.get("orden") || "relevancia" });
    } else if (location.pathname === "/market/ofertas") {
        marketMostrarBusqueda({ buscar: "", categoria: "", ofertas: true, orden: params.get("orden") || "relevancia" });
    } else if (location.pathname === "/market/nuevos") {
        marketMostrarBusqueda({ buscar: "", categoria: "", orden: "recientes" });
    } else if (params.get("buscar") || params.get("categoria") || params.get("orden") || params.get("ofertas") === "1") {
        var buscarVal = params.get("buscar") || "";
        var categoriaVal = params.get("categoria") || "";
        document.getElementById("marketBuscarInput").value = buscarVal;
        document.getElementById("marketCategoriaSelect").value = categoriaVal;
        marketMostrarBusqueda({ buscar: buscarVal, categoria: categoriaVal, ofertas: params.get("ofertas") === "1", orden: params.get("orden") || "relevancia" });
    } else {
        marketMostrarInicio();
    }
    marketSincronizandoHistorial = false;
});
</script>
</body>
</html>`;
}

async function servirMarketPagina(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8");
    const categoriaInicial = String(req.query?.categoria || "").trim();
    const ofertasInicial = req.query?.ofertas === "1";
    const ordenInicial = String(req.query?.orden || "").trim();
    res.send(paginaMarketHtml({ categoriaInicial, ofertasInicial, ordenInicial }));
}

// GET /market/ofertas -- URL propia para "todas las ofertas", mismo
// mecanismo sin-flash que /market/categorias/{slug} pero sin resolver
// ningun slug (el filtro "ofertas" no depende de datos de una tienda).
async function servirMarketOfertas(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(paginaMarketHtml({ ofertasInicial: true }));
}

// GET /market/nuevos -- idem, para orden=recientes.
async function servirMarketNuevos(req, res) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(paginaMarketHtml({ ordenInicial: "recientes" }));
}

// Mismo SVG generico de "sin foto" que ya usa el script del inicio
// (ICONO_FOTO_GENERICA) -- copiado como constante de servidor porque
// esta pagina renderiza sus tarjetas de producto/categoria en HTML
// directo, no via el script del cliente.
const ICONO_FOTO_GENERICA_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';

// Paleta fija para el avatar-iniciales de las tarjetas de "Ferreterias
// cerca de ti" -- ninguna tienda tiene logo real cargado todavia
// (columna negocios.logo), asi que en vez de un logo generico o
// inventado se usan las iniciales reales del nombre de la tienda sobre
// un color que rota por posicion (mismo criterio ya usado en el POS
// para avatares de empleados sin foto).
const PALETA_AVATAR_TIENDA = ["#0d6efd", "#e2434d", "#0ea472", "#f5a623", "#7c5cff", "#0891b2"];

function inicialesTienda(nombre) {
    const limpio = String(nombre || "").trim();
    if (!limpio) return "?";
    const partes = limpio.split(/\s+/).filter(Boolean);
    return ((partes[0]?.[0] || "") + (partes[1]?.[0] || "")).toUpperCase() || limpio[0].toUpperCase();
}

// GET /market/explora -- pagina propia con TODAS las categorias reales
// (mismas que ya poblaban la tira/grid del inicio via categoriasMarket,
// nunca una lista inventada), cada una con link real a
// /market/categorias/{slug} -- mismo slug que ya resuelve esa ruta, mas
// una foto real de un producto de esa categoria cuando existe.
function tarjetaCategoriaExploraHtml(categoria) {
    const slug = normalizarSlug(categoria.nombre);
    const fotoHtml = categoria.fotoUrl
        ? `<img src="${categoria.fotoUrl}" alt="" loading="lazy">`
        : `<span class="market-categoria-tile-icono-generico">${ICONO_FOTO_GENERICA_SVG}</span>`;
    return `<a class="market-categoria-tile-foto" href="/market/categorias/${encodeURIComponent(slug)}">` +
        `<span class="market-categoria-tile-imagen">${fotoHtml}</span>` +
        `<span class="market-categoria-tile-label">${escaparHtml(categoria.nombre)}</span></a>`;
}

// Tarjeta de producto server-rendered para "Productos populares" --
// mismo shape visual que marketTarjetaProducto (script del inicio),
// reescrita en HTML plano porque esta pagina no depende de JS para
// pintar sus datos (ya vienen calculados desde el servidor).
function tarjetaProductoExploraHtml(p) {
    const tieneOferta = p.precioOferta !== null && p.precioOferta !== undefined
        && p.precio !== null && p.precio !== undefined && p.precioOferta < p.precio;

    let precioHtml = '';
    if (tieneOferta) {
        precioHtml = `<span class="market-producto-precio-tachado">$${Number(p.precio).toFixed(2)}</span>` +
            `<span class="market-precio-actual">$${Number(p.precioOferta).toFixed(2)}</span>` +
            `<span class="market-producto-badge-oferta">Oferta</span>`;
    } else if (p.precio !== null && p.precio !== undefined) {
        precioHtml = `<span class="market-precio-actual">$${Number(p.precio).toFixed(2)}</span>`;
    }

    const existenciaHtml = p.stock !== null && p.stock !== undefined
        ? `<span class="market-producto-existencia${p.stock <= 0 ? ' agotado' : ''}">${p.stock <= 0 ? 'Agotado' : p.stock + ' disponibles'}</span>`
        : `<span class="market-producto-existencia bajo-pedido">Bajo pedido -- confirma con la tienda</span>`;

    const fotoHtml = p.fotoUrl
        ? `<img src="${p.fotoUrl}" alt="${escaparHtml(p.nombre)}" loading="lazy">`
        : ICONO_FOTO_GENERICA_SVG;

    const enlace = `/market/${encodeURIComponent(p.slug)}/catalogo/${encodeURIComponent(p.codigo)}`;

    return `<div class="market-producto-card">` +
        `<a href="${enlace}" class="market-producto-foto">${fotoHtml}</a>` +
        `<span class="market-producto-nombre">${escaparHtml(p.nombre)}</span>` +
        `<span class="market-producto-precios">${precioHtml}</span>` +
        existenciaHtml +
        `<span class="market-producto-tienda">${escaparHtml(p.tienda)}</span>` +
        `<a class="btn primary" href="${enlace}">Ver en ${escaparHtml(p.tienda)}</a></div>`;
}

// Tarjeta de "Ferreterias cerca de ti" -- la distancia real (via
// navigator.geolocation + formula de Haversine, mismo criterio que ya
// usa el sidebar del inicio en marketDistanciaKm) se llena en el
// navegador si el usuario da permiso; sin permiso o sin coordenadas
// reales de la tienda, el span de distancia se queda vacio (nunca un
// numero inventado).
function tarjetaTiendaCercaHtml(t, indice) {
    const color = PALETA_AVATAR_TIENDA[indice % PALETA_AVATAR_TIENDA.length];
    const tieneCoordenadas = typeof t.lat === "number" && typeof t.lng === "number" && !isNaN(t.lat) && !isNaN(t.lng);
    return `<a class="market-tienda-cerca-card" href="/market/${encodeURIComponent(t.slug)}"` +
        (tieneCoordenadas ? ` data-tienda-slug="${escaparHtml(t.slug)}" data-tienda-lat="${t.lat}" data-tienda-lng="${t.lng}"` : '') + `>` +
        `<span class="market-tienda-cerca-avatar" style="background:${color}">${escaparHtml(inicialesTienda(t.nombre))}</span>` +
        `<strong>${escaparHtml(t.nombre)}</strong>` +
        (t.giro ? `<span class="market-tienda-giro">${escaparHtml(t.giro)}</span>` : '') +
        (t.direccion ? `<span class="market-tienda-direccion">${escaparHtml(t.direccion)}</span>` : '') +
        (tieneCoordenadas ? `<span class="market-tienda-cerca-distancia" hidden></span>` : '') +
        `</a>`;
}

async function paginaExploraMarketHtml(pool, firmarTokenImagen) {
    const tiendas = await tiendasPermitidasMarket(pool);
    const idsPermitidos = tiendas.map(t => t.id);

    const [categorias, populares] = await Promise.all([
        categoriasConFotoMarket(pool, firmarTokenImagen),
        popularesMarket(pool, idsPermitidos, firmarTokenImagen, 10)
    ]);

    const categoriasHtml = categorias.length > 0
        ? categorias.map(tarjetaCategoriaExploraHtml).join('')
        : '<p class="market-vacio">Todavia no hay categorias para mostrar.</p>';

    const popularesHtml = populares.length > 0
        ? `<section class="market-explora-seccion"><h2>Productos populares</h2><div class="market-productos-grid market-productos-grid-wrap">${populares.map(tarjetaProductoExploraHtml).join('')}</div></section>`
        : '';

    const tiendasOrdenadas = [...tiendas].sort((a, b) => a.nombre.localeCompare(b.nombre));
    const tiendasCercaHtml = tiendasOrdenadas.length > 0
        ? `<section class="market-explora-seccion market-explora-cerca">` +
            `<div class="market-explora-cerca-header"><h2>Ferreterias cerca de ti</h2>` +
            `<button type="button" id="marketExploraUbicacionBoton" class="market-ubicacion-boton market-ubicacion-boton-inline">Usar mi ubicacion</button></div>` +
            `<p id="marketExploraUbicacionEstado" class="market-vacio-chico" hidden></p>` +
            `<div class="market-tiendas-cerca-grid" id="marketTiendasCercaGrid">${tiendasOrdenadas.map(tarjetaTiendaCercaHtml).join('')}</div>` +
          `</section>`
        : '';

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Explora por categoria -- Nexo Market</title>
<meta name="description" content="Explora todas las categorias de productos disponibles en Nexo Market.">
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}</style>
</head>
<body>
${marketHeaderHtml({ activo: "explora" })}
<main>
<div class="market-layout">
<div class="market-contenido">
<nav class="market-breadcrumb"><a href="/market">Inicio</a> &rsaquo; Explora</nav>
<div class="market-resultados-header"><div><h2>Explora por categoria</h2></div></div>
<div class="market-categorias-grid market-categorias-grid-foto">${categoriasHtml}</div>
${popularesHtml}
${tiendasCercaHtml}
</div>
</div>
</main>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>
(function() {
    function distanciaKm(lat1, lng1, lat2, lng2) {
        var R = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Math.round(R * c * 10) / 10;
    }

    var boton = document.getElementById("marketExploraUbicacionBoton");
    var estado = document.getElementById("marketExploraUbicacionEstado");
    var grid = document.getElementById("marketTiendasCercaGrid");
    if (!boton || !grid) return;

    boton.addEventListener("click", function() {
        if (!navigator.geolocation) {
            estado.hidden = false;
            estado.textContent = "Tu navegador no permite compartir ubicacion.";
            return;
        }
        navigator.geolocation.getCurrentPosition(function(posicion) {
            var lat = posicion.coords.latitude;
            var lng = posicion.coords.longitude;
            var tarjetas = Array.prototype.slice.call(grid.querySelectorAll("[data-tienda-lat]"));
            tarjetas.forEach(function(tarjeta) {
                var km = distanciaKm(lat, lng, Number(tarjeta.dataset.tiendaLat), Number(tarjeta.dataset.tiendaLng));
                tarjeta.dataset.distanciaKm = km;
                var span = tarjeta.querySelector(".market-tienda-cerca-distancia");
                if (span) { span.hidden = false; span.textContent = "a " + km + " km"; }
            });
            tarjetas.sort(function(a, b) { return Number(a.dataset.distanciaKm) - Number(b.dataset.distanciaKm); });
            tarjetas.forEach(function(tarjeta) { grid.appendChild(tarjeta); });
            boton.hidden = true;
            estado.hidden = true;
        }, function() {
            estado.hidden = false;
            estado.textContent = "No pudimos usar tu ubicacion. Revisa el permiso del navegador.";
        });
    });
})();
</script>
</body>
</html>`;
}

async function servirMarketExplora(pool, req, res, firmarTokenImagen) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(await paginaExploraMarketHtml(pool, firmarTokenImagen));
}

// GET /market/ferreterias -- directorio real de tiendas Nexo, misma
// fuente de verdad que ya usa el sidebar (tiendasPermitidasMarket:
// id/slug/nombre/giro/direccion/lat/lng/aceptaCredito reales, ninguna
// coordenada inventada) en un grid de pagina completa en vez de una
// lista corta.
function tarjetaTiendaDirectorioHtml(t) {
    return `<div class="market-tienda-card"><strong>${escaparHtml(t.nombre)}</strong>` +
        (t.giro ? `<span class="market-tienda-giro">${escaparHtml(t.giro)}</span>` : '') +
        (t.direccion ? `<span class="market-tienda-direccion">${escaparHtml(t.direccion)}</span>` : '') +
        `<a class="btn secondary" href="/market/${encodeURIComponent(t.slug)}">Ver tienda</a></div>`;
}

async function paginaFerreteriasMarketHtml(pool) {
    const tiendas = await tiendasPermitidasMarket(pool);
    const tarjetasHtml = tiendas.length > 0
        ? tiendas.map(tarjetaTiendaDirectorioHtml).join('')
        : '<p class="market-vacio">Todavia no hay ferreterias Nexo activas para mostrar.</p>';
    const conUbicacion = tiendas.filter(t => typeof t.lat === "number" && typeof t.lng === "number" && !isNaN(t.lat) && !isNaN(t.lng));
    const datosMapaJson = JSON.stringify(conUbicacion.map(t => ({ nombre: t.nombre, slug: t.slug, lat: t.lat, lng: t.lng })));

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ferreterias Nexo -- Nexo Market</title>
<meta name="description" content="Directorio de ferreterias Nexo: revisa cual esta mas cerca y visita su catalogo.">
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
<link rel="stylesheet" href="/site/styles.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>${ESTILOS_MARKET}</style>
</head>
<body>
${marketHeaderHtml({ activo: "ferreterias" })}
<main>
<div class="market-layout">
<div class="market-contenido">
<nav class="market-breadcrumb"><a href="/market">Inicio</a> &rsaquo; Ferreterias</nav>
<div class="market-resultados-header"><div><h2>Ferreterias Nexo</h2><span class="market-resultados-conteo">${tiendas.length === 1 ? '1 ferreteria' : tiendas.length + ' ferreterias'}</span></div></div>
<div id="marketFerreteriasMapa" class="market-mapa-tiendas" hidden></div>
<div class="market-tiendas-grid">${tarjetasHtml}</div>
</div>
</div>
</main>
${marketFooterHtml()}
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>
(function() {
    var tiendas = ${datosMapaJson};
    var contenedor = document.getElementById("marketFerreteriasMapa");
    if (!contenedor || tiendas.length === 0 || typeof L === "undefined") return;
    contenedor.hidden = false;
    var mapa = L.map("marketFerreteriasMapa", { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19
    }).addTo(mapa);
    var marcadores = tiendas.map(function(t) {
        var marcador = L.marker([t.lat, t.lng]).addTo(mapa);
        marcador.bindPopup("<strong>" + t.nombre.replace(/</g, "&lt;") + "</strong><br><a href=\\"/market/" + encodeURIComponent(t.slug) + "\\">Ver tienda</a>");
        return marcador;
    });
    if (marcadores.length === 1) {
        mapa.setView([tiendas[0].lat, tiendas[0].lng], 14);
    } else {
        mapa.fitBounds(L.featureGroup(marcadores).getBounds().pad(0.2));
    }
})();
</script>
</body>
</html>`;
}

async function servirMarketFerreterias(pool, req, res) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(await paginaFerreteriasMarketHtml(pool));
}

// GET /market/credito-nexo -- mismo criterio real que ya usa
// marketPintarCreditoNexo en el sidebar (t.aceptaCredito), en una pagina
// propia. Mensaje honesto si ninguna tienda acepta credito, misma
// redaccion que ya existe en el sidebar.
function tarjetaCreditoNexoHtml(t) {
    return `<div class="market-tienda-card"><strong>${escaparHtml(t.nombre)}</strong>` +
        (t.giro ? `<span class="market-tienda-giro">${escaparHtml(t.giro)}</span>` : '') +
        (t.direccion ? `<span class="market-tienda-direccion">${escaparHtml(t.direccion)}</span>` : '') +
        `<a class="btn primary" href="https://${escaparHtml(t.slug)}.nexoposoficial.com/solicitud-credito">Solicitar credito</a></div>`;
}

async function paginaCreditoNexoMarketHtml(pool) {
    const tiendas = await tiendasPermitidasMarket(pool);
    const conCredito = tiendas.filter(t => t.aceptaCredito);
    const tarjetasHtml = conCredito.length > 0
        ? conCredito.map(tarjetaCreditoNexoHtml).join('')
        : '<p class="market-vacio">Ninguna ferreteria Nexo acepta solicitudes de credito por ahora.</p>';

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Credito Nexo -- Nexo Market</title>
<meta name="description" content="Ferreterias Nexo que aceptan solicitudes de credito directo en su tienda.">
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}</style>
</head>
<body>
${marketHeaderHtml({ activo: "credito" })}
<main>
<div class="market-layout">
<div class="market-contenido">
<nav class="market-breadcrumb"><a href="/market">Inicio</a> &rsaquo; Credito Nexo</nav>
<div class="market-resultados-header"><div><h2>Credito Nexo</h2><span class="market-resultados-conteo">${conCredito.length === 1 ? '1 ferreteria' : conCredito.length + ' ferreterias'}</span></div></div>
<div class="market-tiendas-grid">${tarjetasHtml}</div>
</div>
</div>
</main>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
</body>
</html>`;
}

async function servirMarketCreditoNexo(pool, req, res) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(await paginaCreditoNexoMarketHtml(pool));
}

// GET /market/categorias/:slug -- URL propia y compartible por categoria
// (antes solo existia como filtro por query string sobre /market, que
// nunca cambiaba de URL al hacer clic en una tarjeta ni sobrevivia un
// refresh/atras). El slug se resuelve contra las categorias REALES de
// los productos de las tiendas permitidas -- nunca se inventa una
// categoria ni se acepta un slug que no corresponda a ninguna.
async function servirMarketCategoria(pool, req, res) {
    try {
        const slug = String(req.params?.slug || "").trim().toLowerCase();
        const tiendas = await tiendasPermitidasMarket(pool);
        const idsPermitidos = tiendas.map(t => t.id);

        if (idsPermitidos.length === 0) { res.redirect(302, "/market"); return; }

        const filas = await pool.query(
            `SELECT DISTINCT categoria FROM public.productos
             WHERE negocio_id = ANY($1::int[]) AND categoria IS NOT NULL AND categoria <> ''`,
            [idsPermitidos]
        );
        const categoriaReal = filas.rows.map(f => f.categoria).find(cat => normalizarSlug(cat) === slug);

        if (!categoriaReal) { res.redirect(302, "/market"); return; }

        res.set("Content-Type", "text/html; charset=utf-8");
        res.send(paginaMarketHtml({ categoriaInicial: categoriaReal }));
    } catch (error) {
        res.redirect(302, "/market");
    }
}

module.exports = {
    servirMarketPagina, servirMarketCategoria, servirMarketOfertas, servirMarketNuevos, servirMarketExplora, servirMarketFerreterias, servirMarketCreditoNexo, buscarMarketJson, sugerenciasMarketJson, inicioMarketJson, favoritosMarketJson, tiendasPermitidasMarket,
    carritoProductosMarketJson,
    ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml, metaInstalableMarketHtml
};

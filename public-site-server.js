// Sitio web publico por negocio -- servido en {slug}.nexoposoficial.com.
//
// Fase 1: pagina informativa (logo, descripcion, contacto).
// Fase 2: catalogo publico conectado al inventario real (buscador,
// filtros de categoria/marca, paginacion, mostrar/ocultar precios y
// existencias) + pagina de detalle de producto.
//
// A diferencia del resto de modulos de server-modules.js, este archivo
// expone varias cosas distintas:
//   - registrarRutas(app, pool, requerirAccesoNegocio): las 2 rutas
//     autenticadas de configuracion (GET/PUT /negocio-actual/sitio-web),
//     registradas igual que cualquier otro modulo.
//   - servirSitioNegocio / servirCatalogoNegocio / servirProductoNegocio:
//     llamadas directo desde los handlers GET que ya existen en
//     server.js (no se pueden mover ahi porque esos handlers deciden
//     entre landing comercial / POS / sitio de negocio segun el host).

const { funcionDelPlan } = require("./plan-enforcement");
const { enviarCorreoPedidoPublico } = require("./email");

const CLAVE_FUNCION_SITIO_WEB = "sitio_web.pagina";
const TAMANO_MAXIMO_PORTADA = 3 * 1024 * 1024;
const PRODUCTOS_POR_PAGINA_CATALOGO = 24;
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Copia local del mismo limitador en memoria que ya usa server.js
// (crearLimitadorPorIp) -- mismo criterio de helpers chicos duplicados
// por archivo ya seguido en este modulo (escaparHtml,
// normalizarTelefonoWhatsApp), en vez de importar server.js aqui.
function crearLimitadorPorIp(maxIntentos, ventanaMs) {
    const registro = new Map();
    return {
        bloqueado(ip) {
            const entrada = registro.get(ip);
            return Boolean(entrada?.bloqueadoHasta && entrada.bloqueadoHasta > Date.now());
        },
        registrarFallo(ip) {
            const entrada = registro.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
            entrada.fallos += 1;
            if (entrada.fallos >= maxIntentos) {
                entrada.bloqueadoHasta = Date.now() + ventanaMs;
            }
            registro.set(ip, entrada);
        },
        registrarExito(ip) {
            registro.delete(ip);
        }
    };
}

const limitadorPedidoPublico = crearLimitadorPorIp(5, 60 * 60 * 1000);

function escaparHtml(valor) {
    return String(valor || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizarTelefonoWhatsApp(telefono) {
    const digitos = String(telefono || "").replace(/\D/g, "");
    if (!digitos) return null;
    if (digitos.length === 10) return `52${digitos}`;
    return digitos.length >= 10 ? digitos : null;
}

async function negocioActual(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(
        `SELECT id, slug, nombre FROM public.negocios WHERE id = $1 LIMIT 1`,
        [negocioId]
    );

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

// Punto unico de resolucion para las 3 paginas publicas (info, catalogo,
// detalle de producto): confirma que el negocio existe, esta activo,
// tiene el sitio web activado y su plan incluye la funcion. Cualquier
// falla regresa null -- las 3 rutas responden el mismo 404 generico,
// sin distinguir el motivo (mismo criterio "fail closed" de la Fase 1).
async function resolverSitioPublico(pool, slug) {
    const resultado = await pool.query(
        `
        SELECT
            n.id, n.slug, n.nombre, n.telefono, n.direccion, n.logo, n.color, n.estado, n.correo,
            c.activo, c.descripcion, c.portada, c.horario_texto, c.whatsapp, c.facebook, c.instagram,
            c.mostrar_precios, c.mostrar_existencias
        FROM public.negocios n
        LEFT JOIN public.sitio_web_config c ON c.negocio_id = n.id
        WHERE n.slug = $1
        LIMIT 1
        `,
        [slug]
    );

    const fila = resultado.rows[0];

    if (!fila || fila.estado !== "activo" || !fila.activo) {
        return null;
    }

    const acceso = await funcionDelPlan(fila.id, CLAVE_FUNCION_SITIO_WEB);

    if (!acceso.incluido) {
        return null;
    }

    return {
        negocio: {
            id: fila.id,
            slug: fila.slug,
            nombre: fila.nombre,
            telefono: fila.telefono,
            direccion: fila.direccion,
            logo: fila.logo,
            color: fila.color,
            correo: fila.correo
        },
        config: {
            descripcion: fila.descripcion,
            portada: fila.portada,
            horarioTexto: fila.horario_texto,
            whatsapp: fila.whatsapp,
            facebook: fila.facebook,
            instagram: fila.instagram,
            mostrarPrecios: fila.mostrar_precios,
            mostrarExistencias: fila.mostrar_existencias
        }
    };
}

function colorSeguro(color) {
    return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#1067e8";
}

// Bloque <style> compartido por las 3 paginas publicas (info, catalogo,
// detalle) -- un solo lugar para los tokens de color/nav/footer y para
// las clases nuevas de grilla/tarjeta/filtros/paginacion de la Fase 2.
function estilosBaseTenant(color) {
    const colorFinal = colorSeguro(color);
    return `
:root{ --blue:${colorFinal}; --blue-dark:${colorFinal}; }
.tenant-header{ display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; padding:20px clamp(20px,5vw,64px); }
.tenant-header-marca{ display:flex; align-items:center; gap:12px; }
.tenant-header-marca img{ width:44px; height:44px; border-radius:12px; object-fit:cover; }
.tenant-header-marca strong{ font-size:19px; }
.tenant-nav{ display:flex; gap:22px; }
.tenant-nav a{ color:var(--muted); font-weight:600; font-size:14px; }
.tenant-nav a.activo{ color:var(--blue); }
.tenant-portada{ margin:0 clamp(20px,5vw,64px); border-radius:20px; height:clamp(160px,30vw,260px); overflow:hidden; background:linear-gradient(135deg, ${colorFinal}, var(--ink)); }
.tenant-portada img{ width:100%; height:100%; object-fit:cover; display:block; }
.tenant-main{ max-width:1080px; margin:0 auto; padding:32px clamp(20px,5vw,64px) 64px; }
.tenant-main-angosto{ max-width:820px; }
.tenant-main p{ color:var(--muted); font-size:16px; line-height:1.7; }
.tenant-datos{ display:grid; gap:14px; margin:28px 0; padding:20px; border:1px solid var(--line); border-radius:16px; background:var(--glass); }
.tenant-datos div{ display:flex; justify-content:space-between; gap:16px; font-size:14px; }
.tenant-datos strong{ color:var(--ink); }
.tenant-datos span{ color:var(--muted); text-align:right; }
.tenant-acciones{ display:flex; flex-wrap:wrap; gap:12px; margin-top:24px; }
.tenant-boton-whatsapp{ display:inline-flex; align-items:center; padding:12px 22px; border-radius:999px; background:var(--mint); color:#fff; font-weight:700; }
.tenant-boton-secundario{ display:inline-flex; align-items:center; padding:12px 22px; border-radius:999px; background:var(--glass); border:1px solid var(--line); color:var(--ink); font-weight:700; }
.tenant-redes{ display:flex; gap:16px; margin-top:8px; }
.tenant-redes a{ color:var(--blue); font-weight:600; }
.tenant-footer{ text-align:center; padding:32px; color:var(--muted); font-size:13px; }
.tenant-filtros{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:24px; }
.tenant-filtros input[type="text"], .tenant-filtros select{ padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:var(--paper); color:var(--ink); font-size:14px; }
.tenant-filtros input[type="text"]{ flex:1; min-width:200px; }
.tenant-filtros button{ padding:10px 20px; border-radius:12px; border:none; background:var(--blue); color:#fff; font-weight:700; cursor:pointer; }
.tenant-catalogo-titulo{ margin:0 0 20px; font-size:22px; }
.tenant-catalogo-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:18px; }
.tenant-producto-card{ display:block; border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--glass); color:inherit; }
.tenant-producto-foto{ aspect-ratio:1/1; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden; }
.tenant-producto-foto img{ width:100%; height:100%; object-fit:cover; display:block; }
.tenant-producto-foto-vacia{ color:var(--muted); font-size:12px; }
.tenant-producto-info{ padding:14px; display:grid; gap:6px; }
.tenant-producto-nombre{ font-size:14px; font-weight:700; color:var(--ink); }
.tenant-producto-precio{ font-size:15px; font-weight:800; color:var(--blue); }
.tenant-producto-existencia{ font-size:12px; color:var(--mint); font-weight:600; }
.tenant-producto-existencia.agotado{ color:#e2434d; }
.tenant-catalogo-vacio{ padding:48px 0; text-align:center; color:var(--muted); }
.tenant-paginacion{ display:flex; justify-content:center; gap:12px; margin-top:32px; }
.tenant-paginacion a{ padding:10px 18px; border-radius:12px; border:1px solid var(--line); color:var(--ink); font-weight:600; }
.tenant-paginacion span{ padding:10px 18px; color:var(--muted); }
.tenant-detalle-grid{ display:grid; grid-template-columns:minmax(0,360px) 1fr; gap:36px; }
.tenant-detalle-foto{ aspect-ratio:1/1; border-radius:20px; overflow:hidden; background:var(--paper); display:flex; align-items:center; justify-content:center; }
.tenant-detalle-foto img{ width:100%; height:100%; object-fit:cover; display:block; }
.tenant-detalle-foto-vacia{ color:var(--muted); }
.tenant-detalle-precio{ font-size:26px; font-weight:800; color:var(--blue); margin:10px 0; }
.tenant-detalle-garantia{ margin-top:16px; padding:14px; border-radius:14px; background:var(--glass); border:1px solid var(--line); font-size:13px; color:var(--muted); }
.tenant-volver{ display:inline-block; margin-bottom:20px; color:var(--muted); font-weight:600; }
.tenant-pedido-banner{ margin-bottom:20px; padding:14px 18px; border-radius:14px; font-size:14px; font-weight:600; }
.tenant-pedido-banner.exito{ background:rgba(24,184,143,.14); color:var(--mint); border:1px solid rgba(24,184,143,.3); }
.tenant-pedido-banner.error{ background:rgba(226,67,77,.12); color:#e2434d; border:1px solid rgba(226,67,77,.3); }
.tenant-pedido-form{ margin-top:28px; padding:20px; border-radius:16px; border:1px solid var(--line); background:var(--glass); display:grid; gap:12px; }
.tenant-pedido-form h2{ margin:0 0 4px; font-size:17px; }
.tenant-pedido-form label{ display:grid; gap:6px; font-size:13px; color:var(--muted); font-weight:600; }
.tenant-pedido-form input[type="text"], .tenant-pedido-form input[type="number"], .tenant-pedido-form textarea{ padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:var(--paper); color:var(--ink); font-size:14px; font-family:inherit; }
.tenant-pedido-form textarea{ resize:vertical; min-height:70px; }
.tenant-pedido-form .tenant-pedido-honeypot{ position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
.tenant-pedido-form button{ padding:12px 22px; border-radius:999px; border:none; background:var(--blue); color:#fff; font-weight:700; cursor:pointer; justify-self:start; }
@media (max-width:720px){ .tenant-detalle-grid{ grid-template-columns:1fr; } }
`;
}

function encabezadoTenantHtml(datos, paginaActiva) {
    const nombre = escaparHtml(datos.nombre);
    return `<header class="tenant-header">
<div class="tenant-header-marca">
${datos.logo ? `<img src="${escaparHtml(datos.logo)}" alt="Logo ${nombre}">` : ""}
<strong>${nombre}</strong>
</div>
<nav class="tenant-nav">
<a href="/" class="${paginaActiva === "inicio" ? "activo" : ""}">Inicio</a>
<a href="/catalogo" class="${paginaActiva === "catalogo" ? "activo" : ""}">Catalogo</a>
</nav>
</header>`;
}

function renderizarPaginaNegocio(datos) {
    const nombre = escaparHtml(datos.nombre);
    const descripcion = escaparHtml(datos.descripcion);
    const direccion = escaparHtml(datos.direccion);
    const telefono = escaparHtml(datos.telefono);
    const horarioTexto = escaparHtml(datos.horarioTexto);
    const color = colorSeguro(datos.color);
    const urlPublica = `https://${datos.slug}.nexoposoficial.com`;
    const imagenMeta = datos.portada || datos.logo || "";

    const whatsappNumero = normalizarTelefonoWhatsApp(datos.whatsapp);
    const whatsappHtml = whatsappNumero
        ? `<a class="tenant-boton-whatsapp" href="https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, vi ${datos.nombre} en su pagina y quiero mas informacion.`)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>`
        : "";

    const redesHtml = [
        datos.facebook ? `<a href="${escaparHtml(datos.facebook)}" target="_blank" rel="noopener">Facebook</a>` : "",
        datos.instagram ? `<a href="${escaparHtml(datos.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""
    ].filter(Boolean).join("");

    const datosFilas = [
        direccion ? `<div><strong>Direccion</strong><span>${direccion}</span></div>` : "",
        telefono ? `<div><strong>Telefono</strong><span>${telefono}</span></div>` : "",
        horarioTexto ? `<div><strong>Horario</strong><span>${horarioTexto}</span></div>` : ""
    ].filter(Boolean).join("");

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${nombre}</title>
<meta name="description" content="${descripcion || `${nombre} -- informacion, contacto y ubicacion.`}">
<meta property="og:title" content="${nombre}">
<meta property="og:description" content="${descripcion || `${nombre} -- informacion, contacto y ubicacion.`}">
${imagenMeta ? `<meta property="og:image" content="${escaparHtml(imagenMeta)}">` : ""}
<meta property="og:url" content="${urlPublica}">
<meta property="og:type" content="business.business">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
</head>
<body>
${encabezadoTenantHtml(datos, "inicio")}
<div class="tenant-portada">${datos.portada ? `<img src="${escaparHtml(datos.portada)}" alt="">` : ""}</div>
<main class="tenant-main tenant-main-angosto">
${descripcion ? `<p>${descripcion}</p>` : ""}
${datosFilas ? `<div class="tenant-datos">${datosFilas}</div>` : ""}
<div class="tenant-acciones">${whatsappHtml}<a class="tenant-boton-secundario" href="/catalogo">Ver catalogo</a></div>
${redesHtml ? `<div class="tenant-redes">${redesHtml}</div>` : ""}
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo POS</footer>
</body>
</html>`;
}

async function servirSitioNegocio(pool, req, res, slug) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const html = renderizarPaginaNegocio({
            slug: sitio.negocio.slug,
            nombre: sitio.negocio.nombre,
            telefono: sitio.negocio.telefono,
            direccion: sitio.negocio.direccion,
            logo: sitio.negocio.logo,
            color: sitio.negocio.color,
            descripcion: sitio.config.descripcion,
            portada: sitio.config.portada,
            horarioTexto: sitio.config.horarioTexto,
            whatsapp: sitio.config.whatsapp,
            facebook: sitio.config.facebook,
            instagram: sitio.config.instagram
        });

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo sitio de negocio:", error.message);
        res.status(500).send("Error");
    }
}

function paramTexto(valor, maximo) {
    return String(valor || "").trim().slice(0, maximo);
}

function construirQueryString(params) {
    const partes = Object.entries(params)
        .filter(([, valor]) => valor !== undefined && valor !== null && valor !== "")
        .map(([clave, valor]) => `${encodeURIComponent(clave)}=${encodeURIComponent(valor)}`);
    return partes.length ? `?${partes.join("&")}` : "";
}

async function servirCatalogoNegocio(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const buscar = paramTexto(req.query.buscar, 120);
        const categoria = paramTexto(req.query.categoria, 120);
        const marca = paramTexto(req.query.marca, 120);
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
        const offset = (pagina - 1) * PRODUCTOS_POR_PAGINA_CATALOGO;

        const valores = [sitio.negocio.id];
        const condiciones = ["p.negocio_id = $1"];

        if (buscar) {
            valores.push(buscar);
            const indiceTrgm = valores.length;
            valores.push(`%${buscar}%`);
            const indiceIlike = valores.length;
            condiciones.push(`(p.nombre % $${indiceTrgm} OR p.codigo ILIKE $${indiceIlike} OR p.marca ILIKE $${indiceIlike})`);
        }

        if (categoria) {
            valores.push(categoria);
            condiciones.push(`p.categoria = $${valores.length}`);
        }

        if (marca) {
            valores.push(marca);
            condiciones.push(`p.marca = $${valores.length}`);
        }

        const columnasExtra = [
            sitio.config.mostrarPrecios ? "COALESCE(p.precio_publico, p.precio) AS precio" : null,
            sitio.config.mostrarExistencias ? "p.stock" : null
        ].filter(Boolean);

        valores.push(PRODUCTOS_POR_PAGINA_CATALOGO, offset);

        const filas = await pool.query(
            `
            SELECT p.id, p.codigo, p.nombre, p.categoria, p.marca,
                ${columnasExtra.length ? columnasExtra.join(", ") + "," : ""}
                COUNT(*) OVER() AS total
            FROM public.productos p
            WHERE ${condiciones.join(" AND ")}
            ORDER BY p.nombre ASC
            LIMIT $${valores.length - 1} OFFSET $${valores.length}
            `,
            valores
        );

        const productos = filas.rows;
        const total = productos.length ? Number(productos[0].total) : 0;
        const totalPaginas = Math.max(1, Math.ceil(total / PRODUCTOS_POR_PAGINA_CATALOGO));

        let fotosPorCodigo = new Set();
        if (productos.length) {
            const codigos = productos.map(p => p.codigo);
            const fotos = await pool.query(
                `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2)`,
                [sitio.negocio.id, codigos]
            );
            fotosPorCodigo = new Set(fotos.rows.map(f => f.codigo));
        }

        const [categoriasRes, marcasRes] = await Promise.all([
            pool.query(
                `SELECT DISTINCT categoria FROM public.productos WHERE negocio_id = $1 AND categoria IS NOT NULL AND categoria <> '' ORDER BY categoria`,
                [sitio.negocio.id]
            ),
            pool.query(
                `SELECT DISTINCT marca FROM public.productos WHERE negocio_id = $1 AND marca IS NOT NULL AND marca <> '' ORDER BY marca`,
                [sitio.negocio.id]
            )
        ]);

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);

        const tarjetasHtml = productos.length
            ? productos.map(p => {
                const tieneFoto = fotosPorCodigo.has(p.codigo);
                const fotoUrl = tieneFoto
                    ? `/fotos-producto/${encodeURIComponent(p.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, p.codigo)}`
                    : "";
                const stock = p.stock !== undefined && p.stock !== null ? Number(p.stock) : null;
                const existenciaHtml = stock !== null
                    ? `<span class="tenant-producto-existencia${stock <= 0 ? " agotado" : ""}">${stock <= 0 ? "Agotado" : `${stock} disponibles`}</span>`
                    : "";
                const precioHtml = p.precio !== undefined && p.precio !== null
                    ? `<span class="tenant-producto-precio">$${Number(p.precio).toFixed(2)}</span>`
                    : "";

                return `<a class="tenant-producto-card" href="/catalogo/${encodeURIComponent(p.codigo)}">
<div class="tenant-producto-foto">${fotoUrl ? `<img src="${fotoUrl}" alt="${escaparHtml(p.nombre)}">` : `<span class="tenant-producto-foto-vacia">Sin foto</span>`}</div>
<div class="tenant-producto-info">
<span class="tenant-producto-nombre">${escaparHtml(p.nombre)}</span>
${precioHtml}
${existenciaHtml}
</div>
</a>`;
            }).join("")
            : "";

        const opcionesCategoria = categoriasRes.rows.map(f =>
            `<option value="${escaparHtml(f.categoria)}"${f.categoria === categoria ? " selected" : ""}>${escaparHtml(f.categoria)}</option>`
        ).join("");

        const opcionesMarca = marcasRes.rows.map(f =>
            `<option value="${escaparHtml(f.marca)}"${f.marca === marca ? " selected" : ""}>${escaparHtml(f.marca)}</option>`
        ).join("");

        const paginacionHtml = totalPaginas > 1
            ? `<div class="tenant-paginacion">
${pagina > 1 ? `<a href="/catalogo${construirQueryString({ buscar, categoria, marca, pagina: pagina - 1 })}">Anterior</a>` : ""}
<span>Pagina ${pagina} de ${totalPaginas}</span>
${pagina < totalPaginas ? `<a href="/catalogo${construirQueryString({ buscar, categoria, marca, pagina: pagina + 1 })}">Siguiente</a>` : ""}
</div>`
            : "";

        const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catalogo -- ${nombre}</title>
<meta name="description" content="Catalogo de productos de ${nombre}.">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
</head>
<body>
${encabezadoTenantHtml(sitio.negocio, "catalogo")}
<main class="tenant-main">
<h1 class="tenant-catalogo-titulo">Catalogo de productos</h1>
<form class="tenant-filtros" method="GET" action="/catalogo">
<input type="text" name="buscar" placeholder="Buscar por nombre, codigo o marca" value="${escaparHtml(buscar)}">
<select name="categoria"><option value="">Todas las categorias</option>${opcionesCategoria}</select>
<select name="marca"><option value="">Todas las marcas</option>${opcionesMarca}</select>
<button type="submit">Buscar</button>
</form>
${productos.length
    ? `<div class="tenant-catalogo-grid">${tarjetasHtml}</div>${paginacionHtml}`
    : `<div class="tenant-catalogo-vacio">No encontramos productos con esos filtros.</div>`}
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo POS</footer>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo catalogo de negocio:", error.message);
        res.status(500).send("Error");
    }
}

async function servirProductoNegocio(pool, req, res, slug, codigo, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const productoRes = await pool.query(
            `
            SELECT id, codigo, nombre, categoria, marca, descripcion, precio, precio_publico, stock,
                tiene_garantia, garantia_detalle
            FROM public.productos
            WHERE negocio_id = $1 AND codigo = $2
            LIMIT 1
            `,
            [sitio.negocio.id, codigo]
        );

        const producto = productoRes.rows[0];

        if (!producto) {
            res.status(404).send("No encontrado");
            return;
        }

        const fotoRes = await pool.query(
            `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`,
            [sitio.negocio.id, producto.codigo]
        );
        const tieneFoto = fotoRes.rows.length > 0;
        const fotoUrl = tieneFoto
            ? `/fotos-producto/${encodeURIComponent(producto.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, producto.codigo)}`
            : "";

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);
        const nombreProducto = escaparHtml(producto.nombre);
        const precio = sitio.config.mostrarPrecios
            ? Number(producto.precio_publico ?? producto.precio)
            : null;
        const stock = sitio.config.mostrarExistencias ? Number(producto.stock) : null;

        const whatsappNumero = normalizarTelefonoWhatsApp(sitio.config.whatsapp);
        const whatsappHtml = whatsappNumero
            ? `<a class="tenant-boton-whatsapp" href="https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, me interesa "${producto.nombre}" que vi en su catalogo.`)}" target="_blank" rel="noopener">Preguntar por WhatsApp</a>`
            : "";

        const estadoPedido = paramTexto(req.query.pedido, 20);
        const bannerPedidoHtml = estadoPedido === "enviado"
            ? `<div class="tenant-pedido-banner exito">Listo -- tu pedido fue enviado. El negocio te contactara pronto.</div>`
            : estadoPedido === "error"
                ? `<div class="tenant-pedido-banner error">No pudimos enviar tu pedido. Revisa tus datos e intenta de nuevo.</div>`
                : "";

        const formularioPedidoHtml = `
<form class="tenant-pedido-form" method="POST" action="/catalogo/${encodeURIComponent(producto.codigo)}/pedido">
<h2>Pedir este producto</h2>
<div class="tenant-pedido-honeypot" aria-hidden="true"><label>No llenar<input type="text" name="sitioExtra" tabindex="-1" autocomplete="off"></label></div>
<label>Cantidad<input type="number" name="cantidad" min="1" step="1" value="1" required></label>
<label>Tu nombre<input type="text" name="clienteNombre" maxlength="140" required></label>
<label>Telefono<input type="text" name="clienteTelefono" maxlength="40" placeholder="10 digitos"></label>
<label>Correo (opcional)<input type="text" name="clienteCorreo" maxlength="140"></label>
<label>Mensaje (opcional)<textarea name="mensaje" maxlength="500"></textarea></label>
<button type="submit">Enviar pedido</button>
</form>`;

        const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${nombreProducto} -- ${nombre}</title>
<meta name="description" content="${nombreProducto} disponible en ${nombre}.">
<meta property="og:title" content="${nombreProducto}">
<meta property="og:description" content="Disponible en ${nombre}.">
${fotoUrl ? `<meta property="og:image" content="${fotoUrl}">` : ""}
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
</head>
<body>
${encabezadoTenantHtml(sitio.negocio, "catalogo")}
<main class="tenant-main">
<a class="tenant-volver" href="/catalogo">&larr; Volver al catalogo</a>
${bannerPedidoHtml}
<div class="tenant-detalle-grid">
<div class="tenant-detalle-foto">${fotoUrl ? `<img src="${fotoUrl}" alt="${nombreProducto}">` : `<span class="tenant-detalle-foto-vacia">Sin foto</span>`}</div>
<div>
<h1>${nombreProducto}</h1>
${producto.marca ? `<p>${escaparHtml(producto.marca)}${producto.categoria ? ` &middot; ${escaparHtml(producto.categoria)}` : ""}</p>` : (producto.categoria ? `<p>${escaparHtml(producto.categoria)}</p>` : "")}
${precio !== null && Number.isFinite(precio) ? `<div class="tenant-detalle-precio">$${precio.toFixed(2)}</div>` : ""}
${stock !== null ? `<span class="tenant-producto-existencia${stock <= 0 ? " agotado" : ""}">${stock <= 0 ? "Agotado" : `${stock} disponibles`}</span>` : ""}
${producto.descripcion ? `<p>${escaparHtml(producto.descripcion)}</p>` : ""}
${producto.tiene_garantia ? `<div class="tenant-detalle-garantia">Este producto tiene garantia${producto.garantia_detalle ? `: ${escaparHtml(producto.garantia_detalle)}` : "."}</div>` : ""}
<div class="tenant-acciones">${whatsappHtml}</div>
</div>
</div>
${formularioPedidoHtml}
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo POS</footer>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo producto de negocio:", error.message);
        res.status(500).send("Error");
    }
}

// Recibe el formulario publico "Pedir este producto" (<form
// method="POST">, sin fetch/JSON) de la pagina de detalle. Nunca
// responde JSON -- siempre redirige de vuelta a la pagina del
// producto con ?pedido=enviado|error, mismo criterio "HTML servido
// por el servidor" del resto del sitio publico.
async function recibirPedidoPublico(pool, req, res, slug, codigo) {
    const volverConError = () => res.redirect(303, `/catalogo/${encodeURIComponent(codigo)}?pedido=error`);

    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        // Honeypot -- campo oculto que un visitante real nunca llena.
        if (paramTexto(req.body?.sitioExtra, 200)) {
            volverConError();
            return;
        }

        if (limitadorPedidoPublico.bloqueado(req.ip)) {
            volverConError();
            return;
        }

        limitadorPedidoPublico.registrarFallo(req.ip);

        const productoRes = await pool.query(
            `SELECT nombre FROM public.productos WHERE negocio_id = $1 AND codigo = $2 LIMIT 1`,
            [sitio.negocio.id, codigo]
        );

        const producto = productoRes.rows[0];

        if (!producto) {
            res.status(404).send("No encontrado");
            return;
        }

        const cantidad = Math.min(9999, Math.max(1, parseInt(req.body?.cantidad, 10) || 1));
        const clienteNombre = paramTexto(req.body?.clienteNombre, 140);
        const clienteTelefono = paramTexto(req.body?.clienteTelefono, 40);
        const clienteCorreo = paramTexto(req.body?.clienteCorreo, 140).toLowerCase();
        const mensaje = paramTexto(req.body?.mensaje, 500);

        if (!clienteNombre) {
            volverConError();
            return;
        }

        if (!clienteTelefono && !clienteCorreo) {
            volverConError();
            return;
        }

        if (clienteCorreo && !REGEX_CORREO.test(clienteCorreo)) {
            volverConError();
            return;
        }

        await pool.query(
            `
            INSERT INTO public.pedidos_publicos
                (negocio_id, producto_codigo, producto_nombre, cantidad, cliente_nombre, cliente_telefono, cliente_correo, mensaje, ip)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `,
            [sitio.negocio.id, codigo, producto.nombre, cantidad, clienteNombre, clienteTelefono, clienteCorreo, mensaje, req.ip]
        );

        if (sitio.negocio.correo) {
            enviarCorreoPedidoPublico(sitio.negocio.correo, sitio.negocio.nombre, {
                productoNombre: producto.nombre,
                cantidad,
                clienteNombre,
                clienteTelefono,
                clienteCorreo,
                mensaje,
                urlProducto: `https://${slug}.nexoposoficial.com/catalogo/${encodeURIComponent(codigo)}`
            }).catch(error => console.warn("No se pudo enviar el aviso de pedido publico:", error.message));
        }

        res.redirect(303, `/catalogo/${encodeURIComponent(codigo)}?pedido=enviado`);
    } catch (error) {
        console.warn("Error recibiendo pedido publico:", error.message);
        volverConError();
    }
}

function registrarRutas(app, pool, requerirAccesoNegocio) {
    app.get("/negocio-actual/sitio-web", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);

            const resultado = await pool.query(
                `SELECT activo, descripcion, portada, horario_texto, whatsapp, facebook, instagram, mostrar_precios, mostrar_existencias FROM public.sitio_web_config WHERE negocio_id = $1`,
                [negocio.id]
            );

            const config = resultado.rows[0] || {
                activo: false, descripcion: "", portada: null,
                horario_texto: "", whatsapp: "", facebook: "", instagram: "",
                mostrar_precios: false, mostrar_existencias: false
            };

            res.json({
                ok: true,
                incluido: acceso.incluido,
                slug: negocio.slug,
                urlPublica: `https://${negocio.slug}.nexoposoficial.com`,
                activo: config.activo,
                descripcion: config.descripcion,
                portada: config.portada,
                horarioTexto: config.horario_texto,
                whatsapp: config.whatsapp,
                facebook: config.facebook,
                instagram: config.instagram,
                mostrarPrecios: config.mostrar_precios,
                mostrarExistencias: config.mostrar_existencias
            });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    app.put("/negocio-actual/sitio-web", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);

            if (!acceso.incluido) {
                res.status(403).json({
                    ok: false,
                    error: "El sitio web propio esta disponible desde el plan Plus.",
                    requiereUpgrade: true
                });
                return;
            }

            const activo = Boolean(req.body?.activo);
            const descripcion = String(req.body?.descripcion || "").slice(0, 2000);
            const horarioTexto = String(req.body?.horarioTexto || "").slice(0, 500);
            const whatsapp = String(req.body?.whatsapp || "").slice(0, 40);
            const facebook = String(req.body?.facebook || "").slice(0, 300);
            const instagram = String(req.body?.instagram || "").slice(0, 300);
            const mostrarPrecios = Boolean(req.body?.mostrarPrecios);
            const mostrarExistencias = Boolean(req.body?.mostrarExistencias);

            // "portada" solo viene en el body cuando el usuario de verdad
            // subio/quito una imagen (ver sitio-web-view.js) -- si la clave
            // no viene, se conserva la que ya estaba guardada en vez de
            // borrarla en cada guardado del resto del formulario.
            const tocaPortada = Object.prototype.hasOwnProperty.call(req.body || {}, "portada");
            const portada = tocaPortada
                ? (req.body.portada === null || req.body.portada === "" ? null : String(req.body.portada || ""))
                : null;

            if (tocaPortada && portada && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(portada)) {
                res.status(400).json({ ok: false, error: "La portada debe ser una imagen valida" });
                return;
            }

            if (tocaPortada && portada && portada.length > TAMANO_MAXIMO_PORTADA) {
                res.status(400).json({ ok: false, error: "La portada es demasiado grande. Usa una imagen mas chica." });
                return;
            }

            await pool.query(
                `
                INSERT INTO public.sitio_web_config
                    (negocio_id, activo, descripcion, portada, horario_texto, whatsapp, facebook, instagram, mostrar_precios, mostrar_existencias, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $10, $11, NOW())
                ON CONFLICT (negocio_id) DO UPDATE SET
                    activo = $2, descripcion = $3,
                    portada = CASE WHEN $9 THEN $4 ELSE sitio_web_config.portada END,
                    horario_texto = $5, whatsapp = $6, facebook = $7, instagram = $8,
                    mostrar_precios = $10, mostrar_existencias = $11, updated_at = NOW()
                `,
                [negocio.id, activo, descripcion, portada, horarioTexto, whatsapp, facebook, instagram, tocaPortada, mostrarPrecios, mostrarExistencias]
            );

            res.json({ ok: true });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    // Ver los pedidos ya recibidos no se gatea por plan -- un pedido
    // que ya llego debe seguir siendo legible aunque el plan baje
    // despues (mismo criterio ya usado con datos historicos de
    // Creditos).
    app.get("/negocio-actual/pedidos-publicos", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);

            const resultado = await pool.query(
                `
                SELECT id, producto_codigo, producto_nombre, cantidad, cliente_nombre, cliente_telefono,
                    cliente_correo, mensaje, estado, created_at
                FROM public.pedidos_publicos
                WHERE negocio_id = $1
                ORDER BY created_at DESC
                LIMIT 50
                `,
                [negocio.id]
            );

            res.json({
                ok: true,
                pedidos: resultado.rows.map(fila => ({
                    id: fila.id,
                    productoCodigo: fila.producto_codigo,
                    productoNombre: fila.producto_nombre,
                    cantidad: Number(fila.cantidad),
                    clienteNombre: fila.cliente_nombre,
                    clienteTelefono: fila.cliente_telefono,
                    clienteCorreo: fila.cliente_correo,
                    mensaje: fila.mensaje,
                    estado: fila.estado,
                    createdAt: fila.created_at
                }))
            });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    app.patch("/negocio-actual/pedidos-publicos/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const estado = String(req.body?.estado || "");

            if (!["atendido", "descartado", "pendiente"].includes(estado)) {
                res.status(400).json({ ok: false, error: "Estado invalido" });
                return;
            }

            await pool.query(
                `UPDATE public.pedidos_publicos SET estado = $1 WHERE id = $2 AND negocio_id = $3`,
                [estado, req.params.id, negocio.id]
            );

            res.json({ ok: true });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = { registrarRutas, servirSitioNegocio, servirCatalogoNegocio, servirProductoNegocio, recibirPedidoPublico };

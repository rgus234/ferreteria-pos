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

const sharp = require("sharp");
const multer = require("multer");
const crypto = require("crypto");
const {
    normalizarCodigoFoto: normalizarCodigoBancoImagen,
    planPermiteBancoImagenes,
    firmarTokenBancoImagen
} = require("./banco-imagenes-server");
const { funcionDelPlan } = require("./plan-enforcement");
const { enviarCorreoPedidoPublico, enviarCorreoPedidoCarritoPublico, enviarCorreoSolicitudCreditoPublica, enviarCorreoCotizacionRespondida, enviarCorreoPedidoRecibido } = require("./email");
const { hashPassword, verificarPassword } = require("./password-utils");
const { calcularAntiguedadCredito } = require("./credit-aging");
const { crearRequerirSesionPersona, crearResolverSesionPersonaOpcional, tokenDeSesionPersona, buscarPersonaPorToken } = require("./personas-server");
const { OFICIOS_PERSONA } = require("./oficios-persona");
const { geocodificarDireccion } = require("./geocodificacion");
const { formatearCodigoRecogida, generarQrYBarcode } = require("./pedido-codigos");
const { enviarPushANegocio } = require("./push-server");

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
const limitadorSolicitudCredito = crearLimitadorPorIp(5, 60 * 60 * 1000);

const MAX_ITEMS_CARRITO = 30;

// Mismo alfabeto/longitud que ya usa server.js para generar el codigo
// de acceso que el dueno reparte a mano desde Creditos (sin 0/O/1/I,
// 32^8 combinaciones) -- copiado local a este archivo, no importado,
// mismo criterio de helpers chicos duplicados por archivo ya seguido
// aqui. Se usa cuando el carrito publico crea una "cuenta ligera" para
// un visitante nuevo (ver recibirPedidoCarritoPublico).
const ALFABETO_CODIGO_ACCESO_CLIENTE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generarCodigoAccesoCliente() {
    let codigo = "";
    for (let i = 0; i < 8; i++) {
        codigo += ALFABETO_CODIGO_ACCESO_CLIENTE[crypto.randomInt(ALFABETO_CODIGO_ACCESO_CLIENTE.length)];
    }
    return codigo;
}

// Portal de cliente final (Fase 6): un limitador por IP y otro
// separado por telefono+negocio -- este segundo evita que alguien
// reparta intentos entre varias IPs para adivinar el codigo de UN
// cliente en particular (el helper es generico, la "IP" que recibe
// aqui es en realidad la clave `${negocioId}:${telefono}`).
const limitadorLoginClientePublico = crearLimitadorPorIp(8, 15 * 60 * 1000);
const limitadorLoginClientePorTelefono = crearLimitadorPorIp(10, 60 * 60 * 1000);

function generarTokenSesionCliente() {
    return crypto.randomBytes(32).toString("hex");
}

function hashTokenSesionCliente(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

// Comprime una foto de identificacion antes de guardarla como BYTEA.
// Ancho mayor que el usado para fotos de producto (320px) para que el
// documento siga siendo legible; sharp descarta metadatos EXIF al
// re-codificar (sin llamar .withMetadata()), lo cual es deseable aqui
// porque una foto tomada con celular puede traer geolocalizacion.
async function comprimirImagenIdentificacion(buffer) {
    return sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
}

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
        `SELECT id, slug, nombre, direccion, direccion_lat, direccion_lng FROM public.negocios WHERE id = $1 LIMIT 1`,
        [negocioId]
    );

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

// Detecta si una persona tiene alguna señal real de "comprador" -- cliente
// de credito vinculado en alguna ferreteria, o al menos un pedido puesto
// con su cuenta. Mismos dos criterios que ya usan
// GET /personas/negocios-cliente y GET /personas/mis-pedidos (abajo), aqui
// solo se cuenta en vez de listar. Usado por market-cuenta-server.js para
// decidir si una persona que SOLO administra negocios puede saltarse el
// hub de comprador -- nunca al reves (si hay cualquier señal, por minima
// que sea, se respeta el hub de comprador de siempre).
async function contarSenalCompradora(pool, personaId) {
    const resultado = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM public.clientes_credito WHERE persona_id = $1 AND activo = true) +
            (SELECT COUNT(*) FROM public.pedidos_publicos WHERE persona_id = $1) AS total`,
        [personaId]
    );

    return Number(resultado.rows[0]?.total || 0);
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
            n.id, n.slug, n.nombre, n.telefono, n.direccion, n.logo, n.color, n.estado, n.correo, n.giro,
            n.pedido_prep_min, n.pedido_prep_max,
            c.activo, c.descripcion, c.portada, c.horario_texto, c.whatsapp, c.facebook, c.instagram,
            c.mostrar_precios, c.mostrar_existencias, c.aceptar_solicitudes_credito,
            c.promocion_activa, c.promocion_titulo, c.promocion_texto, c.promocion_enlace,
            (c.promocion_imagen IS NOT NULL) AS promocion_tiene_imagen, c.promocion_imagen_actualizado_at,
            c.envio_modo, c.envio_tarifa, c.envio_notas
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
            correo: fila.correo,
            giro: fila.giro,
            pedidoPrepMin: fila.pedido_prep_min,
            pedidoPrepMax: fila.pedido_prep_max
        },
        config: {
            descripcion: fila.descripcion,
            portada: fila.portada,
            horarioTexto: fila.horario_texto,
            whatsapp: fila.whatsapp,
            facebook: fila.facebook,
            instagram: fila.instagram,
            mostrarPrecios: fila.mostrar_precios,
            mostrarExistencias: fila.mostrar_existencias,
            aceptarSolicitudesCredito: fila.aceptar_solicitudes_credito,
            promocionActiva: fila.promocion_activa,
            promocionTitulo: fila.promocion_titulo,
            promocionTexto: fila.promocion_texto,
            promocionEnlace: fila.promocion_enlace,
            promocionTieneImagen: fila.promocion_tiene_imagen,
            promocionImagenActualizadoAt: fila.promocion_imagen_actualizado_at,
            envioModo: fila.envio_modo,
            envioTarifa: fila.envio_tarifa !== null ? Number(fila.envio_tarifa) : null,
            envioNotas: fila.envio_notas
        }
    };
}

// Banner de promocion compartido por inicio/catalogo/detalle -- vacio
// si no hay promocion activa o le falta titulo/texto (nunca se
// muestra un banner a medio llenar). Todo dato viene escapado. La
// imagen es opcional (Fase "Ofertas destacadas", ver plan) -- slug
// hace falta para construir la URL publica de la imagen, ya que
// promocion_imagen vive en sitio_web_config (por negocio), no en un
// archivo con URL propia.
//
// Plantillas (Fase "rediseno Sitio web", ver plan): el dueno elige una
// plantilla en el editor del POS en vez de un layout unico fijo --
// bannerPromocionHtml es el dispatcher, cada plantilla es una funcion
// pura que arma el mismo tipo de datos con un layout distinto. El
// acento de color es propio de la promocion (--promo-acento, via
// estilo inline), separado del acento general del sitio (--blue) para
// no forzar al dueno a cambiar el color de todo su sitio solo para su
// promocion.
function imagenPromocionUrl(config, slug) {
    if (!config.promocionTieneImagen) return "";
    const v = config.promocionImagenActualizadoAt ? new Date(config.promocionImagenActualizadoAt).getTime() : 0;
    return `/sitio-web-promocion-imagen?negocio=${encodeURIComponent(slug)}&v=${v}`;
}

function botonPromocionHtml(config, clase) {
    if (!config.promocionEnlace) return "";
    const texto = config.promocionTextoBoton ? escaparHtml(config.promocionTextoBoton) : "Ver mas";
    return `<a class="${clase}" href="${escaparHtml(config.promocionEnlace)}">${texto}</a>`;
}

function bannerPromocionClasica(config, slug) {
    const imagenUrl = imagenPromocionUrl(config, slug);
    const imagenHtml = imagenUrl ? `<img class="tenant-promo-banner-img" src="${imagenUrl}" alt="" loading="lazy">` : "";
    return `<div class="tenant-promo-banner${imagenUrl ? " con-imagen" : ""}" style="--promo-acento:${colorSeguro(config.promocionColorAcento)}">${imagenHtml}<div class="tenant-promo-banner-texto"><strong>${escaparHtml(config.promocionTitulo)}</strong><span>${escaparHtml(config.promocionTexto)}</span>${botonPromocionHtml(config, "tenant-promo-banner-boton")}</div></div>`;
}

function bannerPromocionImagenFondo(config, slug) {
    const imagenUrl = imagenPromocionUrl(config, slug);
    const fondoHtml = imagenUrl ? `<img class="tenant-promo-banner-fondo-img" src="${imagenUrl}" alt="" loading="lazy">` : "";
    return `<div class="tenant-promo-banner tenant-promo-banner--imagen-fondo" style="--promo-acento:${colorSeguro(config.promocionColorAcento)}">${fondoHtml}<div class="tenant-promo-banner-fondo-velo"></div><div class="tenant-promo-banner-texto"><strong>${escaparHtml(config.promocionTitulo)}</strong><span>${escaparHtml(config.promocionTexto)}</span>${botonPromocionHtml(config, "tenant-promo-banner-boton")}</div></div>`;
}

function bannerPromocionDividida(config, slug) {
    const imagenUrl = imagenPromocionUrl(config, slug);
    const imagenHtml = imagenUrl
        ? `<img class="tenant-promo-banner-img" src="${imagenUrl}" alt="" loading="lazy">`
        : `<div class="tenant-promo-banner-img tenant-promo-banner-img-vacia"></div>`;
    return `<div class="tenant-promo-banner tenant-promo-banner--dividida" style="--promo-acento:${colorSeguro(config.promocionColorAcento)}"><div class="tenant-promo-banner-texto"><strong>${escaparHtml(config.promocionTitulo)}</strong><span>${escaparHtml(config.promocionTexto)}</span>${botonPromocionHtml(config, "tenant-promo-banner-boton")}</div>${imagenHtml}</div>`;
}

function bannerPromocionMinimal(config) {
    return `<div class="tenant-promo-banner tenant-promo-banner--minimal" style="--promo-acento:${colorSeguro(config.promocionColorAcento)}"><div class="tenant-promo-banner-texto"><strong>${escaparHtml(config.promocionTitulo)}</strong><span>${escaparHtml(config.promocionTexto)}</span>${botonPromocionHtml(config, "tenant-promo-banner-boton")}</div></div>`;
}

const PLANTILLAS_PROMOCION = {
    clasica: bannerPromocionClasica,
    "imagen-fondo": bannerPromocionImagenFondo,
    dividida: bannerPromocionDividida,
    minimal: bannerPromocionMinimal
};

function bannerPromocionHtml(config, slug) {
    if (!config.promocionActiva || !config.promocionTitulo || !config.promocionTexto) {
        return "";
    }
    const constructor = PLANTILLAS_PROMOCION[config.promocionPlantilla] || PLANTILLAS_PROMOCION.clasica;
    return constructor(config, slug);
}

// Texto honesto de politica de envio segun lo que el dueno declaro en
// Sitio web -- nunca se inventa logistica que la tienda no ofrece (ver
// plan "Politica de envio por tienda"). Mismo criterio en
// market-carrito-server.js (marketCarritoNotaEnvioHtml), copiado en
// vez de importado por ser una funcion chica.
function lineaEnvioHtml(config) {
    if (config.envioModo === "solo_recoleccion") {
        return "Esta tienda solo entrega en su local -- no hace envios.";
    }
    if (config.envioModo === "tarifa_fija" && config.envioTarifa !== null) {
        const notas = config.envioNotas ? ` ${escaparHtml(config.envioNotas)}` : "";
        return `Envio con costo fijo: $${config.envioTarifa.toFixed(2)}.${notas}`;
    }
    return "El envio se coordina directamente con la tienda.";
}

function colorSeguro(color) {
    return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#1067e8";
}

// Precio con oferta (Fase 9): compartido por catalogo, destacados y
// ficha de producto -- un solo lugar de logica en vez de repetir el
// calculo "tachado si hay oferta real" en 3 sitios. Sin oferta valida
// (vacia, mayor o igual al precio normal), se ve igual que hoy.
function precioOfertaHtml(precioNormal, precioOferta) {
    const normal = Number(precioNormal);
    if (!Number.isFinite(normal)) return "";
    const oferta = Number(precioOferta);
    if (Number.isFinite(oferta) && oferta > 0 && oferta < normal) {
        return `<span class="tenant-precio-tachado">$${normal.toFixed(2)}</span><span class="tenant-precio-oferta">$${oferta.toFixed(2)}</span><span class="tenant-badge-oferta">Oferta</span>`;
    }
    return `<span class="tenant-producto-precio">$${normal.toFixed(2)}</span>`;
}

// Iconos de categoria (Fase 9): diccionario chico de palabras clave
// para las categorias reales del negocio -- nunca se inventan
// categorias, solo se elige el icono mas cercano; sin match, icono
// generico de caja.
const SVG_POR_CLAVE_OFICIO = {
    herramientas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
    construccion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 21v-6h6v6"></path></svg>`,
    electrico: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 11 14 11 22 21 10 13 10 13 2"></polygon></svg>`,
    plomeria: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c4 5 6 8.5 6 12a6 6 0 0 1-12 0c0-3.5 2-7 6-12Z"></path></svg>`,
    pintura: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3 21 6l-9.5 9.5-4-4L18 3Z"></path><path d="M7 12 4 21l9-3"></path></svg>`,
    seguridad: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 6v6c0 5 4 8.5 9 10 5-1.5 9-5 9-10V6l-9-4Z"></path></svg>`,
    jardin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 4 13c0-4 4-9 7-11 3 2 7 7 7 11a7 7 0 0 1-7 7Z"></path></svg>`,
    limpieza: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 9-9"></path><path d="M12.5 4.5c1.5-1.5 4-1.5 5.5 0s1.5 4 0 5.5L9 19l-5.5 1.5L5 15l9-9Z"></path></svg>`
};
// Construida a partir de OFICIOS_PERSONA (oficios-persona.js) -- misma
// fuente de verdad que usa la personalizacion de Nexo Market, "otro"
// se excluye porque no tiene icono propio.
const ICONOS_CATEGORIA_TENANT = OFICIOS_PERSONA
    .filter(o => o.clave !== "otro")
    .map(o => ({ patron: o.patron, svg: SVG_POR_CLAVE_OFICIO[o.clave] }));
const ICONO_CATEGORIA_GENERICO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>`;

// Icono de favorito (Fase 11) -- un solo SVG de trazo, mismo estilo
// que el resto de iconos de este archivo. El estado "activo" (ya
// guardado) se controla por CSS (fill:currentColor en .activo), no
// con un segundo SVG.
const ICONO_TENANT_FAVORITO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>`;

// Icono de comparar (Fase 12) -- dos rectangulos superpuestos, mismo
// estilo de trazo que el resto de iconos de este archivo. El estado
// "activo" (ya seleccionado para comparar) se controla por CSS, igual
// que el de favoritos.
const ICONO_TENANT_COMPARAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="12" height="12" rx="2"></rect><rect x="9" y="9" width="12" height="12" rx="2"></rect></svg>`;

function iconoCategoriaTenant(nombre) {
    const texto = String(nombre || "").toLowerCase();
    const match = ICONOS_CATEGORIA_TENANT.find(entry => entry.patron.test(texto));
    return match ? match.svg : ICONO_CATEGORIA_GENERICO;
}

// Tarjeta de producto compartida (Fase 9) -- catalogo y destacados
// del inicio usan exactamente el mismo markup/clases (incluido el
// boton de carrito de Fase 7), solo cambia de donde vienen los datos.
function tarjetaProductoTenantHtml({ codigo, nombre, fotoUrl, precio, precioOferta, stock, basePath = "", mostrarFavorito = !basePath, mostrarComparar = !basePath }) {
    const nombreSeguro = escaparHtml(nombre);
    const existenciaHtml = stock !== null && stock !== undefined
        ? `<span class="tenant-producto-existencia${stock <= 0 ? " agotado" : ""}">${stock <= 0 ? "Agotado" : `${stock} disponibles`}</span>`
        : `<span class="tenant-producto-existencia bajo-pedido">Bajo pedido -- confirma con la tienda</span>`;
    const precioHtml = precio !== null && precio !== undefined ? precioOfertaHtml(precio, precioOferta) : "";
    const favoritoBtnHtml = mostrarFavorito
        ? `<button type="button" class="tenant-btn-favorito" data-codigo="${escaparHtml(codigo)}" aria-label="Guardar en favoritos">${ICONO_TENANT_FAVORITO}</button>\n`
        : "";
    const compararBtnHtml = mostrarComparar
        ? `<button type="button" class="tenant-btn-comparar" data-codigo="${escaparHtml(codigo)}" aria-label="Agregar a comparar">${ICONO_TENANT_COMPARAR}</button>\n`
        : "";

    return `<div class="tenant-producto-card">
${favoritoBtnHtml}${compararBtnHtml}<a href="${basePath}/catalogo/${encodeURIComponent(codigo)}">
<div class="tenant-producto-foto">${fotoUrl ? `<img src="${fotoUrl}" alt="${nombreSeguro}">` : `<span class="tenant-producto-foto-vacia">Sin foto</span>`}</div>
<div class="tenant-producto-info">
<span class="tenant-producto-nombre">${nombreSeguro}</span>
${precioHtml}
${existenciaHtml}
</div>
</a>
<button type="button" class="tenant-btn-carrito" data-codigo="${escaparHtml(codigo)}" data-nombre="${nombreSeguro}">Agregar al carrito</button>
</div>`;
}

// CSS del banner de "Promocion" y sus 4 plantillas -- funcion propia
// (no solo un bloque dentro de estilosBaseTenant) para poder mandarla
// sola y chica a la vista previa en vivo del editor del POS
// (POST /negocio-actual/sitio-web/promocion-preview), sin tener que
// inyectar todo el CSS del sitio publico completo solo para previsualizar
// un banner.
function estilosPromoBanner(color) {
    const colorFinal = colorSeguro(color);
    return `
.tenant-promo-banner{ display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px; padding:14px clamp(20px,5vw,64px); background:linear-gradient(135deg, var(--promo-acento, ${colorFinal}), var(--ink,#172033)); color:#fff; position:relative; overflow:hidden; }
.tenant-promo-banner strong{ font-size:14px; }
.tenant-promo-banner span{ font-size:13px; opacity:.92; }
.tenant-promo-banner a{ color:#fff; font-weight:700; text-decoration:underline; font-size:13px; margin-left:auto; }
.tenant-promo-banner-texto{ display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px; flex:1; min-width:0; position:relative; z-index:1; }
.tenant-promo-banner.con-imagen{ padding:0; }
.tenant-promo-banner.con-imagen .tenant-promo-banner-texto{ padding:14px clamp(16px,4vw,48px); }
.tenant-promo-banner-img{ width:120px; height:80px; object-fit:cover; flex:0 0 auto; border-radius:10px; }
.tenant-promo-banner-boton{ display:inline-flex; align-items:center; padding:8px 18px; border-radius:999px; background:rgba(255,255,255,.2); border:1px solid rgba(255,255,255,.45); color:#fff !important; font-weight:700; font-size:13px; text-decoration:none !important; margin-left:auto; }
@media (max-width:520px){
  .tenant-promo-banner-img{ width:84px; height:64px; }
}

/* Plantilla "imagen-fondo": foto de fondo a todo lo ancho con velo
   oscuro degradado para que el texto siga siendo legible sobre
   cualquier foto que suba el dueno. */
.tenant-promo-banner--imagen-fondo{ padding:32px clamp(20px,5vw,64px); min-height:160px; align-items:flex-end; background:linear-gradient(135deg, var(--promo-acento, ${colorFinal}), var(--ink,#172033)); }
.tenant-promo-banner-fondo-img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0; }
.tenant-promo-banner-fondo-velo{ position:absolute; inset:0; background:linear-gradient(0deg, rgba(10,15,25,.82), rgba(10,15,25,.15)); z-index:0; }
.tenant-promo-banner--imagen-fondo .tenant-promo-banner-texto{ flex-direction:column; align-items:flex-start; gap:6px; }

/* Plantilla "dividida": panel de color con texto a un lado, foto de
   producto ocupando el otro lado a toda altura. */
.tenant-promo-banner--dividida{ padding:0; align-items:stretch; }
.tenant-promo-banner--dividida .tenant-promo-banner-texto{ flex-direction:column; align-items:flex-start; gap:8px; padding:22px clamp(20px,4vw,40px); }
.tenant-promo-banner--dividida .tenant-promo-banner-boton{ margin-left:0; margin-top:4px; }
.tenant-promo-banner--dividida .tenant-promo-banner-img{ width:220px; height:auto; min-height:140px; border-radius:0; }
.tenant-promo-banner-img-vacia{ background:rgba(255,255,255,.12); }
@media (max-width:640px){
  .tenant-promo-banner--dividida{ flex-direction:column; }
  .tenant-promo-banner--dividida .tenant-promo-banner-img{ width:100%; height:120px; }
}

/* Plantilla "minimal": sin foto, solo texto centrado de alto
   contraste -- para el dueno que solo quiere anunciar una oferta sin
   subir ninguna imagen. */
.tenant-promo-banner--minimal{ justify-content:center; text-align:center; padding:22px clamp(20px,5vw,64px); }
.tenant-promo-banner--minimal .tenant-promo-banner-texto{ flex-direction:column; justify-content:center; flex:none; }
.tenant-promo-banner--minimal .tenant-promo-banner-boton{ margin-left:0; }
`;
}

// Bloque <style> compartido por las 3 paginas publicas (info, catalogo,
// detalle) -- un solo lugar para los tokens de color/nav/footer y para
// las clases nuevas de grilla/tarjeta/filtros/paginacion de la Fase 2.
function estilosBaseTenant(color, selectorRaiz = ":root") {
    const colorFinal = colorSeguro(color);
    return `
${selectorRaiz}{ --blue:${colorFinal}; --blue-dark:${colorFinal}; }
.tenant-header{ position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; padding:16px clamp(20px,5vw,64px); background:rgba(247,249,252,.78); backdrop-filter:blur(22px) saturate(160%); border-bottom:1px solid var(--line); }
.tenant-header-marca{ display:flex; align-items:center; gap:12px; }
.tenant-header-marca img{ width:44px; height:44px; border-radius:12px; object-fit:cover; }
.tenant-header-marca strong{ font-size:19px; }
.tenant-nav{ display:flex; align-items:center; gap:4px; padding:6px; border-radius:999px; background:var(--glass); border:1px solid var(--line); }
.tenant-nav a{ padding:8px 16px; border-radius:999px; color:var(--muted); font-weight:600; font-size:14px; }
.tenant-nav a.activo{ background:var(--blue); color:#fff; }
.tenant-eyebrow{ display:inline-block; margin-bottom:10px; color:var(--blue); font-weight:800; font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
.tenant-buscador-header{ display:flex; align-items:center; gap:6px; flex:1; min-width:160px; max-width:360px; padding:4px 4px 4px 14px; border-radius:999px; background:var(--glass); border:1px solid var(--line); }
.tenant-buscador-header input{ flex:1; border:none; background:transparent; color:var(--ink); font-size:14px; padding:6px 0; }
.tenant-buscador-header input:focus{ outline:none; }
.tenant-buscador-header button{ display:flex; align-items:center; justify-content:center; width:34px; height:34px; border:none; border-radius:999px; background:var(--blue); color:#fff; cursor:pointer; flex-shrink:0; }
.tenant-hero-2col{ display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,.8fr); gap:0; align-items:stretch; background:var(--ink); }
.tenant-hero-panel{ padding:clamp(36px,6vw,72px) clamp(20px,5vw,64px); color:#fff; display:flex; flex-direction:column; justify-content:center; }
.tenant-hero-panel h1{ margin:0 0 14px; font-size:clamp(28px,4vw,42px); line-height:1.15; }
.tenant-hero-panel p{ color:rgba(255,255,255,.78); max-width:520px; }
.tenant-eyebrow-claro{ color:#8fc0ff; }
.tenant-btn-secundario-oscuro{ background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.28); color:#fff; }
.tenant-hero-portada{ position:relative; min-height:220px; background:linear-gradient(135deg, ${colorFinal}, #0a1626); overflow:hidden; }
.tenant-hero-portada img{ width:100%; height:100%; object-fit:cover; display:block; position:absolute; inset:0; }
.tenant-beneficios{ background:var(--paper); border-bottom:1px solid var(--line); padding:16px clamp(20px,5vw,64px); }
.tenant-beneficios-lista{ display:flex; flex-wrap:wrap; gap:12px 28px; max-width:1080px; margin:0 auto; justify-content:center; }
.tenant-beneficio{ display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--ink); }
.tenant-beneficio svg{ color:var(--mint); flex-shrink:0; }
.tenant-seccion-home{ margin:36px 0; }
.tenant-seccion-home h2{ margin:0 0 18px; font-size:20px; }
.tenant-seccion-home-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
.tenant-seccion-home-header h2{ margin:0; }
.tenant-seccion-home-header a{ color:var(--blue); font-weight:700; font-size:13px; }
.tenant-categorias-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:14px; }
.tenant-categoria-tile{ display:flex; flex-direction:column; align-items:center; gap:10px; padding:18px 10px; border-radius:16px; border:1px solid var(--line); background:var(--glass); color:var(--ink); text-align:center; font-size:12px; font-weight:700; transition:box-shadow .16s ease, transform .16s ease; }
.tenant-categoria-tile:hover{ box-shadow:0 14px 28px rgba(20,32,51,.1); transform:translateY(-2px); }
.tenant-categoria-tile svg{ width:26px; height:26px; color:var(--blue); }
.tenant-promos-grid{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
.tenant-promo-bloque{ display:flex; flex-direction:column; gap:6px; padding:24px; border-radius:20px; color:#fff; }
.tenant-promo-bloque strong{ font-size:16px; }
.tenant-promo-bloque span{ font-size:13px; opacity:.9; }
.tenant-promo-ofertas{ background:linear-gradient(135deg, var(--blue), var(--blue-dark)); }
.tenant-promo-cotizacion{ background:var(--glass); border:1px solid var(--line); color:var(--ink); }
.tenant-promo-cotizacion span{ color:var(--muted); opacity:1; }
.tenant-promo-ayuda{ background:var(--mint); }
.tenant-precio-tachado{ font-size:12px; color:var(--muted); text-decoration:line-through; margin-right:6px; }
.tenant-precio-oferta{ font-size:15px; font-weight:800; color:#e2434d; }
.tenant-badge-oferta{ display:inline-block; margin-left:6px; padding:2px 8px; border-radius:999px; background:#e2434d; color:#fff; font-size:10px; font-weight:800; text-transform:uppercase; }
.tenant-main{ max-width:1080px; margin:0 auto; padding:32px clamp(20px,5vw,64px) 64px; }
.tenant-main-angosto{ max-width:820px; }
.tenant-main p{ color:var(--muted); font-size:16px; line-height:1.7; }
.tenant-chips{ display:flex; flex-wrap:wrap; gap:10px; margin:28px 0; }
.tenant-chip{ display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border:1px solid var(--line); border-radius:18px; background:rgba(255,255,255,.66); font-size:13px; color:var(--ink); font-weight:600; }
.tenant-chip svg{ flex-shrink:0; color:var(--blue); }
.tenant-catalogo-franja{ display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; margin:8px 0 28px; padding:22px 26px; border-radius:26px; background:linear-gradient(135deg, rgba(20,32,51,.95), rgba(15,49,90,.9)); color:#fff; box-shadow:var(--shadow); }
.tenant-catalogo-franja strong{ font-size:20px; display:block; }
.tenant-catalogo-franja span{ font-size:13px; opacity:.82; }
.tenant-acciones{ display:flex; flex-wrap:wrap; gap:12px; margin-top:24px; }
.tenant-btn-primario{ display:inline-flex; align-items:center; justify-content:center; padding:13px 26px; border:none; border-radius:999px; background:linear-gradient(135deg, var(--blue), var(--blue-dark)); color:#fff; font-weight:800; font-size:14px; cursor:pointer; box-shadow:0 14px 28px rgba(16,103,232,.28); }
.tenant-btn-secundario{ display:inline-flex; align-items:center; justify-content:center; padding:13px 26px; border-radius:999px; background:var(--glass); border:1px solid var(--line); color:var(--ink); font-weight:700; font-size:14px; cursor:pointer; }
.tenant-boton-whatsapp{ display:inline-flex; align-items:center; padding:12px 22px; border-radius:999px; background:var(--mint); color:#fff; font-weight:700; }
.tenant-boton-secundario{ display:inline-flex; align-items:center; padding:12px 22px; border-radius:999px; background:var(--glass); border:1px solid var(--line); color:var(--ink); font-weight:700; }
.tenant-redes{ display:flex; gap:16px; margin-top:8px; }
.tenant-redes a{ color:var(--blue); font-weight:600; }
.tenant-footer{ text-align:center; padding:32px; color:var(--muted); font-size:13px; border-top:1px solid var(--line); margin-top:24px; }
.tenant-filtros{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:24px; }
.tenant-filtros input[type="text"], .tenant-filtros select{ padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:var(--paper); color:var(--ink); font-size:14px; }
.tenant-filtros input[type="text"]{ flex:1; min-width:200px; }
.tenant-filtros button{ padding:10px 20px; border-radius:12px; border:none; background:var(--blue); color:#fff; font-weight:700; cursor:pointer; }
.tenant-catalogo-titulo{ margin:0 0 4px; font-size:26px; }
.tenant-catalogo-subtitulo{ margin:0 0 20px; color:var(--muted); font-size:14px; }
.tenant-categoria-pills{ display:flex; gap:10px; overflow-x:auto; padding-bottom:6px; margin-bottom:18px; }
.tenant-categoria-pill{ flex-shrink:0; padding:9px 18px; border-radius:999px; border:1px solid var(--line); background:var(--glass); color:var(--ink); font-weight:600; font-size:13px; white-space:nowrap; }
.tenant-categoria-pill.activo{ background:var(--blue); border-color:var(--blue); color:#fff; }
.tenant-catalogo-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:18px; }
.tenant-producto-card{ position:relative; display:flex; flex-direction:column; border:1px solid var(--line); border-radius:18px; overflow:hidden; background:var(--glass); color:inherit; box-shadow:0 10px 24px rgba(20,32,51,.05); transition:box-shadow .16s ease, transform .16s ease; }
.tenant-producto-card:hover{ box-shadow:0 18px 40px rgba(20,32,51,.12); transform:translateY(-2px); }
.tenant-producto-foto{ aspect-ratio:1/1; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden; }
.tenant-producto-foto img{ width:100%; height:100%; object-fit:cover; display:block; }
.tenant-producto-foto-vacia{ color:var(--muted); font-size:12px; }
.tenant-producto-info{ padding:14px; display:grid; gap:6px; }
.tenant-producto-nombre{ font-size:14px; font-weight:700; color:var(--ink); }
.tenant-producto-precio{ font-size:15px; font-weight:800; color:var(--blue); }
.tenant-producto-existencia{ display:inline-flex; align-items:center; width:fit-content; padding:3px 10px; border-radius:999px; font-size:11px; color:var(--mint); font-weight:700; background:rgba(24,184,143,.14); }
.tenant-producto-existencia.agotado{ color:#e2434d; background:rgba(226,67,77,.12); }
.tenant-producto-existencia.bajo-pedido{ color:var(--amber); background:rgba(230,162,60,.14); }
.tenant-catalogo-vacio{ padding:48px 0; text-align:center; color:var(--muted); }
.tenant-paginacion{ display:flex; justify-content:center; gap:12px; margin-top:32px; }
.tenant-paginacion a{ padding:10px 18px; border-radius:12px; border:1px solid var(--line); color:var(--ink); font-weight:600; }
.tenant-paginacion span{ padding:10px 18px; color:var(--muted); }
.tenant-detalle-card{ border-radius:26px; background:var(--glass); box-shadow:var(--shadow); padding:24px; }
.tenant-detalle-grid{ display:grid; grid-template-columns:minmax(0,320px) 1fr minmax(240px,280px); gap:28px; align-items:start; }
.tenant-detalle-galeria{ display:flex; gap:8px; align-items:flex-start; }
.tenant-detalle-foto{ flex:1; min-width:0; aspect-ratio:1/1; border-radius:18px; overflow:hidden; background:var(--paper); display:flex; align-items:center; justify-content:center; }
.tenant-detalle-foto img{ width:100%; height:100%; object-fit:cover; display:block; }
.tenant-detalle-foto-vacia{ color:var(--muted); }
.tenant-detalle-badge-destacado{ display:inline-block; margin-bottom:8px; padding:5px 12px; border-radius:999px; background:var(--amber); color:#fff; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; }
.tenant-detalle-titulo{ font-size:21px; line-height:1.3; margin:0 0 6px; }
.tenant-detalle-marca{ font-size:12.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; font-weight:700; margin:0 0 10px; }
.tenant-detalle-descripcion{ font-size:13.5px; line-height:1.6; color:var(--muted); margin:12px 0; }
.tenant-detalle-precio{ font-size:26px; font-weight:800; color:var(--blue); margin:8px 0; }
.tenant-detalle-garantia{ margin-top:14px; padding:12px 14px; border-radius:14px; background:var(--glass); border:1px solid var(--line); font-size:12.5px; color:var(--muted); }
.tenant-detalle-miniaturas{ display:flex; flex-direction:column; gap:8px; flex:0 0 auto; max-height:280px; overflow-y:auto; }
.tenant-detalle-miniatura{ width:48px; height:48px; flex-shrink:0; border-radius:10px; overflow:hidden; border:2px solid transparent; background:var(--paper); cursor:pointer; padding:0; }
.tenant-detalle-miniatura img{ width:100%; height:100%; object-fit:cover; display:block; }
.tenant-detalle-miniatura.activa{ border-color:var(--blue); }
.tenant-detalle-comprabox{ display:grid; gap:10px; align-content:start; padding:18px; border:1px solid var(--line); border-radius:16px; background:#fff; }
.tenant-detalle-comprabox .tenant-acciones{ margin-top:0; flex-direction:column; align-items:stretch; }
.tenant-detalle-comprabox .tenant-btn-primario, .tenant-detalle-comprabox .tenant-btn-secundario{ width:100%; }
.tenant-detalle-comprabox-linea{ display:flex; gap:8px; font-size:12.5px; color:var(--muted); padding-top:10px; border-top:1px solid var(--line); }
.tenant-detalle-comprabox-linea:first-of-type{ border-top:none; padding-top:0; }
.tenant-detalle-comprabox-linea strong{ color:var(--ink); font-weight:700; }
.tenant-breadcrumb{ margin:0 0 18px; font-size:13px; color:var(--muted); }
.tenant-breadcrumb a{ color:var(--muted); }
.tenant-breadcrumb a:hover{ color:var(--blue); }
.tenant-pedido-rapido{ margin-top:18px; }
.tenant-complementarios-fila{ display:flex; gap:16px; overflow-x:auto; padding-bottom:8px; }
.tenant-complementarios-fila .tenant-producto-card{ flex:0 0 200px; }
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
.tenant-pedido-form input[type="file"]{ font-size:13px; color:var(--muted); }
.tenant-pedido-form .tenant-consentimiento{ flex-direction:row; align-items:flex-start; gap:8px; font-weight:400; font-size:13px; color:var(--muted); }
.tenant-pedido-form .tenant-consentimiento input{ width:16px; height:16px; margin-top:2px; flex-shrink:0; }
.tenant-pedido-form .tenant-consentimiento a{ color:var(--blue); }
.tenant-portal-saldo{ padding:24px; border-radius:18px; background:var(--glass); border:1px solid var(--line); margin:24px 0; text-align:center; }
.tenant-portal-saldo-monto{ font-size:32px; font-weight:800; color:var(--blue); }
.tenant-portal-saldo.vencido{ border-color:rgba(226,67,77,.35); background:rgba(226,67,77,.08); }
.tenant-portal-saldo-aviso{ margin-top:8px; color:#e2434d; font-weight:700; font-size:14px; }
.tenant-portal-seccion{ margin-top:32px; }
.tenant-portal-seccion h2{ font-size:17px; margin:0 0 14px; }
.tenant-portal-tabla{ width:100%; border-collapse:collapse; font-size:13px; }
.tenant-portal-tabla th{ text-align:left; padding:8px 10px; color:var(--muted); font-weight:600; border-bottom:1px solid var(--line); }
.tenant-portal-tabla td{ padding:10px; border-bottom:1px solid var(--line); color:var(--ink); }
.tenant-portal-vacio{ color:var(--muted); font-size:14px; padding:16px 0; }
.tenant-portal-logout{ margin-top:28px; padding:10px 20px; border-radius:999px; border:1px solid var(--line); background:var(--glass); color:var(--ink); font-weight:700; cursor:pointer; }
.tenant-portal-badge{ padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; text-transform:capitalize; background:var(--glass); color:var(--muted); }
.tenant-portal-badge.pendiente{ background:rgba(245,158,11,.15); color:#b45309; }
.tenant-portal-badge.atendido{ background:rgba(24,184,143,.15); color:var(--mint); }
.tenant-portal-badge.descartado{ background:rgba(226,67,77,.12); color:#e2434d; }
.tenant-portal-badge.cotizado{ background:rgba(37,99,235,.14); color:#1d4ed8; }
.tenant-portal-saludo{ font-size:20px; margin:0 0 6px; }
${estilosPromoBanner(color)}
.tenant-carrito-boton-nav{ display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:999px; border:none; background:var(--blue); color:#fff; font-weight:700; font-size:13px; cursor:pointer; }
.tenant-carrito-contador{ display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 4px; border-radius:999px; background:rgba(255,255,255,.28); font-size:11px; font-weight:800; }
.tenant-btn-carrito{ margin-top:10px; padding:10px 18px; border-radius:999px; border:1px solid var(--line); background:var(--glass); color:var(--ink); font-weight:700; font-size:13px; cursor:pointer; align-self:start; }
.tenant-btn-carrito.tenant-btn-primario{ margin-top:0; padding:13px 26px; border:none; background:linear-gradient(135deg, var(--blue), var(--blue-dark)); color:#fff; font-size:14px; box-shadow:0 14px 28px rgba(16,103,232,.28); }
.tenant-producto-card{ display:flex; flex-direction:column; }
.tenant-producto-card .tenant-btn-carrito{ margin:0 14px 14px; }
.tenant-btn-favorito{ position:absolute; top:10px; right:10px; z-index:2; display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0; border-radius:999px; border:none; background:rgba(255,255,255,.85); backdrop-filter:blur(4px); color:var(--ink); cursor:pointer; box-shadow:0 4px 12px rgba(20,32,51,.12); transition:color .15s ease, transform .15s ease; }
.tenant-btn-favorito svg{ width:18px; height:18px; }
.tenant-btn-favorito:hover{ transform:scale(1.06); }
.tenant-btn-favorito.activo{ color:#e2434d; }
.tenant-btn-favorito.activo svg{ fill:currentColor; }
.tenant-btn-favorito-linea{ position:static; width:auto; height:auto; display:inline-flex; align-items:center; gap:8px; padding:13px 26px; border-radius:999px; background:var(--glass); border:1px solid var(--line); color:var(--ink); font-weight:700; font-size:14px; box-shadow:none; backdrop-filter:none; }
.tenant-btn-favorito-linea svg{ width:18px; height:18px; }
.tenant-btn-favorito-linea.activo{ border-color:rgba(226,67,77,.35); background:rgba(226,67,77,.08); }
.tenant-favoritos-vacio{ padding:48px 0 8px; color:var(--muted); font-size:15px; text-align:center; }
#favoritosLista{ text-align:center; }
#favoritosLista > a{ color:var(--blue); font-weight:700; }
#favoritosLista .tenant-catalogo-grid{ text-align:left; }
.tenant-btn-comparar{ position:absolute; top:10px; left:10px; z-index:2; display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0; border-radius:999px; border:none; background:rgba(255,255,255,.85); backdrop-filter:blur(4px); color:var(--ink); cursor:pointer; box-shadow:0 4px 12px rgba(20,32,51,.12); transition:color .15s ease, transform .15s ease; }
.tenant-btn-comparar svg{ width:18px; height:18px; }
.tenant-btn-comparar:hover{ transform:scale(1.06); }
.tenant-btn-comparar.activo{ color:var(--blue); }
.tenant-btn-comparar.activo svg{ fill:rgba(16,103,232,.18); }
.tenant-btn-comparar-linea{ position:static; width:auto; height:auto; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:13px 26px; border-radius:999px; background:var(--glass); border:1px solid var(--line); color:var(--ink); font-weight:700; font-size:14px; box-shadow:none; backdrop-filter:none; }
.tenant-btn-comparar-linea svg{ width:18px; height:18px; }
.tenant-btn-comparar-linea.activo{ border-color:rgba(16,103,232,.35); background:rgba(16,103,232,.08); }
.tenant-comparador-tabla{ display:flex; gap:16px; overflow-x:auto; padding-bottom:8px; }
.tenant-comparador-columna{ display:flex; flex-direction:column; gap:10px; min-width:220px; flex:0 0 220px; padding:16px; border:1px solid var(--line); border-radius:18px; background:var(--glass); box-shadow:0 10px 24px rgba(20,32,51,.05); }
.tenant-comparador-columna .tenant-producto-foto{ border-radius:12px; }
.tenant-comparador-atributos{ display:grid; gap:0; margin:4px 0; }
.tenant-comparador-atributo{ display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:8px 0; border-top:1px solid var(--line); }
.tenant-comparador-atributo-etiqueta{ color:var(--muted); font-weight:600; }
.tenant-comparador-vacio{ padding:48px 0 8px; color:var(--muted); font-size:15px; text-align:center; }
#comparadorTabla{ text-align:center; }
#comparadorTabla > a{ color:var(--blue); font-weight:700; }
#comparadorTabla .tenant-comparador-tabla{ text-align:left; }
.tenant-carrito-overlay{ position:fixed; inset:0; z-index:9500; background:rgba(13,23,42,.55); backdrop-filter:blur(6px); display:none; align-items:center; justify-content:center; padding:20px; }
.tenant-carrito-modal{ width:min(520px,92vw); max-height:86vh; overflow-y:auto; background:var(--paper); border-radius:20px; padding:24px; box-shadow:0 30px 60px rgba(13,23,42,.35); display:grid; gap:14px; }
.tenant-carrito-modal-header{ display:flex; align-items:center; justify-content:space-between; }
.tenant-carrito-modal-header h2{ margin:0; font-size:19px; }
.tenant-carrito-modal-header button{ border:none; background:transparent; font-size:24px; line-height:1; cursor:pointer; color:var(--muted); }
#tenantCarritoForm{ display:grid; gap:12px; }
#tenantCarritoForm label{ display:grid; gap:6px; font-size:13px; color:var(--muted); font-weight:600; }
#tenantCarritoForm input[type="text"], #tenantCarritoForm textarea{ padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:var(--paper); color:var(--ink); font-size:14px; font-family:inherit; }
#tenantCarritoForm textarea{ resize:vertical; min-height:60px; }
#tenantCarritoForm button[type="submit"]{ padding:12px 22px; border-radius:999px; border:none; background:var(--blue); color:#fff; font-weight:700; cursor:pointer; justify-self:start; }
.tenant-carrito-botones{ display:flex; gap:10px; flex-wrap:wrap; }
#tenantCarritoForm button.tenant-btn-cotizacion{ background:var(--glass); border:1px solid var(--line); color:var(--ink); }
@media (max-width:960px){
    .tenant-detalle-grid{ grid-template-columns:minmax(0,240px) 1fr; }
    .tenant-detalle-comprabox{ grid-column:1 / -1; }
}
@media (max-width:720px){
    .tenant-detalle-grid{ grid-template-columns:1fr; }
    .tenant-portal-tabla{ display:block; overflow-x:auto; }
    .tenant-nav{ overflow-x:auto; max-width:100%; }
    .tenant-buscador-header{ order:3; max-width:none; flex-basis:100%; }
    .tenant-catalogo-franja{ flex-direction:column; align-items:flex-start; }
    .tenant-detalle-card{ padding:20px; border-radius:20px; }
    .tenant-hero-2col{ grid-template-columns:1fr; }
    .tenant-hero-portada{ min-height:160px; order:-1; }
    .tenant-promos-grid{ grid-template-columns:1fr; }
    .tenant-categorias-grid{ grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); }
}
`;
}

const ICONO_TENANT_BUSQUEDA = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

function encabezadoTenantHtml(datos, paginaActiva, mostrarCredito, mostrarCarrito, mostrarFavoritos, mostrarComparador) {
    const nombre = escaparHtml(datos.nombre);
    return `<header class="tenant-header">
<div class="tenant-header-marca">
${datos.logo ? `<img src="${escaparHtml(datos.logo)}" alt="Logo ${nombre}">` : ""}
<strong>${nombre}</strong>
</div>
<form class="tenant-buscador-header" method="GET" action="/catalogo" role="search">
<input type="text" name="buscar" placeholder="Buscar productos, marcas o categorias...">
<button type="submit" aria-label="Buscar">${ICONO_TENANT_BUSQUEDA}</button>
</form>
<nav class="tenant-nav">
<a href="/" class="${paginaActiva === "inicio" ? "activo" : ""}">Inicio</a>
<a href="/catalogo" class="${paginaActiva === "catalogo" ? "activo" : ""}">Catalogo</a>
<a href="/catalogo?ofertas=1">Ofertas</a>
${mostrarCredito ? `<a href="/solicitud-credito" class="${paginaActiva === "credito" ? "activo" : ""}">Credito</a>` : ""}
<a href="/portal-cliente" class="${paginaActiva === "portal" ? "activo" : ""}">Mi cuenta</a>
${mostrarFavoritos ? `<a href="/favoritos" class="${paginaActiva === "favoritos" ? "activo" : ""}">Favoritos<span id="favoritosContador" class="tenant-carrito-contador">0</span></a>` : ""}
${mostrarComparador ? `<a href="/comparar" class="${paginaActiva === "comparar" ? "activo" : ""}">Comparar<span id="comparadorContador" class="tenant-carrito-contador">0</span></a>` : ""}
${mostrarCarrito ? `<button type="button" class="tenant-carrito-boton-nav" id="tenantCarritoAbrirBoton" aria-label="Ver carrito">Carrito<span id="carritoContador" class="tenant-carrito-contador">0</span></button>` : ""}
</nav>
</header>`;
}

const ICONO_TENANT_PIN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
const ICONO_TENANT_TELEFONO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"></path></svg>`;
const ICONO_TENANT_RELOJ = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;

// Franja de beneficios (Fase 9) -- solo afirmaciones verdaderas: 2
// siempre reales (atencion directa, pedidos en linea ya construidos) +
// 2 condicionales segun lo que el negocio de verdad tiene configurado.
// Nunca "envios"/"pagos seguros" -- eso no existe en la plataforma.
const ICONO_TENANT_BENEFICIO = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
function beneficiosTenantHtml(datos) {
    const items = [
        "Atencion personalizada",
        "Pedidos y cotizaciones en linea"
    ];
    if (datos.aceptarSolicitudesCredito) items.push("Credito disponible");
    if (datos.promocionActiva) items.push("Promociones vigentes");

    return `<div class="tenant-beneficios"><div class="tenant-beneficios-lista">${items.map(texto => `<span class="tenant-beneficio">${ICONO_TENANT_BENEFICIO}${escaparHtml(texto)}</span>`).join("")}</div></div>`;
}

// Grilla de categorias reales (Fase 9) -- solo las categorias que el
// negocio de verdad tiene etiquetadas, nunca una lista fija. Vacia si
// el negocio no tiene ninguna categoria etiquetada.
function categoriasTenantHtml(categorias, basePath = "") {
    if (!categorias || !categorias.length) return "";
    const tiles = categorias.map(c => `<a class="tenant-categoria-tile" href="${basePath}/catalogo?categoria=${encodeURIComponent(c.categoria)}">${iconoCategoriaTenant(c.categoria)}<span>${escaparHtml(c.categoria)}</span></a>`).join("");
    return `<section class="tenant-seccion-home"><h2>Categorias</h2><div class="tenant-categorias-grid">${tiles}</div></section>`;
}

// 3 bloques de promocion (Fase 9), cada uno condicional a datos
// reales -- si ninguno aplica, la seccion completa no se pinta.
function promosTenantHtml(datos) {
    const bloques = [];

    if (datos.promocionActiva || datos.existeOferta) {
        bloques.push(`<a class="tenant-promo-bloque tenant-promo-ofertas" href="/catalogo?ofertas=1"><strong>Ofertas que no puedes dejar pasar</strong><span>Consulta los productos con precio especial</span></a>`);
    }

    const whatsappNumero = normalizarTelefonoWhatsApp(datos.whatsapp);
    if (whatsappNumero) {
        bloques.push(`<a class="tenant-promo-bloque tenant-promo-cotizacion" href="https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, tengo un proyecto grande y quiero pedir una cotizacion a ${datos.nombre}.`)}" target="_blank" rel="noopener"><strong>Tienes un proyecto grande?</strong><span>Solicitar cotizacion por WhatsApp</span></a>`);
        bloques.push(`<a class="tenant-promo-bloque tenant-promo-ayuda" href="https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, necesito ayuda con un producto de ${datos.nombre}.`)}" target="_blank" rel="noopener"><strong>Necesitas ayuda?</strong><span>Escribenos por WhatsApp</span></a>`);
    }

    if (!bloques.length) return "";
    return `<section class="tenant-seccion-home"><div class="tenant-promos-grid">${bloques.join("")}</div></section>`;
}

// Productos destacados (Fase 9) -- solo si el dueno marco al menos
// uno a mano, nunca un fallback automatico a "productos recientes".
function destacadosTenantHtml(destacados, basePath = "", titulo = "Productos destacados") {
    if (!destacados || !destacados.length) return "";
    const tarjetas = destacados.map(p => tarjetaProductoTenantHtml({ ...p, basePath })).join("");
    return `<section class="tenant-seccion-home"><div class="tenant-seccion-home-header"><h2>${escaparHtml(titulo)}</h2><a href="${basePath}/catalogo">Ver todos</a></div><div class="tenant-catalogo-grid">${tarjetas}</div></section>`;
}

function renderizarPaginaNegocio(datos) {
    const nombre = escaparHtml(datos.nombre);
    const descripcion = escaparHtml(datos.descripcion);
    const direccion = escaparHtml(datos.direccion);
    const telefono = escaparHtml(datos.telefono);
    const horarioTexto = escaparHtml(datos.horarioTexto);
    const giro = escaparHtml(datos.giro);
    const color = colorSeguro(datos.color);
    const urlPublica = `https://${datos.slug}.nexoposoficial.com`;
    const imagenMeta = datos.portada || datos.logo || "";
    const totalProductos = Number(datos.totalProductos) || 0;

    const whatsappNumero = normalizarTelefonoWhatsApp(datos.whatsapp);
    const whatsappHtml = whatsappNumero
        ? `<a class="tenant-btn-secundario" href="https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, vi ${datos.nombre} en su pagina y quiero mas informacion.`)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>`
        : "";

    const redesHtml = [
        datos.facebook ? `<a href="${escaparHtml(datos.facebook)}" target="_blank" rel="noopener">Facebook</a>` : "",
        datos.instagram ? `<a href="${escaparHtml(datos.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""
    ].filter(Boolean).join("");

    const chips = [
        direccion ? `<span class="tenant-chip">${ICONO_TENANT_PIN}${direccion}</span>` : "",
        telefono ? `<span class="tenant-chip">${ICONO_TENANT_TELEFONO}${telefono}</span>` : "",
        horarioTexto ? `<span class="tenant-chip">${ICONO_TENANT_RELOJ}${horarioTexto}</span>` : ""
    ].filter(Boolean).join("");

    const franjaCatalogoHtml = totalProductos > 0
        ? `<div class="tenant-catalogo-franja"><div><strong>${totalProductos} producto${totalProductos === 1 ? "" : "s"} en catalogo</strong><span>Consulta precios y existencias en linea</span></div><a class="tenant-btn-primario" href="/catalogo">Ver catalogo</a></div>`
        : "";

    const mostrarBotonOfertasHero = datos.promocionActiva || datos.existeOferta;

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
${encabezadoTenantHtml(datos, "inicio", datos.aceptarSolicitudesCredito, true, true, true)}
${bannerPromocionHtml(datos, datos.slug)}
<section class="tenant-hero-2col">
<div class="tenant-hero-panel">
${giro ? `<span class="tenant-eyebrow tenant-eyebrow-claro">${giro}</span>` : ""}
<h1>${nombre}</h1>
${descripcion ? `<p>${descripcion}</p>` : ""}
<div class="tenant-acciones">
<a class="tenant-btn-primario" href="/catalogo">Ver catalogo</a>
${mostrarBotonOfertasHero ? `<a class="tenant-btn-secundario tenant-btn-secundario-oscuro" href="/catalogo?ofertas=1">Ver ofertas</a>` : ""}
</div>
</div>
<div class="tenant-hero-portada">${datos.portada ? `<img src="${escaparHtml(datos.portada)}" alt="">` : ""}</div>
</section>
${beneficiosTenantHtml(datos)}
<main class="tenant-main tenant-main-angosto">
${chips ? `<div class="tenant-chips">${chips}</div>` : ""}
${whatsappHtml || datos.aceptarSolicitudesCredito ? `<div class="tenant-acciones">${whatsappHtml}${datos.aceptarSolicitudesCredito ? `<a class="tenant-btn-secundario" href="/solicitud-credito">Solicitar credito</a>` : ""}</div>` : ""}
${redesHtml ? `<div class="tenant-redes">${redesHtml}</div>` : ""}
${categoriasTenantHtml(datos.categorias)}
${promosTenantHtml(datos)}
${destacadosTenantHtml(datos.destacados)}
${franjaCatalogoHtml}
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo</footer>
${modalCarritoTenantHtml(datos.slug)}
<script>${scriptCarritoTenantHtml(datos.slug)}</script>
<script>${scriptFavoritosTenantHtml(datos.slug)}</script>
<script>${scriptComparadorTenantHtml(datos.slug)}</script>
</body>
</html>`;
}

// Carga de datos del inicio de un negocio (Fase 1 "Market embebido"):
// separado de renderizarPaginaNegocio para poder reusarse desde
// market-tienda-server.js (inicio de una tienda dentro de
// /market/{slug}/...) sin duplicar las 4 consultas ni la logica de
// "solo lo real, nunca inventado" que ya tenian (destacados marcados a
// mano, oferta vigente real, categorias con al menos 1 producto).
async function cargarInicioTenant(pool, sitio, slug, firmarTokenImagen) {
    const conteoProductos = await pool.query(
        `SELECT COUNT(*) AS total FROM public.productos WHERE negocio_id = $1 AND visible_market = true`,
        [sitio.negocio.id]
    );

    // Top 10 categorias reales del negocio (nunca una lista fija) --
    // alimenta la grilla de categorias del inicio. COALESCE(cn.
    // departamento, p.categoria) en vez de p.categoria a secas -- Fase
    // 4 del plan "Catalogo Maestro Nexo", mismo criterio que Market.
    const categoriasRes = await pool.query(
        `
        SELECT COALESCE(cn.departamento, p.categoria) AS categoria, COUNT(*) AS total
        FROM public.productos p
        LEFT JOIN public.categorias_nexo cn ON cn.id = p.categoria_nexo_id
        WHERE p.negocio_id = $1 AND p.visible_market = true AND COALESCE(cn.departamento, p.categoria) <> ''
        GROUP BY COALESCE(cn.departamento, p.categoria)
        ORDER BY COUNT(*) DESC
        LIMIT 10
        `,
        [sitio.negocio.id]
    );

    // Productos destacados (Fase 9) -- solo los que el dueno marco
    // a mano, nunca un fallback automatico. Mismas columnas
    // condicionales de precio/existencia que el catalogo.
    const columnasDestacados = [
        "codigo", "nombre",
        sitio.config.mostrarPrecios ? "COALESCE(precio_publico, precio) AS precio" : null,
        sitio.config.mostrarPrecios ? "precio_oferta" : null,
        sitio.config.mostrarExistencias ? "stock" : null
    ].filter(Boolean);
    const destacadosRes = await pool.query(
        `
        SELECT ${columnasDestacados.join(", ")}
        FROM public.productos
        WHERE negocio_id = $1 AND visible_market = true AND destacado = true
        ORDER BY nombre
        LIMIT 8
        `,
        [sitio.negocio.id]
    );

    let fotosDestacadosSet = new Set();
    if (destacadosRes.rows.length) {
        const fotosDestacadosRes = await pool.query(
            `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2)`,
            [sitio.negocio.id, destacadosRes.rows.map(p => p.codigo)]
        );
        fotosDestacadosSet = new Set(fotosDestacadosRes.rows.map(f => f.codigo));
    }

    const destacados = destacadosRes.rows.map(p => ({
        codigo: p.codigo,
        nombre: p.nombre,
        fotoUrl: fotosDestacadosSet.has(p.codigo)
            ? `/fotos-producto/${encodeURIComponent(p.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, p.codigo)}`
            : "",
        precio: p.precio ?? null,
        precioOferta: p.precio_oferta ?? null,
        stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null
    }));

    // Existe al menos 1 oferta real vigente -- decide si el bloque
    // "Ofertas" se pinta aunque no haya promocion manual activa.
    const existeOfertaRes = await pool.query(
        `
        SELECT EXISTS(
            SELECT 1 FROM public.productos
            WHERE negocio_id = $1
            AND visible_market = true
            AND precio_oferta IS NOT NULL
            AND precio_oferta < COALESCE(precio_publico, precio)
        ) AS existe
        `,
        [sitio.negocio.id]
    );

    return {
        totalProductos: Number(conteoProductos.rows[0].total),
        categorias: categoriasRes.rows,
        destacados,
        existeOferta: existeOfertaRes.rows[0].existe
    };
}

async function servirSitioNegocio(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const datos = await cargarInicioTenant(pool, sitio, slug, firmarTokenImagen);

        const html = renderizarPaginaNegocio({
            slug: sitio.negocio.slug,
            nombre: sitio.negocio.nombre,
            telefono: sitio.negocio.telefono,
            direccion: sitio.negocio.direccion,
            logo: sitio.negocio.logo,
            color: sitio.negocio.color,
            giro: sitio.negocio.giro,
            descripcion: sitio.config.descripcion,
            portada: sitio.config.portada,
            horarioTexto: sitio.config.horarioTexto,
            whatsapp: sitio.config.whatsapp,
            facebook: sitio.config.facebook,
            instagram: sitio.config.instagram,
            aceptarSolicitudesCredito: sitio.config.aceptarSolicitudesCredito,
            promocionActiva: sitio.config.promocionActiva,
            promocionTitulo: sitio.config.promocionTitulo,
            promocionTexto: sitio.config.promocionTexto,
            promocionEnlace: sitio.config.promocionEnlace,
            totalProductos: datos.totalProductos,
            categorias: datos.categorias,
            destacados: datos.destacados,
            existeOferta: datos.existeOferta
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

// Favoritos (Fase 11): traduce codigos guardados en localStorage del
// navegador a datos frescos de producto -- nunca se guarda nada en el
// servidor, este endpoint es de solo lectura. Mismo gate de
// mostrarPrecios/mostrarExistencias que ya usa el catalogo, para
// nunca filtrar precio/stock si el negocio los tiene apagados.
async function favoritosJson(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).json({ ok: false, error: "No encontrado" });
            return;
        }

        const codigos = paramTexto(req.query.codigos, 2000)
            .split(",")
            .map(c => c.trim())
            .filter(Boolean)
            .slice(0, 60);

        if (!codigos.length) {
            res.json({ ok: true, productos: [] });
            return;
        }

        const columnasExtra = [
            sitio.config.mostrarPrecios ? "COALESCE(precio_publico, precio) AS precio" : null,
            sitio.config.mostrarPrecios ? "precio_oferta" : null,
            sitio.config.mostrarExistencias ? "stock" : null
        ].filter(Boolean);

        const filas = await pool.query(
            `
            SELECT codigo, nombre${columnasExtra.length ? ", " + columnasExtra.join(", ") : ""}
            FROM public.productos
            WHERE negocio_id = $1 AND codigo = ANY($2) AND visible_market = true
            `,
            [sitio.negocio.id, codigos]
        );

        let fotosPorCodigo = new Set();
        if (filas.rows.length) {
            const fotos = await pool.query(
                `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2)`,
                [sitio.negocio.id, filas.rows.map(p => p.codigo)]
            );
            fotosPorCodigo = new Set(fotos.rows.map(f => f.codigo));
        }

        res.json({
            ok: true,
            productos: filas.rows.map(p => ({
                codigo: p.codigo,
                nombre: p.nombre,
                fotoUrl: fotosPorCodigo.has(p.codigo)
                    ? `/fotos-producto/${encodeURIComponent(p.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, p.codigo)}`
                    : "",
                precio: p.precio ?? null,
                precioOferta: p.precio_oferta ?? null,
                stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null
            }))
        });
    } catch (error) {
        console.warn("Error sirviendo favoritos:", error.message);
        res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
    }
}

// Comparador (Fase 12): mismo esqueleto que favoritosJson -- solo
// lectura, traduce codigos guardados en localStorage a datos frescos.
// A diferencia de favoritos, categoria/marca/unidad_venta/garantia se
// exponen siempre (nunca son datos sensibles de precio/existencia,
// no necesitan el gate de mostrarPrecios/mostrarExistencias).
async function comparadorJson(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).json({ ok: false, error: "No encontrado" });
            return;
        }

        const codigos = paramTexto(req.query.codigos, 2000)
            .split(",")
            .map(c => c.trim())
            .filter(Boolean)
            .slice(0, 4);

        if (!codigos.length) {
            res.json({ ok: true, productos: [] });
            return;
        }

        const columnasExtra = [
            sitio.config.mostrarPrecios ? "COALESCE(precio_publico, precio) AS precio" : null,
            sitio.config.mostrarPrecios ? "precio_oferta" : null,
            sitio.config.mostrarExistencias ? "stock" : null
        ].filter(Boolean);

        const filas = await pool.query(
            `
            SELECT codigo, nombre, categoria, marca, unidad_venta, tiene_garantia, garantia_detalle${columnasExtra.length ? ", " + columnasExtra.join(", ") : ""}
            FROM public.productos
            WHERE negocio_id = $1 AND codigo = ANY($2) AND visible_market = true
            `,
            [sitio.negocio.id, codigos]
        );

        let fotosPorCodigo = new Set();
        if (filas.rows.length) {
            const fotos = await pool.query(
                `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2)`,
                [sitio.negocio.id, filas.rows.map(p => p.codigo)]
            );
            fotosPorCodigo = new Set(fotos.rows.map(f => f.codigo));
        }

        res.json({
            ok: true,
            productos: filas.rows.map(p => ({
                codigo: p.codigo,
                nombre: p.nombre,
                fotoUrl: fotosPorCodigo.has(p.codigo)
                    ? `/fotos-producto/${encodeURIComponent(p.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, p.codigo)}`
                    : "",
                precio: p.precio ?? null,
                precioOferta: p.precio_oferta ?? null,
                stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null,
                categoria: p.categoria || "",
                marca: p.marca || "",
                unidadVenta: p.unidad_venta || "",
                tieneGarantia: Boolean(p.tiene_garantia),
                garantiaDetalle: p.garantia_detalle || ""
            }))
        });
    } catch (error) {
        console.warn("Error sirviendo comparador:", error.message);
        res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
    }
}

// Carga de datos del catalogo (Fase 1 "Market embebido") -- separada de
// vistaCatalogoTenantHtml (mas abajo) para poder reusarse desde
// market-tienda-server.js sin duplicar la busqueda/paginacion/facetas.
// filtros = { buscar, categoria, marca, ofertas, pagina } -- ya
// parseados por quien llama (mismo shape que antes leia servirCatalogoNegocio
// de req.query, ahora explicito para que el llamador decida de donde
// vienen: query string en ambos casos, subdominio o Market).
async function cargarCatalogoTenant(pool, sitio, slug, filtros, firmarTokenImagen) {
    const buscar = filtros?.buscar || "";
    const categoria = filtros?.categoria || "";
    const marca = filtros?.marca || "";
    const ofertas = Boolean(filtros?.ofertas);
    const pagina = Math.max(1, filtros?.pagina || 1);
    const offset = (pagina - 1) * PRODUCTOS_POR_PAGINA_CATALOGO;

    const valores = [sitio.negocio.id];
    const condiciones = ["p.negocio_id = $1", "p.visible_market = true"];

    if (ofertas) {
        condiciones.push(`p.precio_oferta IS NOT NULL AND p.precio_oferta < COALESCE(p.precio_publico, p.precio)`);
    }

    if (buscar) {
        valores.push(buscar);
        const indiceTrgm = valores.length;
        valores.push(`%${buscar}%`);
        const indiceIlike = valores.length;
        condiciones.push(`(p.nombre % $${indiceTrgm} OR p.codigo ILIKE $${indiceIlike} OR p.marca ILIKE $${indiceIlike})`);
    }

    if (categoria) {
        valores.push(categoria);
        condiciones.push(`COALESCE(cn.departamento, p.categoria) = $${valores.length}`);
    }

    if (marca) {
        valores.push(marca);
        condiciones.push(`p.marca = $${valores.length}`);
    }

    const columnasExtra = [
        sitio.config.mostrarPrecios ? "COALESCE(p.precio_publico, p.precio) AS precio" : null,
        sitio.config.mostrarPrecios ? "p.precio_oferta" : null,
        sitio.config.mostrarExistencias ? "p.stock" : null
    ].filter(Boolean);

    valores.push(PRODUCTOS_POR_PAGINA_CATALOGO, offset);

    const filas = await pool.query(
        `
        SELECT p.id, p.codigo, p.nombre, COALESCE(cn.departamento, p.categoria) AS categoria, p.marca,
            ${columnasExtra.length ? columnasExtra.join(", ") + "," : ""}
            COUNT(*) OVER() AS total
        FROM public.productos p
        LEFT JOIN public.categorias_nexo cn ON cn.id = p.categoria_nexo_id
        WHERE ${condiciones.join(" AND ")}
        ORDER BY p.nombre ASC
        LIMIT $${valores.length - 1} OFFSET $${valores.length}
        `,
        valores
    );

    const filasProductos = filas.rows;
    const total = filasProductos.length ? Number(filasProductos[0].total) : 0;
    const totalPaginas = Math.max(1, Math.ceil(total / PRODUCTOS_POR_PAGINA_CATALOGO));

    let fotosPorCodigo = new Set();
    if (filasProductos.length) {
        const codigos = filasProductos.map(p => p.codigo);
        const fotos = await pool.query(
            `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2)`,
            [sitio.negocio.id, codigos]
        );
        fotosPorCodigo = new Set(fotos.rows.map(f => f.codigo));
    }

    const [categoriasRes, marcasRes] = await Promise.all([
        pool.query(
            `SELECT DISTINCT COALESCE(cn.departamento, p.categoria) AS categoria
             FROM public.productos p
             LEFT JOIN public.categorias_nexo cn ON cn.id = p.categoria_nexo_id
             WHERE p.negocio_id = $1 AND p.visible_market = true AND COALESCE(cn.departamento, p.categoria) <> ''
             ORDER BY COALESCE(cn.departamento, p.categoria)`,
            [sitio.negocio.id]
        ),
        pool.query(
            `SELECT DISTINCT marca FROM public.productos WHERE negocio_id = $1 AND visible_market = true AND marca IS NOT NULL AND marca <> '' ORDER BY marca`,
            [sitio.negocio.id]
        )
    ]);

    const productos = filasProductos.map(p => ({
        codigo: p.codigo,
        nombre: p.nombre,
        fotoUrl: fotosPorCodigo.has(p.codigo)
            ? `/fotos-producto/${encodeURIComponent(p.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, p.codigo)}`
            : "",
        precio: p.precio ?? null,
        precioOferta: p.precio_oferta ?? null,
        stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null
    }));

    return {
        productos,
        total,
        totalPaginas,
        categorias: categoriasRes.rows,
        marcas: marcasRes.rows
    };
}

// Vista del catalogo (Fase 1 "Market embebido") -- arma solo el
// contenido de <main> (titulo, pills de categoria, filtros, grid/vacio,
// paginacion), sin el shell (head/header/footer/scripts) para poder
// reusarse dentro de la pagina de tienda embebida en Market
// (market-tienda-server.js), donde el shell es el de Market, no el del
// tenant. basePath="" (subdominio, valor por defecto) reproduce
// exactamente el mismo HTML de antes del refactor.
function vistaCatalogoTenantHtml({ sitio, datos, filtros, basePath = "" }) {
    const buscar = filtros?.buscar || "";
    const categoria = filtros?.categoria || "";
    const marca = filtros?.marca || "";
    const pagina = Math.max(1, filtros?.pagina || 1);
    const { productos, total, totalPaginas, categorias, marcas } = datos;

    const tarjetasHtml = productos.length
        ? productos.map(p => tarjetaProductoTenantHtml({ ...p, basePath })).join("")
        : "";

    const opcionesCategoria = categorias.map(f =>
        `<option value="${escaparHtml(f.categoria)}"${f.categoria === categoria ? " selected" : ""}>${escaparHtml(f.categoria)}</option>`
    ).join("");

    const pillsCategoriaHtml = categorias.length
        ? `<div class="tenant-categoria-pills">
<a class="tenant-categoria-pill${categoria ? "" : " activo"}" href="${basePath}/catalogo${construirQueryString({ buscar, marca })}">Todas</a>
${categorias.map(f => `<a class="tenant-categoria-pill${f.categoria === categoria ? " activo" : ""}" href="${basePath}/catalogo${construirQueryString({ buscar, categoria: f.categoria, marca })}">${escaparHtml(f.categoria)}</a>`).join("")}
</div>`
        : "";

    const opcionesMarca = marcas.map(f =>
        `<option value="${escaparHtml(f.marca)}"${f.marca === marca ? " selected" : ""}>${escaparHtml(f.marca)}</option>`
    ).join("");

    const paginacionHtml = totalPaginas > 1
        ? `<div class="tenant-paginacion">
${pagina > 1 ? `<a href="${basePath}/catalogo${construirQueryString({ buscar, categoria, marca, pagina: pagina - 1 })}">Anterior</a>` : ""}
<span>Pagina ${pagina} de ${totalPaginas}</span>
${pagina < totalPaginas ? `<a href="${basePath}/catalogo${construirQueryString({ buscar, categoria, marca, pagina: pagina + 1 })}">Siguiente</a>` : ""}
</div>`
        : "";

    return `<h1 class="tenant-catalogo-titulo">Catalogo de productos</h1>
<p class="tenant-catalogo-subtitulo">${total} producto${total === 1 ? "" : "s"} disponible${total === 1 ? "" : "s"}</p>
${pillsCategoriaHtml}
<form class="tenant-filtros" method="GET" action="${basePath}/catalogo">
<input type="text" name="buscar" placeholder="Buscar por nombre, codigo o marca" value="${escaparHtml(buscar)}">
<select name="categoria"><option value="">Todas las categorias</option>${opcionesCategoria}</select>
<select name="marca"><option value="">Todas las marcas</option>${opcionesMarca}</select>
<button type="submit">Buscar</button>
</form>
${productos.length
    ? `<div class="tenant-catalogo-grid">${tarjetasHtml}</div>${paginacionHtml}`
    : `<div class="tenant-catalogo-vacio">No encontramos productos con esos filtros.</div>`}`;
}

async function servirCatalogoNegocio(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const filtros = {
            buscar: paramTexto(req.query.buscar, 120),
            categoria: paramTexto(req.query.categoria, 120),
            marca: paramTexto(req.query.marca, 120),
            ofertas: req.query.ofertas === "1" && sitio.config.mostrarPrecios,
            pagina: Math.max(1, parseInt(req.query.pagina, 10) || 1)
        };

        const datos = await cargarCatalogoTenant(pool, sitio, slug, filtros, firmarTokenImagen);
        const contenidoHtml = vistaCatalogoTenantHtml({ sitio, datos, filtros, basePath: "" });

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);

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
${encabezadoTenantHtml(sitio.negocio, "catalogo", sitio.config.aceptarSolicitudesCredito, true, true, true)}
${bannerPromocionHtml(sitio.config, sitio.negocio.slug)}
<main class="tenant-main">
${contenidoHtml}
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo</footer>
${modalCarritoTenantHtml(slug)}
<script>${scriptCarritoTenantHtml(slug)}</script>
<script>${scriptFavoritosTenantHtml(slug)}</script>
<script>${scriptComparadorTenantHtml(slug)}</script>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo catalogo de negocio:", error.message);
        res.status(500).send("Error");
    }
}

// Pagina de favoritos (Fase 11) -- el servidor no sabe que hay
// guardado en localStorage del navegador, asi que solo pinta el
// esqueleto (header/footer/estilos) con un contenedor vacio; el
// script de favoritos lo llena al cargar via fetch a favoritosJson.
async function servirFavoritosNegocio(pool, req, res, slug) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);

        const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Favoritos -- ${nombre}</title>
<meta name="description" content="Tus productos favoritos en ${nombre}.">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
</head>
<body>
${encabezadoTenantHtml(sitio.negocio, "favoritos", sitio.config.aceptarSolicitudesCredito, true, true, true)}
${bannerPromocionHtml(sitio.config, sitio.negocio.slug)}
<main class="tenant-main">
<h1 class="tenant-catalogo-titulo">Tus favoritos</h1>
<div id="favoritosLista"><p class="tenant-favoritos-vacio">Cargando...</p></div>
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo</footer>
${modalCarritoTenantHtml(slug)}
<script>${scriptCarritoTenantHtml(slug)}</script>
<script>${scriptFavoritosTenantHtml(slug)}</script>
<script>${scriptComparadorTenantHtml(slug)}</script>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo favoritos de negocio:", error.message);
        res.status(500).send("Error");
    }
}

// Pagina de comparador (Fase 12) -- mismo criterio que favoritos: el
// servidor no sabe que hay en localStorage, solo pinta el esqueleto y
// el script de comparador lo llena via fetch a comparadorJson.
async function servirComparadorNegocio(pool, req, res, slug) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);

        const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comparar productos -- ${nombre}</title>
<meta name="description" content="Compara productos de ${nombre}.">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
</head>
<body>
${encabezadoTenantHtml(sitio.negocio, "comparar", sitio.config.aceptarSolicitudesCredito, true, true, true)}
${bannerPromocionHtml(sitio.config, sitio.negocio.slug)}
<main class="tenant-main">
<h1 class="tenant-catalogo-titulo">Comparar productos</h1>
<div id="comparadorTabla"><p class="tenant-comparador-vacio">Cargando...</p></div>
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo</footer>
${modalCarritoTenantHtml(slug)}
<script>${scriptCarritoTenantHtml(slug)}</script>
<script>${scriptFavoritosTenantHtml(slug)}</script>
<script>${scriptComparadorTenantHtml(slug)}</script>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo comparador de negocio:", error.message);
        res.status(500).send("Error");
    }
}

// Carga de datos de la ficha de producto (Fase 1 "Market embebido") --
// separada de vistaProductoTenantHtml para poder reusarse desde
// market-tienda-server.js sin duplicar galeria/complementarios/garantia
// (funcionalidad agregada en la sesion anterior, que esta funcion
// preserva tal cual). Regresa null si el producto no existe en esta
// tienda (el llamador decide como responder el 404).
async function cargarProductoTenant(pool, sitio, slug, codigo, firmarTokenImagen) {
    const productoRes = await pool.query(
        `
        SELECT id, codigo, nombre, categoria, marca, descripcion, precio, precio_publico, precio_oferta, stock,
            tiene_garantia, garantia_detalle, destacado
        FROM public.productos
        WHERE negocio_id = $1 AND codigo = $2 AND visible_market = true
        LIMIT 1
        `,
        [sitio.negocio.id, codigo]
    );

    const producto = productoRes.rows[0];

    if (!producto) return null;

    const fotoRes = await pool.query(
        `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`,
        [sitio.negocio.id, producto.codigo]
    );
    const tieneFoto = fotoRes.rows.length > 0;
    const fotoUrl = tieneFoto
        ? `/fotos-producto/${encodeURIComponent(producto.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, producto.codigo)}`
        : "";

    // Galeria propia del negocio (fotos_producto_galeria) -- fotos
    // adicionales reales que el dueno ya subio para este producto,
    // nunca imagenes inventadas. La principal (arriba) siempre va
    // primero en la tira de miniaturas si existe.
    const galeriaRes = await pool.query(
        `
        SELECT fg.id
        FROM public.fotos_producto_galeria fg
        JOIN public.fotos_producto fp ON fp.id = fg.foto_producto_id
        WHERE fp.negocio_id = $1 AND fp.codigo = $2
        ORDER BY fg.orden ASC
        `,
        [sitio.negocio.id, producto.codigo]
    );
    const galeriaUrls = galeriaRes.rows.map(fila =>
        `/fotos-producto-galeria/${fila.id}?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, String(fila.id))}`
    );
    let imagenesProducto = fotoUrl ? [fotoUrl, ...galeriaUrls] : galeriaUrls;

    // Banco de Nexo (banco global de fotos reales por codigo, Pro-only,
    // ver banco-imagenes-server.js): si la tienda todavia no tiene su
    // propia galeria para este codigo, se completa con las fotos reales
    // del banco -- nunca reemplaza lo que el dueno ya subio, solo llena
    // el hueco cuando no hay nada propio. Mismo gate de plan que ya usa
    // "Usar esta imagen" en Agregar producto.
    if (galeriaUrls.length === 0) {
        const puedeBancoImagenes = await planPermiteBancoImagenes(pool, sitio.negocio.id);
        if (puedeBancoImagenes) {
            const codigoBanco = normalizarCodigoBancoImagen(producto.codigo);
            const bancoRes = await pool.query(
                `SELECT id, actualizado_at FROM public.banco_imagenes_producto WHERE codigo = $1`,
                [codigoBanco]
            );
            const filaBanco = bancoRes.rows[0];

            if (filaBanco) {
                const version = new Date(filaBanco.actualizado_at).getTime();
                const bancoGaleriaRes = await pool.query(
                    `SELECT id FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1 ORDER BY orden ASC`,
                    [filaBanco.id]
                );
                const bancoGaleriaUrls = bancoGaleriaRes.rows.map(fila =>
                    `/banco-imagenes-galeria/${fila.id}?token=${firmarTokenBancoImagen(String(fila.id))}`
                );
                const bancoUrls = [
                    `/banco-imagenes/${encodeURIComponent(codigoBanco)}/principal?v=${version}&token=${firmarTokenBancoImagen(codigoBanco)}`,
                    ...bancoGaleriaUrls
                ];
                // La foto principal que la tienda ya subio (si tiene) se
                // queda primero -- el banco solo aporta vistas
                // adicionales, nunca la reemplaza.
                imagenesProducto = fotoUrl ? [fotoUrl, ...bancoUrls] : bancoUrls;
            }
        }
    }

    // Productos que puedes complementar -- otros productos reales de
    // la MISMA tienda que comparten categoria o marca con este, nunca
    // un emparejamiento inventado de "accesorios compatibles". Si no
    // hay ninguno real, la lista queda vacia.
    let complementarios = [];
    if (producto.categoria || producto.marca) {
        const condicionesComp = ["p.negocio_id = $1", "p.codigo <> $2", "p.visible_market = true"];
        const valoresComp = [sitio.negocio.id, producto.codigo];
        const subcondiciones = [];
        if (producto.categoria) {
            valoresComp.push(producto.categoria);
            subcondiciones.push(`p.categoria = $${valoresComp.length}`);
        }
        if (producto.marca) {
            valoresComp.push(producto.marca);
            subcondiciones.push(`p.marca = $${valoresComp.length}`);
        }
        condicionesComp.push(`(${subcondiciones.join(" OR ")})`);

        const columnasExtraComp = [
            sitio.config.mostrarPrecios ? "COALESCE(p.precio_publico, p.precio) AS precio" : null,
            sitio.config.mostrarPrecios ? "p.precio_oferta" : null,
            sitio.config.mostrarExistencias ? "p.stock" : null
        ].filter(Boolean);

        const complementariosRes = await pool.query(
            `
            SELECT p.codigo, p.nombre
                ${columnasExtraComp.length ? ", " + columnasExtraComp.join(", ") : ""}
            FROM public.productos p
            WHERE ${condicionesComp.join(" AND ")}
            ORDER BY p.nombre ASC
            LIMIT 12
            `,
            valoresComp
        );

        if (complementariosRes.rows.length) {
            const codigosComp = complementariosRes.rows.map(p => p.codigo);
            const fotosComp = await pool.query(
                `SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2)`,
                [sitio.negocio.id, codigosComp]
            );
            const fotosPorCodigoComp = new Set(fotosComp.rows.map(f => f.codigo));

            complementarios = complementariosRes.rows.map(p => ({
                codigo: p.codigo,
                nombre: p.nombre,
                fotoUrl: fotosPorCodigoComp.has(p.codigo)
                    ? `/fotos-producto/${encodeURIComponent(p.codigo)}/principal?negocio=${encodeURIComponent(slug)}&token=${firmarTokenImagen(sitio.negocio.id, p.codigo)}`
                    : "",
                precio: p.precio ?? null,
                precioOferta: p.precio_oferta ?? null,
                stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null
            }));
        }
    }

    const precio = sitio.config.mostrarPrecios
        ? Number(producto.precio_publico ?? producto.precio)
        : null;
    const stock = sitio.config.mostrarExistencias ? Number(producto.stock) : null;

    return { producto, fotoUrl, galeriaUrls, imagenesProducto, complementarios, precio, stock };
}

// Vista de la ficha de producto (Fase 1 "Market embebido") -- arma solo
// el contenido de <main> (breadcrumb, banner de pedido, galeria,
// datos/acciones, garantia, pedido rapido, complementarios), sin el
// shell, para reusarse dentro de la pagina de tienda embebida en
// Market. basePath="" (default) reproduce el HTML de antes del
// refactor byte a byte. Cuando basePath es truthy (dentro de Market),
// los botones de favorito/comparar de la ficha se ocultan -- sus
// scripts (scriptFavoritosTenantHtml/scriptComparadorTenantHtml) no se
// cargan todavia ahi (fuera de alcance de esta fase), mismo criterio
// que tarjetaProductoTenantHtml.
function vistaProductoTenantHtml({ sitio, datos, basePath = "", estadoPedido = "" }) {
    const { producto, fotoUrl, galeriaUrls, imagenesProducto, complementarios, precio, stock } = datos;
    const nombreProducto = escaparHtml(producto.nombre);

    const miniaturasHtml = imagenesProducto.length > 1
        ? `<div class="tenant-detalle-miniaturas">${imagenesProducto.map((url, indice) => `<button type="button" class="tenant-detalle-miniatura${indice === 0 ? " activa" : ""}" onclick="document.getElementById('tenantDetalleFotoActual').src='${url}';this.parentElement.querySelectorAll('.tenant-detalle-miniatura').forEach(b=>b.classList.remove('activa'));this.classList.add('activa');"><img src="${url}" alt=""></button>`).join("")}</div>`
        : "";

    const whatsappNumero = normalizarTelefonoWhatsApp(sitio.config.whatsapp);

    const bannerPedidoHtml = estadoPedido === "enviado"
        ? `<div class="tenant-pedido-banner exito">Listo -- tu pedido fue enviado. El negocio te contactara pronto.</div>`
        : estadoPedido === "error"
            ? `<div class="tenant-pedido-banner error">No pudimos enviar tu pedido. Revisa tus datos e intenta de nuevo.</div>`
            : "";

    const formularioPedidoHtml = `
<form class="tenant-pedido-form" method="POST" action="${basePath}/catalogo/${encodeURIComponent(producto.codigo)}/pedido">
<h2>Pedir este producto</h2>
<div class="tenant-pedido-honeypot" aria-hidden="true"><label>No llenar<input type="text" name="sitioExtra" tabindex="-1" autocomplete="off"></label></div>
<label>Cantidad<input type="number" name="cantidad" min="1" step="1" value="1" required></label>
<label>Tu nombre<input type="text" name="clienteNombre" maxlength="140" required></label>
<label>Telefono<input type="text" name="clienteTelefono" maxlength="40" placeholder="10 digitos"></label>
<label>Correo (opcional)<input type="text" name="clienteCorreo" maxlength="140"></label>
<label>Mensaje (opcional)<textarea name="mensaje" maxlength="500"></textarea></label>
<button type="submit">Enviar pedido</button>
</form>`;

    let complementariosHtml = "";
    if (complementarios.length) {
        const tarjetasComp = complementarios.map(p => tarjetaProductoTenantHtml({ ...p, basePath })).join("");
        complementariosHtml = `<section class="tenant-seccion-home"><div class="tenant-seccion-home-header"><h2>Productos que puedes complementar</h2></div><div class="tenant-complementarios-fila">${tarjetasComp}</div></section>`;
    }

    const breadcrumbHtml = `<nav class="tenant-breadcrumb"><a href="${basePath || "/"}">Inicio</a>${producto.categoria ? ` &rsaquo; <a href="${basePath}/catalogo?categoria=${encodeURIComponent(producto.categoria)}">${escaparHtml(producto.categoria)}</a>` : ""} &rsaquo; ${nombreProducto}</nav>`;

    const favoritoCompararLineaHtml = !basePath
        ? `<button type="button" class="tenant-btn-favorito tenant-btn-favorito-linea" data-codigo="${escaparHtml(producto.codigo)}" aria-label="Guardar en favoritos">${ICONO_TENANT_FAVORITO}<span>Favorito</span></button><button type="button" class="tenant-btn-comparar tenant-btn-comparar-linea" data-codigo="${escaparHtml(producto.codigo)}" aria-label="Agregar a comparar">${ICONO_TENANT_COMPARAR}<span>Comparar</span></button>`
        : "";

    // Columna de compra (Amazon-style): solo datos reales -- a quien se
    // le compra y donde recoger son datos del negocio, nunca inventamos
    // tiempos de entrega ni "envio gratis" (no existe logistica de envio
    // en la plataforma). El badge "Destacado" solo aparece si el dueno
    // ya marco el producto como tal (mismo dato que alimenta la seccion
    // de destacados del inicio).
    const badgeDestacadoHtml = producto.destacado ? `<span class="tenant-detalle-badge-destacado">Destacado</span>` : "";
    const nombreTienda = escaparHtml(sitio.negocio.nombre);
    const direccionTienda = escaparHtml(sitio.negocio.direccion || "");
    const compraboxLineasHtml = [
        `<div class="tenant-detalle-comprabox-linea">Vendido por <strong>${nombreTienda}</strong></div>`,
        direccionTienda ? `<div class="tenant-detalle-comprabox-linea">Recoge en tienda: <strong>${direccionTienda}</strong></div>` : "",
        `<div class="tenant-detalle-comprabox-linea">${lineaEnvioHtml(sitio.config)}</div>`,
        whatsappNumero ? `<div class="tenant-detalle-comprabox-linea">&iquest;Dudas sobre el producto? <a href="https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, me interesa "${producto.nombre}" que vi en su catalogo.`)}" target="_blank" rel="noopener">Contactanos por WhatsApp</a></div>` : ""
    ].filter(Boolean).join("");

    return `${breadcrumbHtml}
${bannerPedidoHtml}
<div class="tenant-detalle-card">
<div class="tenant-detalle-grid">
<div class="tenant-detalle-galeria">
${miniaturasHtml}
<div class="tenant-detalle-foto">${imagenesProducto.length ? `<img id="tenantDetalleFotoActual" src="${imagenesProducto[0]}" alt="${nombreProducto}">` : `<span class="tenant-detalle-foto-vacia">Sin foto</span>`}</div>
</div>
<div>
${badgeDestacadoHtml}
<h1 class="tenant-detalle-titulo">${nombreProducto}</h1>
${producto.marca || producto.categoria ? `<p class="tenant-detalle-marca">${producto.marca ? escaparHtml(producto.marca) : ""}${producto.marca && producto.categoria ? " &middot; " : ""}${producto.categoria ? escaparHtml(producto.categoria) : ""}</p>` : ""}
${precio !== null && Number.isFinite(precio) ? `<div class="tenant-detalle-precio">${precioOfertaHtml(precio, producto.precio_oferta)}</div>` : ""}
${stock !== null ? `<span class="tenant-producto-existencia${stock <= 0 ? " agotado" : ""}">${stock <= 0 ? "Agotado" : `${stock} disponibles`}</span>` : `<span class="tenant-producto-existencia bajo-pedido">Bajo pedido -- confirma con la tienda</span>`}
${producto.descripcion ? `<p class="tenant-detalle-descripcion">${escaparHtml(producto.descripcion)}</p>` : ""}
${producto.tiene_garantia ? `<div class="tenant-detalle-garantia">Este producto tiene garantia${producto.garantia_detalle ? `: ${escaparHtml(producto.garantia_detalle)}` : "."}</div>` : ""}
</div>
<div class="tenant-detalle-comprabox">
<div class="tenant-acciones"><button type="button" class="tenant-btn-carrito tenant-btn-primario" data-codigo="${escaparHtml(producto.codigo)}" data-nombre="${nombreProducto}">Agregar al carrito</button><button type="button" class="tenant-btn-secundario" onclick="document.getElementById('tenantPedidoRapido').hidden=false;document.getElementById('tenantPedidoRapido').scrollIntoView({behavior:'smooth',block:'start'});">Comprar ahora</button>${favoritoCompararLineaHtml}</div>
${compraboxLineasHtml}
</div>
</div>
</div>
${beneficiosTenantHtml(sitio.config)}
<div id="tenantPedidoRapido" class="tenant-pedido-rapido" hidden>${formularioPedidoHtml}</div>
${complementariosHtml}`;
}

async function servirProductoNegocio(pool, req, res, slug, codigo, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const datos = await cargarProductoTenant(pool, sitio, slug, codigo, firmarTokenImagen);

        if (!datos) {
            res.status(404).send("No encontrado");
            return;
        }

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);
        const nombreProducto = escaparHtml(datos.producto.nombre);
        const estadoPedido = paramTexto(req.query.pedido, 20);

        const contenidoHtml = vistaProductoTenantHtml({ sitio, datos, basePath: "", estadoPedido });

        const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${nombreProducto} -- ${nombre}</title>
<meta name="description" content="${nombreProducto} disponible en ${nombre}.">
<meta property="og:title" content="${nombreProducto}">
<meta property="og:description" content="Disponible en ${nombre}.">
${datos.fotoUrl ? `<meta property="og:image" content="${datos.fotoUrl}">` : ""}
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
</head>
<body>
${encabezadoTenantHtml(sitio.negocio, "catalogo", sitio.config.aceptarSolicitudesCredito, true, true, true)}
${bannerPromocionHtml(sitio.config, sitio.negocio.slug)}
<main class="tenant-main">
${contenidoHtml}
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo</footer>
${modalCarritoTenantHtml(slug)}
<script>${scriptCarritoTenantHtml(slug)}</script>
<script>${scriptFavoritosTenantHtml(slug)}</script>
<script>${scriptComparadorTenantHtml(slug)}</script>
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
async function recibirPedidoPublico(pool, req, res, slug, codigo, basePath = "") {
    const volverConError = () => res.redirect(303, `${basePath}/catalogo/${encodeURIComponent(codigo)}?pedido=error`);

    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        // Nexo Market (Fase 2 admin) -- distingue de donde vino el
        // pedido para poder mostrarlo por separado en el modulo
        // "Nexo Market" del POS, sin duplicar la lista de pedidos.
        const origen = req.originalUrl.startsWith("/market/") ? "market" : "sitio";

        const resolverPersonaOpcional = crearResolverSesionPersonaOpcional(pool);
        await new Promise(continuar => resolverPersonaOpcional(req, res, continuar));

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
            `SELECT nombre FROM public.productos WHERE negocio_id = $1 AND codigo = $2 AND disponible_pedidos = true LIMIT 1`,
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
                (negocio_id, producto_codigo, producto_nombre, cantidad, cliente_nombre, cliente_telefono, cliente_correo, mensaje, ip, persona_id, origen)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `,
            [sitio.negocio.id, codigo, producto.nombre, cantidad, clienteNombre, clienteTelefono, clienteCorreo, mensaje, req.ip, req.persona ? req.persona.id : null, origen]
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

        res.redirect(303, `${basePath}/catalogo/${encodeURIComponent(codigo)}?pedido=enviado`);
    } catch (error) {
        console.warn("Error recibiendo pedido publico:", error.message);
        volverConError();
    }
}

// Carrito multi-producto (Fase 7): lista armada en el navegador
// (localStorage), enviada como UN solo pedido con varias filas en
// pedidos_publicos compartiendo grupo_id. Llamada por fetch/JSON (no
// un <form> plano) -- mismo precedente ya aceptado en el portal de
// cliente para paginas que si necesitan JS.
async function recibirPedidoCarritoPublico(pool, req, res, slug) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).json({ ok: false, error: "No encontrado" });
            return;
        }

        const origen = req.originalUrl.startsWith("/market/") ? "market" : "sitio";

        const resolverPersonaOpcional = crearResolverSesionPersonaOpcional(pool);
        await new Promise(continuar => resolverPersonaOpcional(req, res, continuar));

        if (paramTexto(req.body?.sitioExtra, 200)) {
            res.json({ ok: false, error: "No se pudo enviar el pedido." });
            return;
        }

        if (limitadorPedidoPublico.bloqueado(req.ip)) {
            res.json({ ok: false, error: "Demasiados intentos. Intenta mas tarde." });
            return;
        }

        limitadorPedidoPublico.registrarFallo(req.ip);

        const itemsBody = Array.isArray(req.body?.items) ? req.body.items : [];

        if (itemsBody.length === 0 || itemsBody.length > MAX_ITEMS_CARRITO) {
            res.json({ ok: false, error: `El carrito debe tener entre 1 y ${MAX_ITEMS_CARRITO} productos.` });
            return;
        }

        const clienteNombre = paramTexto(req.body?.clienteNombre, 140);
        const clienteTelefono = paramTexto(req.body?.clienteTelefono, 40);
        const clienteCorreo = paramTexto(req.body?.clienteCorreo, 140).toLowerCase();
        const mensaje = paramTexto(req.body?.mensaje, 500);
        const tipo = req.body?.tipo === "cotizacion" ? "cotizacion" : "pedido";
        // El cliente elige recoleccion/domicilio en el front, pero nunca se
        // confia en eso solo: si la tienda declaro "solo_recoleccion" en
        // Sitio web, se fuerza aqui sin importar lo que mande la peticion.
        const entregaModoBody = req.body?.entrega;
        let entregaModo = entregaModoBody === "recoleccion" || entregaModoBody === "domicilio" ? entregaModoBody : null;
        if (sitio.config.envioModo === "solo_recoleccion") entregaModo = "recoleccion";

        if (!clienteNombre) {
            res.json({ ok: false, error: "Escribe tu nombre." });
            return;
        }

        if (!clienteTelefono && !clienteCorreo) {
            res.json({ ok: false, error: "Deja un telefono o un correo para contactarte." });
            return;
        }

        if (clienteCorreo && !REGEX_CORREO.test(clienteCorreo)) {
            res.json({ ok: false, error: "El correo no es valido." });
            return;
        }

        const codigos = itemsBody.map(item => paramTexto(item?.codigo, 80)).filter(Boolean);

        if (codigos.length !== itemsBody.length || new Set(codigos).size !== codigos.length) {
            res.json({ ok: false, error: "Hay un producto invalido o repetido en el carrito." });
            return;
        }

        // Pago real (Stripe Connect, ver plan "Nexo Market: pagos reales
        // con Stripe Connect"): si el checkout ya cobro con tarjeta,
        // aqui se verifica el pago CONTRA Stripe antes de marcar
        // pagado=true -- nunca se confia en que el cliente diga "ya
        // pague". El monto real ya lo calculo crear-intento-pago con
        // precios de la base de datos; aqui solo se confirma que el
        // pago exista, este completado, y sea de esta misma tienda
        // (metadata.negocio_slug) -- no se vuelve a recalcular el total.
        const stripePaymentIntentId = paramTexto(req.body?.stripePaymentIntentId, 100) || null;
        let pagado = false;
        let montoPagado = null;
        let comisionNexo = null;

        if (stripePaymentIntentId) {
            const { obtenerStripe } = require("./stripe-connect-server");
            const stripe = obtenerStripe();

            if (!stripe) {
                res.json({ ok: false, error: "No se pudo verificar tu pago. Intenta de nuevo." });
                return;
            }

            let intento;
            try {
                intento = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
            } catch (error) {
                res.json({ ok: false, error: "No se pudo verificar tu pago. Intenta de nuevo." });
                return;
            }

            if (intento.status !== "succeeded" || intento.metadata?.negocio_slug !== slug) {
                res.json({ ok: false, error: "Tu pago no se pudo confirmar. Intenta de nuevo." });
                return;
            }

            pagado = true;
            montoPagado = intento.amount / 100;
            comisionNexo = (intento.application_fee_amount || 0) / 100;
        }

        const client = await pool.connect();
        let grupoId = null;
        let cuentaCreada = false;
        let codigoAcceso = null;
        let itemsParaCorreo = [];
        let pedidoMarketId = null;
        let codigoRecogida = null;
        let recogidaEstimada = null;

        try {
            await client.query("BEGIN");

            const productosRes = await client.query(
                `SELECT codigo, nombre, COALESCE(precio_oferta, precio_publico, precio) AS precio_final FROM public.productos WHERE negocio_id = $1 AND codigo = ANY($2) AND disponible_pedidos = true`,
                [sitio.negocio.id, codigos]
            );
            const nombresPorCodigo = new Map(productosRes.rows.map(p => [p.codigo, p.nombre]));
            const preciosPorCodigo = new Map(productosRes.rows.map(p => [p.codigo, Number(p.precio_final) || 0]));

            if (nombresPorCodigo.size !== codigos.length) {
                await client.query("ROLLBACK");
                res.json({ ok: false, error: "Uno de los productos ya no esta disponible." });
                return;
            }

            grupoId = crypto.randomUUID();

            const itemsNormalizados = itemsBody.map(item => {
                const codigo = paramTexto(item?.codigo, 80);
                const cantidad = Math.min(9999, Math.max(1, parseInt(item?.cantidad, 10) || 1));
                return { codigo, cantidad, nombre: nombresPorCodigo.get(codigo), precio: preciosPorCodigo.get(codigo) };
            });

            // Cabecera del pedido (Fase 1/2 del rediseno de pedidos de
            // Market): solo para pedidos reales de Nexo Market, no para
            // cotizaciones ni pedidos del sitio propio del negocio -- esos
            // siguen igual que siempre, con pedido_market_id = NULL. El
            // codigo de recogida depende del id (serial), asi que primero
            // se inserta con un codigo temporal unico y se actualiza en la
            // misma transaccion en cuanto se conoce el id.
            if (origen === "market" && tipo === "pedido") {
                const total = itemsNormalizados.reduce((suma, i) => suma + i.precio * i.cantidad, 0);
                const prepMin = sitio.negocio.pedidoPrepMin ?? 30;
                const prepMax = sitio.negocio.pedidoPrepMax ?? 45;
                const ahora = Date.now();
                const recogidaDesde = new Date(ahora + prepMin * 60000);
                const recogidaHasta = new Date(ahora + prepMax * 60000);

                let insertCabecera;
                try {
                    insertCabecera = await client.query(
                        `
                        INSERT INTO public.pedidos_market
                            (negocio_id, persona_id, grupo_id, cliente_nombre, cliente_telefono, cliente_correo, estado, codigo_recogida, total, pagado, tiempo_prep_min, tiempo_prep_max, recogida_estimada_desde, recogida_estimada_hasta, stripe_payment_intent_id)
                        VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', $7, $8, $9, $10, $11, $12, $13, $14)
                        RETURNING id
                        `,
                        [sitio.negocio.id, req.persona ? req.persona.id : null, grupoId, clienteNombre, clienteTelefono, clienteCorreo, `TEMP-${grupoId}`, total, pagado, prepMin, prepMax, recogidaDesde, recogidaHasta, stripePaymentIntentId]
                    );
                } catch (error) {
                    // Carrera con el respaldo del webhook (ver
                    // crearPedidoMarketDesdeSnapshot, stripe-connect-server.js):
                    // si el pago se confirmo y el webhook ya creo este pedido
                    // por su cuenta justo antes de que este POST llegara, no es
                    // un error real -- el pedido ya existe, se regresa ese en
                    // vez de intentar crear uno duplicado.
                    if (error.code === "23505" && stripePaymentIntentId) {
                        const existenteRow = await client.query(
                            `SELECT id, codigo_recogida FROM public.pedidos_market WHERE stripe_payment_intent_id = $1 LIMIT 1`,
                            [stripePaymentIntentId]
                        );
                        if (existenteRow.rows.length > 0) {
                            await client.query("ROLLBACK");
                            res.json({
                                ok: true,
                                repetido: true,
                                pedidoMarketId: existenteRow.rows[0].id,
                                codigoRecogida: existenteRow.rows[0].codigo_recogida
                            });
                            return;
                        }
                    }
                    throw error;
                }

                pedidoMarketId = insertCabecera.rows[0].id;
                codigoRecogida = formatearCodigoRecogida(pedidoMarketId);
                recogidaEstimada = { desde: recogidaDesde, hasta: recogidaHasta };

                await client.query(
                    `UPDATE public.pedidos_market SET codigo_recogida = $1 WHERE id = $2`,
                    [codigoRecogida, pedidoMarketId]
                );

                if (stripePaymentIntentId) {
                    // El pedido ya se creo por el camino normal -- la foto de
                    // respaldo (ver crearPedidoMarketDesdeSnapshot) ya no hace
                    // falta, se marca procesada para que el webhook no la use.
                    await client.query(
                        `UPDATE public.market_checkout_pendiente SET procesado = true WHERE payment_intent_id = $1`,
                        [stripePaymentIntentId]
                    );
                }
            }

            for (const item of itemsNormalizados) {
                await client.query(
                    `
                    INSERT INTO public.pedidos_publicos
                        (negocio_id, producto_codigo, producto_nombre, cantidad, cliente_nombre, cliente_telefono, cliente_correo, mensaje, ip, grupo_id, tipo, persona_id, origen, entrega_modo, pagado, stripe_payment_intent_id, monto_pagado, comision_nexo, pedido_market_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                    `,
                    [sitio.negocio.id, item.codigo, item.nombre, item.cantidad, clienteNombre, clienteTelefono, clienteCorreo, mensaje, req.ip, grupoId, tipo, req.persona ? req.persona.id : null, origen, entregaModo, pagado, stripePaymentIntentId, montoPagado, comisionNexo, pedidoMarketId]
                );

                itemsParaCorreo.push({ nombre: item.nombre, cantidad: item.cantidad });
            }

            // Cuenta ligera (Fase 7): solo si hay telefono valido y NO
            // existe ya ninguna fila de clientes_credito para ese
            // telefono en este negocio -- ni cliente real del dueno, ni
            // visitante previo. Nunca se pisa/activa una cuenta ya
            // existente desde este formulario publico -- cierra el
            // riesgo de que alguien reclame el portal de otro cliente
            // solo escribiendo su telefono.
            const digitosTelefono = clienteTelefono.replace(/\D/g, "");
            if (digitosTelefono.length >= 10) {
                const existente = await client.query(
                    `SELECT id FROM public.clientes_credito WHERE negocio_id = $1 AND telefono = $2`,
                    [sitio.negocio.id, clienteTelefono]
                );

                if (existente.rows.length === 0) {
                    codigoAcceso = generarCodigoAccesoCliente();
                    await client.query(
                        `
                        INSERT INTO public.clientes_credito
                            (negocio_id, nombre, telefono, limite_credito, es_visitante_sitio, codigo_acceso_hash, codigo_acceso_generado_at)
                        VALUES ($1, $2, $3, 0, true, $4, NOW())
                        `,
                        [sitio.negocio.id, clienteNombre, clienteTelefono, hashPassword(codigoAcceso)]
                    );
                    cuentaCreada = true;
                }
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        if (sitio.negocio.correo) {
            enviarCorreoPedidoCarritoPublico(sitio.negocio.correo, sitio.negocio.nombre, {
                items: itemsParaCorreo,
                clienteNombre,
                clienteTelefono,
                clienteCorreo,
                mensaje,
                urlCatalogo: `https://${slug}.nexoposoficial.com/catalogo`
            }).catch(error => console.warn("No se pudo enviar el aviso de pedido de carrito:", error.message));
        }

        if (pedidoMarketId && clienteCorreo) {
            enviarCorreoPedidoRecibido(clienteCorreo, sitio.negocio.nombre, {
                items: itemsParaCorreo,
                codigoRecogida,
                recogidaDesde: recogidaEstimada?.desde,
                recogidaHasta: recogidaEstimada?.hasta,
                urlSeguimiento: `https://nexoposoficial.com/market/pedido/${encodeURIComponent(codigoRecogida)}`
            }).catch(error => console.warn("No se pudo enviar el correo de pedido recibido:", error.message));
        }

        if (pedidoMarketId) {
            enviarPushANegocio(pool, sitio.negocio.id, {
                titulo: "Nuevo pedido de Nexo Market",
                cuerpo: `${clienteNombre} -- ${itemsParaCorreo.map(i => i.nombre).join(", ")}`.slice(0, 180),
                url: "/",
                pantalla: "pedidos"
            }).catch(error => console.warn("No se pudo enviar el push de pedido nuevo:", error.message));
        }

        res.json({
            ok: true,
            cuenta: cuentaCreada ? { creada: true, codigo: codigoAcceso } : { creada: false },
            pedidoMarketId,
            codigoRecogida
        });
    } catch (error) {
        console.warn("Error recibiendo pedido de carrito publico:", error.message);
        res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
    }
}

// Modal del carrito (mismo esqueleto que el resto de modales
// personalizados del proyecto: crear/reusar por id, cerrar con
// Escape/backdrop). Markup identico para cualquier negocio -- el
// contenido real se pinta despues via JS con textContent.
function modalCarritoTenantHtml() {
    return `
<div id="tenantCarritoOverlay" class="tenant-carrito-overlay" style="display:none;">
<div class="tenant-carrito-modal">
<div class="tenant-carrito-modal-header">
<h2>Tu carrito</h2>
<button type="button" id="tenantCarritoCerrarBoton" aria-label="Cerrar">&times;</button>
</div>
<div id="tenantCarritoListaVacia" class="tenant-portal-vacio">Todavia no agregas productos.</div>
<table class="tenant-portal-tabla" id="tenantCarritoTabla" style="display:none;">
<thead><tr><th>Producto</th><th>Cantidad</th><th></th></tr></thead>
<tbody id="tenantCarritoItems"></tbody>
</table>
<form id="tenantCarritoForm" style="display:none;">
<div class="tenant-pedido-honeypot" aria-hidden="true"><label>No llenar<input type="text" id="tenantCarritoHoneypot" tabindex="-1" autocomplete="off"></label></div>
<label>Tu nombre<input type="text" id="tenantCarritoNombre" maxlength="140" required></label>
<label>Telefono<input type="text" id="tenantCarritoTelefono" maxlength="40" placeholder="10 digitos"></label>
<label>Correo (opcional)<input type="text" id="tenantCarritoCorreo" maxlength="140"></label>
<label>Mensaje (opcional)<textarea id="tenantCarritoMensaje" maxlength="500"></textarea></label>
<p id="tenantCarritoAviso" style="color:#e2434d; font-size:13px; margin:0;"></p>
<div class="tenant-carrito-botones">
<button type="submit" data-tipo="pedido">Enviar pedido</button>
<button type="submit" class="tenant-btn-cotizacion" data-tipo="cotizacion">Solicitar cotizacion</button>
</div>
</form>
<div id="tenantCarritoExito" style="display:none;"></div>
</div>
</div>`;
}

// Script del carrito (Fase 7) -- estado en localStorage
// (nexoCarrito_{slug}, namespaced por si varios negocios comparten
// navegador, mismo criterio que el token del portal de cliente).
// Todo dato del servidor se pinta con textContent, nunca innerHTML
// con el valor crudo.
function scriptCarritoTenantHtml(slug, basePath = "") {
    return `
const CARRITO_CLAVE = "nexoCarrito_${slug}";

function carritoElemento(id){ return document.getElementById(id); }

function carritoLeer(){
    try {
        const datos = JSON.parse(localStorage.getItem(CARRITO_CLAVE) || "[]");
        return Array.isArray(datos) ? datos : [];
    } catch (error) { return []; }
}

function carritoGuardar(items){
    localStorage.setItem(CARRITO_CLAVE, JSON.stringify(items));
    carritoActualizarBadge();
}

function carritoActualizarBadge(){
    const badge = carritoElemento("carritoContador");
    if (!badge) return;
    const total = carritoLeer().reduce(function(suma, item){ return suma + (Number(item.cantidad) || 0); }, 0);
    badge.textContent = String(total);
}

function carritoAgregar(codigo, nombre){
    const items = carritoLeer();
    const existente = items.find(function(item){ return item.codigo === codigo; });
    if (existente) {
        existente.cantidad = (Number(existente.cantidad) || 0) + 1;
    } else {
        items.push({ codigo: codigo, nombre: nombre, cantidad: 1 });
    }
    carritoGuardar(items);
}

function carritoQuitar(codigo){
    carritoGuardar(carritoLeer().filter(function(item){ return item.codigo !== codigo; }));
    carritoPintar();
}

function carritoCambiarCantidad(codigo, cantidad){
    const items = carritoLeer();
    const item = items.find(function(item){ return item.codigo === codigo; });
    if (!item) return;
    item.cantidad = Math.min(9999, Math.max(1, parseInt(cantidad, 10) || 1));
    carritoGuardar(items);
}

function carritoPintar(){
    const items = carritoLeer();
    const vacio = carritoElemento("tenantCarritoListaVacia");
    const tabla = carritoElemento("tenantCarritoTabla");
    const form = carritoElemento("tenantCarritoForm");
    const cuerpo = carritoElemento("tenantCarritoItems");
    carritoElemento("tenantCarritoExito").style.display = "none";

    if (items.length === 0) {
        vacio.style.display = "";
        tabla.style.display = "none";
        form.style.display = "none";
        return;
    }

    vacio.style.display = "none";
    tabla.style.display = "";
    form.style.display = "grid";

    cuerpo.innerHTML = "";
    items.forEach(function(item){
        const fila = document.createElement("tr");

        const celdaNombre = document.createElement("td");
        celdaNombre.textContent = item.nombre || item.codigo;

        const celdaCantidad = document.createElement("td");
        const inputCantidad = document.createElement("input");
        inputCantidad.type = "number";
        inputCantidad.min = "1";
        inputCantidad.value = item.cantidad;
        inputCantidad.style.width = "64px";
        inputCantidad.addEventListener("change", function(){ carritoCambiarCantidad(item.codigo, inputCantidad.value); });
        celdaCantidad.appendChild(inputCantidad);

        const celdaQuitar = document.createElement("td");
        const botonQuitar = document.createElement("button");
        botonQuitar.type = "button";
        botonQuitar.textContent = "Quitar";
        botonQuitar.addEventListener("click", function(){ carritoQuitar(item.codigo); });
        celdaQuitar.appendChild(botonQuitar);

        fila.appendChild(celdaNombre);
        fila.appendChild(celdaCantidad);
        fila.appendChild(celdaQuitar);
        cuerpo.appendChild(fila);
    });
}

function carritoAbrir(){
    carritoPintar();
    carritoElemento("tenantCarritoOverlay").style.display = "flex";
}

function carritoCerrar(){
    carritoElemento("tenantCarritoOverlay").style.display = "none";
}

async function carritoEnviar(evento){
    evento.preventDefault();
    const aviso = carritoElemento("tenantCarritoAviso");
    aviso.textContent = "";

    const tipo = evento.submitter && evento.submitter.dataset && evento.submitter.dataset.tipo === "cotizacion" ? "cotizacion" : "pedido";

    const body = {
        items: carritoLeer().map(function(item){ return { codigo: item.codigo, cantidad: item.cantidad }; }),
        clienteNombre: carritoElemento("tenantCarritoNombre").value.trim(),
        clienteTelefono: carritoElemento("tenantCarritoTelefono").value.trim(),
        clienteCorreo: carritoElemento("tenantCarritoCorreo").value.trim(),
        mensaje: carritoElemento("tenantCarritoMensaje").value.trim(),
        sitioExtra: carritoElemento("tenantCarritoHoneypot").value,
        tipo: tipo
    };

    try {
        const respuesta = await fetch("${basePath}/catalogo/pedido-carrito", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            aviso.textContent = datos.error || "No se pudo enviar el pedido.";
            return;
        }

        carritoGuardar([]);
        carritoElemento("tenantCarritoTabla").style.display = "none";
        carritoElemento("tenantCarritoForm").style.display = "none";
        carritoElemento("tenantCarritoListaVacia").style.display = "none";

        const exito = carritoElemento("tenantCarritoExito");
        exito.innerHTML = "";
        const mensajeExito = document.createElement("p");
        mensajeExito.textContent = tipo === "cotizacion"
            ? "Listo -- tu solicitud de cotizacion fue enviada. El negocio te va a contactar con un precio."
            : "Listo -- tu pedido fue enviado. El negocio te contactara pronto.";
        exito.appendChild(mensajeExito);

        if (datos.cuenta && datos.cuenta.creada) {
            const cajaCodigo = document.createElement("div");
            cajaCodigo.className = "tenant-portal-saldo";
            const titulo = document.createElement("p");
            titulo.textContent = "Guarda este codigo -- no se vuelve a mostrar:";
            const codigo = document.createElement("div");
            codigo.className = "tenant-portal-saldo-monto";
            codigo.textContent = datos.cuenta.codigo;
            const ayuda = document.createElement("p");
            ayuda.style.fontSize = "13px";
            ayuda.textContent = "Con tu telefono y este codigo puedes entrar a 'Mi cuenta' para ver tus pedidos despues.";
            cajaCodigo.appendChild(titulo);
            cajaCodigo.appendChild(codigo);
            cajaCodigo.appendChild(ayuda);
            exito.appendChild(cajaCodigo);
        } else {
            const avisoCuenta = document.createElement("p");
            avisoCuenta.style.fontSize = "13px";
            avisoCuenta.style.color = "var(--muted)";
            avisoCuenta.textContent = "Si ya tienes una cuenta con este telefono, entra a 'Mi cuenta' para ver tus pedidos.";
            exito.appendChild(avisoCuenta);
        }

        exito.style.display = "";
    } catch (error) {
        aviso.textContent = "No se pudo conectar. Intenta de nuevo.";
    }
}

document.addEventListener("click", function(evento){
    const boton = evento.target.closest(".tenant-btn-carrito");
    if (boton) {
        carritoAgregar(boton.getAttribute("data-codigo"), boton.getAttribute("data-nombre"));
        boton.textContent = "Agregado";
        setTimeout(function(){ boton.textContent = "Agregar al carrito"; }, 1200);
        return;
    }
    if (evento.target.id === "tenantCarritoAbrirBoton") { carritoAbrir(); return; }
    if (evento.target.id === "tenantCarritoCerrarBoton") { carritoCerrar(); return; }
    if (evento.target.id === "tenantCarritoOverlay") { carritoCerrar(); return; }
});

document.addEventListener("keydown", function(evento){
    if (evento.key === "Escape") carritoCerrar();
});

const formularioCarrito = document.getElementById("tenantCarritoForm");
if (formularioCarrito) formularioCarrito.addEventListener("submit", carritoEnviar);

carritoActualizarBadge();
`;
}

// Script de favoritos (Fase 11) -- mismo patron que el carrito
// (localStorage namespaced por slug, cada script inline con su propio
// document.addEventListener("click", ...), sin compartir el listener
// del carrito). Solo guarda codigos (string[]) en localStorage -- los
// datos frescos siempre se piden al servidor via favoritosJson. Todo
// dato que viene del servidor se pinta con createElement/textContent,
// nunca innerHTML con el valor crudo (mismo criterio que el resto del
// archivo).
function scriptFavoritosTenantHtml(slug) {
    return `
const FAVORITOS_CLAVE = "nexoFavoritos_${slug}";

function favoritosElemento(id){ return document.getElementById(id); }

function favoritosLeer(){
    try {
        const datos = JSON.parse(localStorage.getItem(FAVORITOS_CLAVE) || "[]");
        return Array.isArray(datos) ? datos : [];
    } catch (error) { return []; }
}

function favoritosGuardar(codigos){
    localStorage.setItem(FAVORITOS_CLAVE, JSON.stringify(codigos));
    favoritosActualizarBadge();
}

function favoritosActualizarBadge(){
    const badge = favoritosElemento("favoritosContador");
    if (!badge) return;
    badge.textContent = String(favoritosLeer().length);
}

function favoritosToggle(codigo){
    const codigos = favoritosLeer();
    const indice = codigos.indexOf(codigo);
    if (indice === -1) {
        codigos.push(codigo);
        favoritosGuardar(codigos);
        return true;
    }
    codigos.splice(indice, 1);
    favoritosGuardar(codigos);
    return false;
}

function favoritosMarcarBotones(){
    const guardados = favoritosLeer();
    document.querySelectorAll(".tenant-btn-favorito").forEach(function(boton){
        boton.classList.toggle("activo", guardados.indexOf(boton.getAttribute("data-codigo")) !== -1);
    });
}

function favoritosPrecioNodo(precio, precioOferta){
    const contenedor = document.createDocumentFragment();
    const normal = Number(precio);
    if (!isFinite(normal)) return contenedor;
    const oferta = Number(precioOferta);
    if (isFinite(oferta) && oferta > 0 && oferta < normal) {
        const tachado = document.createElement("span");
        tachado.className = "tenant-precio-tachado";
        tachado.textContent = "$" + normal.toFixed(2);
        const ofertaSpan = document.createElement("span");
        ofertaSpan.className = "tenant-precio-oferta";
        ofertaSpan.textContent = "$" + oferta.toFixed(2);
        const badge = document.createElement("span");
        badge.className = "tenant-badge-oferta";
        badge.textContent = "Oferta";
        contenedor.appendChild(tachado);
        contenedor.appendChild(ofertaSpan);
        contenedor.appendChild(badge);
    } else {
        const precioSpan = document.createElement("span");
        precioSpan.className = "tenant-producto-precio";
        precioSpan.textContent = "$" + normal.toFixed(2);
        contenedor.appendChild(precioSpan);
    }
    return contenedor;
}

function favoritosCrearTarjeta(producto){
    const card = document.createElement("div");
    card.className = "tenant-producto-card";

    const botonFav = document.createElement("button");
    botonFav.type = "button";
    botonFav.className = "tenant-btn-favorito activo";
    botonFav.setAttribute("data-codigo", producto.codigo);
    botonFav.setAttribute("aria-label", "Quitar de favoritos");
    botonFav.innerHTML = ${JSON.stringify(ICONO_TENANT_FAVORITO)};
    card.appendChild(botonFav);

    const enlace = document.createElement("a");
    enlace.href = "/catalogo/" + encodeURIComponent(producto.codigo);

    const foto = document.createElement("div");
    foto.className = "tenant-producto-foto";
    if (producto.fotoUrl) {
        const img = document.createElement("img");
        img.src = producto.fotoUrl;
        img.alt = producto.nombre || "";
        foto.appendChild(img);
    } else {
        const vacio = document.createElement("span");
        vacio.className = "tenant-producto-foto-vacia";
        vacio.textContent = "Sin foto";
        foto.appendChild(vacio);
    }
    enlace.appendChild(foto);

    const info = document.createElement("div");
    info.className = "tenant-producto-info";

    const nombreSpan = document.createElement("span");
    nombreSpan.className = "tenant-producto-nombre";
    nombreSpan.textContent = producto.nombre;
    info.appendChild(nombreSpan);

    if (producto.precio !== null && producto.precio !== undefined) {
        info.appendChild(favoritosPrecioNodo(producto.precio, producto.precioOferta));
    }

    const existencia = document.createElement("span");
    if (producto.stock !== null && producto.stock !== undefined) {
        existencia.className = "tenant-producto-existencia" + (producto.stock <= 0 ? " agotado" : "");
        existencia.textContent = producto.stock <= 0 ? "Agotado" : (producto.stock + " disponibles");
    } else {
        existencia.className = "tenant-producto-existencia bajo-pedido";
        existencia.textContent = "Bajo pedido -- confirma con la tienda";
    }
    info.appendChild(existencia);

    enlace.appendChild(info);
    card.appendChild(enlace);

    const botonCarrito = document.createElement("button");
    botonCarrito.type = "button";
    botonCarrito.className = "tenant-btn-carrito";
    botonCarrito.setAttribute("data-codigo", producto.codigo);
    botonCarrito.setAttribute("data-nombre", producto.nombre || "");
    botonCarrito.textContent = "Agregar al carrito";
    card.appendChild(botonCarrito);

    return card;
}

function favoritosPintarVacio(contenedor){
    contenedor.innerHTML = "";
    const vacio = document.createElement("p");
    vacio.className = "tenant-favoritos-vacio";
    vacio.textContent = "Todavia no tienes favoritos.";
    const link = document.createElement("a");
    link.href = "/catalogo";
    link.textContent = "Ver catalogo";
    contenedor.appendChild(vacio);
    contenedor.appendChild(link);
}

async function favoritosCargarLista(){
    const contenedor = favoritosElemento("favoritosLista");
    if (!contenedor) return;

    const codigos = favoritosLeer();
    if (codigos.length === 0) {
        favoritosPintarVacio(contenedor);
        return;
    }

    try {
        const respuesta = await fetch("/catalogo/favoritos-json?codigos=" + encodeURIComponent(codigos.join(",")));
        const datos = await respuesta.json();

        if (!datos.ok) {
            contenedor.textContent = "No se pudieron cargar tus favoritos.";
            return;
        }

        const productos = datos.productos || [];

        // Auto-limpieza: un codigo guardado que ya no regreso (producto
        // borrado) se quita de localStorage, nunca se muestra roto.
        if (productos.length !== codigos.length) {
            favoritosGuardar(productos.map(function(p){ return p.codigo; }));
        }

        if (productos.length === 0) {
            favoritosPintarVacio(contenedor);
            return;
        }

        const grid = document.createElement("div");
        grid.className = "tenant-catalogo-grid";
        productos.forEach(function(producto){ grid.appendChild(favoritosCrearTarjeta(producto)); });
        contenedor.innerHTML = "";
        contenedor.appendChild(grid);
    } catch (error) {
        contenedor.textContent = "No se pudieron cargar tus favoritos. Revisa tu conexion.";
    }
}

document.addEventListener("click", function(evento){
    const boton = evento.target.closest(".tenant-btn-favorito");
    if (!boton) return;

    const codigo = boton.getAttribute("data-codigo");
    const agregado = favoritosToggle(codigo);
    boton.classList.toggle("activo", agregado);

    if (!agregado) {
        const enPaginaFavoritos = favoritosElemento("favoritosLista");
        if (enPaginaFavoritos) {
            const tarjeta = boton.closest(".tenant-producto-card");
            if (tarjeta) {
                tarjeta.style.transition = "opacity .2s ease";
                tarjeta.style.opacity = "0";
                setTimeout(function(){
                    tarjeta.remove();
                    if (favoritosLeer().length === 0) favoritosPintarVacio(enPaginaFavoritos);
                }, 200);
            }
        }
    }
});

favoritosMarcarBotones();
favoritosActualizarBadge();
favoritosCargarLista();
`;
}

// Script de comparador (Fase 12) -- mismo molde que favoritos
// (localStorage namespaced por slug, su propio
// document.addEventListener("click", ...), sin compartir listener con
// carrito ni favoritos). Solo guarda codigos (string[], tope 4) --
// los datos frescos siempre se piden a comparadorJson.
function scriptComparadorTenantHtml(slug) {
    return `
const COMPARADOR_CLAVE = "nexoComparador_${slug}";
const COMPARADOR_MAXIMO = 4;

function comparadorElemento(id){ return document.getElementById(id); }

function comparadorLeer(){
    try {
        const datos = JSON.parse(localStorage.getItem(COMPARADOR_CLAVE) || "[]");
        return Array.isArray(datos) ? datos : [];
    } catch (error) { return []; }
}

function comparadorGuardar(codigos){
    localStorage.setItem(COMPARADOR_CLAVE, JSON.stringify(codigos));
    comparadorActualizarBadge();
}

function comparadorActualizarBadge(){
    const badge = comparadorElemento("comparadorContador");
    if (!badge) return;
    badge.textContent = String(comparadorLeer().length);
}

function comparadorToggle(codigo){
    const codigos = comparadorLeer();
    const indice = codigos.indexOf(codigo);
    if (indice !== -1) {
        codigos.splice(indice, 1);
        comparadorGuardar(codigos);
        return false;
    }
    if (codigos.length >= COMPARADOR_MAXIMO) {
        alert("Puedes comparar hasta " + COMPARADOR_MAXIMO + " productos a la vez.");
        return false;
    }
    codigos.push(codigo);
    comparadorGuardar(codigos);
    return true;
}

function comparadorMarcarBotones(){
    const guardados = comparadorLeer();
    document.querySelectorAll(".tenant-btn-comparar").forEach(function(boton){
        boton.classList.toggle("activo", guardados.indexOf(boton.getAttribute("data-codigo")) !== -1);
    });
}

function comparadorPrecioNodo(precio, precioOferta){
    const contenedor = document.createDocumentFragment();
    const normal = Number(precio);
    if (!isFinite(normal)) return contenedor;
    const oferta = Number(precioOferta);
    if (isFinite(oferta) && oferta > 0 && oferta < normal) {
        const tachado = document.createElement("span");
        tachado.className = "tenant-precio-tachado";
        tachado.textContent = "$" + normal.toFixed(2);
        const ofertaSpan = document.createElement("span");
        ofertaSpan.className = "tenant-precio-oferta";
        ofertaSpan.textContent = "$" + oferta.toFixed(2);
        contenedor.appendChild(tachado);
        contenedor.appendChild(ofertaSpan);
    } else {
        const precioSpan = document.createElement("span");
        precioSpan.className = "tenant-producto-precio";
        precioSpan.textContent = "$" + normal.toFixed(2);
        contenedor.appendChild(precioSpan);
    }
    return contenedor;
}

function comparadorAtributoFila(etiqueta, valor){
    const fila = document.createElement("div");
    fila.className = "tenant-comparador-atributo";
    const etiquetaSpan = document.createElement("span");
    etiquetaSpan.className = "tenant-comparador-atributo-etiqueta";
    etiquetaSpan.textContent = etiqueta;
    const valorSpan = document.createElement("span");
    valorSpan.textContent = valor;
    fila.appendChild(etiquetaSpan);
    fila.appendChild(valorSpan);
    return fila;
}

function comparadorCrearColumna(producto){
    const columna = document.createElement("div");
    columna.className = "tenant-comparador-columna";

    const foto = document.createElement("div");
    foto.className = "tenant-producto-foto";
    if (producto.fotoUrl) {
        const img = document.createElement("img");
        img.src = producto.fotoUrl;
        img.alt = producto.nombre || "";
        foto.appendChild(img);
    } else {
        const vacio = document.createElement("span");
        vacio.className = "tenant-producto-foto-vacia";
        vacio.textContent = "Sin foto";
        foto.appendChild(vacio);
    }
    columna.appendChild(foto);

    const nombreSpan = document.createElement("span");
    nombreSpan.className = "tenant-producto-nombre";
    nombreSpan.textContent = producto.nombre;
    columna.appendChild(nombreSpan);

    if (producto.precio !== null && producto.precio !== undefined) {
        columna.appendChild(comparadorPrecioNodo(producto.precio, producto.precioOferta));
    }

    const existencia = document.createElement("span");
    if (producto.stock !== null && producto.stock !== undefined) {
        existencia.className = "tenant-producto-existencia" + (producto.stock <= 0 ? " agotado" : "");
        existencia.textContent = producto.stock <= 0 ? "Agotado" : (producto.stock + " disponibles");
    } else {
        existencia.className = "tenant-producto-existencia bajo-pedido";
        existencia.textContent = "Bajo pedido -- confirma con la tienda";
    }
    columna.appendChild(existencia);

    const atributos = document.createElement("div");
    atributos.className = "tenant-comparador-atributos";
    atributos.appendChild(comparadorAtributoFila("Categoria", producto.categoria || "Sin categoria"));
    atributos.appendChild(comparadorAtributoFila("Marca", producto.marca || "Sin marca"));
    atributos.appendChild(comparadorAtributoFila("Unidad", producto.unidadVenta || "Pieza"));
    atributos.appendChild(comparadorAtributoFila("Garantia", producto.tieneGarantia ? (producto.garantiaDetalle || "Si") : "Sin garantia"));
    columna.appendChild(atributos);

    const botonCarrito = document.createElement("button");
    botonCarrito.type = "button";
    botonCarrito.className = "tenant-btn-carrito";
    botonCarrito.setAttribute("data-codigo", producto.codigo);
    botonCarrito.setAttribute("data-nombre", producto.nombre || "");
    botonCarrito.textContent = "Agregar al carrito";
    columna.appendChild(botonCarrito);

    const botonQuitar = document.createElement("button");
    botonQuitar.type = "button";
    botonQuitar.className = "tenant-btn-comparar tenant-btn-comparar-linea activo";
    botonQuitar.setAttribute("data-codigo", producto.codigo);
    botonQuitar.setAttribute("aria-label", "Quitar de comparar");
    botonQuitar.textContent = "Quitar";
    columna.appendChild(botonQuitar);

    return columna;
}

function comparadorPintarInsuficiente(contenedor){
    contenedor.innerHTML = "";
    const vacio = document.createElement("p");
    vacio.className = "tenant-comparador-vacio";
    vacio.textContent = "Selecciona al menos 2 productos para comparar.";
    const link = document.createElement("a");
    link.href = "/catalogo";
    link.textContent = "Ver catalogo";
    contenedor.appendChild(vacio);
    contenedor.appendChild(link);
}

async function comparadorCargarTabla(){
    const contenedor = comparadorElemento("comparadorTabla");
    if (!contenedor) return;

    const codigos = comparadorLeer();
    if (codigos.length < 2) {
        comparadorPintarInsuficiente(contenedor);
        return;
    }

    try {
        const respuesta = await fetch("/catalogo/comparador-json?codigos=" + encodeURIComponent(codigos.join(",")));
        const datos = await respuesta.json();

        if (!datos.ok) {
            contenedor.textContent = "No se pudo cargar la comparacion.";
            return;
        }

        const productos = datos.productos || [];

        // Auto-limpieza: un codigo guardado que ya no regreso (producto
        // borrado) se quita de localStorage, mismo criterio de Fase 11.
        if (productos.length !== codigos.length) {
            comparadorGuardar(productos.map(function(p){ return p.codigo; }));
        }

        if (productos.length < 2) {
            comparadorPintarInsuficiente(contenedor);
            return;
        }

        const tabla = document.createElement("div");
        tabla.className = "tenant-comparador-tabla";
        productos.forEach(function(producto){ tabla.appendChild(comparadorCrearColumna(producto)); });
        contenedor.innerHTML = "";
        contenedor.appendChild(tabla);
    } catch (error) {
        contenedor.textContent = "No se pudo cargar la comparacion. Revisa tu conexion.";
    }
}

document.addEventListener("click", function(evento){
    const boton = evento.target.closest(".tenant-btn-comparar");
    if (!boton) return;

    const codigo = boton.getAttribute("data-codigo");
    const agregado = comparadorToggle(codigo);
    boton.classList.toggle("activo", agregado);

    if (!agregado) {
        const enPaginaComparador = comparadorElemento("comparadorTabla");
        if (enPaginaComparador) {
            const columna = boton.closest(".tenant-comparador-columna");
            if (columna) {
                columna.style.transition = "opacity .2s ease";
                columna.style.opacity = "0";
                setTimeout(function(){
                    columna.remove();
                    if (comparadorLeer().length < 2) comparadorPintarInsuficiente(enPaginaComparador);
                }, 200);
            }
        }
    }
});

comparadorMarcarBotones();
comparadorActualizarBadge();
comparadorCargarTabla();
`;
}

async function servirSolicitudCreditoNegocio(pool, req, res, slug) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio || !sitio.config.aceptarSolicitudesCredito) {
            res.status(404).send("No encontrado");
            return;
        }

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);

        const estadoSolicitud = paramTexto(req.query.estado, 20);
        const bannerHtml = estadoSolicitud === "enviado"
            ? `<div class="tenant-pedido-banner exito">Listo -- tu solicitud fue enviada. El negocio te contactara pronto.</div>`
            : estadoSolicitud === "error"
                ? `<div class="tenant-pedido-banner error">No pudimos enviar tu solicitud. Revisa tus datos e intenta de nuevo.</div>`
                : "";

        const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solicitar credito -- ${nombre}</title>
<meta name="description" content="Solicita credito en ${nombre}.">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
</head>
<body>
${encabezadoTenantHtml(sitio.negocio, "credito", true)}
<main class="tenant-main tenant-main-angosto">
<h1 class="tenant-catalogo-titulo">Solicitar credito</h1>
<p>Llena tus datos y, si quieres agilizar la revision, adjunta tu identificacion oficial. El negocio revisa tu solicitud y te contacta.</p>
${bannerHtml}
<form class="tenant-pedido-form" method="POST" action="/solicitud-credito" enctype="multipart/form-data">
<div class="tenant-pedido-honeypot" aria-hidden="true"><label>No llenar<input type="text" name="sitioExtra" tabindex="-1" autocomplete="off"></label></div>
<label>Nombre completo<input type="text" name="nombre" maxlength="140" required></label>
<label>Telefono<input type="text" name="telefono" maxlength="40" placeholder="10 digitos"></label>
<label>Correo (opcional)<input type="text" name="correo" maxlength="140"></label>
<label>Direccion (opcional)<input type="text" name="direccion" maxlength="300"></label>
<label>Monto de credito que solicitas (opcional)<input type="number" name="montoSolicitado" min="0" step="0.01"></label>
<label>Comentario (opcional)<textarea name="comentario" maxlength="500"></textarea></label>
<label>Identificacion oficial -- frente (opcional)<input type="file" name="ineFrente" accept="image/*"></label>
<label>Identificacion oficial -- reverso (opcional)<input type="file" name="ineReverso" accept="image/*"></label>
<label class="tenant-consentimiento"><input type="checkbox" name="consentimiento"> Acepto que mi identificacion oficial, si la adjunto, sea tratada conforme al <a href="/privacidad" target="_blank" rel="noopener">aviso de privacidad</a>.</label>
<button type="submit">Enviar solicitud</button>
</form>
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo</footer>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo solicitud de credito:", error.message);
        res.status(500).send("Error");
    }
}

// Recibe el formulario publico "Solicitar credito" -- mismo criterio
// que recibirPedidoPublico (honeypot, limitador de IP, redirect con
// ?estado=enviado|error, nunca JSON). Las fotos de INE llegan por
// multer (multipart/form-data, ver server.js) en req.files, nunca en
// req.body -- son opcionales, y si vienen exigen el checkbox de
// consentimiento marcado.
async function recibirSolicitudCreditoPublica(pool, req, res, slug) {
    const volverConError = () => res.redirect(303, `/solicitud-credito?estado=error`);

    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio || !sitio.config.aceptarSolicitudesCredito) {
            res.status(404).send("No encontrado");
            return;
        }

        if (paramTexto(req.body?.sitioExtra, 200)) {
            volverConError();
            return;
        }

        if (limitadorSolicitudCredito.bloqueado(req.ip)) {
            volverConError();
            return;
        }

        limitadorSolicitudCredito.registrarFallo(req.ip);

        const nombre = paramTexto(req.body?.nombre, 140);
        const telefono = paramTexto(req.body?.telefono, 40);
        const correo = paramTexto(req.body?.correo, 140).toLowerCase();
        const direccion = paramTexto(req.body?.direccion, 300);
        const comentario = paramTexto(req.body?.comentario, 500);
        const montoSolicitadoTexto = paramTexto(req.body?.montoSolicitado, 20);
        const montoSolicitado = montoSolicitadoTexto ? Math.max(0, Number(montoSolicitadoTexto) || 0) : null;

        if (!nombre) {
            volverConError();
            return;
        }

        if (!telefono && !correo) {
            volverConError();
            return;
        }

        if (correo && !REGEX_CORREO.test(correo)) {
            volverConError();
            return;
        }

        const archivoFrente = req.files?.ineFrente?.[0];
        const archivoReverso = req.files?.ineReverso?.[0];
        const tieneDocumentos = Boolean(archivoFrente || archivoReverso);
        const consentimiento = req.body?.consentimiento === "on";

        if (tieneDocumentos && !consentimiento) {
            volverConError();
            return;
        }

        let ineFrenteBuffer = null;
        let ineReversoBuffer = null;

        try {
            if (archivoFrente) ineFrenteBuffer = await comprimirImagenIdentificacion(archivoFrente.buffer);
            if (archivoReverso) ineReversoBuffer = await comprimirImagenIdentificacion(archivoReverso.buffer);
        } catch (error) {
            volverConError();
            return;
        }

        await pool.query(
            `
            INSERT INTO public.solicitudes_credito
                (negocio_id, nombre, telefono, correo, direccion, monto_solicitado, comentario, ine_frente, ine_reverso, consentimiento_datos_sensibles, ip)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `,
            [sitio.negocio.id, nombre, telefono, correo, direccion, montoSolicitado, comentario, ineFrenteBuffer, ineReversoBuffer, tieneDocumentos && consentimiento, req.ip]
        );

        if (sitio.negocio.correo) {
            enviarCorreoSolicitudCreditoPublica(sitio.negocio.correo, sitio.negocio.nombre, {
                clienteNombre: nombre,
                clienteTelefono: telefono,
                clienteCorreo: correo,
                direccion,
                montoSolicitado,
                comentario,
                tieneDocumentos
            }).catch(error => console.warn("No se pudo enviar el aviso de solicitud de credito:", error.message));
        }

        res.redirect(303, `/solicitud-credito?estado=enviado`);
    } catch (error) {
        console.warn("Error recibiendo solicitud de credito:", error.message);
        volverConError();
    }
}

// Portal de cliente final (Fase 6 del sitio web por negocio). A
// diferencia de los formularios de Fase 3/4 (HTML puro, sin JS), esta
// pagina si necesita JavaScript porque tiene que persistir una sesion
// entre visitas (localStorage) -- mismo criterio ya usado en /dueno
// para la sesion del propio dueno, aplicado aqui al cliente final.
// Iconos del menu lateral del portal de cliente -- mismo estilo
// feather (stroke, 24x24) que ICONO_TENANT_FAVORITO/COMPARAR arriba.
const ICONO_PORTAL_RESUMEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>`;
const ICONO_PORTAL_PEDIDOS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;
const ICONO_PORTAL_CREDITO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`;
const ICONO_PORTAL_DIRECCION = ICONO_TENANT_PIN;
const ICONO_PORTAL_PAGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path></svg>`;
const ICONO_PORTAL_FACTURA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
const ICONO_PORTAL_DEVOLUCION = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;
const ICONO_PORTAL_NOTIFICACION = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;
const ICONO_PORTAL_USUARIO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
const ICONO_PORTAL_SEGURIDAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path></svg>`;
const ICONO_PORTAL_AYUDA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
const ICONO_PORTAL_SALIR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`;
const ICONO_PORTAL_TIENDA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"></path><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"></path><path d="M4 9v10h16V9"></path></svg>`;

// Rediseno "Mi cuenta" (portal de cliente) estilo marketplace: menu
// lateral fijo + tarjetas de resumen/credito/pedidos. Bloque de estilo
// aparte (no dentro de estilosBaseTenant) porque estas clases solo las
// usa esta pagina -- no engordar el CSS de catalogo/inicio/detalle con
// reglas que nunca van a usar.
function estilosPortalClienteHtml() {
    return `
.portal-shell{ display:grid; grid-template-columns:236px 1fr; gap:28px; align-items:start; }
.portal-sidebar{ position:sticky; top:88px; display:flex; flex-direction:column; gap:2px; padding:16px 12px; border-radius:20px; background:var(--glass); border:1px solid var(--line); }
.portal-sidebar-titulo{ margin:14px 10px 6px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.portal-sidebar-titulo:first-child{ margin-top:2px; }
.portal-sidebar a, .portal-sidebar-proximamente{ display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; font-size:13.5px; font-weight:600; color:var(--ink); }
.portal-sidebar a svg, .portal-sidebar-proximamente svg{ width:17px; height:17px; flex-shrink:0; color:var(--muted); }
.portal-sidebar a:hover{ background:rgba(16,103,232,.08); }
.portal-sidebar a.activo{ background:var(--blue); color:#fff; }
.portal-sidebar a.activo svg{ color:#fff; }
.portal-sidebar-proximamente{ color:var(--muted); cursor:default; opacity:.62; }
.portal-sidebar-proximamente span.etiqueta{ margin-left:auto; padding:2px 7px; border-radius:999px; background:var(--paper); font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; }
.portal-sidebar-salir{ margin-top:10px; padding-top:12px; border-top:1px solid var(--line); }
.portal-sidebar-salir button{ width:100%; display:flex; align-items:center; gap:10px; padding:10px 12px; border:none; background:transparent; border-radius:12px; font-size:13.5px; font-weight:700; color:#e2434d; cursor:pointer; text-align:left; }
.portal-sidebar-salir button:hover{ background:rgba(226,67,77,.08); }
.portal-header-card{ display:flex; flex-wrap:wrap; gap:20px; justify-content:space-between; padding:26px 28px; border-radius:24px; background:linear-gradient(135deg, var(--ink), #1c2c47); color:#fff; box-shadow:var(--shadow); }
.portal-header-saludo{ font-size:23px; margin:0 0 6px; }
.portal-header-badge{ display:inline-block; padding:4px 12px; border-radius:999px; background:rgba(255,255,255,.14); font-size:12px; font-weight:700; }
.portal-header-negocio{ display:grid; gap:10px; min-width:220px; align-content:start; }
.portal-header-negocio-eyebrow{ font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:rgba(255,255,255,.62); font-weight:700; }
.portal-header-negocio-nombre{ font-size:17px; font-weight:800; }
.portal-header-negocio-fila{ display:flex; justify-content:space-between; gap:16px; font-size:12px; color:rgba(255,255,255,.72); }
.portal-header-negocio-fila strong{ color:#fff; font-weight:700; }
.portal-header-cambiar{ padding:9px 16px; border-radius:999px; border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.1); color:#fff; font-weight:700; font-size:12.5px; cursor:pointer; align-self:start; }
.portal-header-cambiar-lista{ display:none; position:absolute; margin-top:44px; z-index:10; min-width:220px; padding:8px; border-radius:14px; background:#fff; box-shadow:0 20px 44px rgba(20,32,51,.22); }
.portal-header-cambiar-lista.abierta{ display:block; }
.portal-header-cambiar-lista a{ display:block; padding:9px 12px; border-radius:10px; font-size:13px; font-weight:600; color:var(--ink); }
.portal-header-cambiar-lista a:hover{ background:var(--paper); }
.portal-header-cambiar-lista a.actual{ color:var(--blue); font-weight:800; }
.portal-stats-grid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin:20px 0; }
.portal-stat-card{ padding:18px; border-radius:18px; background:var(--glass); border:1px solid var(--line); }
.portal-stat-card.proximamente{ opacity:.6; }
.portal-stat-card-titulo{ display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:var(--muted); margin-bottom:8px; }
.portal-stat-card-titulo svg{ width:15px; height:15px; }
.portal-stat-card-valor{ font-size:23px; font-weight:800; color:var(--ink); }
.portal-stat-card-sub{ font-size:11.5px; color:var(--muted); margin-top:2px; }
.portal-stat-card-sub a{ color:var(--blue); font-weight:700; }
.portal-grid-2{ display:grid; grid-template-columns:1.3fr 1fr; gap:20px; align-items:start; margin:32px 0; }
.portal-card{ padding:22px 24px; border-radius:22px; background:var(--glass); border:1px solid var(--line); box-shadow:0 10px 24px rgba(20,32,51,.05); }
.portal-card-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.portal-card-header h2{ margin:0; font-size:16.5px; }
.portal-card-header a{ font-size:12.5px; font-weight:700; color:var(--blue); }
.portal-pedido-fila{ display:flex; align-items:center; gap:14px; padding:12px 0; border-top:1px solid var(--line); }
.portal-pedido-fila:first-child{ border-top:none; padding-top:0; }
.portal-pedido-icono{ width:40px; height:40px; flex-shrink:0; border-radius:12px; background:var(--paper); display:flex; align-items:center; justify-content:center; color:var(--blue); }
.portal-pedido-icono svg{ width:18px; height:18px; }
.portal-pedido-info{ flex:1; min-width:0; }
.portal-pedido-nombre{ font-size:13.5px; font-weight:700; color:var(--ink); }
.portal-pedido-fecha{ font-size:11.5px; color:var(--muted); margin-top:2px; }
.portal-pedido-precio{ font-size:13px; font-weight:700; color:var(--ink); white-space:nowrap; text-align:right; }
.portal-credito-gauge-wrap{ display:flex; align-items:center; gap:18px; }
.portal-credito-gauge{ position:relative; width:104px; height:104px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
.portal-credito-gauge::before{ content:""; position:absolute; inset:11px; border-radius:50%; background:var(--paper); }
.portal-credito-gauge-texto{ position:relative; font-size:12px; font-weight:800; color:var(--ink); text-align:center; line-height:1.2; }
.portal-credito-lineas{ display:grid; gap:8px; flex:1; }
.portal-credito-linea{ display:flex; justify-content:space-between; font-size:12.5px; color:var(--muted); }
.portal-credito-linea strong{ color:var(--ink); font-weight:700; }
.portal-credito-estado{ display:inline-flex; align-items:center; gap:6px; margin-top:14px; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:700; background:rgba(24,184,143,.14); color:var(--mint); }
.portal-credito-estado.vencido{ background:rgba(226,67,77,.12); color:#e2434d; }
.portal-credito-acciones{ display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
.portal-credito-acciones a, .portal-credito-acciones button{ flex:1; min-width:130px; text-align:center; padding:10px 14px; border-radius:12px; font-size:12.5px; font-weight:700; cursor:pointer; }
.portal-credito-vacio{ color:var(--muted); font-size:13.5px; }
.portal-tiendas-lista{ display:grid; gap:10px; }
.portal-tienda-fila{ display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:14px; background:var(--paper); }
.portal-tienda-fila svg{ width:18px; height:18px; color:var(--blue); flex-shrink:0; }
.portal-tienda-fila strong{ font-size:13px; }
.portal-tienda-actual{ border:1px solid rgba(16,103,232,.3); background:rgba(16,103,232,.06); }
.portal-tienda-fila a{ margin-left:auto; font-size:12px; font-weight:700; color:var(--blue); }
.portal-accesos-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
.portal-acceso-tile{ display:flex; flex-direction:column; gap:8px; padding:16px; border-radius:16px; background:var(--glass); border:1px solid var(--line); font-size:12.5px; font-weight:700; color:var(--ink); }
.portal-acceso-tile svg{ width:20px; height:20px; color:var(--blue); }
.portal-acceso-tile.proximamente{ opacity:.55; }
.portal-acceso-tile.proximamente svg{ color:var(--muted); }
.portal-acceso-tile span.etiqueta{ align-self:start; padding:2px 8px; border-radius:999px; background:var(--paper); font-size:9.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); }
.portal-seguridad-card{ display:grid; gap:10px; font-size:13px; color:var(--muted); line-height:1.6; }
.portal-seguridad-card strong{ color:var(--ink); }
.portal-datos-fila{ display:flex; justify-content:space-between; padding:10px 0; border-top:1px solid var(--line); font-size:13px; }
.portal-datos-fila:first-child{ border-top:none; }
.portal-datos-fila span:first-child{ color:var(--muted); }
.portal-datos-fila span:last-child{ font-weight:700; color:var(--ink); }
@media (max-width:960px){
    .portal-shell{ grid-template-columns:1fr; }
    .portal-sidebar{ position:static; flex-direction:row; overflow-x:auto; gap:6px; padding:10px; }
    .portal-sidebar-titulo{ display:none; }
    .portal-sidebar a, .portal-sidebar-proximamente{ flex-shrink:0; white-space:nowrap; }
    .portal-sidebar-salir{ border-top:none; margin-top:0; padding-top:0; }
    .portal-grid-2{ grid-template-columns:1fr; }
    .portal-stats-grid{ grid-template-columns:repeat(2,minmax(0,1fr)); }
    .portal-header-card{ flex-direction:column; }
}
`;
}

// El script es identico para cualquier negocio (no interpola ningun
// dato del servidor dentro de si mismo); todo dato real llega despues
// via fetch() y se inserta siempre con textContent, nunca innerHTML
// con el valor crudo. Unica excepcion deliberada: lee `window.NEXO_PORTAL`
// (slug/nombre/whatsapp del negocio -- configuracion publica del sitio,
// nunca dato de un cliente), que servirPortalClienteNegocio() define en
// un <script> aparte, chico y sin logica, antes de cargar este bloque.
function scriptPortalClienteHtml() {
    return `
const CLAVE_TOKEN = "nexoPortalClienteToken";

function elemento(id){ return document.getElementById(id); }

function escaparTexto(nodo, texto){ nodo.textContent = texto == null ? "" : String(texto); }

function dinero(valor){
    const numero = Number(valor) || 0;
    return "$" + numero.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso){
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("es-MX"); } catch (e) { return ""; }
}

async function iniciarSesionPortalCliente(evento){
    evento.preventDefault();
    const telefono = elemento("portalClienteTelefono").value.trim();
    const codigo = elemento("portalClienteCodigo").value.trim();
    const sitioExtra = elemento("portalClienteHoneypot").value;
    const aviso = elemento("portalClienteAviso");
    aviso.textContent = "";

    try {
        const respuesta = await fetch("/portal-cliente/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ telefono, codigo, sitioExtra })
        });
        const datos = await respuesta.json();
        if (!datos.ok) {
            aviso.textContent = datos.error || "Telefono o codigo incorrectos.";
            return;
        }
        localStorage.setItem(CLAVE_TOKEN, datos.token);
        mostrarPortalCliente();
    } catch (error) {
        aviso.textContent = "No se pudo conectar. Intenta de nuevo.";
    }
}

async function cerrarSesionPortalCliente(){
    const token = localStorage.getItem(CLAVE_TOKEN);
    if (token) {
        try {
            await fetch("/portal-cliente/logout", { method: "POST", headers: { "x-cliente-token": token } });
        } catch (error) { /* silencioso -- igual se limpia el token local */ }
    }
    localStorage.removeItem(CLAVE_TOKEN);
    mostrarFormularioLoginCliente();
}

function mostrarFormularioLoginCliente(){
    elemento("portalClienteLogin").style.display = "";
    elemento("portalClienteCuenta").style.display = "none";
}

const BADGE_PEDIDO = { pendiente: "Pendiente", atendido: "Atendido", descartado: "Descartado", cotizado: "Cotizado" };
const ICONO_PEDIDO_JS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>';

function pintarMovimientos(movimientos){
    const cuerpo = elemento("portalClienteMovimientos");
    cuerpo.innerHTML = "";
    if (!movimientos || movimientos.length === 0) {
        const fila = document.createElement("tr");
        const celda = document.createElement("td");
        celda.colSpan = 4;
        celda.className = "tenant-portal-vacio";
        celda.textContent = "Todavia no tienes movimientos.";
        fila.appendChild(celda);
        cuerpo.appendChild(fila);
        return;
    }
    movimientos.slice().reverse().forEach(function(mov){
        const fila = document.createElement("tr");
        const celdas = [fechaCorta(mov.fecha), mov.tipo === "venta" ? "Compra" : "Abono", mov.concepto || "", dinero(mov.monto)];
        celdas.forEach(function(texto){
            const celda = document.createElement("td");
            escaparTexto(celda, texto);
            fila.appendChild(celda);
        });
        cuerpo.appendChild(fila);
    });
}

// Un carrito (Fase 7) llega como varias filas que comparten grupo_id --
// se agrupan aqui para pintar una sola tarjeta por solicitud, no una
// por producto (mismo criterio ya usado del lado del POS en
// sitio-web-view.js). Regresa el arreglo de grupos para que quien
// llama tambien pueda usar el conteo real (tarjeta "Mis pedidos").
function agruparPedidos(pedidos){
    const gruposMap = new Map();
    (pedidos || []).forEach(function(pedido){
        const clave = pedido.grupo_id || ("solo-" + pedido.producto_nombre + pedido.created_at);
        if (!gruposMap.has(clave)) gruposMap.set(clave, []);
        gruposMap.get(clave).push(pedido);
    });
    return Array.from(gruposMap.values());
}

function pintarPedidos(pedidos){
    const contenedor = elemento("portalClientePedidosLista");
    contenedor.innerHTML = "";

    const grupos = agruparPedidos(pedidos);
    escaparTexto(elemento("portalStatPedidosValor"), String(grupos.length));
    const comprasHeader = elemento("portalHeaderComprasValor");
    if (comprasHeader) escaparTexto(comprasHeader, String(grupos.length));

    if (!grupos.length) {
        const vacio = document.createElement("p");
        vacio.className = "tenant-portal-vacio";
        vacio.textContent = "No has hecho pedidos en el sitio todavia.";
        contenedor.appendChild(vacio);
        return;
    }

    grupos.forEach(function(grupo){
        const principal = grupo[0];

        const fila = document.createElement("div");
        fila.className = "portal-pedido-fila";

        const icono = document.createElement("div");
        icono.className = "portal-pedido-icono";
        icono.innerHTML = ICONO_PEDIDO_JS;

        const info = document.createElement("div");
        info.className = "portal-pedido-info";

        const nombre = document.createElement("div");
        nombre.className = "portal-pedido-nombre";
        escaparTexto(nombre, grupo.map(function(p){ return p.producto_nombre + " x" + p.cantidad; }).join(", "));

        const fecha = document.createElement("div");
        fecha.className = "portal-pedido-fecha";
        fecha.textContent = fechaCorta(principal.created_at) + " -- ";
        const badge = document.createElement("span");
        badge.className = "tenant-portal-badge " + (principal.estado || "pendiente");
        badge.textContent = BADGE_PEDIDO[principal.estado] || principal.estado;
        fecha.appendChild(badge);

        info.appendChild(nombre);
        info.appendChild(fecha);

        const precio = document.createElement("div");
        precio.className = "portal-pedido-precio";
        if (principal.tipo === "cotizacion" && principal.estado === "cotizado") {
            escaparTexto(precio, dinero(principal.precio_cotizado));
        }

        fila.appendChild(icono);
        fila.appendChild(info);
        fila.appendChild(precio);
        contenedor.appendChild(fila);
    });
}

// Fecha de vencimiento real mas proxima entre las ventas pendientes que
// TODAVIA no vencen -- es el unico dato de "siguiente pago" que existe
// de verdad en el sistema (no hay concepto de pago minimo/mensualidad).
function proximoPagoReal(aging){
    if (!aging || !aging.ventasPendientes) return null;
    const ahora = Date.now();
    const futuras = aging.ventasPendientes.filter(function(v){
        return v.fechaVencimiento && new Date(v.fechaVencimiento).getTime() >= ahora;
    });
    if (!futuras.length) return null;
    futuras.sort(function(a, b){ return new Date(a.fechaVencimiento) - new Date(b.fechaVencimiento); });
    return futuras[0].fechaVencimiento;
}

function pintarCredito(cliente, aging){
    // Cuenta ligera (creada sola desde el carrito, sin limite de
    // credito ni movimientos): se oculta la tarjeta de credito por
    // completo en vez de mostrar "$0.00 disponible", que confundiria
    // a un visitante que nunca pidio credito.
    const tieneCredito = (aging.ventasPendientes && aging.ventasPendientes.length > 0) || Number(cliente.limite_credito) > 0 || Number(cliente.saldo) > 0;

    const contenido = elemento("portalClienteCreditoContenido");
    const vacio = elemento("portalClienteCreditoVacio");

    if (!tieneCredito) {
        contenido.style.display = "none";
        vacio.style.display = "";
        escaparTexto(elemento("portalStatCreditoValor"), "--");
        return;
    }

    contenido.style.display = "";
    vacio.style.display = "none";

    const limite = Number(cliente.limite_credito) || 0;
    const usado = Number(cliente.saldo) || 0;
    const disponible = Math.max(0, limite - usado);
    const pct = limite > 0 ? Math.min(100, Math.round((usado / limite) * 100)) : 0;

    escaparTexto(elemento("portalStatCreditoValor"), dinero(disponible));

    elemento("portalClienteCreditoGauge").style.background = "conic-gradient(var(--blue) " + pct + "%, rgba(20,32,51,.12) 0)";
    escaparTexto(elemento("portalClienteCreditoGaugeTexto"), dinero(disponible));
    escaparTexto(elemento("portalClienteCreditoLimite"), dinero(limite));
    escaparTexto(elemento("portalClienteCreditoUsado"), dinero(usado));
    escaparTexto(elemento("portalClienteCreditoDisponible"), dinero(disponible));

    const proximo = proximoPagoReal(aging);
    escaparTexto(elemento("portalClienteCreditoProximo"), proximo ? fechaCorta(proximo) : "Sin pagos pendientes");

    const estado = elemento("portalClienteCreditoEstado");
    estado.classList.toggle("vencido", Boolean(aging.vencido));
    escaparTexto(estado, aging.vencido ? "Vencido -- " + dinero(aging.totalVencido) : "Al corriente");

    const whatsappBtn = elemento("portalClienteCreditoWhatsapp");
    if (whatsappBtn) {
        const numero = (window.NEXO_PORTAL && window.NEXO_PORTAL.whatsapp) || "";
        if (numero) {
            whatsappBtn.style.display = "";
            whatsappBtn.href = "https://wa.me/" + numero + "?text=" + encodeURIComponent("Hola, quiero abonar a mi credito.");
        } else {
            whatsappBtn.style.display = "none";
        }
    }
}

function contarFavoritos(){
    try {
        const slug = (window.NEXO_PORTAL && window.NEXO_PORTAL.slug) || location.hostname.split(".")[0];
        const guardado = localStorage.getItem("nexoFavoritos_" + slug);
        const lista = guardado ? JSON.parse(guardado) : [];
        return Array.isArray(lista) ? lista.length : 0;
    } catch (error) {
        return 0;
    }
}

// "Cambiar de ferreteria" / tarjeta "Tus ferreterias": solo tiene
// datos reales que mostrar si el cliente ya vinculo su cuenta Nexo
// personal (persona_id) -- sin eso, solo existe la tienda actual, y
// eso es exactamente lo que se pinta (nada inventado).
async function cargarTiendasVinculadas(personaId){
    const listaTiendas = elemento("portalClienteTiendasLista");
    const listaCambiar = elemento("portalClienteCambiarLista");
    const botonCambiar = elemento("portalClienteCambiarBtn");
    const negocioActual = (window.NEXO_PORTAL && window.NEXO_PORTAL.nombreNegocio) || "";
    const slugActual = (window.NEXO_PORTAL && window.NEXO_PORTAL.slug) || "";

    if (!personaId) {
        listaTiendas.innerHTML = "";
        const fila = document.createElement("div");
        fila.className = "portal-tienda-fila portal-tienda-actual";
        const nombreEl = document.createElement("strong");
        nombreEl.textContent = negocioActual;
        fila.appendChild(nombreEl);
        listaTiendas.appendChild(fila);
        if (botonCambiar) botonCambiar.style.display = "none";
        return;
    }

    try {
        const respuesta = await fetch("/personas/negocios-cliente", { credentials: "include" });
        const datos = await respuesta.json();
        if (!datos.ok || !Array.isArray(datos.negocios)) return;

        listaTiendas.innerHTML = "";
        listaCambiar.innerHTML = "";

        datos.negocios.forEach(function(negocio){
            const esActual = negocio.slug === slugActual;

            const filaTienda = document.createElement("div");
            filaTienda.className = "portal-tienda-fila" + (esActual ? " portal-tienda-actual" : "");
            const nombreEl = document.createElement("strong");
            nombreEl.textContent = negocio.nombre;
            filaTienda.appendChild(nombreEl);
            if (!esActual) {
                const link = document.createElement("a");
                link.href = "https://" + negocio.slug + ".nexoposoficial.com/portal-cliente";
                link.textContent = "Entrar";
                filaTienda.appendChild(link);
            }
            listaTiendas.appendChild(filaTienda);

            const opcion = document.createElement("a");
            opcion.href = "https://" + negocio.slug + ".nexoposoficial.com/portal-cliente";
            if (esActual) opcion.className = "actual";
            opcion.textContent = negocio.nombre + (esActual ? " (actual)" : "");
            listaCambiar.appendChild(opcion);
        });

        if (botonCambiar) botonCambiar.style.display = datos.negocios.length > 1 ? "" : "none";
    } catch (error) {
        // silencioso -- si falla, la tienda actual ya quedo pintada
        // arriba en el header, no se rompe la pagina por esto.
    }
}

function alternarCambiarFerreteria(){
    const lista = elemento("portalClienteCambiarLista");
    if (lista) lista.classList.toggle("abierta");
}

document.addEventListener("click", function(evento){
    const lista = elemento("portalClienteCambiarLista");
    const boton = elemento("portalClienteCambiarBtn");
    if (!lista || !lista.classList.contains("abierta")) return;
    if (evento.target === boton || lista.contains(evento.target)) return;
    lista.classList.remove("abierta");
});

async function mostrarPortalCliente(){
    const token = localStorage.getItem(CLAVE_TOKEN);
    if (!token) { mostrarFormularioLoginCliente(); return; }

    try {
        const respuesta = await fetch("/portal-cliente/estado", { headers: { "x-cliente-token": token } });
        if (respuesta.status === 401) {
            localStorage.removeItem(CLAVE_TOKEN);
            mostrarFormularioLoginCliente();
            return;
        }
        const datos = await respuesta.json();
        if (!datos.ok) { mostrarFormularioLoginCliente(); return; }

        elemento("portalClienteLogin").style.display = "none";
        elemento("portalClienteCuenta").style.display = "";
        escaparTexto(elemento("portalClienteSaludo"), "Hola, " + (datos.cliente.nombre || ""));
        escaparTexto(elemento("portalStatFavoritosValor"), String(contarFavoritos()));
        escaparTexto(elemento("portalClienteDatosNombre"), datos.cliente.nombre || "");
        escaparTexto(elemento("portalClienteDatosTelefono"), datos.cliente.telefono || "");

        pintarMovimientos(datos.movimientos);
        pintarPedidos(datos.pedidos);
        pintarCredito(datos.cliente, datos.aging);
        cargarTiendasVinculadas(datos.cliente.persona_id);

        // Lado "Comprar" de la identidad Nexo unificada: solo se ofrece
        // vincular si todavia no lo esta -- la vinculacion en si requiere
        // que ademas haya una sesion de persona activa (cookie de
        // .nexoposoficial.com), que el servidor valida por su cuenta.
        const botonVincular = elemento("portalClienteVincularBoton");
        if (botonVincular) {
            botonVincular.style.display = datos.cliente.persona_id ? "none" : "";
        }
    } catch (error) {
        mostrarFormularioLoginCliente();
    }
}

async function vincularPersonaPortalCliente(){
    const token = localStorage.getItem(CLAVE_TOKEN);
    if (!token) return;

    try {
        const respuesta = await fetch("/portal-cliente/vincular-persona", {
            method: "POST",
            headers: { "x-cliente-token": token },
            credentials: "include"
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            if (String(datos.error || "").includes("Inicia sesion")) {
                alert("Primero inicia sesion en tu cuenta Nexo personal (nexoposoficial.com/mi-cuenta), y luego regresa aqui a vincular.");
                window.open("https://nexoposoficial.com/mi-cuenta", "_blank");
                return;
            }
            alert(datos.error || "No se pudo vincular.");
            return;
        }

        alert("Tu cuenta quedo vinculada a tu cuenta Nexo personal.");
        mostrarPortalCliente();
    } catch (error) {
        alert("No se pudo conectar. Intenta de nuevo.");
    }
}

document.getElementById("portalClienteLoginForm").addEventListener("submit", iniciarSesionPortalCliente);
document.getElementById("portalClienteLogoutBoton").addEventListener("click", cerrarSesionPortalCliente);
document.getElementById("portalClienteVincularBoton").addEventListener("click", vincularPersonaPortalCliente);
const botonCambiarFerreteriaInicial = document.getElementById("portalClienteCambiarBtn");
if (botonCambiarFerreteriaInicial) botonCambiarFerreteriaInicial.addEventListener("click", alternarCambiarFerreteria);
mostrarPortalCliente();
`;
}

async function servirPortalClienteNegocio(pool, req, res, slug, firmarTokenImagen) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).send("No encontrado");
            return;
        }

        const color = colorSeguro(sitio.negocio.color);
        const nombre = escaparHtml(sitio.negocio.nombre);
        const whatsappNumero = normalizarTelefonoWhatsApp(sitio.config.whatsapp);

        // Productos destacados (Fase 9, mismos datos que el Inicio de
        // esta tienda) -- se reusa cargarInicioTenant en vez de repetir
        // la consulta; si el dueno no marco ninguno a mano, la seccion
        // simplemente no se pinta (destacadosTenantHtml ya maneja eso).
        const datosInicio = await cargarInicioTenant(pool, sitio, slug, firmarTokenImagen);

        // Configuracion publica del negocio (nunca dato de un cliente)
        // para que el script del portal no tenga que adivinar el slug
        // desde el hostname ni pedir el nombre por separado. Escapado
        // de "</" para que no se pueda cerrar el <script> desde datos
        // del negocio (nombre, etc.).
        const configPortalJson = JSON.stringify({
            slug: sitio.negocio.slug,
            nombreNegocio: sitio.negocio.nombre,
            whatsapp: whatsappNumero || ""
        }).replace(/<\//g, "<\\/");

        const sidebarProximamente = (icono, etiqueta) => `<span class="portal-sidebar-proximamente">${icono}${etiqueta}<span class="etiqueta">Pronto</span></span>`;
        const accesoProximamente = (icono, etiqueta) => `<span class="portal-acceso-tile proximamente">${icono}${etiqueta}<span class="etiqueta">Pronto</span></span>`;

        const ayudaWhatsappHref = whatsappNumero
            ? `https://wa.me/${whatsappNumero}?text=${encodeURIComponent(`Hola, necesito ayuda con mi cuenta en ${sitio.negocio.nombre}.`)}`
            : "";

        const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi cuenta -- ${nombre}</title>
<meta name="description" content="Consulta tu credito y pedidos en ${nombre}.">
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>${estilosBaseTenant(color)}</style>
<style>${estilosPortalClienteHtml()}</style>
</head>
<body>
${encabezadoTenantHtml(sitio.negocio, "portal", sitio.config.aceptarSolicitudesCredito)}
<main class="tenant-main">
<div id="portalClienteLogin" class="tenant-main-angosto" style="margin:0 auto;">
<h1 class="tenant-catalogo-titulo">Mi cuenta</h1>
<p>Entra con el telefono y el codigo de acceso que te dio ${nombre}.</p>
<form class="tenant-pedido-form" id="portalClienteLoginForm">
<div class="tenant-pedido-honeypot" aria-hidden="true"><label>No llenar<input type="text" id="portalClienteHoneypot" tabindex="-1" autocomplete="off"></label></div>
<label>Telefono<input type="text" id="portalClienteTelefono" maxlength="40" required></label>
<label>Codigo de acceso<input type="text" id="portalClienteCodigo" maxlength="16" required style="text-transform:uppercase;"></label>
<p id="portalClienteAviso" style="color:#e2434d; font-size:13px; margin:0;"></p>
<button type="submit">Entrar</button>
</form>
</div>
<div id="portalClienteCuenta" style="display:none;">
<div class="portal-shell">
<aside class="portal-sidebar">
<div class="portal-sidebar-titulo">Tu cuenta</div>
<a href="#resumen" class="activo">${ICONO_PORTAL_RESUMEN}Resumen</a>
<a href="#pedidos">${ICONO_PORTAL_PEDIDOS}Mis pedidos</a>
<a href="/favoritos">${ICONO_TENANT_FAVORITO}Favoritos</a>
<a href="#credito">${ICONO_PORTAL_CREDITO}Mi credito</a>
<div class="portal-sidebar-titulo">Mi informacion</div>
<a href="#datos">${ICONO_PORTAL_USUARIO}Datos personales</a>
<a href="#seguridad">${ICONO_PORTAL_SEGURIDAD}Acceso y seguridad</a>
<div class="portal-sidebar-titulo">Proximamente</div>
${sidebarProximamente(ICONO_PORTAL_DIRECCION, "Direcciones")}
${sidebarProximamente(ICONO_PORTAL_PAGO, "Metodos de pago")}
${sidebarProximamente(ICONO_PORTAL_FACTURA, "Facturas")}
${sidebarProximamente(ICONO_PORTAL_DEVOLUCION, "Devoluciones")}
${sidebarProximamente(ICONO_PORTAL_NOTIFICACION, "Notificaciones")}
<div class="portal-sidebar-titulo">Ayuda</div>
${ayudaWhatsappHref
        ? `<a href="${ayudaWhatsappHref}" target="_blank" rel="noopener">${ICONO_PORTAL_AYUDA}Ayuda y soporte</a>`
        : sidebarProximamente(ICONO_PORTAL_AYUDA, "Ayuda y soporte")}
<div class="portal-sidebar-salir">
<button type="button" id="portalClienteLogoutBoton">${ICONO_PORTAL_SALIR}Cerrar sesion</button>
</div>
</aside>
<div>
<div class="portal-header-card" id="resumen">
<div>
<h1 class="portal-header-saludo" id="portalClienteSaludo"></h1>
<span class="portal-header-badge">Cliente de ${nombre}</span>
</div>
<div class="portal-header-negocio">
<span class="portal-header-negocio-eyebrow">Tu ferreteria</span>
<span class="portal-header-negocio-nombre">${nombre}</span>
<div class="portal-header-negocio-fila"><span>Compras realizadas</span><strong id="portalHeaderComprasValor">0</strong></div>
<button type="button" class="portal-header-cambiar" id="portalClienteCambiarBtn" style="display:none;">Cambiar de ferreteria</button>
<button type="button" class="portal-header-cambiar tenant-btn-secundario-oscuro" id="portalClienteVincularBoton" style="display:none;">Vincular con mi cuenta Nexo</button>
<div class="portal-header-cambiar-lista" id="portalClienteCambiarLista"></div>
</div>
</div>
<div class="portal-stats-grid">
<div class="portal-stat-card">
<div class="portal-stat-card-titulo">${ICONO_PORTAL_PEDIDOS}Mis pedidos</div>
<div class="portal-stat-card-valor" id="portalStatPedidosValor">0</div>
<div class="portal-stat-card-sub"><a href="#pedidos">Ver pedidos</a></div>
</div>
<div class="portal-stat-card">
<div class="portal-stat-card-titulo">${ICONO_TENANT_FAVORITO}Favoritos</div>
<div class="portal-stat-card-valor" id="portalStatFavoritosValor">0</div>
<div class="portal-stat-card-sub"><a href="/favoritos">Ver favoritos</a></div>
</div>
<div class="portal-stat-card">
<div class="portal-stat-card-titulo">${ICONO_PORTAL_CREDITO}Credito disponible</div>
<div class="portal-stat-card-valor" id="portalStatCreditoValor">--</div>
<div class="portal-stat-card-sub"><a href="#credito">Ver credito</a></div>
</div>
<div class="portal-stat-card proximamente">
<div class="portal-stat-card-titulo">${ICONO_PORTAL_DIRECCION}Direcciones</div>
<div class="portal-stat-card-valor">0</div>
<div class="portal-stat-card-sub">Proximamente</div>
</div>
</div>
<div class="portal-grid-2">
<div class="portal-card" id="pedidos">
<div class="portal-card-header"><h2>Pedidos recientes</h2></div>
<div id="portalClientePedidosLista"></div>
</div>
<div class="portal-card" id="credito">
<div class="portal-card-header"><h2>Mi credito ${nombre}</h2></div>
<p class="portal-credito-vacio" id="portalClienteCreditoVacio" style="display:none;">Todavia no tienes movimientos de credito con nosotros.</p>
<div id="portalClienteCreditoContenido">
<div class="portal-credito-gauge-wrap">
<div class="portal-credito-gauge" id="portalClienteCreditoGauge"><span class="portal-credito-gauge-texto" id="portalClienteCreditoGaugeTexto"></span></div>
<div class="portal-credito-lineas">
<div class="portal-credito-linea"><span>Limite</span><strong id="portalClienteCreditoLimite"></strong></div>
<div class="portal-credito-linea"><span>Usado</span><strong id="portalClienteCreditoUsado"></strong></div>
<div class="portal-credito-linea"><span>Disponible</span><strong id="portalClienteCreditoDisponible"></strong></div>
<div class="portal-credito-linea"><span>Proximo pago</span><strong id="portalClienteCreditoProximo"></strong></div>
</div>
</div>
<span class="portal-credito-estado" id="portalClienteCreditoEstado"></span>
<div class="portal-credito-acciones">
<a href="#" class="tenant-btn-secundario" id="portalClienteCreditoWhatsapp" target="_blank" rel="noopener" style="display:none;">Pagar por WhatsApp</a>
<a href="#historial" class="tenant-btn-secundario">Ver movimientos</a>
</div>
</div>
</div>
</div>
${destacadosTenantHtml(datosInicio.destacados, "", `Productos destacados de ${sitio.negocio.nombre}`)}
<div class="portal-card" id="tiendas">
<div class="portal-card-header"><h2>Tus ferreterias</h2></div>
<div class="portal-tiendas-lista" id="portalClienteTiendasLista"></div>
</div>
<div class="portal-card" id="accesos" style="margin-top:24px;">
<div class="portal-card-header"><h2>Accesos rapidos</h2></div>
<div class="portal-accesos-grid">
<a class="portal-acceso-tile" href="/favoritos">${ICONO_TENANT_FAVORITO}Favoritos</a>
${ayudaWhatsappHref
        ? `<a class="portal-acceso-tile" href="${ayudaWhatsappHref}" target="_blank" rel="noopener">${ICONO_PORTAL_AYUDA}Ayuda y soporte</a>`
        : accesoProximamente(ICONO_PORTAL_AYUDA, "Ayuda y soporte")}
${accesoProximamente(ICONO_PORTAL_FACTURA, "Facturas")}
${accesoProximamente(ICONO_PORTAL_DEVOLUCION, "Devoluciones")}
${accesoProximamente(ICONO_PORTAL_PAGO, "Metodos de pago")}
${accesoProximamente(ICONO_PORTAL_NOTIFICACION, "Notificaciones")}
</div>
</div>
<div class="portal-card" id="datos" style="margin-top:24px;">
<div class="portal-card-header"><h2>Datos personales</h2></div>
<div class="portal-datos-fila"><span>Nombre</span><span id="portalClienteDatosNombre"></span></div>
<div class="portal-datos-fila"><span>Telefono</span><span id="portalClienteDatosTelefono"></span></div>
<p style="color:var(--muted); font-size:12.5px; margin-top:14px;">Para actualizar tus datos, contacta directamente a ${nombre}.</p>
</div>
<div class="portal-card" id="seguridad" style="margin-top:24px;">
<div class="portal-card-header"><h2>Acceso y seguridad</h2></div>
<div class="portal-seguridad-card">
<p>Entras a tu cuenta con tu <strong>telefono</strong> y un <strong>codigo de acceso</strong> que te da ${nombre} -- no usamos contrasena tradicional.</p>
<p>Si perdiste tu codigo o quieres uno nuevo, pidelo directamente en la ferreteria.</p>
</div>
</div>
<div class="portal-card" id="historial" style="margin-top:24px;">
<div class="portal-card-header"><h2>Historial de movimientos</h2></div>
<table class="tenant-portal-tabla">
<thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th></tr></thead>
<tbody id="portalClienteMovimientos"></tbody>
</table>
</div>
</div>
</div>
</div>
</main>
<footer class="tenant-footer">Con la tecnologia de Nexo</footer>
<script>window.NEXO_PORTAL = ${configPortalJson};</script>
<script>${scriptPortalClienteHtml()}</script>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
    } catch (error) {
        console.warn("Error sirviendo el portal de cliente:", error.message);
        res.status(500).send("Error");
    }
}

// Login del portal de cliente -- honeypot + doble limitador (IP y
// negocio+telefono, ver comentario junto a los limitadores arriba)
// antes de tocar la base de datos. Nunca revela si el telefono existe
// o no -- mismo mensaje generico en cualquier caso de fallo.
async function iniciarSesionClientePublico(pool, req, res, slug) {
    try {
        const sitio = await resolverSitioPublico(pool, slug);

        if (!sitio) {
            res.status(404).json({ ok: false, error: "No encontrado" });
            return;
        }

        if (paramTexto(req.body?.sitioExtra, 200)) {
            res.json({ ok: false, error: "Telefono o codigo incorrectos" });
            return;
        }

        const telefono = paramTexto(req.body?.telefono, 40);
        const codigo = paramTexto(req.body?.codigo, 16).toUpperCase();
        const claveTelefono = `${sitio.negocio.id}:${telefono}`;

        if (!telefono || !codigo || limitadorLoginClientePublico.bloqueado(req.ip) || limitadorLoginClientePorTelefono.bloqueado(claveTelefono)) {
            limitadorLoginClientePublico.registrarFallo(req.ip);
            res.json({ ok: false, error: "Telefono o codigo incorrectos" });
            return;
        }

        const cliente = await pool.query(
            `SELECT id, nombre, telefono, codigo_acceso_hash FROM public.clientes_credito
             WHERE negocio_id = $1 AND telefono = $2 AND activo = true AND codigo_acceso_hash IS NOT NULL`,
            [sitio.negocio.id, telefono]
        );

        const fila = cliente.rows[0];
        if (!fila || !verificarPassword(codigo, fila.codigo_acceso_hash)) {
            limitadorLoginClientePublico.registrarFallo(req.ip);
            limitadorLoginClientePorTelefono.registrarFallo(claveTelefono);
            res.json({ ok: false, error: "Telefono o codigo incorrectos" });
            return;
        }

        const token = generarTokenSesionCliente();
        await pool.query(
            `INSERT INTO public.sesiones_cliente_credito (cliente_id, token_hash, ip) VALUES ($1, $2, $3)`,
            [fila.id, hashTokenSesionCliente(token), req.ip]
        );

        // Autovincula con la cuenta Nexo personal si este navegador ya
        // trae una sesion activa (cookie de .nexoposoficial.com) --
        // ambos lados ya probaron su identidad por separado (telefono+
        // codigo aqui, login de Nexo alla), asi que no hace falta
        // depender de que el cliente encuentre el boton "Vincular" a
        // mano (/portal-cliente/vincular-persona, que sigue existiendo
        // para quien inicia sesion de Nexo despues de entrar aqui).
        // Nunca bloquea el login si algo falla.
        try {
            const tokenPersona = tokenDeSesionPersona(req);
            if (tokenPersona) {
                const persona = await buscarPersonaPorToken(pool, tokenPersona);
                if (persona) {
                    await pool.query(
                        `UPDATE public.clientes_credito SET persona_id = $1 WHERE id = $2 AND persona_id IS NULL`,
                        [persona.id, fila.id]
                    );
                }
            }
        } catch (error) {
            console.warn("No se pudo autovincular cliente de credito a persona:", error.message);
        }

        res.json({ ok: true, token, nombre: fila.nombre });
    } catch (error) {
        console.warn("Error en login de portal de cliente:", error.message);
        res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
    }
}

// Middleware de sesion del portal de cliente -- header propio
// (x-cliente-token), distinto de x-dispositivo-token y del
// Authorization: Bearer del dueno, para que requerirAccesoNegocio
// nunca intente resolver un token de cliente contra sus propias
// tablas (ver investigacion en el plan).
function requerirSesionClienteCredito(pool) {
    return async (req, res, next) => {
        const token = req.headers["x-cliente-token"];

        if (!token) {
            res.status(401).json({ ok: false, error: "Sesion invalida, inicia sesion de nuevo" });
            return;
        }

        try {
            const sesion = await pool.query(
                `SELECT s.id AS sesion_id, c.id, c.negocio_id, c.nombre, c.telefono
                 FROM public.sesiones_cliente_credito s
                 JOIN public.clientes_credito c ON c.id = s.cliente_id
                 WHERE s.token_hash = $1 AND s.revocado_at IS NULL`,
                [hashTokenSesionCliente(token)]
            );

            if (sesion.rows.length === 0) {
                res.status(401).json({ ok: false, error: "Sesion invalida, inicia sesion de nuevo" });
                return;
            }

            const fila = sesion.rows[0];
            await pool.query(`UPDATE public.sesiones_cliente_credito SET ultimo_uso_at = NOW() WHERE id = $1`, [fila.sesion_id]);

            req.clienteCredito = { id: fila.id, negocioId: fila.negocio_id, nombre: fila.nombre, telefono: fila.telefono };
            req.clienteCreditoTokenHash = hashTokenSesionCliente(token);
            next();
        } catch (error) {
            console.warn("Error validando sesion de cliente:", error.message);
            res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
        }
    };
}

async function estadoPortalCliente(pool, req, res) {
    try {
        const clienteId = req.clienteCredito.id;
        const negocioId = req.clienteCredito.negocioId;

        const cliente = await pool.query(`
            SELECT
                c.id, c.nombre, c.telefono, c.limite_credito, c.fecha_vencimiento, c.persona_id,
                COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN m.monto WHEN m.tipo = 'abono' THEN -m.monto ELSE 0 END), 0) AS saldo
            FROM public.clientes_credito c
            LEFT JOIN public.movimientos_credito m ON m.cliente_id = c.id AND m.negocio_id = c.negocio_id
            WHERE c.id = $1 AND c.negocio_id = $2
            GROUP BY c.id
        `, [clienteId, negocioId]);

        if (cliente.rows.length === 0) {
            res.status(404).json({ ok: false, error: "Cuenta no encontrada" });
            return;
        }

        const movimientos = await pool.query(
            `SELECT tipo, concepto, monto, fecha, fecha_vencimiento FROM public.movimientos_credito
             WHERE cliente_id = $1 AND negocio_id = $2 ORDER BY fecha ASC, id ASC`,
            [clienteId, negocioId]
        );

        const aging = calcularAntiguedadCredito(movimientos.rows);

        const pedidos = await pool.query(
            `SELECT producto_nombre, cantidad, estado, created_at, grupo_id, tipo, precio_cotizado, nota_negocio FROM public.pedidos_publicos
             WHERE negocio_id = $1 AND cliente_telefono = $2 ORDER BY created_at DESC LIMIT 50`,
            [negocioId, req.clienteCredito.telefono]
        );

        res.json({
            ok: true,
            cliente: { ...cliente.rows[0], vencido: aging.vencido, totalVencido: aging.totalVencido },
            movimientos: movimientos.rows,
            aging,
            pedidos: pedidos.rows
        });
    } catch (error) {
        console.warn("Error sirviendo estado de portal de cliente:", error.message);
        res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
    }
}

async function cerrarSesionPortalCliente(pool, req, res) {
    try {
        await pool.query(
            `UPDATE public.sesiones_cliente_credito SET revocado_at = NOW() WHERE token_hash = $1`,
            [req.clienteCreditoTokenHash]
        );
        res.json({ ok: true });
    } catch (error) {
        console.warn("Error cerrando sesion de portal de cliente:", error.message);
        res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
    }
}

function registrarRutas(app, pool, requerirAccesoNegocio) {
    app.get("/portal-cliente/estado", requerirSesionClienteCredito(pool), (req, res) => estadoPortalCliente(pool, req, res));
    app.post("/portal-cliente/logout", requerirSesionClienteCredito(pool), (req, res) => cerrarSesionPortalCliente(pool, req, res));

    // Lado "Comprar" de la identidad Nexo unificada: vincula la fila
    // clientes_credito con la que ya se inicio sesion (telefono+codigo
    // de este negocio) a la persona ya logueada -- ambos lados ya
    // probaron su identidad por separado, no se pide nada extra.
    app.post(
        "/portal-cliente/vincular-persona",
        requerirSesionClienteCredito(pool),
        crearRequerirSesionPersona(pool),
        async (req, res) => {
            try {
                const actual = await pool.query(
                    `SELECT persona_id FROM public.clientes_credito WHERE id = $1`,
                    [req.clienteCredito.id]
                );

                if (actual.rows[0]?.persona_id) {
                    res.status(409).json({ ok: false, error: "Esta cuenta ya esta vinculada a una cuenta Nexo" });
                    return;
                }

                await pool.query(
                    `UPDATE public.clientes_credito SET persona_id = $1 WHERE id = $2`,
                    [req.persona.id, req.clienteCredito.id]
                );

                res.json({ ok: true });
            } catch (error) {
                console.warn("Error vinculando cliente de credito a persona:", error.message);
                res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
            }
        }
    );

    app.get("/personas/negocios-cliente", crearRequerirSesionPersona(pool), async (req, res) => {
        try {
            const resultado = await pool.query(
                `SELECT n.id, n.slug, n.nombre
                 FROM public.clientes_credito c
                 JOIN public.negocios n ON n.id = c.negocio_id
                 WHERE c.persona_id = $1 AND c.activo = true
                 ORDER BY n.nombre`,
                [req.persona.id]
            );
            res.json({ ok: true, negocios: resultado.rows });
        } catch (error) {
            console.warn("Error listando negocios donde la persona es cliente:", error.message);
            res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
        }
    });

    // Pedidos que esta persona hizo (con sesion activa) en cualquier
    // tienda, sin importar si es o no cliente de credito ahi -- basta
    // con que pedidos_publicos.persona_id haya quedado guardado al
    // crear el pedido (ver recibirPedidoPublico/recibirPedidoCarritoPublico).
    app.get("/personas/mis-pedidos", crearRequerirSesionPersona(pool), async (req, res) => {
        try {
            const resultado = await pool.query(
                `SELECT pp.id, pp.negocio_id, n.slug, n.nombre AS tienda, pp.producto_codigo, pp.producto_nombre,
                        pp.cantidad, pp.estado, pp.created_at, pp.grupo_id, pp.tipo, pp.precio_cotizado, pp.nota_negocio,
                        pm.id AS pedido_market_id, pm.codigo_recogida, pm.estado AS estado_pedido_market,
                        pm.recogida_estimada_desde, pm.recogida_estimada_hasta
                 FROM public.pedidos_publicos pp
                 JOIN public.negocios n ON n.id = pp.negocio_id
                 LEFT JOIN public.pedidos_market pm ON pm.id = pp.pedido_market_id
                 WHERE pp.persona_id = $1
                 ORDER BY pp.created_at DESC
                 LIMIT 200`,
                [req.persona.id]
            );
            res.json({ ok: true, pedidos: resultado.rows });
        } catch (error) {
            console.warn("Error listando pedidos de la persona:", error.message);
            res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
        }
    });

    // Credito agregado entre tiendas -- solo cuenta las tiendas donde
    // el cliente de credito ya vinculo esta persona
    // (clientes_credito.persona_id, mismo criterio que negocios-cliente
    // arriba). Reusa calcularAntiguedadCredito (credit-aging.js), el
    // mismo motor que ya usa /portal-cliente/estado por tienda -- aqui
    // solo se corre una vez por cada tienda vinculada.
    app.get("/personas/mi-credito", crearRequerirSesionPersona(pool), async (req, res) => {
        try {
            const negociosRes = await pool.query(
                `SELECT c.id AS cliente_id, c.negocio_id, c.limite_credito, n.slug, n.nombre
                 FROM public.clientes_credito c
                 JOIN public.negocios n ON n.id = c.negocio_id
                 WHERE c.persona_id = $1 AND c.activo = true
                 ORDER BY n.nombre`,
                [req.persona.id]
            );

            const creditos = [];
            for (const fila of negociosRes.rows) {
                const movimientos = await pool.query(
                    `SELECT tipo, concepto, monto, fecha, fecha_vencimiento
                     FROM public.movimientos_credito
                     WHERE cliente_id = $1 AND negocio_id = $2
                     ORDER BY fecha ASC, id ASC`,
                    [fila.cliente_id, fila.negocio_id]
                );
                const aging = calcularAntiguedadCredito(movimientos.rows);
                creditos.push({
                    negocio: { slug: fila.slug, nombre: fila.nombre },
                    limiteCredito: Number(fila.limite_credito),
                    saldo: aging.saldo,
                    vencido: aging.vencido,
                    totalVencido: aging.totalVencido
                });
            }

            res.json({ ok: true, creditos });
        } catch (error) {
            console.warn("Error calculando credito agregado de la persona:", error.message);
            res.status(500).json({ ok: false, error: "Ocurrio un error. Intenta de nuevo." });
        }
    });

    // Modulo "Nexo Market" del POS (Fase 2) -- resumen de solo lectura,
    // reusa el mismo gate de plan que Sitio web (misma clave de
    // funcion) y el mismo campo sitio_web_config.activo (es el mismo
    // switch que ya controla la visibilidad en Market, no se duplica).
    app.get("/negocio-actual/market-resumen", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);

            const config = await pool.query(`SELECT activo FROM public.sitio_web_config WHERE negocio_id = $1`, [negocio.id]);
            const destacados = await pool.query(
                `SELECT count(*) FROM public.productos WHERE negocio_id = $1 AND (destacado = true OR precio_oferta IS NOT NULL)`,
                [negocio.id]
            );
            const pedidosMarket = await pool.query(
                `SELECT count(*) FROM public.pedidos_publicos WHERE negocio_id = $1 AND origen = 'market' AND created_at > NOW() - INTERVAL '30 days'`,
                [negocio.id]
            );

            res.json({
                ok: true,
                incluido: acceso.incluido,
                visible: Boolean(config.rows[0]?.activo) && acceso.incluido,
                urlMarket: `https://nexoposoficial.com/market/ferreteria/${negocio.slug}`,
                totalDestacadosOfertas: Number(destacados.rows[0].count),
                pedidosMarket30Dias: Number(pedidosMarket.rows[0].count)
            });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    app.get("/negocio-actual/productos-destacados", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);

            const resultado = await pool.query(
                `SELECT codigo, nombre, precio, precio_oferta, destacado, stock FROM public.productos
                 WHERE negocio_id = $1 AND (destacado = true OR precio_oferta IS NOT NULL)
                 ORDER BY nombre`,
                [negocio.id]
            );

            res.json({
                ok: true,
                productos: resultado.rows.map(p => ({
                    codigo: p.codigo,
                    nombre: p.nombre,
                    precio: Number(p.precio),
                    precioOferta: p.precio_oferta !== null ? Number(p.precio_oferta) : null,
                    destacado: p.destacado,
                    stock: p.stock !== null ? Number(p.stock) : null
                }))
            });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    app.get("/negocio-actual/sitio-web", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await funcionDelPlan(negocio.id, CLAVE_FUNCION_SITIO_WEB);

            const resultado = await pool.query(
                `SELECT activo, descripcion, portada, horario_texto, whatsapp, facebook, instagram, mostrar_precios, mostrar_existencias, aceptar_solicitudes_credito, promocion_activa, promocion_titulo, promocion_texto, promocion_enlace, promocion_plantilla, promocion_color_acento, promocion_texto_boton, (promocion_imagen IS NOT NULL) AS promocion_tiene_imagen, envio_modo, envio_tarifa, envio_notas FROM public.sitio_web_config WHERE negocio_id = $1`,
                [negocio.id]
            );

            const config = resultado.rows[0] || {
                activo: false, descripcion: "", portada: null,
                horario_texto: "", whatsapp: "", facebook: "", instagram: "",
                mostrar_precios: false, mostrar_existencias: false, aceptar_solicitudes_credito: false,
                promocion_activa: false, promocion_titulo: "", promocion_texto: "", promocion_enlace: "", promocion_tiene_imagen: false,
                promocion_plantilla: "clasica", promocion_color_acento: null, promocion_texto_boton: "",
                envio_modo: "a_coordinar", envio_tarifa: null, envio_notas: ""
            };

            res.json({
                ok: true,
                incluido: acceso.incluido,
                slug: negocio.slug,
                nombre: negocio.nombre,
                urlPublica: `https://${negocio.slug}.nexoposoficial.com`,
                activo: config.activo,
                descripcion: config.descripcion,
                portada: config.portada,
                direccion: negocio.direccion || "",
                direccionLat: negocio.direccion_lat,
                direccionLng: negocio.direccion_lng,
                horarioTexto: config.horario_texto,
                whatsapp: config.whatsapp,
                facebook: config.facebook,
                instagram: config.instagram,
                mostrarPrecios: config.mostrar_precios,
                mostrarExistencias: config.mostrar_existencias,
                aceptarSolicitudesCredito: config.aceptar_solicitudes_credito,
                promocionActiva: config.promocion_activa,
                promocionTitulo: config.promocion_titulo,
                promocionTexto: config.promocion_texto,
                promocionEnlace: config.promocion_enlace,
                promocionPlantilla: config.promocion_plantilla || "clasica",
                promocionColorAcento: config.promocion_color_acento,
                promocionTextoBoton: config.promocion_texto_boton || "",
                promocionTieneImagen: config.promocion_tiene_imagen,
                envioModo: config.envio_modo,
                envioTarifa: config.envio_tarifa !== null ? Number(config.envio_tarifa) : null,
                envioNotas: config.envio_notas
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
            const aceptarSolicitudesCredito = Boolean(req.body?.aceptarSolicitudesCredito);
            const promocionActiva = Boolean(req.body?.promocionActiva);
            const promocionTitulo = String(req.body?.promocionTitulo || "").slice(0, 140);
            const promocionTexto = String(req.body?.promocionTexto || "").slice(0, 500);
            const promocionEnlace = String(req.body?.promocionEnlace || "").slice(0, 300);
            const promocionTextoBoton = String(req.body?.promocionTextoBoton || "").slice(0, 40);
            const plantillaBody = String(req.body?.promocionPlantilla || "");
            const promocionPlantilla = Object.prototype.hasOwnProperty.call(PLANTILLAS_PROMOCION, plantillaBody) ? plantillaBody : "clasica";
            const colorAcentoBody = String(req.body?.promocionColorAcento || "");
            const promocionColorAcento = /^#[0-9a-fA-F]{6}$/.test(colorAcentoBody) ? colorAcentoBody : null;

            // Politica de envio por tienda (Fase 1, sin pagos -- ver
            // plan): 3 modos honestos, nunca se inventa logistica que
            // la tienda no ofrece. La tarifa solo tiene sentido con
            // tarifa_fija -- en cualquier otro modo se guarda null para
            // que no quede una tarifa huerfana de un modo distinto.
            const MODOS_ENVIO_VALIDOS = ["a_coordinar", "solo_recoleccion", "tarifa_fija"];
            const envioModoBody = String(req.body?.envioModo || "");
            const envioModo = MODOS_ENVIO_VALIDOS.includes(envioModoBody) ? envioModoBody : "a_coordinar";
            const envioTarifaBody = Number(req.body?.envioTarifa);
            const envioTarifa = envioModo === "tarifa_fija" && Number.isFinite(envioTarifaBody) && envioTarifaBody >= 0
                ? envioTarifaBody
                : null;
            const envioNotas = String(req.body?.envioNotas || "").slice(0, 300);

            // Direccion real de la tienda (mapa de Nexo Market, ver plan).
            // Se guarda en negocios.direccion -- la misma columna que ya
            // leen las queries de Market -- solo se vuelve a geocodificar
            // si de verdad cambio, para no gastar llamadas de mas al
            // servicio gratis de geocodificacion.
            const tocaDireccion = Object.prototype.hasOwnProperty.call(req.body || {}, "direccion");
            const direccion = tocaDireccion ? String(req.body.direccion || "").trim().slice(0, 180) : null;
            let direccionUbicada = null;

            if (tocaDireccion && direccion !== (negocio.direccion || "")) {
                let lat = null;
                let lng = null;

                if (direccion) {
                    const coords = await geocodificarDireccion(direccion);
                    if (coords) {
                        lat = coords.lat;
                        lng = coords.lng;
                        direccionUbicada = true;
                    } else {
                        direccionUbicada = false;
                    }
                }

                await pool.query(
                    `UPDATE public.negocios SET direccion = $1, direccion_lat = $2, direccion_lng = $3, direccion_geocodificada_en = NOW() WHERE id = $4`,
                    [direccion || null, lat, lng, negocio.id]
                );
            }

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
                    (negocio_id, activo, descripcion, portada, horario_texto, whatsapp, facebook, instagram, mostrar_precios, mostrar_existencias, aceptar_solicitudes_credito, promocion_activa, promocion_titulo, promocion_texto, promocion_enlace, envio_modo, envio_tarifa, envio_notas, promocion_plantilla, promocion_color_acento, promocion_texto_boton, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
                ON CONFLICT (negocio_id) DO UPDATE SET
                    activo = $2, descripcion = $3,
                    portada = CASE WHEN $9 THEN $4 ELSE sitio_web_config.portada END,
                    horario_texto = $5, whatsapp = $6, facebook = $7, instagram = $8,
                    mostrar_precios = $10, mostrar_existencias = $11, aceptar_solicitudes_credito = $12,
                    promocion_activa = $13, promocion_titulo = $14, promocion_texto = $15, promocion_enlace = $16,
                    envio_modo = $17, envio_tarifa = $18, envio_notas = $19,
                    promocion_plantilla = $20, promocion_color_acento = $21, promocion_texto_boton = $22,
                    updated_at = NOW()
                `,
                [negocio.id, activo, descripcion, portada, horarioTexto, whatsapp, facebook, instagram, tocaPortada, mostrarPrecios, mostrarExistencias, aceptarSolicitudesCredito, promocionActiva, promocionTitulo, promocionTexto, promocionEnlace, envioModo, envioTarifa, envioNotas, promocionPlantilla, promocionColorAcento, promocionTextoBoton]
            );

            res.json({ ok: true, direccionUbicada });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    // Imagen del banner de "Promocion" (Fase "Ofertas destacadas", ver
    // plan) -- subida aparte del PUT de arriba porque necesita
    // multipart/form-data, no JSON. Mismo recorte que banners-market-server.js
    // (sube cualquier foto, el servidor la deja lista en una proporcion
    // fija) -- funcion copiada, no importada, es de 6 lineas y cruzar
    // modulos por eso no vale la pena.
    const uploadPromocionImagen = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 8 * 1024 * 1024, files: 1 }
    });

    // "recorte" (Fase "rediseno Sitio web", ver plan): rectangulo en
    // pixeles de la imagen ORIGINAL que el dueno encuadro con el paso
    // de recorte-con-guias del cliente -- si viene, se respeta
    // exactamente (extract + fill, sin volver a recortar); si no viene
    // (cliente viejo o sin JS de recorte), se usa el mismo cover ciego
    // de siempre como respaldo.
    async function procesarImagenPromocion(buffer, recorte) {
        let pipeline = sharp(buffer);

        const valido = recorte
            && Number.isFinite(recorte.left) && Number.isFinite(recorte.top)
            && Number.isFinite(recorte.width) && Number.isFinite(recorte.height)
            && recorte.width > 0 && recorte.height > 0;

        if (valido) {
            pipeline = pipeline.extract({
                left: Math.max(0, Math.round(recorte.left)),
                top: Math.max(0, Math.round(recorte.top)),
                width: Math.round(recorte.width),
                height: Math.round(recorte.height)
            });
        }

        return pipeline
            .resize({ width: 1200, height: 500, fit: valido ? "fill" : "cover" })
            .jpeg({ quality: 78 })
            .toBuffer();
    }

    app.post("/negocio-actual/sitio-web/promocion-imagen", requerirAccesoNegocio, (req, res) => {
        uploadPromocionImagen.single("imagen")(req, res, async error => {
            if (error) {
                res.status(400).json({
                    ok: false,
                    error: error.code === "LIMIT_FILE_SIZE"
                        ? "La imagen pesa mas de 8MB. Usa una mas chica e intenta de nuevo."
                        : (error.message || "No se pudo procesar la imagen")
                });
                return;
            }

            try {
                if (!req.file) { res.status(400).json({ ok: false, error: "No se recibio ninguna imagen" }); return; }

                let recorte = null;
                if (req.body?.recorte) {
                    try { recorte = JSON.parse(req.body.recorte); } catch { recorte = null; }
                }

                const negocio = await negocioActual(req, pool);
                const imagen = await procesarImagenPromocion(req.file.buffer, recorte);

                await pool.query(
                    `INSERT INTO public.sitio_web_config (negocio_id, promocion_imagen, promocion_imagen_actualizado_at, updated_at)
                     VALUES ($1, $2, NOW(), NOW())
                     ON CONFLICT (negocio_id) DO UPDATE SET
                        promocion_imagen = $2, promocion_imagen_actualizado_at = NOW(), updated_at = NOW()`,
                    [negocio.id, imagen]
                );

                res.json({ ok: true });
            } catch (error2) {
                res.status(error2.httpStatus || 500).json({ ok: false, error: error2.message });
            }
        });
    });

    // Vista previa en vivo del editor de Promociones (Fase "rediseno
    // Sitio web", ver plan): recibe los campos EN BORRADOR (todavia sin
    // guardar) y devuelve el HTML real de la plantilla elegida, usando
    // el mismo dispatcher/plantillas que renderiza el sitio publico --
    // nunca una maqueta aparte que se pueda desincronizar. La imagen no
    // viaja en el borrador (ya se sube aparte via
    // /promocion-imagen y queda guardada de inmediato) -- se lee la que
    // ya este guardada para que la vista previa la incluya.
    app.post("/negocio-actual/sitio-web/promocion-preview", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);

            const resultado = await pool.query(
                `SELECT (promocion_imagen IS NOT NULL) AS promocion_tiene_imagen, promocion_imagen_actualizado_at FROM public.sitio_web_config WHERE negocio_id = $1`,
                [negocio.id]
            );
            const fila = resultado.rows[0] || { promocion_tiene_imagen: false, promocion_imagen_actualizado_at: null };

            const plantillaBody = String(req.body?.promocionPlantilla || "");
            const colorBody = String(req.body?.promocionColorAcento || "");

            const config = {
                promocionActiva: true,
                promocionTitulo: String(req.body?.promocionTitulo || "").slice(0, 140),
                promocionTexto: String(req.body?.promocionTexto || "").slice(0, 500),
                promocionEnlace: String(req.body?.promocionEnlace || "").slice(0, 300),
                promocionTextoBoton: String(req.body?.promocionTextoBoton || "").slice(0, 40),
                promocionPlantilla: Object.prototype.hasOwnProperty.call(PLANTILLAS_PROMOCION, plantillaBody) ? plantillaBody : "clasica",
                promocionColorAcento: /^#[0-9a-fA-F]{6}$/.test(colorBody) ? colorBody : null,
                promocionTieneImagen: fila.promocion_tiene_imagen,
                promocionImagenActualizadoAt: fila.promocion_imagen_actualizado_at
            };

            res.json({ ok: true, html: bannerPromocionHtml(config, negocio.slug) });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    // Publica, sin token -- mismo criterio que los banners de Nexo
    // Market (banners-market-server.js): es contenido de marketing que
    // el propio negocio decidio hacer publico al activar su promocion.
    app.get("/sitio-web-promocion-imagen", async (req, res) => {
        try {
            const slug = String(req.query.negocio || "").trim();
            if (!slug) { res.status(404).end(); return; }

            const resultado = await pool.query(
                `SELECT c.promocion_imagen
                 FROM public.sitio_web_config c
                 JOIN public.negocios n ON n.id = c.negocio_id
                 WHERE n.slug = $1`,
                [slug]
            );

            const fila = resultado.rows[0];
            if (!fila || !fila.promocion_imagen) { res.status(404).end(); return; }

            res.set("Content-Type", "image/jpeg");
            res.send(fila.promocion_imagen);
        } catch (error) {
            res.status(500).end();
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
                    cliente_correo, mensaje, estado, created_at, grupo_id, tipo, precio_cotizado, nota_negocio, respondido_at, origen, entrega_modo,
                    pagado, monto_pagado
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
                    createdAt: fila.created_at,
                    grupoId: fila.grupo_id,
                    tipo: fila.tipo,
                    precioCotizado: fila.precio_cotizado !== null ? Number(fila.precio_cotizado) : null,
                    notaNegocio: fila.nota_negocio,
                    respondidoAt: fila.respondido_at,
                    origen: fila.origen,
                    entregaModo: fila.entrega_modo,
                    pagado: fila.pagado,
                    montoPagado: fila.monto_pagado !== null ? Number(fila.monto_pagado) : null
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

            if (!["atendido", "descartado", "pendiente", "cotizado"].includes(estado)) {
                res.status(400).json({ ok: false, error: "Estado invalido" });
                return;
            }

            const filaActual = await pool.query(
                `SELECT id, grupo_id, tipo, cliente_telefono, cliente_correo FROM public.pedidos_publicos WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );

            if (filaActual.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Pedido no encontrado" });
                return;
            }

            const fila = filaActual.rows[0];

            if (estado === "cotizado") {
                if (fila.tipo !== "cotizacion") {
                    res.status(400).json({ ok: false, error: "Solo se puede cotizar una solicitud de cotizacion" });
                    return;
                }

                const precioCotizado = Number(req.body?.precioCotizado);
                if (!Number.isFinite(precioCotizado) || precioCotizado <= 0) {
                    res.status(400).json({ ok: false, error: "El precio cotizado no es valido" });
                    return;
                }

                const nota = paramTexto(req.body?.nota, 500);

                const filtro = fila.grupo_id
                    ? { texto: "grupo_id = $4", valor: fila.grupo_id }
                    : { texto: "id = $4", valor: req.params.id };

                await pool.query(
                    `UPDATE public.pedidos_publicos SET estado = 'cotizado', precio_cotizado = $1, nota_negocio = $2, respondido_at = NOW() WHERE negocio_id = $3 AND ${filtro.texto}`,
                    [precioCotizado, nota, negocio.id, filtro.valor]
                );

                const itemsGrupo = await pool.query(
                    fila.grupo_id
                        ? `SELECT producto_nombre, cantidad FROM public.pedidos_publicos WHERE negocio_id = $1 AND grupo_id = $2`
                        : `SELECT producto_nombre, cantidad FROM public.pedidos_publicos WHERE negocio_id = $1 AND id = $2`,
                    [negocio.id, fila.grupo_id || req.params.id]
                );

                if (fila.cliente_correo) {
                    enviarCorreoCotizacionRespondida(fila.cliente_correo, negocio.nombre, {
                        items: itemsGrupo.rows.map(i => ({ nombre: i.producto_nombre, cantidad: Number(i.cantidad) })),
                        precioCotizado,
                        nota,
                        urlPortal: `https://${negocio.slug}.nexoposoficial.com/portal-cliente`
                    }).catch(error => console.warn("No se pudo enviar el aviso de cotizacion respondida:", error.message));
                }

                res.json({
                    ok: true,
                    clienteTelefono: fila.cliente_telefono,
                    precioCotizado,
                    items: itemsGrupo.rows.map(i => ({ nombre: i.producto_nombre, cantidad: Number(i.cantidad) }))
                });
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

    // Igual que pedidos-publicos: ver/gestionar solicitudes ya
    // recibidas no se gatea por plan. Nunca se manda el binario de
    // las fotos en el listado JSON -- solo si existen, se piden por
    // separado con las rutas de abajo.
    app.get("/negocio-actual/solicitudes-credito", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);

            const resultado = await pool.query(
                `
                SELECT id, nombre, telefono, correo, direccion, monto_solicitado, comentario, estado,
                    (ine_frente IS NOT NULL) AS tiene_ine_frente,
                    (ine_reverso IS NOT NULL) AS tiene_ine_reverso,
                    created_at
                FROM public.solicitudes_credito
                WHERE negocio_id = $1
                ORDER BY created_at DESC
                LIMIT 50
                `,
                [negocio.id]
            );

            res.json({
                ok: true,
                solicitudes: resultado.rows.map(fila => ({
                    id: fila.id,
                    nombre: fila.nombre,
                    telefono: fila.telefono,
                    correo: fila.correo,
                    direccion: fila.direccion,
                    montoSolicitado: fila.monto_solicitado !== null ? Number(fila.monto_solicitado) : null,
                    comentario: fila.comentario,
                    estado: fila.estado,
                    tieneIneFrente: fila.tiene_ine_frente,
                    tieneIneReverso: fila.tiene_ine_reverso,
                    createdAt: fila.created_at
                }))
            });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    // Sin fallback de token-en-URL (a diferencia de las fotos de
    // producto) -- documentos de identidad solo se sirven con sesion
    // real, nunca por un token que pueda quedar en el historial del
    // navegador o en logs.
    async function servirFotoIdentificacion(req, res, pool, columnaImagen, columnaTipo) {
        try {
            const negocio = await negocioActual(req, pool);

            const resultado = await pool.query(
                `SELECT ${columnaImagen} AS imagen, ${columnaTipo} AS tipo FROM public.solicitudes_credito WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );

            const fila = resultado.rows[0];

            if (!fila || !fila.imagen) {
                res.status(404).json({ ok: false, error: "No encontrado" });
                return;
            }

            res.set("Content-Type", fila.tipo || "image/jpeg");
            res.set("Cache-Control", "no-store");
            res.send(fila.imagen);
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    }

    app.get("/negocio-actual/solicitudes-credito/:id/ine-frente", requerirAccesoNegocio, (req, res) => {
        servirFotoIdentificacion(req, res, pool, "ine_frente", "ine_frente_tipo");
    });

    app.get("/negocio-actual/solicitudes-credito/:id/ine-reverso", requerirAccesoNegocio, (req, res) => {
        servirFotoIdentificacion(req, res, pool, "ine_reverso", "ine_reverso_tipo");
    });

    app.patch("/negocio-actual/solicitudes-credito/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const estado = String(req.body?.estado || "");

            if (!["pendiente", "aprobado", "rechazado"].includes(estado)) {
                res.status(400).json({ ok: false, error: "Estado invalido" });
                return;
            }

            await pool.query(
                `UPDATE public.solicitudes_credito SET estado = $1, revisada_at = CASE WHEN $1 <> 'pendiente' THEN NOW() ELSE revisada_at END WHERE id = $2 AND negocio_id = $3`,
                [estado, req.params.id, negocio.id]
            );

            res.json({ ok: true });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    // Borrado real (fila + fotos incluidas) -- es la accion detras del
    // texto de /privacidad que dice que el negocio decide cuanto
    // tiempo conservar estos documentos.
    app.delete("/negocio-actual/solicitudes-credito/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);

            await pool.query(
                `DELETE FROM public.solicitudes_credito WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );

            res.json({ ok: true });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = {
    registrarRutas,
    servirSitioNegocio,
    servirCatalogoNegocio,
    servirProductoNegocio,
    recibirPedidoPublico,
    recibirPedidoCarritoPublico,
    servirSolicitudCreditoNegocio,
    recibirSolicitudCreditoPublica,
    servirPortalClienteNegocio,
    iniciarSesionClientePublico,
    servirFavoritosNegocio,
    favoritosJson,
    servirComparadorNegocio,
    comparadorJson,
    // Fase 1 "Market embebido" -- la costura entre Market y el sitio de
    // cada tienda (market-tienda-server.js) reusa estas piezas de datos
    // y de vista en vez de duplicarlas.
    resolverSitioPublico,
    contarSenalCompradora,
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
    modalCarritoTenantHtml,
    // Nexo Market -- /market/mi-cuenta (market-cuenta-server.js) reusa
    // el mismo lenguaje visual "tipo Amazon" ya validado en
    // /portal-cliente en vez de duplicar el CSS/iconos.
    estilosPortalClienteHtml,
    ICONO_PORTAL_RESUMEN,
    ICONO_PORTAL_PEDIDOS,
    ICONO_PORTAL_CREDITO,
    ICONO_PORTAL_DIRECCION,
    ICONO_PORTAL_PAGO,
    ICONO_PORTAL_USUARIO,
    ICONO_PORTAL_SEGURIDAD,
    ICONO_PORTAL_AYUDA,
    ICONO_PORTAL_SALIR,
    ICONO_PORTAL_TIENDA,
    ICONO_TENANT_FAVORITO
};

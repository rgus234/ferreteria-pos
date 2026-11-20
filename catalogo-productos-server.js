// Catalogo de productos del negocio en PDF: se eligen categorias (las de Nexo) y se genera un catalogo para mandar o imprimir,
// con foto, nombre, descripcion, clave, precio y codigo de barras escaneable de cada producto.
// El dueño lo personaliza: logo y nombre de su negocio, color, tipografia, diseno (tarjetas, compacto o lista), encabezado y portada.
//
// Se arma con la categoria de Nexo de cada producto (categoria_nexo_id), no con el texto de categoria, que cada tienda escribia distinto.
// No cambia ningun dato: solo lee.
//   GET  /catalogo-productos/opciones  departamentos > subcategorias con cuantos productos (y cuantos con foto) tiene cada una, marcas,
//                                      datos del negocio (nombre, logo, color, contacto) y tipografias disponibles
//   POST /catalogo-productos/contar    cuantos productos salen con esos filtros
//   POST /catalogo-productos/pdf       el PDF
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const sharp = require("sharp");
const AdmZip = require("adm-zip");
const { responderError } = require("./error-utils");

const MAX_PRODUCTOS = 1000;
// Tope de todo lo que se puede armar "por secciones" de una vez (un PDF por departamento, en un ZIP).
const MAX_TOTAL_SECCIONES = 5000;
const MAX_LOGO_BYTES = 2.5 * 1024 * 1024;

// ---------- filtros y consulta ----------

function filtrosDe(cuerpo = {}) {
    const ids = (Array.isArray(cuerpo.subcategoriaIds) ? cuerpo.subcategoriaIds : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 600);
    const marcas = (Array.isArray(cuerpo.marcas) ? cuerpo.marcas : []).map(m => String(m || "").trim().toLowerCase()).filter(Boolean).slice(0, 100);

    return {
        ids,
        sinCategoria: cuerpo.incluirSinCategoria === true,
        marcas,
        soloConFoto: cuerpo.soloConFoto === true,
        soloConExistencia: cuerpo.soloConExistencia === true,
        incluirOcultos: cuerpo.incluirOcultos === true
    };
}

const UNION_FOTO = `LEFT JOIN public.fotos_producto fp ON fp.negocio_id = p.negocio_id AND fp.codigo = regexp_replace(upper(COALESCE(p.codigo, '')), '[^A-Z0-9]', '', 'g')`;

async function consultar(pool, negocioId, f, limite) {
    const r = await pool.query(`
        SELECT p.id, p.nombre, p.codigo, p.marca, p.descripcion, p.unidad_venta, p.precio, p.precio_publico, p.precio_mayoreo, p.precio_distribuidor, p.stock,
               cn.departamento, cn.nombre AS subcategoria, cn.orden, (fp.codigo IS NOT NULL) AS con_foto,
               regexp_replace(upper(COALESCE(p.codigo, '')), '[^A-Z0-9]', '', 'g') AS codigo_foto
          FROM public.productos p
          LEFT JOIN public.categorias_nexo cn ON cn.id = p.categoria_nexo_id
          ${UNION_FOTO}
         WHERE p.negocio_id = $1
           AND (p.categoria_nexo_id = ANY($2::int[]) OR ($3::boolean AND p.categoria_nexo_id IS NULL))
           AND (p.visible_pos IS DISTINCT FROM false OR $4::boolean)
           AND (cardinality($5::text[]) = 0 OR lower(btrim(COALESCE(p.marca, ''))) = ANY($5::text[]))
           AND (NOT $6::boolean OR fp.codigo IS NOT NULL)
           AND (NOT $7::boolean OR p.stock > 0)
         ORDER BY cn.departamento NULLS LAST, cn.orden NULLS LAST, cn.nombre NULLS LAST, p.nombre
         LIMIT $8`,
        [negocioId, f.ids, f.sinCategoria, f.incluirOcultos, f.marcas, f.soloConFoto, f.soloConExistencia, limite]);

    return r.rows;
}

// Parte los productos (ya ordenados por departamento) en secciones: un PDF por departamento, y si un departamento
// pasa del tope se parte en varios para que ningun PDF salga demasiado grande.
function seccionesDe(productos, maximo = MAX_PRODUCTOS) {
    const porDepto = new Map();

    for (const p of productos) {
        const nombre = p.departamento || "Sin categoria";
        if (!porDepto.has(nombre)) porDepto.set(nombre, []);
        porDepto.get(nombre).push(p);
    }

    const secciones = [];

    for (const [nombre, lista] of porDepto) {
        const partes = Math.ceil(lista.length / maximo);
        const tam = Math.ceil(lista.length / partes);
        for (let i = 0; i < partes; i++) secciones.push({ nombre: partes > 1 ? `${nombre} ${i + 1} de ${partes}` : nombre, productos: lista.slice(i * tam, (i + 1) * tam) });
    }

    return secciones;
}

// Las fotos de esos productos: una sola consulta, y cada una se reduce para que el PDF no pese de mas.
async function cargarFotos(pool, negocioId, productos) {
    const codigos = [...new Set(productos.filter(p => p.con_foto).map(p => p.codigo_foto))];
    const fotos = new Map();

    if (codigos.length) {
        const filas = (await pool.query(`SELECT codigo, imagen_principal FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2::text[])`, [negocioId, codigos])).rows;
        for (let i = 0; i < filas.length; i += 12) {
            await Promise.all(filas.slice(i, i + 12).map(async fila => { const jpeg = fila.imagen_principal ? await fotoJpeg(fila.imagen_principal) : null; if (jpeg) fotos.set(fila.codigo, jpeg); }));
        }
    }

    return fotos;
}

// ---------- estilo (lo que el dueño personaliza) ----------

// Las 3 tipografias que trae todo PDF, mas las que se pongan como archivos en fonts-catalogo/ (<id>-Regular.ttf y <id>-Bold.ttf).
const FUENTES_BASE = {
    moderna: { nombre: "Moderna", regular: "Helvetica", bold: "Helvetica-Bold" },
    clasica: { nombre: "Clásica", regular: "Times-Roman", bold: "Times-Bold" },
    maquina: { nombre: "Máquina de escribir", regular: "Courier", bold: "Courier-Bold" }
};
const DIR_FUENTES = path.join(__dirname, "public", "fonts-catalogo");

function fuentesInstaladas() {
    const salida = {};
    try {
        fs.readdirSync(DIR_FUENTES).forEach(archivo => {
            const m = archivo.match(/^([a-z0-9-]+)-Regular\.(ttf|otf|woff)$/i);
            if (!m) return;
            const id = m[1].toLowerCase();
            const bold = path.join(DIR_FUENTES, `${m[1]}-Bold.${m[2]}`);
            if (!fs.existsSync(bold)) return;
            salida[id] = { nombre: id.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" "), regular: path.join(DIR_FUENTES, archivo), bold, ttf: true };
        });
    } catch (error) { /* sin carpeta de tipografias: solo las 3 de siempre */ }
    return salida;
}

const todasLasFuentes = () => ({ ...FUENTES_BASE, ...fuentesInstaladas() });

const DISENOS = { tarjetas: { columnas: 3, alto: 205 }, compacto: { columnas: 4, alto: 172 }, lista: { columnas: 1, alto: 62 } };

function estiloDe(e = {}) {
    const fuentes = todasLasFuentes();
    const color = /^#[0-9a-fA-F]{6}$/.test(String(e.color || "")) ? String(e.color).toLowerCase() : "#1d4ed8";

    return {
        color,
        fuente: fuentes[e.tipografia] ? e.tipografia : "moderna",
        diseno: DISENOS[e.diseno] ? e.diseno : "tarjetas",
        encabezado: e.encabezado === "linea" ? "linea" : "banda",
        portada: e.portada === true,
        esquinas: e.esquinas === "rectas" ? "rectas" : "redondeadas",
        logo: typeof e.logo === "string" ? e.logo : "negocio",
        nombreNegocio: String(e.nombreNegocio || "").trim().slice(0, 60),
        contacto: String(e.contacto || "").trim().slice(0, 140)
    };
}

const aRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminancia = hex => { const [r, g, b] = aRgb(hex).map(v => v / 255); return 0.299 * r + 0.587 * g + 0.114 * b; };
const textoSobre = hex => (luminancia(hex) > 0.62 ? "#0f172a" : "#ffffff");
const mezclar = (hex, con, k) => { const a = aRgb(hex); const b = aRgb(con); return "#" + a.map((v, i) => Math.round(v * (1 - k) + b[i] * k).toString(16).padStart(2, "0")).join(""); };

async function prepararLogo(valor, logoNegocio) {
    const origen = valor === "ninguno" ? null : (valor && valor !== "negocio" ? valor : logoNegocio);
    const m = String(origen || "").match(/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return null;

    try {
        const buffer = Buffer.from(m[1], "base64");
        if (!buffer.length || buffer.length > MAX_LOGO_BYTES) return null;
        return await sharp(buffer).resize({ width: 600, height: 300, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch (error) {
        return null;
    }
}

// ---------- dibujo ----------

const PAGINA = { ancho: 612, alto: 792, margen: 36 };
const ANCHO_UTIL = PAGINA.ancho - PAGINA.margen * 2;
const FIN_Y = PAGINA.alto - 50;
const SEPARACION = 12;
const GRIS = "#64748b";
const TINTA = "#0f172a";

// Las letras estandar del PDF no traen todos los simbolos: se cambian los mas comunes y se quita lo raro.
function limpiar(texto) {
    return String(texto ?? "")
        .replace(/[‘’‚′]/g, "'")
        .replace(/[“”„″]/g, '"')
        .replace(/[–—]/g, "-")
        .replace(/…/g, "...")
        .replace(/[^\x20-\x7E -ÿ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function ajustar(doc, texto, ancho, maxLineas, fuente, tamano) {
    doc.font(fuente).fontSize(tamano);
    const palabras = limpiar(texto).split(" ").filter(Boolean);
    const lineas = [];
    let actual = "";

    for (const palabra of palabras) {
        const prueba = actual ? `${actual} ${palabra}` : palabra;
        if (doc.widthOfString(prueba) <= ancho) { actual = prueba; continue; }
        if (actual) lineas.push(actual);
        actual = palabra;
        if (lineas.length === maxLineas) break;
    }

    if (lineas.length < maxLineas && actual) lineas.push(actual);

    const recortado = lineas.length > maxLineas || palabras.join(" ") !== lineas.join(" ");
    const salida = lineas.slice(0, maxLineas);

    if (recortado && salida.length) {
        let ultima = salida[salida.length - 1];
        while (ultima.length > 1 && doc.widthOfString(ultima + "...") > ancho) ultima = ultima.slice(0, -1);
        salida[salida.length - 1] = ultima.replace(/\.+$/, "") + "...";
    }

    return salida;
}

function precioDe(p, nivel) {
    const aNumero = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
    if (nivel === "mayoreo") return aNumero(p.precio_mayoreo);
    if (nivel === "distribuidor") return aNumero(p.precio_distribuidor);
    return aNumero(p.precio_publico) ?? aNumero(p.precio);
}

const dinero = n => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SUFIJO_UNIDAD = { kg: "/ kg", kilo: "/ kg", metro: "/ m", litro: "/ l", gramo: "/ g" };

async function fotoJpeg(buffer) {
    try {
        return await sharp(buffer).rotate().resize({ width: 420, height: 300, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();
    } catch (error) {
        return null;
    }
}

async function imagenBarras(codigo) {
    const texto = String(codigo || "").trim();
    if (!texto) return null;

    const digitos = /^\d+$/.test(texto);
    const intentos = [];

    if (digitos && texto.length === 13) intentos.push("ean13");
    else if (digitos && texto.length === 12) intentos.push("upca");
    else if (digitos && texto.length === 8) intentos.push("ean8");
    if (/^[\x20-\x7E]+$/.test(texto)) intentos.push("code128");

    for (const bcid of intentos) {
        try {
            return await bwipjs.toBuffer({ bcid, text: texto, scale: 3, height: 9, includetext: true, textsize: 9, textxalign: "center", paddingwidth: 2, paddingheight: 1 });
        } catch (error) { /* se prueba el siguiente tipo de codigo */ }
    }

    return null;
}

// Cada diseno dibuja un producto en su recuadro (x, y, w, h). ctx = { doc, F, estilo, opciones, radio }
function textoLineas(ctx, lineas, fuente, tamano, color, x, y, ancho, paso) {
    ctx.doc.fillColor(color).font(fuente).fontSize(tamano);
    lineas.forEach((linea, i) => ctx.doc.text(linea, x, y + i * paso, { width: ancho, lineBreak: false }));
}

function dibujarFoto(ctx, p, foto, x, y, w, h) {
    const { doc, F, estilo } = ctx;
    if (foto) {
        try { doc.image(foto, x, y, { fit: [w, h], align: "center", valign: "center" }); return; }
        catch (error) { /* se dibuja la letra */ }
    }
    doc.roundedRect(x, y, w, h, ctx.radio ? 6 : 0).fillColor(mezclar(estilo.color, "#ffffff", 0.9)).fill();
    doc.fillColor(mezclar(estilo.color, "#ffffff", 0.45)).font(F.bold).fontSize(Math.min(28, h * 0.4)).text(limpiar(p.nombre).charAt(0).toUpperCase() || "?", x, y + h / 2 - Math.min(28, h * 0.4) / 2 - 1, { width: w, align: "center", lineBreak: false });
}

function textoPrecio(ctx, p, x, y, ancho, tamano, alinear) {
    const { doc, F, estilo, opciones } = ctx;
    const precio = precioDe(p, opciones.nivelPrecio);
    const sufijo = SUFIJO_UNIDAD[String(p.unidad_venta || "").toLowerCase()] || "";
    const texto = precio ? dinero(precio) + (sufijo ? " " + sufijo : "") : "Consultar precio";

    if (precio) {
        doc.fillColor(estilo.color).font(F.bold).fontSize(tamano);
        const principal = dinero(precio);
        if (alinear === "right") {
            doc.fillColor(GRIS).font(F.regular).fontSize(Math.max(6.5, tamano * 0.58));
            const anchoSufijo = sufijo ? doc.widthOfString(" " + sufijo) : 0;
            doc.fillColor(estilo.color).font(F.bold).fontSize(tamano).text(principal, x, y, { width: ancho - anchoSufijo, align: "right", lineBreak: false });
            if (sufijo) doc.fillColor(GRIS).font(F.regular).fontSize(Math.max(6.5, tamano * 0.58)).text(" " + sufijo, x + ancho - anchoSufijo, y + tamano * 0.28, { width: anchoSufijo, lineBreak: false });
        } else {
            doc.text(principal, x, y, { width: ancho, lineBreak: false, continued: Boolean(sufijo) });
            if (sufijo) doc.fillColor(GRIS).font(F.regular).fontSize(Math.max(6.5, tamano * 0.58)).text(" " + sufijo, { lineBreak: false });
        }
    } else {
        doc.fillColor("#94a3b8").font(F.bold).fontSize(Math.max(7.5, tamano * 0.7)).text(texto, x, y + 2, { width: ancho, align: alinear === "right" ? "right" : "left", lineBreak: false });
    }
}

function dibujarTarjeta(ctx, p, foto, barras, x, y, w, h) {
    const { doc, F, estilo, opciones } = ctx;
    const interior = w - 16;

    doc.roundedRect(x, y, w, h, ctx.radio ? 8 : 0).lineWidth(0.8).strokeColor(mezclar(estilo.color, "#ffffff", 0.78)).stroke();
    dibujarFoto(ctx, p, foto, x + 8, y + 8, interior, 92);

    let cursor = y + 106;
    textoLineas(ctx, ajustar(doc, p.nombre, interior, 2, F.bold, 9), F.bold, 9, TINTA, x + 8, cursor, interior, 11);
    cursor += 24;

    const lineasDescripcion = opciones.mostrarCodigoBarras ? 2 : 4;
    const descripcion = limpiar(p.descripcion);
    if (descripcion) textoLineas(ctx, ajustar(doc, descripcion, interior, lineasDescripcion, F.regular, 7.2), F.regular, 7.2, GRIS, x + 8, cursor, interior, 9);

    const meta = [p.codigo ? `Cod. ${limpiar(p.codigo)}` : "", limpiar(p.marca)].filter(Boolean).join("  |  ");
    if (meta) textoLineas(ctx, ajustar(doc, meta, interior, 1, F.regular, 6.8), F.regular, 6.8, "#94a3b8", x + 8, y + h - (opciones.mostrarCodigoBarras ? 66 : 38), interior, 9);

    if (opciones.mostrarPrecio) textoPrecio(ctx, p, x + 8, y + h - (opciones.mostrarCodigoBarras ? 55 : 28), interior, 13, "left");

    if (opciones.mostrarCodigoBarras && barras) {
        try { doc.image(barras, x + 8, y + h - 38, { fit: [interior, 32], align: "center", valign: "center" }); } catch (error) { /* sin codigo de barras en esta tarjeta */ }
    }
}

function dibujarCompacta(ctx, p, foto, barras, x, y, w, h) {
    const { doc, F, estilo, opciones } = ctx;
    const interior = w - 12;

    doc.roundedRect(x, y, w, h, ctx.radio ? 7 : 0).lineWidth(0.8).strokeColor(mezclar(estilo.color, "#ffffff", 0.78)).stroke();
    dibujarFoto(ctx, p, foto, x + 6, y + 6, interior, 68);

    textoLineas(ctx, ajustar(doc, p.nombre, interior, 2, F.bold, 7.6), F.bold, 7.6, TINTA, x + 6, y + 80, interior, 9);
    if (p.codigo) textoLineas(ctx, ajustar(doc, "Cod. " + limpiar(p.codigo), interior, 1, F.regular, 6.2), F.regular, 6.2, "#94a3b8", x + 6, y + 100, interior, 8);
    if (opciones.mostrarPrecio) textoPrecio(ctx, p, x + 6, y + 111, interior, 11, "left");

    if (opciones.mostrarCodigoBarras && barras) {
        try { doc.image(barras, x + 6, y + h - 36, { fit: [interior, 30], align: "center", valign: "center" }); } catch (error) { /* sin codigo */ }
    }
}

function dibujarFila(ctx, p, foto, barras, x, y, w, h) {
    const { doc, F, estilo, opciones } = ctx;
    const derecha = 140;
    const textoAncho = w - 64 - derecha - 8;

    doc.moveTo(x, y + h).lineTo(x + w, y + h).lineWidth(0.6).strokeColor(mezclar(estilo.color, "#ffffff", 0.78)).stroke();
    dibujarFoto(ctx, p, foto, x + 4, y + 6, 52, h - 12);

    textoLineas(ctx, ajustar(doc, p.nombre, textoAncho, 1, F.bold, 10), F.bold, 10, TINTA, x + 64, y + 8, textoAncho, 11);
    const descripcion = limpiar(p.descripcion);
    if (descripcion) textoLineas(ctx, ajustar(doc, descripcion, textoAncho, 2, F.regular, 7.6), F.regular, 7.6, GRIS, x + 64, y + 22, textoAncho, 9.5);
    const meta = [p.codigo ? `Cod. ${limpiar(p.codigo)}` : "", limpiar(p.marca)].filter(Boolean).join("  |  ");
    if (meta) textoLineas(ctx, ajustar(doc, meta, textoAncho, 1, F.regular, 7), F.regular, 7, "#94a3b8", x + 64, y + h - 15, textoAncho, 9);

    if (opciones.mostrarPrecio) textoPrecio(ctx, p, x + w - derecha, y + (opciones.mostrarCodigoBarras ? 6 : h / 2 - 8), derecha - 4, 13, "right");
    if (opciones.mostrarCodigoBarras && barras) {
        try { doc.image(barras, x + w - derecha, y + 22, { fit: [derecha - 4, h - 26], align: "right", valign: "center" }); } catch (error) { /* sin codigo */ }
    }
}

const DIBUJAR = { tarjetas: dibujarTarjeta, compacto: dibujarCompacta, lista: dibujarFila };

async function generarPdf({ negocioNombre, titulo, productos, fotos, opciones, estilo: estiloEntrada, logoNegocio, contactoNegocio }) {
    const estilo = estiloDe(estiloEntrada);
    const nombre = limpiar(estilo.nombreNegocio || negocioNombre) || "Catalogo";
    const contacto = limpiar(estilo.contacto || contactoNegocio || "");
    const logo = await prepararLogo(estilo.logo, logoNegocio);
    const diseno = DISENOS[estilo.diseno];
    const colorTexto = textoSobre(estilo.color);

    const doc = new PDFDocument({ size: [PAGINA.ancho, PAGINA.alto], margin: PAGINA.margen, bufferPages: true, info: { Title: limpiar(titulo), Author: nombre } });
    const trozos = [];
    doc.on("data", t => trozos.push(t));
    const terminado = new Promise(resolver => doc.on("end", () => resolver(Buffer.concat(trozos))));

    // tipografia
    const fuente = todasLasFuentes()[estilo.fuente];
    let F;
    if (fuente.ttf) { doc.registerFont("cat-regular", fuente.regular); doc.registerFont("cat-bold", fuente.bold); F = { regular: "cat-regular", bold: "cat-bold" }; }
    else F = { regular: fuente.regular, bold: fuente.bold };

    const radio = estilo.esquinas === "redondeadas";
    const ctx = { doc, F, estilo, opciones, radio };
    const fecha = new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    const tituloLimpio = limpiar(titulo);

    // portada (opcional)
    if (estilo.portada) {
        doc.rect(0, 0, PAGINA.ancho, 420).fillColor(estilo.color).fill();
        doc.rect(0, 420, PAGINA.ancho, 6).fillColor(mezclar(estilo.color, "#000000", 0.25)).fill();
        if (logo) {
            doc.roundedRect(PAGINA.ancho / 2 - 130, 92, 260, 130, radio ? 16 : 0).fillColor("#ffffff").fill();
            try { doc.image(logo, PAGINA.ancho / 2 - 118, 100, { fit: [236, 114], align: "center", valign: "center" }); } catch (error) { /* sin logo */ }
        }
        const yNombre = logo ? 252 : 170;
        doc.fillColor(colorTexto).font(F.bold).fontSize(34).text(nombre, 50, yNombre, { width: PAGINA.ancho - 100, align: "center" });
        doc.fillColor(colorTexto).font(F.regular).fontSize(15).text(tituloLimpio, 50, doc.y + 8, { width: PAGINA.ancho - 100, align: "center" });
        doc.fillColor(TINTA).font(F.regular).fontSize(11).text(fecha, 50, 470, { width: PAGINA.ancho - 100, align: "center" });
        if (contacto) doc.fillColor(GRIS).font(F.regular).fontSize(11).text(contacto, 80, 500, { width: PAGINA.ancho - 160, align: "center" });
        doc.addPage();
    }

    // encabezado de cada pagina
    const inicioY = estilo.encabezado === "banda" ? 76 : 82;
    const encabezado = () => {
        if (estilo.encabezado === "banda") {
            doc.rect(0, 0, PAGINA.ancho, 58).fillColor(estilo.color).fill();
            let xTexto = PAGINA.margen;
            if (logo) {
                doc.roundedRect(PAGINA.margen, 9, 62, 40, radio ? 6 : 0).fillColor("#ffffff").fill();
                try { doc.image(logo, PAGINA.margen + 3, 11, { fit: [56, 36], align: "center", valign: "center" }); } catch (error) { /* sin logo */ }
                xTexto = PAGINA.margen + 74;
            }
            doc.fillColor(colorTexto).font(F.bold).fontSize(15).text(nombre, xTexto, 14, { width: 300, lineBreak: false });
            doc.fillColor(colorTexto).font(F.regular).fontSize(9).text(tituloLimpio, xTexto, 34, { width: 300, lineBreak: false });
            doc.fillColor(colorTexto).font(F.regular).fontSize(8.5).text(fecha, PAGINA.ancho - PAGINA.margen - 160, 24, { width: 160, align: "right", lineBreak: false });
        } else {
            let xTexto = PAGINA.margen;
            if (logo) { try { doc.image(logo, PAGINA.margen, 26, { fit: [60, 38], align: "left", valign: "center" }); xTexto = PAGINA.margen + 70; } catch (error) { /* sin logo */ } }
            doc.fillColor(estilo.color).font(F.bold).fontSize(15).text(nombre, xTexto, 34, { width: 330, lineBreak: false });
            doc.fillColor(GRIS).font(F.regular).fontSize(9).text(tituloLimpio, xTexto, 53, { width: 330, lineBreak: false });
            doc.fillColor(GRIS).font(F.regular).fontSize(8.5).text(fecha, PAGINA.ancho - PAGINA.margen - 200, 38, { width: 200, align: "right", lineBreak: false });
            doc.moveTo(PAGINA.margen, 70).lineTo(PAGINA.ancho - PAGINA.margen, 70).lineWidth(1.2).strokeColor(estilo.color).stroke();
        }
    };

    const columnas = diseno.columnas;
    const gap = columnas === 1 ? 0 : (columnas === 4 ? 10 : SEPARACION);
    const anchoTarjeta = (ANCHO_UTIL - gap * (columnas - 1)) / columnas;
    const alto = diseno.alto;
    const salto = columnas === 1 ? 6 : 10;

    let y = inicioY;
    let columna = 0;
    encabezado();

    const nuevaPagina = () => { doc.addPage(); encabezado(); y = inicioY; columna = 0; };
    const cerrarFila = () => { if (columna > 0) { y += alto + salto; columna = 0; } };

    let departamentoActual = null;
    let subcategoriaActual = null;

    for (const p of productos) {
        const departamento = p.departamento || "Sin categoria";
        const subcategoria = p.subcategoria || "";
        const cambiaDepto = departamento !== departamentoActual;
        const cambiaSub = cambiaDepto || subcategoria !== subcategoriaActual;

        if (cambiaSub) {
            cerrarFila();
            const altoTitulos = (cambiaDepto ? 28 : 0) + (subcategoria ? 18 : 0);
            if (y + altoTitulos + alto > FIN_Y) nuevaPagina();

            if (cambiaDepto) {
                doc.roundedRect(PAGINA.margen, y, ANCHO_UTIL, 22, radio ? 5 : 0).fillColor(mezclar(estilo.color, "#000000", 0.12)).fill();
                doc.fillColor(textoSobre(mezclar(estilo.color, "#000000", 0.12))).font(F.bold).fontSize(11).text(limpiar(departamento).toUpperCase(), PAGINA.margen + 10, y + 6, { width: ANCHO_UTIL - 20, lineBreak: false });
                y += 28;
            }
            if (subcategoria) {
                doc.fillColor(estilo.color).font(F.bold).fontSize(9.5).text(limpiar(subcategoria), PAGINA.margen + 2, y + 2, { width: 400, lineBreak: false });
                y += 18;
            }
            departamentoActual = departamento;
            subcategoriaActual = subcategoria;
        }

        if (y + alto > FIN_Y) nuevaPagina();

        const x = PAGINA.margen + columna * (anchoTarjeta + gap);
        const barras = opciones.mostrarCodigoBarras ? await imagenBarras(p.codigo) : null;
        DIBUJAR[estilo.diseno](ctx, p, fotos.get(p.codigo_foto) || null, barras, x, y, anchoTarjeta, alto);

        columna += 1;
        if (columna === columnas) { columna = 0; y += alto + salto; }
    }

    // pie: contacto a la izquierda y numero de pagina a la derecha (el total se sabe hasta el final)
    const rango = doc.bufferedPageRange();
    const primera = estilo.portada ? 1 : 0;
    for (let i = primera; i < rango.count; i++) {
        doc.switchToPage(rango.start + i);
        const margenInferior = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.moveTo(PAGINA.margen, PAGINA.alto - 38).lineTo(PAGINA.ancho - PAGINA.margen, PAGINA.alto - 38).lineWidth(0.5).strokeColor(mezclar(estilo.color, "#ffffff", 0.7)).stroke();
        if (contacto) doc.fillColor(GRIS).font(F.regular).fontSize(8).text(contacto, PAGINA.margen, PAGINA.alto - 30, { width: ANCHO_UTIL - 90, lineBreak: false });
        doc.fillColor("#94a3b8").font(F.regular).fontSize(8).text(`Pagina ${i - primera + 1} de ${rango.count - primera}`, PAGINA.ancho - PAGINA.margen - 90, PAGINA.alto - 30, { width: 90, align: "right", lineBreak: false });
        doc.page.margins.bottom = margenInferior;
    }

    doc.end();
    return terminado;
}

// ---------- rutas ----------

module.exports = (app, pool, requerirAccesoNegocio) => {
    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    // Nombre, logo, color y contacto del negocio: son los valores de arranque; el dueño los puede cambiar solo para este catalogo.
    async function datosNegocio(id) {
        const n = (await pool.query(`SELECT nombre, telefono, direccion, logo, color FROM public.negocios WHERE id = $1`, [id])).rows[0] || {};
        let whatsapp = "";
        try { whatsapp = (await pool.query(`SELECT whatsapp FROM public.sitio_web_config WHERE negocio_id = $1`, [id])).rows[0]?.whatsapp || ""; } catch (error) { /* sin sitio web */ }

        const contacto = [n.telefono ? `Tel. ${n.telefono}` : "", whatsapp && whatsapp !== n.telefono ? `WhatsApp ${whatsapp}` : "", n.direccion || ""].map(x => String(x).trim()).filter(Boolean).join("  |  ");
        return { nombre: n.nombre || "", logo: n.logo || "", color: /^#[0-9a-fA-F]{6}$/.test(String(n.color || "")) ? String(n.color).toLowerCase() : "", contacto };
    }

    app.get("/catalogo-productos/opciones", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);

            const subs = (await pool.query(`
                SELECT cn.id, cn.departamento, cn.nombre, cn.orden, COUNT(p.id)::int AS total, COUNT(fp.codigo)::int AS con_foto
                  FROM public.categorias_nexo cn
                  JOIN public.productos p ON p.categoria_nexo_id = cn.id AND p.negocio_id = $1 AND p.visible_pos IS DISTINCT FROM false
                  ${UNION_FOTO}
                 GROUP BY cn.id ORDER BY cn.departamento, cn.orden NULLS LAST, cn.nombre`, [id])).rows;

            const sin = (await pool.query(`
                SELECT COUNT(p.id)::int AS total, COUNT(fp.codigo)::int AS con_foto
                  FROM public.productos p ${UNION_FOTO}
                 WHERE p.negocio_id = $1 AND p.categoria_nexo_id IS NULL AND p.visible_pos IS DISTINCT FROM false`, [id])).rows[0];

            const marcas = (await pool.query(`
                SELECT btrim(marca) AS marca, COUNT(*)::int AS total
                  FROM public.productos WHERE negocio_id = $1 AND COALESCE(btrim(marca), '') <> '' AND visible_pos IS DISTINCT FROM false
                 GROUP BY btrim(marca) ORDER BY total DESC, marca LIMIT 300`, [id])).rows;

            const departamentos = [];
            subs.forEach(s => {
                let d = departamentos.find(x => x.departamento === s.departamento);
                if (!d) { d = { departamento: s.departamento, total: 0, conFoto: 0, subcategorias: [] }; departamentos.push(d); }
                d.total += s.total;
                d.conFoto += s.con_foto;
                d.subcategorias.push({ id: s.id, nombre: s.nombre, total: s.total, conFoto: s.con_foto });
            });

            const fuentes = Object.entries(todasLasFuentes()).map(([fid, f]) => ({ id: fid, nombre: f.nombre }));

            res.json({ ok: true, departamentos, sinCategoria: { total: sin.total, conFoto: sin.con_foto }, marcas, maximo: MAX_PRODUCTOS, maximoSecciones: MAX_TOTAL_SECCIONES, negocio: await datosNegocio(id), fuentes });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/catalogo-productos/contar", requerirAccesoNegocio, async (req, res) => {
        try {
            const f = filtrosDe(req.body);
            if (!f.ids.length && !f.sinCategoria) { res.json({ ok: true, total: 0, conFoto: 0, secciones: 0, maximo: MAX_PRODUCTOS }); return; }

            const filas = await consultar(pool, negocioId(req), f, MAX_TOTAL_SECCIONES + 1);
            const pasaDelTope = filas.length > MAX_TOTAL_SECCIONES;
            res.json({ ok: true, total: filas.length, conFoto: filas.filter(x => x.con_foto).length, secciones: seccionesDe(filas).length, pasaDelTope, maximo: MAX_PRODUCTOS, maximoSecciones: MAX_TOTAL_SECCIONES });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/catalogo-productos/pdf", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const cuerpo = req.body || {};
            const f = filtrosDe(cuerpo);

            if (!f.ids.length && !f.sinCategoria) { res.status(400).json({ ok: false, error: "Elige al menos una categoria." }); return; }

            const productos = await consultar(pool, id, f, MAX_PRODUCTOS + 1);

            if (!productos.length) { res.status(400).json({ ok: false, error: "Con esos filtros no hay productos." }); return; }
            if (productos.length > MAX_PRODUCTOS) { res.status(400).json({ ok: false, error: `Son mas de ${MAX_PRODUCTOS} productos para un solo catalogo. Elige menos categorias o filtra por marca.` }); return; }

            const nivel = ["publico", "mayoreo", "distribuidor"].includes(cuerpo.nivelPrecio) ? cuerpo.nivelPrecio : "publico";
            const opciones = { nivelPrecio: nivel, mostrarPrecio: cuerpo.mostrarPrecio !== false, mostrarCodigoBarras: cuerpo.mostrarCodigoBarras !== false };

            const negocio = await datosNegocio(id);
            const titulo = String(cuerpo.titulo || "").trim().slice(0, 80) || "Catalogo de productos";

            const fotos = await cargarFotos(pool, id, productos);

            const pdf = await generarPdf({ negocioNombre: negocio.nombre, titulo, productos, fotos, opciones, estilo: cuerpo.estilo, logoNegocio: negocio.logo, contactoNegocio: negocio.contacto });
            const archivo = titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "catalogo";

            res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${archivo}.pdf"`, "Content-Length": pdf.length, "Cache-Control": "no-store", "X-Productos": String(productos.length) });
            res.send(pdf);
        } catch (error) {
            responderError(res, error);
        }
    });

    // Catalogo "por secciones": un PDF por departamento, todos juntos en un ZIP. Se arma de a uno para no llenar la memoria.
    app.post("/catalogo-productos/secciones", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const cuerpo = req.body || {};
            const f = filtrosDe(cuerpo);

            if (!f.ids.length && !f.sinCategoria) { res.status(400).json({ ok: false, error: "Elige al menos una categoria." }); return; }

            const productos = await consultar(pool, id, f, MAX_TOTAL_SECCIONES + 1);

            if (!productos.length) { res.status(400).json({ ok: false, error: "Con esos filtros no hay productos." }); return; }
            if (productos.length > MAX_TOTAL_SECCIONES) { res.status(400).json({ ok: false, error: `Son mas de ${MAX_TOTAL_SECCIONES} productos. Elige menos categorias o filtra por marca.` }); return; }

            const nivel = ["publico", "mayoreo", "distribuidor"].includes(cuerpo.nivelPrecio) ? cuerpo.nivelPrecio : "publico";
            const opciones = { nivelPrecio: nivel, mostrarPrecio: cuerpo.mostrarPrecio !== false, mostrarCodigoBarras: cuerpo.mostrarCodigoBarras !== false };
            const negocio = await datosNegocio(id);
            const titulo = String(cuerpo.titulo || "").trim().slice(0, 80) || "Catalogo de productos";
            const limpio = texto => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "catalogo";
            const secciones = seccionesDe(productos);
            const zip = new AdmZip();

            for (let i = 0; i < secciones.length; i++) {
                const seccion = secciones[i];
                const fotos = await cargarFotos(pool, id, seccion.productos);
                const pdf = await generarPdf({ negocioNombre: negocio.nombre, titulo: `${titulo} - ${seccion.nombre}`, productos: seccion.productos, fotos, opciones, estilo: cuerpo.estilo, logoNegocio: negocio.logo, contactoNegocio: negocio.contacto });
                zip.addFile(`${String(i + 1).padStart(2, "0")}-${limpio(seccion.nombre)}.pdf`, pdf);
            }

            const archivo = zip.toBuffer();
            res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${limpio(titulo)}-por-secciones.zip"`, "Content-Length": archivo.length, "Cache-Control": "no-store", "X-Productos": String(productos.length), "X-Secciones": String(secciones.length) });
            res.send(archivo);
        } catch (error) {
            responderError(res, error);
        }
    });
};

module.exports.seccionesDe = seccionesDe;
module.exports.generarPdf = generarPdf;
module.exports.filtrosDe = filtrosDe;
module.exports.consultar = consultar;
module.exports.fotoJpeg = fotoJpeg;
module.exports.estiloDe = estiloDe;

// Catalogo de productos del negocio en PDF: se eligen categorias (las de Nexo) y se genera un catalogo para mandar o imprimir,
// con foto, nombre, descripcion, clave, precio y codigo de barras escaneable de cada producto.
//
// Se arma con la categoria de Nexo de cada producto (categoria_nexo_id), no con el texto de categoria, que cada tienda escribia distinto.
// No cambia ningun dato: solo lee.
//   GET  /catalogo-productos/opciones  departamentos > subcategorias con cuantos productos (y cuantos con foto) tiene cada una, marcas
//   POST /catalogo-productos/contar    cuantos productos salen con esos filtros
//   POST /catalogo-productos/pdf       el PDF
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const sharp = require("sharp");
const { responderError } = require("./error-utils");

const MAX_PRODUCTOS = 400;

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

// ---------- dibujo ----------

const PAGINA = { ancho: 612, alto: 792, margen: 36 };
const COLUMNAS = 3;
const SEPARACION = 12;
const ANCHO_TARJETA = (PAGINA.ancho - PAGINA.margen * 2 - SEPARACION * (COLUMNAS - 1)) / COLUMNAS;
const ALTO_TARJETA = 205;
const INICIO_Y = 82;
const FIN_Y = PAGINA.alto - 50;
const AZUL = "#1d4ed8";

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

function dibujarTarjeta(doc, p, foto, barras, x, y, opciones) {
    const w = ANCHO_TARJETA;
    const interior = w - 16;

    doc.roundedRect(x, y, w, ALTO_TARJETA, 8).lineWidth(0.7).strokeColor("#dbe3ef").stroke();

    // foto
    const cajaFoto = { x: x + 8, y: y + 8, w: interior, h: 92 };
    if (foto) {
        try { doc.image(foto, cajaFoto.x, cajaFoto.y, { fit: [cajaFoto.w, cajaFoto.h], align: "center", valign: "center" }); }
        catch (error) { foto = null; }
    }
    if (!foto) {
        doc.roundedRect(cajaFoto.x, cajaFoto.y, cajaFoto.w, cajaFoto.h, 6).fillColor("#f1f5f9").fill();
        doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(28).text(limpiar(p.nombre).charAt(0).toUpperCase() || "?", cajaFoto.x, cajaFoto.y + 30, { width: cajaFoto.w, align: "center", lineBreak: false });
    }

    let cursor = y + 106;

    // nombre
    const nombre = ajustar(doc, p.nombre, interior, 2, "Helvetica-Bold", 9);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9);
    nombre.forEach((linea, i) => doc.text(linea, x + 8, cursor + i * 11, { width: interior, lineBreak: false }));
    cursor += 24;

    // descripcion (3 lineas si no hay codigo de barras; 2 si lo hay)
    const lineasDescripcion = opciones.mostrarCodigoBarras ? 2 : 4;
    const descripcion = limpiar(p.descripcion);
    if (descripcion) {
        const lineas = ajustar(doc, descripcion, interior, lineasDescripcion, "Helvetica", 7.2);
        doc.fillColor("#64748b").font("Helvetica").fontSize(7.2);
        lineas.forEach((linea, i) => doc.text(linea, x + 8, cursor + i * 9, { width: interior, lineBreak: false }));
    }
    cursor += lineasDescripcion * 9 + 3;

    // clave / marca
    const meta = [p.codigo ? `Cod. ${limpiar(p.codigo)}` : "", limpiar(p.marca)].filter(Boolean).join("  |  ");
    if (meta) {
        const [linea] = ajustar(doc, meta, interior, 1, "Helvetica", 6.8);
        doc.fillColor("#94a3b8").font("Helvetica").fontSize(6.8).text(linea || "", x + 8, y + ALTO_TARJETA - (opciones.mostrarCodigoBarras ? 66 : 38), { width: interior, lineBreak: false });
    }

    // precio
    if (opciones.mostrarPrecio) {
        const precio = precioDe(p, opciones.nivelPrecio);
        const sufijo = SUFIJO_UNIDAD[String(p.unidad_venta || "").toLowerCase()] || "";
        const yPrecio = y + ALTO_TARJETA - (opciones.mostrarCodigoBarras ? 55 : 28);
        doc.fillColor(precio ? AZUL : "#94a3b8").font("Helvetica-Bold").fontSize(precio ? 13 : 9).text(precio ? dinero(precio) : "Consultar precio", x + 8, yPrecio, { width: interior, lineBreak: false, continued: Boolean(precio && sufijo) });
        if (precio && sufijo) doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(" " + sufijo, { lineBreak: false });
    }

    // codigo de barras
    if (opciones.mostrarCodigoBarras && barras) {
        try { doc.image(barras, x + 8, y + ALTO_TARJETA - 38, { fit: [interior, 32], align: "center", valign: "center" }); }
        catch (error) { /* sin codigo de barras en esta tarjeta */ }
    }
}

async function generarPdf({ negocioNombre, titulo, productos, fotos, opciones }) {
    const doc = new PDFDocument({ size: [PAGINA.ancho, PAGINA.alto], margin: PAGINA.margen, bufferPages: true, info: { Title: limpiar(titulo), Author: limpiar(negocioNombre) } });
    const trozos = [];
    doc.on("data", t => trozos.push(t));
    const terminado = new Promise(resolver => doc.on("end", () => resolver(Buffer.concat(trozos))));

    const fecha = new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

    const encabezado = () => {
        doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(15).text(limpiar(negocioNombre) || "Catalogo", PAGINA.margen, 34, { width: 330, lineBreak: false });
        doc.fillColor("#64748b").font("Helvetica").fontSize(9).text(limpiar(titulo), PAGINA.margen, 53, { width: 330, lineBreak: false });
        doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(fecha, PAGINA.ancho - PAGINA.margen - 200, 38, { width: 200, align: "right", lineBreak: false });
        doc.moveTo(PAGINA.margen, 70).lineTo(PAGINA.ancho - PAGINA.margen, 70).lineWidth(1.2).strokeColor(AZUL).stroke();
    };

    let y = INICIO_Y;
    let columna = 0;
    encabezado();

    const nuevaPagina = () => { doc.addPage(); encabezado(); y = INICIO_Y; columna = 0; };
    const cerrarFila = () => { if (columna > 0) { y += ALTO_TARJETA + 10; columna = 0; } };

    let departamentoActual = null;
    let subcategoriaActual = null;

    for (const p of productos) {
        const departamento = p.departamento || "Sin categoria";
        const subcategoria = p.subcategoria || "";
        const cambiaDepto = departamento !== departamentoActual;
        const cambiaSub = cambiaDepto || subcategoria !== subcategoriaActual;

        if (cambiaSub) {
            cerrarFila();
            const alto = (cambiaDepto ? 26 : 0) + (subcategoria ? 18 : 0);
            if (y + alto + ALTO_TARJETA > FIN_Y) nuevaPagina();

            if (cambiaDepto) {
                doc.roundedRect(PAGINA.margen, y, PAGINA.ancho - PAGINA.margen * 2, 22, 5).fillColor(AZUL).fill();
                doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text(limpiar(departamento).toUpperCase(), PAGINA.margen + 10, y + 6, { width: PAGINA.ancho - PAGINA.margen * 2 - 20, lineBreak: false });
                y += 28;
            }
            if (subcategoria) {
                doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9.5).text(limpiar(subcategoria), PAGINA.margen + 2, y + 2, { width: 400, lineBreak: false });
                y += 18;
            }
            departamentoActual = departamento;
            subcategoriaActual = subcategoria;
        }

        if (y + ALTO_TARJETA > FIN_Y) nuevaPagina();

        const x = PAGINA.margen + columna * (ANCHO_TARJETA + SEPARACION);
        const barras = opciones.mostrarCodigoBarras ? await imagenBarras(p.codigo) : null;
        dibujarTarjeta(doc, p, fotos.get(p.codigo_foto) || null, barras, x, y, opciones);

        columna += 1;
        if (columna === COLUMNAS) { columna = 0; y += ALTO_TARJETA + 10; }
    }

    // pie con el numero de pagina (el total se sabe hasta el final)
    const rango = doc.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
        doc.switchToPage(rango.start + i);
        const margenInferior = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.fillColor("#94a3b8").font("Helvetica").fontSize(8).text(`Pagina ${i + 1} de ${rango.count}`, PAGINA.margen, PAGINA.alto - 30, { width: PAGINA.ancho - PAGINA.margen * 2, align: "center", lineBreak: false });
        doc.page.margins.bottom = margenInferior;
    }

    doc.end();
    return terminado;
}

// ---------- rutas ----------

module.exports = (app, pool, requerirAccesoNegocio) => {
    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

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

            res.json({ ok: true, departamentos, sinCategoria: { total: sin.total, conFoto: sin.con_foto }, marcas, maximo: MAX_PRODUCTOS });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/catalogo-productos/contar", requerirAccesoNegocio, async (req, res) => {
        try {
            const f = filtrosDe(req.body);
            if (!f.ids.length && !f.sinCategoria) { res.json({ ok: true, total: 0, conFoto: 0, maximo: MAX_PRODUCTOS }); return; }

            const filas = await consultar(pool, negocioId(req), f, 5000);
            res.json({ ok: true, total: filas.length, conFoto: filas.filter(x => x.con_foto).length, maximo: MAX_PRODUCTOS });
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

            const negocio = (await pool.query(`SELECT nombre FROM public.negocios WHERE id = $1`, [id])).rows[0];
            const titulo = String(cuerpo.titulo || "").trim().slice(0, 80) || "Catalogo de productos";

            // fotos: una sola consulta, y cada una se reduce para que el PDF no pese de mas
            const codigos = [...new Set(productos.filter(p => p.con_foto).map(p => p.codigo_foto))];
            const fotos = new Map();

            if (codigos.length) {
                const filas = (await pool.query(`SELECT codigo, imagen_principal FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2::text[])`, [id, codigos])).rows;
                for (let i = 0; i < filas.length; i += 12) {
                    await Promise.all(filas.slice(i, i + 12).map(async fila => { const jpeg = fila.imagen_principal ? await fotoJpeg(fila.imagen_principal) : null; if (jpeg) fotos.set(fila.codigo, jpeg); }));
                }
            }

            const pdf = await generarPdf({ negocioNombre: negocio ? negocio.nombre : "", titulo, productos, fotos, opciones });
            const archivo = titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "catalogo";

            res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${archivo}.pdf"`, "Content-Length": pdf.length, "Cache-Control": "no-store", "X-Productos": String(productos.length) });
            res.send(pdf);
        } catch (error) {
            responderError(res, error);
        }
    });
};

module.exports.generarPdf = generarPdf;
module.exports.filtrosDe = filtrosDe;

module.exports.consultar = consultar;
module.exports.fotoJpeg = fotoJpeg;

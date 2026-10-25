// Descargar la hoja de etiquetas como PDF (para mandarla por WhatsApp o correo cuando no hay impresora cerca).
// El navegador manda las hojas ya repartidas (mismas secciones y paginas que la vista previa) y, por cada etiqueta, las
// barras Code128 ya codificadas en ceros y unos; aqui solo se dibujan en vectores, asi que el PDF sale nitido a cualquier
// tamano y escanea igual que la hoja impresa.
const PDFDocument = require("pdfkit");
const { responderError } = require("./error-utils");

const MM = 72 / 25.4;
const SECCION_ALTO_MM = 7;
const MAX_CELDAS = 3000;

function numero(valor, minimo, maximo, porDefecto) {
    const n = Number(valor);
    return Number.isFinite(n) ? Math.min(maximo, Math.max(minimo, n)) : porDefecto;
}

// Helvetica del PDF solo trae Latin-1: lo demas se omite en vez de salir como basura.
function texto(valor) {
    return String(valor ?? "").replace(/[^\x20-\xFF]/g, "").slice(0, 120);
}

function color(valor, porDefecto) {
    return /^#[0-9a-fA-F]{6}$/.test(String(valor || "")) ? valor : porDefecto;
}

function ajustar(doc, cadena, ancho) {
    let t = cadena;
    if (doc.widthOfString(t) <= ancho) return t;

    while (t.length > 1 && doc.widthOfString(t + "...") > ancho) t = t.slice(0, -1);
    return t + "...";
}

function barras(doc, binario, x, y, anchoMax, alto) {
    if (!/^[01]+$/.test(binario || "")) return;

    const modulo = Math.min(anchoMax / binario.length, 0.5 * MM);
    const inicio = x + (anchoMax - modulo * binario.length) / 2;

    for (let i = 0; i < binario.length;) {
        if (binario[i] !== "1") { i++; continue; }

        let j = i;
        while (j < binario.length && binario[j] === "1") j++;
        doc.rect(inicio + i * modulo, y, (j - i) * modulo, alto);
        i = j;
    }

    doc.fill("#000000");
}

function dibujarEtiqueta(doc, c, x, y, ancho, alto, d) {
    const borde = color(c.__color, "#d0d5dd");

    doc.lineWidth(0.75).roundedRect(x, y, ancho, alto, 3).stroke(borde);
    if (c.__color) doc.save().lineWidth(2.2).moveTo(x + 3, y + 1.1).lineTo(x + ancho - 3, y + 1.1).stroke(borde).restore();

    const pad = 3 * MM;
    const util = ancho - pad * 2;
    const lineas = [];

    if (d.mostrarNombre && c.nombre) lineas.push({ tipo: "t", txt: texto(c.nombre), fuente: "Helvetica-Bold", size: 8, alto: 10, color: "#111827" });
    if (d.mostrarMarca && c.marca) lineas.push({ tipo: "t", txt: texto(c.marca), fuente: "Helvetica", size: 6.5, alto: 8, color: "#475467" });
    if (d.mostrarCategoria && c.categoria) lineas.push({ tipo: "t", txt: texto(c.categoria), fuente: "Helvetica", size: 6.5, alto: 8, color: "#475467" });

    const hayBarras = d.mostrarCodigoBarras && /^[01]+$/.test(c.barras || "");
    const numero = hayBarras && d.mostrarNumeroCodigo && c.codigo;
    const precio = d.mostrarPrecio && c.precio !== undefined && c.precio !== null;

    const altoFijo = lineas.reduce((s, l) => s + l.alto, 0) + (numero ? 8 : 0) + (precio ? 11 : 0);
    const altoBarras = hayBarras ? Math.max(10, Math.min(alto * 0.4, alto - altoFijo - 8)) : 0;
    let cursor = y + Math.max(2, (alto - (altoFijo + altoBarras)) / 2);

    for (const l of lineas) {
        doc.font(l.fuente).fontSize(l.size).fillColor(l.color);
        doc.text(ajustar(doc, l.txt, util), x + pad, cursor, { width: util, align: "center", lineBreak: false });
        cursor += l.alto;
    }

    if (hayBarras) {
        barras(doc, c.barras, x + pad, cursor, util, altoBarras);
        cursor += altoBarras;
    }

    if (numero) {
        doc.font("Helvetica").fontSize(6.5).fillColor("#111827");
        doc.text(texto(c.codigo), x + pad, cursor + 1, { width: util, align: "center", lineBreak: false });
        cursor += 8;
    }

    if (precio) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
        doc.text("$" + Number(c.precio || 0).toFixed(2), x + pad, cursor + 1, { width: util, align: "center", lineBreak: false });
    }
}

// celdas: titulos de seccion ({__titulo, texto, color}) y etiquetas; paginas: arreglo de arreglos de celdas.
function generarPdfEtiquetas({ diseno, papel, paginas }) {
    const d = {
        anchoMm: numero(diseno.anchoMm, 10, 200, 50), altoMm: numero(diseno.altoMm, 10, 200, 25), columnas: Math.round(numero(diseno.columnas, 1, 8, 3)),
        margenMm: numero(diseno.margenMm, 0, 40, 5), espaciadoMm: numero(diseno.espaciadoMm, 0, 30, 3),
        mostrarNombre: !!diseno.mostrarNombre, mostrarMarca: !!diseno.mostrarMarca, mostrarCategoria: !!diseno.mostrarCategoria,
        mostrarCodigoBarras: !!diseno.mostrarCodigoBarras, mostrarNumeroCodigo: !!diseno.mostrarNumeroCodigo, mostrarPrecio: !!diseno.mostrarPrecio
    };
    const anchoPapel = numero(papel.anchoMm, 20, 1000, 216);
    const rollo = papel.altoMm == null;
    const margen = d.margenMm * MM, hueco = d.espaciadoMm * MM;
    const celdaAncho = (anchoPapel * MM - margen * 2 - hueco * (d.columnas - 1)) / d.columnas;
    const anchoEtiqueta = Math.min(d.anchoMm * MM, celdaAncho);
    const alto = d.altoMm * MM, fila = alto + hueco, titulo = SECCION_ALTO_MM * MM;

    // El rollo continuo es una sola hoja tan larga como haga falta.
    let altoPapel = rollo ? 0 : numero(papel.altoMm, 20, 1500, 279) * MM;

    if (rollo) {
        let y = margen, col = 0;
        for (const c of paginas.flat()) {
            if (c.__titulo) { if (col) { y += fila; col = 0; } y += titulo + hueco; }
            else { col++; if (col >= d.columnas) { y += fila; col = 0; } }
        }
        altoPapel = Math.max(40 * MM, y + (col ? fila : 0) + margen);
    }

    const doc = new PDFDocument({ size: [anchoPapel * MM, altoPapel], margin: 0, autoFirstPage: false, info: { Title: "Etiquetas Nexo POS" } });
    const trozos = [];
    doc.on("data", t => trozos.push(t));
    const fin = new Promise(resolver => doc.on("end", () => resolver(Buffer.concat(trozos))));

    for (const pagina of (paginas.length ? paginas : [[]])) {
        doc.addPage({ size: [anchoPapel * MM, altoPapel], margin: 0 });
        let y = margen, col = 0;

        for (const c of pagina) {
            if (c.__titulo) {
                if (col) { y += fila; col = 0; }
                const fondo = color(c.color, "#1d5fd1");
                doc.roundedRect(margen, y, anchoPapel * MM - margen * 2, titulo, 3).fill(fondo);
                doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff");
                doc.text(ajustar(doc, texto(c.texto), anchoPapel * MM - margen * 2 - 12), margen + 8, y + (titulo - 12) / 2 + 1, { lineBreak: false });
                y += titulo + hueco;
                continue;
            }

            dibujarEtiqueta(doc, c, margen + col * (celdaAncho + hueco), y, anchoEtiqueta, alto, d);
            col++;
            if (col >= d.columnas) { y += fila; col = 0; }
        }
    }

    doc.end();
    return fin;
}

function instalar(app, pool, requerirAccesoNegocio) {
    app.post("/etiquetas/pdf", requerirAccesoNegocio, async (req, res) => {
        try {
            const cuerpo = req.body || {};
            const paginas = Array.isArray(cuerpo.paginas) ? cuerpo.paginas.filter(Array.isArray) : [];
            const total = paginas.reduce((s, p) => s + p.length, 0);

            if (!cuerpo.diseno || !cuerpo.papel || !paginas.length || total === 0) {
                res.status(400).json({ ok: false, error: "No hay etiquetas para convertir a PDF." });
                return;
            }

            if (total > MAX_CELDAS) {
                res.status(400).json({ ok: false, error: `Son demasiadas etiquetas para un solo PDF (maximo ${MAX_CELDAS}).` });
                return;
            }

            const pdf = await generarPdfEtiquetas({ diseno: cuerpo.diseno, papel: cuerpo.papel, paginas });
            const nombre = String(cuerpo.nombre || "etiquetas").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "etiquetas";

            res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nombre}.pdf"`, "Content-Length": pdf.length, "Cache-Control": "no-store" });
            res.send(pdf);
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.generarPdfEtiquetas = generarPdfEtiquetas;

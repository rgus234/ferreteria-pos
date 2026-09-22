// Ficha informativa de Nexo: PDF de una pagina, pensado para leerse
// en el celular, que se adjunta al correo de confirmacion cuando
// alguien pide informacion desde el sitio publico (ver
// enviarCorreoConfirmacionLead en email.js). Contenido y precios
// tomados tal cual de public/site/index.html (seccion #planes) -- la
// misma fuente de verdad que ya ve cualquier visitante del sitio,
// nunca datos inventados aqui.
const PDFDocument = require("pdfkit");
const path = require("path");

const NAVY = "#152B57";
const AZUL = "#1E56C4";
const CELESTE = "#2FB2E8";
const GRIS = "#475467";
const GRIS_CLARO = "#98A2B3";
const BORDE_SUAVE = "#E4E7EC";
const FONDO_SUAVE = "#F8FAFC";

const RUTA_PUBLIC = path.join(__dirname, "public");

const PLANES = [
    {
        nombre: "Basico",
        target: "Negocio de una caja: el dueno y, cuando mucho, un cajero.",
        antes: "$199/mes",
        fundador: "$119.40/mes",
        bullets: [
            "Punto de venta completo",
            "Inventario con alertas de stock bajo",
            "Credito a clientes con abonos",
            "1 equipo, hasta 2 perfiles con PIN"
        ]
    },
    {
        nombre: "Plus",
        destacado: true,
        target: "2 a 5 puntos de cobro, ya recibes catalogos digitales de tus proveedores.",
        antes: "$499/mes",
        fundador: "$299.40/mes",
        bullets: [
            "Todo lo del plan Basico",
            "Hasta 8 empleados con permisos",
            "Nexo Market: sitio propio y pagos",
            "Recepcion de mercancia por XML o CSV",
            "Nexo IA: hasta 50 preguntas al mes"
        ]
    },
    {
        nombre: "Pro",
        target: "Negocio establecido, varias sucursales o alto volumen.",
        antes: "$799/mes",
        fundador: "$479.40/mes",
        bullets: [
            "Todo lo del plan Plus",
            "Empleados y equipos ilimitados",
            "Nexo IA: 500 preguntas/mes + internet",
            "Banco Global de Imagenes",
            "Soporte prioritario"
        ]
    }
];

function textoTachado(doc, texto, x, y) {
    const ancho = doc.widthOfString(texto);
    doc.text(texto, x, y);
    const medioAlto = y + doc.currentLineHeight() / 2 - 1;
    doc.save().lineWidth(0.8).strokeColor(GRIS_CLARO)
        .moveTo(x, medioAlto).lineTo(x + ancho, medioAlto).stroke()
        .restore();
    return ancho;
}

function dibujarTarjetaPlan(doc, plan, x, y, ancho, alto) {
    doc.roundedRect(x, y, ancho, alto, 10)
        .lineWidth(plan.destacado ? 1.6 : 1)
        .stroke(plan.destacado ? AZUL : BORDE_SUAVE);

    if (plan.destacado) {
        doc.roundedRect(x + 12, y - 9, 78, 17, 8.5).fill(AZUL);
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5)
            .text("MAS ELEGIDO", x + 12, y - 5, { width: 78, align: "center" });
    }

    const padX = x + 14;
    const padW = ancho - 28;
    let cy = y + 16;

    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text(plan.nombre, padX, cy, { width: padW });
    cy = doc.y + 3;

    doc.fillColor(GRIS_CLARO).font("Helvetica").fontSize(7.5).text(plan.target, padX, cy, { width: padW, lineGap: 1 });
    cy = doc.y + 8;

    doc.font("Helvetica").fontSize(8.5).fillColor(GRIS_CLARO);
    const anchoAntes = textoTachado(doc, plan.antes, padX, cy);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(AZUL).text(plan.fundador, padX + anchoAntes + 8, cy - 1.5);
    cy += 20;

    doc.font("Helvetica").fontSize(8).fillColor(GRIS);
    plan.bullets.forEach(texto => {
        doc.text("-  " + texto, padX, cy, { width: padW, lineGap: 1 });
        cy = doc.y + 3;
    });
}

function generarFichaInformativaPdf() {
    return new Promise((resolver, rechazar) => {
        // Tamaño recortado al contenido real (no carta completa) --
        // esto es un adjunto digital para leerse en el correo/celular,
        // no una hoja para imprimir; una carta completa dejaria casi
        // 3 pulgadas en blanco abajo.
        const doc = new PDFDocument({ margin: 0, size: [612, 616] });
        const trozos = [];
        doc.on("data", trozo => trozos.push(trozo));
        doc.on("end", () => resolver(Buffer.concat(trozos)));
        doc.on("error", rechazar);

        const anchoPagina = doc.page.width;
        const margenX = 42;
        const anchoUtil = anchoPagina - margenX * 2;

        // Header
        doc.rect(0, 0, anchoPagina, 76).fill(NAVY);
        try {
            doc.image(path.join(RUTA_PUBLIC, "nexo-pos-icon.jpg"), margenX, 19, { width: 38, height: 38 });
        } catch (error) {
            // Si el asset no esta disponible en el entorno, el header
            // sigue viendose bien solo con el texto -- nunca truena el
            // PDF completo por un logo faltante.
        }
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(19).text("NEXO", margenX + 50, 24);
        doc.fillColor("#cbd5e1").font("Helvetica").fontSize(9.5).text("Sistema de punto de venta para ferreterias", margenX + 50, 47);
        doc.fillColor("#cbd5e1").font("Helvetica").fontSize(9.5).text("nexoposoficial.com", margenX, 32, { width: anchoUtil, align: "right" });

        let y = 98;

        // Hero
        doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(18)
            .text("Vende, controla inventario y cobra creditos desde un solo sistema.", margenX, y, { width: anchoUtil });
        y = doc.y + 5;
        doc.fillColor(GRIS).font("Helvetica").fontSize(10.5)
            .text("El POS pensado para ferreterias: mostrador, credito, inventario y reportes.", margenX, y, { width: anchoUtil });
        y = doc.y + 14;

        const badgeTexto = "40% de descuento de por vida -- primeros 10 negocios";
        doc.font("Helvetica-Bold").fontSize(10);
        const badgeAncho = doc.widthOfString(badgeTexto) + 24;
        doc.roundedRect(margenX, y, badgeAncho, 23, 11.5).fill(CELESTE);
        doc.fillColor("#ffffff").text(badgeTexto, margenX + 12, y + 6.5);
        y += 23 + 18;

        // 3 tarjetas de plan
        const gap = 14;
        const anchoCard = (anchoUtil - gap * 2) / 3;
        const altoCard = 172;
        PLANES.forEach((plan, indice) => {
            dibujarTarjetaPlan(doc, plan, margenX + indice * (anchoCard + gap), y, anchoCard, altoCard);
        });
        y += altoCard + 26;

        // Diferenciadores (caja Navy)
        const altoDif = 78;
        doc.roundedRect(margenX, y, anchoUtil, altoDif, 10).fill(NAVY);
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11.5)
            .text("Lo que nos hace diferentes", margenX + 18, y + 12, { width: anchoUtil - 36 });
        doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1")
            .text("Nexo IA: un asistente que si conoce tu ferreteria -- analiza tus ventas, vigila tu inventario y cuida tus creditos (plan Pro busca en internet para dar contexto actualizado).", margenX + 18, y + 32, { width: anchoUtil - 36, lineGap: 1.5 });
        doc.text("Banco de Nexo: fotos de producto ya listas, sin fotografiar tu mismo (plan Pro).", margenX + 18, doc.y + 4, { width: anchoUtil - 36, lineGap: 1.5 });
        y += altoDif + 20;

        // Contacto / cierre
        doc.roundedRect(margenX, y, anchoUtil, 64, 10).fill(FONDO_SUAVE);
        doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Prueba gratis 15 dias, sin tarjeta, sin compromiso.", margenX + 18, y + 14);
        doc.font("Helvetica").fontSize(9.5).fillColor(GRIS)
            .text("WhatsApp: +52 442 495 0495     |     nexoposoficial.com     |     nexoposoficial@gmail.com", margenX + 18, y + 34, { width: anchoUtil - 36 });

        doc.end();
    });
}

module.exports = { generarFichaInformativaPdf };

// Codigo de recogida + QR + codigo de barras para pedidos de Nexo Market
// (Fase 2 del rediseno de pedidos). El codigo NX{id}-{sufijo} ya es unico
// por si solo (id es serial), el sufijo aleatorio solo evita que alguien
// adivine el codigo de otro pedido con solo subir el numero. El QR
// codifica la URL de seguimiento (para que cualquier camara lo abra); el
// codigo de barras (Code128) codifica solo el codigo corto, para el
// lector del POS. Ninguno de los dos lleva datos personales.

const crypto = require("crypto");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");

const ALFABETO_SUFIJO_PEDIDO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DOMINIO_PUBLICO = "https://nexoposoficial.com";

function generarSufijoCodigoRecogida() {
    let sufijo = "";
    for (let i = 0; i < 4; i++) {
        sufijo += ALFABETO_SUFIJO_PEDIDO[crypto.randomInt(ALFABETO_SUFIJO_PEDIDO.length)];
    }
    return sufijo;
}

function formatearCodigoRecogida(id) {
    return `NX${id}-${generarSufijoCodigoRecogida()}`;
}

async function generarQrYBarcode(codigoRecogida) {
    const urlSeguimiento = `${DOMINIO_PUBLICO}/market/pedido/${encodeURIComponent(codigoRecogida)}`;

    const [qrBuffer, barcodeBuffer] = await Promise.all([
        QRCode.toBuffer(urlSeguimiento, { width: 320, margin: 1 }),
        bwipjs.toBuffer({
            bcid: "code128",
            text: codigoRecogida,
            scale: 3,
            height: 12,
            includetext: true,
            textxalign: "center"
        })
    ]);

    return { qrBuffer, barcodeBuffer, urlSeguimiento };
}

module.exports = { formatearCodigoRecogida, generarQrYBarcode };

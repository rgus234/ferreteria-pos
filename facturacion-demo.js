// Facturama de mentira para los negocios de demostracion (funciones_beta.facturacion_demo): se ve y se usa todo el flujo
// de facturar sin timbrar nada ante el SAT, sin gastar timbres reales y sin mandar correos. Todo sale marcado DEMO.
const crypto = require("crypto");
const timbres = require("./timbres");

let consecutivo = 1000 + Math.floor(Math.random() * 100);

const simulado = {
    crearCfdi: async comprobante => {
        consecutivo += 1;
        const uuid = crypto.randomUUID().toUpperCase();
        const total = (comprobante.Items || []).reduce((a, i) => a + Number(i.Total || 0), 0).toFixed(2);
        return { ok: true, status: 200, factura: { serie: "DEMO", folio: String(consecutivo), uuid, facturamaId: null,
            xml: `<?xml version="1.0" encoding="UTF-8"?>\n<!-- FACTURA DE DEMOSTRACION: sin validez fiscal, no fue timbrada ante el SAT -->\n<cfdi:Comprobante Version="4.0" Serie="DEMO" Folio="${consecutivo}" Total="${total}" Demostracion="true"/>` } };
    },
    descargarXmlCfdi: async () => ({ ok: false }),
    enviarCorreoFacturaCfdi: async () => ({ ok: true, demo: true })
};

// Devuelve las funciones reales, o las simuladas si el negocio es de demostracion.
async function pacPara(pool, negocioId, reales) {
    return (await timbres.esDemo(pool, negocioId)) ? simulado : reales;
}

module.exports = { pacPara, simulado };

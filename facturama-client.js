// Wrapper delgado sobre la API Multiemisor de Facturama -- sin logica
// de negocio, solo arma las peticiones HTTP y normaliza la respuesta.
// Una sola cuenta de Facturama a nivel plataforma (config.facturamaApiUser/
// Password), nunca una cuenta por negocio -- cada negocio se identifica
// por su propio RFC dentro de esa cuenta compartida (asi funciona la
// API Multiemisor: un solo login, muchos RFC emisores).
//
// Formas de peticion confirmadas contra la documentacion real de
// Facturama (apisandbox.facturama.mx/guias/api-multi/*), no inventadas.
// Lo unico sin confirmar todavia es la forma EXACTA de la respuesta de
// exito de POST /api-lite/3/cfdis (Id/UUID/XML) -- normalizarRespuestaCfdi()
// intenta las rutas mas comunes de su API y guarda el JSON crudo si no
// las encuentra, para no perder informacion mientras se confirma contra
// el sandbox real.

const { config } = require("./config");

function facturamaConfigurado() {
    return Boolean(config.facturamaApiUrl && config.facturamaApiUser && config.facturamaApiPassword);
}

function authHeader() {
    const credenciales = Buffer.from(`${config.facturamaApiUser}:${config.facturamaApiPassword}`).toString("base64");
    return `Basic ${credenciales}`;
}

async function facturamaFetch(ruta, opciones = {}) {
    if (!facturamaConfigurado()) {
        return { ok: false, status: 0, error: "Facturacion electronica no esta configurada en este servidor." };
    }

    const respuesta = await fetch(`${config.facturamaApiUrl}${ruta}`, {
        ...opciones,
        headers: {
            "Content-Type": "application/json",
            Authorization: authHeader(),
            ...(opciones.headers || {})
        }
    });

    let cuerpo = null;
    try {
        cuerpo = await respuesta.json();
    } catch (error) {
        cuerpo = null;
    }

    if (!respuesta.ok) {
        const mensaje =
            cuerpo?.Message ||
            cuerpo?.message ||
            (cuerpo?.ModelState ? JSON.stringify(cuerpo.ModelState) : null) ||
            `Facturama respondio ${respuesta.status}`;
        return { ok: false, status: respuesta.status, error: mensaje, crudo: cuerpo };
    }

    return { ok: true, status: respuesta.status, datos: cuerpo };
}

// Carga (o reemplaza) el CSD de un RFC -- API Multiemisor exclusiva,
// independiente de los CSD subidos en la plataforma web de Facturama.
// Los CSD cargados aqui los administra Facturama de su lado; esta
// llamada es la UNICA vez que la llave privada cruda sale del servidor
// de Nexo, y solo viaja hacia Facturama, nunca se guarda en la BD de
// Nexo (ver facturacion-server.js).
async function cargarCsd({ rfc, certificateBase64, privateKeyBase64, password }) {
    return facturamaFetch("/api-lite/csds", {
        method: "POST",
        body: JSON.stringify({
            Rfc: rfc,
            Certificate: certificateBase64,
            PrivateKey: privateKeyBase64,
            PrivateKeyPassword: password
        })
    });
}

// Timbra un CFDI 4.0 de ingreso. `datos` ya viene armado por
// facturacion-server.js (issuer/receiver/items resueltos) -- esta
// funcion solo lo manda tal cual a Facturama.
async function crearCfdi(datosComprobante) {
    const resultado = await facturamaFetch("/api-lite/3/cfdis", {
        method: "POST",
        body: JSON.stringify(datosComprobante)
    });

    if (!resultado.ok) return resultado;

    return { ok: true, status: resultado.status, factura: normalizarRespuestaCfdi(resultado.datos) };
}

// La API de Facturama (API Web y Multiemisor comparten el mismo
// formato de respuesta de exito) regresa el Id interno del comprobante
// y, dentro de Complement.TaxStamp, el Uuid/fecha de timbrado del SAT
// -- confirmado por la convencion documentada de su API Web (la
// Multiemisor "es casi identica"). Algunas variantes de su API regresan
// el XML timbrado inline en la misma respuesta (Xml/XmlBase64); si no
// viene inline, se intenta la descarga aparte (descargarXmlCfdi) --
// ESTO ES LO UNICO QUE FALTA CONFIRMAR contra una respuesta real del
// sandbox antes de dar por buena esta funcion (ver PENDIENTE en
// facturacion-server.js). Si ninguna de las dos formas trae el XML, el
// CFDI de todos modos quedo timbrado ante el SAT -- guardar el XML es
// para el registro propio de Nexo, no una condicion de exito.
function normalizarRespuestaCfdi(datos) {
    const xmlInline = datos?.Xml || (datos?.XmlBase64 ? Buffer.from(datos.XmlBase64, "base64").toString("utf8") : null);

    return {
        facturamaId: datos?.Id || null,
        uuid: datos?.Complement?.TaxStamp?.Uuid || datos?.Complemento?.TimbreFiscalDigital?.UUID || null,
        serie: datos?.Serie || null,
        folio: datos?.Folio || null,
        fechaTimbrado: datos?.Complement?.TaxStamp?.Date || null,
        xml: xmlInline || null,
        crudo: datos
    };
}

// Descarga el XML timbrado de un comprobante ya creado, por su Id de
// Facturama -- respuesta XML cruda, no JSON, por eso no usa
// facturamaFetch. PENDIENTE confirmar la ruta exacta para Multiemisor
// contra el sandbox real; se deja aqui la mejor forma conocida.
async function descargarXmlCfdi(facturamaId) {
    if (!facturamaConfigurado()) {
        return { ok: false, status: 0, error: "Facturacion electronica no esta configurada en este servidor." };
    }

    try {
        const respuesta = await fetch(`${config.facturamaApiUrl}/api-lite/cfdi/xml/issued/${encodeURIComponent(facturamaId)}`, {
            headers: { Authorization: authHeader() }
        });

        if (!respuesta.ok) {
            return { ok: false, status: respuesta.status, error: `Facturama respondio ${respuesta.status} al descargar el XML` };
        }

        const xml = await respuesta.text();
        return { ok: true, status: respuesta.status, xml };
    } catch (error) {
        return { ok: false, status: 0, error: error.message || "No se pudo descargar el XML" };
    }
}

module.exports = {
    facturamaConfigurado,
    cargarCsd,
    crearCfdi,
    descargarXmlCfdi
};

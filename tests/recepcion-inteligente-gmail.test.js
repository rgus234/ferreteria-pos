// Recepcion Inteligente, Fase 2 (Gmail). A diferencia del resto del
// proyecto, aqui no se puede probar contra la base de datos real
// "de verdad hablando con Gmail" -- no hay una bandeja de Gmail real
// disponible en este entorno de pruebas. Lo que si es 100% real y se
// prueba de verdad:
//   - listarAdjuntosXml / decodificarBase64Url / construirQueryBusqueda:
//     logica pura, sin red, con payloads de Gmail armados a mano
//     (mismo formato documentado por la API real).
//   - firmarState / verificarState: HMAC real, sin mockear nada.
//   - extraerXmlsDelMensaje: la rama con datos inline no toca la red;
//     la rama con attachmentId mockea global.fetch (unico lugar del
//     archivo donde hace falta, restaurado siempre en el finally).
//   - Los endpoints HTTP que no requieren hablar con Gmail de verdad
//     (estado, buscar sin conexion, iniciar sin configurar) si se
//     prueban contra el servidor real.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const {
    listarAdjuntosXml,
    decodificarBase64Url,
    construirQueryBusqueda,
    firmarState,
    verificarState,
    extraerXmlsDelMensaje,
    buscarPrimerPdf,
    extraerPdfBase64DelMensaje
} = require("../recepcion-inteligente-gmail");
const { negociosConGmailConectado } = require("../recepcion-inteligente-gmail-cron");
const { procesarFacturaXml } = require("../recepcion-inteligente-server");

let negocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("recepcion-inteligente-gmail");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

// --- listarAdjuntosXml ----------------------------------------------

test("listarAdjuntosXml encuentra un adjunto XML de primer nivel", () => {
    const payload = {
        mimeType: "multipart/mixed",
        parts: [
            { mimeType: "text/plain", body: { size: 10, data: "aG9sYQ" } },
            { filename: "factura.xml", mimeType: "application/octet-stream", body: { attachmentId: "ATT-1", size: 500 } }
        ]
    };
    const adjuntos = listarAdjuntosXml(payload);
    assert.equal(adjuntos.length, 1);
    assert.equal(adjuntos[0].filename, "factura.xml");
    assert.equal(adjuntos[0].attachmentId, "ATT-1");
});

test("listarAdjuntosXml encuentra un adjunto anidado 2 niveles (mixed > alternative)", () => {
    const payload = {
        mimeType: "multipart/mixed",
        parts: [
            {
                mimeType: "multipart/alternative",
                parts: [
                    { mimeType: "text/plain", body: { size: 5, data: "aG9sYQ" } },
                    { mimeType: "text/html", body: { size: 20, data: "aG9sYQ" } }
                ]
            },
            { filename: "CFDI-anidado.XML", body: { attachmentId: "ATT-2", size: 800 } }
        ]
    };
    const adjuntos = listarAdjuntosXml(payload);
    assert.equal(adjuntos.length, 1, "debe encontrar el XML sin importar la profundidad ni mayusculas en la extension");
    assert.equal(adjuntos[0].attachmentId, "ATT-2");
});

test("listarAdjuntosXml detecta por mimeType aunque el nombre no termine en .xml", () => {
    const payload = { filename: "factura_extraña", mimeType: "text/xml", body: { attachmentId: "ATT-3", size: 100 } };
    const adjuntos = listarAdjuntosXml(payload);
    assert.equal(adjuntos.length, 1);
});

test("listarAdjuntosXml ignora adjuntos que no son XML (ej. un PDF)", () => {
    const payload = {
        mimeType: "multipart/mixed",
        parts: [
            { filename: "factura.pdf", mimeType: "application/pdf", body: { attachmentId: "ATT-PDF", size: 900 } }
        ]
    };
    assert.equal(listarAdjuntosXml(payload).length, 0);
});

test("listarAdjuntosXml regresa vacio para un mensaje sin adjuntos", () => {
    const payload = { mimeType: "text/plain", body: { size: 20, data: "aG9sYQ" } };
    assert.equal(listarAdjuntosXml(payload).length, 0);
});

// --- buscarPrimerPdf / extraerPdfBase64DelMensaje --------------------

test("buscarPrimerPdf encuentra el PDF junto al XML en el mismo mensaje", () => {
    const payload = {
        mimeType: "multipart/mixed",
        parts: [
            { mimeType: "text/plain", body: { size: 5, data: "aG9sYQ" } },
            { filename: "factura.xml", body: { attachmentId: "ATT-XML", size: 500 } },
            { filename: "factura.pdf", mimeType: "application/pdf", body: { attachmentId: "ATT-PDF", size: 12000 } }
        ]
    };
    const adjunto = buscarPrimerPdf(payload);
    assert.ok(adjunto);
    assert.equal(adjunto.attachmentId, "ATT-PDF");
});

test("buscarPrimerPdf regresa null si el mensaje no trae ningun PDF", () => {
    const payload = { filename: "factura.xml", body: { attachmentId: "ATT-XML", size: 500 } };
    assert.equal(buscarPrimerPdf(payload), null);
});

test("extraerPdfBase64DelMensaje reconvierte de base64url (Gmail) a base64 estandar (lo que espera procesarFacturaXml)", async () => {
    const bytesOriginales = Buffer.from("contenido binario de prueba %%%///", "utf8");
    const mensaje = {
        id: "MSG-PDF-1",
        payload: { filename: "factura.pdf", body: { data: bytesOriginales.toString("base64url"), size: bytesOriginales.length } }
    };

    const pdfBase64 = await extraerPdfBase64DelMensaje("token-no-usado", mensaje);
    assert.equal(pdfBase64, bytesOriginales.toString("base64"));
    assert.deepEqual(Buffer.from(pdfBase64, "base64"), bytesOriginales);
});

test("extraerPdfBase64DelMensaje regresa null sin tocar la red si no hay PDF", async () => {
    const mensaje = { id: "MSG-PDF-2", payload: { filename: "factura.xml", body: { data: "aG9sYQ", size: 5 } } };
    assert.equal(await extraerPdfBase64DelMensaje("token-no-usado", mensaje), null);
});

// --- decodificarBase64Url --------------------------------------------

test("decodificarBase64Url decodifica base64url (con - y _) igual que base64 normal", () => {
    const texto = "<factura>áéí ñ</factura>";
    const base64url = Buffer.from(texto, "utf8").toString("base64url");
    assert.equal(decodificarBase64Url(base64url), texto);
});

// --- construirQueryBusqueda -------------------------------------------

test("construirQueryBusqueda arma el query de Gmail con el timestamp en segundos", () => {
    const fecha = new Date("2026-09-09T12:00:00.000Z");
    const query = construirQueryBusqueda(fecha);
    assert.equal(query, `has:attachment filename:xml after:${Math.floor(fecha.getTime() / 1000)}`);
});

// --- firmarState / verificarState --------------------------------------

test("firmarState / verificarState: viaje de ida y vuelta regresa el mismo negocioId", () => {
    const state = firmarState(42);
    const verificado = verificarState(state);
    assert.ok(verificado);
    assert.equal(verificado.negocioId, 42);
});

test("verificarState rechaza un state con la firma alterada", () => {
    const state = firmarState(42);
    const alterado = state.slice(0, -1) + (state.at(-1) === "a" ? "b" : "a");
    assert.equal(verificarState(alterado), null);
});

test("verificarState rechaza un state con negocioId alterado (la firma ya no corresponde)", () => {
    const state = firmarState(42);
    const partes = state.split(".");
    partes[0] = "999";
    assert.equal(verificarState(partes.join(".")), null, "cambiar negocioId sin recalcular la firma debe fallar la verificacion");
});

test("verificarState rechaza basura / formato invalido", () => {
    assert.equal(verificarState("no-es-un-state-valido"), null);
    assert.equal(verificarState(""), null);
    assert.equal(verificarState(undefined), null);
});

test("verificarState rechaza un state vencido (mas de 10 minutos)", () => {
    // Se firma un payload a mano con un timestamp viejo, en vez de
    // esperar 10 minutos reales.
    const crypto = require("crypto");
    const { config } = require("../config");
    const payload = `7.${Date.now() - 11 * 60 * 1000}.aabbccdd`;
    const firma = crypto.createHmac("sha256", config.googleClientSecret).update(payload).digest("hex").slice(0, 32);
    assert.equal(verificarState(`${payload}.${firma}`), null);
});

// --- extraerXmlsDelMensaje --------------------------------------------

test("extraerXmlsDelMensaje decodifica un adjunto inline sin tocar la red", async () => {
    const xmlOriginal = "<cfdi:Comprobante>inline</cfdi:Comprobante>";
    const mensaje = {
        id: "MSG-1",
        payload: { filename: "factura.xml", body: { data: Buffer.from(xmlOriginal, "utf8").toString("base64url"), size: 100 } }
    };

    const xmls = await extraerXmlsDelMensaje("access-token-no-usado", mensaje);
    assert.deepEqual(xmls, [xmlOriginal]);
});

test("extraerXmlsDelMensaje descarga por attachmentId cuando no viene inline", async () => {
    const xmlOriginal = "<cfdi:Comprobante>descargado</cfdi:Comprobante>";
    const mensaje = {
        id: "MSG-2",
        payload: { filename: "factura.xml", body: { attachmentId: "ATT-99", size: 5000 } }
    };

    const fetchOriginal = global.fetch;
    let urlLlamada = null;
    global.fetch = async (url) => {
        urlLlamada = url;
        return { ok: true, json: async () => ({ data: Buffer.from(xmlOriginal, "utf8").toString("base64url") }) };
    };

    try {
        const xmls = await extraerXmlsDelMensaje("access-token-de-prueba", mensaje);
        assert.deepEqual(xmls, [xmlOriginal]);
        assert.match(urlLlamada, /\/messages\/MSG-2\/attachments\/ATT-99$/);
    } finally {
        global.fetch = fetchOriginal;
    }
});

test("extraerXmlsDelMensaje regresa vacio para un mensaje sin adjuntos XML", async () => {
    const mensaje = { id: "MSG-3", payload: { mimeType: "text/plain", body: { data: "aG9sYQ", size: 5 } } };
    assert.deepEqual(await extraerXmlsDelMensaje("access-token-no-usado", mensaje), []);
});

// --- Pipeline HTTP: solo lo que NO necesita hablar con Gmail de verdad --

test("GET /gmail/estado: un negocio que nunca conecto nada regresa conectado=false", async () => {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/gmail/estado`, {
        headers: { "x-dispositivo-token": negocio.token }
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.conectado, false);
});

test("POST /gmail/iniciar: sin token de dispositivo se rechaza", async () => {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/gmail/iniciar`, { method: "POST" });
    assert.equal(respuesta.status, 401);
});

test("POST /gmail/iniciar: entrega una URL de Google con el scope de solo-lectura y un state firmado", async () => {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/gmail/iniciar`, {
        method: "POST",
        headers: { "x-dispositivo-token": negocio.token }
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200, JSON.stringify(datos));
    assert.ok(datos.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
    assert.match(datos.url, /scope=https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fgmail\.readonly/);
    assert.match(datos.url, /access_type=offline/);
    assert.match(datos.url, /prompt=consent/);

    const parametros = new URL(datos.url).searchParams;
    const verificado = verificarState(parametros.get("state"));
    assert.equal(verificado.negocioId, negocio.negocioId, "el state debe llevar el negocio que inicio la conexion");
});

test("POST /gmail/buscar: sin ninguna cuenta conectada se rechaza con 400, nunca intenta hablar con Gmail", async () => {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/gmail/buscar`, {
        method: "POST",
        headers: { "x-dispositivo-token": negocio.token }
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 400);
    assert.match(datos.error, /no conectas ning.n Gmail/);
});

test("GET /gmail/callback: un state invalido o vencido se rechaza sin llegar a intercambiar el code", async () => {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/gmail/callback?code=algo&state=basura-invalida`);
    assert.equal(respuesta.status, 400);
    const html = await respuesta.text();
    assert.match(html, /Enlace invalido o vencido/);
});

test("GET /gmail/callback: si Google regresa error (usuario cancelo), se muestra un aviso sin tronar", async () => {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/gmail/callback?error=access_denied`);
    assert.equal(respuesta.status, 200);
    const html = await respuesta.text();
    assert.match(html, /Conexion cancelada/);
});

// --- Fase 3: programador automatico -- solo la parte que no habla ---
// con Gmail de verdad (el filtro activo=true contra la base real).

test("negociosConGmailConectado solo regresa negocios con la conexion activa", async () => {
    await pool.query(
        `INSERT INTO public.recepcion_inteligente_gmail (negocio_id, correo_conectado, refresh_token, activo)
         VALUES ($1, 'activo@ejemplo.com', 'token-falso-activo', true)`,
        [negocio.negocioId]
    );

    const otroNegocio = await crearNegocioPrueba("recepcion-inteligente-gmail-inactivo");
    try {
        await pool.query(
            `INSERT INTO public.recepcion_inteligente_gmail (negocio_id, correo_conectado, refresh_token, activo, desconectado_en)
             VALUES ($1, 'desconectado@ejemplo.com', '', false, NOW())`,
            [otroNegocio.negocioId]
        );

        const conectados = await negociosConGmailConectado(pool);
        assert.ok(conectados.includes(negocio.negocioId), "el negocio activo debe aparecer");
        assert.ok(!conectados.includes(otroNegocio.negocioId), "un negocio desconectado no debe aparecer");
    } finally {
        await borrarNegocioPrueba(otroNegocio.negocioId);
    }
});

test("una factura procesada con origen='gmail' aparece asi en la lista y en el detalle", async () => {
    const uuid = `UUID-ORIGEN-GMAIL-${Date.now()}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Folio="1" Fecha="2026-09-09T10:00:00" SubTotal="10.00" Total="11.60">
  <cfdi:Emisor Rfc="GAF850101AB1" Nombre="GAFI SA DE CV"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>
    <cfdi:Concepto NoIdentificacion="" ClaveProdServ="27112700" Descripcion="Concepto detectado por Gmail"
        Cantidad="1" ValorUnitario="10" Importe="10.00" Unidad="Pieza"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="1.60"><cfdi:Traslados><cfdi:Traslado Base="10" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="1.60"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>
</cfdi:Comprobante>`;

    const resultado = await procesarFacturaXml(pool, negocio.negocioId, xml, { origen: "gmail" });

    const lista = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { headers: { "x-dispositivo-token": negocio.token } })).json();
    assert.equal(lista.facturas.find(f => f.id === resultado.recepcionId).origen, "gmail");

    const detalle = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${resultado.recepcionId}`, { headers: { "x-dispositivo-token": negocio.token } })).json();
    assert.equal(detalle.recepcion.origen, "gmail");
});

test("un correo con XML y PDF adjuntos guarda ambos -- el PDF llega intacto a pdf_bytes", async () => {
    const uuid = `UUID-CON-PDF-${Date.now()}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Folio="1" Fecha="2026-09-09T10:00:00" SubTotal="10.00" Total="11.60">
  <cfdi:Emisor Rfc="GAF850101AB1" Nombre="GAFI SA DE CV"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>
    <cfdi:Concepto NoIdentificacion="" ClaveProdServ="27112700" Descripcion="Concepto con PDF adjunto"
        Cantidad="1" ValorUnitario="10" Importe="10.00" Unidad="Pieza"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="1.60"><cfdi:Traslados><cfdi:Traslado Base="10" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="1.60"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>
</cfdi:Comprobante>`;

    const pdfOriginal = Buffer.from("%PDF-1.4 contenido de prueba, no es un PDF real", "utf8");
    const mensaje = {
        id: "MSG-XML-Y-PDF",
        payload: {
            mimeType: "multipart/mixed",
            parts: [
                { filename: "factura.xml", body: { data: Buffer.from(xml, "utf8").toString("base64url"), size: xml.length } },
                { filename: "factura.pdf", mimeType: "application/pdf", body: { data: pdfOriginal.toString("base64url"), size: pdfOriginal.length } }
            ]
        }
    };

    const xmls = await extraerXmlsDelMensaje("token-no-usado", mensaje);
    const pdfBase64 = await extraerPdfBase64DelMensaje("token-no-usado", mensaje);
    assert.equal(xmls.length, 1);

    const resultado = await procesarFacturaXml(pool, negocio.negocioId, xmls[0], { origen: "gmail", pdfBase64 });

    const fila = await pool.query(`SELECT pdf_bytes FROM public.recepciones_inteligentes WHERE id = $1`, [resultado.recepcionId]);
    assert.deepEqual(fila.rows[0].pdf_bytes, pdfOriginal);
});

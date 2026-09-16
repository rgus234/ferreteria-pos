// Fase 5 del plan de identidad multi-proveedor: recepcion por remision
// (GAFI entrega la mercancia con una nota de remision impresa; el CFDI
// real puede llegar dias despues por correo). Se prueba el pipeline
// completo SIN depender de una respuesta real de Claude: extraerRemisionDeFoto
// (la unica parte que llama a la IA) no se prueba aqui -- se prueba
// procesarRemisionFoto directo, con un objeto "ya extraido" tal cual lo
// devolveria esa funcion.
//
// El principio que se prueba en cada punto: recibir la remision aplica
// stock de inmediato (no frena la mercancia); cuando llega la factura
// real del mismo proveedor, Nexo pregunta si es la misma entrega antes
// de aplicar nada, y confirmar la conciliacion NUNCA vuelve a sumar el
// mismo stock.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { procesarRemisionFoto, buscarRemisionPendienteConciliable } = require("../recepcion-inteligente-server");

let negocio;

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

function cfdiXml({ uuid, emisorRfc = "GAF850101AB1", emisorNombre = "GAFI SA DE CV", conceptos }) {
    const conceptosXml = conceptos.map(c => `
        <cfdi:Concepto NoIdentificacion="${c.codigo || ""}" ClaveProdServ="27112700" Descripcion="${c.descripcion}"
            Cantidad="${c.cantidad ?? 1}" ValorUnitario="${c.costo ?? 10}" Importe="${(c.cantidad ?? 1) * (c.costo ?? 10)}" Unidad="Pieza">
            <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="10" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="999"/></cfdi:Traslados></cfdi:Impuestos>
        </cfdi:Concepto>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Folio="1" Fecha="2026-09-08T10:00:00" SubTotal="100.00" Total="116.00">
  <cfdi:Emisor Rfc="${emisorRfc}" Nombre="${emisorNombre}"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>${conceptosXml}</cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16.00"><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="16.00"/></cfdi:Traslados></cfdi:Impuestos>
  ${uuid ? `<cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>` : ""}
</cfdi:Comprobante>`;
}

async function decidirItem(recepcionId, itemId, decision) {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${itemId}`, {
        method: "POST", headers: headers(), body: JSON.stringify(decision)
    });
    return respuesta.json();
}

async function stockDe(productoId) {
    const fila = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoId]);
    return Number(fila.rows[0].stock);
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("recepcion-remision");
});

after(async () => {
    // borrarNegocioPrueba ya borra, en el orden correcto,
    // recepciones_inteligentes_items/recepciones_inteligentes ANTES que
    // productos (producto_id no tiene ON DELETE CASCADE) -- borrar
    // productos aparte y antes, como se hacia aqui, violaba esa llave
    // foranea. productosCreados ya no hace falta.
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("procesarRemisionFoto crea la recepcion pendiente, sin tocar inventario todavia", async () => {
    const resultado = await procesarRemisionFoto(pool, negocio.negocioId, {
        proveedor: "GAFI SA DE CV",
        folio: "REM-0001",
        fecha: "2026-09-10",
        items: [{ codigo: "ZZTEST-REM-001", descripcion: "Plastiacero jeringa 5 minutos, prueba remision", cantidad: 3, costoUnitario: 40 }]
    });

    assert.ok(resultado.recepcionId);
    assert.equal(resultado.totalConceptos, 1);

    const recepcion = await pool.query(`SELECT origen, estado FROM public.recepciones_inteligentes WHERE id = $1`, [resultado.recepcionId]);
    assert.equal(recepcion.rows[0].origen, "remision_foto");
    assert.equal(recepcion.rows[0].estado, "pendiente");
});

test("flujo completo: remision aplica stock de inmediato, y la factura real que llega despues concilia sin duplicarlo", async () => {
    // 1) Llega la mercancia -- se registra la remision por foto (aqui,
    // con el objeto que extraerRemisionDeFoto ya habria devuelto).
    const remision = await procesarRemisionFoto(pool, negocio.negocioId, {
        proveedor: "GAFI SA DE CV",
        folio: "REM-0002",
        fecha: "2026-09-10",
        items: [{ codigo: "ZZTEST-REM-002", descripcion: "Disco turbo cuarcita conciliacion prueba unica", cantidad: 5, costoUnitario: 60 }]
    });

    const itemsRemision = await pool.query(`SELECT id FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [remision.recepcionId]);
    const itemRemisionId = itemsRemision.rows[0].id;

    // El producto no existe en el inventario todavia -- el concepto
    // queda sin decidir (nivel amarillo), como cualquier factura.
    const decision = await decidirItem(remision.recepcionId, itemRemisionId, {
        accion: "crear", nombreNuevoProducto: "Disco turbo cuarcita conciliacion prueba unica", precioVenta: 90
    });
    assert.equal(decision.ok, true);

    const confirmarRemision = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${remision.recepcionId}/confirmar`, {
        method: "POST", headers: headers()
    });
    const datosRemision = await confirmarRemision.json();
    assert.equal(datosRemision.ok, true, JSON.stringify(datosRemision));
    assert.equal(datosRemision.conciliada, false);

    const productoId = (await pool.query(
        `SELECT producto_id FROM public.recepciones_inteligentes_items WHERE id = $1`, [itemRemisionId]
    )).rows[0].producto_id;

    assert.equal(await stockDe(productoId), 5, "la remision debe aplicar el stock de inmediato");

    const mercanciaRemision = await pool.query(
        `SELECT tipo_documento, estado FROM public.recepciones_mercancia WHERE id = $1`, [datosRemision.recepcionMercanciaId]
    );
    assert.equal(mercanciaRemision.rows[0].tipo_documento, "remision");
    assert.equal(mercanciaRemision.rows[0].estado, "recibido_sin_factura", "debe quedar marcada como pendiente de factura real");

    // 2) Dias despues llega el CFDI real del mismo proveedor, con el
    // MISMO producto (misma descripcion -- ya existe en inventario, asi
    // que deberia auto-relacionarse por nivel fuerte).
    const subida = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            xml: cfdiXml({
                uuid: "UUID-CONCILIACION-0001",
                conceptos: [{ codigo: "ZZTEST-REM-002", descripcion: "Disco turbo cuarcita conciliacion prueba unica", cantidad: 5, costo: 58 }]
            })
        })
    });
    const datosSubida = await subida.json();
    assert.equal(datosSubida.identificados, 1, "debe auto-relacionar con el producto que ya existe, nivel fuerte");

    // 3) Confirmar la factura SIN decir nada de conciliacion debe
    // avisar que hay una remision pendiente -- nunca aplicar solo.
    const intentoConfirmar = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${datosSubida.recepcionId}/confirmar`, {
        method: "POST", headers: headers()
    });
    const datosIntento = await intentoConfirmar.json();
    assert.equal(intentoConfirmar.status, 409);
    assert.equal(datosIntento.requiereConciliacion, true);
    assert.equal(datosIntento.remisionPendiente.recepcionMercanciaId, datosRemision.recepcionMercanciaId);
    assert.equal(datosIntento.remisionPendiente.items[0].codigo, "ZZTEST-REM-002");

    // El intento rechazado no debe haber tocado nada.
    assert.equal(await stockDe(productoId), 5);
    const recepcionTrasIntento = await pool.query(`SELECT estado FROM public.recepciones_inteligentes WHERE id = $1`, [datosSubida.recepcionId]);
    assert.equal(recepcionTrasIntento.rows[0].estado, "pendiente", "debe seguir pendiente, el intento no debe haberla confirmado");

    // 4) El dueño confirma que SI es la misma entrega -- el costo real
    // de la factura (58) corrige al estimado de la remision (60), pero
    // el stock NUNCA se vuelve a sumar.
    const confirmarConciliando = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${datosSubida.recepcionId}/confirmar`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ conciliarConRecepcionMercanciaId: datosRemision.recepcionMercanciaId })
    });
    const datosConciliado = await confirmarConciliando.json();
    assert.equal(datosConciliado.ok, true, JSON.stringify(datosConciliado));
    assert.equal(datosConciliado.conciliada, true);
    assert.equal(datosConciliado.recepcionMercanciaId, datosRemision.recepcionMercanciaId, "debe reusar la misma recepcion de mercancia, no crear otra");

    assert.equal(await stockDe(productoId), 5, "el stock NUNCA debe duplicarse al conciliar");

    const mercanciaConciliada = await pool.query(
        `SELECT estado, notas FROM public.recepciones_mercancia WHERE id = $1`, [datosRemision.recepcionMercanciaId]
    );
    assert.equal(mercanciaConciliada.rows[0].estado, "conciliado");
    assert.match(mercanciaConciliada.rows[0].notas, /conciliada con factura/);

    const costoActualizado = await pool.query(
        `SELECT costo FROM public.recepciones_mercancia_items WHERE recepcion_id = $1 AND producto_id = $2`,
        [datosRemision.recepcionMercanciaId, productoId]
    );
    assert.equal(Number(costoActualizado.rows[0].costo), 58, "el costo real de la factura debe corregir al estimado de la remision");

    const producto = await pool.query(`SELECT precio_distribuidor FROM public.productos WHERE id = $1`, [productoId]);
    assert.equal(Number(producto.rows[0].precio_distribuidor), 58);
});

test("si el dueño dice que es una entrega distinta (ignorarConciliacion), se procesa aparte y SI suma stock de nuevo", async () => {
    const remision = await procesarRemisionFoto(pool, negocio.negocioId, {
        proveedor: "GAFI SA DE CV",
        folio: "REM-0003",
        fecha: "2026-09-11",
        items: [{ codigo: "ZZTEST-REM-003", descripcion: "Producto distinto entrega aparte prueba unica", cantidad: 2, costoUnitario: 20 }]
    });
    const itemRemision = (await pool.query(`SELECT id FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [remision.recepcionId])).rows[0];
    await decidirItem(remision.recepcionId, itemRemision.id, { accion: "crear", nombreNuevoProducto: "Producto distinto entrega aparte prueba unica", precioVenta: 35 });
    const confirmada = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${remision.recepcionId}/confirmar`, { method: "POST", headers: headers() })).json();

    const productoId = (await pool.query(`SELECT producto_id FROM public.recepciones_inteligentes_items WHERE id = $1`, [itemRemision.id])).rows[0].producto_id;
    assert.equal(await stockDe(productoId), 2);

    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ xml: cfdiXml({ uuid: "UUID-IGNORAR-0001", conceptos: [{ codigo: "ZZTEST-REM-003", descripcion: "Producto distinto entrega aparte prueba unica", cantidad: 2, costo: 20 }] }) })
    })).json();

    const confirmarIgnorando = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}/confirmar`, {
        method: "POST", headers: headers(), body: JSON.stringify({ ignorarConciliacion: true })
    });
    const datos = await confirmarIgnorando.json();
    assert.equal(datos.ok, true);
    assert.equal(datos.conciliada, false);
    assert.notEqual(datos.recepcionMercanciaId, confirmada.recepcionMercanciaId, "debe crear una recepcion de mercancia distinta");

    assert.equal(await stockDe(productoId), 4, "al tratarla como entrega distinta, el stock SI se vuelve a sumar");
});

test("buscarRemisionPendienteConciliable regresa null sin proveedor, y null cuando no hay ninguna pendiente", async () => {
    assert.equal(await buscarRemisionPendienteConciliable(pool, negocio.negocioId, null), null);
    assert.equal(await buscarRemisionPendienteConciliable(pool, negocio.negocioId, 999999999), null);
});

test("GET posible-conciliacion regresa null para una recepcion que es ella misma una remision por foto", async () => {
    const remision = await procesarRemisionFoto(pool, negocio.negocioId, {
        proveedor: "GAFI SA DE CV", folio: "REM-0004", fecha: "2026-09-12",
        items: [{ codigo: "ZZTEST-REM-004", descripcion: "Otro producto prueba posible conciliacion", cantidad: 1, costoUnitario: 10 }]
    });

    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${remision.recepcionId}/posible-conciliacion`, { headers: headers() });
    const datos = await respuesta.json();
    assert.equal(datos.ok, true);
    assert.equal(datos.remisionPendiente, null);
});

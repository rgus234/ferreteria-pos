// Recepcion con factura desde el celular: confirmar acepta las cantidades que de verdad llegaron (cantidadesRecibidas).
// Sin ese dato todo sigue igual que antes (se recibe lo de la factura). La respuesta trae los productos para acomodarlos.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });

function cfdiXml({ uuid, conceptos }) {
    const total = conceptos.reduce((s, c) => s + c.cantidad * c.costo, 0);
    const xmlConceptos = conceptos.map(c => `<cfdi:Concepto NoIdentificacion="${c.codigo}" ClaveProdServ="27112700" Descripcion="${c.descripcion}" Cantidad="${c.cantidad}" ValorUnitario="${c.costo}" Importe="${c.cantidad * c.costo}" Unidad="Pieza"/>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Folio="7" Fecha="2026-11-04T10:00:00" SubTotal="${total}" Total="${total}">
  <cfdi:Emisor Rfc="CRR850101AB1" Nombre="PROVEEDOR CANTIDADES PRUEBA SA"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>${xmlConceptos}</cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}

async function subirYDecidir(uuid, nombres) {
    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ xml: cfdiXml({ uuid, conceptos: nombres.map((n, i) => ({ codigo: `ZZCANT-${uuid}-${i}`, descripcion: n, cantidad: 10, costo: 20 })) }) })
    })).json();
    const items = (await pool.query(`SELECT id, descripcion FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1 ORDER BY id`, [subida.recepcionId])).rows;

    for (const item of items) {
        await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}/items/${item.id}`, { method: "POST", headers: headers(), body: JSON.stringify({ accion: "crear", nombreNuevoProducto: item.descripcion, precioVenta: 40 }) });
    }

    return { recepcionId: subida.recepcionId, items };
}

const stockPorNombre = async nombre => Number((await pool.query(`SELECT stock FROM public.productos WHERE negocio_id = $1 AND nombre = $2`, [negocio.negocioId, nombre])).rows[0].stock);

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("recepcion-cantidades");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("confirmar con cantidadesRecibidas suma lo que llego; lo que no se mando se recibe como dice la factura", async () => {
    const { recepcionId, items } = await subirYDecidir("UUID-CANT-0001", ["Producto cantidades uno", "Producto cantidades dos"]);
    const r = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, { method: "POST", headers: headers(), body: JSON.stringify({ cantidadesRecibidas: { [items[0].id]: 7 } }) })).json();

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(await stockPorNombre("Producto cantidades uno"), 7, "llegaron 7 de 10");
    assert.equal(await stockPorNombre("Producto cantidades dos"), 10, "sin verificar: la cantidad de la factura");
    assert.equal(r.productos.length, 2, "la respuesta trae los productos para acomodarlos");
    assert.ok(r.productos.every(p => p.productoId > 0));
    assert.equal(r.productos.find(p => p.nombre === "Producto cantidades uno").cantidad, 7);
});

test("REGRESION: sin cantidadesRecibidas todo se recibe como dice la factura", async () => {
    const { recepcionId } = await subirYDecidir("UUID-CANT-0002", ["Producto regresion tres"]);
    const r = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, { method: "POST", headers: headers() })).json();

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(await stockPorNombre("Producto regresion tres"), 10);
});

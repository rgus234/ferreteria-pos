// "Recibir por marca" / Recibir mercancia en el celular con PROVEEDOR: la recepcion hecha a mano queda "recibido_sin_factura" y, cuando llega la factura
// de ese proveedor, Recepcion Inteligente la concilia (pregunta si es la misma y NUNCA vuelve a sumar el stock). Sin proveedor todo sigue como antes.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let proveedorId;
const NOMBRE_PROVEEDOR = "Proveedor Manual Prueba Unico";
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });

function cfdiXml({ uuid, conceptos }) {
    const xml = conceptos.map(c => `<cfdi:Concepto NoIdentificacion="${c.codigo}" ClaveProdServ="27112700" Descripcion="${c.descripcion}" Cantidad="${c.cantidad}" ValorUnitario="${c.costo}" Importe="${c.cantidad * c.costo}" Unidad="Pieza"/>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Folio="9" Fecha="2026-11-10T10:00:00" SubTotal="100.00" Total="116.00">
  <cfdi:Emisor Rfc="PMP850101AB1" Nombre="${NOMBRE_PROVEEDOR}"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>${xml}</cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}

const stockDe = async id => Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [id])).rows[0].stock);
const nuevoProducto = async (codigo, nombre) => (await pool.query(`INSERT INTO public.productos (negocio_id, nombre, codigo, precio, stock) VALUES ($1,$2,$3,50,0) RETURNING id`, [negocio.negocioId, nombre, codigo])).rows[0].id;
const rapida = async cuerpo => (await fetch(`${BASE_URL}/recepciones-mercancia/rapida`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) })).json();

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("recepcion-manual");
    proveedorId = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1,$2) RETURNING id`, [negocio.negocioId, NOMBRE_PROVEEDOR])).rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("recepcion rapida con proveedor y sinFactura queda recibido_sin_factura; sin proveedor o sin la marca, como siempre", async () => {
    const p = await nuevoProducto("ZZTEST-MAN-000", "Producto manual estados prueba unico");

    const conProveedor = await rapida({ proveedor: NOMBRE_PROVEEDOR, sinFactura: true, referencia: "Recibir por marca", idempotencyKey: "man-estado-1", items: [{ productoId: p, cantidad: 2, costo: 0 }] });
    assert.equal(conProveedor.ok, true, JSON.stringify(conProveedor));
    assert.equal(conProveedor.recepcion.estado, "recibido_sin_factura");

    const sinMarca = await rapida({ proveedor: NOMBRE_PROVEEDOR, referencia: "x", idempotencyKey: "man-estado-2", items: [{ productoId: p, cantidad: 1, costo: 0 }] });
    assert.equal(sinMarca.recepcion.estado, "conciliado", "sin sinFactura no queda pendiente");

    const sinProveedor = await rapida({ proveedor: "", sinFactura: true, referencia: "x", idempotencyKey: "man-estado-3", items: [{ productoId: p, cantidad: 1, costo: 0 }] });
    assert.equal(sinProveedor.recepcion.estado, "conciliado", "sin proveedor no hay con que conciliar");
    assert.equal(await stockDe(p), 4, "las tres sumaron stock");

    await pool.query(`UPDATE public.recepciones_mercancia SET estado = 'conciliado' WHERE negocio_id = $1`, [negocio.negocioId]);
});

test("flujo completo: recibir a mano con proveedor y despues confirmar su factura concilia sin duplicar el stock", async () => {
    const productoId = await nuevoProducto("ZZTEST-MAN-001", "Producto manual conciliacion prueba unico");

    // 1) Se recibe a mano en el celular, eligiendo el proveedor.
    const manual = await rapida({ proveedor: NOMBRE_PROVEEDOR, sinFactura: true, referencia: "Recibir por marca", idempotencyKey: "man-flujo-1", items: [{ productoId, cantidad: 4, costo: 0 }] });
    assert.equal(manual.ok, true, JSON.stringify(manual));
    assert.equal(await stockDe(productoId), 4);

    // 2) Llega la factura del mismo proveedor (10 en la factura; en el estante se contaron 4).
    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ xml: cfdiXml({ uuid: "UUID-MANUAL-0001", conceptos: [{ codigo: "ZZTEST-MAN-001", descripcion: "Producto manual conciliacion prueba unico", cantidad: 10, costo: 25 }] }) })
    })).json();
    assert.ok(subida.recepcionId, JSON.stringify(subida));

    // El proveedor de la factura es el de la lista (en produccion se resuelve solo por RFC/nombre).
    await pool.query(`UPDATE public.recepciones_inteligentes SET proveedor_id = $2 WHERE id = $1`, [subida.recepcionId, proveedorId]);
    const items = (await pool.query(`SELECT id FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [subida.recepcionId])).rows;

    for (const item of items) {
        await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}/items/${item.id}`, { method: "POST", headers: headers(), body: JSON.stringify({ accion: "relacionar", productoId }) });
    }

    // 3) La pantalla pregunta antes de decidir: encuentra la recepcion hecha a mano.
    const posible = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}/posible-conciliacion`, { headers: headers() })).json();
    assert.ok(posible.remisionPendiente, "debe ofrecer la recepcion hecha a mano");
    assert.equal(posible.remisionPendiente.recepcionMercanciaId, manual.recepcion.id);
    assert.equal(posible.remisionPendiente.items[0].cantidad, 4);

    // 4) Confirmar sin decir nada: avisa y no toca nada.
    const intento = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}/confirmar`, { method: "POST", headers: headers(), body: JSON.stringify({ cantidadesRecibidas: { [items[0].id]: 4 } }) });
    const datosIntento = await intento.json();
    assert.equal(intento.status, 409);
    assert.equal(datosIntento.requiereConciliacion, true);
    assert.equal(await stockDe(productoId), 4, "el intento no sumo nada");

    // 5) Es la misma entrega: la factura completa el costo y NO se vuelve a sumar.
    const conciliada = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}/confirmar`, {
        method: "POST", headers: headers(), body: JSON.stringify({ cantidadesRecibidas: { [items[0].id]: 4 }, conciliarConRecepcionMercanciaId: manual.recepcion.id })
    })).json();
    assert.equal(conciliada.ok, true, JSON.stringify(conciliada));
    assert.equal(conciliada.conciliada, true);
    assert.equal(await stockDe(productoId), 4, "el stock NUNCA se duplica");

    const mercancia = (await pool.query(`SELECT estado FROM public.recepciones_mercancia WHERE id = $1`, [manual.recepcion.id])).rows[0];
    assert.equal(mercancia.estado, "conciliado");
    const costo = Number((await pool.query(`SELECT costo FROM public.recepciones_mercancia_items WHERE recepcion_id = $1 AND producto_id = $2`, [manual.recepcion.id, productoId])).rows[0].costo);
    assert.equal(costo, 25, "el costo de la factura completa el de la recepcion a mano (que se hizo sin costo)");
});

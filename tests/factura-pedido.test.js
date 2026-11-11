// Factura <-> pedido (abarrotes): la factura que llega se compara con el pedido (por los productos que comparten, no por el nombre del proveedor),
// se concilia con lo que ya se recibio contra ese pedido (sin sumar dos veces) y de su total sale la cuenta por pagar de la Agenda de pagos.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let proveedorId;
const EMISOR = "Pepsico Distribuidor Prueba Unico";
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });

function cfdiXml({ uuid, conceptos }) {
    const xml = conceptos.map(c => `<cfdi:Concepto NoIdentificacion="${c.codigo}" ClaveProdServ="27112700" Descripcion="${c.descripcion}" Cantidad="${c.cantidad}" ValorUnitario="${c.costo}" Importe="${c.cantidad * c.costo}" Unidad="Pieza"/>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Folio="77" Fecha="2026-11-10T10:00:00" SubTotal="100.00" Total="116.00">
  <cfdi:Emisor Rfc="PDP850101AB1" Nombre="${EMISOR}"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>${xml}</cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}

const api = async (ruta, cuerpo, metodo) => (await fetch(`${BASE_URL}${ruta}`, { method: metodo || (cuerpo ? "POST" : "GET"), headers: headers(), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) })).json();
const stockDe = async id => Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [id])).rows[0].stock);
const nuevoProducto = async (codigo, nombre, costo = 0) => (await pool.query(`INSERT INTO public.productos (negocio_id, nombre, codigo, precio, stock, costo) VALUES ($1,$2,$3,50,0,$4) RETURNING id`, [negocio.negocioId, nombre, codigo, costo])).rows[0].id;
const cuentas = async () => (await pool.query(`SELECT * FROM public.cuentas_pagar WHERE negocio_id = $1 ORDER BY id`, [negocio.negocioId])).rows;

async function pedidoCon(renglones) {
    const pedido = (await pool.query(`INSERT INTO public.pedidos_proveedor (negocio_id, proveedor, estado, total_estimado) VALUES ($1, 'Sabritas', 'enviado', 0) RETURNING id`, [negocio.negocioId])).rows[0].id;
    for (const r of renglones) await pool.query(`INSERT INTO public.pedidos_proveedor_items (negocio_id, pedido_id, producto_id, nombre, cantidad, costo) VALUES ($1,$2,$3,$4,$5,0)`, [negocio.negocioId, pedido, r.id, r.nombre, r.cantidad]);
    return pedido;
}

async function subirFactura(uuid, conceptos, productos) {
    const subida = await api("/recepcion-inteligente/facturas", { xml: cfdiXml({ uuid, conceptos }) });
    assert.ok(subida.recepcionId, JSON.stringify(subida));
    await pool.query(`UPDATE public.recepciones_inteligentes SET proveedor_id = $2 WHERE id = $1`, [subida.recepcionId, proveedorId]);
    const items = (await pool.query(`SELECT id, codigo_factura FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [subida.recepcionId])).rows;

    for (const item of items) {
        const producto = productos[item.codigo_factura];
        await api(`/recepcion-inteligente/facturas/${subida.recepcionId}/items/${item.id}`, { accion: "relacionar", productoId: producto });
    }

    return subida.recepcionId;
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("factura-pedido");
    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"agenda_pagos": true}'::jsonb WHERE id = $1`, [negocio.negocioId]);
    proveedorId = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre, dias_credito) VALUES ($1,$2,15) RETURNING id`, [negocio.negocioId, EMISOR])).rows[0].id;
    // Una recepcion cualquiera para que el servidor cree las tablas de pedidos.
    const p = await nuevoProducto("ZZFP-000", "Producto de arranque");
    await api("/recepciones-mercancia/rapida", { proveedor: "Varios", items: [{ productoId: p, cantidad: 1, costo: 0 }] });
});

after(async () => {
    if (negocio) { await pool.query(`DELETE FROM public.cuentas_pagar WHERE negocio_id = $1`, [negocio.negocioId]); await borrarNegocioPrueba(negocio.negocioId); }
    await detenerServidorPrueba();
    await pool.end();
});

test("la factura se compara con el pedido por productos, aunque el pedido se guardo con el nombre de la marca", async () => {
    const a = await nuevoProducto("ZZFP-A", "Sabritas original fp", 18);
    const b = await nuevoProducto("ZZFP-B", "Doritos nacho fp");
    const c = await nuevoProducto("ZZFP-C", "Cheetos fp");
    const pedido = await pedidoCon([{ id: a, nombre: "Sabritas original fp", cantidad: 10 }, { id: b, nombre: "Doritos nacho fp", cantidad: 6 }, { id: c, nombre: "Cheetos fp", cantidad: 4 }]);

    const recibido = await api("/recepciones-mercancia/rapida", { proveedor: "Sabritas", sinFactura: true, pedidoId: pedido, items: [{ productoId: a, cantidad: 10, costo: 0 }, { productoId: b, cantidad: 4, costo: 0 }] });
    assert.equal(recibido.recepcion.estado, "recibido_sin_factura");

    const factura = await subirFactura("UUID-FP-0001", [
        { codigo: "ZZFP-A", descripcion: "Sabritas original fp", cantidad: 10, costo: 20 },
        { codigo: "ZZFP-B", descripcion: "Doritos nacho fp", cantidad: 6, costo: 30 }
    ], { "ZZFP-A": a, "ZZFP-B": b });

    const comp = await api(`/recepcion-inteligente/facturas/${factura}/comparacion`);
    assert.equal(comp.ok, true, JSON.stringify(comp));
    assert.equal(comp.pedido.id, pedido);

    const fila = id => comp.filas.find(f => f.productoId === id);
    assert.deepEqual([fila(a).pedido, fila(a).llego, fila(a).factura, fila(a).estado], [10, 10, 10, "igual"]);
    assert.equal(fila(a).cambioPrecio, "sube", "el costo de la factura (20) es mayor al que tenia (18)");
    assert.deepEqual([fila(b).pedido, fila(b).llego, fila(b).factura], [6, 4, 6], "llegaron 4 y la factura cobra 6");
    assert.equal(fila(c).estado, "no_viene", "se pidio y la factura no lo trae");
    assert.equal(comp.resumen.faltan, 1);
    assert.equal(comp.resumen.preciosSuben, 1);
});

test("al confirmar la factura se concilia con lo recibido contra el pedido: no suma dos veces y nace la cuenta por pagar con dias de credito", async () => {
    const pedidoRecepcion = (await pool.query(`SELECT id FROM public.recepciones_mercancia WHERE negocio_id = $1 AND pedido_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [negocio.negocioId])).rows[0].id;
    const factura = (await pool.query(`SELECT id FROM public.recepciones_inteligentes WHERE negocio_id = $1 AND uuid_cfdi = 'UUID-FP-0001'`, [negocio.negocioId])).rows[0].id;
    const a = (await pool.query(`SELECT id FROM public.productos WHERE negocio_id = $1 AND codigo = 'ZZFP-A'`, [negocio.negocioId])).rows[0].id;

    const posible = await api(`/recepcion-inteligente/facturas/${factura}/posible-conciliacion`);
    assert.equal(posible.remisionPendiente.recepcionMercanciaId, pedidoRecepcion, "encuentra lo recibido contra el pedido aunque el nombre no coincida");

    const antes = await stockDe(a);
    const r = await api(`/recepcion-inteligente/facturas/${factura}/confirmar`, { conciliarConRecepcionMercanciaId: pedidoRecepcion });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.conciliada, true);
    assert.equal(await stockDe(a), antes, "no se vuelve a sumar");

    assert.equal(r.cuentaPorPagar.accion, "creada");
    assert.equal(r.cuentaPorPagar.monto, 116);
    assert.equal(r.cuentaPorPagar.vencimiento, "2026-11-25", "fecha de la factura + 15 dias de credito");

    const lista = await cuentas();
    assert.equal(lista.length, 1);
    assert.equal(Number(lista[0].saldo), 116);

    // Ya facturado: el pedido no se vuelve a ofrecer como candidato de otra factura.
    const otra = await subirFactura("UUID-FP-0002", [{ codigo: "ZZFP-A", descripcion: "Sabritas original fp", cantidad: 1, costo: 20 }], { "ZZFP-A": a });
    const comp = await api(`/recepcion-inteligente/facturas/${otra}/comparacion`);
    assert.equal(comp.pedido, null);
});

test("si lo recibido ya quedo a deber, la factura ajusta la cuenta al total real (lo abonado se respeta)", async () => {
    const d = await nuevoProducto("ZZFP-D", "Pepsi fp");
    const pedido = await pedidoCon([{ id: d, nombre: "Pepsi fp", cantidad: 5 }]);
    const recibido = await api("/recepciones-mercancia/rapida", { proveedor: EMISOR, sinFactura: true, pedidoId: pedido, items: [{ productoId: d, cantidad: 5, costo: 0 }], pago: { monto: 50, metodo: "a_deber", vencimiento: "2026-12-01" } });
    assert.equal(recibido.pagoGuardado, true);

    const antes = (await cuentas()).find(x => Number(x.origen_id) === recibido.recepcion.id);
    assert.equal(Number(antes.monto_total), 50);
    await pool.query(`UPDATE public.cuentas_pagar SET saldo = 30, estado = 'parcial' WHERE id = $1`, [antes.id]);

    const factura = await subirFactura("UUID-FP-0003", [{ codigo: "ZZFP-D", descripcion: "Pepsi fp", cantidad: 5, costo: 20 }], { "ZZFP-D": d });
    const r = await api(`/recepcion-inteligente/facturas/${factura}/confirmar`, { conciliarConRecepcionMercanciaId: recibido.recepcion.id });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.cuentaPorPagar.accion, "ajustada");

    const despues = (await cuentas()).find(x => x.id === antes.id);
    assert.equal(Number(despues.monto_total), 116);
    assert.equal(Number(despues.saldo), 96, "116 menos los 20 que ya se habian abonado");
    assert.equal(despues.estado, "parcial");
    assert.equal((await cuentas()).filter(x => Number(x.origen_id) === recibido.recepcion.id).length, 1, "sigue siendo una sola cuenta");
});

test("pagar de contado (o un proveedor sin credito) no crea cuenta por pagar", async () => {
    const e = await nuevoProducto("ZZFP-E", "Jugo fp");
    const manual = await api("/recepciones-mercancia/rapida", { proveedor: EMISOR, sinFactura: true, items: [{ productoId: e, cantidad: 3, costo: 0 }], pago: { monto: 116, metodo: "efectivo_propio" } });
    const factura = await subirFactura("UUID-FP-0004", [{ codigo: "ZZFP-E", descripcion: "Jugo fp", cantidad: 3, costo: 30 }], { "ZZFP-E": e });
    const antes = (await cuentas()).length;

    const r = await api(`/recepcion-inteligente/facturas/${factura}/confirmar`, { conciliarConRecepcionMercanciaId: manual.recepcion.id });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.cuentaPorPagar, null);
    assert.equal((await cuentas()).length, antes);
});

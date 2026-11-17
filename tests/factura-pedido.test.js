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

test("dos o tres facturas del mismo pedido: la 2.a se compara contra lo que faltaba y cae en el mismo pedido; la factura de un pedido completo no", async () => {
    const a = await nuevoProducto("ZZFP-M1", "Martillo multi fp");
    const b = await nuevoProducto("ZZFP-M2", "Pinzas multi fp");
    const c = await nuevoProducto("ZZFP-M3", "Taladro multi fp");
    const d = await nuevoProducto("ZZFP-M4", "Brocas multi fp");
    const pedido = await pedidoCon([{ id: a, nombre: "Martillo multi fp", cantidad: 10 }, { id: b, nombre: "Pinzas multi fp", cantidad: 6 }, { id: c, nombre: "Taladro multi fp", cantidad: 4 }, { id: d, nombre: "Brocas multi fp", cantidad: 8 }]);
    const prods = { "ZZFP-M1": a, "ZZFP-M2": b, "ZZFP-M3": c, "ZZFP-M4": d };

    // Factura 1: trae 3 de los 4 productos (con 4 de los 6 pinzas).
    const f1 = await subirFactura("11111111-AAAA-4AAA-8AAA-000000000001", [{ codigo: "ZZFP-M1", descripcion: "Martillo", cantidad: 10, costo: 50 }, { codigo: "ZZFP-M2", descripcion: "Pinzas", cantidad: 4, costo: 30 }, { codigo: "ZZFP-M3", descripcion: "Taladro", cantidad: 4, costo: 90 }], prods);
    const comp1 = await api(`/recepcion-inteligente/facturas/${f1}/comparacion`);
    assert.equal(comp1.pedido.id, pedido, "la primera factura es de ese pedido");
    assert.equal(comp1.pedido.yaFacturado, false);

    const conf1 = await api(`/recepcion-inteligente/facturas/${f1}/confirmar`, { pedidoId: pedido, cantidadesRecibidas: {} });
    assert.ok(conf1.ok !== false, JSON.stringify(conf1));
    assert.equal(Number((await pool.query(`SELECT pedido_id FROM public.recepciones_inteligentes WHERE id = $1`, [f1])).rows[0].pedido_id), pedido, "la factura quedo ligada al pedido");

    // Factura 2: lo que faltaba (2 pinzas y 8 brocas): sigue siendo ese mismo pedido y se compara contra lo FALTANTE.
    const f2 = await subirFactura("22222222-BBBB-4BBB-8BBB-000000000002", [{ codigo: "ZZFP-M2", descripcion: "Pinzas", cantidad: 2, costo: 30 }, { codigo: "ZZFP-M4", descripcion: "Brocas", cantidad: 8, costo: 12 }], prods);
    const comp2 = await api(`/recepcion-inteligente/facturas/${f2}/comparacion`);
    assert.equal(comp2.pedido.id, pedido, "la 2.a factura cae en el mismo pedido");
    assert.equal(comp2.pedido.yaFacturado, true);

    const pinzas = comp2.filas.find(f => f.productoId === b);
    assert.equal(pinzas.antes, 4);
    assert.equal(pinzas.estado, "igual", "2 pinzas es justo lo que faltaba (6 - 4)");
    assert.equal(comp2.filas.find(f => f.productoId === d).estado, "igual");
    assert.equal(comp2.filas.find(f => f.productoId === a).estado, "igual", "el martillo ya llego completo en la 1.a: no cuenta como faltante");

    // Factura 3 con lo mismo que ya llego completo (martillo, taladro y pinzas): el pedido ya no tiene nada pendiente de eso.
    await api(`/recepcion-inteligente/facturas/${f2}/confirmar`, { pedidoId: pedido, cantidadesRecibidas: {} });
    const f3 = await subirFactura("33333333-CCCC-4CCC-8CCC-000000000003", [{ codigo: "ZZFP-M1", descripcion: "Martillo", cantidad: 10, costo: 50 }, { codigo: "ZZFP-M3", descripcion: "Taladro", cantidad: 4, costo: 90 }, { codigo: "ZZFP-M2", descripcion: "Pinzas", cantidad: 6, costo: 30 }], prods);
    const comp3 = await api(`/recepcion-inteligente/facturas/${f3}/comparacion`);
    assert.equal(comp3.pedido, null, "ya no hay un pedido al que le falte eso");
});

test("si dos pedidos se parecen igual, gana el que se esperaba mas cerca del dia que llego la factura segun el dia de visita del proveedor", async () => {
    const a = await nuevoProducto("ZZFP-D1", "Cemento dia fp");
    const b = await nuevoProducto("ZZFP-D2", "Varilla dia fp");
    const c = await nuevoProducto("ZZFP-D3", "Alambre dia fp");
    const renglones = [{ id: a, nombre: "Cemento dia fp", cantidad: 5 }, { id: b, nombre: "Varilla dia fp", cantidad: 5 }, { id: c, nombre: "Alambre dia fp", cantidad: 5 }];
    const viejo = await pedidoCon(renglones);
    const reciente = await pedidoCon(renglones);

    // El proveedor viene el dia de la semana de hace 2 dias. El pedido viejo (hecho hace 4 dias) se esperaba hace 2 dias; el reciente (hace 1 dia) se espera dentro de 5.
    const diaVisita = (new Date().getDay() + 5) % 7;
    await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre, dia_visita, frecuencia_dias) VALUES ($1, 'Sabritas', $2, 7)`, [negocio.negocioId, diaVisita]);
    await pool.query(`UPDATE public.pedidos_proveedor SET created_at = NOW() - INTERVAL '4 days' WHERE id = $1`, [viejo]);
    await pool.query(`UPDATE public.pedidos_proveedor SET created_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [reciente]);

    const f = await subirFactura("44444444-DDDD-4DDD-8DDD-000000000004", [{ codigo: "ZZFP-D1", descripcion: "Cemento", cantidad: 5, costo: 100 }, { codigo: "ZZFP-D2", descripcion: "Varilla", cantidad: 5, costo: 80 }, { codigo: "ZZFP-D3", descripcion: "Alambre", cantidad: 5, costo: 20 }], { "ZZFP-D1": a, "ZZFP-D2": b, "ZZFP-D3": c });
    const comp = await api(`/recepcion-inteligente/facturas/${f}/comparacion`);

    assert.equal(comp.pedido.id, viejo, "gana el pedido cuya entrega se esperaba mas cerca del dia de la factura");
    assert.ok(comp.pedido.entregaEsperada, "se explica con la entrega esperada");
    assert.ok(comp.candidatos.some(x => x.id === reciente), "el otro pedido sigue como opcion");
});

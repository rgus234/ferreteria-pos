// "Recibido, falta factura": la lista de lo recibido a mano con proveedor que espera su factura, y el aviso de que su factura ya llego.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let proveedorId;
const NOMBRE = "Proveedor Lista Falta Factura Unico";
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const lista = async () => (await (await fetch(`${BASE_URL}/recepcion-inteligente/recibido-sin-factura`, { headers: headers() })).json());
const rapida = async cuerpo => (await fetch(`${BASE_URL}/recepciones-mercancia/rapida`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) })).json();
const nuevoProducto = async (codigo, nombre) => (await pool.query(`INSERT INTO public.productos (negocio_id, nombre, codigo, precio, stock) VALUES ($1,$2,$3,50,0) RETURNING id`, [negocio.negocioId, nombre, codigo])).rows[0].id;

const cfdi = uuid => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Folio="7" Fecha="2026-11-10T10:00:00" SubTotal="100.00" Total="116.00">
  <cfdi:Emisor Rfc="PLF850101AB1" Nombre="${NOMBRE}"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos><cfdi:Concepto NoIdentificacion="ZZTEST-LF-001" ClaveProdServ="27112700" Descripcion="Producto lista falta factura" Cantidad="4" ValorUnitario="25" Importe="100.00"/></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>
</cfdi:Comprobante>`;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("lista-falta-factura");
    proveedorId = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1,$2) RETURNING id`, [negocio.negocioId, NOMBRE])).rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("lo recibido a mano con proveedor aparece como 'falta factura'; sin proveedor no; y al llegar su factura avisa cual es", async () => {
    const productoId = await nuevoProducto("ZZTEST-LF-001", "Producto lista falta factura");

    assert.deepEqual((await lista()).recepciones, [], "al inicio no hay nada pendiente");

    const sinProveedor = await rapida({ proveedor: "", sinFactura: true, referencia: "x", idempotencyKey: "lf-sin-prov", items: [{ productoId, cantidad: 1, costo: 0 }] });
    assert.equal(sinProveedor.ok, true, JSON.stringify(sinProveedor));
    assert.deepEqual((await lista()).recepciones, [], "sin proveedor no hay con que empatar: no se lista");

    const manual = await rapida({ proveedor: NOMBRE, sinFactura: true, referencia: "Recibir mercancia", idempotencyKey: "lf-manual", items: [{ productoId, cantidad: 4, costo: 0 }] });
    assert.equal(manual.ok, true, JSON.stringify(manual));

    const antes = (await lista()).recepciones;
    assert.equal(antes.length, 1);
    assert.equal(antes[0].id, manual.recepcion.id);
    assert.equal(antes[0].proveedor, NOMBRE);
    assert.equal(antes[0].productos, 1);
    assert.equal(antes[0].facturaId, null, "todavia no llega su factura");

    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml: cfdi("UUID-LISTA-FALTA-0001") }) })).json();
    assert.ok(subida.recepcionId, JSON.stringify(subida));
    await pool.query(`UPDATE public.recepciones_inteligentes SET proveedor_id = $2 WHERE id = $1`, [subida.recepcionId, proveedorId]);

    const despues = (await lista()).recepciones;
    assert.equal(despues[0].facturaId, subida.recepcionId, "ahora avisa que ya llego su factura");

    await pool.query(`UPDATE public.recepciones_mercancia SET estado = 'conciliado' WHERE negocio_id = $1`, [negocio.negocioId]);
    assert.deepEqual((await lista()).recepciones, [], "ya conciliada, sale de la lista");
});

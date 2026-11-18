// Proveedor que "no da factura" (Gafi, la camioneta de escobas): lo que se recibe de el se cierra al momento
// y no aparece en "Recibido, falta factura". Los demas proveedores siguen igual.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let sinFacturaId;
let conFacturaId;
const SIN = "Camioneta Escobas Sin Factura";
const CON = "Proveedor Con Factura Normal";
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const lista = async () => (await (await fetch(`${BASE_URL}/recepcion-inteligente/recibido-sin-factura`, { headers: headers() })).json());
const rapida = async cuerpo => (await fetch(`${BASE_URL}/recepciones-mercancia/rapida`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) })).json();
const estadoDe = async id => (await pool.query(`SELECT estado FROM public.recepciones_mercancia WHERE id = $1`, [id])).rows[0].estado;
const nuevoProducto = async (codigo, nombre) => (await pool.query(`INSERT INTO public.productos (negocio_id, nombre, codigo, precio, stock) VALUES ($1,$2,$3,50,0) RETURNING id`, [negocio.negocioId, nombre, codigo])).rows[0].id;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("no-da-factura");
    sinFacturaId = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1,$2) RETURNING id`, [negocio.negocioId, SIN])).rows[0].id;
    conFacturaId = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1,$2) RETURNING id`, [negocio.negocioId, CON])).rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("por omision ningun proveedor trae la marca", async () => {
    const r = await pool.query(`SELECT no_da_factura FROM public.proveedores WHERE id = $1`, [sinFacturaId]);
    assert.equal(r.rows[0].no_da_factura, false);
});

test("el editor guarda la marca, la conserva si no se manda y se puede quitar", async () => {
    const editar = async cuerpo => (await fetch(`${BASE_URL}/proveedores/${sinFacturaId}`, { method: "PUT", headers: headers(), body: JSON.stringify({ nombre: SIN, ...cuerpo }) })).json();

    assert.equal((await editar({ noDaFactura: "1" })).proveedor.no_da_factura, true);
    assert.equal((await editar({})).proveedor.no_da_factura, true, "si el formulario no la manda, se conserva");
    assert.equal((await editar({ noDaFactura: "" })).proveedor.no_da_factura, false, "se puede quitar");
    assert.equal((await editar({ noDaFactura: "1" })).proveedor.no_da_factura, true);
});

test("lo recibido de un proveedor que no da factura queda cerrado; el que si da sigue esperando su factura", async () => {
    const productoId = await nuevoProducto("ZZTEST-NDF-001", "Escoba de prueba");

    const sin = await rapida({ proveedor: SIN, sinFactura: true, referencia: "Llegada", idempotencyKey: "ndf-sin", items: [{ productoId, cantidad: 3, costo: 40 }] });
    assert.equal(sin.ok, true, JSON.stringify(sin));
    assert.equal(await estadoDe(sin.recepcion.id), "conciliado", "no hay factura que esperar");

    const con = await rapida({ proveedor: CON, sinFactura: true, referencia: "Llegada", idempotencyKey: "ndf-con", items: [{ productoId, cantidad: 2, costo: 40 }] });
    assert.equal(con.ok, true, JSON.stringify(con));
    assert.equal(await estadoDe(con.recepcion.id), "recibido_sin_factura", "este si espera su factura");

    const pendientes = (await lista()).recepciones.map(r => r.id);
    assert.ok(!pendientes.includes(sin.recepcion.id), "el que no da factura no sale en 'falta factura'");
    assert.ok(pendientes.includes(con.recepcion.id));

    const existencia = (await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoId])).rows[0].stock;
    assert.equal(Number(existencia), 5, "la existencia se suma en los dos casos");
});

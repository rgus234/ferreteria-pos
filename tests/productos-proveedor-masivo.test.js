// Asignar un proveedor a varios productos a la vez (Sugerir pedido: lo que no tiene proveedor no se le puede pedir a nadie).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otro;
let a;
let b;
let ajeno;
let proveedorId;
let proveedorAjeno;
const post = async (n, cuerpo) => { const r = await fetch(`${BASE_URL}/productos/asignar-proveedor`, { method: "POST", headers: { "Content-Type": "application/json", "x-dispositivo-token": n.token }, body: JSON.stringify(cuerpo) }); return { estado: r.status, datos: await r.json().catch(() => ({})) }; };
const fila = async id => (await pool.query(`SELECT proveedor_id, proveedor, precio, stock FROM public.productos WHERE id = $1`, [id])).rows[0];

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("asignar-prov");
    otro = await crearNegocioPrueba("asignar-prov-otro");
    a = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto A prov", precio: 10, stock: 5 });
    b = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto B prov", precio: 12, stock: 7 });
    ajeno = await crearProductoPrueba(otro.negocioId, { nombre: "Producto ajeno prov", precio: 9, stock: 1 });
    proveedorId = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1, 'Sabritas Distribuidor Prueba') RETURNING id`, [negocio.negocioId])).rows[0].id;
    proveedorAjeno = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1, 'Proveedor de otro negocio') RETURNING id`, [otro.negocioId])).rows[0].id;
});

after(async () => {
    for (const n of [negocio, otro]) if (n) await borrarNegocioPrueba(n.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("asigna el proveedor a varios productos de golpe sin tocar precio ni existencias", async () => {
    const r = await post(negocio, { productoIds: [a.id, b.id], proveedorId });

    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.actualizados, 2);

    for (const [p, precio, stock] of [[a, 10, 5], [b, 12, 7]]) {
        const f = await fila(p.id);
        assert.equal(Number(f.proveedor_id), proveedorId);
        assert.equal(f.proveedor, "Sabritas Distribuidor Prueba");
        assert.deepEqual([Number(f.precio), Number(f.stock)], [precio, stock]);
    }
});

test("no toca productos de otro negocio ni acepta un proveedor de otro negocio", async () => {
    const r1 = await post(negocio, { productoIds: [ajeno.id], proveedorId });
    assert.equal(r1.estado, 200);
    assert.equal(r1.datos.actualizados, 0, "el producto ajeno no se actualiza");
    assert.equal((await fila(ajeno.id)).proveedor_id, null);

    const r2 = await post(negocio, { productoIds: [a.id], proveedorId: proveedorAjeno });
    assert.equal(r2.estado, 404);
});

test("datos invalidos se rechazan", async () => {
    assert.equal((await post(negocio, { productoIds: [], proveedorId })).estado, 400);
    assert.equal((await post(negocio, { productoIds: [a.id] })).estado, 400);
});

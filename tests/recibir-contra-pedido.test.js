// Recibir contra un pedido (abarrotes): la recepcion rapida se liga al pedido, le suma lo recibido a cada producto y el pedido
// pasa a "parcial" o "recibido". Un pedido cancelado no se puede recibir.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let sabritas;
let doritos;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const recibir = cuerpo => fetch(`${BASE_URL}/recepciones-mercancia/rapida`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) });

async function crearPedido(estado, renglones) {
    const pedido = (await pool.query(`INSERT INTO public.pedidos_proveedor (negocio_id, proveedor, estado, total_estimado) VALUES ($1, 'Sabritas', $2, 0) RETURNING id`, [negocio.negocioId, estado])).rows[0];

    for (const r of renglones) {
        await pool.query(`INSERT INTO public.pedidos_proveedor_items (negocio_id, pedido_id, producto_id, nombre, cantidad, costo) VALUES ($1, $2, $3, $4, $5, 0)`, [negocio.negocioId, pedido.id, r.id, r.nombre, r.cantidad]);
    }

    return pedido.id;
}

const estadoDe = async id => (await pool.query(`SELECT estado FROM public.pedidos_proveedor WHERE id = $1`, [id])).rows[0].estado;
const recibidos = async id => (await pool.query(`SELECT producto_id, recibido FROM public.pedidos_proveedor_items WHERE pedido_id = $1 ORDER BY id`, [id])).rows.map(r => Number(r.recibido));

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("recibir-pedido");
    sabritas = await crearProductoPrueba(negocio.negocioId, { nombre: "Sabritas original", precio: 20, stock: 1 });
    doritos = await crearProductoPrueba(negocio.negocioId, { nombre: "Doritos nacho", precio: 20, stock: 1 });
    // Una recepcion cualquiera para que el servidor cree las tablas de pedidos.
    await (await recibir({ proveedor: "Varios", items: [{ productoId: sabritas.id, cantidad: 1, costo: 0 }] })).json();
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("recibir parte del pedido lo deja 'parcial'; recibir el resto lo deja 'recibido'", async () => {
    const id = await crearPedido("enviado", [{ id: sabritas.id, nombre: "Sabritas original", cantidad: 10 }, { id: doritos.id, nombre: "Doritos nacho", cantidad: 6 }]);

    const primera = await (await recibir({ proveedor: "Sabritas", pedidoId: id, items: [{ productoId: sabritas.id, cantidad: 10, costo: 0 }, { productoId: doritos.id, cantidad: 2, costo: 0 }] })).json();
    assert.equal(primera.ok, true, JSON.stringify(primera));
    assert.equal(primera.pedidoEstado, "parcial");
    assert.deepEqual(await recibidos(id), [10, 2]);
    assert.equal(Number(primera.recepcion.pedido_id), id, "la recepcion queda ligada al pedido");
    assert.equal(await estadoDe(id), "parcial");

    const segunda = await (await recibir({ proveedor: "Sabritas", pedidoId: id, items: [{ productoId: doritos.id, cantidad: 4, costo: 0 }] })).json();
    assert.equal(segunda.pedidoEstado, "recibido");
    assert.deepEqual(await recibidos(id), [10, 6]);
    assert.equal(await estadoDe(id), "recibido");
});

test("el inventario sube igual que al recibir a mano", async () => {
    const stock = (await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [doritos.id])).rows[0].stock;
    assert.equal(Number(stock), 1 + 2 + 4);
});

test("un pedido cancelado o ajeno no se puede recibir y no suma nada", async () => {
    const cancelado = await crearPedido("cancelado", [{ id: sabritas.id, nombre: "Sabritas original", cantidad: 5 }]);
    const antes = Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [sabritas.id])).rows[0].stock);

    const r1 = await recibir({ proveedor: "Sabritas", pedidoId: cancelado, items: [{ productoId: sabritas.id, cantidad: 5, costo: 0 }] });
    assert.equal(r1.status, 404);

    const r2 = await recibir({ proveedor: "Sabritas", pedidoId: 999999999, items: [{ productoId: sabritas.id, cantidad: 5, costo: 0 }] });
    assert.equal(r2.status, 404);

    const despues = Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [sabritas.id])).rows[0].stock);
    assert.equal(despues, antes, "no se sumo nada al inventario");
});

test("recibir sin pedido sigue igual: no toca ningun pedido", async () => {
    const id = await crearPedido("enviado", [{ id: sabritas.id, nombre: "Sabritas original", cantidad: 3 }]);
    const r = await (await recibir({ proveedor: "Sabritas", items: [{ productoId: sabritas.id, cantidad: 3, costo: 0 }] })).json();

    assert.equal(r.ok, true);
    assert.equal(r.pedidoEstado, null);
    assert.equal(await estadoDe(id), "enviado");
    assert.deepEqual(await recibidos(id), [0]);
});

test("lo que llega de mas se queda en el pedido sin romper nada", async () => {
    const id = await crearPedido("enviado", [{ id: doritos.id, nombre: "Doritos nacho", cantidad: 2 }]);
    const r = await (await recibir({ proveedor: "Sabritas", pedidoId: id, items: [{ productoId: doritos.id, cantidad: 5, costo: 0 }] })).json();

    assert.equal(r.pedidoEstado, "recibido");
    assert.deepEqual(await recibidos(id), [5]);
});

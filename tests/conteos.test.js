// Conteos con aprobacion: guardar no cambia existencias; aprobar suma la diferencia a lo de AHORA; rechazar no cambia nada.
// Requiere la migracion 20261104_conteos.sql.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let N, otro, martillo, pinza, estante, rack;
const llamar = async (negocio, ruta, opciones = {}) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token } });
    return { status: r.status, cuerpo: await r.json() };
};
const post = (ruta, datos, negocio = N) => llamar(negocio, ruta, { method: "POST", body: JSON.stringify(datos) });
const stockDe = async id => Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [id])).rows[0].stock);

before(async () => {
    await iniciarServidorPrueba();
    N = await crearNegocioPrueba("conteos-a");
    otro = await crearNegocioPrueba("conteos-b");
    martillo = await crearProductoPrueba(N.negocioId, { nombre: "Martillo de una", precio: 175, stock: 14 });
    pinza = await crearProductoPrueba(N.negocioId, { nombre: "Pinza de electricista", precio: 98, stock: 18 });
    estante = (await post("/ubicaciones", { nombre: "Estante 1", zona: "tienda", tipo: "estante" })).cuerpo.ubicacion;
    rack = (await post("/ubicaciones", { nombre: "Rack 1", zona: "bodega", tipo: "rack" })).cuerpo.ubicacion;
    await post(`/ubicaciones/${estante.id}/asignar`, { productoIds: [martillo.id, pinza.id] });
});

after(async () => {
    await pool.query(`UPDATE public.productos SET ubicacion_id = NULL, ubicacion_bodega_id = NULL WHERE negocio_id = $1`, [N.negocioId]);
    await pool.query(`DELETE FROM public.ajustes_inventario WHERE negocio_id = $1`, [N.negocioId]);
    for (const n of [N, otro]) if (n) await borrarNegocioPrueba(n.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

let conteoId;

test("guardar un conteo lo deja pendiente y NO cambia las existencias", async () => {
    // Esperado: martillo 14 y pinza 18. Se cuentan 12 martillos y 18 pinzas.
    const r = await post(`/ubicaciones/${estante.id}/conteo/guardar`, { conteos: [{ productoId: martillo.id, cantidad: 12 }, { productoId: pinza.id, cantidad: 18 }], nota: "Pasillo 1" });

    assert.equal(r.status, 201);
    assert.equal(r.cuerpo.faltan, 2);
    assert.equal(r.cuerpo.sobran, 0);
    conteoId = r.cuerpo.conteoId;

    assert.equal(await stockDe(martillo.id), 14, "guardar no toca el inventario");
    assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM public.ajustes_inventario WHERE negocio_id = $1`, [N.negocioId])).rows[0].n, 0);

    const pendientes = (await llamar(N, "/conteos?estado=pendiente")).cuerpo;
    assert.equal(pendientes.conteos.length, 1);
    assert.equal(pendientes.conteos[0].estado, "pendiente");
    assert.equal((await llamar(N, "/ubicaciones/resumen")).cuerpo.conteosPendientes, 1);

    assert.equal((await post(`/ubicaciones/${estante.id}/conteo/guardar`, { conteos: [] })).status, 400, "sin contar nada no hay conteo");
});

test("el detalle trae las lineas con esperado, contado y diferencia", async () => {
    const d = (await llamar(N, `/conteos/${conteoId}`)).cuerpo;
    const linea = d.lineas.find(l => l.productoId === martillo.id);

    assert.equal(linea.esperado, 14);
    assert.equal(linea.contado, 12);
    assert.equal(linea.diferencia, -2);
    assert.equal(d.conteo.creadoPor, "Dueño");
    assert.equal((await llamar(otro, `/conteos/${conteoId}`)).status, 404, "otro negocio no lo ve");
});

test("aprobar suma la diferencia a la existencia de AHORA (una venta posterior no se pisa) y deja registro", async () => {
    await pool.query(`UPDATE public.productos SET stock = 10 WHERE id = $1`, [martillo.id]); // se vendieron 4 despues de contar

    const r = await post(`/conteos/${conteoId}/aprobar`, {});
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.aplicadas, 1);
    assert.equal(await stockDe(martillo.id), 8, "10 de ahora - 2 de diferencia, no 12");
    assert.equal(await stockDe(pinza.id), 18, "sin diferencia no se toca");

    const ajuste = (await pool.query(`SELECT tipo, stock_anterior, stock_nuevo, referencia FROM public.ajustes_inventario WHERE producto_id = $1`, [martillo.id])).rows[0];
    assert.equal(ajuste.tipo, "conteo");
    assert.equal(Number(ajuste.stock_nuevo), 8);
    assert.match(ajuste.referencia, /Conteo #\d+/);

    assert.equal((await post(`/conteos/${conteoId}/aprobar`, {})).status, 409, "no se aplica dos veces");
    assert.equal((await llamar(N, "/ubicaciones/resumen")).cuerpo.conteosPendientes, 0);
});

test("rechazar no cambia nada y se puede excluir un producto al aprobar", async () => {
    const a = (await post(`/ubicaciones/${estante.id}/conteo/guardar`, { conteos: [{ productoId: pinza.id, cantidad: 15 }] })).cuerpo.conteoId;
    assert.equal((await post(`/conteos/${a}/rechazar`, { nota: "Contaron mal" })).status, 200);
    assert.equal(await stockDe(pinza.id), 18);
    assert.equal((await post(`/conteos/${a}/rechazar`, {})).status, 409, "ya estaba revisado");

    const b = (await post(`/ubicaciones/${estante.id}/conteo/guardar`, { conteos: [{ productoId: pinza.id, cantidad: 16 }, { productoId: martillo.id, cantidad: 9 }] })).cuerpo.conteoId;
    const r = await post(`/conteos/${b}/aprobar`, { excluir: [pinza.id] });
    assert.equal(r.cuerpo.aplicadas, 1);
    assert.equal(await stockDe(pinza.id), 18, "el excluido no se toca");
    assert.equal(await stockDe(martillo.id), 9);

    const historial = (await llamar(N, "/conteos")).cuerpo.conteos;
    assert.deepEqual(historial.map(c => c.estado).sort(), ["aprobado", "aprobado", "rechazado"]);
});

test("contar una seccion de bodega: al aprobar se corrige lo anotado en esa seccion", async () => {
    await post(`/ubicaciones/${rack.id}/asignar`, { productoIds: [pinza.id] });
    await post(`/ubicaciones/${rack.id}/bodega`, { productoId: pinza.id, cantidad: 6 });

    const id = (await post(`/ubicaciones/${rack.id}/conteo/guardar`, { conteos: [{ productoId: pinza.id, cantidad: 8 }] })).cuerpo.conteoId; // se esperaban 6, hay 8
    await post(`/conteos/${id}/aprobar`, {});

    assert.equal(Number((await pool.query(`SELECT cantidad FROM public.producto_ubicaciones WHERE producto_id = $1 AND ubicacion_id = $2`, [pinza.id, rack.id])).rows[0].cantidad), 8);
    assert.equal(await stockDe(pinza.id), 20, "18 + 2");
});

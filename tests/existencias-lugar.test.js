// Bodega vs exhibicion: exhibicion = stock - bodega; Resurtir mueve de bodega a exhibicion; conteo por estante ajusta el total.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { desglose, estadoResurtir, compararConteo } = require("../existencias-lugar-server");

let N, pija, broca, estante, rack;
const llamar = async (ruta, opciones = {}) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: { "Content-Type": "application/json", "x-dispositivo-token": N.token } });
    return { status: r.status, cuerpo: await r.json() };
};
const post = (ruta, datos) => llamar(ruta, { method: "POST", body: JSON.stringify(datos) });
const stockDe = async id => Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [id])).rows[0].stock);

before(async () => {
    await iniciarServidorPrueba();
    N = await crearNegocioPrueba("existencias-lugar");
    pija = await crearProductoPrueba(N.negocioId, { nombre: "Pija punta broca 1", precio: 85, stock: 50 });
    broca = await crearProductoPrueba(N.negocioId, { nombre: "Broca 1/4", precio: 35, stock: 10 });
    estante = (await post("/ubicaciones", { nombre: "Estante 2", zona: "tienda", tipo: "estante" })).cuerpo.ubicacion;
    rack = (await post("/ubicaciones", { nombre: "Rack 3", zona: "bodega", tipo: "rack" })).cuerpo.ubicacion;
    await post(`/ubicaciones/${estante.id}/asignar`, { productoIds: [pija.id, broca.id] });
});

after(async () => {
    await pool.query(`UPDATE public.productos SET ubicacion_id = NULL, ubicacion_bodega_id = NULL WHERE negocio_id = $1`, [N.negocioId]);
    await pool.query(`DELETE FROM public.ajustes_inventario WHERE negocio_id = $1`, [N.negocioId]);
    await borrarNegocioPrueba(N.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("el desglose: exhibicion = total - bodega, y una bodega mayor al total se limita y avisa", () => {
    assert.deepEqual(desglose(50, 30), { total: 50, bodega: 30, exhibicion: 20, descuadre: false });
    assert.deepEqual(desglose(10, 30), { total: 10, bodega: 10, exhibicion: 0, descuadre: true });
    assert.equal(estadoResurtir(desglose(50, 50), 0), "agotado");
    assert.equal(estadoResurtir(desglose(55, 50), 8), "poco");
    assert.equal(estadoResurtir(desglose(60, 0), 8), null, "sin bodega no hay nada que resurtir");
});

test("anotar bodega: no puede haber mas en bodega que el total del producto", async () => {
    assert.equal((await post(`/ubicaciones/${rack.id}/bodega`, { productoId: pija.id, cantidad: 80 })).status, 400);
    assert.equal((await post(`/ubicaciones/${estante.id}/bodega`, { productoId: pija.id, cantidad: 5 })).status, 400, "la tienda no guarda cantidad aparte");

    const ok = await post(`/ubicaciones/${rack.id}/bodega`, { productoId: pija.id, cantidad: 30 });
    assert.equal(ok.status, 200);
    assert.equal(ok.cuerpo.exhibicion, 20);
    assert.equal(ok.cuerpo.bodega, 30);
});

test("una venta baja la exhibicion sola; al llegar a cero aparece en Resurtir", async () => {
    assert.equal((await llamar("/resurtir")).cuerpo.productos.length, 0, "con 20 en exhibicion todavia no hace falta");

    await pool.query(`UPDATE public.productos SET stock = 30 WHERE id = $1`, [pija.id]); // se vendieron 20
    const lista = (await llamar("/resurtir")).cuerpo;

    assert.equal(lista.agotados, 1);
    assert.equal(lista.productos[0].nombre, "Pija punta broca 1");
    assert.equal(lista.productos[0].exhibicion, 0);
    assert.equal(lista.productos[0].bodega, 30);
    assert.equal(lista.productos[0].estante, "Tienda › Estante 2");
    assert.equal(lista.productos[0].lugaresBodega[0].ruta, "Rack 3");
});

test("resurtir pasa de bodega a exhibicion sin cambiar el total", async () => {
    assert.equal((await post("/resurtir", { productoId: pija.id, desdeId: rack.id, cantidad: 99 })).status, 400, "no se puede sacar mas de lo que hay");

    const r = await post("/resurtir", { productoId: pija.id, desdeId: rack.id, cantidad: 12 });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.exhibicion, 12);
    assert.equal(r.cuerpo.bodega, 18);
    assert.equal(await stockDe(pija.id), 30, "el total no cambia");
    assert.equal((await llamar("/resurtir")).cuerpo.productos.length, 0, "ya hay en exhibicion");
});

test("conteo de estante: primero muestra faltan/sobran sin tocar nada, luego aplica y deja registro", async () => {
    // Exhibicion esperada: pija 12, broca 10. Se cuentan 10 pijas y no se escanea la broca.
    const vista = await post(`/ubicaciones/${estante.id}/conteo`, { conteos: [{ productoId: pija.id, cantidad: 10 }] });

    assert.equal(vista.cuerpo.aplicado, false);
    assert.equal(vista.cuerpo.faltan, 2);
    assert.equal(vista.cuerpo.lineas.find(l => l.productoId === broca.id).noEscaneado, true);
    assert.equal(await stockDe(pija.id), 30, "ver no cambia nada");

    const hecho = await post(`/ubicaciones/${estante.id}/conteo`, { conteos: [{ productoId: pija.id, cantidad: 10 }], aplicar: true });
    assert.equal(hecho.cuerpo.ajustados, 1);
    assert.equal(await stockDe(pija.id), 28);
    assert.equal(await stockDe(broca.id), 10, "lo que no se escaneo no se toca");

    const ajuste = (await pool.query(`SELECT tipo, cantidad, stock_anterior, stock_nuevo FROM public.ajustes_inventario WHERE producto_id = $1`, [pija.id])).rows[0];
    assert.equal(ajuste.tipo, "conteo");
    assert.equal(Number(ajuste.stock_nuevo), 28);
    assert.equal(desglose(28, 18).exhibicion, 10);
});

test("conteo de bodega corrige la cantidad de esa seccion y el total", async () => {
    // Se esperaban 18 en el rack; hay 20.
    const r = await post(`/ubicaciones/${rack.id}/conteo`, { conteos: [{ productoId: pija.id, cantidad: 20 }], aplicar: true });

    assert.equal(r.cuerpo.sobran, 2);
    assert.equal(await stockDe(pija.id), 30);
    assert.equal(Number((await pool.query(`SELECT cantidad FROM public.producto_ubicaciones WHERE producto_id = $1 AND ubicacion_id = $2`, [pija.id, rack.id])).rows[0].cantidad), 20);
});

test("compararConteo: lo no escaneado cuenta como cero solo si se pide", () => {
    const lugar = { zona: "tienda" };
    const productos = [{ id: 1, nombre: "A", stock: 10, bodega_total: 0 }, { id: 2, nombre: "B", stock: 5, bodega_total: 0 }];

    assert.equal(compararConteo(lugar, productos, [{ productoId: 1, cantidad: 10 }], false).faltan, 0);
    assert.equal(compararConteo(lugar, productos, [{ productoId: 1, cantidad: 10 }], true).faltan, 5);
});

test("indicadores de la pantalla principal y buscador de donde esta cada producto", async () => {
    const r = (await llamar("/ubicaciones/resumen")).cuerpo;

    assert.equal(r.ubicaciones, 2);
    assert.equal(r.productosConLugar, 2);
    assert.equal(r.productosSinLugar, 0);
    assert.equal(r.porResurtir, 0);

    const busca = (await llamar("/ubicaciones/buscar?q=pija")).cuerpo.productos;
    assert.equal(busca.length, 1);
    assert.equal(busca[0].ubicacion, "Tienda › Estante 2 · Bodega: Rack 3");
    assert.equal(busca[0].bodega, 20);
    assert.equal(busca[0].exhibicion + busca[0].bodega, busca[0].total);

    assert.deepEqual((await llamar("/ubicaciones/buscar?q=a")).cuerpo.productos, [], "con una letra no busca");
});

test("la ficha del producto trae existencias por lado, lugares y especificaciones (sin costos)", async () => {
    const r = (await llamar(`/ubicaciones/producto/${pija.id}`)).cuerpo.producto;

    assert.equal(r.nombre, "Pija punta broca 1");
    assert.equal(r.total, 30);
    assert.equal(r.bodega, 20);
    assert.equal(r.exhibicion, 10);
    assert.equal(r.estante.ruta, "Estante 2");
    assert.equal(r.bodegas[0].ruta, "Rack 3");
    assert.equal("costo" in r, false, "el costo no se muestra en el celular");
    assert.equal((await llamar("/ubicaciones/producto/99999999")).status, 404);
});

test("mover un producto a otro estante queda registrado (de donde a donde) y se ve en su ficha", async () => {
    const otro = (await post("/ubicaciones", { nombre: "Estante 9", zona: "tienda", tipo: "estante" })).cuerpo.ubicacion;

    // Aun sin lugar anterior en esta zona no cuenta como movimiento: broca ya estaba en el estante 2.
    const mov = await post(`/ubicaciones/${otro.id}/asignar`, { productoIds: [broca.id] });
    assert.equal(mov.cuerpo.movidos, 1);

    const ficha = (await llamar(`/ubicaciones/producto/${broca.id}`)).cuerpo.producto;
    assert.equal(ficha.estante.id, otro.id);
    assert.equal(ficha.movimientos.length >= 1, true);
    assert.equal(ficha.movimientos[0].accion, "producto_movido");
    assert.match(ficha.movimientos[0].desde, /Estante 2/);
    assert.match(ficha.movimientos[0].hacia, /Estante 9/);

    const igual = await post(`/ubicaciones/${otro.id}/asignar`, { productoIds: [broca.id] });
    assert.equal(igual.cuerpo.movidos, 0, "asignarlo al mismo lugar no es un movimiento");
});

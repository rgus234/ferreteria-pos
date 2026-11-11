// Actualizar precios por lote + historial de precios: todo cambio de precio o costo queda registrado (venga de donde venga), un lote se aplica
// completo o se omite lo que cambio mientras tanto, y se puede deshacer sin pisar lo que se movio despues.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otroNegocio;
let sabritas;
let doritos;
let cheetos;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const api = async (ruta, cuerpo, metodo) => (await fetch(`${BASE_URL}${ruta}`, { method: metodo || (cuerpo ? "POST" : "GET"), headers: headers(), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) })).json();
const fila = async id => (await pool.query(`SELECT precio, precio_publico, costo FROM public.productos WHERE id = $1`, [id])).rows[0];
const historial = async id => (await pool.query(`SELECT campo, anterior::float AS anterior, nuevo::float AS nuevo, origen, lote_id FROM public.historial_precios WHERE producto_id = $1 ORDER BY id`, [id])).rows;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("precios-lote");
    otroNegocio = await crearNegocioPrueba("precios-lote-otro");
    sabritas = await crearProductoPrueba(negocio.negocioId, { nombre: "Sabritas original pl", precio: 20, stock: 5 });
    doritos = await crearProductoPrueba(negocio.negocioId, { nombre: "Doritos nacho pl", precio: 22, stock: 5 });
    cheetos = await crearProductoPrueba(negocio.negocioId, { nombre: "Cheetos pl", precio: 18, stock: 5 });
    await pool.query(`UPDATE public.productos SET precio_publico = precio, costo = 12 WHERE negocio_id = $1`, [negocio.negocioId]);
});

after(async () => {
    for (const n of [negocio, otroNegocio]) if (n) await borrarNegocioPrueba(n.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("cualquier cambio de precio o costo queda en el historial, sin importar el camino; cambiar stock no", async () => {
    await pool.query(`UPDATE public.productos SET stock = stock + 3 WHERE id = $1`, [sabritas.id]);
    const antes = (await historial(sabritas.id)).length;

    await pool.query(`UPDATE public.productos SET precio_publico = 21, precio_mayoreo = 19 WHERE id = $1`, [sabritas.id]);
    await pool.query(`UPDATE public.productos SET precio_publico = 21 WHERE id = $1`, [sabritas.id]);   // mismo valor: nada

    const h = (await historial(sabritas.id)).slice(antes);
    assert.deepEqual(h.map(x => [x.campo, x.anterior, x.nuevo, x.origen]).sort(), [["precio_mayoreo", null, 19, "edicion"], ["precio_publico", 20, 21, "edicion"]].sort());

    await pool.query(`UPDATE public.productos SET precio_publico = 20, precio_mayoreo = NULL WHERE id = $1`, [sabritas.id]);
});

test("un producto nuevo deja su primer precio en el historial", async () => {
    const nuevo = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto alta pl", precio: 33, stock: 1 });
    const h = await historial(nuevo.id);

    assert.ok(h.length >= 1);
    assert.deepEqual([h[0].campo, h[0].anterior, h[0].origen], ["precio_publico", null, "alta"]);
});

test("un lote cambia los precios, queda como UN lote con su motivo y mueve tambien el precio del carrito", async () => {
    const r = await api("/precios-lote/aplicar", { motivo: "Subio Sabritas 5%", usuario: "Don Beto", cambios: [
        { productoId: sabritas.id, campo: "precio_publico", anterior: 20, nuevo: 21 },
        { productoId: doritos.id, campo: "precio_publico", anterior: 22, nuevo: 23.5 },
        { productoId: sabritas.id, campo: "costo", anterior: 12, nuevo: 12.6 }
    ] });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.aplicados, 3);
    assert.ok(r.loteId);

    const s = await fila(sabritas.id);
    assert.deepEqual([Number(s.precio_publico), Number(s.precio), Number(s.costo)], [21, 21, 12.6], "precio tambien sube porque iba igualado al publico");

    const h = (await historial(doritos.id)).filter(x => x.origen === "lote");
    assert.equal(h.length, 1);
    assert.equal(h[0].lote_id, r.loteId);

    const lotes = await api("/precios-lote/lotes");
    assert.equal(lotes.lotes[0].id, r.loteId);
    assert.deepEqual([lotes.lotes[0].motivo, lotes.lotes[0].usuario, lotes.lotes[0].productos, lotes.lotes[0].deshecho], ["Subio Sabritas 5%", "Don Beto", 2, false]);
});

test("lo que cambio despues de la vista previa o ya esta en ese precio se omite, no se pisa", async () => {
    await pool.query(`UPDATE public.productos SET precio_publico = 19 WHERE id = $1`, [cheetos.id]);   // alguien lo movio mientras tanto

    const r = await api("/precios-lote/aplicar", { cambios: [
        { productoId: cheetos.id, campo: "precio_publico", anterior: 18, nuevo: 20 },
        { productoId: doritos.id, campo: "precio_publico", anterior: 23.5, nuevo: 23.5 },
        { productoId: 999999999, campo: "precio_publico", anterior: 1, nuevo: 2 }
    ] });

    assert.equal(r.aplicados, 0);
    assert.deepEqual(r.omitidos.map(o => o.motivo).sort(), ["cambio mientras tanto", "sin cambio", "ya no existe"]);
    assert.equal(r.loteId, null);
    assert.equal(Number((await fila(cheetos.id)).precio_publico), 19);
});

test("un producto de OTRO negocio no se toca", async () => {
    const ajeno = await crearProductoPrueba(otroNegocio.negocioId, { nombre: "Ajeno pl", precio: 50, stock: 1 });
    await pool.query(`UPDATE public.productos SET precio_publico = 50 WHERE id = $1`, [ajeno.id]);

    const r = await api("/precios-lote/aplicar", { cambios: [{ productoId: ajeno.id, campo: "precio_publico", anterior: 50, nuevo: 99 }] });

    assert.equal(r.aplicados, 0);
    assert.equal(r.omitidos[0].motivo, "ya no existe");
    assert.equal(Number((await fila(ajeno.id)).precio_publico), 50);
});

test("datos invalidos se rechazan", async () => {
    const mal = await fetch(`${BASE_URL}/precios-lote/aplicar`, { method: "POST", headers: headers(), body: JSON.stringify({ cambios: [{ productoId: sabritas.id, campo: "stock", nuevo: 5 }] }) });
    assert.equal(mal.status, 400);

    const negativo = await fetch(`${BASE_URL}/precios-lote/aplicar`, { method: "POST", headers: headers(), body: JSON.stringify({ cambios: [{ productoId: sabritas.id, campo: "precio_publico", nuevo: -3 }] }) });
    assert.equal(negativo.status, 400);

    const vacio = await fetch(`${BASE_URL}/precios-lote/aplicar`, { method: "POST", headers: headers(), body: JSON.stringify({ cambios: [] }) });
    assert.equal(vacio.status, 400);
});

test("deshacer regresa el lote, pero no pisa lo que se movio despues", async () => {
    const lotes = await api("/precios-lote/lotes");
    const lote = lotes.lotes[0].id;

    // Alguien cambia Doritos despues del lote.
    await pool.query(`UPDATE public.productos SET precio_publico = 30 WHERE id = $1`, [doritos.id]);

    const r = await api(`/precios-lote/${lote}/deshacer`, { usuario: "Don Beto" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.regresados, 2, "Sabritas precio y costo");
    assert.deepEqual(r.omitidos.map(o => o.motivo), ["cambio despues del lote"]);

    const s = await fila(sabritas.id);
    assert.deepEqual([Number(s.precio_publico), Number(s.precio), Number(s.costo)], [20, 20, 12]);
    assert.equal(Number((await fila(doritos.id)).precio_publico), 30, "Doritos se queda como lo dejaron despues");

    const otra = await fetch(`${BASE_URL}/precios-lote/${lote}/deshacer`, { method: "POST", headers: headers(), body: "{}" });
    assert.equal(otra.status, 400, "un lote solo se deshace una vez");

    assert.equal((await api("/precios-lote/lotes")).lotes.find(l => l.id === lote).deshecho, true);
    assert.ok((await historial(sabritas.id)).some(x => x.origen === "deshacer"));
});

test("el historial de un producto cuenta su historia completa", async () => {
    const r = await api(`/precios-lote/producto/${sabritas.id}`);

    assert.equal(r.ok, true);
    assert.ok(r.cambios.length >= 5);
    assert.ok(r.cambios.some(c => c.origen === "lote") && r.cambios.some(c => c.origen === "deshacer") && r.cambios.some(c => c.origen === "edicion"));
    assert.equal(r.cambios[0].origen, "deshacer", "el mas reciente primero");
});

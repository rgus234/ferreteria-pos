// Minimos y maximos con tus ventas: el calculo, la propuesta (solo con ventas suficientes), aplicar con respaldo, deshacer sin pisar, y que no toque a otro negocio.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { calcularLimites } = require("../minimos-ventas-server");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio, otro;
const api = async (n, ruta, cuerpo) => { const r = await fetch(`${BASE_URL}${ruta}`, { method: cuerpo ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-dispositivo-token": n.token }, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) }); return { estado: r.status, datos: await r.json().catch(() => ({})) }; };
const fila = async id => (await pool.query(`SELECT stock_minimo, stock_maximo FROM public.productos WHERE id = $1`, [id])).rows[0];

test("el calculo: minimo = lo que se vende en la cobertura, maximo = el doble, nunca menos de 1 ni max <= min", () => {
    assert.deepEqual(calcularLimites({ vendido: 28, diasVentana: 28, cobertura: 14 }), { porDia: 1, minimo: 14, maximo: 28 });
    assert.deepEqual(calcularLimites({ vendido: 3, diasVentana: 90, cobertura: 7 }), { porDia: 0.033, minimo: 1, maximo: 2 });
    assert.deepEqual(calcularLimites({ vendido: 0, diasVentana: 90, cobertura: 14 }).minimo, 1);
});

before(async () => { await iniciarServidorPrueba(); negocio = await crearNegocioPrueba("minimos"); otro = await crearNegocioPrueba("minimos-otro"); });
after(async () => {
    for (const n of [negocio, otro]) if (n) { await pool.query(`DELETE FROM public.minimos_aplicados WHERE negocio_id = $1`, [n.negocioId]).catch(() => {}); await pool.query(`DELETE FROM public.historial_ventas WHERE negocio_id = $1`, [n.negocioId]).catch(() => {}); await borrarNegocioPrueba(n.negocioId); }
    await detenerServidorPrueba(); await pool.end();
});

const vender = async (n, producto, cantidad, dias) => pool.query(
    `INSERT INTO public.historial_ventas (negocio_id, fecha, estado, total, productos) VALUES ($1, NOW() - ($2 || ' days')::interval, 'completada', 10, $3::jsonb)`,
    [n.negocioId, String(dias), JSON.stringify([{ id: producto.id, cantidad, nombre: producto.nombre }])]);

test("propone con ventas suficientes, aplica con respaldo, deshace sin pisar lo cambiado despues y no toca a otro negocio", async () => {
    const vende = await crearProductoPrueba(negocio.negocioId, { nombre: "Cemento min", precio: 100, stock: 5 });
    const poco = await crearProductoPrueba(negocio.negocioId, { nombre: "Raro min", precio: 100, stock: 5 });
    const ajeno = await crearProductoPrueba(otro.negocioId, { nombre: "Ajeno min", precio: 100, stock: 5 });
    for (const d of [28, 21, 14, 7, 1]) await vender(negocio, vende, 4, d); // 20 piezas en 5 ventas
    await vender(negocio, poco, 1, 3);
    await vender(otro, ajeno, 9, 2);

    const p = await api(negocio, "/inventario/minimos-sugeridos?cobertura=14");
    assert.equal(p.estado, 200, JSON.stringify(p.datos));
    const sug = p.datos.productos.find(x => x.id === vende.id);
    assert.ok(sug, "el que se vende aparece");
    assert.ok(!p.datos.productos.some(x => x.id === poco.id || x.id === ajeno.id), "con una sola venta no se propone, y el de otro negocio no aparece");
    assert.ok(sug.minimo >= 1 && sug.maximo > sug.minimo);

    const r = await api(negocio, "/inventario/minimos-aplicar", { items: [{ id: vende.id, minimo: sug.minimo, maximo: sug.maximo }, { id: ajeno.id, minimo: 50, maximo: 60 }], usuario: "Prueba" });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.productos, 1, "el producto ajeno se ignora");
    assert.deepEqual([Number((await fila(vende.id)).stock_minimo), Number((await fila(vende.id)).stock_maximo)], [sug.minimo, sug.maximo]);
    assert.notEqual(Number((await fila(ajeno.id)).stock_minimo), 50);

    await pool.query(`UPDATE public.productos SET stock_minimo = 99 WHERE id = $1`, [vende.id]);
    const d = await api(negocio, `/inventario/minimos-lotes/${r.datos.lote}/deshacer`, {});
    assert.equal(d.estado, 200, JSON.stringify(d.datos));
    assert.equal(d.datos.productos, 0, "lo que se cambio despues se respeta");
    assert.equal(Number((await fila(vende.id)).stock_minimo), 99);
    assert.equal((await api(negocio, `/inventario/minimos-lotes/${r.datos.lote}/deshacer`, {})).estado, 400, "solo se deshace una vez");
});

test("datos invalidos se rechazan", async () => {
    assert.equal((await api(negocio, "/inventario/minimos-aplicar", { items: [] })).estado, 400);
    assert.equal((await api(negocio, "/inventario/minimos-aplicar", { items: [{ id: 1, minimo: 5, maximo: 3 }] })).estado, 400);
    assert.equal((await api(negocio, "/inventario/minimos-sugeridos?cobertura=5")).estado, 400);
});

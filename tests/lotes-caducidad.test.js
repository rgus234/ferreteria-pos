// Lotes de caducidad y merma (abarrotes).
//
// Lo que se protege:
//  - el calculo de lo vigente (primero vence, primero sale) sin tocar las ventas;
//  - una entrada suma stock, abre un lote y deja su ajuste; la merma baja stock y
//    anota cuanto dinero se perdio, sin dejar el inventario en negativo;
//  - "por revisar" ordena por urgencia y solo trae lo que vence pronto;
//  - un negocio nunca ve ni toca los lotes de otro.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { calcularLotesVigentes, estadoDeCaducidad, caducidadDeEntrada, sumarDiasFecha } = require("../lotes-calculo");

test("el stock actual pertenece a los lotes que vencen mas tarde", () => {
    const lotes = [
        { id: 1, cantidad: 10, fecha_entrada: "2026-10-18", fecha_caducidad: "2026-10-20" },
        { id: 2, cantidad: 10, fecha_entrada: "2026-10-20", fecha_caducidad: "2026-10-23" },
        { id: 3, cantidad: 10, fecha_entrada: "2026-10-21", fecha_caducidad: "2026-10-26" }
    ];

    // Entraron 30, quedan 14: se vendio primero lo que vencia primero.
    const vigentes = calcularLotesVigentes({ stock: 14, lotes });
    assert.deepEqual(vigentes.map(l => [l.id, l.cantidad]), [[2, 4], [3, 10]]);

    assert.deepEqual(calcularLotesVigentes({ stock: 0, lotes }), []);
    assert.equal(calcularLotesVigentes({ stock: 30, lotes }).length, 3);
});

test("lo que no explican los lotes cuenta como sin lote, con la caducidad que ya tenia el producto", () => {
    const lotes = [{ id: 1, cantidad: 5, fecha_entrada: "2026-10-21", fecha_caducidad: "2026-10-25" }];
    const vigentes = calcularLotesVigentes({ stock: 12, lotes, fechaProducto: "2026-10-23" });

    assert.equal(vigentes.length, 2);
    assert.deepEqual(vigentes.map(l => [l.origen, l.cantidad, l.fechaCaducidad]), [
        ["sin_lote", 7, "2026-10-23"],
        ["entrada", 5, "2026-10-25"]
    ]);

    // Sin lotes ni fecha: una sola pieza sin fecha, al final.
    const sinNada = calcularLotesVigentes({ stock: 3, lotes: [] });
    assert.deepEqual(sinNada.map(l => [l.origen, l.cantidad, l.fechaCaducidad]), [["sin_lote", 3, null]]);
});

test("el estado de caducidad distingue vencido, hoy, manana, pronto y semana", () => {
    const hoy = "2026-10-22";
    const estado = fecha => estadoDeCaducidad(fecha, hoy).estado;

    assert.equal(estado("2026-10-20"), "vencido");
    assert.equal(estado("2026-10-22"), "hoy");
    assert.equal(estado("2026-10-23"), "manana");
    assert.equal(estado("2026-10-25"), "pronto");
    assert.equal(estado("2026-10-29"), "semana");
    assert.equal(estado("2026-11-30"), "ok");
    assert.equal(estado(null), "sin_fecha");
});

test("la caducidad de una entrada sale de la fecha dada o de hoy mas la vida util", () => {
    assert.equal(caducidadDeEntrada({ fechaCaducidad: "2026-11-01", vidaUtilDias: 3, hoy: "2026-10-22" }), "2026-11-01");
    assert.equal(caducidadDeEntrada({ vidaUtilDias: 3, hoy: "2026-10-22" }), "2026-10-25");
    assert.equal(caducidadDeEntrada({ vidaUtilDias: 10, hoy: "2026-10-28" }), "2026-11-07");
    assert.equal(caducidadDeEntrada({ hoy: "2026-10-22" }), null);
    assert.equal(caducidadDeEntrada({ vidaUtilDias: 0, hoy: "2026-10-22" }), null);
    assert.equal(sumarDiasFecha("2026-12-30", 3), "2027-01-02");
});

// ---------------------------------------------------------------------
// Con base de datos (requiere correr la migracion 20261026_lotes_caducidad.sql)
// ---------------------------------------------------------------------

const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { fechaLocal, avisarCaducidades } = require("../lotes-server");

let negocio;
let otro;
let productoId;

const headers = (n = negocio) => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const post = (ruta, cuerpo, n = negocio) => fetch(`${BASE_URL}${ruta}`, { method: "POST", headers: headers(n), body: JSON.stringify(cuerpo) });
const get = (ruta, n = negocio) => fetch(`${BASE_URL}${ruta}`, { headers: headers(n) });
const stockActual = async () => Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoId])).rows[0].stock);

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("lotes-a");
    otro = await crearNegocioPrueba("lotes-b");

    const producto = await pool.query(
        `INSERT INTO public.productos (negocio_id, nombre, precio, precio_publico, precio_distribuidor, stock, vida_util_dias, unidad_venta)
         VALUES ($1, 'Tortillas de maiz', 24, 24, 15, 0, 2, 'kg') RETURNING id`,
        [negocio.negocioId]
    );
    productoId = producto.rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otro) await borrarNegocioPrueba(otro.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("una entrada suma stock, abre un lote con la vida util del producto y deja su ajuste", async () => {
    const r = await post(`/productos/${productoId}/entrada`, { cantidad: 10 });
    assert.equal(r.status, 200);

    const cuerpo = await r.json();
    assert.equal(cuerpo.stock, 10);
    assert.equal(cuerpo.fechaCaducidad, sumarDiasFecha(fechaLocal(), 2), "hoy mas 2 dias de vida util");
    assert.equal(await stockActual(), 10);

    const lotes = await pool.query(`SELECT cantidad FROM public.producto_lotes WHERE producto_id = $1`, [productoId]);
    assert.equal(lotes.rows.length, 1);

    const ajustes = await pool.query(`SELECT tipo, stock_anterior, stock_nuevo FROM public.ajustes_inventario WHERE producto_id = $1`, [productoId]);
    assert.deepEqual(ajustes.rows.map(a => [a.tipo, Number(a.stock_anterior), Number(a.stock_nuevo)]), [["entrada", 0, 10]]);

    // Una fecha explicita manda sobre la vida util; una fecha mala se rechaza.
    const explicita = await (await post(`/productos/${productoId}/entrada`, { cantidad: 5, fechaCaducidad: "2030-01-15" })).json();
    assert.equal(explicita.fechaCaducidad, "2030-01-15");
    assert.equal((await post(`/productos/${productoId}/entrada`, { cantidad: 5, fechaCaducidad: "manana" })).status, 400);
    assert.equal((await post(`/productos/${productoId}/entrada`, { cantidad: 0 })).status, 400);
    assert.equal((await post(`/productos/${productoId}/entrada`, { cantidad: -3 })).status, 400);
});

test("por revisar trae lo que vence pronto, ordenado por urgencia, con lo que cuesta tirarlo", async () => {
    await pool.query(`DELETE FROM public.producto_lotes WHERE producto_id = $1`, [productoId]);
    await pool.query(`UPDATE public.productos SET stock = 20 WHERE id = $1`, [productoId]);

    const hoy = fechaLocal();
    await pool.query(
        `INSERT INTO public.producto_lotes (negocio_id, producto_id, cantidad, fecha_entrada, fecha_caducidad) VALUES
            ($1, $2, 8, $3, $4), ($1, $2, 8, $3, $5), ($1, $2, 8, $3, $6)`,
        [negocio.negocioId, productoId, hoy, sumarDiasFecha(hoy, -1), sumarDiasFecha(hoy, 2), sumarDiasFecha(hoy, 40)]
    );

    // Stock 20 de 24 entrados: se vendieron 4 del lote que vencia primero.
    const cuerpo = await (await get("/lotes/por-revisar?dias=7")).json();

    assert.deepEqual(cuerpo.lotes.map(l => [l.estado, l.cantidad]), [["vencido", 4], ["pronto", 8]]);
    assert.equal(cuerpo.resumen.vencidos, 1);
    assert.equal(cuerpo.resumen.valorCosto, 12 * 15, "12 piezas a $15 de costo");
    assert.equal(cuerpo.resumen.valorVenta, 12 * 24);
});

test("la merma baja el stock, anota la perdida y no deja el inventario en negativo", async () => {
    const antes = await stockActual();

    assert.equal((await post(`/productos/${productoId}/merma`, { cantidad: antes + 1 })).status, 400, "no se puede tirar mas de lo que hay");
    assert.equal(await stockActual(), antes);

    const r = await post(`/productos/${productoId}/merma`, { cantidad: 4, motivo: "caducado" });
    assert.equal(r.status, 200);

    const cuerpo = await r.json();
    assert.equal(cuerpo.stock, antes - 4);
    assert.equal(cuerpo.perdidoCosto, 60);
    assert.equal(cuerpo.perdidoVenta, 96);

    const resumen = await (await get("/lotes/mermas?dias=30")).json();
    assert.equal(resumen.mermas.length, 1);
    assert.equal(resumen.totalCosto, 60);

    // Ya no queda nada vencido: las 4 piezas vencidas eran justo las tiradas.
    const revisar = await (await get("/lotes/por-revisar?dias=7")).json();
    assert.equal(revisar.resumen.vencidos, 0);

    // Un motivo inventado cae en "caducado".
    const raro = await (await post(`/productos/${productoId}/merma`, { cantidad: 1, motivo: "robo" })).json();
    assert.equal(raro.ok, true);
});

test("un negocio no ve ni toca los productos de otro", async () => {
    assert.equal((await post(`/productos/${productoId}/entrada`, { cantidad: 1 }, otro)).status, 404);
    assert.equal((await post(`/productos/${productoId}/merma`, { cantidad: 1 }, otro)).status, 404);

    const ajeno = await (await get("/lotes/por-revisar?dias=60", otro)).json();
    assert.deepEqual(ajeno.lotes, []);
});

test("el aviso diario llega una sola vez al dia y solo despues de las 8 am", async () => {
    await pool.query(`UPDATE public.negocios SET giro = 'abarrotes' WHERE id = $1`, [negocio.negocioId]);
    await pool.query(`DELETE FROM public.avisos_caducidad WHERE negocio_id = $1`, [negocio.negocioId]);
    await pool.query(`UPDATE public.productos SET stock = 6 WHERE id = $1`, [productoId]);
    await pool.query(`DELETE FROM public.producto_lotes WHERE producto_id = $1`, [productoId]);
    await pool.query(
        `INSERT INTO public.producto_lotes (negocio_id, producto_id, cantidad, fecha_caducidad) VALUES ($1, $2, 6, $3)`,
        [negocio.negocioId, productoId, fechaLocal()]
    );

    const madrugada = new Date(`${fechaLocal()}T06:00:00-06:00`);
    const mediodia = new Date(`${fechaLocal()}T12:00:00-06:00`);

    await avisarCaducidades(pool, madrugada);
    let avisos = await pool.query(`SELECT 1 FROM public.avisos_caducidad WHERE negocio_id = $1`, [negocio.negocioId]);
    assert.equal(avisos.rows.length, 0, "antes de las 8 no avisa");

    await avisarCaducidades(pool, mediodia);
    await avisarCaducidades(pool, mediodia);
    avisos = await pool.query(`SELECT cuantos FROM public.avisos_caducidad WHERE negocio_id = $1`, [negocio.negocioId]);
    assert.equal(avisos.rows.length, 1, "un solo aviso por dia");
    assert.equal(avisos.rows[0].cuantos, 1);
});

test("el cliente muestra Por revisar con lotes en abarrotes y deja Por vencer igual en los demas", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const ui = leer("js/lotes-ui.js");
    const indice = leer("index.html");

    assert.match(ui, /\/lotes\/por-revisar/);
    assert.match(ui, /\/productos\/\$\{productoId\}\/merma/);
    assert.match(ui, /\/productos\/\$\{productoId\}\/entrada/);
    assert.match(ui, /return mostrarPorVencerOriginal\(\)/, "fuera de abarrotes sigue la pantalla de siempre");
    assert.ok(indice.indexOf("js/expiring-products.js") < indice.indexOf("js/lotes-ui.js"), "lotes-ui envuelve la funcion ya definida");
    assert.match(indice, /id="nuevaVidaUtilDias"/);
    assert.match(leer("js/perfil-negocio.js"), /"Por revisar"/);
    assert.match(leer("js/product-inventory.js"), /vidaUtilDias: document\.getElementById\("nuevaVidaUtilDias"\)/);
});

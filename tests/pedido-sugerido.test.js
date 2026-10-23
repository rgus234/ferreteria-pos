// Pedido sugerido por proveedor (abarrotes).
//
// Lo que se protege:
//  - el calculo: alcanza hasta la proxima visita y el periodo siguiente, restando
//    lo que ya hay; un producto sin ventas solo se pide si esta bajo su minimo;
//  - el dia de visita se valida y un negocio no toca proveedores de otro;
//  - el pedido sale de ventas reales (las canceladas no cuentan) y trae el dinero;
//  - el aviso sale una sola vez por visita, de 1 a 3 dias antes y despues de las 8 am.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { proximaVisita, sugerirProducto, sumarDias } = require("../pedido-sugerido-calculo");

test("la proxima visita cuenta hoy como visita y valida el dia", () => {
    // 2026-10-22 es jueves (4).
    assert.deepEqual(proximaVisita("2026-10-22", 4), { fecha: "2026-10-22", dias: 0 });
    assert.deepEqual(proximaVisita("2026-10-22", 2), { fecha: "2026-10-27", dias: 5 });
    assert.deepEqual(proximaVisita("2026-10-22", 5), { fecha: "2026-10-23", dias: 1 });
    assert.equal(proximaVisita("2026-10-22", null), null);
    assert.equal(proximaVisita("2026-10-22", 7), null);
    assert.equal(sumarDias("2026-12-30", 3), "2027-01-02");
});

test("lo que se pide alcanza hasta la visita y el periodo siguiente, restando lo que hay", () => {
    // Vende 1 al dia, viene en 4 dias y luego cada 7: hay que cubrir 11 dias.
    const base = { vendido: 28, diasVentana: 28, diasHastaVisita: 4, frecuenciaDias: 7 };

    assert.equal(sugerirProducto({ ...base, stock: 3 }).cantidad, 8);
    assert.equal(sugerirProducto({ ...base, stock: 3 }).motivo, "ventas");
    assert.equal(sugerirProducto({ ...base, stock: 3 }).diasAlcanza, 3);
    assert.equal(sugerirProducto({ ...base, stock: 20 }), null, "con 20 le sobra");
    assert.equal(sugerirProducto({ ...base, stock: 11 }), null, "justo lo que necesita");
    assert.equal(sugerirProducto({ ...base, stock: 10 }).cantidad, 1);
});

test("un producto sin ventas solo se pide si esta bajo su minimo", () => {
    assert.equal(sugerirProducto({ stock: 8, stockMinimo: 5, vendido: 0 }), null);

    const bajo = sugerirProducto({ stock: 2, stockMinimo: 5, vendido: 0 });
    assert.equal(bajo.cantidad, 3);
    assert.equal(bajo.motivo, "minimo");
    assert.equal(bajo.diasAlcanza, null);
});

// ---------------------------------------------------------------------
// Con base de datos (requiere correr la migracion 20261028_proveedores_visita.sql)
// ---------------------------------------------------------------------

const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { avisarVisitas } = require("../pedido-sugerido-server");
const { fechaLocal } = require("../lotes-server");

let negocio;
let otro;
let proveedorId;
let cocaId;
let sabritasId;

const headers = (n = negocio) => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const get = (ruta, n = negocio) => fetch(`${BASE_URL}${ruta}`, { headers: headers(n) });
const patch = (ruta, cuerpo, n = negocio) => fetch(`${BASE_URL}${ruta}`, { method: "PATCH", headers: headers(n), body: JSON.stringify(cuerpo) });

async function venta(productos, estado = "completada") {
    await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, total, fecha, productos, estado) VALUES ($1, 100, NOW() - INTERVAL '2 days', $2::jsonb, $3)`,
        [negocio.negocioId, JSON.stringify(productos), estado]
    );
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("pedido-sug-a");
    otro = await crearNegocioPrueba("pedido-sug-b");

    proveedorId = (await pool.query(
        `INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1, 'Coca-Cola Test') RETURNING id`,
        [negocio.negocioId]
    )).rows[0].id;

    const producto = async (nombre, stock, costo, minimo) => (await pool.query(
        `INSERT INTO public.productos (negocio_id, nombre, precio, precio_publico, precio_distribuidor, stock, stock_minimo, proveedor_id)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7) RETURNING id`,
        [negocio.negocioId, nombre, costo * 1.3, costo, stock, minimo, proveedorId]
    )).rows[0].id;

    cocaId = await producto("Coca 600 prueba", 4, 15, 0);
    sabritasId = await producto("Sin ventas prueba", 1, 10, 3);

    // 28 vendidas hace 2 dias; una venta cancelada de 500 no debe contar.
    await venta([{ id: cocaId, cantidad: 28, importe: 700 }]);
    await venta([{ id: cocaId, cantidad: 500, importe: 9999 }], "cancelada");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otro) await borrarNegocioPrueba(otro.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("el dia de visita se valida y un negocio no toca proveedores de otro", async () => {
    const ruta = `/pedido-sugerido/${proveedorId}/visita`;

    assert.equal((await patch(ruta, { diaVisita: 9 })).status, 400);
    assert.equal((await patch(ruta, { frecuenciaDias: 0 })).status, 400);
    assert.equal((await patch(ruta, { frecuenciaDias: 90 })).status, 400);
    assert.equal((await patch(ruta, { diaVisita: 2 }, otro)).status, 404, "otro negocio no puede");
    assert.equal((await get(`/pedido-sugerido/${proveedorId}`, otro)).status, 404);

    const ok = await (await patch(ruta, { diaVisita: 2, frecuenciaDias: 7 })).json();
    assert.deepEqual([ok.diaVisita, ok.frecuenciaDias], [2, 7]);

    const guardado = (await pool.query(`SELECT dia_visita, frecuencia_dias FROM public.proveedores WHERE id = $1`, [proveedorId])).rows[0];
    assert.deepEqual([guardado.dia_visita, guardado.frecuencia_dias], [2, 7]);

    // Quitar el dia es valido.
    assert.equal((await (await patch(ruta, { diaVisita: null })).json()).diaVisita, null);
    await patch(ruta, { diaVisita: 2 });
});

test("el pedido sale de ventas reales, sin contar las canceladas, y trae el dinero", async () => {
    const cuerpo = await (await get(`/pedido-sugerido/${proveedorId}`)).json();
    const coca = cuerpo.items.find(i => i.productoId === cocaId);
    const minimo = cuerpo.items.find(i => i.productoId === sabritasId);

    assert.ok(coca, "la Coca se vendio y le queda poco");
    assert.ok(coca.porDia > 0 && coca.porDia < 5, `vende ${coca.porDia} al dia: la venta cancelada de 500 no cuenta`);
    assert.equal(coca.costo, 15);
    assert.equal(coca.subtotal, Number((coca.cantidad * 15).toFixed(2)));

    assert.equal(minimo.motivo, "minimo", "sin ventas pero bajo su minimo");
    assert.equal(minimo.cantidad, 2);

    assert.equal(cuerpo.total, Number(cuerpo.items.reduce((s, i) => s + i.subtotal, 0).toFixed(2)));
    assert.equal(cuerpo.productosDelProveedor, 2);

    const lista = await (await get("/pedido-sugerido")).json();
    const tarjeta = lista.proveedores.find(p => p.proveedorId === proveedorId);
    assert.equal(tarjeta.productosSugeridos, 2);
    assert.equal(tarjeta.total, cuerpo.total);
    assert.equal(lista.proveedores.length, 1, "no aparecen proveedores de otro negocio");
});

test("el aviso sale una sola vez por visita, de 1 a 3 dias antes y despues de las 8 am", async () => {
    await pool.query(`DELETE FROM public.avisos_pedido_sugerido WHERE proveedor_id = $1`, [proveedorId]);

    const hoy = fechaLocal();
    const dia = (new Date(`${hoy}T00:00:00Z`).getUTCDay() + 2) % 7;
    await pool.query(`UPDATE public.proveedores SET dia_visita = $1 WHERE id = $2`, [dia, proveedorId]);

    const madrugada = new Date(`${hoy}T06:00:00-06:00`);
    const mediodia = new Date(`${hoy}T12:00:00-06:00`);
    const contar = async () => Number((await pool.query(`SELECT count(*) FROM public.avisos_pedido_sugerido WHERE proveedor_id = $1`, [proveedorId])).rows[0].count);

    await avisarVisitas(pool, madrugada);
    assert.equal(await contar(), 0, "antes de las 8 no avisa");

    await avisarVisitas(pool, mediodia);
    await avisarVisitas(pool, mediodia);
    assert.equal(await contar(), 1, "un solo aviso por visita");

    // Si la visita esta lejos (5 dias), todavia no avisa.
    await pool.query(`DELETE FROM public.avisos_pedido_sugerido WHERE proveedor_id = $1`, [proveedorId]);
    await pool.query(`UPDATE public.proveedores SET dia_visita = $1 WHERE id = $2`, [(new Date(`${hoy}T00:00:00Z`).getUTCDay() + 5) % 7, proveedorId]);
    await avisarVisitas(pool, mediodia);
    assert.equal(await contar(), 0);
});

test("el cliente muestra Pedido sugerido solo a abarrotes y guarda el pedido como borrador", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const js = leer("js/pedido-sugerido.js");
    const indice = leer("index.html");
    const css = leer("css/components/pedido-sugerido.css");

    assert.match(js, /\/pedido-sugerido/);
    assert.match(js, /estado: "borrador"/);
    assert.match(js, /\/pedidos-proveedor/);
    assert.match(indice, /class="solo-perfil-simple" data-shell-module="pedido-sugerido"/);
    assert.match(indice, /id="pantallaPedidoSugerido"/);
    assert.match(css, /body\.perfil-con-abarrotes \.sidebar \.solo-perfil-simple/, "lo ven abarrotes y quien tiene ferreteria + abarrotes");
    assert.match(leer("js/config-auth.js"), /"pantallaPedidoSugerido"/);
    assert.match(leer("js/shell-topbar.js"), /"pedido-sugerido"/);
});

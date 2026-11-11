// Aviso diario de pagos a proveedores por vencer: una vez al dia, despues de las 9 am (Mexico), solo con la Agenda encendida y solo si hay algo.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { pagosPorVencer, avisarPagosPorVencer, textoAviso } = require("../agenda-pagos-avisos");
const { guardarPagoRecepcion } = require("../pago-recepcion");

let conAgenda;
let sinAgenda;
const HOY = "2026-11-12";
const MANANA_7 = new Date("2026-11-12T13:00:00Z");   // 7:00 en Mexico
const MANANA_10 = new Date("2026-11-12T16:00:00Z");  // 10:00 en Mexico

async function cuenta(negocioId, proveedor, saldo, vencimiento, estado = "pendiente") {
    await pool.query(
        `INSERT INTO public.cuentas_pagar (negocio_id, proveedor, monto_total, saldo, vencimiento, estado) VALUES ($1,$2,$3,$3,$4,$5)`,
        [negocioId, proveedor, saldo, vencimiento, estado]
    );
}

before(async () => {
    conAgenda = await crearNegocioPrueba("avisos-pagos-si");
    sinAgenda = await crearNegocioPrueba("avisos-pagos-no");
    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"agenda_pagos": true}'::jsonb WHERE id = $1`, [conAgenda.negocioId]);

    // Crea la tabla de cuentas por pagar si aun no existe.
    const recepcion = (await pool.query(`INSERT INTO public.recepciones_mercancia (negocio_id, proveedor) VALUES ($1, 'Arranque') RETURNING id`, [conAgenda.negocioId])).rows[0].id;
    const client = await pool.connect();
    try { await client.query("BEGIN"); await guardarPagoRecepcion(client, { negocioId: conAgenda.negocioId, recepcionId: recepcion, pago: { monto: 1, metodo: "a_deber", vencimiento: "2027-12-31" } }); await client.query("COMMIT"); } finally { client.release(); }
    await pool.query(`DELETE FROM public.cuentas_pagar WHERE negocio_id = $1`, [conAgenda.negocioId]);
});

after(async () => {
    for (const n of [conAgenda, sinAgenda]) {
        if (!n) continue;
        await pool.query(`DELETE FROM public.cuentas_pagar WHERE negocio_id = $1`, [n.negocioId]);
        await pool.query(`DELETE FROM public.avisos_agenda_pagos WHERE negocio_id = $1`, [n.negocioId]).catch(() => {});
        await borrarNegocioPrueba(n.negocioId);
    }
    await pool.end();
});

test("cuenta lo vencido, lo que vence hoy y lo de los proximos 2 dias; lo lejano, lo pagado y lo sin fecha no", async () => {
    await cuenta(conAgenda.negocioId, "Sabritas", 2777.04, "2026-11-10");          // vencida
    await cuenta(conAgenda.negocioId, "Bimbo", 500, "2026-11-12");                  // hoy
    await cuenta(conAgenda.negocioId, "Lala", 300, "2026-11-14");                   // en 2 dias
    await cuenta(conAgenda.negocioId, "Coca-Cola", 900, "2026-11-20");              // lejos
    await cuenta(conAgenda.negocioId, "Marinela", 100, "2026-11-11", "pagada");     // ya pagada
    await pool.query(`INSERT INTO public.cuentas_pagar (negocio_id, proveedor, monto_total, saldo, estado) VALUES ($1,'Sin fecha',50,50,'pendiente')`, [conAgenda.negocioId]);

    const lista = await pagosPorVencer(pool, conAgenda.negocioId, HOY);

    assert.deepEqual(lista.map(x => [x.proveedor, x.dias]), [["Sabritas", -2], ["Bimbo", 0], ["Lala", 2]]);
});

test("el texto habla de vencidos, de hoy y de los proximos dias, con el total y los primeros proveedores", () => {
    const t = textoAviso([{ proveedor: "Sabritas", saldo: 2777.04, dias: -2 }, { proveedor: "Bimbo", saldo: 500, dias: 0 }, { proveedor: "Lala", saldo: 300, dias: 2 }]);

    assert.equal(t.titulo, "Tienes pagos vencidos a proveedores");
    assert.match(t.cuerpo, /1 vencido, 1 vence hoy, 1 vence en los próximos 2 días\./);
    assert.match(t.cuerpo, /Total \$3,577\.04/);
    assert.match(t.cuerpo, /Sabritas \$2,777\.04 \(vencido\), Bimbo \$500\.00 \(vence hoy\) y más\./);

    const solo = textoAviso([{ proveedor: "Lala", saldo: 300, dias: 1 }]);
    assert.equal(solo.titulo, "Pagos a proveedores por vencer");
    assert.match(solo.cuerpo, /Lala \$300\.00 \(vence mañana\)\./);
});

test("se avisa una sola vez al dia, despues de las 9 am, solo con la Agenda encendida y solo al negocio indicado", async () => {
    const enviados = [];
    const enviar = async (_pool, negocioId, aviso) => { enviados.push({ negocioId, aviso }); };
    // Un negocio sin la Agenda encendida, aunque tenga cuentas por vencer, nunca recibe el aviso.
    await cuenta(sinAgenda.negocioId, "Urrea", 800, "2026-11-12");

    assert.equal(await avisarPagosPorVencer(pool, { ahora: MANANA_7, enviar, soloNegocios: [conAgenda.negocioId, sinAgenda.negocioId] }), 0, "antes de las 9 no se avisa");

    assert.equal(await avisarPagosPorVencer(pool, { ahora: MANANA_10, enviar, soloNegocios: [conAgenda.negocioId, sinAgenda.negocioId] }), 1);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].negocioId, conAgenda.negocioId);
    assert.equal(enviados[0].aviso.pantalla, "agenda-pagos");

    assert.equal(await avisarPagosPorVencer(pool, { ahora: MANANA_10, enviar, soloNegocios: [conAgenda.negocioId] }), 0, "el mismo dia no se repite");
    assert.equal(enviados.length, 1);

    // Al dia siguiente, si la deuda sigue, se vuelve a avisar.
    const dia2 = new Date("2026-11-13T16:00:00Z");
    assert.equal(await avisarPagosPorVencer(pool, { ahora: dia2, enviar, soloNegocios: [conAgenda.negocioId] }), 1);
});

test("sin nada por vencer no se avisa", async () => {
    await pool.query(`DELETE FROM public.cuentas_pagar WHERE negocio_id = $1`, [conAgenda.negocioId]);
    await cuenta(conAgenda.negocioId, "Lejos", 100, "2026-12-30");

    const enviados = [];
    const dia3 = new Date("2026-11-14T16:00:00Z");

    assert.equal(await avisarPagosPorVencer(pool, { ahora: dia3, enviar: async () => enviados.push(1), soloNegocios: [conAgenda.negocioId] }), 0);
    assert.equal(enviados.length, 0);
});

// Agenda de pagos: lo recibido "a deber" queda como cuenta por pagar con su fecha limite (solo con la funcion encendida).
// Requiere la migracion 20261127_agenda_pagos.sql.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { guardarPagoRecepcion, limpiarPago, agendaActiva } = require("../pago-recepcion");

let conAgenda;
let sinAgenda;

async function recepcion(negocioId, proveedor) {
    return (await pool.query(`INSERT INTO public.recepciones_mercancia (negocio_id, proveedor) VALUES ($1, $2) RETURNING id`, [negocioId, proveedor])).rows[0].id;
}

async function pagar(negocioId, recepcionId, pago) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const ok = await guardarPagoRecepcion(client, { negocioId, recepcionId, pago });
        await client.query("COMMIT");
        return ok;
    } finally {
        client.release();
    }
}

const cuentas = async negocioId => (await pool.query(`SELECT * FROM public.cuentas_pagar WHERE negocio_id = $1 ORDER BY id`, [negocioId])).rows;

before(async () => {
    conAgenda = await crearNegocioPrueba("agenda-pagos-si");
    sinAgenda = await crearNegocioPrueba("agenda-pagos-no");
    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"agenda_pagos": true}'::jsonb WHERE id = $1`, [conAgenda.negocioId]);
});

after(async () => {
    if (conAgenda) { await pool.query(`DELETE FROM public.cuentas_pagar WHERE negocio_id = $1`, [conAgenda.negocioId]); await borrarNegocioPrueba(conAgenda.negocioId); }
    if (sinAgenda) { await pool.query(`DELETE FROM public.cuentas_pagar WHERE negocio_id = $1`, [sinAgenda.negocioId]); await borrarNegocioPrueba(sinAgenda.negocioId); }
    await pool.end();
});

test("la fecha limite se limpia y una fecha invalida se ignora", () => {
    assert.equal(limpiarPago({ monto: 500, metodo: "a_deber", vencimiento: "2026-12-15" }).vencimiento, "2026-12-15");
    assert.equal(limpiarPago({ monto: 500, metodo: "a_deber", vencimiento: "15/12/2026" }).vencimiento, null);
    assert.equal(limpiarPago({ monto: 500, metodo: "a_deber" }).vencimiento, null);
});

test("recibir a deber con la funcion encendida crea UNA cuenta por pagar con proveedor, monto y fecha limite", async () => {
    const id = await recepcion(conAgenda.negocioId, "Truper");
    assert.equal(await agendaActiva(pool, conAgenda.negocioId), true);

    assert.equal(await pagar(conAgenda.negocioId, id, { monto: 29007.5, metodo: "a_deber", por: "Don Beto", vencimiento: "2026-12-22" }), true);
    // Guardarlo otra vez (reintento) no duplica la cuenta.
    await pagar(conAgenda.negocioId, id, { monto: 29007.5, metodo: "a_deber", vencimiento: "2026-12-22" });

    const lista = await cuentas(conAgenda.negocioId);
    assert.equal(lista.length, 1);
    assert.deepEqual([lista[0].proveedor, lista[0].origen_tipo, Number(lista[0].origen_id), Number(lista[0].monto_total), Number(lista[0].saldo), lista[0].estado], ["Truper", "recepcion", id, 29007.5, 29007.5, "pendiente"]);
    assert.equal(lista[0].vencimiento.toISOString().slice(0, 10), "2026-12-22");
});

test("pagar de contado, o a deber sin monto, no crea cuenta por pagar", async () => {
    const antes = (await cuentas(conAgenda.negocioId)).length;

    await pagar(conAgenda.negocioId, await recepcion(conAgenda.negocioId, "Urrea"), { monto: 800, metodo: "efectivo_caja" });
    await pagar(conAgenda.negocioId, await recepcion(conAgenda.negocioId, "Urrea"), { monto: 0, metodo: "a_deber" });

    assert.equal((await cuentas(conAgenda.negocioId)).length, antes);
});

test("un negocio sin la funcion encendida no recibe cuentas por pagar (ferreteria y demas siguen igual)", async () => {
    assert.equal(await agendaActiva(pool, sinAgenda.negocioId), false);
    assert.equal(await pagar(sinAgenda.negocioId, await recepcion(sinAgenda.negocioId, "Truper"), { monto: 500, metodo: "a_deber", vencimiento: "2026-12-22" }), true, "el pago se anota igual");
    assert.equal((await cuentas(sinAgenda.negocioId)).length, 0);
});

test("el proveedor guarda sus dias de credito", async () => {
    const col = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proveedores' AND column_name = 'dias_credito'`);
    assert.equal(col.rows.length, 1);
});

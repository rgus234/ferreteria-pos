// Bug real encontrado en la auditoria de lanzamiento (2026-08-26): no
// existia ningun aviso antes de que terminara la prueba gratuita de
// 15 dias -- un negocio nuevo podia pasar de "prueba" a periodo de
// gracia/limitado sin ninguna advertencia. revisarYEnviarRecordatorios
// esta exportado directo para poder probarse sin servidor HTTP, mismo
// patron que ya usa credito-recordatorios-server.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { revisarYEnviarRecordatorios } = require("../prueba-recordatorios-server");

let negocioPorTerminar;
let negocioLejano;

before(async () => {
    negocioPorTerminar = await crearNegocioPrueba("prueba-recordatorios-por-terminar");
    negocioLejano = await crearNegocioPrueba("prueba-recordatorios-lejano");

    await pool.query(
        `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento)
         VALUES ($1, 'activa', 'prueba', NOW() + INTERVAL '2 days')`,
        [negocioPorTerminar.negocioId]
    );

    await pool.query(
        `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento)
         VALUES ($1, 'activa', 'prueba', NOW() + INTERVAL '10 days')`,
        [negocioLejano.negocioId]
    );
});

after(async () => {
    if (negocioPorTerminar) await borrarNegocioPrueba(negocioPorTerminar.negocioId);
    if (negocioLejano) await borrarNegocioPrueba(negocioLejano.negocioId);
    await pool.end();
});

async function tieneRecordatorio(negocioId) {
    const resultado = await pool.query(
        `SELECT 1 FROM public.recordatorios_prueba_por_terminar WHERE negocio_id = $1`,
        [negocioId]
    );
    return resultado.rows.length > 0;
}

test("un negocio en prueba a 2 dias de vencer recibe el recordatorio", async () => {
    await revisarYEnviarRecordatorios(pool);
    assert.equal(await tieneRecordatorio(negocioPorTerminar.negocioId), true);
});

test("un negocio en prueba a 10 dias de vencer NO recibe nada todavia", async () => {
    assert.equal(await tieneRecordatorio(negocioLejano.negocioId), false);
});

test("correr la revision otra vez no duplica el recordatorio (enfriamiento)", async () => {
    const antes = await pool.query(
        `SELECT COUNT(*) FROM public.recordatorios_prueba_por_terminar WHERE negocio_id = $1`,
        [negocioPorTerminar.negocioId]
    );

    await revisarYEnviarRecordatorios(pool);

    const despues = await pool.query(
        `SELECT COUNT(*) FROM public.recordatorios_prueba_por_terminar WHERE negocio_id = $1`,
        [negocioPorTerminar.negocioId]
    );

    assert.equal(despues.rows[0].count, antes.rows[0].count);
});

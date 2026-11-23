// Reportes: el "dia" es el dia de Mexico, no el de UTC (antes terminaba a las 6 pm y las horas salian corridas 6 horas).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });

// Inserta una venta cuya hora LOCAL de Mexico es "dia local + desplazamiento" (la columna guarda UTC sin zona).
async function ventaLocal(folioNumero, total, offsetSql) {
    await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, folio, folio_numero, total, subtotal, descuento, productos, metodo_pago, estado, fecha)
         VALUES ($1, $2, $3, $4, $4, 0, '[]'::jsonb, 'efectivo', 'completada',
                 ((date_trunc('day', NOW() AT TIME ZONE 'America/Mexico_City') + ${offsetSql}) AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'UTC')`,
        [negocio.negocioId, `ZZ-${folioNumero}`, folioNumero, total]
    );
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("reportes-zona");
    await ventaLocal(1, 100, "INTERVAL '30 minutes'");                  // hoy 00:30 hora de Mexico
    await ventaLocal(2, 40, "INTERVAL '1 hour'");                       // hoy 01:00
    await ventaLocal(3, 7, "- INTERVAL '2 hours'");                     // AYER 22:00 hora de Mexico (05:00 UTC de hoy)
});

after(async () => {
    if (negocio) {
        await pool.query("DELETE FROM public.historial_ventas WHERE negocio_id = $1", [negocio.negocioId]);
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("el reporte del dia cuenta lo de hoy en hora de Mexico y deja fuera la noche de ayer", async () => {
    const r = await (await fetch(`${BASE_URL}/reportes/ventas?periodo=dia`, { headers: headers() })).json();
    assert.equal(Number(r.resumen?.total ?? r.total), 140, "100 + 40 de hoy; los 7 de ayer a las 10 pm no entran: " + JSON.stringify(r.resumen || r).slice(0, 200));
});

test("las horas del reporte salen en hora de Mexico", async () => {
    const r = await (await fetch(`${BASE_URL}/reportes/ventas?periodo=dia`, { headers: headers() })).json();
    const horas = (r.porHora || r.ventasPorHora || r.horas || []).map(x => x.hora);
    assert.ok(horas.includes("00:00"), "las ventas de 00:30 y 01:00 caen en 00:00 y 01:00 de Mexico: " + JSON.stringify(horas));
    assert.ok(horas.includes("01:00"));
    assert.ok(!horas.includes("06:00"), "no salen corridas 6 horas (hora UTC)");
});

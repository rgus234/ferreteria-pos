// "Quien hizo que": ventas por cajero, acciones de la bitacora, turnos y tiempo extra; y cada empleado solo ve lo suyo.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");
const { hoyLocal, rango } = require("../actividad-equipo-server");

let negocio, diego, ketus;
const llamar = (ruta, empleado) => fetch(`${BASE_URL}${ruta}`, { headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...(empleado ? { "x-empleado-id": String(empleado) } : {}) } });

async function venta(cajero, total, estado = "completada") {
    await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, total, fecha, productos, estado, metodo_pago, pago_efectivo, cajero_nombre) VALUES ($1, $2, NOW(), '[]'::jsonb, $3, 'efectivo', $2, $4)`,
        [negocio.negocioId, total, estado, cajero]
    );
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("actividad-equipo");
    const alta = async (nombre, rol) => (await pool.query(`INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, activo) VALUES ($1, $2, $3, $4, true) RETURNING id`, [negocio.negocioId, nombre, rol, hashPassword("1234")])).rows[0].id;
    diego = await alta("Diego", "Cajero");
    ketus = await alta("Ketus", "Administrador");

    await venta("Diego", 100);
    await venta("Diego", 50);
    await venta("Diego", 30, "cancelada");
    await venta("Ketus", 200);
    await pool.query(`INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, $2, 'turno_extendido', '{"horas":2}'::jsonb), ($1, $3, 'descuento_autorizado', '{}'::jsonb)`, [negocio.negocioId, diego, ketus]);
});

after(async () => {
    if (negocio) {
        await pool.query(`DELETE FROM public.bitacora_acciones WHERE negocio_id = $1`, [negocio.negocioId]);
        await pool.query(`DELETE FROM public.empleados WHERE negocio_id = $1`, [negocio.negocioId]);
        await borrarNegocioPrueba(negocio.negocioId);
    }

    await detenerServidorPrueba();
    await pool.end();
});

test("el rango por defecto es hoy y se corrige si viene al reves", () => {
    assert.deepEqual(rango({}), { desde: hoyLocal(), hasta: hoyLocal() });
    assert.deepEqual(rango({ desde: "2026-10-05", hasta: "2026-10-01" }), { desde: "2026-10-05", hasta: "2026-10-05" });
    assert.deepEqual(rango({ desde: "basura" }), { desde: hoyLocal(), hasta: hoyLocal() });
});

test("el equipo: ventas, canceladas, total y acciones por persona", async () => {
    const r = await llamar("/actividad/equipo", ketus);
    const cuerpo = await r.json();

    assert.equal(r.status, 200);
    const d = cuerpo.personas.find(p => p.nombre === "Diego");
    const k = cuerpo.personas.find(p => p.nombre === "Ketus");

    assert.deepEqual([d.ventas, d.total, d.canceladas, d.extensiones, d.horasExtra], [2, 150, 1, 1, 2]);
    assert.deepEqual([k.ventas, k.total], [1, 200]);
    assert.ok(k.acciones.some(a => a.accion === "descuento_autorizado" && a.texto === "Autorizó un descuento"));
    assert.ok(cuerpo.detalle.some(x => x.empleado === "Diego" && /tiempo extra/.test(x.texto)));
});

test("cada empleado ve solo lo suyo en 'mi actividad'", async () => {
    const r = await llamar("/actividad/mia", diego);
    const cuerpo = await r.json();

    assert.equal(r.status, 200);
    assert.deepEqual(cuerpo.personas.map(p => p.nombre), ["Diego"]);
    assert.ok(cuerpo.detalle.every(x => x.empleado === "Diego"), "no se cuelan acciones de otros");

    assert.equal((await llamar("/actividad/mia", null)).status, 400, "sin saber quien es, no hay nada que mostrar");
});

test("filtrar por persona en el reporte del equipo", async () => {
    const cuerpo = await (await llamar(`/actividad/equipo?empleadoId=${ketus}`, ketus)).json();

    assert.deepEqual(cuerpo.personas.map(p => p.nombre), ["Ketus"]);
});

test("un dia sin movimientos regresa ceros, no truena", async () => {
    const cuerpo = await (await llamar("/actividad/equipo?desde=2020-01-01&hasta=2020-01-01", ketus)).json();

    assert.ok(cuerpo.personas.every(p => p.ventas === 0 && p.total === 0));
    assert.deepEqual(cuerpo.detalle, []);
});

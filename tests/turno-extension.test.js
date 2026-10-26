// Fin de turno: 15 minutos de gracia y "sigo trabajando" con el PIN del propio empleado (solo se registra el tiempo extra).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");
const { minutosDe, pasoLaGracia, extensionVigente, extenderTurno, GRACIA_MIN } = require("../turno-extension");

let negocio, empleadoId;
const llamar = (ruta, opciones = {}, empleado = empleadoId) => fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...(empleado ? { "x-empleado-id": String(empleado) } : {}) } });

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("turno-extension");
    empleadoId = (await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, activo) VALUES ($1, 'Diego de prueba', 'Cajero', $2, true) RETURNING id`,
        [negocio.negocioId, hashPassword("4321")]
    )).rows[0].id;
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

test("la gracia son 15 minutos despues de la hora de salida", () => {
    assert.equal(GRACIA_MIN, 15);
    assert.equal(minutosDe("18:05"), 18 * 60 + 5);
    assert.equal(minutosDe("mañana"), null);
    assert.equal(pasoLaGracia("18:00", "18:14"), false, "dentro de la gracia");
    assert.equal(pasoLaGracia("18:00", "18:15"), true, "se cumplio la gracia");
    assert.equal(pasoLaGracia("18:00", "17:59"), false);
    assert.equal(pasoLaGracia(null, "18:30"), false, "sin horario no hay nada que vencer");
});

test("extender el turno con el PIN propio: registra el tiempo extra y vale unas horas", async () => {
    assert.equal(await extensionVigente(pool, negocio.negocioId, empleadoId), false);

    const mal = await llamar("/turno/extender", { method: "POST", body: JSON.stringify({ pin: "0000" }) });
    assert.equal(mal.status, 401, "PIN incorrecto");

    const sinEmpleado = await llamar("/turno/extender", { method: "POST", body: JSON.stringify({ pin: "4321" }) }, null);
    assert.equal(sinEmpleado.status, 400, "hay que saber quien es");

    const bien = await llamar("/turno/extender", { method: "POST", body: JSON.stringify({ pin: "4321", horas: 3 }) });
    const cuerpo = await bien.json();
    assert.equal(bien.status, 200);
    assert.equal(cuerpo.horas, 3);
    assert.ok(new Date(cuerpo.hasta) > new Date(Date.now() + 2.9 * 3600 * 1000));

    assert.equal(await extensionVigente(pool, negocio.negocioId, empleadoId), true);

    const registro = (await pool.query(`SELECT detalle FROM public.bitacora_acciones WHERE negocio_id = $1 AND empleado_id = $2 AND accion = 'turno_extendido'`, [negocio.negocioId, empleadoId])).rows;
    assert.equal(registro.length, 1, "queda en la bitacora como tiempo extra");
    assert.equal(registro[0].detalle.horas, 3);
});

test("el maximo son 6 horas y una extension vencida ya no vale", async () => {
    const r = await extenderTurno(pool, { negocioId: negocio.negocioId, empleadoId, horas: 50 });
    assert.equal(r.horas, 6);

    await pool.query(`UPDATE public.bitacora_acciones SET detalle = jsonb_set(detalle, '{hasta}', to_jsonb((NOW() - interval '1 minute')::text)) WHERE negocio_id = $1`, [negocio.negocioId]);
    assert.equal(await extensionVigente(pool, negocio.negocioId, empleadoId), false);
});

test("el aviso de turno vencido ahora dice que se puede extender con el PIN y el servidor usa la gracia", () => {
    const fs = require("node:fs");
    const server = fs.readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");

    assert.match(server, /turnoExtension\.pasoLaGracia\(finVencido, ahora\.hora\)/);
    assert.match(server, /turnoExtension\.extensionVigente/);
    assert.match(server, /puedeExtenderTurno: true/);
    assert.match(server, /require\("\.\/turno-extension"\)\(app, pool, requerirAccesoNegocio, limitadorPinEmpleado\)/);
});

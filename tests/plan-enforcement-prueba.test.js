// Bug real encontrado en la auditoria de lanzamiento (2026-08-26): la
// tabla public.planes nunca tuvo una fila 'prueba' (solo basico/plus/
// pro), y todo registro publico nuevo arranca con licencias.plan =
// 'prueba' -- asi que funcionDelPlan() no encontraba nada y CADA
// negocio en periodo de prueba perdia acceso real a funciones de
// Plus/Pro, justo lo contrario de lo que prometen los Terminos de
// Servicio ("acceso completo al sistema" durante los 15 dias).
// Corregido en plan-enforcement.js tratando "prueba" igual que
// pro/demo. Corre contra la base real via un negocio sintetico.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("plan-enforcement-prueba");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

async function fijarPlan(negocioId, plan) {
    await pool.query(
        `INSERT INTO public.licencias (negocio_id, plan)
         VALUES ($1, $2)
         ON CONFLICT (negocio_id) DO UPDATE SET plan = $2`,
        [negocioId, plan]
    );
}

test("un negocio en plan 'prueba' tiene acceso a una funcion exclusiva de Plus (Pedidos a proveedor)", async () => {
    await fijarPlan(negocio.negocioId, "prueba");

    const respuesta = await fetch(`${BASE_URL}/pedidos-proveedor`, {
        headers: { "x-dispositivo-token": negocio.token }
    });

    assert.equal(respuesta.status, 200, "un negocio en prueba no deberia recibir 403 en una funcion Plus/Pro");

    const datos = await respuesta.json();
    assert.equal(datos.requiereUpgrade, undefined);
});

test("un negocio en plan 'basico' real SIGUE bloqueado de esa misma funcion (el gate sigue vivo)", async () => {
    await fijarPlan(negocio.negocioId, "basico");

    const respuesta = await fetch(`${BASE_URL}/pedidos-proveedor`, {
        headers: { "x-dispositivo-token": negocio.token }
    });

    assert.equal(respuesta.status, 403);

    const datos = await respuesta.json();
    assert.equal(datos.requiereUpgrade, true);
    assert.equal(datos.funcion, "pedidos.estadisticas");
});

test("un negocio en plan 'plus' real tiene acceso normal (sin depender del atajo de prueba)", async () => {
    await fijarPlan(negocio.negocioId, "plus");

    const respuesta = await fetch(`${BASE_URL}/pedidos-proveedor`, {
        headers: { "x-dispositivo-token": negocio.token }
    });

    assert.equal(respuesta.status, 200);
});

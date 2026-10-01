// Seguimiento de errores de produccion (ver plan "Alertas de errores en
// produccion + panel de administrador"). Antes de esto, un error solo
// llegaba a console.error -- nadie se enteraba de un bug real con un
// cliente nuevo a menos que el mismo avisara. La prueba mas importante
// de este archivo es la deduplicacion: el MISMO bug repitiendose no
// debe crear una fila nueva cada vez (serian decenas de correos para
// un solo bug), debe ser una sola fila con un contador.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { registrarYAlertarError } = require("../errores-sistema-server");

const ADMIN_KEY = process.env.ADMIN_KEY;

function headersAdmin() {
    return { "x-admin-key": ADMIN_KEY };
}

async function limpiarPorRuta(ruta) {
    await pool.query(`DELETE FROM public.errores_sistema WHERE ruta = $1`, [ruta]);
}

before(async () => {
    await iniciarServidorPrueba();
});

after(async () => {
    await detenerServidorPrueba();
    await pool.end();
});

test("el mismo error dos veces es UNA fila con veces=2, no dos filas", async () => {
    const ruta = "GET /ruta-de-prueba-automatizada";
    await limpiarPorRuta(ruta);

    const resFalso = { req: { method: "GET", originalUrl: "/ruta-de-prueba-automatizada" } };

    await registrarYAlertarError(resFalso, new Error("boom de prueba"));
    await registrarYAlertarError(resFalso, new Error("boom de prueba"));

    const { rows } = await pool.query(
        `SELECT id, veces FROM public.errores_sistema WHERE ruta = $1`,
        [ruta]
    );

    assert.equal(rows.length, 1, "debe quedar una sola fila, no dos");
    assert.equal(rows[0].veces, 2);

    await limpiarPorRuta(ruta);
});

test("un error distinto en la misma ruta (mensaje distinto) es una fila aparte", async () => {
    const ruta = "GET /ruta-de-prueba-automatizada-2";
    await limpiarPorRuta(ruta);

    const resFalso = { req: { method: "GET", originalUrl: "/ruta-de-prueba-automatizada-2" } };

    await registrarYAlertarError(resFalso, new Error("error A"));
    await registrarYAlertarError(resFalso, new Error("error B"));

    const { rows } = await pool.query(
        `SELECT mensaje, veces FROM public.errores_sistema WHERE ruta = $1 ORDER BY mensaje`,
        [ruta]
    );

    assert.equal(rows.length, 2, "mensajes distintos no se deben fusionar");
    assert.equal(rows[0].veces, 1);
    assert.equal(rows[1].veces, 1);

    await limpiarPorRuta(ruta);
});

test("sin negocio en la peticion, negocio_id queda NULL sin tronar", async () => {
    const ruta = "GET /ruta-de-prueba-sin-negocio";
    await limpiarPorRuta(ruta);

    const resFalso = { req: { method: "GET", originalUrl: "/ruta-de-prueba-sin-negocio" } };

    await assert.doesNotReject(registrarYAlertarError(resFalso, new Error("sin negocio")));

    const { rows } = await pool.query(
        `SELECT negocio_id FROM public.errores_sistema WHERE ruta = $1`,
        [ruta]
    );
    assert.equal(rows[0].negocio_id, null);

    await limpiarPorRuta(ruta);
});

test("sin req en res (res.req undefined) no truena", async () => {
    const ruta = "desconocida";
    await limpiarPorRuta(ruta);

    await assert.doesNotReject(registrarYAlertarError({}, new Error("sin req")));

    const { rows } = await pool.query(`SELECT id FROM public.errores_sistema WHERE ruta = $1`, [ruta]);
    assert.equal(rows.length, 1);

    await limpiarPorRuta(ruta);
});

test("extremo a extremo contra el servidor real: provocar un 500 real, verlo en /admin/api/errores, resolverlo", async () => {
    // GET /admin/api/negocios/:id/dispositivos espera un id numerico --
    // uno no numerico hace que Postgres truene DENTRO de su propio
    // try/catch (responderError real, no simulado).
    const ruta = "GET /admin/api/negocios/prueba-automatizada-no-numerico/dispositivos";

    await fetch(`${BASE_URL}/admin/api/negocios/prueba-automatizada-no-numerico/dispositivos`, { headers: headersAdmin() });
    await fetch(`${BASE_URL}/admin/api/negocios/prueba-automatizada-no-numerico/dispositivos`, { headers: headersAdmin() });

    const lista = await (await fetch(`${BASE_URL}/admin/api/errores?resuelto=false`, { headers: headersAdmin() })).json();
    const fila = lista.errores.find(e => e.ruta === ruta);

    assert.ok(fila, "el error real debe aparecer en la lista de pendientes");
    assert.ok(fila.veces >= 2, "la segunda vez debe sumar al contador, no crear otra fila");

    const resolver = await fetch(`${BASE_URL}/admin/api/errores/${fila.id}/resolver`, {
        method: "PATCH", headers: headersAdmin()
    });
    assert.equal(resolver.status, 200);

    const listaDespues = await (await fetch(`${BASE_URL}/admin/api/errores?resuelto=false`, { headers: headersAdmin() })).json();
    assert.ok(!listaDespues.errores.some(e => e.id === fila.id), "ya no debe aparecer entre los pendientes");

    await limpiarPorRuta(ruta);
});

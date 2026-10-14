// Un cliente NUEVO (registro publico) arranca vendiendo al publico.
//
// El DEFAULT de la columna sigue siendo 'mayoreo' a proposito: es lo que
// cobraban los negocios que ya existian (ver nivel-precio-por-defecto.test.js
// y 20260929_restaurar_nivel_precio_mayoreo.sql). Pero un cliente que se
// registra hoy, con precio publico y de mayoreo en sus productos, cobraria el
// de mayoreo a todo el que llega al mostrador -- sin saberlo. Los negocios
// existentes NO se tocan.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

before(async () => {
    await iniciarServidorPrueba();
});

after(async () => {
    // Por correo, no por el id guardado: si la prueba falla antes de leerlo, el
    // negocio creado igual se borra.
    const creados = await pool.query("SELECT id FROM public.negocios WHERE LOWER(correo) = $1", [`test-auto-registro-nivel-${sufijo}@example.com`]);
    for (const { id } of creados.rows) await borrarNegocioPrueba(id);
    await detenerServidorPrueba();
    await pool.end();
});

test("un negocio que se registra por el sitio publico arranca en nivel publico", async () => {
    const respuesta = await fetch(`${BASE_URL}/api/clientes/registro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            negocio: `Test Auto Registro Nivel ${sufijo}`,
            giro: "abarrotes",
            telefono: "4425550100",
            correo: `test-auto-registro-nivel-${sufijo}@example.com`,
            password: "Prueba-Nexo-1234-x",
            confirmarPassword: "Prueba-Nexo-1234-x",
            ciudad: "Queretaro, Qro.",
            nombreContacto: "Prueba"
        })
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 201, JSON.stringify(datos));

    const fila = await pool.query(
        "SELECT id, nivel_precio_por_defecto FROM public.negocios WHERE LOWER(correo) = $1",
        [`test-auto-registro-nivel-${sufijo}@example.com`]
    );
    assert.equal(fila.rows.length, 1);
    assert.equal(fila.rows[0].nivel_precio_por_defecto, "publico");
});

test("el DEFAULT de la tabla no se toco: lo ya existente sigue como estaba", async () => {
    const r = await pool.query(
        `SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'negocios' AND column_name = 'nivel_precio_por_defecto'`
    );
    assert.match(r.rows[0].column_default, /mayoreo/);
});

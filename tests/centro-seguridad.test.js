// Centro de seguridad (ver plan stateless-doodling-tarjan.md): valor
// nuevo genuino, exclusivo Pro -- junta bitacora de acciones e
// intentos de acceso, ninguno de los dos tenia lector hasta ahora.
// Regla dura del plan: Sesiones/Dispositivos (/cuenta/sesiones,
// /cuenta/dispositivos) siguen gratis para cualquier plan -- este
// archivo tambien prueba esa regresion.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
    pool, crearNegocioPrueba, establecerPlanPrueba, crearSesionCuentaPrueba, borrarNegocioPrueba
} = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let sesionToken;

function headersCuenta() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${sesionToken}` };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("centro-seguridad");
    sesionToken = await crearSesionCuentaPrueba(negocio.negocioId);
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("plan Basico: el Centro de seguridad se rechaza, pero Sesiones/Dispositivos siguen gratis", async () => {
    await establecerPlanPrueba(negocio.negocioId, "basico");

    const estado = await (await fetch(`${BASE_URL}/cuenta/centro-seguridad/estado`, { headers: headersCuenta() })).json();
    assert.equal(estado.disponibleEnPlan, false);

    const bitacora = await fetch(`${BASE_URL}/cuenta/bitacora`, { headers: headersCuenta() });
    assert.equal(bitacora.status, 403);

    const intentos = await fetch(`${BASE_URL}/cuenta/intentos-acceso`, { headers: headersCuenta() });
    assert.equal(intentos.status, 403);

    // Regla dura del plan: nunca re-candar lo que ya era gratis.
    const sesiones = await fetch(`${BASE_URL}/cuenta/sesiones`, { headers: headersCuenta() });
    assert.equal(sesiones.status, 200);
    const dispositivos = await fetch(`${BASE_URL}/cuenta/dispositivos`, { headers: headersCuenta() });
    assert.equal(dispositivos.status, 200);
});

test("plan Pro: la bitacora real se puede leer (antes no tenia ningun lector)", async () => {
    await establecerPlanPrueba(negocio.negocioId, "pro");

    await pool.query(
        `INSERT INTO public.bitacora_acciones (negocio_id, accion, detalle) VALUES ($1, 'venta_cancelada', $2::jsonb)`,
        [negocio.negocioId, JSON.stringify({ folio: "V-000999", motivo: "prueba automatizada" })]
    );

    const respuesta = await fetch(`${BASE_URL}/cuenta/bitacora`, { headers: headersCuenta() });
    assert.equal(respuesta.status, 200);
    const datos = await respuesta.json();

    assert.equal(datos.ok, true);
    const fila = datos.acciones.find(a => a.detalle?.folio === "V-000999");
    assert.ok(fila, "la fila sembrada aparece en la bitacora");
    assert.equal(fila.accion, "venta_cancelada");
});

test("3 o mas intentos fallidos en 24h prenden la alerta; menos de 3 no", async () => {
    await establecerPlanPrueba(negocio.negocioId, "pro");

    for (let i = 0; i < 2; i++) {
        await pool.query(
            `INSERT INTO public.intentos_login (negocio_id, correo_intentado, ip, exito) VALUES ($1, 'prueba@example.com', '127.0.0.1', false)`,
            [negocio.negocioId]
        );
    }

    const conDos = await (await fetch(`${BASE_URL}/cuenta/intentos-acceso`, { headers: headersCuenta() })).json();
    assert.equal(conDos.alertaIntentosFallidos, false, "2 fallos todavia no prende la alerta");

    await pool.query(
        `INSERT INTO public.intentos_login (negocio_id, correo_intentado, ip, exito) VALUES ($1, 'prueba@example.com', '127.0.0.1', false)`,
        [negocio.negocioId]
    );

    const conTres = await (await fetch(`${BASE_URL}/cuenta/intentos-acceso`, { headers: headersCuenta() })).json();
    assert.equal(conTres.alertaIntentosFallidos, true, "3 fallos si prende la alerta");
    assert.ok(conTres.intentos.some(i => i.exito === false));
});

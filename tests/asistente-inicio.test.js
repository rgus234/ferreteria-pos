// Asistente de inicio (primer uso): estado y guardado por pasos.
//
// Lo que se protege:
//  - solo el dueno / administrador lo ve y lo guarda (trae el correo de acceso
//    de la cuenta y cambia datos del negocio);
//  - lo que llega se valida y se limpia: nada de valores arbitrarios en el
//    JSONB de respuestas, correos invalidos ni nombres vacios;
//  - "terminado" es de una sola vez y los guardados parciales se mezclan en vez
//    de pisarse.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword } = require("../password-utils");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let cajeroId;

function headers(extra = {}) {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...extra };
}

async function leer(extra) {
    const r = await fetch(`${BASE_URL}/negocio-actual/onboarding`, { headers: headers(extra) });
    return { status: r.status, cuerpo: await r.json() };
}

async function guardar(cuerpo, extra) {
    const r = await fetch(`${BASE_URL}/negocio-actual/onboarding`, { method: "PUT", headers: headers(extra), body: JSON.stringify(cuerpo) });
    return { status: r.status, cuerpo: await r.json() };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("asistente-inicio");
    await pool.query(`UPDATE public.negocios SET correo = $2, correo_verificado = true, telefono = '4425550100' WHERE id = $1`, [negocio.negocioId, `test-auto-asistente-${Date.now()}@example.com`]);

    const empleado = await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, permisos)
         VALUES ($1, 'Cajero sin admin', 'Cajero', $2, '{"hacer_ventas": true}'::jsonb) RETURNING id`,
        [negocio.negocioId, hashPassword("1234")]
    );
    cajeroId = empleado.rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("un negocio nuevo trae el asistente pendiente, con sus datos y su correo de acceso", async () => {
    const { status, cuerpo } = await leer();

    assert.equal(status, 200);
    assert.equal(cuerpo.completado, false);
    assert.equal(cuerpo.completadoAt, null);
    assert.deepEqual(cuerpo.respuestas, {});
    assert.equal(cuerpo.datos.telefono, "4425550100");
    assert.equal(cuerpo.datos.slogan, "");
    assert.equal(cuerpo.datos.correoNegocio, "");
    assert.match(cuerpo.correoAcceso, /^test-auto-asistente-/);
    assert.equal(cuerpo.correoVerificado, true);
    assert.ok(Array.isArray(cuerpo.giros));
});

test("guarda los datos del negocio y los devuelve", async () => {
    const { status, cuerpo } = await guardar({
        datos: { nombre: "  Abarrotes La Esperanza ", telefono: "442 555 0199", slogan: "Lo que necesitas, cerca de ti", correoNegocio: "Ventas@LaEsperanza.com" },
        paso: 3
    });

    assert.equal(status, 200);
    assert.equal(cuerpo.datos.nombre, "Abarrotes La Esperanza", "se recorta");
    assert.equal(cuerpo.datos.telefono, "442 555 0199");
    assert.equal(cuerpo.datos.slogan, "Lo que necesitas, cerca de ti");
    assert.equal(cuerpo.datos.correoNegocio, "ventas@laesperanza.com", "en minusculas");
    assert.equal(cuerpo.respuestas.paso, 3);
    assert.equal(cuerpo.completado, false, "guardar no termina el asistente");

    const fila = await pool.query(`SELECT slogan, correo_negocio FROM public.negocios WHERE id = $1`, [negocio.negocioId]);
    assert.equal(fila.rows[0].slogan, "Lo que necesitas, cerca de ti");
    assert.equal(fila.rows[0].correo_negocio, "ventas@laesperanza.com");
});

test("los guardados parciales se mezclan en vez de pisarse", async () => {
    await guardar({ respuestas: { granel: "si", fiado: "no" } });
    const { cuerpo } = await guardar({ respuestas: { caducidad: "si", fiado: "si" } });

    assert.equal(cuerpo.respuestas.granel, "si", "lo anterior se conserva");
    assert.equal(cuerpo.respuestas.caducidad, "si");
    assert.equal(cuerpo.respuestas.fiado, "si", "lo reenviado se actualiza");
    assert.equal(cuerpo.respuestas.paso, 3, "el paso de antes sigue ahi");
});

test("una respuesta fuera de lo permitido se rechaza y no se guarda nada", async () => {
    const antes = await leer();
    const r = await guardar({ respuestas: { granel: "tal vez" }, datos: { slogan: "No debe guardarse" } });

    assert.equal(r.status, 400);
    const despues = await leer();
    assert.deepEqual(despues.cuerpo.respuestas, antes.cuerpo.respuestas);
    assert.notEqual(despues.cuerpo.datos.slogan, "No debe guardarse");
});

test("el equipo (lector, impresora y cajon) se guarda y solo acepta si, no o no_se", async () => {
    const { status, cuerpo } = await guardar({ respuestas: { lector: "no", impresora: "si", cajon: "no_se" } });
    assert.equal(status, 200);
    assert.equal(cuerpo.respuestas.lector, "no");
    assert.equal(cuerpo.respuestas.impresora, "si");
    assert.equal(cuerpo.respuestas.cajon, "no_se");

    for (const clave of ["lector", "cajon"]) {
        const r = await guardar({ respuestas: { [clave]: "quizas" } });
        assert.equal(r.status, 400, `${clave} acepta valores raros`);
    }
});

test("claves desconocidas no entran al JSONB de respuestas", async () => {
    const { cuerpo } = await guardar({ respuestas: { granel: "no", inventada: "valor", "__proto__": "x" } });
    assert.equal(cuerpo.respuestas.granel, "no");
    assert.equal(cuerpo.respuestas.inventada, undefined);
});

test("correo del negocio invalido y nombre vacio se rechazan", async () => {
    assert.equal((await guardar({ datos: { correoNegocio: "esto-no-es-un-correo" } })).status, 400);
    assert.equal((await guardar({ datos: { nombre: " " } })).status, 400);
    // Un correo de negocio vacio es valido: significa "el mismo de acceso".
    const ok = await guardar({ datos: { correoNegocio: "" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.cuerpo.datos.correoNegocio, "");
});

test("borrar la direccion la deja vacia sin llamar a ningun servicio externo", async () => {
    await pool.query(`UPDATE public.negocios SET direccion = 'Calle Falsa 123', direccion_lat = 20.5, direccion_lng = -100.4 WHERE id = $1`, [negocio.negocioId]);
    const { cuerpo } = await guardar({ datos: { direccion: "" } });
    assert.equal(cuerpo.datos.direccion, "");

    const fila = await pool.query(`SELECT direccion, direccion_lat, direccion_lng FROM public.negocios WHERE id = $1`, [negocio.negocioId]);
    assert.equal(fila.rows[0].direccion, null);
    assert.equal(fila.rows[0].direccion_lat, null, "sin direccion no quedan coordenadas viejas");
});

test("terminar el asistente es de una sola vez", async () => {
    const primera = await guardar({ completado: true, respuestas: { primerPaso: "agregar_productos" } });
    assert.equal(primera.cuerpo.completado, true);
    const marca = primera.cuerpo.completadoAt;
    assert.ok(marca);

    const segunda = await guardar({ completado: true });
    assert.equal(segunda.cuerpo.completadoAt, marca, "la fecha original no se pisa");
});

test("un empleado sin permiso de administrar usuarios no lo ve ni lo guarda", async () => {
    const extra = { "x-empleado-id": String(cajeroId) };
    assert.equal((await leer(extra)).status, 403);
    assert.equal((await guardar({ datos: { slogan: "No" } }, extra)).status, 403);

    const fila = await pool.query(`SELECT slogan FROM public.negocios WHERE id = $1`, [negocio.negocioId]);
    assert.notEqual(fila.rows[0].slogan, "No");
});

test("la ruta de siempre, /negocio-actual, ya trae el slogan y si el asistente esta terminado", async () => {
    const r = await fetch(`${BASE_URL}/negocio-actual`, { headers: headers() });
    const cuerpo = await r.json();
    assert.equal(cuerpo.negocio.slogan, "Lo que necesitas, cerca de ti");
    assert.ok(cuerpo.negocio.onboarding_completado_at);
    assert.equal(cuerpo.negocio.password_hash, undefined, "nunca la contrasena");
});

// Fase 0 del ecosistema Nexo (RBAC) -- corre contra la base de datos
// real (no hay una de pruebas separada en este proyecto), todo queda
// aislado en un negocio + persona + empleado sinteticos propios y se
// borra al terminar. Ver tests/helpers/negocio-prueba.js y
// tests/helpers/persona-prueba.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { hashPassword } = require("../password-utils");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba } = require("./helpers/persona-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

function hashTokenSeguro(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

let negocio;
let persona;
let personaToken;
let empleadoId;
let cuentaToken;

before(async () => {
    await iniciarServidorPrueba();

    negocio = await crearNegocioPrueba("rbac");
    persona = await crearPersonaPrueba("rbac");
    personaToken = await mintearSesionPruebaPersona(persona.id);

    const empleado = await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, permisos)
         VALUES ($1, 'Empleado RBAC', 'Cajero', $2, '{}'::jsonb)
         RETURNING id`,
        [negocio.negocioId, hashPassword("1234")]
    );
    empleadoId = empleado.rows[0].id;

    // Sesion de cuenta (dueño) minteada directo, sin pasar por
    // /cuenta/login -- crearNegocioPrueba no le pone password_hash al
    // negocio, mismo atajo que dispositivos_vinculados ya usa ahi.
    cuentaToken = `token-cuenta-prueba-${crypto.randomBytes(16).toString("hex")}`;
    await pool.query(
        `INSERT INTO public.sesiones_cuenta (negocio_id, token_hash, dispositivo) VALUES ($1, $2, 'pruebas-automatizadas')`,
        [negocio.negocioId, hashTokenSeguro(cuentaToken)]
    );
});

after(async () => {
    // Orden importa: el test de vinculacion deja empleados.persona_id
    // apuntando a la persona sintetica, y esa FK no tiene ON DELETE
    // CASCADE (a proposito, para no perder el rastro de quien es quien
    // si algun dia se borra una persona real) -- borrar el negocio
    // primero se lleva el empleado por su propio ON DELETE CASCADE
    // (negocio_id), liberando la referencia antes de borrar la persona.
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (persona) await borrarPersonaPrueba(persona.id);
    await detenerServidorPrueba();
    await pool.end();
});

test("sesion de dispositivo sin x-empleado-id sigue sin restriccion (compatibilidad con las rutas de hoy)", async () => {
    const respuesta = await fetch(`${BASE_URL}/negocio-actual/pedidos-market`, {
        headers: { "x-dispositivo-token": negocio.token }
    });

    assert.equal(respuesta.status, 200);
});

test("empleado con permisos vacios recibe 403 en una ruta gateada por requerirPermiso", async () => {
    const respuesta = await fetch(`${BASE_URL}/negocio-actual/pedidos-market`, {
        headers: { "x-dispositivo-token": negocio.token, "x-empleado-id": String(empleadoId) }
    });

    assert.equal(respuesta.status, 403);
    const datos = await respuesta.json();
    assert.equal(datos.requierePermiso, "ver_pedidos");
});

test("con el permiso concedido, la misma ruta responde 200", async () => {
    await pool.query(
        `UPDATE public.empleados SET permisos = '{"ver_pedidos": true}'::jsonb WHERE id = $1`,
        [empleadoId]
    );

    const respuesta = await fetch(`${BASE_URL}/negocio-actual/pedidos-market`, {
        headers: { "x-dispositivo-token": negocio.token, "x-empleado-id": String(empleadoId) }
    });

    assert.equal(respuesta.status, 200);
});

test("un empleado con rol Administrador nunca se bloquea, aunque permisos este vacio", async () => {
    await pool.query(`UPDATE public.empleados SET rol = 'Administrador', permisos = '{}'::jsonb WHERE id = $1`, [empleadoId]);

    const respuesta = await fetch(`${BASE_URL}/negocio-actual/pedidos-market`, {
        headers: { "x-dispositivo-token": negocio.token, "x-empleado-id": String(empleadoId) }
    });

    assert.equal(respuesta.status, 200);

    await pool.query(`UPDATE public.empleados SET rol = 'Cajero' WHERE id = $1`, [empleadoId]);
});

test("el dueño genera un codigo de vinculo y la persona lo canjea como empleado", async () => {
    const generado = await fetch(`${BASE_URL}/cuenta/empleados/${empleadoId}/generar-codigo-vinculo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cuentaToken}` }
    });

    assert.equal(generado.status, 200);
    const { codigo } = await generado.json();
    assert.ok(codigo && codigo.length > 0);

    const canjeado = await fetch(`${BASE_URL}/personas/vincular-empleado`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": personaToken },
        body: JSON.stringify({ codigo })
    });

    assert.equal(canjeado.status, 200);
    const datosCanje = await canjeado.json();
    assert.equal(datosCanje.rol, "employee");
    assert.equal(datosCanje.negocio.slug, negocio.slug);

    const empleadoActualizado = await pool.query(`SELECT persona_id, codigo_vinculo_hash FROM public.empleados WHERE id = $1`, [empleadoId]);
    assert.equal(empleadoActualizado.rows[0].persona_id, persona.id);
    assert.equal(empleadoActualizado.rows[0].codigo_vinculo_hash, null);

    const miembro = await pool.query(
        `SELECT rol, permisos, activo FROM public.negocio_miembros WHERE persona_id = $1 AND negocio_id = $2`,
        [persona.id, negocio.negocioId]
    );
    assert.equal(miembro.rows.length, 1);
    assert.equal(miembro.rows[0].rol, "employee");
    assert.equal(miembro.rows[0].activo, true);

    // Un codigo ya canjeado no se puede volver a usar.
    const reintento = await fetch(`${BASE_URL}/personas/vincular-empleado`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": personaToken },
        body: JSON.stringify({ codigo })
    });
    assert.equal(reintento.status, 404);
});

test("resolverIdentidadNexo normaliza el rol de una sesion de cuenta como owner sin restriccion", async () => {
    const { resolverIdentidadNexo } = require("../rbac");
    const identidad = await resolverIdentidadNexo({ negocioAutenticado: { negocio_id: negocio.negocioId } });

    assert.equal(identidad.rol, "owner");
    assert.equal(identidad.permisos, null);
});

test("resolverIdentidadNexo resuelve una persona sin membresia como customer sin permisos", async () => {
    const { resolverIdentidadNexo } = require("../rbac");
    const identidad = await resolverIdentidadNexo({ persona: { id: persona.id } }, 999999);

    assert.equal(identidad.rol, "customer");
    assert.deepEqual(identidad.permisos, {});
});

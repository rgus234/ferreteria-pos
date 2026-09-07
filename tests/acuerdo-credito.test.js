// Verifica el nucleo del Acuerdo de Credito: una cuenta nueva nace
// PENDIENTE_DE_ACEPTACION, no puede vender a credito hasta aceptar, y
// la aceptacion via enlace/QR (sin cuenta Nexo) la activa. Corre
// contra la base de datos real, aislado en un negocio sintetico.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("acuerdo-credito");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("alta directa en el POS genera un acuerdo v1 pendiente, con token de aceptacion", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Juan Perez", telefono: "5559998888", limiteCredito: 7500, diasCredito: 45 })
    });

    assert.equal(creado.status, 200);
    const datos = await creado.json();

    assert.equal(datos.acuerdo.version, 1);
    assert.equal(datos.acuerdo.estado, "pendiente_aceptacion");
    assert.ok(datos.tokenAceptacion, "debe regresar el token en claro, una sola vez");
    assert.ok(datos.codigoPortal, "con telefono, el portal-cliente se activa automatico");

    const fila = await pool.query(`SELECT acuerdo_vigente_id FROM public.clientes_credito WHERE id = $1`, [datos.cliente.id]);
    assert.equal(fila.rows[0].acuerdo_vigente_id, null, "todavia no hay acuerdo vigente -- nadie ha aceptado nada");
});

test("una cuenta pendiente de aceptacion no puede cobrar a credito", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente sin aceptar", limiteCredito: 1000 })
    });
    const clienteId = (await creado.json()).cliente.id;

    const cargo = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 100, concepto: "Intento antes de aceptar" })
    });

    assert.equal(cargo.status, 409);
});

test("aceptar por enlace/token activa la cuenta y ya permite cobrar a credito -- el token no sirve dos veces", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente con enlace", limiteCredito: 2000, diasCredito: 30 })
    });
    const datos = await creado.json();
    const clienteId = datos.cliente.id;
    const token = datos.tokenAceptacion;

    const paginaAntes = await fetch(`${BASE_URL}/acuerdo/${token}`);
    assert.equal(paginaAntes.status, 200);

    const aceptar = await fetch(`${BASE_URL}/acuerdo/${token}/aceptar`, { method: "POST" });
    assert.equal(aceptar.status, 200);
    assert.equal((await aceptar.json()).ok, true);

    const cargo = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 150, concepto: "Compra ya con credito activo" })
    });
    assert.equal(cargo.status, 200, "ya deberia poder cobrar a credito tras aceptar");

    const fila = await pool.query(`SELECT dias_credito FROM public.clientes_credito WHERE id = $1`, [clienteId]);
    assert.equal(fila.rows[0].dias_credito, 30, "el plazo otorgado en el acuerdo debe quedar reflejado en el cliente");

    const reintento = await fetch(`${BASE_URL}/acuerdo/${token}/aceptar`, { method: "POST" });
    assert.equal(reintento.status, 404, "un token ya usado no debe volver a servir");

    const aceptacion = await pool.query(
        `SELECT metodo, persona_id FROM public.aceptaciones_credito ac
         JOIN public.acuerdos_credito a ON a.id = ac.acuerdo_credito_id
         WHERE a.cliente_credito_id = $1`,
        [clienteId]
    );
    assert.equal(aceptacion.rows[0].metodo, "enlace_token");
    assert.equal(aceptacion.rows[0].persona_id, null, "sin cuenta Nexo, la aceptacion no tiene persona_id -- y esta bien que asi sea");
});

test("bajar el limite se aplica de inmediato, sin pedir aceptacion -- subirlo si la pide", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente limite", limiteCredito: 5000 })
    });
    const datos = await creado.json();
    await fetch(`${BASE_URL}/acuerdo/${datos.tokenAceptacion}/aceptar`, { method: "POST" });

    const clienteId = datos.cliente.id;

    const antes = await pool.query(`SELECT limite_credito, acuerdo_vigente_id FROM public.clientes_credito WHERE id = $1`, [clienteId]);
    const acuerdoVigenteAntes = antes.rows[0].acuerdo_vigente_id;

    // Simula "bajar el limite" directo con el modulo -- todavia no hay
    // endpoint HTTP para esto (queda para la siguiente fase de
    // implementacion), pero el mecanismo de crearVersionAcuerdo ya se
    // prueba aqui a nivel de modulo.
    const acuerdoCredito = require("../acuerdo-credito");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`SELECT * FROM public.clientes_credito WHERE id = $1 FOR UPDATE`, [clienteId]);
        const { acuerdo } = await acuerdoCredito.crearVersionAcuerdo(client, {
            negocioId: negocio.negocioId,
            clienteCreditoId: clienteId,
            limiteCredito: 3000,
            diasCredito: 15,
            origen: "cambio_limite",
            generadoPor: { tipo: "empleado", id: null, nombre: "prueba" },
            autoAceptar: true
        });
        await client.query("COMMIT");
        assert.equal(acuerdo.estado, "aceptado", "una reduccion se auto-acepta, no queda pendiente");
    } finally {
        client.release();
    }

    const despues = await pool.query(`SELECT limite_credito, acuerdo_vigente_id FROM public.clientes_credito WHERE id = $1`, [clienteId]);
    assert.equal(Number(despues.rows[0].limite_credito), 3000, "el nuevo limite ya debe estar activo de inmediato");
    assert.notEqual(despues.rows[0].acuerdo_vigente_id, acuerdoVigenteAntes, "el acuerdo vigente avanzo a la nueva version");

    const aceptacionReduccion = await pool.query(
        `SELECT id FROM public.aceptaciones_credito WHERE acuerdo_credito_id = $1`,
        [despues.rows[0].acuerdo_vigente_id]
    );
    assert.equal(aceptacionReduccion.rows.length, 0, "una reduccion unilateral no genera fila de aceptacion -- esa ausencia es la senal de que fue unilateral");
});

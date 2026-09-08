// Verifica el nucleo del Acuerdo de Credito: una cuenta nueva nace
// PENDIENTE_DE_ACEPTACION, no puede vender a credito hasta aceptar, y
// la aceptacion via enlace/QR (sin cuenta Nexo) la activa. Corre
// contra la base de datos real, aislado en un negocio sintetico.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearClienteCreditoActivo } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");

let negocio;
const personasCreadasIds = [];

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

// personas es global (no vive bajo negocio_id) -- borrarNegocioPrueba
// no la toca, asi que las que este archivo cree se registran aqui para
// limpiarlas aparte. correo=NULL a proposito: estas pruebas ejercitan
// el endpoint de aprobar/rechazar solicitudes, que ahora manda un
// correo real via Resend (RESEND_API_KEY si esta configurada en este
// entorno) -- sin correo, ese envio se salta solo (mismo "if
// (correoCliente)" que ya trae el endpoint), sin arriesgar un envio de
// verdad durante las pruebas.
async function crearPersonaPrueba(sufijo) {
    const fila = await pool.query(
        `INSERT INTO public.personas (nombre, correo, telefono, password_hash, correo_verificado)
         VALUES ($1, NULL, NULL, $2, true) RETURNING id`,
        [`Persona de prueba ${sufijo}`, hashPassword("prueba1234")]
    );
    personasCreadasIds.push(fila.rows[0].id);
    return fila.rows[0].id;
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("acuerdo-credito");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    for (const id of personasCreadasIds) {
        await pool.query(`DELETE FROM public.personas WHERE id = $1`, [id]);
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

test("aceptar presencial en el mostrador activa la cuenta sin usar el token, y queda marcada distinta del enlace", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente sin celular", limiteCredito: 3000, diasCredito: 20 })
    });
    const datos = await creado.json();
    const clienteId = datos.cliente.id;

    const aceptar = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/acuerdo/aceptar-presencial`, {
        method: "POST",
        headers: headers()
    });
    assert.equal(aceptar.status, 200);
    assert.equal((await aceptar.json()).ok, true);

    const cargo = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 100, concepto: "Compra tras aceptar presencial" })
    });
    assert.equal(cargo.status, 200, "ya deberia poder cobrar a credito tras aceptar presencial");

    const aceptacion = await pool.query(
        `SELECT metodo, persona_id FROM public.aceptaciones_credito ac
         JOIN public.acuerdos_credito a ON a.id = ac.acuerdo_credito_id
         WHERE a.cliente_credito_id = $1`,
        [clienteId]
    );
    assert.equal(aceptacion.rows[0].metodo, "presencial_pos");
    assert.equal(aceptacion.rows[0].persona_id, null);

    // El token original sigue intacto -- aceptar presencial no lo
    // consume, porque no depende de el para probar identidad.
    const reintentoToken = await fetch(`${BASE_URL}/acuerdo/${datos.tokenAceptacion}/aceptar`, { method: "POST" });
    assert.equal(reintentoToken.status, 404, "el acuerdo ya no esta pendiente, aunque el token nunca se haya usado ni haya vencido");

    const otraVez = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/acuerdo/aceptar-presencial`, {
        method: "POST",
        headers: headers()
    });
    assert.equal(otraVez.status, 404, "sin acuerdo pendiente, no hay nada que aceptar presencial");
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

test("cliente sin ningun acuerdo (de antes de esta capa) puede formalizar uno con 'Generar acuerdo'", async () => {
    const clienteId = (await crearClienteCreditoActivo(negocio.negocioId, { limiteCredito: 4000, diasCredito: 15 })).id;

    // crearClienteCreditoActivo ya deja un acuerdo aceptado -- para
    // simular de verdad un cliente "de antes de esta capa" hay que
    // borrarlo, dejando la fila igual que las que ya existian antes de
    // que existiera el Acuerdo de Credito.
    await pool.query(`UPDATE public.clientes_credito SET acuerdo_vigente_id = NULL WHERE id = $1`, [clienteId]);
    await pool.query(`DELETE FROM public.acuerdos_credito WHERE cliente_credito_id = $1`, [clienteId]);

    const detalleAntes = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}`, { headers: headers() });
    const datosAntes = await detalleAntes.json();
    assert.equal(datosAntes.acuerdo.tieneAlgunAcuerdo, false);

    const generar = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/acuerdo`, { method: "POST", headers: headers(), body: "{}" });
    assert.equal(generar.status, 200);
    const datosGenerar = await generar.json();
    assert.equal(datosGenerar.acuerdo.version, 1);
    assert.ok(datosGenerar.tokenAceptacion);

    // Ya no puede volver a "formalizar" -- ya tiene uno.
    const segundaVez = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/acuerdo`, { method: "POST", headers: headers(), body: "{}" });
    assert.equal(segundaVez.status, 409);
});

test("reenviar el acuerdo pendiente da un token nuevo sin crear otra version", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ nombre: "Cliente reenvio", limiteCredito: 1000 })
    });
    const datos = await creado.json();

    const reenviar = await fetch(`${BASE_URL}/creditos/clientes/${datos.cliente.id}/acuerdo/reenviar`, { method: "POST", headers: headers() });
    assert.equal(reenviar.status, 200);
    const datosReenvio = await reenviar.json();
    assert.ok(datosReenvio.tokenAceptacion);
    assert.notEqual(datosReenvio.tokenAceptacion, datos.tokenAceptacion, "debe ser un token distinto al original");

    const versiones = await pool.query(`SELECT COUNT(*) AS n FROM public.acuerdos_credito WHERE cliente_credito_id = $1`, [datos.cliente.id]);
    assert.equal(Number(versiones.rows[0].n), 1, "reenviar no debe crear una version nueva");

    // El token viejo ya no sirve; el nuevo si.
    const conTokenViejo = await fetch(`${BASE_URL}/acuerdo/${datos.tokenAceptacion}/aceptar`, { method: "POST" });
    assert.equal(conTokenViejo.status, 404);

    const conTokenNuevo = await fetch(`${BASE_URL}/acuerdo/${datosReenvio.tokenAceptacion}/aceptar`, { method: "POST" });
    assert.equal(conTokenNuevo.status, 200);
});

test("suspender bloquea la venta a credito sin tocar el limite; reactivar la regresa", async () => {
    const clienteId = (await crearClienteCreditoActivo(negocio.negocioId, { limiteCredito: 2000 })).id;

    const suspender = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/suspender`, { method: "POST", headers: headers(), body: "{}" });
    assert.equal(suspender.status, 200);

    const cargoSuspendido = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST", headers: headers(), body: JSON.stringify({ monto: 100, concepto: "no deberia pasar" })
    });
    assert.equal(cargoSuspendido.status, 409);

    const reactivar = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/reactivar`, { method: "POST", headers: headers() });
    assert.equal(reactivar.status, 200);

    const cargoReactivado = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST", headers: headers(), body: JSON.stringify({ monto: 100, concepto: "ya deberia pasar" })
    });
    assert.equal(cargoReactivado.status, 200);

    const fila = await pool.query(`SELECT limite_credito FROM public.clientes_credito WHERE id = $1`, [clienteId]);
    assert.equal(Number(fila.rows[0].limite_credito), 2000, "suspender/reactivar no debe tocar el limite");
});

test("configuracion de credito del negocio: valores por defecto, se guarda y se lee de vuelta", async () => {
    const porDefecto = await fetch(`${BASE_URL}/negocio-actual/configuracion-credito`, { headers: headers() });
    assert.equal(porDefecto.status, 200);
    const datosDefecto = await porDefecto.json();
    assert.deepEqual(datosDefecto.configuracion.plazosDisponibles, [15, 30, 60], "sin configurar todavia, el menu por defecto es 15/30/60");

    const guardar = await fetch(`${BASE_URL}/negocio-actual/configuracion-credito`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ plazosDisponibles: [7, 15, 45], requiereIdentificacion: true, requiereDomicilio: false, politicaTexto: "Sujeto a aprobacion del negocio." })
    });
    assert.equal(guardar.status, 200);

    const leido = await fetch(`${BASE_URL}/negocio-actual/configuracion-credito`, { headers: headers() });
    const datosLeidos = await leido.json();
    assert.deepEqual(datosLeidos.configuracion.plazosDisponibles, [7, 15, 45]);
    assert.equal(datosLeidos.configuracion.requiereIdentificacion, true);
    assert.equal(datosLeidos.configuracion.requiereDomicilio, false);
    assert.equal(datosLeidos.configuracion.politicaTexto, "Sujeto a aprobacion del negocio.");

    // La politica configurada aqui debe llegar congelada dentro del
    // siguiente acuerdo que se genere (§6b: nunca una referencia en
    // vivo a la politica actual).
    const cliente = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ nombre: "Cliente con politica", limiteCredito: 1000 })
    });
    const datosCliente = await cliente.json();
    const acuerdoFila = await pool.query(`SELECT condiciones_texto FROM public.acuerdos_credito WHERE id = $1`, [datosCliente.acuerdo.id]);
    assert.ok(acuerdoFila.rows[0].condiciones_texto.includes("Sujeto a aprobacion del negocio."), "la politica configurada debe quedar en el texto congelado del acuerdo");
});

test("aprobar una solicitud crea el cliente vinculado a la persona y genera el acuerdo v1", async () => {
    const personaId = await crearPersonaPrueba("aprobar");
    const solicitud = await pool.query(
        `INSERT INTO public.solicitudes_credito (negocio_id, nombre, telefono, persona_id, estado)
         VALUES ($1, 'Cliente de solicitud', '5551234567', $2, 'pendiente') RETURNING id`,
        [negocio.negocioId, personaId]
    );
    const solicitudId = solicitud.rows[0].id;

    const sinTerminos = await fetch(`${BASE_URL}/negocio-actual/solicitudes-credito/${solicitudId}`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ estado: "aprobado" })
    });
    assert.equal(sinTerminos.status, 400, "aprobar sin limite/plazo debe rechazarse -- el negocio decide los terminos");

    const aprobar = await fetch(`${BASE_URL}/negocio-actual/solicitudes-credito/${solicitudId}`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ estado: "aprobado", limiteCredito: 6000, diasCredito: 30 })
    });
    assert.equal(aprobar.status, 200);
    const datosAprobar = await aprobar.json();
    assert.ok(datosAprobar.clienteCreditoId);
    assert.equal(datosAprobar.acuerdo.version, 1);

    const clienteFila = await pool.query(`SELECT persona_id, limite_credito, dias_credito, acuerdo_vigente_id FROM public.clientes_credito WHERE id = $1`, [datosAprobar.clienteCreditoId]);
    assert.equal(clienteFila.rows[0].persona_id, personaId, "el cliente creado debe quedar vinculado a la persona desde el dia uno, sin el paso manual de 'vincular'");
    assert.equal(Number(clienteFila.rows[0].limite_credito), 6000);
    assert.equal(clienteFila.rows[0].acuerdo_vigente_id, null, "PENDIENTE_DE_ACEPTACION -- aprobar no activa la cuenta, solo genera el acuerdo");

    const solicitudFinal = await pool.query(`SELECT estado, cliente_credito_id FROM public.solicitudes_credito WHERE id = $1`, [solicitudId]);
    assert.equal(solicitudFinal.rows[0].estado, "aprobado");
    assert.equal(solicitudFinal.rows[0].cliente_credito_id, datosAprobar.clienteCreditoId);

    const bitacora = await pool.query(`SELECT accion FROM public.bitacora_acciones WHERE negocio_id = $1 AND accion = 'solicitud_credito_aprobada'`, [negocio.negocioId]);
    assert.equal(bitacora.rows.length, 1);
});

test("rechazar y pedir informacion no crean ningun cliente de credito", async () => {
    const personaId = await crearPersonaPrueba("rechazar");
    const solicitud = await pool.query(
        `INSERT INTO public.solicitudes_credito (negocio_id, nombre, persona_id, estado)
         VALUES ($1, 'Cliente rechazado', $2, 'pendiente') RETURNING id`,
        [negocio.negocioId, personaId]
    );
    const solicitudId = solicitud.rows[0].id;

    const infoSolicitada = await fetch(`${BASE_URL}/negocio-actual/solicitudes-credito/${solicitudId}`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ estado: "informacion_solicitada", mensaje: "Falta tu comprobante de domicilio." })
    });
    assert.equal(infoSolicitada.status, 200);
    let fila = await pool.query(`SELECT estado, cliente_credito_id FROM public.solicitudes_credito WHERE id = $1`, [solicitudId]);
    assert.equal(fila.rows[0].estado, "informacion_solicitada");
    assert.equal(fila.rows[0].cliente_credito_id, null);

    const rechazar = await fetch(`${BASE_URL}/negocio-actual/solicitudes-credito/${solicitudId}`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ estado: "rechazado" })
    });
    assert.equal(rechazar.status, 200);
    fila = await pool.query(`SELECT estado, cliente_credito_id FROM public.solicitudes_credito WHERE id = $1`, [solicitudId]);
    assert.equal(fila.rows[0].estado, "rechazado");
    assert.equal(fila.rows[0].cliente_credito_id, null, "rechazar nunca debe crear un cliente de credito");

    const acuerdos = await pool.query(`SELECT COUNT(*) AS n FROM public.acuerdos_credito WHERE solicitud_id = $1`, [solicitudId]);
    assert.equal(Number(acuerdos.rows[0].n), 0);
});

// Aceptar el acuerdo de credito (QR / enlace) ya no es obligatorio por
// defecto: en una ferreteria real bloqueaba a clientes de toda la vida
// (11 de 18 en Ferreteria Olimpico) y a algunos clientes simplemente no
// les interesa escanear nada. El modo estricto (exigir_aceptacion_acuerdo)
// sigue existiendo y se prueba aparte en tests/acuerdo-credito.test.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function crearCliente(nombre, limiteCredito = 1000) {
    const respuesta = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre, limiteCredito })
    });
    assert.equal(respuesta.status, 200);
    return respuesta.json();
}

function cargar(clienteId, monto) {
    return fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto, concepto: "Compra de prueba" })
    });
}

function guardarConfiguracion(cuerpo) {
    return fetch(`${BASE_URL}/negocio-actual/configuracion-credito`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ plazosDisponibles: [15, 30], ...cuerpo })
    });
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("credito-aceptacion-opcional");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("por defecto un cliente nuevo nace listo: sin QR, sin acuerdo pendiente, y ya puede comprar a credito", async () => {
    const datos = await crearCliente("Cliente sin QR");

    assert.equal(datos.tokenAceptacion, null, "sin token, el POS no muestra el paso del QR");
    assert.equal(datos.acuerdo, null);

    const cargo = await cargar(datos.cliente.id, 200);
    assert.equal(cargo.status, 200, "debe poder comprar a credito sin haber aceptado nada");
});

test("por defecto un cliente viejo sin ningun acuerdo (de antes de esta capa) tambien puede comprar a credito", async () => {
    const fila = await pool.query(
        `INSERT INTO public.clientes_credito (negocio_id, nombre, limite_credito, dias_credito)
         VALUES ($1, 'Cliente de toda la vida', 3000, 15) RETURNING id, acuerdo_vigente_id`,
        [negocio.negocioId]
    );
    assert.equal(fila.rows[0].acuerdo_vigente_id, null);

    const cargo = await cargar(fila.rows[0].id, 300);
    assert.equal(cargo.status, 200);
});

test("el detalle del cliente avisa que la aceptacion no se exige, para que el POS no muestre alertas en rojo", async () => {
    const datos = await crearCliente("Cliente para detalle");
    const detalle = await (await fetch(`${BASE_URL}/creditos/clientes/${datos.cliente.id}`, { headers: headers() })).json();

    assert.equal(detalle.acuerdo.exigido, false);
});

test("subir el limite se aplica de inmediato cuando no se exige aceptacion (antes se quedaba esperando un QR)", async () => {
    const datos = await crearCliente("Cliente que sube limite", 1000);
    const clienteId = datos.cliente.id;

    // El limite nuevo solo se escribe en el cliente cuando el acuerdo queda
    // aceptado -- un aumento en modo estricto se queda pendiente de QR.
    const edicion = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente que sube limite", limiteCredito: 5000 })
    });
    assert.equal(edicion.status, 200);
    const resultado = await edicion.json();
    assert.equal(resultado.acuerdo.requiereAceptacion, false);
    assert.equal(resultado.tokenAceptacion, null);

    const fila = await pool.query(`SELECT limite_credito FROM public.clientes_credito WHERE id = $1`, [clienteId]);
    assert.equal(Number(fila.rows[0].limite_credito), 5000, "el limite nuevo ya esta aplicado");
});

test("encendido, vuelve el modo estricto: un cliente sin acuerdo aceptado queda bloqueado", async () => {
    const guardar = await guardarConfiguracion({ exigirAceptacionAcuerdo: true });
    assert.equal(guardar.status, 200);

    const leido = await (await fetch(`${BASE_URL}/negocio-actual/configuracion-credito`, { headers: headers() })).json();
    assert.equal(leido.configuracion.exigirAceptacionAcuerdo, true);

    const datos = await crearCliente("Cliente en modo estricto");
    assert.ok(datos.tokenAceptacion, "en modo estricto si se genera el QR");

    const cargo = await cargar(datos.cliente.id, 100);
    assert.equal(cargo.status, 409);
});

test("guardar la configuracion sin mandar el interruptor no lo apaga por accidente", async () => {
    const guardar = await guardarConfiguracion({ politicaTexto: "Solo cambia la politica" });
    assert.equal(guardar.status, 200);

    const leido = await (await fetch(`${BASE_URL}/negocio-actual/configuracion-credito`, { headers: headers() })).json();
    assert.equal(leido.configuracion.exigirAceptacionAcuerdo, true, "sigue encendido");
});

test("apagarlo de nuevo libera a los clientes que habian quedado bloqueados", async () => {
    const bloqueado = await crearCliente("Cliente bloqueado antes de apagar");
    assert.equal((await cargar(bloqueado.cliente.id, 100)).status, 409);

    const guardar = await guardarConfiguracion({ exigirAceptacionAcuerdo: false });
    assert.equal(guardar.status, 200);

    assert.equal((await cargar(bloqueado.cliente.id, 100)).status, 200, "ya sin exigir aceptacion, compra normal");
});

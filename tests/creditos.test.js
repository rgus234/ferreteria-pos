// Corre contra la base de datos real (no hay una de pruebas separada
// en este proyecto) -- todo queda aislado en un negocio sintetico
// propio y se borra al terminar. Ver tests/helpers/negocio-prueba.js.

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
    negocio = await crearNegocioPrueba("creditos");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("cliente con credito: un cargo y un abono dejan el saldo correcto", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente de prueba", telefono: "5550000000", limiteCredito: 1000 })
    });

    const datosCliente = await creado.json();
    assert.equal(creado.status, 200);
    const clienteId = datosCliente.cliente.id;

    const cargo = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 300, concepto: "Compra de prueba" })
    });

    assert.equal(cargo.status, 200);

    const abono = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/abonos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 120, concepto: "Abono de prueba" })
    });

    assert.equal(abono.status, 200);

    const consulta = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}`, {
        headers: headers()
    });

    const datosFinales = await consulta.json();

    assert.equal(consulta.status, 200);
    assert.equal(Number(datosFinales.cliente.saldo), 180, "saldo debe ser 300 de cargo menos 120 de abono");
});

test("un abono con monto invalido se rechaza", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente para monto invalido" })
    });

    const datosCliente = await creado.json();
    const clienteId = datosCliente.cliente.id;

    const abono = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/abonos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 0, concepto: "invalido" })
    });

    assert.equal(abono.status, 400);
});

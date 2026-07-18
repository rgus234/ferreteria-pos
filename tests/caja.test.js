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
    negocio = await crearNegocioPrueba("caja");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("abrir turno, rechazar un segundo turno, y cerrar con el corte correcto", async () => {
    const apertura = await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 500, notas: "" })
    });

    assert.equal(apertura.status, 200);

    const segundaApertura = await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 200 })
    });

    assert.equal(segundaApertura.status, 400, "no debe permitir dos turnos abiertos a la vez");

    const cierre = await fetch(`${BASE_URL}/caja/cerrar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            efectivoContado: 500,
            tarjetaContado: 0,
            transferenciaContado: 0,
            creditoContado: 0,
            notas: "cierre de prueba"
        })
    });

    const datosCierre = await cierre.json();

    assert.equal(cierre.status, 200);
    assert.equal(datosCierre.turno.estado, "cerrado");
    assert.equal(Number(datosCierre.turno.diferencia), 0, "sin ventas de por medio, lo contado debe cuadrar exacto con el fondo inicial");
});

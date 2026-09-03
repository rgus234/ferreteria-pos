// Semaforo de la API de IA.
//
// Existe porque la cuenta se quedo sin saldo, Nexo IA dejo de responder a
// todos los clientes, y no habia forma de enterarse: cada llamada fallaba
// en su propio try/catch y el dueno no veia nada. Se descubrio de
// casualidad.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { clasificarFalloIA, registrarFalloIA, registrarExitoIA } = require("../ia-salud");

function poolFalso() {
    const consultas = [];
    return {
        consultas,
        async query(texto, valores) {
            consultas.push({ texto, valores });
            return { rows: [{ estado: "ok", detalle: "" }] };
        }
    };
}

test("sin saldo se distingue de cualquier otro fallo", () => {
    // Es LA distincion que importa: "el modelo tardo" se arregla solo;
    // "no hay saldo" no se arregla hasta que el dueno vaya a pagar.
    const error = new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error",' +
        '"message":"Your credit balance is too low to access the Anthropic API. ' +
        'Please go to Plans & Billing to upgrade or purchase credits."}}'
    );

    const r = clasificarFalloIA(error);
    assert.equal(r.estado, "sin_saldo");
    assert.match(r.aviso, /recargues/);
    // El aviso lo lee el dueno, no un programador.
    assert.ok(!/API|401|balance/i.test(r.aviso), "el aviso esta en su idioma");
});

test("una llave invalida no se confunde con falta de saldo", () => {
    const error = Object.assign(new Error("authentication_error"), { status: 401 });
    assert.equal(clasificarFalloIA(error).estado, "llave_invalida");
});

test("un limite de peticiones se marca como pasajero", () => {
    const error = Object.assign(new Error("rate limited"), { status: 429 });
    const r = clasificarFalloIA(error);
    assert.equal(r.estado, "limite");
    assert.match(r.aviso, /se resuelve solo|resolverse solo/i);
});

test("un fallo cualquiera NO enciende el semaforo", () => {
    // Si cada timeout pintara una alerta en el panel, el dueno aprenderia
    // a ignorarla y la alerta dejaria de servir para lo que importa.
    assert.equal(clasificarFalloIA(new Error("socket hang up")), null);
    assert.equal(clasificarFalloIA(new Error("no pude parsear la respuesta")), null);
});

test("solo se escribe en la base cuando el fallo significa algo", async () => {
    const pool = poolFalso();

    await registrarFalloIA(pool, new Error("un error cualquiera"), "nexo_ia");
    assert.equal(pool.consultas.length, 0, "un error sin clasificar no toca la base");

    await registrarFalloIA(pool, new Error("Your credit balance is too low"), "nexo_ia");
    assert.equal(pool.consultas.length, 1);
    assert.match(pool.consultas[0].texto, /UPDATE public\.ia_salud/);
    assert.equal(pool.consultas[0].valores[0], "sin_saldo");
    assert.equal(pool.consultas[0].valores[2], "nexo_ia", "queda de donde salio");
});

test("una llamada que sale bien apaga el semaforo sola", async () => {
    // Si el dueno recarga, el panel tiene que reflejarlo sin que nadie
    // toque nada.
    const pool = poolFalso();
    await registrarExitoIA(pool);

    assert.equal(pool.consultas.length, 1);
    assert.match(pool.consultas[0].texto, /estado = 'ok'/);
    assert.match(pool.consultas[0].texto, /estado <> 'ok'/,
        "solo escribe si habia algo encendido, no en cada respuesta");
});

test("si la base falla al registrar, el error original no se pierde", async () => {
    // Avisar de un problema jamas puede causar otro.
    const poolRoto = { query: async () => { throw new Error("base caida"); } };

    const r = await registrarFalloIA(poolRoto, new Error("Your credit balance is too low"), "nexo_ia");
    assert.equal(r.estado, "sin_saldo", "clasifica igual aunque no se pueda guardar");
});

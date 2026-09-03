// Un corte de red no puede tumbar el servidor.
//
// pool.on("error") solo cubre a los clientes INACTIVOS del pool. Un
// cliente tomado con pool.connect() -- que es como corre cada
// transaccion: cobrar una venta, abonar a un credito, recibir mercancia --
// emite sus errores de conexion en si mismo, y sin listener Node mata el
// proceso completo. Un corte de red en el momento equivocado no falla una
// venta: tira el POS de todos los negocios.
//
// Se comprobo matando el socket de un cliente tomado: el proceso se caia.
// Y paso de verdad el 2026-09-02, tumbando una carga de catalogo de dos
// horas y media con "Connection terminated unexpectedly".
//
// Estas pruebas usan un doble de cliente, no la base real: lo que se
// prueba es el enganche del listener, y hacerlo contra Postgres de verdad
// obligaria a cortar conexiones reales en cada corrida.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

// Reproduce lo que hace db.js sobre el pool real.
function envolverConnect(pool) {
    const original = pool.connect.bind(pool);
    pool.connect = async function conectarVigilado(...argumentos) {
        const client = await original(...argumentos);
        if (client && !client.__errorVigilado) {
            client.__errorVigilado = true;
            client.on("error", () => {});
        }
        return client;
    };
    return pool;
}

function poolConClientesFalsos() {
    const entregados = [];
    const pool = {
        async connect() {
            const client = new EventEmitter();
            client.query = async () => ({ rows: [] });
            client.release = () => {};
            entregados.push(client);
            return client;
        }
    };
    return { pool: envolverConnect(pool), entregados };
}

test("un cliente tomado sale con escucha de errores puesta", async () => {
    const { pool } = poolConClientesFalsos();
    const client = await pool.connect();

    assert.equal(client.listenerCount("error"), 1,
        "sin este listener, un corte de red mata el proceso entero");
});

test("emitir un error de conexion NO tumba el proceso", async () => {
    const { pool } = poolConClientesFalsos();
    const client = await pool.connect();

    // Un EventEmitter sin listener de "error" LANZA al emitir. Que esto no
    // lance es exactamente la garantia que se busca.
    assert.doesNotThrow(
        () => client.emit("error", new Error("Connection terminated unexpectedly")),
        "el proceso sobrevive al corte"
    );
});

test("el listener se pone UNA vez por cliente, aunque se reutilice", async () => {
    // Los clientes se reciclan en el pool. Engancharlo en cada checkout
    // los acumula hasta que Node avisa de una fuga de listeners.
    const { pool, entregados } = poolConClientesFalsos();

    const client = await pool.connect();
    // Se simula que el pool devuelve el MISMO cliente otra vez.
    pool.connect = async () => client;
    const otraVez = await envolverConnect(pool).connect();

    assert.equal(otraVez, client);
    assert.equal(client.listenerCount("error"), 1, "no se acumulan");
    assert.equal(entregados.length, 1);
});

test("db.js de verdad envuelve connect()", () => {
    // Que la proteccion viva en db.js y no en cada llamador es lo que hace
    // que cubra las 28 llamadas repartidas en 15 archivos, y las que se
    // agreguen despues.
    const fuente = require("node:fs").readFileSync(
        require("node:path").join(__dirname, "..", "db.js"), "utf8"
    );

    assert.match(fuente, /pool\.connect = async function conectarVigilado/,
        "db.js debe envolver connect()");
    assert.match(fuente, /__errorVigilado/,
        "y marcar al cliente para no volver a engancharlo");
});

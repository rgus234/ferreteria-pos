// Reintentos del adaptador de TRUPER ante un servidor que se hipa.
//
// Se prueba contra un servidor HTTP de verdad levantado aqui mismo, no
// contra un fetch simulado: lo que fallaba era justo la diferencia entre
// "fetch lanza" y "fetch devuelve un 503", y un mock de fetch la habria
// tapado.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { pedir } = require("../fabricantes/truper");

// Levanta un servidor que responde segun un guion: ["503","503","200"].
async function servidorConGuion(guion) {
    let n = 0;
    const peticiones = [];

    const servidor = http.createServer((req, res) => {
        peticiones.push(req.url);
        const paso = guion[Math.min(n, guion.length - 1)];
        n++;
        if (paso.cabeceras) {
            res.writeHead(paso.estado, paso.cabeceras);
        } else {
            res.writeHead(paso.estado);
        }
        res.end(paso.cuerpo || "");
    });

    await new Promise(resolve => servidor.listen(0, "127.0.0.1", resolve));
    const puerto = servidor.address().port;

    return {
        url: `http://127.0.0.1:${puerto}/prueba`,
        peticiones,
        cerrar: () => new Promise(resolve => servidor.close(resolve))
    };
}

test("un 503 pasajero se reintenta en vez de tumbar la corrida", async () => {
    // Caso real: "ficha/fichas respondio 503" mato una carga de dos horas
    // y medía, y el mismo endpoint respondia 200 un minuto despues. El
    // reintento de antes solo cubria errores de red -- un 503 es una
    // respuesta valida, asi que fetch no lanzaba y no se reintentaba nada.
    const s = await servidorConGuion([
        { estado: 503 },
        { estado: 503 },
        { estado: 200, cuerpo: "listo" }
    ]);

    try {
        const respuesta = await pedir(s.url);
        assert.equal(respuesta.status, 200);
        assert.equal(await respuesta.text(), "listo");
        assert.equal(s.peticiones.length, 3, "se intento tres veces");
    } finally {
        await s.cerrar();
    }
});

test("un 404 NO se reintenta: no va a cambiar de opinion", async () => {
    // Gastar tres intentos y seis segundos en un modulo que no existe,
    // multiplicado por miles de modulos, es horas tiradas.
    const s = await servidorConGuion([{ estado: 404 }]);

    try {
        const respuesta = await pedir(s.url);
        assert.equal(respuesta.status, 404);
        assert.equal(s.peticiones.length, 1, "un solo intento");
    } finally {
        await s.cerrar();
    }
});

test("si el servidor pide esperar, se le hace caso", async () => {
    // Un 429 con Retry-After es el servidor diciendo "bajale". Es su
    // catalogo: se respeta en vez de insistir a nuestro propio ritmo.
    const s = await servidorConGuion([
        { estado: 429, cabeceras: { "retry-after": "1" } },
        { estado: 200, cuerpo: "ok" }
    ]);

    try {
        const desde = Date.now();
        const respuesta = await pedir(s.url);
        const tardo = Date.now() - desde;

        assert.equal(respuesta.status, 200);
        assert.ok(tardo >= 950, `espero lo que pidio el servidor (tardo ${tardo}ms)`);
    } finally {
        await s.cerrar();
    }
});

test("si el servidor nunca se recupera, devuelve el ultimo 503 y decide quien llama", async () => {
    // pedir() no convierte un estado malo en excepcion: devuelve la
    // respuesta, igual que con un 404, y cada llamador arma su propio
    // mensaje ("ficha/fichas respondio 503", "pagina X respondio Y"), que
    // dice mucho mas que un error generico desde aqui.
    const s = await servidorConGuion([{ estado: 503 }]);

    try {
        const respuesta = await pedir(s.url);
        assert.equal(respuesta.status, 503);
        assert.equal(s.peticiones.length, 3, "agoto los tres intentos antes de rendirse");
    } finally {
        await s.cerrar();
    }
});

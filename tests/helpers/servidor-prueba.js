// Levanta el servidor real (server.js, no un mock) en un puerto
// dedicado de pruebas, para que las pruebas de los flujos de dinero
// corran contra el stack completo tal como queda desplegado (helmet,
// requerirAccesoNegocio, responderError incluidos).

const { spawn } = require("child_process");
const path = require("path");

const PUERTO_PRUEBA = 3099;
const BASE_URL = `http://localhost:${PUERTO_PRUEBA}`;

let proceso = null;

// 400 x 300ms = 120 segundos.
//
// Eran 80 (24s), luego 200 (60s). Arrancar en limpio tarda ~18, pero
// cualquier cosa que ocupe la base -- otra corrida de pruebas, una carga
// de catalogo, latencia a la nube-- se come el margen, y entonces
// archivos ENTEROS fallan aunque el codigo este bien.
//
// Un timeout generoso no oculta nada: si el servidor de verdad no
// arranca, igual falla, solo que mas tarde y una vez.
const INTENTOS_ARRANQUE = 400;

// Lo ultimo que dijo el servidor antes de morir. Se guarda para poder
// explicar POR QUE no arranco en vez de dar un timeout mudo.
let ultimaSalidaServidor = "";
let murioAlArrancar = null;

async function esperarListo(intentosRestantes = INTENTOS_ARRANQUE) {
    // Si el proceso ya murio, no tiene caso seguir esperando dos minutos:
    // se falla de inmediato Y se dice lo que el servidor alcanzo a
    // escribir. Sin esto, una base inalcanzable se reportaba como "no
    // arranco a tiempo" -- un mensaje que manda a buscar el problema al
    // lugar equivocado. Paso tres veces en un mismo dia: los fallos
    // decian timeout y la causa real era ENOTFOUND contra la base.
    if (murioAlArrancar) {
        throw new Error(
            `El servidor de pruebas murio al arrancar (codigo ${murioAlArrancar}).` +
            (ultimaSalidaServidor ? `\nDijo: ${ultimaSalidaServidor.trim().slice(-500)}` : "")
        );
    }

    try {
        const respuesta = await fetch(`${BASE_URL}/health`);
        if (respuesta.ok) return;
    } catch (error) {
        // el servidor todavia no acepta conexiones, se reintenta abajo
    }

    if (intentosRestantes <= 0) {
        throw new Error(
            "El servidor de pruebas no arranco a tiempo (120s)." +
            (ultimaSalidaServidor ? `\nLo ultimo que dijo: ${ultimaSalidaServidor.trim().slice(-500)}` : "")
        );
    }

    await new Promise(resolve => setTimeout(resolve, 300));
    return esperarListo(intentosRestantes - 1);
}

async function iniciarServidorPrueba() {
    if (proceso) return BASE_URL;

    ultimaSalidaServidor = "";
    murioAlArrancar = null;

    const hijo = spawn(
        process.execPath,
        ["--env-file=.env", "server.js"],
        {
            cwd: path.join(__dirname, "..", ".."),
            env: { ...process.env, PORT: String(PUERTO_PRUEBA) },
            // Antes era "ignore" y la salida del servidor se tiraba a la
            // basura. Cuando no arrancaba, lo unico que quedaba era un
            // "no arranco a tiempo" mudo, y habia que adivinar la causa
            // -- se perdieron horas persiguiendo fantasmas por esto.
            // Ahora se guarda para poder decirla.
            stdio: ["ignore", "pipe", "pipe"]
        }
    );

    const recordar = trozo => {
        ultimaSalidaServidor += String(trozo);
        // Solo interesa el final: un arranque normal escribe bastante.
        if (ultimaSalidaServidor.length > 4000) {
            ultimaSalidaServidor = ultimaSalidaServidor.slice(-4000);
        }
    };

    hijo.stdout.on("data", recordar);
    hijo.stderr.on("data", recordar);

    // Que el proceso muera es una respuesta, no una espera: sin esto se
    // aguantaban los dos minutos completos para decir "timeout" cuando la
    // causa (base inalcanzable, puerto ocupado) ya se sabia al segundo.
    hijo.on("exit", codigo => {
        murioAlArrancar = codigo === null ? "sin codigo" : codigo;
    });

    proceso = hijo;

    try {
        await esperarListo();
    } catch (error) {
        // Si nunca arranco (ej. el puerto ya estaba ocupado por una
        // corrida anterior), no dejar el proceso huerfano -- si no,
        // el siguiente archivo de pruebas tambien falla al intentar
        // usar el mismo puerto.
        hijo.kill();
        proceso = null;
        throw error;
    }

    return BASE_URL;
}

async function detenerServidorPrueba() {
    if (!proceso) return;

    proceso.kill();
    proceso = null;
}

module.exports = {
    BASE_URL,
    iniciarServidorPrueba,
    detenerServidorPrueba
};

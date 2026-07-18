// Levanta el servidor real (server.js, no un mock) en un puerto
// dedicado de pruebas, para que las pruebas de los flujos de dinero
// corran contra el stack completo tal como queda desplegado (helmet,
// requerirAccesoNegocio, responderError incluidos).

const { spawn } = require("child_process");
const path = require("path");

const PUERTO_PRUEBA = 3099;
const BASE_URL = `http://localhost:${PUERTO_PRUEBA}`;

let proceso = null;

async function esperarListo(intentosRestantes = 80) {
    try {
        const respuesta = await fetch(`${BASE_URL}/health`);
        if (respuesta.ok) return;
    } catch (error) {
        // el servidor todavia no acepta conexiones, se reintenta abajo
    }

    if (intentosRestantes <= 0) {
        throw new Error("El servidor de pruebas no arranco a tiempo");
    }

    await new Promise(resolve => setTimeout(resolve, 300));
    return esperarListo(intentosRestantes - 1);
}

async function iniciarServidorPrueba() {
    if (proceso) return BASE_URL;

    const hijo = spawn(
        process.execPath,
        ["--env-file=.env", "server.js"],
        {
            cwd: path.join(__dirname, "..", ".."),
            env: { ...process.env, PORT: String(PUERTO_PRUEBA) },
            stdio: "ignore"
        }
    );

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

// Pone el KEY y el NIP de Taecel en el archivo .env y prueba la conexion consultando el saldo.
//
//   node scripts/configurar-taecel.js
//
// Pide los datos sin mostrarlos en pantalla, los guarda SOLO en .env (que no se sube a GitHub) y jamas los imprime: lo unico que se ve es si la conexion funciono y cuanto
// saldo de tiempo aire hay. Se puede volver a correr cuando cambien las claves (por ejemplo, al pasar de pruebas a produccion).
const fs = require("fs");
const path = require("path");
const { crearCliente, mensajeDeError } = require("../taecel-cliente");

const ARCHIVO = path.join(__dirname, "..", ".env");
const URL_TAECEL = "https://app.taecel.com/api";

let colaLineas = null;

function preguntarOculto(texto) {
    return new Promise(resolver => {
        process.stdout.write(texto);

        if (!process.stdin.isTTY) { // sin terminal interactiva (ej. canalizado): se leen las lineas completas
            if (!colaLineas) {
                colaLineas = new Promise(listo => {
                    let todo = "";
                    process.stdin.setEncoding("utf8");
                    process.stdin.on("data", trozo => { todo += trozo; });
                    process.stdin.on("end", () => listo(todo.split(/\r?\n/)));
                });
            }

            colaLineas.then(lineas => { process.stdout.write("\n"); resolver((lineas.shift() || "").trim()); });
            return;
        }

        let valor = "";
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");

        const alTecla = tecla => {
            for (const caracter of tecla) {
                if (caracter === "\r" || caracter === "\n") {
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdin.removeListener("data", alTecla);
                    process.stdout.write("\n");
                    resolver(valor.trim());
                    return;
                }

                if (caracter === "\u0003") { process.stdout.write("\n"); process.exit(1); } // Ctrl+C
                if (caracter === "\u007f" || caracter === "\b") { valor = valor.slice(0, -1); continue; }
                if (caracter >= " ") valor += caracter;
            }
        };

        process.stdin.on("data", alTecla);
    });
}

function ponerVariable(contenido, nombre, valor) {
    const linea = `${nombre}=${valor}`;
    const patron = new RegExp(`^${nombre}=.*$`, "m");
    return patron.test(contenido) ? contenido.replace(patron, () => linea) : `${contenido.replace(/\s*$/, "")}\n${linea}\n`;
}

(async () => {
    console.log("Configurar Taecel (recargas). Pega los datos y presiona Enter; no se muestran al escribirlos.\n");

    const key = await preguntarOculto("KEY:  ");
    const nip = await preguntarOculto("NIP:  ");

    if (key.length < 20 || nip.length < 4) {
        console.log("\nEso no parece un KEY y un NIP validos (el KEY trae unos 30 a 35 caracteres). No se guardo nada.");
        process.exit(1);
    }

    const cliente = crearCliente({ url: URL_TAECEL, key, nip });
    const saldo = await cliente.getBalance();

    if (!saldo.ok) {
        console.log(`\nTaecel no aceptó esas claves: ${mensajeDeError(saldo.error, saldo.mensaje)} (código ${saldo.error}). No se guardó nada.`);
        process.exit(1);
    }

    let contenido = fs.existsSync(ARCHIVO) ? fs.readFileSync(ARCHIVO, "utf8") : "";
    const fin = contenido.includes("\r\n") ? "\r\n" : "\n";
    contenido = contenido.replace(/\r\n/g, "\n");

    for (const [nombre, valor] of [["TAECEL_URL", URL_TAECEL], ["TAECEL_KEY", key], ["TAECEL_NIP", nip]]) contenido = ponerVariable(contenido, nombre, valor);
    if (!/^TAECEL_NEGOCIOS=/m.test(contenido)) contenido = ponerVariable(contenido, "TAECEL_NEGOCIOS", "29637");
    if (!/^TAECEL_MODO=/m.test(contenido)) contenido = ponerVariable(contenido, "TAECEL_MODO", "pruebas");

    fs.writeFileSync(ARCHIVO, fin === "\r\n" ? contenido.replace(/\n/g, "\r\n") : contenido);

    const bolsas = Array.isArray(saldo.data) ? saldo.data : [];
    const tiempoAire = bolsas.find(b => String(b.Bolsa || "").toLowerCase().includes("tiempo"));

    console.log("\n✔ Conexión con Taecel correcta.");
    console.log(`  Saldo de tiempo aire: $${tiempoAire ? tiempoAire.Saldo : "(no se pudo leer)"}`);
    console.log("  Las claves quedaron guardadas en .env (solo en esta computadora).");
    console.log("\nSiguiente: reinicia el servidor de Nexo para que las tome.");
})().catch(error => { console.log("\nNo se pudo probar la conexión:", error.message); process.exit(1); });

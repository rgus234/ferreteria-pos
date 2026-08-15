// Sube todos los zips de Truper (paginas 124 a 625, ya descargados en
// D:\Descargas-Truper y en la carpeta de Descargas original) al Banco de
// imagenes (Banco de Nexo) via POST /admin/api/banco-imagenes/importar-lote.
//
// Levanta su propio servidor local (server.js) con el entorno ya cargado,
// sube en lotes, y lo apaga al terminar. Es resumible: si se interrumpe,
// vuelve a correr el mismo comando y se salta los lotes ya subidos.
//
// Uso: node --env-file=.env scripts/subir-banco-truper.js

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { config } = require("../config");

const RAIZ = path.join(__dirname, "..");
const CARPETAS = [
    "D:\\Descargas-Truper",
    "C:\\Users\\gusta\\Downloads",
];
const PAGINA_MIN = 124;
const PAGINA_MAX = 625;
const MAX_ARCHIVOS_POR_LOTE = 15;
const MAX_BYTES_POR_LOTE = 700 * 1024 * 1024;
const ARCHIVO_LOG = path.join(RAIZ, "banco-imagenes-subida-progreso.log");
const ARCHIVO_CHECKPOINT = path.join(RAIZ, "banco-imagenes-subida-checkpoint.json");
const URL_IMPORTAR = `http://localhost:${config.port}/admin/api/banco-imagenes/importar-lote`;

function log(linea) {
    const marca = new Date().toTimeString().slice(0, 8);
    fs.appendFileSync(ARCHIVO_LOG, `${marca} ${linea}\n`);
    console.log(linea);
}

function cargarCheckpoint() {
    if (!fs.existsSync(ARCHIVO_CHECKPOINT)) return new Set();
    try {
        return new Set(JSON.parse(fs.readFileSync(ARCHIVO_CHECKPOINT, "utf8")));
    } catch {
        return new Set();
    }
}

function guardarCheckpoint(hechos) {
    fs.writeFileSync(ARCHIVO_CHECKPOINT, JSON.stringify([...hechos]));
}

function parsearRango(nombreArchivo) {
    const base = nombreArchivo.replace(/\.zip$/i, "");
    const m = base.match(/^(\d+)(?:-(\d+))?/);
    if (!m) return null;
    const inicio = Number(m[1]);
    const fin = m[2] ? Number(m[2]) : inicio;
    return { inicio, fin };
}

function listarZipsEnRango() {
    const vistos = new Set();
    const archivos = [];
    for (const carpeta of CARPETAS) {
        if (!fs.existsSync(carpeta)) continue;
        for (const nombre of fs.readdirSync(carpeta)) {
            if (!/\.zip$/i.test(nombre)) continue;
            const rango = parsearRango(nombre);
            if (!rango) continue;
            if (rango.fin < PAGINA_MIN || rango.inicio > PAGINA_MAX) continue;
            if (vistos.has(nombre)) continue;
            vistos.add(nombre);
            const ruta = path.join(carpeta, nombre);
            const tam = fs.statSync(ruta).size;
            archivos.push({ nombre, ruta, tam, inicio: rango.inicio });
        }
    }
    archivos.sort((a, b) => a.inicio - b.inicio);
    return archivos;
}

function armarLotes(archivos) {
    const lotes = [];
    let actual = [];
    let bytesActual = 0;
    for (const archivo of archivos) {
        const excedeCount = actual.length >= MAX_ARCHIVOS_POR_LOTE;
        const excedeBytes = bytesActual + archivo.tam > MAX_BYTES_POR_LOTE && actual.length > 0;
        if (excedeCount || excedeBytes) {
            lotes.push(actual);
            actual = [];
            bytesActual = 0;
        }
        actual.push(archivo);
        bytesActual += archivo.tam;
    }
    if (actual.length) lotes.push(actual);
    return lotes;
}

function claveLote(lote) {
    return lote.map(a => a.nombre).sort().join("|");
}

async function subirLote(lote, indice, total) {
    const form = new FormData();
    form.append("marca", "Truper");
    for (const archivo of lote) {
        const buffer = fs.readFileSync(archivo.ruta);
        form.append("zips", new Blob([buffer]), archivo.nombre);
    }

    const respuesta = await fetch(URL_IMPORTAR, {
        method: "POST",
        headers: { "x-admin-key": process.env.ADMIN_KEY || "" },
        body: form,
    });

    const texto = await respuesta.text();
    let datos;
    try {
        datos = JSON.parse(texto);
    } catch {
        datos = { ok: false, error: texto.slice(0, 300) };
    }

    if (!respuesta.ok || !datos.ok) {
        log(`LOTE ${indice}/${total} FALLO (${lote.map(a => a.nombre).join(",")}): HTTP ${respuesta.status} ${datos.error || ""}`);
        return false;
    }

    log(`LOTE ${indice}/${total} OK archivos=${lote.length} zipsProcesados=${datos.zipsProcesados} fotosGuardadas=${datos.fotosGuardadas} solicitudesResueltas=${datos.solicitudesResueltas} errores=${datos.errores.length}`);
    for (const e of datos.errores || []) log(`  error: ${e}`);
    return true;
}

function esperarServidorListo(intentosMax = 60) {
    return new Promise((resolve, reject) => {
        let intentos = 0;
        const intentar = () => {
            intentos += 1;
            fetch(`http://localhost:${config.port}/`)
                .then(() => resolve())
                .catch(() => {
                    if (intentos >= intentosMax) reject(new Error("El servidor local no respondio a tiempo"));
                    else setTimeout(intentar, 1000);
                });
        };
        intentar();
    });
}

async function main() {
    if (!process.env.ADMIN_KEY) {
        console.error("Falta ADMIN_KEY en el entorno. Corre con: node --env-file=.env scripts/subir-banco-truper.js");
        process.exit(1);
    }

    const archivos = listarZipsEnRango();
    const lotes = armarLotes(archivos);
    const totalBytes = archivos.reduce((s, a) => s + a.tam, 0);
    const hechos = cargarCheckpoint();

    log(`Iniciando subida: ${archivos.length} archivos (paginas ${PAGINA_MIN}-${PAGINA_MAX}), ${(totalBytes / 1e9).toFixed(1)}GB, ${lotes.length} lotes, ${hechos.size} ya subidos antes`);

    console.log("Levantando servidor local (server.js)...");
    const hijo = spawn(process.execPath, ["server.js"], {
        cwd: RAIZ,
        env: process.env,
        stdio: "inherit",
    });

    try {
        await esperarServidorListo();
        console.log("Servidor listo. Subiendo lotes...");

        let ok = 0, fail = 0, saltados = 0;
        for (let i = 0; i < lotes.length; i++) {
            const lote = lotes[i];
            const clave = claveLote(lote);
            if (hechos.has(clave)) {
                saltados += 1;
                continue;
            }
            const exito = await subirLote(lote, i + 1, lotes.length);
            if (exito) {
                ok += 1;
                hechos.add(clave);
                guardarCheckpoint(hechos);
            } else {
                fail += 1;
            }
        }

        log(`TERMINADO. lotes_ok=${ok} lotes_fallo=${fail} lotes_saltados=${saltados}`);
    } finally {
        hijo.kill();
    }
}

main().catch(error => {
    log(`ERROR FATAL: ${error.message}`);
    process.exit(1);
});

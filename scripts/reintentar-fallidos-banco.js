// Reintenta, uno a la vez, un puñado de zips que fallaron al subirse al
// Banco de Nexo desde el panel de Admin (502 / error de conexion por
// exceder el tiempo de espera del proxy con lotes grandes). Sube directo
// a produccion, sin levantar servidor local.
//
// Uso: node --env-file=.env scripts/reintentar-fallidos-banco.js archivo1.zip archivo2.zip ...

const fs = require("fs");
const path = require("path");

const CARPETAS = ["D:\\Descargas-Truper", "C:\\Users\\gusta\\Downloads"];
const URL_IMPORTAR = "https://nexoposoficial.com/admin/api/banco-imagenes/importar-lote";
const NOMBRES = process.argv.slice(2);

function encontrar(nombre) {
    for (const carpeta of CARPETAS) {
        const ruta = path.join(carpeta, nombre);
        if (fs.existsSync(ruta)) return ruta;
    }
    return null;
}

async function subirUno(nombre, intento = 1) {
    const ruta = encontrar(nombre);
    if (!ruta) {
        console.log(`${nombre}: NO ENCONTRADO`);
        return;
    }

    const buffer = fs.readFileSync(ruta);
    const form = new FormData();
    form.append("marca", "Truper");
    form.append("zips", new Blob([buffer]), nombre);

    try {
        const respuesta = await fetch(URL_IMPORTAR, {
            method: "POST",
            headers: { "x-admin-key": process.env.ADMIN_KEY || "" },
            body: form,
        });
        const texto = await respuesta.text();
        let datos;
        try { datos = JSON.parse(texto); } catch { datos = { ok: false, error: texto.slice(0, 200) }; }

        if (!respuesta.ok || !datos.ok) {
            if (intento < 3) {
                console.log(`${nombre}: intento ${intento} fallo (HTTP ${respuesta.status}), reintentando...`);
                await new Promise(r => setTimeout(r, 5000));
                return subirUno(nombre, intento + 1);
            }
            console.log(`${nombre}: FALLO definitivo tras ${intento} intentos - HTTP ${respuesta.status} ${datos.error || ""}`);
            return;
        }

        console.log(`${nombre}: OK fotosGuardadas=${datos.fotosGuardadas} solicitudesResueltas=${datos.solicitudesResueltas} errores=${datos.errores.length}`);
    } catch (error) {
        if (intento < 3) {
            console.log(`${nombre}: intento ${intento} excepcion (${error.message}), reintentando...`);
            await new Promise(r => setTimeout(r, 5000));
            return subirUno(nombre, intento + 1);
        }
        console.log(`${nombre}: FALLO definitivo tras ${intento} intentos - ${error.message}`);
    }
}

async function main() {
    if (!process.env.ADMIN_KEY) {
        console.error("Falta ADMIN_KEY. Corre con: node --env-file=.env scripts/reintentar-fallidos-banco.js archivo.zip ...");
        process.exit(1);
    }
    for (const nombre of NOMBRES) {
        await subirUno(nombre);
    }
}

main();

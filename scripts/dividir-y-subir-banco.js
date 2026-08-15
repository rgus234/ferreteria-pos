// Para zips que dan 502 en /admin/api/banco-imagenes/importar-lote por
// tener demasiadas fotos (el servidor las comprime una por una de forma
// sincrona y el proxy de produccion corta la conexion antes de terminar):
// parte el zip en trozos de N carpetas de producto y sube cada trozo por
// separado.
//
// Uso: node --env-file=.env scripts/dividir-y-subir-banco.js archivo.zip [carpetasPorTrozo]

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const CARPETAS_ORIGEN = ["D:\\Descargas-Truper", "C:\\Users\\gusta\\Downloads"];
const URL_IMPORTAR = "https://nexoposoficial.com/admin/api/banco-imagenes/importar-lote";
const NOMBRE_ZIP = process.argv[2];
const CARPETAS_POR_TROZO = Number(process.argv[3] || 15);

function encontrar(nombre) {
    for (const carpeta of CARPETAS_ORIGEN) {
        const ruta = path.join(carpeta, nombre);
        if (fs.existsSync(ruta)) return ruta;
    }
    return null;
}

function agruparPorCarpeta(zip) {
    const carpetas = new Map();
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const partes = entry.entryName.split("/").filter(Boolean);
        if (partes.length < 2) continue;
        const carpeta = partes[0];
        if (!carpetas.has(carpeta)) carpetas.set(carpeta, []);
        carpetas.get(carpeta).push(entry);
    }
    return carpetas;
}

function armarSubZip(carpetasSubset) {
    const zipNuevo = new AdmZip();
    for (const [carpeta, entradas] of carpetasSubset) {
        for (const entry of entradas) {
            zipNuevo.addFile(entry.entryName, entry.getData());
        }
    }
    return zipNuevo.toBuffer();
}

async function subirBuffer(buffer, nombre, intento = 1) {
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
                await new Promise(r => setTimeout(r, 4000));
                return subirBuffer(buffer, nombre, intento + 1);
            }
            console.log(`${nombre}: FALLO definitivo - HTTP ${respuesta.status} ${datos.error || ""}`);
            return false;
        }

        console.log(`${nombre}: OK fotosGuardadas=${datos.fotosGuardadas} solicitudesResueltas=${datos.solicitudesResueltas} errores=${datos.errores.length}`);
        return true;
    } catch (error) {
        if (intento < 3) {
            console.log(`${nombre}: intento ${intento} excepcion (${error.message}), reintentando...`);
            await new Promise(r => setTimeout(r, 4000));
            return subirBuffer(buffer, nombre, intento + 1);
        }
        console.log(`${nombre}: FALLO definitivo - ${error.message}`);
        return false;
    }
}

async function main() {
    if (!process.env.ADMIN_KEY) {
        console.error("Falta ADMIN_KEY. Corre con: node --env-file=.env scripts/dividir-y-subir-banco.js archivo.zip");
        process.exit(1);
    }
    if (!NOMBRE_ZIP) {
        console.error("Uso: node --env-file=.env scripts/dividir-y-subir-banco.js archivo.zip [carpetasPorTrozo]");
        process.exit(1);
    }

    const ruta = encontrar(NOMBRE_ZIP);
    if (!ruta) {
        console.error(`No se encontro ${NOMBRE_ZIP}`);
        process.exit(1);
    }

    const zip = new AdmZip(ruta);
    const carpetas = [...agruparPorCarpeta(zip).entries()];
    console.log(`${NOMBRE_ZIP}: ${carpetas.length} carpetas de producto, dividiendo en trozos de ${CARPETAS_POR_TROZO}`);

    let ok = 0, fail = 0;
    for (let i = 0; i < carpetas.length; i += CARPETAS_POR_TROZO) {
        const subset = carpetas.slice(i, i + CARPETAS_POR_TROZO);
        const buffer = armarSubZip(subset);
        const nombreTrozo = `${NOMBRE_ZIP.replace(/\.zip$/i, "")}-trozo${Math.floor(i / CARPETAS_POR_TROZO) + 1}.zip`;
        const exito = await subirBuffer(buffer, nombreTrozo);
        if (exito) ok += 1; else fail += 1;
    }

    console.log(`TERMINADO ${NOMBRE_ZIP}: trozos_ok=${ok} trozos_fallo=${fail}`);
}

main();

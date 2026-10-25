// Pasa los codigos que capturaste con "Capturar codigos" (tabla privada capturas_codigos) al catalogo maestro.
//  - Codigo nuevo: se agrega (origen "negocio", fuente_identidad "captura_propietario").
//  - Codigo que ya estaba (casi siempre de Open Food Facts): se reemplaza SOLO el nombre por el tuyo; foto, marca,
//    categoria y demas se conservan. El nombre anterior se guarda en el respaldo para poder deshacerlo.
//  - Si el codigo ya tiene origen "fabricante" (catalogo oficial) NO se toca: ese nombre es el del fabricante.
// Sin banderas solo muestra lo que haria. Con --aplicar escribe y deja un respaldo en tmp/respaldo-capturas-<fecha>.json.
//   node --env-file=.env scripts/importar-capturas-al-maestro.js            (simulacion)
//   node --env-file=.env scripts/importar-capturas-al-maestro.js --aplicar
//   node --env-file=.env scripts/importar-capturas-al-maestro.js --deshacer tmp/respaldo-capturas-XXXX.json

const fs = require("fs");
const path = require("path");
const pool = require("../db");

const FUENTE = "captura_propietario";

async function deshacer(archivo) {
    const respaldo = JSON.parse(fs.readFileSync(archivo, "utf8"));
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const nuevo of respaldo.agregados) await client.query("DELETE FROM public.catalogo_maestro_productos WHERE codigo = $1 AND fuente_identidad = $2", [nuevo, FUENTE]);

        for (const previo of respaldo.actualizados) {
            await client.query(
                `UPDATE public.catalogo_maestro_productos SET nombre = $2, fuente_identidad = $3, fuente_fecha = $4, updated_at = NOW() WHERE codigo = $1`,
                [previo.codigo, previo.nombre, previo.fuente_identidad, previo.fuente_fecha]
            );
        }

        await client.query("COMMIT");
        console.log(`Deshecho: ${respaldo.agregados.length} quitados y ${respaldo.actualizados.length} nombres restaurados.`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function importar(aplicar) {
    const capturas = (await pool.query("SELECT codigo, nombre FROM public.capturas_codigos ORDER BY id")).rows;
    const existentes = new Map((await pool.query(
        "SELECT codigo, nombre, origen, fuente_identidad, fuente_fecha FROM public.catalogo_maestro_productos WHERE codigo = ANY($1)",
        [capturas.map(c => c.codigo)]
    )).rows.map(f => [f.codigo, f]));

    const nuevos = [], renombrar = [], iguales = [], protegidos = [];

    for (const c of capturas) {
        const nombre = c.nombre.replace(/\s+/g, " ").trim();
        const actual = existentes.get(c.codigo);

        if (!actual) nuevos.push({ codigo: c.codigo, nombre });
        else if (actual.origen === "fabricante") protegidos.push({ codigo: c.codigo, tuyo: nombre, fabricante: actual.nombre });
        else if (actual.nombre === nombre) iguales.push(c.codigo);
        else renombrar.push({ codigo: c.codigo, nombre, actual });
    }

    console.log(`Capturas: ${capturas.length} | nuevos: ${nuevos.length} | nombres a reemplazar: ${renombrar.length} | ya iguales: ${iguales.length} | del fabricante (no se tocan): ${protegidos.length}`);

    if (!aplicar) { console.log("Simulacion: no se escribio nada. Usa --aplicar."); return; }

    const respaldo = { fecha: new Date().toISOString(), agregados: nuevos.map(n => n.codigo), actualizados: renombrar.map(r => ({ codigo: r.codigo, nombre: r.actual.nombre, fuente_identidad: r.actual.fuente_identidad, fuente_fecha: r.actual.fuente_fecha })) };
    const archivo = path.join(__dirname, "..", "tmp", `respaldo-capturas-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 1));

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const n of nuevos) {
            await client.query(
                `INSERT INTO public.catalogo_maestro_productos (codigo, ean, nombre, origen, fuente_identidad, fuente_fecha)
                 VALUES ($1, $1, $2, 'negocio', $3, NOW())
                 ON CONFLICT (codigo) DO NOTHING`,
                [n.codigo, n.nombre, FUENTE]
            );
        }

        for (const r of renombrar) {
            await client.query(
                `UPDATE public.catalogo_maestro_productos SET nombre = $2, fuente_identidad = $3, fuente_fecha = NOW(), updated_at = NOW() WHERE codigo = $1 AND origen <> 'fabricante'`,
                [r.codigo, r.nombre, FUENTE]
            );
        }

        await client.query("COMMIT");
        console.log(`Listo. Respaldo para deshacer: ${archivo}`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

(async () => {
    const argumentos = process.argv.slice(2);
    const i = argumentos.indexOf("--deshacer");

    try {
        if (i >= 0) await deshacer(argumentos[i + 1]);
        else await importar(argumentos.includes("--aplicar"));
    } finally {
        await pool.end();
    }
})().catch(error => { console.error(error); process.exit(1); });

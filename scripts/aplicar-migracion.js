// Aplica un archivo de migracion a la base a la que apunta .env.
//
//   node --env-file=.env scripts/aplicar-migracion.js migrations/ARCHIVO.sql
//   node --env-file=.env scripts/aplicar-migracion.js migrations/ARCHIVO.sql --simular
//
// Las migraciones de este proyecto se aplican a mano, una por una. Este
// script existe para que eso no sea "pega el SQL donde puedas": avisa a
// que base va a escribir ANTES de tocarla, corre todo dentro de una
// transaccion, y con --simular ensena el efecto y hace ROLLBACK.
//
// Ojo: el .env de esta maquina apunta a PRODUCCION. Por eso lo primero
// que imprime es el host, y por eso conviene correr --simular antes.

const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { config } = require("../config");

function hostDeLaBase() {
    // Solo para MOSTRAR a donde va. Nunca se imprime la contrasena.
    try {
        const u = new URL(config.databaseUrl);
        return `${u.hostname}${u.pathname}`;
    } catch {
        return "(no se pudo leer DATABASE_URL)";
    }
}

async function main() {
    const archivo = process.argv[2];
    const simular = process.argv.includes("--simular");

    if (!archivo) {
        console.error("Falta el archivo. Ejemplo:");
        console.error("  node --env-file=.env scripts/aplicar-migracion.js migrations/ARCHIVO.sql");
        process.exitCode = 1;
        return;
    }

    const ruta = path.resolve(archivo);
    if (!fs.existsSync(ruta)) {
        console.error(`No existe: ${ruta}`);
        process.exitCode = 1;
        return;
    }

    const sql = fs.readFileSync(ruta, "utf8");

    console.log(`Base:      ${hostDeLaBase()}`);
    console.log(`Migracion: ${path.basename(ruta)}`);
    console.log(simular ? "Modo:      SIMULAR (no guarda nada)\n" : "Modo:      APLICAR DE VERDAD\n");

    const antes = await pool.query(
        "SELECT nivel_precio_por_defecto n, count(*)::int c FROM public.negocios GROUP BY 1 ORDER BY 1");
    console.log("Negocios por nivel ANTES:");
    for (const f of antes.rows) console.log(`  ${f.n}: ${f.c}`);

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(sql);

        const despues = await client.query(
            "SELECT nivel_precio_por_defecto n, count(*)::int c FROM public.negocios GROUP BY 1 ORDER BY 1");
        console.log("\nNegocios por nivel DESPUES:");
        for (const f of despues.rows) console.log(`  ${f.n}: ${f.c}`);

        if (simular) {
            await client.query("ROLLBACK");
            console.log("\n--simular: se deshizo todo. No se guardo nada.");
        } else {
            await client.query("COMMIT");
            console.log("\nAplicada.");
        }
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("\nFallo y se deshizo todo. Nada quedo a medias.");
        throw error;
    } finally {
        client.release();
    }
}

main()
    .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => { await pool.end(); });

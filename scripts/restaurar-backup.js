// Restauracion manual de un respaldo generado por backup-server.js.
// NUNCA se corre automaticamente -- es una operacion destructiva
// (sobrescribe tablas existentes) pensada para desastre real o para
// probar que el mecanismo de respaldo de verdad funciona.
//
// Uso:
//   node --env-file=.env scripts/restaurar-backup.js ruta/al/respaldo.json.gz
//
// Pensado para correr DESPUES de `npm run migrate` contra una base ya
// con el esquema al dia -- este script solo restaura data, no
// estructura (el esquema vive versionado en migrations/*.sql).

const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");
const pool = require("../db");

// Por defecto restaura contra el esquema "public" (produccion real).
// Se puede apuntar a otro esquema (ej. una copia de estructura
// aislada para probar el mecanismo sin tocar datos reales) con
// RESPALDO_SCHEMA_DESTINO -- nunca cambia el comportamiento default.
const ESQUEMA_DESTINO = process.env.RESPALDO_SCHEMA_DESTINO || "public";

function preguntar(texto) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(texto, respuesta => {
            rl.close();
            resolve(respuesta.trim().toLowerCase());
        });
    });
}

// Reversa de serializadorBytea en backup-server.js -- reconstruye un
// Buffer real a partir de {$bytea: "<base64>"} para columnas bytea.
function revividorBytea(_clave, valor) {
    if (valor && typeof valor === "object" && typeof valor.$bytea === "string") {
        return Buffer.from(valor.$bytea, "base64");
    }
    return valor;
}

function loteDe(arreglo, tamano) {
    const lotes = [];
    for (let i = 0; i < arreglo.length; i += tamano) {
        lotes.push(arreglo.slice(i, i + tamano));
    }
    return lotes;
}

// El driver pg serializa arreglos JS como arreglos nativos de
// Postgres ({a,b,c}), no como JSON -- rompe las columnas jsonb cuyo
// valor es un arreglo (ej. historial_ventas.productos). No hay
// columnas de tipo ARRAY nativo en este esquema (confirmado), asi que
// es seguro convertir cualquier arreglo/objeto (que no sea Buffer) a
// texto JSON explicitamente antes de insertar.
function prepararValor(valor) {
    if (valor === null || valor === undefined) return null;
    if (Buffer.isBuffer(valor)) return valor;
    if (typeof valor === "object") return JSON.stringify(valor);
    return valor;
}

async function restaurarTabla(client, tabla, filas) {
    await client.query(`TRUNCATE TABLE ${ESQUEMA_DESTINO}.${tabla} CASCADE`);

    if (filas.length === 0) {
        console.log(`  ${tabla}: sin filas, tabla vaciada`);
        return;
    }

    const columnas = Object.keys(filas[0]);
    const listaColumnas = columnas.map(c => `"${c}"`).join(", ");

    for (const lote of loteDe(filas, 500)) {
        const valores = [];
        const grupos = lote.map((fila, indiceFila) => {
            const marcadores = columnas.map((_col, indiceCol) => {
                valores.push(prepararValor(fila[columnas[indiceCol]]));
                return `$${indiceFila * columnas.length + indiceCol + 1}`;
            });
            return `(${marcadores.join(", ")})`;
        });

        await client.query(
            `INSERT INTO ${ESQUEMA_DESTINO}.${tabla} (${listaColumnas}) VALUES ${grupos.join(", ")}`,
            valores
        );
    }

    console.log(`  ${tabla}: ${filas.length} fila(s) restauradas`);
}

async function main() {
    const rutaArchivo = process.argv[2];

    if (!rutaArchivo) {
        console.error("Uso: node scripts/restaurar-backup.js ruta/al/respaldo.json.gz");
        process.exit(1);
    }

    if (!fs.existsSync(rutaArchivo)) {
        console.error(`No se encontro el archivo: ${rutaArchivo}`);
        process.exit(1);
    }

    console.log("");
    console.log("ADVERTENCIA: esto va a VACIAR y REESCRIBIR todas las tablas del");
    console.log(`respaldo con los datos de ${rutaArchivo}, contra el esquema`);
    console.log(`"${ESQUEMA_DESTINO}" de la base configurada en DATABASE_URL.`);
    console.log("Esta accion no se puede deshacer.");
    console.log("");

    const respuesta = await preguntar('Escribe "restaurar" para continuar: ');

    if (respuesta !== "restaurar") {
        console.log("Cancelado -- no se modifico nada.");
        process.exit(0);
    }

    const comprimido = fs.readFileSync(rutaArchivo);
    const dump = JSON.parse(zlib.gunzipSync(comprimido).toString("utf8"), revividorBytea);
    const tablas = Object.keys(dump);

    console.log(`\nRestaurando ${tablas.length} tabla(s)...`);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Desactiva los triggers de llave foranea de cada tabla antes
        // de insertar nada -- asi no importa el orden de dependencias
        // entre las 44 tablas. Requiere ser dueno de la tabla (no
        // superusuario), a diferencia de SET session_replication_role
        // que Render no permite en su Postgres administrado.
        for (const tabla of tablas) {
            await client.query(`ALTER TABLE ${ESQUEMA_DESTINO}.${tabla} DISABLE TRIGGER ALL`);
        }

        for (const tabla of tablas) {
            await restaurarTabla(client, tabla, dump[tabla]);
        }

        for (const tabla of tablas) {
            await client.query(`ALTER TABLE ${ESQUEMA_DESTINO}.${tabla} ENABLE TRIGGER ALL`);
        }

        await client.query("COMMIT");

        console.log("\nRestauracion completada.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("\nError durante la restauracion -- se revirtio todo:");
        console.error(error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error("Error inesperado:", error);
    process.exit(1);
});

const fs = require("fs/promises");
const path = require("path");
const pool = require("../db");

const migrationsDir = path.join(__dirname, "..", "migrations");

async function asegurarTablaMigraciones(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function leerMigracionesAplicadas(client) {
    const resultado = await client.query(
        "SELECT id FROM public.schema_migrations ORDER BY id ASC"
    );

    return new Set(resultado.rows.map(row => row.id));
}

async function leerArchivosMigracion() {
    const archivos = await fs.readdir(migrationsDir).catch(() => []);

    return archivos
        .filter(archivo => archivo.endsWith(".sql"))
        .sort();
}

async function aplicarMigracion(client, archivo) {
    const id = archivo.replace(/\.sql$/, "");
    const ruta = path.join(migrationsDir, archivo);
    const sql = await fs.readFile(ruta, "utf8");

    console.log(`Aplicando migracion ${id}`);

    await client.query("BEGIN");
    try {
        await client.query(sql);
        await client.query(
            "INSERT INTO public.schema_migrations (id) VALUES ($1)",
            [id]
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function main() {
    const client = await pool.connect();

    try {
        await asegurarTablaMigraciones(client);

        const aplicadas = await leerMigracionesAplicadas(client);
        const archivos = await leerArchivosMigracion();
        const pendientes = archivos.filter(
            archivo => !aplicadas.has(archivo.replace(/\.sql$/, ""))
        );

        if (pendientes.length === 0) {
            console.log("No hay migraciones pendientes");
            return;
        }

        for (const archivo of pendientes) {
            await aplicarMigracion(client, archivo);
        }

        console.log("Migraciones aplicadas correctamente");
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error("Error aplicando migraciones:");
    console.error(error);
    process.exit(1);
});

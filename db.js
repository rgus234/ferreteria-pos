const { Pool } = require("pg");
const { config } = require("./config");

const databaseUrl = config.databaseUrl || "";
const databaseUrlLower = databaseUrl.toLowerCase();
const pgSslMode = (config.pgSslMode || "").toLowerCase();

const usaSsl =
    databaseUrlLower.includes("sslmode=require") ||
    databaseUrlLower.includes("sslmode=verify") ||
    (
        pgSslMode === "require" &&
        databaseUrlLower.includes(".render.com")
    );

const pool = new Pool({
    connectionString: databaseUrl,
    application_name: `${config.appName}-${config.appEnv}`,
    ssl: usaSsl
        ? {
            rejectUnauthorized: false,
        }
        : false,
});

// Sin este listener, un error en un cliente inactivo del pool (por
// ejemplo el proveedor cerrando la conexion, "Connection terminated
// unexpectedly") se propaga como excepcion no capturada y tumba todo
// el proceso -- asi lo documenta node-postgres. Con el listener, el
// pool simplemente descarta ese cliente y sigue funcionando con el
// resto de las conexiones.
pool.on("error", error => {
    console.error("Error inesperado en un cliente inactivo del pool de Postgres:", error);
});

module.exports = pool;

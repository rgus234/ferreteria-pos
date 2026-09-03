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

// Y el listener de arriba SOLO cubre a los clientes inactivos.
//
// Un cliente tomado con pool.connect() -- que es como corre cada
// transaccion: cobrar una venta, abonar a un credito, recibir mercancia --
// emite sus errores de conexion en SI MISMO. Si nadie escucha, Node tumba
// el proceso completo con "Unhandled 'error' event". O sea: un corte de
// red en el momento equivocado no falla una venta, tira el servidor de
// TODOS los negocios.
//
// Comprobado, no deducido: matando el socket de un cliente tomado, el
// proceso se cae. Y paso de verdad el 2026-09-02, tumbando una carga de
// catalogo de dos horas y media ("Connection terminated unexpectedly").
//
// Se envuelve connect() en vez de tocar las 28 llamadas repartidas en 15
// archivos: asi queda cubierto todo lo que existe y lo que se agregue
// despues, sin que nadie tenga que acordarse.
//
// La consulta que estuviera en vuelo SIGUE fallando por su propio camino
// -- la promesa se rechaza igual -- asi que cada llamador se entera y
// hace su ROLLBACK. Lo unico que cambia es que el proceso no muere.
const connectOriginal = pool.connect.bind(pool);

pool.connect = async function conectarVigilado(...argumentos) {
    const client = await connectOriginal(...argumentos);

    // Los clientes se reciclan, asi que el listener se pone UNA vez por
    // cliente: volver a engancharlo en cada checkout los acumula hasta
    // que Node avisa de una fuga de listeners.
    if (client && !client.__errorVigilado) {
        client.__errorVigilado = true;
        client.on("error", error => {
            console.error("Se corto la conexion de un cliente en uso de Postgres:", error.message);
        });
    }

    return client;
};

module.exports = pool;

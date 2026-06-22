const { config, validarConfigProduccion } = require("../config");

function ocultarConexion(url) {
    if (!url) return "";

    return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

try {
    validarConfigProduccion();

    const faltantes = [];

    if (!config.databaseUrl) {
        faltantes.push("DATABASE_URL");
    }

    if (faltantes.length > 0) {
        console.log(`Configuracion incompleta: ${faltantes.join(", ")}`);
        process.exitCode = 1;
    } else {
        console.log("Configuracion OK");
    }

    console.log(`App: ${config.appName}`);
    console.log(`Ambiente: ${config.appEnv}`);
    console.log(`Version: ${config.appVersion}`);
    console.log(`Puerto: ${config.port}`);
    console.log(`DB: ${ocultarConexion(config.databaseUrl)}`);
    console.log(`SSL Postgres: ${config.pgSslMode || "auto"}`);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || "development";
const IS_PRODUCTION = APP_ENV === "production";

const config = {
    appName: process.env.APP_NAME || "Nexo POS",
    appEnv: APP_ENV,
    appVersion: process.env.APP_VERSION || "0.1.0-dev",
    isProduction: IS_PRODUCTION,
    port: Number(process.env.PORT || 3000),
    databaseUrl: process.env.DATABASE_URL || "",
    pgSslMode: process.env.PGSSLMODE || "",
};

function validarConfigProduccion() {
    const faltantes = [];

    if (!config.databaseUrl) {
        faltantes.push("DATABASE_URL");
    }

    if (config.isProduction && faltantes.length > 0) {
        throw new Error(
            `Configuracion incompleta para produccion: ${faltantes.join(", ")}`
        );
    }
}

module.exports = {
    config,
    validarConfigProduccion,
};

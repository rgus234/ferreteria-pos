const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || "development";
const IS_PRODUCTION = APP_ENV === "production";
const packageJson = require("./package.json");

const config = {
    appName: process.env.APP_NAME || "Nexo POS",
    appEnv: APP_ENV,
    appVersion: process.env.APP_VERSION || packageJson.version || "1.0.0",
    isProduction: IS_PRODUCTION,
    port: Number(process.env.PORT || 3000),
    databaseUrl: process.env.DATABASE_URL || "",
    pgSslMode: process.env.PGSSLMODE || "",
    adminKey: process.env.ADMIN_KEY || "",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    stripePriceBasico: process.env.STRIPE_PRICE_BASICO || "",
    stripePricePlus: process.env.STRIPE_PRICE_PLUS || "",
    stripePricePro: process.env.STRIPE_PRICE_PRO || "",
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

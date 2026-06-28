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

module.exports = pool;

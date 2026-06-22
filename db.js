const { Pool } = require("pg");
const { config } = require("./config");

const usaSsl =
    config.pgSslMode === "require" ||
    (
        config.databaseUrl || ""
    ).includes("sslmode=require");

const pool = new Pool({
    connectionString: config.databaseUrl,
    application_name: `${config.appName}-${config.appEnv}`,
    ssl: usaSsl
        ? {
            rejectUnauthorized: false,
        }
        : false,
});

module.exports = pool;

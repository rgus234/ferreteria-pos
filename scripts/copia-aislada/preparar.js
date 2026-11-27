// Copia aislada de Nexo: una base de datos APARTE en tu computadora, para probar sin tocar la real.
//
//   node --env-file=.env scripts/copia-aislada/preparar.js              crea la copia (o la deja arrancada si ya existe)
//   node --env-file=.env scripts/copia-aislada/preparar.js --reiniciar  la borra y la vuelve a crear desde cero
//
// De la base real SOLO SE LEE: la forma de las tablas y las tablas de referencia (planes, funciones, categorias y catalogo maestro de
// productos). Ningun negocio, venta, cliente, persona ni correo se copia. Genera .env.copia (ignorado por git) SIN las llaves de
// correo, cobros, IA, notificaciones ni Taecel, para que desde la copia no salga nada al mundo.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const PG_BIN = process.env.PG_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin";
const CARPETA = process.env.NEXO_COPIA_DIR || "D:\\nexo-copia";
const PUERTO = 5440;
const BASE = "nexo_copia";
const USUARIO = "nexo";
const RAIZ = path.join(__dirname, "..", "..");

const REFERENCIA = [
    "planes", "categorias_funcion", "catalogo_funciones", "plan_funciones", "categorias_nexo", "schema_migrations", "app_versiones",
    "catalogo_maestro_reconciliaciones", "catalogo_maestro_productos", "catalogo_maestro_identificadores",
    "catalogo_fabricante_modulos", "catalogo_fabricante_productos"
];

const origen = process.env.DATABASE_URL || "";
if (!origen) { console.error("Falta DATABASE_URL: corre con --env-file=.env"); process.exit(1); }
if (/localhost|127\.0\.0\.1/.test(origen)) { console.error("DATABASE_URL ya apunta a una base local: usa el .env normal."); process.exit(1); }

const urlLocal = base => `postgresql://${USUARIO}@127.0.0.1:${PUERTO}/${base}`;
const bin = nombre => path.join(PG_BIN, `${nombre}.exe`);

function correr(nombre, args, opciones = {}) {
    const r = spawnSync(bin(nombre), args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64, ...opciones });
    if (r.status !== 0 && !opciones.tolerar) {
        // Nunca imprimir los argumentos: pueden llevar la direccion de la base real con su contraseña.
        console.error(`Fallo ${nombre}:\n${String(r.stderr || r.error || "").slice(-1500)}`);
        process.exit(1);
    }
    return r;
}

const datos = path.join(CARPETA, "pgdata");
fs.mkdirSync(CARPETA, { recursive: true });

if (!fs.existsSync(path.join(datos, "PG_VERSION"))) {
    console.log("Creando el Postgres de la copia en", datos);
    correr("initdb", ["-D", datos, "-U", USUARIO, "--auth=trust", "-E", "UTF8", "--locale=C"]);
}

if (correr("pg_ctl", ["status", "-D", datos], { tolerar: true }).status !== 0) {
    // Solo escucha en esta computadora.
    correr("pg_ctl", ["start", "-D", datos, "-l", path.join(CARPETA, "postgres.log"), "-w", "-o", `-p ${PUERTO} -c listen_addresses=127.0.0.1`], { stdio: "ignore" });
    console.log("Postgres de la copia arrancado en el puerto", PUERTO);
}

const consultar = (base, sql) => correr("psql", ["-d", urlLocal(base), "-At", "-c", sql]).stdout.trim();
let existe = consultar("postgres", `SELECT 1 FROM pg_database WHERE datname = '${BASE}'`) === "1";

if (existe && process.argv.includes("--reiniciar")) {
    consultar("postgres", `DROP DATABASE ${BASE} WITH (FORCE)`);
    existe = false;
}

if (!existe) {
    const esquema = path.join(CARPETA, "esquema.sql");
    const referencia = path.join(CARPETA, "referencia.sql");

    console.log("Leyendo la forma de las tablas de la base real (solo lectura)...");
    correr("pg_dump", ["--dbname", origen, "--schema-only", "--no-owner", "--no-privileges", "--schema=public", "-f", esquema]);
    console.log("Leyendo las tablas de referencia (planes, funciones, categorias, catalogo maestro)...");
    correr("pg_dump", ["--dbname", origen, "--data-only", "--no-owner", "--no-privileges", ...REFERENCIA.flatMap(t => ["-t", `public.${t}`]), "-f", referencia]);

    consultar("postgres", `CREATE DATABASE ${BASE}`);
    consultar(BASE, "DROP SCHEMA public CASCADE"); // el esquema volcado lo vuelve a crear
    correr("psql", ["-d", urlLocal(BASE), "-q", "-v", "ON_ERROR_STOP=1", "-c", "CREATE SCHEMA public", "-c", "CREATE EXTENSION IF NOT EXISTS pg_trgm"]);

    // El volcado trae "CREATE SCHEMA public": se quita porque ya existe (la extension debe estar antes de los indices).
    fs.writeFileSync(esquema, fs.readFileSync(esquema, "utf8").replace(/^CREATE SCHEMA public;$/m, ""));
    correr("psql", ["-d", urlLocal(BASE), "-q", "-v", "ON_ERROR_STOP=1", "-f", esquema]);

    // Las referencias apuntan a negocios que aqui no existen: se cargan sin revisar llaves y se limpia esa referencia.
    correr("psql", ["-d", urlLocal(BASE), "-q", "-v", "ON_ERROR_STOP=1", "-c", "SET session_replication_role = replica", "-f", referencia]);
    consultar(BASE, "UPDATE public.catalogo_maestro_productos SET contribuido_por_negocio_id = NULL WHERE contribuido_por_negocio_id IS NOT NULL");

    // Los contadores de las tablas cargadas quedan despues del ultimo id.
    for (const tabla of REFERENCIA) {
        const numerico = consultar(BASE, `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tabla}' AND column_name = 'id' AND data_type IN ('integer', 'bigint')`) === "1";
        const secuencia = numerico ? consultar(BASE, `SELECT pg_get_serial_sequence('public.${tabla}', 'id')`) : "";
        if (secuencia) consultar(BASE, `SELECT setval('${secuencia}', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.${tabla}), false)`);
    }
    console.log("Base de la copia creada.");
}

const envCopia = path.join(RAIZ, ".env.copia");
if (!fs.existsSync(envCopia)) {
    fs.writeFileSync(envCopia, [
        "# Copia aislada de Nexo: base local y SIN llaves de correo, cobros, IA, notificaciones ni Taecel.",
        `DATABASE_URL=${urlLocal(BASE)}`,
        "APP_ENV=development",
        "PORT=3200",
        `ADMIN_KEY=copia-${crypto.randomBytes(12).toString("hex")}`,
        "NEXO_COPIA_AISLADA=1",
        "NEXO_PRUEBAS=1",
        "# Valores de mentira: solo para que las pantallas de Google respondan; con esto no se puede entrar a ninguna cuenta.",
        "GOOGLE_CLIENT_ID=copia-sin-google.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET=copia-sin-google",
        "GOOGLE_REDIRECT_URI=http://localhost:3200/auth/google/callback",
        "GOOGLE_GMAIL_REDIRECT_URI=http://localhost:3200/recepcion-inteligente/gmail/callback",
        ""
    ].join("\n"));
    console.log("Escrito .env.copia");
}

const cuenta = tabla => consultar(BASE, `SELECT COUNT(*) FROM public.${tabla}`);
console.log(`Copia lista. Tablas: ${consultar(BASE, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")} | negocios: ${cuenta("negocios")} | planes: ${cuenta("planes")} | productos del catalogo maestro: ${cuenta("catalogo_maestro_productos")}`);
console.log("Para usarla:  node --env-file=.env.copia server.js   (abre http://localhost:3200)");

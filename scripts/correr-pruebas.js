// Corre las pruebas. Sin argumentos: SOLO las de tests/ (antes "node --test" tambien ejecutaba los scripts sueltos de tmp/ que
// tienen "test" en el nombre). Con argumentos: los archivos que se pidan, p. ej. npm test -- tests/caja.test.js
// El ambiente (.env.copia o .env) lo pone quien llama con --env-file y se hereda.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const raiz = path.join(__dirname, "..");
const pedidos = process.argv.slice(2);
const archivos = pedidos.length ? pedidos : fs.readdirSync(path.join(raiz, "tests")).filter(n => n.endsWith(".test.js")).sort().map(n => path.join("tests", n));

const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...archivos], { cwd: raiz, stdio: "inherit", env: process.env });
process.exit(r.status === null ? 1 : r.status);

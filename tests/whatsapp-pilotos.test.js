// Los pilotos usan el plan "prueba" con todas las funciones. El recordatorio
// por WhatsApp (credito vencido y encargo listo/vencido) solo se mostraba con
// plan pro/demo, asi que un piloto no lo veia aunque la invitacion promete todo.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

test("el recordatorio por WhatsApp tambien aparece con plan prueba (pilotos)", () => {
    for (const archivo of ["js/credit-customers.js", "dueno.js", "js/encargos-clientes.js"]) {
        const fuente = leer(archivo);
        assert.match(fuente, /\["pro", "prueba", "demo"\]\.includes/, `${archivo}: falta "prueba" en la compuerta del plan`);
        assert.doesNotMatch(fuente, /\["pro", "demo"\]\.includes/, `${archivo}: queda una compuerta solo pro/demo`);
    }
});

test("la app del dueno sube la version del cache al cambiar dueno.js", () => {
    assert.match(leer("dueno-sw.js"), /nexo-dueno-shell-v50/);
});

// Que planes ven el Banco de Nexo.
//
// El banco es el catalogo de fotos compartido: cuando un negocio da de
// alta un producto (escaneando su codigo de barras o tecleandolo), si no
// tiene foto propia se le ofrece la del banco con un boton "Usar esta
// imagen". Su foto propia SIEMPRE gana; el banco solo llena el hueco.

const { test } = require("node:test");
const assert = require("node:assert");

const banco = require("../banco-imagenes-server");
const { planPermiteBancoImagenes } = banco;

// Pool falso: devuelve el plan que se le pida.
function poolConPlan(plan) {
    return {
        query: async () => ({ rows: plan === null ? [] : [{ plan }] })
    };
}

test("pro y plus ven el banco", async () => {
    assert.equal(await planPermiteBancoImagenes(poolConPlan("pro"), 1), true);
    assert.equal(await planPermiteBancoImagenes(poolConPlan("plus"), 1), true);
});

test("el plan de PRUEBA tambien lo ve", async () => {
    // Es el plan que recibe todo registro publico nuevo durante 15 dias,
    // y los Terminos le prometen "acceso completo al sistema".
    // plan-enforcement.js ya lo trata igual que pro/demo en todo lo
    // demas; este gate era el unico que lo dejaba fuera, asi que un
    // negocio recien registrado no veia una sola foto.
    assert.equal(await planPermiteBancoImagenes(poolConPlan("prueba"), 1), true);
});

test("basico NO ve el banco", async () => {
    assert.equal(await planPermiteBancoImagenes(poolConPlan("basico"), 1), false);
});

test("el plan se compara sin importar mayusculas", async () => {
    assert.equal(await planPermiteBancoImagenes(poolConPlan("PLUS"), 1), true);
    assert.equal(await planPermiteBancoImagenes(poolConPlan("Pro"), 1), true);
});

test("un negocio sin licencia cae en demo, no se queda sin banco", async () => {
    // Mismo criterio que ya tenia el gate: la ausencia de fila se lee
    // como 'demo'. Cambiarlo aqui dejaria fuera a los negocios de
    // demostracion sin que nadie lo note.
    assert.equal(await planPermiteBancoImagenes(poolConPlan(null), 1), true);
});

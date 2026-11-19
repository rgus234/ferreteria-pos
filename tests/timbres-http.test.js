// La ruta GET /facturacion/timbres no debe caer en GET /facturacion/:id (error de orden de rutas que ya paso una vez).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
let negocio;
before(async () => { await iniciarServidorPrueba(); negocio = await crearNegocioPrueba("timbres-http"); });
after(async () => { if (negocio) await borrarNegocioPrueba(negocio.negocioId); await detenerServidorPrueba(); await pool.end(); });
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });

test("GET /facturacion/timbres responde el resumen (apagado por defecto) y comprar sin interruptor no abre pagos", async () => {
    const r = await (await fetch(`${BASE_URL}/facturacion/timbres`, { headers: headers() })).json();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.habilitado, false);
    const c = await fetch(`${BASE_URL}/facturacion/timbres/comprar`, { method: "POST", headers: headers(), body: JSON.stringify({ paquete: "t50" }) });
    assert.equal(c.status, 400);
    const a = await fetch(`${BASE_URL}/admin/api/timbres`);
    assert.equal(a.status, 401, "sin clave de administrador no se ven los saldos");
});

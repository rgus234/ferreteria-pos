// Funciones nuevas (beta) por negocio: nacen apagadas, el dueño las enciende y apaga, y un negocio no afecta a otro.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let a;
let b;
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });

before(async () => {
    await iniciarServidorPrueba();
    a = await crearNegocioPrueba("beta-a");
    b = await crearNegocioPrueba("beta-b");
});

after(async () => {
    if (a) await borrarNegocioPrueba(a.negocioId);
    if (b) await borrarNegocioPrueba(b.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("todo nace apagado", async () => {
    const r = await (await fetch(`${BASE_URL}/funciones-beta`, { headers: headers(a) })).json();

    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.funciones).sort(), ["diseno_nuevo", "enlace_celular", "inicio_pendientes", "mapa_tienda", "recibir_por_marca"]);
    assert.ok(Object.values(r.funciones).every(v => v === false), "ninguna esta encendida por defecto");
});

test("el dueño enciende y apaga una funcion, y no afecta a otro negocio", async () => {
    const enciende = await (await fetch(`${BASE_URL}/funciones-beta`, { method: "PUT", headers: headers(a), body: JSON.stringify({ clave: "mapa_tienda", activo: true }) })).json();
    assert.equal(enciende.ok, true, JSON.stringify(enciende));
    assert.equal(enciende.funciones.mapa_tienda, true);
    assert.equal(enciende.funciones.recibir_por_marca, false, "las demas siguen apagadas");

    const otro = await (await fetch(`${BASE_URL}/funciones-beta`, { headers: headers(b) })).json();
    assert.equal(otro.funciones.mapa_tienda, false, "el otro negocio no ve ningun cambio");

    const mismo = await (await fetch(`${BASE_URL}/funciones-beta`, { headers: headers(a) })).json();
    assert.equal(mismo.funciones.mapa_tienda, true, "se queda guardada");

    const apaga = await (await fetch(`${BASE_URL}/funciones-beta`, { method: "PUT", headers: headers(a), body: JSON.stringify({ clave: "mapa_tienda", activo: false }) })).json();
    assert.equal(apaga.funciones.mapa_tienda, false);
});

test("una clave que no existe se rechaza", async () => {
    const r = await fetch(`${BASE_URL}/funciones-beta`, { method: "PUT", headers: headers(a), body: JSON.stringify({ clave: "inventada", activo: true }) });
    assert.equal(r.status, 400);
});

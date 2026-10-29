// Enlazar el celular con QR: el codigo sirve una sola vez, vence, no se puede adivinar a ciegas, el celular recibe una sesion que de verdad funciona
// y el dueño puede quitarle el acceso.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let a;
let b;
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const post = (ruta, cuerpo, h) => fetch(`${BASE_URL}${ruta}`, { method: "POST", headers: h || { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });

before(async () => {
    await iniciarServidorPrueba();
    a = await crearNegocioPrueba("enlace-a");
    b = await crearNegocioPrueba("enlace-b");
});

after(async () => {
    if (a) { await pool.query(`DELETE FROM public.sesiones_cuenta WHERE negocio_id = $1`, [a.negocioId]); await borrarNegocioPrueba(a.negocioId); }
    if (b) await borrarNegocioPrueba(b.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("crear: trae un QR (svg), un codigo corto y vence en 2 minutos", async () => {
    const r = await (await post("/enlace-celular/crear", {}, headers(a))).json();

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.url, /\/dueno\?enlace=[a-f0-9]{64}$/);
    assert.match(r.codigoCorto, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(r.expiraEnSegundos, 120);
    assert.match(r.qrSvg, /<svg/);

    // Nunca se guarda en claro: la base solo tiene el hash.
    const token = r.url.split("enlace=")[1];
    const guardado = (await pool.query(`SELECT token_hash FROM public.enlaces_celular WHERE id = $1`, [r.id])).rows[0];
    assert.notEqual(guardado.token_hash, token);
});

test("canjear con el QR: da una sesion que funciona, sirve UNA sola vez y la computadora se entera", async () => {
    const e = await (await post("/enlace-celular/crear", {}, headers(a))).json();
    const token = e.url.split("enlace=")[1];

    const antes = await (await fetch(`${BASE_URL}/enlace-celular/${e.id}/estado`, { headers: headers(a) })).json();
    assert.equal(antes.estado, "esperando");

    const canje = await (await post("/enlace-celular/canjear", { token })).json();
    assert.equal(canje.ok, true, JSON.stringify(canje));
    assert.ok(canje.token && canje.token.length >= 32);
    assert.equal(canje.negocio.slug, (await pool.query(`SELECT slug FROM public.negocios WHERE id = $1`, [a.negocioId])).rows[0].slug);

    // La sesion entrega acceso real al negocio (el mismo que da iniciar sesion con correo).
    const sesion = await (await fetch(`${BASE_URL}/negocio-actual`, { headers: { Authorization: `Bearer ${canje.token}` } })).json();
    assert.equal(sesion.ok, true);
    assert.equal(sesion.negocio.id, a.negocioId);

    const segundo = await post("/enlace-celular/canjear", { token });
    assert.equal(segundo.status, 400, "el mismo QR no sirve dos veces");

    const despues = await (await fetch(`${BASE_URL}/enlace-celular/${e.id}/estado`, { headers: headers(a) })).json();
    assert.equal(despues.estado, "enlazado");
});

test("canjear con el codigo corto funciona (con o sin guion, en minusculas) y un codigo nuevo invalida el anterior", async () => {
    const viejo = await (await post("/enlace-celular/crear", {}, headers(a))).json();
    const nuevo = await (await post("/enlace-celular/crear", {}, headers(a))).json();

    const conViejo = await post("/enlace-celular/canjear", { codigo: viejo.codigoCorto });
    assert.equal(conViejo.status, 400, "al pedir uno nuevo el anterior deja de servir");

    const conNuevo = await (await post("/enlace-celular/canjear", { codigo: nuevo.codigoCorto.toLowerCase().replace("-", " ") })).json();
    assert.equal(conNuevo.ok, true, JSON.stringify(conNuevo));
});

test("un codigo vencido no sirve y se reporta como vencido", async () => {
    const e = await (await post("/enlace-celular/crear", {}, headers(a))).json();
    await pool.query(`UPDATE public.enlaces_celular SET expira_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [e.id]);

    const canje = await post("/enlace-celular/canjear", { token: e.url.split("enlace=")[1] });
    assert.equal(canje.status, 400);

    const estado = await (await fetch(`${BASE_URL}/enlace-celular/${e.id}/estado`, { headers: headers(a) })).json();
    assert.equal(estado.estado, "vencido");
});

test("entradas invalidas se rechazan y un negocio no ve los codigos de otro", async () => {
    assert.equal((await post("/enlace-celular/canjear", { token: "no-es-un-token" })).status, 400);
    assert.equal((await post("/enlace-celular/canjear", {})).status, 400);

    const e = await (await post("/enlace-celular/crear", {}, headers(a))).json();
    const ajeno = await fetch(`${BASE_URL}/enlace-celular/${e.id}/estado`, { headers: headers(b) });
    assert.equal(ajeno.status, 404, "el otro negocio no puede consultar ese codigo");
});

test("el dueño ve los celulares enlazados y puede quitarles el acceso (la sesion deja de servir)", async () => {
    const e = await (await post("/enlace-celular/crear", {}, headers(a))).json();
    const canje = await (await post("/enlace-celular/canjear", { token: e.url.split("enlace=")[1] })).json();

    const lista = await (await fetch(`${BASE_URL}/enlace-celular/celulares`, { headers: headers(a) })).json();
    assert.ok(lista.celulares.length >= 1);
    const id = lista.celulares[0].id;

    const otroNegocio = await post(`/enlace-celular/celulares/${id}/quitar`, {}, headers(b));
    assert.equal(otroNegocio.status, 404, "otro negocio no puede quitar mi celular");

    const quitar = await (await post(`/enlace-celular/celulares/${id}/quitar`, {}, headers(a))).json();
    assert.equal(quitar.ok, true);

    const sesion = await fetch(`${BASE_URL}/negocio-actual`, { headers: { Authorization: `Bearer ${canje.token}` } });
    assert.equal(sesion.status, 401, "sin acceso despues de quitarlo");
});

test("reservar (iPhone instalando la app): cambia el QR por un codigo de 10 minutos, el QR ya no sirve, la sesion llega hasta escribir el codigo y la computadora lo ve", async () => {
    const e = await (await post("/enlace-celular/crear", {}, headers(a))).json();
    const token = e.url.split("enlace=")[1];

    const r = await (await post("/enlace-celular/reservar", { token })).json();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.codigoCorto, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(r.expiraEnSegundos, 600);

    // El QR original ya no sirve (ni para reservar ni para entrar) y todavia no hay sesion.
    assert.equal((await post("/enlace-celular/canjear", { token })).status, 400, "el QR ya no sirve");
    assert.equal((await post("/enlace-celular/reservar", { token })).status, 400, "ni para reservar otra vez");

    // La computadora sigue viendo "esperando", ahora con mas tiempo y avisando que el celular esta instalando la app.
    const estado = await (await fetch(`${BASE_URL}/enlace-celular/${e.id}/estado`, { headers: headers(a) })).json();
    assert.equal(estado.estado, "esperando");
    assert.equal(estado.reservado, true);
    assert.ok(estado.segundosRestantes > 300 && estado.segundosRestantes <= 600, "cuenta los 10 minutos");

    // Al escribir el codigo en la app instalada entra de verdad.
    const canje = await (await post("/enlace-celular/canjear", { codigo: r.codigoCorto })).json();
    assert.equal(canje.ok, true, JSON.stringify(canje));
    const sesion = await (await fetch(`${BASE_URL}/negocio-actual`, { headers: { Authorization: `Bearer ${canje.token}` } })).json();
    assert.equal(sesion.negocio.id, a.negocioId);

    const despues = await (await fetch(`${BASE_URL}/enlace-celular/${e.id}/estado`, { headers: headers(a) })).json();
    assert.equal(despues.estado, "enlazado");
});

test("reservar rechaza entradas invalidas y un QR vencido", async () => {
    assert.equal((await post("/enlace-celular/reservar", { token: "nada" })).status, 400);

    const e = await (await post("/enlace-celular/crear", {}, headers(a))).json();
    await pool.query(`UPDATE public.enlaces_celular SET expira_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [e.id]);
    assert.equal((await post("/enlace-celular/reservar", { token: e.url.split("enlace=")[1] })).status, 400, "vencido");
});

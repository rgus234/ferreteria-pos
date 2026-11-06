// Escaner remoto: el celular manda codigos y la compu los recibe; la sesion esta amarrada al negocio.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { limpiarCodigo, nuevoCodigoSesion } = require("../escaner-remoto-server");

let A, B;
const llamar = async (negocio, ruta, opciones = {}) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token } });
    return { status: r.status, cuerpo: await r.json() };
};
const post = (negocio, ruta, datos) => llamar(negocio, ruta, { method: "POST", body: JSON.stringify(datos) });

before(async () => {
    await iniciarServidorPrueba();
    A = await crearNegocioPrueba("escaner-a");
    B = await crearNegocioPrueba("escaner-b");
});

after(async () => {
    for (const n of [A, B]) if (n) await borrarNegocioPrueba(n.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("el codigo de sesion es corto y legible, y los codigos se limpian", () => {
    assert.match(nuevoCodigoSesion(), /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(limpiarCodigo("  75010<>53 "), "7501053");
    assert.equal(limpiarCodigo("FD-0001"), "FD-0001");
    assert.equal(limpiarCodigo(null), "");
});

let sesion;

test("la compu crea la sesion y recibe el QR con el enlace para el celular", async () => {
    const r = await post(A, "/escaner-remoto/sesion", {});

    assert.equal(r.status, 201);
    sesion = r.cuerpo.sesion;
    assert.match(sesion, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.match(r.cuerpo.urlCelular, new RegExp(`/dueno\\?escaner=${sesion}$`));
    assert.match(r.cuerpo.qr, /^data:image\/png;base64,/);
});

test("un codigo que manda el celular le llega a la compu, y sin nada nuevo la espera termina vacia", async () => {
    const unido = await post(A, "/escaner-remoto/unir", { sesion });
    assert.equal(unido.cuerpo.pcConectada, true);

    const vacio = await llamar(A, `/escaner-remoto/esperar?sesion=${sesion}&desde=0&ms=150`);
    assert.deepEqual(vacio.cuerpo.codigos, []);
    assert.equal(vacio.cuerpo.celularConectado, true);

    // La compu espera y, mientras espera, el celular manda un codigo: tiene que llegar sin esperar a que termine el tiempo.
    const espera = llamar(A, `/escaner-remoto/esperar?sesion=${sesion}&desde=0&ms=5000`);
    await new Promise(r => setTimeout(r, 120));
    const envio = await post(A, "/escaner-remoto/codigo", { sesion, codigo: "7501234567890" });
    assert.equal(envio.cuerpo.n, 1);

    const recibido = await espera;
    assert.deepEqual(recibido.cuerpo.codigos, [{ n: 1, codigo: "7501234567890" }]);

    await post(A, "/escaner-remoto/codigo", { sesion, codigo: "FD-0001" });
    const siguientes = await llamar(A, `/escaner-remoto/esperar?sesion=${sesion}&desde=1&ms=0`);
    assert.deepEqual(siguientes.cuerpo.codigos.map(c => c.codigo), ["FD-0001"], "solo lo nuevo despues de 'desde'");
});

test("otro negocio no puede unirse, mandar ni leer; y un codigo vacio se rechaza", async () => {
    assert.equal((await post(B, "/escaner-remoto/unir", { sesion })).status, 404);
    assert.equal((await post(B, "/escaner-remoto/codigo", { sesion, codigo: "123456" })).status, 404);
    assert.equal((await llamar(B, `/escaner-remoto/esperar?sesion=${sesion}&ms=0`)).status, 404);
    assert.equal((await post(A, "/escaner-remoto/codigo", { sesion, codigo: "<>" })).status, 400);
    assert.equal((await post(A, "/escaner-remoto/unir", { sesion: "ZZZZZZ" })).status, 404);
});

test("cerrar la sesion la borra, y una sesion nueva reemplaza a las mas viejas del negocio", async () => {
    assert.equal((await post(A, "/escaner-remoto/cerrar", { sesion })).status, 200);
    assert.equal((await post(A, "/escaner-remoto/unir", { sesion })).status, 404);

    const primeras = [];
    for (let i = 0; i < 4; i++) primeras.push((await post(A, "/escaner-remoto/sesion", {})).cuerpo.sesion);

    assert.equal((await post(A, "/escaner-remoto/unir", { sesion: primeras[0] })).status, 404, "la mas vieja se reemplazo (maximo 3)");
    assert.equal((await post(A, "/escaner-remoto/unir", { sesion: primeras[3] })).status, 200);
});

test("el celular encuentra la computadora de SU negocio sin escribir el codigo, pero solo si hay una", async () => {
    // Sesiones sobrantes de pruebas anteriores: se dejan solo las que hacen falta.
    const nueva = (await post(A, "/escaner-remoto/sesion", {})).cuerpo.sesion;
    await llamar(A, `/escaner-remoto/esperar?sesion=${nueva}&desde=0&ms=0`); // la compu "late"

    const activa = await llamar(A, "/escaner-remoto/activa");
    assert.equal(activa.status, 200);
    assert.ok(activa.cuerpo.computadoras >= 1);
    if (activa.cuerpo.computadoras === 1) assert.equal(activa.cuerpo.sesion, nueva);
    else assert.equal(activa.cuerpo.sesion, null, "con varias computadoras no se adivina a cual unirse");

    const otro = await llamar(B, "/escaner-remoto/activa");
    assert.equal(otro.cuerpo.computadoras, 0, "otro negocio no ve nada");
    assert.equal(otro.cuerpo.sesion, null);
});

test("pantallas: indicador fijo en la barra, mismo estado en todos los botones del celular y reconexion automatica al abrir la app", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");

    const pc = leer("public/js/escaner-remoto.js");
    assert.match(pc, /#topbarPOS \.topbar-actions/, "el indicador vive en la barra de arriba");
    assert.match(pc, /window\.renderTopbarPOS = conEscaner/, "se vuelve a poner cuando la barra se redibuja");
    assert.match(pc, /BOTONES_CELULAR = "\.er-boton, \.mt-celular, \.rm-celular"/, "los tres botones comparten estado");
    assert.ok(!pc.includes("er-pildora"), "ya no hay pildora flotante abajo a la izquierda");
    ["off", "espera", "ok", "error"].forEach(e => assert.ok(pc.includes(`"${e}"`), `estado ${e}`));
    assert.match(pc, /Celular conectado · \$\{hace\(conectadoDesde\)\}/, "dice cuanto lleva conectado");

    const celular = leer("public/dueno-escaner-pc.js");
    assert.match(celular, /document\.addEventListener\("visibilitychange"/, "al volver a la app se reconecta");
    assert.match(celular, /\/escaner-remoto\/activa/, "si el codigo guardado ya no existe busca la computadora de su negocio");
    assert.match(celular, /if \(!guardada && !sesion\) return;/, "nunca se une a algo si el celular no se habia conectado antes");

    const html = leer("public/dueno.html");
    const sw = leer("public/dueno-sw.js");
    const version = /dueno-escaner-pc\.js\?v=(escanerpc-[0-9-]+)/.exec(html)[1];
    assert.ok(sw.includes(`/dueno-escaner-pc.js?v=${version}`), "el celular guarda la version nueva");
});

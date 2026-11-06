// Recargas con Taecel: el cliente del servicio web y las rutas de Nexo, contra un Taecel simulado (tests/helpers/taecel-simulado.js).
// Nada de esto toca Taecel de verdad ni mueve dinero.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../db");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const simulado = require("./helpers/taecel-simulado");
const { crearCliente, esperarResultado, interpretarEstado, mensajeDeError, montoDeTexto } = require("../taecel-cliente");
const instalarRecargas = require("../recargas-server");

let taecel;
let negocio;
let ajeno;
let servidor;
let base;
const noEspera = { dormir: async () => {} };

before(async () => {
    taecel = await simulado.iniciar();
    negocio = await crearNegocioPrueba("recargas-a");
    ajeno = await crearNegocioPrueba("recargas-b");
    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"recargas": true}'::jsonb WHERE id = ANY($1)`, [[negocio.negocioId, ajeno.negocioId]]);

    const app = express();
    app.use(express.json());
    // Autenticacion de mentira: el negocio llega en un encabezado.
    const acceso = (req, res, next) => { req.negocioDispositivo = { negocio_id: Number(req.headers["x-negocio"]) }; next(); };
    // El reloj es falso para que "esperar 60 s" no tarde 60 s.
    const rapido = (cliente, transID, opciones) => {
        let reloj = 0;
        return esperarResultado(cliente, transID, { ...opciones, dormir: async ms => { reloj += ms; }, ahora: () => reloj, desde: 0 });
    };

    instalarRecargas(app, pool, acceso, {
        entorno: { TAECEL_URL: taecel.url, TAECEL_KEY: taecel.key, TAECEL_NIP: taecel.nip, TAECEL_NEGOCIOS: String(negocio.negocioId), TAECEL_MODO: "pruebas" },
        esperarResultado: rapido
    });

    await new Promise(resolver => { servidor = app.listen(0, "127.0.0.1", resolver); });
    base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
    await pool.query(`DELETE FROM public.recargas_transacciones WHERE negocio_id = ANY($1)`, [[negocio.negocioId, ajeno.negocioId]]).catch(() => {});
    await borrarNegocioPrueba(negocio.negocioId);
    await borrarNegocioPrueba(ajeno.negocioId);
    await new Promise(r => servidor.close(r));
    await taecel.cerrar();
    await pool.end();
});

const api = (ruta, { negocioId = negocio.negocioId, metodo = "GET", cuerpo } = {}) =>
    fetch(`${base}${ruta}`, { method: metodo, headers: { "Content-Type": "application/json", "x-negocio": String(negocioId) }, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) })
        .then(async r => ({ estado: r.status, cuerpo: await r.json() }));

let numeroToken = 0;
const recargar = (datos, opciones = {}) => api("/recargas/recargar", { metodo: "POST", cuerpo: { token: `tok-prueba-${Date.now()}-${++numeroToken}`, operadora: "telcel", monto: 50, ...datos }, ...opciones });
const solicitudes = referencia => taecel.llamadas.filter(l => l.metodo === "requestTXN" && (!referencia || l.parametros.referencia === referencia)).length;

test("utilidades: montos en texto y mensajes de los codigos de la documentacion", () => {
    assert.equal(montoDeTexto("$5,624.40"), 5624.4);
    assert.equal(montoDeTexto("104,020.97"), 104020.97);
    assert.equal(montoDeTexto(null), null);
    assert.match(mensajeDeError(1), /no es válido/);
    assert.match(mensajeDeError(3129), /llena/);
    assert.equal(mensajeDeError(777, "algo raro"), "algo raro");
});

test("cliente: pide saldo y productos con key y nip, y rechaza claves malas", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const saldo = await cliente.getBalance();
    assert.equal(saldo.ok, true);
    assert.equal(saldo.data[0].Bolsa, "Tiempo Aire");
    assert.equal((await cliente.getProducts()).ok, true);

    const malo = await crearCliente({ url: taecel.url, key: taecel.key, nip: "mal" }).getBalance();
    assert.equal(malo.ok, false);
    assert.equal(malo.error, 403);

    assert.equal(taecel.llamadas.find(l => l.metodo === "getBalance").parametros.key, taecel.key, "la llamada lleva el key (solo el servidor lo manda)");
    assert.throws(() => crearCliente({ url: "", key: "a", nip: "b" }), /Faltan/);
});

test("cliente: una recarga exitosa (requestTXN y luego statusTXN)", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const envio = await cliente.requestTXN({ producto: "TEL010", referencia: "5555555505" });
    assert.equal(envio.ok, true);
    assert.match(envio.data.transID, /^\d{12}$/);

    const final = await esperarResultado(cliente, envio.data.transID, noEspera);
    assert.equal(final.estado, "exitosa");
    assert.equal(final.datos.Status, "Exitosa");
});

test("cliente: si Taecel tarda (no responde las dos primeras consultas) se sigue consultando y termina exitosa", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const envio = await cliente.requestTXN({ producto: "TEL050", referencia: "5555555510" });
    const antes = taecel.llamadas.filter(l => l.metodo === "statusTXN").length;
    const final = await esperarResultado(cliente, envio.data.transID, noEspera);

    assert.equal(final.estado, "exitosa");
    assert.equal(taecel.llamadas.filter(l => l.metodo === "statusTXN").length - antes, 3, "tres consultas: dos sin respuesta y la tercera con el resultado");
});

test("cliente: fallas del carrier (codigo 1 y 3) y producto inexistente", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const f1 = await cliente.requestTXN({ producto: "TEL050", referencia: "5555555515" });
    const r1 = await esperarResultado(cliente, f1.data.transID, noEspera);
    assert.equal(r1.estado, "fallida");
    assert.equal(r1.error, 1);
    assert.match(r1.mensaje, /no es válido/);

    const f3 = await cliente.requestTXN({ producto: "TEL050", referencia: "5555555530" });
    assert.equal((await esperarResultado(cliente, f3.data.transID, noEspera)).error, 3);

    const inexistente = await cliente.requestTXN({ producto: "XXX999", referencia: "5555555505" });
    assert.equal(inexistente.ok, false);
    assert.equal(inexistente.error, 3133);
});

test("cliente: si en 60 s no hay resultado queda PENDIENTE (nunca se da por fallida) y no pasa de una consulta cada 5 s", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const envio = await cliente.requestTXN({ producto: "TEL010", referencia: "5555555999" });
    let reloj = 0;
    const antes = taecel.llamadas.filter(l => l.metodo === "statusTXN").length;
    const final = await esperarResultado(cliente, envio.data.transID, { dormir: async ms => { reloj += ms; }, ahora: () => reloj, desde: 0 });

    assert.equal(final.estado, "pendiente");
    const consultas = taecel.llamadas.filter(l => l.metodo === "statusTXN").length - antes;
    assert.ok(consultas >= 12 && consultas <= 13, `unas 12 consultas en 60 s (fueron ${consultas})`);
});

test("cliente: sin conexion a Taecel no se sabe si proceso: se marca como red, no como fallida", async () => {
    const roto = crearCliente({ url: "http://127.0.0.1:1", key: "k".repeat(30), nip: "nip1", tiempoLlamadaMs: 500 });
    const r = await roto.requestTXN({ producto: "TEL010", referencia: "5555555505" });
    assert.equal(r.ok, false);
    assert.equal(r.red, true);
    assert.equal(interpretarEstado({ ok: false, error: 8888, red: true, data: null }).estado, "desconocido");
});

test("rutas: otro negocio o funcion apagada = demostracion y no se mueve nada", async () => {
    assert.equal((await api("/recargas/modo")).cuerpo.modo, "pruebas");
    assert.equal((await api("/recargas/modo", { negocioId: ajeno.negocioId })).cuerpo.modo, "demostracion", "la cuenta de Taecel es de una sola persona: otro negocio no gasta su saldo");

    const antes = solicitudes();
    const intento = await recargar({ numero: "5555555505" }, { negocioId: ajeno.negocioId });
    assert.equal(intento.estado, 409);
    assert.equal(solicitudes(), antes, "no se mando nada a Taecel");

    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"recargas": false}'::jsonb WHERE id = $1`, [negocio.negocioId]);
    assert.equal((await api("/recargas/modo")).cuerpo.modo, "demostracion");
    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"recargas": true}'::jsonb WHERE id = $1`, [negocio.negocioId]);
});

test("rutas: saldo y productos salen de Taecel y la recarga exitosa guarda folio, comision y saldo final", async () => {
    const saldo = (await api("/recargas/saldo")).cuerpo;
    assert.equal(saldo.ok, true);
    assert.equal(typeof saldo.saldoRecargas, "number");
    assert.equal(saldo.saldoServicios, 590);

    const productos = (await api("/recargas/productos")).cuerpo.productos;
    assert.ok(productos.find(p => p.codigo === "TEL050" && p.monto === 50));

    const r = (await recargar({ numero: "5555555505", monto: 50 })).cuerpo;
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.recarga.estado, "exitosa");
    assert.equal(r.recarga.monto, 50);
    assert.equal(r.recarga.comision, 2);
    assert.equal(r.recarga.folio, "378809");

    const historial = (await api("/recargas/historial")).cuerpo.recargas;
    assert.equal(historial[0].numero, "5555555505");
    assert.equal(JSON.stringify(historial).includes(taecel.key), false, "el key nunca aparece en lo que sale hacia la pantalla");
});

test("rutas: un reintento con el mismo token NO cobra dos veces", async () => {
    const token = `tok-doble-${Date.now()}`;
    const antes = solicitudes();
    const cuerpo = { token, operadora: "telcel", numero: "5555555505", monto: 20 };

    const uno = (await api("/recargas/recargar", { metodo: "POST", cuerpo })).cuerpo;
    const dos = (await api("/recargas/recargar", { metodo: "POST", cuerpo })).cuerpo;

    assert.equal(uno.ok, true);
    assert.equal(dos.repetida, true);
    assert.equal(dos.recarga.id, uno.recarga.id);
    assert.equal(solicitudes() - antes, 1, "Taecel recibio una sola solicitud");
});

test("rutas: falla del carrier se guarda como fallida con su mensaje; validaciones y producto inexistente", async () => {
    const f = (await recargar({ numero: "5555555515" })).cuerpo;
    assert.equal(f.ok, false);
    assert.equal(f.recarga.estado, "fallida");
    assert.match(f.error, /no es válido/);

    assert.equal((await recargar({ numero: "123" })).estado, 400);
    assert.equal((await recargar({ numero: "5555555505", monto: 5 })).estado, 400);
    assert.equal((await recargar({ numero: "5555555505", monto: 900 })).estado, 400);
    assert.equal((await recargar({ numero: "5555555505", monto: 12.5 })).estado, 400);
    assert.equal((await recargar({ numero: "5555555505", operadora: "inventada" })).estado, 400);
    assert.equal((await recargar({ numero: "5555555505", token: "x" })).estado, 400);
    assert.equal((await recargar({ numero: "5555555505", monto: 25 })).estado, 400, "no hay producto de $25 para Telcel");
});

test("rutas: una recarga que no termina queda pendiente y se puede volver a consultar", async () => {
    const r = (await recargar({ numero: "5555555999", monto: 10 })).cuerpo;
    assert.equal(r.ok, false);
    assert.equal(r.pendiente, true);
    assert.equal(r.recarga.estado, "pendiente");

    const consulta = (await api(`/recargas/${r.recarga.id}`)).cuerpo;
    assert.equal(consulta.ok, true);
    assert.equal(consulta.recarga.estado, "pendiente", "Taecel sigue sin dar resultado");

    assert.equal((await api(`/recargas/${r.recarga.id}`, { negocioId: ajeno.negocioId })).estado, 409, "otro negocio no la ve");
});

test("la pantalla de Nexo no trae el key ni el nip: solo el servidor los conoce", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const pantalla = fs.readFileSync(path.join(__dirname, "..", "public/js/recargas-view.js"), "utf8");
    assert.ok(!/TAECEL_KEY|TAECEL_NIP|process\.env/.test(pantalla));
    assert.match(fs.readFileSync(path.join(__dirname, "..", "server-modules.js"), "utf8"), /recargas-server/);
});

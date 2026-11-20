// Recargas con Taecel: el cliente del servicio web y las rutas de Nexo, contra un Taecel simulado (tests/helpers/taecel-simulado.js).
// Nada de esto toca Taecel de verdad ni mueve dinero.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../db");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const simulado = require("./helpers/taecel-simulado");
const { normalizarServicios } = require("../recargas-server");
const { crearCliente, esperarResultado, consultarVenta, interpretarEstado, mensajeDeError, montoDeTexto, INTERVALO_CONSULTA_MS, TIEMPO_MAXIMO_MS, TIEMPO_REQUEST_MS, TIEMPO_STATUS_MS } = require("../taecel-cliente");
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

test("cliente: si en 60 s no hay resultado queda PENDIENTE (nunca se da por fallida), consulta cada 3 s y al terminar deja de mandar statusTXN", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const envio = await cliente.requestTXN({ producto: "TEL010", referencia: "5555555999" });
    let reloj = 0;
    const desde = taecel.llamadas.length;
    const final = await esperarResultado(cliente, envio.data.transID, { dormir: async ms => { reloj += ms; }, ahora: () => reloj, desde: 0, fecha: "2026-11-06" });

    assert.equal(final.estado, "pendiente");
    const nuevas = taecel.llamadas.slice(desde);
    const consultas = nuevas.filter(l => l.metodo === "statusTXN").length;
    assert.ok(consultas >= 19 && consultas <= 21, `unas 20 consultas en 60 s, una cada 3 s (fueron ${consultas})`);
    assert.equal(reloj / (consultas - 1), 3000, "3 s entre consultas");
    assert.equal(nuevas.filter(l => l.metodo === "getSales").length, 1, "al terminar el tiempo se consulta getSales una vez");
    assert.equal(nuevas[nuevas.length - 1].metodo, "getSales", "despues del limite ya no se manda statusTXN");
});

test("cliente: la primera consulta de statusTXN es inmediata (sin esperar) y el limite se cuenta desde requestTXN", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const envio = await cliente.requestTXN({ producto: "TEL010", referencia: "5555555999" });
    const pausas = [];
    let reloj = 58000; // ya pasaron 58 s desde requestTXN
    await esperarResultado(cliente, envio.data.transID, { dormir: async ms => { pausas.push(ms); reloj += ms; }, ahora: () => reloj, desde: 0 });
    assert.deepEqual(pausas, [], "con 58 s ya gastados no cabe otra espera de 3 s: se corta despues de la primera consulta");
});

test("cliente: si statusTXN se queda En proceso, getSales da el resultado final y NO se sigue consultando statusTXN", async () => {
    const cliente = crearCliente({ url: taecel.url, key: taecel.key, nip: taecel.nip });
    const envio = await cliente.requestTXN({ producto: "TEL050", referencia: "5555555998" });
    let reloj = 0;
    const final = await esperarResultado(cliente, envio.data.transID, { dormir: async ms => { reloj += ms; }, ahora: () => reloj, desde: 0, fecha: "2026-11-06" });
    assert.equal(final.estado, "exitosa");
    assert.equal(final.datos.Folio, "555111");

    const pendiente = await cliente.requestTXN({ producto: "TEL010", referencia: "5555555999" });
    assert.equal((await consultarVenta(cliente, pendiente.data.transID, "2026-11-06")).estado, "proceso", "getSales En proceso sigue pendiente");
    assert.equal((await consultarVenta(cliente, "999999", "2026-11-06")).estado, "desconocido", "si no aparece no se da por fallida");
});

test("cliente: tiempos por peticion (requestTXN 30 s, statusTXN 9 s: dentro del rango de 5 a 10 s de Taecel)", () => {
    assert.equal(TIEMPO_REQUEST_MS, 30000);
    assert.equal(TIEMPO_STATUS_MS, 9000);
    assert.equal(INTERVALO_CONSULTA_MS, 3000);
    assert.equal(TIEMPO_MAXIMO_MS, 60000);
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

    const catalogo = (await api("/recargas/productos")).cuerpo;
    assert.ok(catalogo.productos.find(p => p.codigo === "TEL050" && p.monto === 50 && p.carrierId === "1"));
    assert.ok(catalogo.productos.every(p => p.bolsaId === "1"), "solo tiempo aire: la bolsa de pago de servicios es otra");
    assert.ok(!catalogo.productos.find(p => p.codigo === "SKY000"));
    assert.equal(catalogo.carriers.find(c => c.id === "1").comision, 4, "la comision real de cada compañia viene de Taecel");
    assert.ok(!catalogo.carriers.find(c => c.nombre === "SKY"));

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

test("catalogo real de Taecel: cada compañia tiene SUS montos (Telcel no tiene $120, Movistar si)", async () => {
    const { productos } = (await api("/recargas/productos")).cuerpo;
    const montos = id => productos.filter(p => p.carrierId === id).map(p => p.monto);
    assert.ok(!montos("1").includes(120));
    assert.ok(montos("2").includes(120) && montos("2").includes(60));

    assert.equal((await recargar({ operadora: "telcel", numero: "5555555505", monto: 120 })).estado, 400, "Telcel no tiene recarga de $120");
    const movistar = (await recargar({ operadora: "movistar", numero: "5555555505", monto: 120 })).cuerpo;
    assert.equal(movistar.ok, true, JSON.stringify(movistar));
    assert.equal(movistar.recarga.operadora, "movistar");

    const att = (await recargar({ operadora: "c5", numero: "5555555505", monto: 70 })).cuerpo;
    assert.equal(att.ok, true, "cualquier compañia de tiempo aire se puede mandar como c<id>");
    assert.equal(taecel.llamadas.filter(l => l.metodo === "requestTXN").pop().parametros.producto, "ATT070");
});

test("normalizarCatalogo lee la forma real de getProducts (campos con mayuscula, Monto como texto)", () => {
    const { normalizarCatalogo, codigoDeProducto } = require("../recargas-server");
    const real = {
        bolsas: [{ ID: "1", Nombre: "Tiempo Aire" }],
        carriers: [{ ID: "239", Nombre: "BAIT", BolsaID: "1", Tipo: "0", Comision: { ComisionCliente: "4.0000" } }, { ID: "9", Nombre: "Otro", BolsaID: "2", Tipo: "1", Comision: { ComisionCliente: "1.0000" } }],
        productos: [
            { Bolsa: "Tiempo Aire", BolsaID: "1", Carrier: "BAIT", CarrierID: "239", Codigo: "BAIT030", Monto: "30.00", Vigencia: "30 DIAS", Descripcion: "Datos:   2GB \n Minutos" },
            { Bolsa: "Pago de Servicios", BolsaID: "2", Carrier: "SKY", CarrierID: "9", Codigo: "SKY000", Monto: "95.00" },
            { Bolsa: "Tiempo Aire", BolsaID: "1", Carrier: "BAIT", CarrierID: "239", Codigo: "", Monto: "50.00" }
        ]
    };
    const { productos, carriers } = normalizarCatalogo(real);
    assert.equal(productos.length, 1, "sin codigo o de otra bolsa no entra");
    assert.deepEqual({ codigo: productos[0].codigo, monto: productos[0].monto, carrierId: productos[0].carrierId }, { codigo: "BAIT030", monto: 30, carrierId: "239" });
    assert.equal(productos[0].descripcion, "Datos: 2GB Minutos", "los espacios y saltos se limpian");
    assert.equal(carriers.length, 1);
    assert.equal(carriers[0].comision, 4);

    assert.equal(codigoDeProducto(productos, "bait", 30), "BAIT030");
    assert.equal(codigoDeProducto(productos, "bait", 50), null, "monto que no esta en el catalogo");
    assert.equal(codigoDeProducto([], "telcel", 50), null, "sin catalogo no se adivina ningun codigo");
    assert.equal(codigoDeProducto(productos, "inventada", 30), null);
    assert.deepEqual(normalizarCatalogo(null), { productos: [], carriers: [] });
});

const pagar = (datos, opciones = {}) => api("/recargas/pagar", { metodo: "POST", cuerpo: { token: `tok-pago-${Date.now()}-${++numeroToken}`, ...datos }, ...opciones });

test("catalogo: separa los servicios y las tarjetas de regalo, con la referencia que pide cada uno", async () => {
    const r = await api("/recargas/productos");
    assert.equal(r.estado, 200);
    const sky = r.cuerpo.servicios.find(s => s.nombre === "SKY");
    const gp = r.cuerpo.servicios.find(s => s.nombre === "Google Play");
    assert.equal(sky.categoria, "Servicios");
    assert.equal(sky.libre, true);
    assert.equal(sky.cargo, 5);
    assert.deepEqual([sky.campo.min, sky.campo.max], [12, 12]);
    assert.equal(gp.categoria, "GiftCards");
    assert.equal(gp.libre, false);
    assert.deepEqual(gp.productos.map(p => p.monto), [50, 100]);
    assert.ok(!r.cuerpo.servicios.some(s => s.nombre === "Telcel"), "el tiempo aire no es un servicio");
    assert.deepEqual(normalizarServicios(null), []);
});

test("pagar: un servicio de monto libre (con centavos) se paga y guarda su cargo", async () => {
    const r = await pagar({ carrierId: "200", referencia: "871235412600", monto: 131.4 });
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.ok, true);
    assert.equal(r.cuerpo.recarga.tipo, "servicio");
    assert.equal(r.cuerpo.recarga.monto, 131.4);
    assert.equal(r.cuerpo.recarga.cargo, 5);
    const enviada = taecel.llamadas.filter(l => l.metodo === "requestTXN" && l.parametros.referencia === "871235412600").pop();
    assert.equal(enviada.parametros.producto, "SKY000", "el codigo sale del catalogo");
    assert.equal(enviada.parametros.monto, "131.4");
});

test("pagar: una tarjeta de regalo regresa el codigo (pin) y no manda monto", async () => {
    const r = await pagar({ carrierId: "211", producto: "GPLAY50", referencia: "4421234567" });
    assert.equal(r.cuerpo.ok, true);
    assert.equal(r.cuerpo.recarga.tipo, "giftcard");
    assert.equal(r.cuerpo.recarga.monto, 50);
    assert.equal(r.cuerpo.recarga.pin, "TEST-AAAAA-BBBBB-CCCCC");
    const enviada = taecel.llamadas.filter(l => l.metodo === "requestTXN" && l.parametros.referencia === "4421234567").pop();
    assert.equal(enviada.parametros.monto, undefined, "las tarjetas son de monto fijo: no se manda monto");
});

test("pagar: valida la referencia, el monto y el catalogo antes de hablar con Taecel", async () => {
    const antes = solicitudes();
    assert.match((await pagar({ carrierId: "200", referencia: "123", monto: 100 })).cuerpo.error, /12 dígitos/);
    assert.match((await pagar({ carrierId: "200", referencia: "871235412600", monto: 0 })).cuerpo.error, /monto va de/i);
    assert.match((await pagar({ carrierId: "200", referencia: "871235412600", monto: 10.123 })).cuerpo.error, /2 decimales/);
    assert.equal((await pagar({ carrierId: "200", referencia: "871235412600", monto: 60000 })).estado, 400);
    assert.equal((await pagar({ carrierId: "999", referencia: "871235412600", monto: 100 })).estado, 400, "servicio inexistente");
    assert.equal((await pagar({ carrierId: "211", producto: "GPLAY999", referencia: "4421234567" })).estado, 400, "monto que no existe en el catalogo");
    assert.equal((await pagar({ carrierId: "211", producto: "GPLAY50", referencia: "44212" })).estado, 400, "referencia corta");
    assert.equal(solicitudes(), antes, "nada de eso llega a Taecel");
});

test("pagar: el mismo token no vuelve a cobrar, y otro negocio sin la funcion real no paga", async () => {
    const token = `tok-unico-${Date.now()}`;
    const primero = await pagar({ token, carrierId: "200", referencia: "871235412611", monto: 50 });
    const antes = solicitudes();
    const segundo = await pagar({ token, carrierId: "200", referencia: "871235412611", monto: 50 });
    assert.equal(primero.cuerpo.ok, true);
    assert.equal(segundo.cuerpo.repetida, true);
    assert.equal(solicitudes(), antes, "no se vuelve a mandar a Taecel");
    const ajenoR = await pagar({ carrierId: "200", referencia: "871235412622", monto: 50 }, { negocioId: ajeno.negocioId });
    assert.equal(ajenoR.estado, 409, "el negocio fuera de TAECEL_NEGOCIOS no paga");
});

test("pagar: una tarjeta de marca con limite (Google Play) no pasa de $2,000 al dia por celular, y otra marca o celular no se afecta", async () => {
    const celular = "4425550000";
    await pool.query(
        `INSERT INTO public.recargas_transacciones (negocio_id, token, operadora, numero, monto, producto, estado, tipo) VALUES ($1, $2, 'c211', $3, 1950, 'GOO01', 'exitosa', 'giftcard')`,
        [negocio.negocioId, `tok-limite-${Date.now()}`, celular]
    );

    const antes = solicitudes();
    const pasa = await pagar({ carrierId: "211", producto: "GOO01", referencia: celular });
    assert.equal(pasa.estado, 400);
    assert.match(pasa.cuerpo.error, /1,950.*Google Play.*2,000/s);
    assert.equal(solicitudes(), antes, "no se manda a Taecel una venta que la marca va a bloquear");

    const cabe = await pagar({ carrierId: "211", producto: "GPLAY50", referencia: celular });
    assert.equal(cabe.cuerpo.ok, true, "$1,950 + $50 llega justo a $2,000: todavia cabe");

    const otroCelular = await pagar({ carrierId: "211", producto: "GOO01", referencia: "4425550001" });
    assert.equal(otroCelular.cuerpo.ok, true, "otro celular no se ve afectado");
});

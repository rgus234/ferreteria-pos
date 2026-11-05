// Venta de alcohol (abarrotes): horario en que no se vende, PIN de administrador para saltarlo y aviso de mayoria de edad.
// Corre contra la base real, aislado en negocios sinteticos que se borran al terminar.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba, crearClienteCreditoActivo } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");
const alcohol = require("../alcohol-server");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const PIN_ADMIN = "473921";

let a;
let b;
let cerveza;
let galletas;

before(async () => {
    await iniciarServidorPrueba();
    a = await crearNegocioPrueba("alcohol-a");
    b = await crearNegocioPrueba("alcohol-b");
    await pool.query(`INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash) VALUES ($1, 'Admin de prueba', 'Administrador', $2)`, [a.negocioId, hashPassword(PIN_ADMIN)]);
    cerveza = await crearProductoPrueba(a.negocioId, { nombre: "Cerveza Victoria 355 ml", precio: 22, stock: 50 });
    galletas = await crearProductoPrueba(a.negocioId, { nombre: "Galletas Marias", precio: 15, stock: 50 });
    await fetch(`${BASE_URL}/caja/abrir`, { method: "POST", headers: headers(a), body: JSON.stringify({ usuario: "prueba", fondoInicial: 100, notas: "" }) });
});

after(async () => {
    if (a) {
        await pool.query(`DELETE FROM public.bitacora_acciones WHERE negocio_id = $1`, [a.negocioId]);
        await borrarNegocioPrueba(a.negocioId);
    }
    if (b) await borrarNegocioPrueba(b.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

const put = (n, ruta, cuerpo) => fetch(`${BASE_URL}${ruta}`, { method: "PUT", headers: headers(n), body: JSON.stringify(cuerpo) });
const vender = (n, producto, extra = {}) => fetch(`${BASE_URL}/ventas`, {
    method: "POST",
    headers: headers(n),
    body: JSON.stringify({ productos: [{ id: producto.id, codigo: "X", nombre: "Producto", precio: 20, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 20 }], metodoPago: "efectivo", pagos: { efectivo: 20 }, recibido: 20, cambio: 0, ...extra })
});

test("la regla de horario: ventana que cruza la medianoche, ventana normal y ley seca", () => {
    const { enVentana, motivoRestriccion } = alcohol;

    assert.equal(enVentana("23:00", "22:00", "10:00"), true);
    assert.equal(enVentana("03:00", "22:00", "10:00"), true);
    assert.equal(enVentana("10:00", "22:00", "10:00"), false, "a las 10:00 ya se puede");
    assert.equal(enVentana("15:00", "22:00", "10:00"), false);
    assert.equal(enVentana("13:00", "12:00", "14:00"), true, "ventana normal");
    assert.equal(enVentana("15:00", "12:00", "14:00"), false);
    assert.equal(enVentana("23:00", "22:00", "22:00"), false, "desde = hasta no bloquea");
    assert.equal(enVentana("23:00", "mal", "10:00"), false);

    const hoy = { fecha: "2026-11-05", hora: "15:00" };
    assert.equal(motivoRestriccion({ activa: false, desde: "00:00", hasta: "23:59" }, hoy), null, "apagada no bloquea");
    assert.match(motivoRestriccion({ activa: true, desde: "22:00", hasta: "10:00", ley_seca_fecha: "2026-11-05" }, hoy), /dia sin venta de alcohol/);
    assert.equal(motivoRestriccion({ activa: true, desde: "22:00", hasta: "10:00", ley_seca_fecha: "2026-11-04" }, hoy), null, "la ley seca de ayer no cuenta");
    assert.match(motivoRestriccion({ activa: true, desde: "22:00", hasta: "10:00" }, { fecha: "2026-11-05", hora: "23:30" }), /de 22:00 a 10:00/);
});

test("la funcion nace apagada y sin configuracion", async () => {
    const f = await (await fetch(`${BASE_URL}/funciones-beta`, { headers: headers(a) })).json();
    assert.equal(f.funciones.alcohol, false);
    const r = await (await fetch(`${BASE_URL}/alcohol`, { headers: headers(a) })).json();
    assert.equal(r.config.activa, false);
    assert.deepEqual(r.ids, []);
});

test("con la funcion apagada, una venta con alcohol pasa aunque haya horario configurado", async () => {
    await put(a, "/alcohol/producto/" + cerveza.id, { esAlcohol: true });
    await put(a, "/alcohol/config", { activa: true, desde: "22:00", hasta: "10:00", leySecaHoy: true });

    const r = await (await vender(a, cerveza)).json();
    assert.equal(r.success, true, JSON.stringify(r));
});

test("el producto se marca a mano y se puede volver a lo que diga la categoria", async () => {
    let r = await (await fetch(`${BASE_URL}/alcohol`, { headers: headers(a) })).json();
    assert.deepEqual(r.ids, [cerveza.id]);
    assert.equal(r.manuales[cerveza.id], true);

    await put(a, "/alcohol/producto/" + cerveza.id, { esAlcohol: null });
    r = await (await fetch(`${BASE_URL}/alcohol`, { headers: headers(a) })).json();
    assert.deepEqual(r.ids, []);

    await put(a, "/alcohol/producto/" + cerveza.id, { esAlcohol: true });
});

test("un valor raro o un producto de otro negocio se rechaza", async () => {
    assert.equal((await put(a, "/alcohol/producto/" + cerveza.id, { esAlcohol: "si" })).status, 400);
    assert.equal((await put(b, "/alcohol/producto/" + cerveza.id, { esAlcohol: true })).status, 404);
    assert.equal((await put(a, "/alcohol/config", { activa: true, desde: "25:00", hasta: "10:00" })).status, 400);
});

test("encendida la funcion: sin PIN no se vende alcohol en ley seca; con PIN de administrador si, y queda en la bitacora", async () => {
    await put(a, "/funciones-beta", { clave: "alcohol", activo: true });
    await put(a, "/alcohol/config", { activa: true, desde: "22:00", hasta: "10:00", leySecaHoy: true });

    const sinPin = await vender(a, cerveza);
    const cuerpo = await sinPin.json();
    assert.equal(sinPin.status, 400);
    assert.equal(cuerpo.requierePinAdmin, true);
    assert.equal(cuerpo.requiereAutorizarAlcohol, true);
    assert.match(cuerpo.error, /alcohol/i);

    const pinMalo = await vender(a, cerveza, { adminPin: "000000" });
    assert.equal(pinMalo.status, 400);

    const conPin = await (await vender(a, cerveza, { adminPin: PIN_ADMIN })).json();
    assert.equal(conPin.success, true, JSON.stringify(conPin));

    const huella = await pool.query(`SELECT detalle FROM public.bitacora_acciones WHERE negocio_id = $1 AND accion = 'venta_alcohol_autorizada'`, [a.negocioId]);
    assert.equal(huella.rows.length, 1);
    assert.deepEqual(huella.rows[0].detalle.productos, ["Cerveza Victoria 355 ml"]);
});

test("lo que no es alcohol se vende normal, y quitar la ley seca deja vender alcohol sin PIN", async () => {
    const normal = await (await vender(a, galletas)).json();
    assert.equal(normal.success, true, JSON.stringify(normal));

    await put(a, "/alcohol/config", { activa: true, desde: "22:00", hasta: "10:00", leySecaHoy: false });
    // de las 00:00 a las 00:00 no hay ventana, asi que a cualquier hora se vende (la prueba no depende de la hora del dia)
    await put(a, "/alcohol/config", { activa: true, desde: "00:00", hasta: "00:00", leySecaHoy: false });
    const libre = await (await vender(a, cerveza)).json();
    assert.equal(libre.success, true, JSON.stringify(libre));
});

test("tambien se revisa el cargo a credito (fiado)", async () => {
    await put(a, "/alcohol/config", { activa: true, desde: "22:00", hasta: "10:00", leySecaHoy: true });
    const cliente = (await crearClienteCreditoActivo(a.negocioId, { nombre: "Cliente fiado", telefono: "5551234567", limiteCredito: 5000 })).id;
    const cargo = pin => fetch(`${BASE_URL}/creditos/clientes/${cliente}/cargos`, {
        method: "POST",
        headers: headers(a),
        body: JSON.stringify({ monto: 22, subtotal: 22, concepto: "Venta", productos: [{ id: cerveza.id, nombre: "Cerveza", precio: 22, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 22 }], ...(pin ? { adminPin: pin } : {}) })
    });

    const sin = await cargo(null);
    assert.equal(sin.status, 400);
    assert.equal((await sin.json()).requiereAutorizarAlcohol, true);

    const con = await cargo(PIN_ADMIN);
    assert.equal(con.status < 300, true, `status ${con.status}`);
});

test("un negocio no hereda la configuracion de otro", async () => {
    const r = await (await fetch(`${BASE_URL}/alcohol`, { headers: headers(b) })).json();
    assert.equal(r.config.activa, false);
});

test("cliente: aviso de 18 años en el cobro, PIN al cobrar y sin cola offline fuera de horario", () => {
    const modal = leer("public/js/pos-payment-modal.js");
    assert.match(modal, /avisoAlcoholCobroHTML\(\)/);

    const cliente = leer("public/js/alcohol-pos.js");
    assert.match(cliente, /solo para mayores de 18 años/);
    assert.match(cliente, /funcionBeta\("alcohol"\)/);
    assert.match(cliente, /envolverCola\("registrarVentaOfflineDesktopPOS"\)/);
    assert.match(cliente, /envolverCola\("registrarCreditoOfflineDesktopPOS"\)/);

    const ventas = leer("public/js/pos-sales.js");
    assert.equal((ventas.match(/pedirPinAlcoholPOS\(motivoAlcohol\)/g) || []).length, 2, "contado y fiado piden el PIN");

    const html = leer("public/index.html");
    assert.match(html, /data-beta="alcohol" hidden>[\s\S]*?id="nuevoEsAlcohol"/);
    assert.match(html, /js\/alcohol-pos\.js/);
    assert.match(leer("public/js/product-inventory.js"), /guardarAlcoholProductoPOS/);
    assert.match(leer("public/js/funciones-beta.js"), /nexo-funciones-beta-pantalla/);
});

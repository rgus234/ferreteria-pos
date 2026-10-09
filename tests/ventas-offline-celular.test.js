// Fase 3 del plan "celular como plan B": cobrar sin internet.
// El celular guarda la venta en su cola y la sube por /sync/push con el
// mismo cuerpo que usaria POST /ventas. Lo que NO puede pasar:
//  - que una venta que el servidor ya habia guardado (se perdio la
//    respuesta, se encolo, y luego se sincroniza) quede duplicada;
//  - que reintentar el mismo evento descuente el stock otra vez;
//  - que se pierda el codigo del ticket que el cliente ya vio / escaneo.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers(extra = {}) {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...extra };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("ventas-offline-celular");
    await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 500, notas: "" })
    });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

// Cuerpo identico al que arma confirmarCobroVenderDueno() (sin adminPin).
function cuerpoVenta(producto, extra = {}) {
    const llave = extra.idempotencyKey || `celular-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return {
        total: 80,
        subtotal: 80,
        descuento: 0,
        descuentoTipo: "ninguno",
        descuentoValor: 0,
        clienteId: null,
        clienteNombre: "Publico general",
        cajeroUsuario: "dueno",
        cajeroNombre: "Dueño",
        productos: [{ id: producto.id, codigo: producto.codigo, nombre: producto.nombre, precio: 40, cantidad: 2, unidadVenta: "pieza", modoVenta: "bolsa", importe: 80 }],
        metodoPago: "efectivo",
        pagos: { efectivo: 80, tarjeta: 0, transferencia: 0, credito: 0 },
        recibido: 100,
        cambio: 20,
        idempotencyKey: llave,
        codigoPublico: `OFF${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
        ...extra
    };
}

async function empujar(eventos, deviceId = "dueno-prueba-celular") {
    const respuesta = await fetch(`${BASE_URL}/sync/push`, {
        method: "POST",
        headers: headers({ "x-device-id": deviceId }),
        body: JSON.stringify({ deviceId, eventos })
    });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

function evento(payload) {
    return { eventId: `venta-${payload.idempotencyKey}`, tipo: "venta_creada", entidad: "venta", entidadId: payload.idempotencyKey, payload };
}

async function stockDe(id) {
    return Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [id])).rows[0].stock);
}

test("una venta cobrada sin internet se registra completa al sincronizar", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 40 });
    const payload = cuerpoVenta(producto);

    const { status, cuerpo } = await empujar([evento(payload)]);

    assert.equal(status, 200);
    assert.deepEqual(cuerpo.errores, []);
    assert.deepEqual(cuerpo.aceptados, [`venta-${payload.idempotencyKey}`]);

    const fila = (await pool.query(
        `SELECT folio, total, metodo_pago, codigo_publico, idempotency_key, cajero_usuario, estado
         FROM public.historial_ventas WHERE negocio_id = $1 AND idempotency_key = $2`,
        [negocio.negocioId, payload.idempotencyKey]
    )).rows;

    assert.equal(fila.length, 1);
    assert.equal(Number(fila[0].total), 80);
    assert.equal(fila[0].metodo_pago, "efectivo");
    assert.equal(fila[0].codigo_publico, payload.codigoPublico, "el ticket que ya se le dio al cliente sigue siendo valido");
    assert.equal(fila[0].estado, "completada");
    assert.ok(fila[0].folio, "tiene folio real");
    assert.equal(await stockDe(producto.id), 8, "descuenta existencias una vez");
});

test("reintentar el mismo evento no duplica la venta ni descuenta stock otra vez", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 40 });
    const payload = cuerpoVenta(producto);

    await empujar([evento(payload)]);
    const segundo = await empujar([evento(payload)]);

    assert.deepEqual(segundo.cuerpo.aceptados, []);
    assert.deepEqual(segundo.cuerpo.duplicados, [`venta-${payload.idempotencyKey}`]);

    const cuantas = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public.historial_ventas WHERE negocio_id = $1 AND idempotency_key = $2`,
        [negocio.negocioId, payload.idempotencyKey]
    );
    assert.equal(cuantas.rows[0].n, 1);
    assert.equal(await stockDe(producto.id), 8);
});

test("si el cobro SI llego al servidor y solo se perdio la respuesta, sincronizar no lo duplica", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 40 });
    const payload = cuerpoVenta(producto);

    // Intento en linea que el servidor guardo pero cuya respuesta nunca llego.
    const enLinea = await fetch(`${BASE_URL}/ventas`, {
        method: "POST", headers: headers(), body: JSON.stringify(payload)
    });
    assert.equal(enLinea.status, 200);

    // El celular lo dio por fallido y lo encolo con la misma llave.
    const { cuerpo } = await empujar([evento(payload)]);

    assert.deepEqual(cuerpo.errores, []);
    assert.equal(cuerpo.aplicados[0].accion, "venta_ya_confirmada");

    const cuantas = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public.historial_ventas WHERE negocio_id = $1 AND idempotency_key = $2`,
        [negocio.negocioId, payload.idempotencyKey]
    );
    assert.equal(cuantas.rows[0].n, 1, "una sola venta por cobro");
    assert.equal(await stockDe(producto.id), 8, "el stock se descuento una sola vez");
});

test("varias ventas en un mismo lote se aplican todas y en orden", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 20, precio: 40 });
    const ventas = [cuerpoVenta(producto), cuerpoVenta(producto), cuerpoVenta(producto)];

    const { cuerpo } = await empujar(ventas.map(evento));

    assert.equal(cuerpo.aceptados.length, 3);
    assert.deepEqual(cuerpo.errores, []);
    assert.equal(await stockDe(producto.id), 14);
});

test("una venta con total invalido vuelve como error y no se registra", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 40 });
    const payload = cuerpoVenta(producto, { total: 0 });

    const { cuerpo } = await empujar([evento(payload)]);

    assert.equal(cuerpo.aceptados.length, 0);
    assert.equal(cuerpo.errores.length, 1);
    assert.equal(cuerpo.errores[0].eventId, `venta-${payload.idempotencyKey}`);
    assert.equal(await stockDe(producto.id), 10);
});

test("un articulo rapido (id negativo) no descuenta nada pero la venta se registra", async () => {
    const payload = cuerpoVenta({ id: -1, codigo: "Sin codigo", nombre: "Cinta sin codigo" });

    const { cuerpo } = await empujar([evento(payload)]);

    assert.deepEqual(cuerpo.errores, []);
    assert.equal(cuerpo.aceptados.length, 1);
});

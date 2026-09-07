// Verificacion end-to-end de "Cancelar venta" (ver plan
// stateless-doodling-tarjan.md) -- corre contra la base de datos real
// (sin base de pruebas separada en este proyecto), aislado en un
// negocio sintetico que se borra al terminar.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, crearClienteCreditoActivo, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");

let negocio;
let productoEfectivo;
let productoCredito;
const PIN_ADMIN = "581204";

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("ventas-cancelar");

    await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash) VALUES ($1, 'Admin de prueba', 'Administrador', $2)`,
        [negocio.negocioId, hashPassword(PIN_ADMIN)]
    );

    productoEfectivo = await crearProductoPrueba(negocio.negocioId, { nombre: "Pistola de riego de prueba", precio: 159, stock: 10 });
    productoCredito = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto a credito de prueba", precio: 100, stock: 10 });
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("cancelar venta en efectivo: restaura stock, marca cancelada en historial_ventas y en ventas, deja bitacora", async () => {
    const ventaResp = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            total: 318,
            subtotal: 318,
            productos: [{ id: productoEfectivo.id, nombre: productoEfectivo.nombre, precio: 159, cantidad: 2, unidadVenta: "pieza", modoVenta: "bolsa", importe: 318 }],
            metodoPago: "efectivo",
            pagos: { efectivo: 318 },
            recibido: 318,
            cambio: 0
        })
    });
    assert.equal(ventaResp.status, 200);
    const datosVenta = await ventaResp.json();
    assert.ok(datosVenta.historialId);
    assert.ok(datosVenta.ventaId);

    const stockTrasVenta = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoEfectivo.id]);
    assert.equal(Number(stockTrasVenta.rows[0].stock), 8, "el stock debe bajar 2 tras la venta");

    const cancelarResp = await fetch(`${BASE_URL}/ventas/${datosVenta.historialId}/cancelar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ motivo: "Venta de prueba por error", adminPin: PIN_ADMIN })
    });
    assert.equal(cancelarResp.status, 200);
    const datosCancelar = await cancelarResp.json();
    assert.equal(datosCancelar.ok, true);
    assert.equal(datosCancelar.folio, datosVenta.folio);

    const stockTrasCancelar = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoEfectivo.id]);
    assert.equal(Number(stockTrasCancelar.rows[0].stock), 10, "el stock debe regresar exactamente a lo que tenia antes");

    const historial = await pool.query(`SELECT estado FROM public.historial_ventas WHERE id = $1`, [datosVenta.historialId]);
    assert.equal(historial.rows[0].estado, "cancelada");

    const ventaFila = await pool.query(`SELECT estado FROM public.ventas WHERE id = $1`, [datosVenta.ventaId]);
    assert.equal(ventaFila.rows[0].estado, "cancelada", "public.ventas debe quedar sincronizada con historial_ventas");

    const bitacora = await pool.query(
        `SELECT accion, detalle FROM public.bitacora_acciones WHERE negocio_id = $1 AND accion = 'venta_cancelada' ORDER BY id DESC LIMIT 1`,
        [negocio.negocioId]
    );
    assert.equal(bitacora.rows.length, 1);
    assert.equal(bitacora.rows[0].detalle.folio, datosVenta.folio);
    assert.equal(bitacora.rows[0].detalle.motivo, "Venta de prueba por error");

    global.__ventaCancelada = { historialId: datosVenta.historialId };
});

test("cancelar una venta ya cancelada se rechaza con 400 y no vuelve a tocar el stock", async () => {
    const { historialId } = global.__ventaCancelada;

    const stockAntes = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoEfectivo.id]);

    const resp = await fetch(`${BASE_URL}/ventas/${historialId}/cancelar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ motivo: "Segundo intento", adminPin: PIN_ADMIN })
    });
    assert.equal(resp.status, 400);
    const datos = await resp.json();
    assert.equal(datos.ok, false);

    const stockDespues = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoEfectivo.id]);
    assert.equal(Number(stockDespues.rows[0].stock), Number(stockAntes.rows[0].stock), "no debe restaurar el stock una segunda vez");
});

test("PIN incorrecto o vacio se rechaza sin modificar nada", async () => {
    const ventaResp = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            total: 159,
            subtotal: 159,
            productos: [{ id: productoEfectivo.id, nombre: productoEfectivo.nombre, precio: 159, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 159 }],
            metodoPago: "efectivo",
            pagos: { efectivo: 159 }
        })
    });
    const datosVenta = await ventaResp.json();

    const respIncorrecto = await fetch(`${BASE_URL}/ventas/${datosVenta.historialId}/cancelar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ motivo: "Prueba PIN malo", adminPin: "000000" })
    });
    assert.equal(respIncorrecto.status, 400);

    const respSinMotivo = await fetch(`${BASE_URL}/ventas/${datosVenta.historialId}/cancelar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ motivo: "", adminPin: PIN_ADMIN })
    });
    assert.equal(respSinMotivo.status, 400);

    const historial = await pool.query(`SELECT estado FROM public.historial_ventas WHERE id = $1`, [datosVenta.historialId]);
    assert.equal(historial.rows[0].estado, "completada", "no debe cancelarse con PIN invalido o sin motivo");
});

test("cancelar una venta a credito borra el cargo y regresa el saldo del cliente a lo que tenia antes", async () => {
    const clienteId = (await crearClienteCreditoActivo(negocio.negocioId, { nombre: "Cliente cancelar venta", telefono: "5550001111", limiteCredito: 5000 })).id;

    const cargoResp = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            monto: 100,
            subtotal: 100,
            productos: [{ id: productoCredito.id, nombre: productoCredito.nombre, precio: 100, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 100 }]
        })
    });
    assert.equal(cargoResp.status, 200);
    const datosCargo = await cargoResp.json();

    const saldoTrasCargo = await pool.query(`SELECT COALESCE(SUM(CASE WHEN tipo='venta' THEN monto WHEN tipo='abono' THEN -monto ELSE 0 END),0) AS saldo FROM public.movimientos_credito WHERE cliente_id = $1`, [clienteId]);
    assert.equal(Number(saldoTrasCargo.rows[0].saldo), 100);

    const cancelarResp = await fetch(`${BASE_URL}/ventas/${datosCargo.historialId}/cancelar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ motivo: "Cargo a credito de prueba", adminPin: PIN_ADMIN })
    });
    assert.equal(cancelarResp.status, 200);

    const stockTrasCancelar = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoCredito.id]);
    assert.equal(Number(stockTrasCancelar.rows[0].stock), 10, "el stock del producto a credito tambien debe restaurarse");

    const movimiento = await pool.query(`SELECT id FROM public.movimientos_credito WHERE historial_id = $1`, [datosCargo.historialId]);
    assert.equal(movimiento.rows.length, 0, "el cargo a credito debe desaparecer, no quedar pendiente para siempre");

    const saldoFinal = await pool.query(`SELECT COALESCE(SUM(CASE WHEN tipo='venta' THEN monto WHEN tipo='abono' THEN -monto ELSE 0 END),0) AS saldo FROM public.movimientos_credito WHERE cliente_id = $1`, [clienteId]);
    assert.equal(Number(saldoFinal.rows[0].saldo), 0, "el saldo del cliente debe regresar a como estaba antes del cargo");
});

test("una venta cancelada no cuenta en /reportes/ventas", async () => {
    const ventaResp = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            total: 159,
            subtotal: 159,
            productos: [{ id: productoEfectivo.id, nombre: productoEfectivo.nombre, precio: 159, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 159 }],
            metodoPago: "efectivo",
            pagos: { efectivo: 159 }
        })
    });
    const datosVenta = await ventaResp.json();

    const antes = await fetch(`${BASE_URL}/reportes/ventas?periodo=anio`, { headers: headers() });
    const datosAntes = await antes.json();
    const transaccionesAntes = Number(datosAntes.resumen.transacciones);

    await fetch(`${BASE_URL}/ventas/${datosVenta.historialId}/cancelar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ motivo: "Prueba de reportes", adminPin: PIN_ADMIN })
    });

    const despues = await fetch(`${BASE_URL}/reportes/ventas?periodo=anio`, { headers: headers() });
    const datosDespues = await despues.json();

    assert.equal(Number(datosDespues.resumen.transacciones), transaccionesAntes - 1, "la venta cancelada debe dejar de contar en Reportes");
});

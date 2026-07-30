// Verificacion end-to-end de "Editar compra a credito" (folio real +
// PIN + conteo solo al liquidar) -- tarea CRE-EDIT8. Corre contra la
// base de datos real (sin base de pruebas separada en este proyecto),
// aislado en un negocio sintetico que se borra al terminar.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");

let negocio;
let productoA;
let productoB;
const PIN_ADMIN = "473921";

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("credito-editar-compra");

    await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash) VALUES ($1, 'Admin de prueba', 'Administrador', $2)`,
        [negocio.negocioId, hashPassword(PIN_ADMIN)]
    );

    productoA = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto A de prueba", precio: 100, stock: 10 });
    productoB = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto B de prueba", precio: 150, stock: 10 });
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("cargo a credito nuevo: folio real, stock descontado una sola vez, encontrable por folio", async () => {
    const clienteResp = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente editar compra", telefono: "5551112222", limiteCredito: 5000 })
    });
    const clienteId = (await clienteResp.json()).cliente.id;

    const cargoResp = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            monto: 100,
            subtotal: 100,
            productos: [{ id: productoA.id, nombre: "Producto A de prueba", precio: 100, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 100 }]
        })
    });

    assert.equal(cargoResp.status, 200);
    const datosCargo = await cargoResp.json();
    assert.ok(datosCargo.folio, "debe traer un folio real");
    assert.ok(datosCargo.historialId, "debe traer historialId");

    const stockTrasCargo = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoA.id]);
    assert.equal(Number(stockTrasCargo.rows[0].stock), 9, "el stock debe bajar exactamente 1, no el doble");

    const busqueda = await fetch(`${BASE_URL}/ventas/folio/${encodeURIComponent(datosCargo.folio)}`, { headers: headers() });
    assert.equal(busqueda.status, 200);
    const datosVenta = await busqueda.json();
    assert.equal(Number(datosVenta.venta.id), Number(datosCargo.historialId));

    global.__creEdit = { clienteId, historialId: datosCargo.historialId, folio: datosCargo.folio };
});

test("editar compra: PIN incorrecto se rechaza sin tocar stock ni deuda", async () => {
    const { historialId } = global.__creEdit;

    const resp = await fetch(`${BASE_URL}/ventas/${historialId}/cambios`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productoDevueltoId: productoA.id,
            cantidadDevuelta: 1,
            productoNuevoId: productoB.id,
            cantidadNueva: 1,
            adminPin: "000000"
        })
    });

    assert.equal(resp.status, 400);
    const datos = await resp.json();
    assert.match(datos.error, /PIN de administrador invalido/);

    const stockA = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoA.id]);
    const stockB = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoB.id]);
    assert.equal(Number(stockA.rows[0].stock), 9, "stock de A no debe cambiar si el PIN fue rechazado");
    assert.equal(Number(stockB.rows[0].stock), 10, "stock de B no debe cambiar si el PIN fue rechazado");
});

test("editar compra: PIN correcto cambia el producto y sincroniza la deuda", async () => {
    const { historialId, clienteId } = global.__creEdit;

    const resp = await fetch(`${BASE_URL}/ventas/${historialId}/cambios`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productoDevueltoId: productoA.id,
            cantidadDevuelta: 1,
            productoNuevoId: productoB.id,
            cantidadNueva: 1,
            adminPin: PIN_ADMIN
        })
    });

    assert.equal(resp.status, 200);
    const datos = await resp.json();
    assert.equal(Number(datos.diferencia), 50, "150 del producto nuevo menos 100 del devuelto");

    const stockA = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoA.id]);
    const stockB = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoB.id]);
    assert.equal(Number(stockA.rows[0].stock), 10, "producto devuelto regresa a stock 10");
    assert.equal(Number(stockB.rows[0].stock), 9, "producto nuevo baja a stock 9");

    const cambioFila = await pool.query(`SELECT * FROM public.cambios_producto WHERE historial_id = $1`, [historialId]);
    assert.equal(cambioFila.rows.length, 1, "debe quedar un registro de auditoria del cambio");
    assert.equal(Number(cambioFila.rows[0].diferencia), 50);

    const movimiento = await pool.query(`SELECT monto, liquidado_at FROM public.movimientos_credito WHERE historial_id = $1`, [historialId]);
    assert.equal(Number(movimiento.rows[0].monto), 150, "100 original + 50 de diferencia");
    assert.equal(movimiento.rows[0].liquidado_at, null, "todavia no deberia estar liquidada");

    const detalleCliente = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}`, { headers: headers() });
    const datosDetalle = await detalleCliente.json();
    assert.equal(Number(datosDetalle.cliente.saldo), 150, "el saldo del cliente ya debe reflejar los 150");
});

test("reportes: la venta a credito no cuenta hasta que se liquida por completo", async () => {
    const { historialId, clienteId } = global.__creEdit;

    const antes = await fetch(`${BASE_URL}/reportes/ventas?periodo=mes`, { headers: headers() });
    const datosAntes = await antes.json();
    const folioEnListaAntes = (datosAntes.ultimas || []).some(v => Number(v.id) === Number(historialId));
    assert.equal(folioEnListaAntes, false, "la venta a credito sin liquidar no debe aparecer en Reportes");

    const abono = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/abonos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 150, concepto: "Abono que satura la compra" })
    });
    assert.equal(abono.status, 200);

    const movimiento = await pool.query(`SELECT liquidado_at FROM public.movimientos_credito WHERE historial_id = $1`, [historialId]);
    assert.notEqual(movimiento.rows[0].liquidado_at, null, "liquidado_at debe quedar lleno tras el abono que satura");

    const despues = await fetch(`${BASE_URL}/reportes/ventas?periodo=mes`, { headers: headers() });
    const datosDespues = await despues.json();
    const folioEnListaDespues = (datosDespues.ultimas || []).some(v => Number(v.id) === Number(historialId));
    assert.equal(folioEnListaDespues, true, "una vez liquidada, la venta a credito ya debe contar en Reportes");
});

test("reportes: una venta de contado normal sigue contando igual que antes (sin regresion)", async () => {
    const ventaResp = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            total: 100,
            subtotal: 100,
            metodoPago: "efectivo",
            pagos: { efectivo: 100 },
            recibido: 100,
            cambio: 0,
            productos: [{ id: productoA.id, nombre: "Producto A de prueba", precio: 100, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 100 }]
        })
    });
    assert.equal(ventaResp.status, 200);
    const datosVenta = await ventaResp.json();
    const historialIdContado = datosVenta.historialId || datosVenta.venta?.id || datosVenta.id;

    const reportes = await fetch(`${BASE_URL}/reportes/ventas?periodo=mes`, { headers: headers() });
    const datosReportes = await reportes.json();
    const encontrada = (datosReportes.ultimas || []).some(v => Number(v.id) === Number(historialIdContado));
    assert.equal(encontrada, true, "una venta de contado (sin ningun vinculo a credito) debe contar de inmediato");
});

test("una compra a credito vieja sin historial_id no trae folio (el boton Editar compra debe ocultarse)", async () => {
    const clienteResp = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente compra vieja", telefono: "5553334444" })
    });
    const clienteId = (await clienteResp.json()).cliente.id;

    await pool.query(
        `INSERT INTO public.movimientos_credito (negocio_id, cliente_id, tipo, referencia, concepto, monto)
         VALUES ($1, $2, 'venta', 'CR-VIEJA-TEST', 'Compra vieja sin folio', 250)`,
        [negocio.negocioId, clienteId]
    );

    const detalle = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}`, { headers: headers() });
    const datosDetalle = await detalle.json();
    const movimientoViejo = datosDetalle.movimientos.find(m => m.tipo === "venta" && Number(m.monto) === 250);

    assert.ok(movimientoViejo, "el movimiento viejo debe seguir apareciendo normalmente");
    assert.equal(movimientoViejo.historial_id, null, "sin historial_id -- el frontend oculta 'Editar compra' con este dato");
});

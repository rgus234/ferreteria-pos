// Corre contra la base de datos real (no hay una de pruebas separada
// en este proyecto) -- todo queda aislado en un negocio sintetico
// propio y se borra al terminar. Ver tests/helpers/negocio-prueba.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, crearClienteCreditoActivo, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("caja");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("abrir turno, rechazar un segundo turno, y cerrar con el corte correcto", async () => {
    const apertura = await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 500, notas: "" })
    });

    assert.equal(apertura.status, 200);

    const segundaApertura = await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 200 })
    });

    assert.equal(segundaApertura.status, 400, "no debe permitir dos turnos abiertos a la vez");

    const cierre = await fetch(`${BASE_URL}/caja/cerrar`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            efectivoContado: 500,
            tarjetaContado: 0,
            transferenciaContado: 0,
            creditoContado: 0,
            notas: "cierre de prueba"
        })
    });

    const datosCierre = await cierre.json();

    assert.equal(cierre.status, 200);
    assert.equal(datosCierre.turno.estado, "cerrado");
    assert.equal(Number(datosCierre.turno.diferencia), 0, "sin ventas de por medio, lo contado debe cuadrar exacto con el fondo inicial");
});

test("turnos simultaneos: cada corte cuenta SOLO sus ventas, y solo el efectivo mueve el efectivo esperado", async () => {
    const { hashPassword } = require("../password-utils");
    const crearEmpleado = async nombre => (await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, activo, permisos) VALUES ($1, $2, 'Administrador', $3, true, '{}'::jsonb) RETURNING id`,
        [negocio.negocioId, nombre, hashPassword("1234")]
    )).rows[0].id;
    const idA = await crearEmpleado("Cajero A");
    const idB = await crearEmpleado("Cajero B");
    const idC = await crearEmpleado("Cajero C");
    const con = id => ({ ...headers(), "x-empleado-id": String(id) });
    const llamar = async (ruta, id, opciones = {}) => {
        const r = await fetch(`${BASE_URL}${ruta}`, { headers: con(id), ...opciones });
        return { estado: r.status, datos: await r.json().catch(() => ({})) };
    };

    try {
        assert.equal((await llamar("/caja/abrir", idA, { method: "POST", body: JSON.stringify({ usuario: "A", fondoInicial: 100 }) })).estado, 200);
        assert.equal((await llamar("/caja/abrir", idB, { method: "POST", body: JSON.stringify({ usuario: "B", fondoInicial: 50 }) })).estado, 200);

        const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 100 });
        const venta = await llamar("/ventas", idA, { method: "POST", body: JSON.stringify({ productos: [{ id: producto.id, precio: 100, cantidad: 1 }], metodoPago: "efectivo", pagos: { efectivo: 100 } }) });
        assert.equal(venta.estado, 200, JSON.stringify(venta.datos));

        const deA = (await llamar("/caja/turno-activo", idA)).datos.resumen;
        const deB = (await llamar("/caja/turno-activo", idB)).datos.resumen;
        assert.equal(Number(deA.ventas), 100);
        assert.equal(Number(deA.esperado_efectivo), 200);
        assert.equal(Number(deB.ventas), 0, "la venta del cajero A no entra en el corte del cajero B");
        assert.equal(Number(deB.esperado_efectivo), 50);

        // Un pago a proveedor por transferencia no baja el efectivo del cajon
        const salida = await llamar("/caja/movimientos", idA, { method: "POST", body: JSON.stringify({ tipo: "salida", concepto: "Proveedor", monto: 30, metodo: "transferencia" }) });
        assert.equal(salida.estado, 200, JSON.stringify(salida.datos));
        assert.equal(Number(salida.datos.resumen.esperado_efectivo), 200);

        // Un abono en efectivo cobrado por el cajero B solo cuenta en el turno de B
        const cliente = await crearClienteCreditoActivo(negocio.negocioId, { nombre: "Cliente abono" });
        await pool.query("INSERT INTO public.movimientos_credito (negocio_id, cliente_id, tipo, referencia, concepto, monto) VALUES ($1, $2, 'venta', 'CR-T', 'Deuda', 300)", [negocio.negocioId, cliente.id]);
        const abono = await llamar(`/creditos/clientes/${cliente.id}/abonos`, idB, { method: "POST", body: JSON.stringify({ monto: 40, metodoPago: "efectivo" }) });
        assert.equal(abono.estado, 200, JSON.stringify(abono.datos));
        const deB2 = (await llamar("/caja/turno-activo", idB)).datos.resumen;
        const deA2 = (await llamar("/caja/turno-activo", idA)).datos.resumen;
        assert.equal(Number(deB2.abonoEfectivo), 40);
        assert.equal(Number(deB2.esperado_efectivo), 90, "fondo 50 + abono 40");
        assert.equal(Number(deA2.abonoEfectivo), 0, "el abono de B no entra en el corte de A");

        // Fondo negativo y corte sin efectivo contado se rechazan
        assert.equal((await llamar("/caja/abrir", idC, { method: "POST", body: JSON.stringify({ usuario: "C", fondoInicial: -5 }) })).estado, 400);
        const sinContar = await llamar("/caja/cerrar", idA, { method: "POST", body: JSON.stringify({ notas: "" }) });
        assert.equal(sinContar.estado, 400);
        assert.match(sinContar.datos.error, /efectivo/i);

        const cierre = await llamar("/caja/cerrar", idA, { method: "POST", body: JSON.stringify({ efectivoContado: 200 }) });
        assert.equal(cierre.estado, 200, JSON.stringify(cierre.datos));
        assert.equal(Number(cierre.datos.turno.diferencia), 0);
    } finally {
        await pool.query("UPDATE public.turnos_caja SET estado = 'cerrado', cerrado_at = NOW() WHERE negocio_id = $1 AND estado = 'abierto'", [negocio.negocioId]);
        await pool.query("DELETE FROM public.movimientos_caja WHERE negocio_id = $1", [negocio.negocioId]);
        await pool.query("DELETE FROM public.movimientos_credito WHERE negocio_id = $1", [negocio.negocioId]);
        await pool.query("UPDATE public.turnos_caja SET empleado_id = NULL WHERE negocio_id = $1", [negocio.negocioId]);
        await pool.query("DELETE FROM public.empleados WHERE id = ANY($1)", [[idA, idB, idC]]);
    }
});

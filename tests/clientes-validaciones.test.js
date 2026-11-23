// Clientes: abonos de credito y encargos rechazan lo que no tiene sentido, con un mensaje claro y sin tocar la base.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearClienteCreditoActivo, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const api = async (ruta, metodo, cuerpo) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { method: metodo, headers: headers(), body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
};
const saldoDe = async clienteId => Number((await pool.query(
    "SELECT COALESCE(SUM(CASE WHEN tipo = 'venta' THEN monto ELSE -monto END), 0) AS s FROM public.movimientos_credito WHERE negocio_id = $1 AND cliente_id = $2",
    [negocio.negocioId, clienteId]
)).rows[0].s);

before(async () => { await iniciarServidorPrueba(); negocio = await crearNegocioPrueba("clientes-validaciones"); });
after(async () => {
    if (negocio) {
        await pool.query("DELETE FROM public.movimientos_credito WHERE negocio_id = $1", [negocio.negocioId]);
        await pool.query("DELETE FROM public.encargos_clientes_items WHERE negocio_id = $1", [negocio.negocioId]);
        await pool.query("DELETE FROM public.encargos_clientes WHERE negocio_id = $1", [negocio.negocioId]);
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("abonos: no se pasan de lo que debe, rechazan montos raros con 400 y un cliente que no existe da 404", async () => {
    const cliente = await crearClienteCreditoActivo(negocio.negocioId, { nombre: "Cliente abonos" });
    await pool.query("INSERT INTO public.movimientos_credito (negocio_id, cliente_id, tipo, referencia, concepto, monto) VALUES ($1, $2, 'venta', 'CR-V', 'Deuda', 300)", [negocio.negocioId, cliente.id]);

    const demasiado = await api(`/creditos/clientes/${cliente.id}/abonos`, "POST", { monto: 500, metodoPago: "efectivo" });
    assert.equal(demasiado.estado, 400);
    assert.match(demasiado.datos.error, /mayor a lo que debe.*300\.00/);

    assert.equal((await api(`/creditos/clientes/${cliente.id}/abonos`, "POST", { monto: "abc" })).estado, 400);
    assert.equal((await api(`/creditos/clientes/${cliente.id}/abonos`, "POST", { monto: 0.004 })).estado, 400);
    assert.equal((await api("/creditos/clientes/99999999/abonos", "POST", { monto: 10 })).estado, 404);
    assert.equal(await saldoDe(cliente.id), 300, "nada de lo rechazado movio el saldo");

    assert.equal((await api(`/creditos/clientes/${cliente.id}/abonos`, "POST", { monto: 120, metodoPago: "efectivo" })).estado, 200);
    const liquida = await api(`/creditos/clientes/${cliente.id}/abonos`, "POST", { monto: 180, metodoPago: "efectivo" });
    assert.equal(liquida.estado, 200, "pagar exactamente lo que debe sigue funcionando");
    assert.equal(liquida.datos.cuentaLiquidada, true);
    assert.equal(await saldoDe(cliente.id), 0);

    const sinDeuda = await api(`/creditos/clientes/${cliente.id}/abonos`, "POST", { monto: 5 });
    assert.equal(sinDeuda.estado, 400);
    assert.match(sinDeuda.datos.error, /no debe nada/i);
});

test("encargos: anticipo negativo, fecha rara, renglones en blanco y cantidades invalidas se rechazan; uno bueno sigue guardandose", async () => {
    const base = { clienteNombre: "Dona Mary", items: [{ nombre: "Pintura blanca 4 L", cantidad: 2 }] };

    assert.equal((await api("/encargos-clientes", "POST", { ...base, anticipo: -50 })).estado, 400);
    assert.equal((await api("/encargos-clientes", "POST", { ...base, anticipo: "abc" })).estado, 400);
    assert.equal((await api("/encargos-clientes", "POST", { ...base, fechaEntregaEsperada: "manana" })).estado, 400);
    assert.equal((await api("/encargos-clientes", "POST", { clienteNombre: "Dona Mary", items: [{ nombre: "   " }, { nombre: "" }] })).estado, 400);
    assert.equal((await api("/encargos-clientes", "POST", { clienteNombre: "Dona Mary", items: [{ nombre: "Brocha", cantidad: -1 }] })).estado, 400);

    const total = (await pool.query("SELECT COUNT(*)::int AS n FROM public.encargos_clientes WHERE negocio_id = $1", [negocio.negocioId])).rows[0].n;
    assert.equal(total, 0, "ninguno de los rechazados se guardo");

    const bueno = await api("/encargos-clientes", "POST", { ...base, anticipo: 100, fechaEntregaEsperada: "2026-12-05" });
    assert.equal(bueno.estado, 200, JSON.stringify(bueno.datos));

    assert.equal((await api(`/encargos-clientes/${bueno.datos.id}`, "PATCH", { anticipo: -1 })).estado, 400);
    assert.equal((await api(`/encargos-clientes/${bueno.datos.id}`, "PATCH", { anticipo: 150 })).estado, 200);
});

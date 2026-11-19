// Timbres prepagados: saldo, compra (idempotente), consumo con reserva/devolucion y cobro dentro de la autofactura.
// Se prueba en el mismo proceso con el interruptor TIMBRES_PREPAGO y un Facturama de mentira.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const timbres = require("../timbres");
const autofactura = require("../autofactura");

let negocio;
const RECEPTOR = { rfc: "PELJ800101AB1", nombre: "Juan Perez Lopez", regimenFiscal: "612", codigoPostal: "34000", usoCfdi: "G03", correo: "cliente@example.com" };

before(async () => {
    negocio = await crearNegocioPrueba("timbres");
    await pool.query(`UPDATE public.negocios SET rfc='AAA010101AAA', razon_social='NEGOCIO PRUEBA SA', regimen_fiscal='601', codigo_postal_fiscal='34000', facturacion_activa=true, funciones_beta='{"autofactura": true}'::jsonb WHERE id=$1`, [negocio.negocioId]);
    process.env.TIMBRES_PREPAGO = "1";
});
after(async () => {
    delete process.env.TIMBRES_PREPAGO;
    await pool.query(`DELETE FROM public.timbres_movimientos WHERE negocio_id = $1`, [negocio.negocioId]);
    await pool.query(`DELETE FROM public.timbres_saldo WHERE negocio_id = $1`, [negocio.negocioId]);
    await borrarNegocioPrueba(negocio.negocioId);
    await pool.end();
});

async function crearVenta() {
    const codigo = `TIMB${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const fila = await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, total, subtotal, descuento, metodo_pago, productos, estado, codigo_publico, folio, fecha)
         VALUES ($1, 116, 116, 0, 'efectivo', $2::jsonb, 'completada', $3, $3, NOW()) RETURNING id`,
        [negocio.negocioId, JSON.stringify([{ nombre: "Martillo", cantidad: 1, precio: 116, importe: 116 }]), codigo]
    );
    return { id: fila.rows[0].id, codigo };
}
const depsOk = () => { const l = { cfdi: 0 }; return { l, crearCfdi: async () => { l.cfdi++; return { ok: true, factura: { serie: "A", folio: String(l.cfdi), uuid: `UUID-T-${Date.now()}-${l.cfdi}`, xml: "<cfdi/>", facturamaId: "f" } }; }, descargarXmlCfdi: async () => ({ ok: false }), enviarCorreoFacturaCfdi: async () => ({ ok: true }) }; };

test("los paquetes y sus precios son los acordados", () => {
    assert.deepEqual(timbres.PAQUETES.map(p => [p.timbres, p.centavos]), [[50, 9900], [200, 34900], [500, 69900], [1000, 119900]]);
});

test("sin saldo no se reserva; con saldo descuenta, y devolver lo regresa", async () => {
    assert.equal((await timbres.reservar(pool, negocio.negocioId)).ok, false);
    await timbres.acreditar(pool, { negocioId: negocio.negocioId, cantidad: 2, tipo: "regalo", nota: "prueba" });
    assert.equal((await timbres.reservar(pool, negocio.negocioId)).saldo, 1);
    await timbres.devolver(pool, negocio.negocioId);
    assert.equal((await timbres.saldoDe(pool, negocio.negocioId)).saldo, 2);
});

test("dos reservas al mismo tiempo con 1 solo timbre: solo una pasa y el saldo nunca es negativo", async () => {
    await pool.query(`UPDATE public.timbres_saldo SET saldo = 1 WHERE negocio_id = $1`, [negocio.negocioId]);
    const r = await Promise.all([timbres.reservar(pool, negocio.negocioId), timbres.reservar(pool, negocio.negocioId)]);
    assert.equal(r.filter(x => x.ok).length, 1);
    assert.equal((await timbres.saldoDe(pool, negocio.negocioId)).saldo, 0);
});

test("una compra de Stripe se acredita una sola vez y el monto debe coincidir con el paquete", async () => {
    const sesion = { id: `cs_test_${Date.now()}`, payment_status: "paid", amount_total: 9900, metadata: { tipo: "timbres", paquete: "t50", negocio_id: String(negocio.negocioId) } };
    const antes = (await timbres.saldoDe(pool, negocio.negocioId)).saldo;
    assert.equal((await timbres.acreditarDesdeSesion(pool, sesion)).ok, true);
    assert.equal((await timbres.acreditarDesdeSesion(pool, sesion)).repetido, true, "el webhook y la confirmacion no duplican");
    assert.equal((await timbres.saldoDe(pool, negocio.negocioId)).saldo, antes + 50);

    const barata = { ...sesion, id: `cs_test_b${Date.now()}`, amount_total: 100 };
    assert.equal((await timbres.acreditarDesdeSesion(pool, barata)).ok, false, "pago de menos no acredita");
    const inventada = { ...sesion, id: `cs_test_c${Date.now()}`, metadata: { ...sesion.metadata, paquete: "t99999" } };
    assert.equal((await timbres.acreditarDesdeSesion(pool, inventada)).ok, false);
    const sinPagar = { ...sesion, id: `cs_test_d${Date.now()}`, payment_status: "unpaid" };
    assert.equal((await timbres.acreditarDesdeSesion(pool, sinPagar)).ok, false);
});

test("autofactura con cobro: sin saldo no timbra; con saldo descuenta 1; si el PAC rechaza, el timbre vuelve", async () => {
    await pool.query(`UPDATE public.timbres_saldo SET saldo = 0 WHERE negocio_id = $1`, [negocio.negocioId]);
    const v = await crearVenta();
    const deps = depsOk();
    assert.equal((await autofactura.consultar(pool, { codigo: v.codigo, total: "116" })).estado, "no_disponible");
    assert.equal((await autofactura.emitir(pool, deps, { codigo: v.codigo, total: "116", receptor: RECEPTOR })).ok, false);
    assert.equal(deps.l.cfdi, 0);

    await timbres.acreditar(pool, { negocioId: negocio.negocioId, cantidad: 3, tipo: "regalo" });
    const malo = { ...depsOk(), crearCfdi: async () => ({ ok: false, error: "RFC del receptor no existe" }) };
    assert.equal((await autofactura.emitir(pool, malo, { codigo: v.codigo, total: "116", receptor: RECEPTOR })).ok, false);
    assert.equal((await timbres.saldoDe(pool, negocio.negocioId)).saldo, 3, "el rechazo no cuesta timbre");

    const ok = await autofactura.emitir(pool, deps, { codigo: v.codigo, total: "116", receptor: RECEPTOR });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal((await timbres.saldoDe(pool, negocio.negocioId)).saldo, 2, "una factura cuesta 1 timbre");
});

test("con el cobro apagado nada cambia: no pide saldo ni descuenta", async () => {
    process.env.TIMBRES_PREPAGO = "0";
    await pool.query(`UPDATE public.timbres_saldo SET saldo = 0 WHERE negocio_id = $1`, [negocio.negocioId]);
    assert.equal((await timbres.reservar(pool, negocio.negocioId)).ok, true);
    assert.equal((await timbres.saldoDe(pool, negocio.negocioId)).saldo, 0);
    assert.equal(await timbres.hayTimbres(pool, negocio.negocioId), true);
    process.env.TIMBRES_PREPAGO = "1";
});

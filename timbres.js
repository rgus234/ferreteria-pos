// Timbres prepagados de facturacion: saldo por negocio, paquetes, compra y consumo.
//
// Interruptor general: TIMBRES_PREPAGO=1 en el servidor. Apagado (lo normal hasta pagar el modulo de Facturama), todo se queda como
// siempre: sin saldo, sin cobro, sin pantalla de compra. Encendido: cada factura timbrada descuenta 1 y sin saldo no se factura.
//
// Consumo: se RESERVA 1 antes de llamar al PAC y se DEVUELVE si el PAC rechaza, asi un timbre nunca se pierde por un error.
const fs = require("fs");
const path = require("path");

// Precios con IVA incluido, en centavos de peso (MXN). Para cambiarlos basta editar esta lista.
const PAQUETES = [
    { id: "t50", timbres: 50, centavos: 9900 },
    { id: "t200", timbres: 200, centavos: 34900 },
    { id: "t500", timbres: 500, centavos: 69900 },
    { id: "t1000", timbres: 1000, centavos: 119900 }
];
const AVISO_SALDO_BAJO = 10;

const habilitado = () => process.env.TIMBRES_PREPAGO === "1";

// Negocio de demostracion (marcado a mano con funciones_beta.facturacion_demo = true): ve y usa todo el flujo de timbres
// (comprar, gastar, paquetes) pero SIN cobrar, SIN timbrar de verdad y SIN mandar correos. Las facturas salen marcadas DEMO.
const cacheDemo = new Map();
async function esDemo(pool, negocioId) {
    if (!pool || !negocioId) return false;
    const guardado = cacheDemo.get(negocioId);
    if (guardado && Date.now() - guardado.t < 15000) return guardado.v;
    const fila = (await pool.query(`SELECT funciones_beta->>'facturacion_demo' AS d FROM public.negocios WHERE id = $1`, [negocioId])).rows[0];
    const v = Boolean(fila && fila.d === "true");
    cacheDemo.set(negocioId, { v, t: Date.now() });
    return v;
}
// ¿Aplica el cobro de timbres a este negocio? Si el servidor lo tiene encendido, o si es un negocio de demostracion.
async function activoPara(pool, negocioId) { return habilitado() || (await esDemo(pool, negocioId)); }
const paquetePorId = id => PAQUETES.find(p => p.id === id) || null;

let tablasListas = false;
async function asegurarTablas(pool) {
    if (tablasListas) return;
    const sql = fs.readFileSync(path.join(__dirname, "migrations", "20261129_timbres_prepago.sql"), "utf8");
    await pool.query(sql);
    tablasListas = true;
}

async function saldoDe(pool, negocioId) {
    await asegurarTablas(pool);
    const fila = (await pool.query(`SELECT saldo, comprados_total, consumidos_total FROM public.timbres_saldo WHERE negocio_id = $1`, [negocioId])).rows[0];
    return { saldo: fila ? fila.saldo : 0, comprados: fila ? fila.comprados_total : 0, consumidos: fila ? fila.consumidos_total : 0 };
}

async function movimientoReciente(pool, negocioId, limite = 12) {
    await asegurarTablas(pool);
    return (await pool.query(`SELECT tipo, cantidad, saldo_despues, nota, created_at FROM public.timbres_movimientos WHERE negocio_id = $1 ORDER BY id DESC LIMIT $2`, [negocioId, limite])).rows;
}

// Suma timbres (compra, regalo, reembolso, ajuste) de forma atomica. Una compra con la misma referencia solo se acredita una vez.
async function acreditar(pool, { negocioId, cantidad, tipo, referencia = null, centavos = null, nota = null }) {
    await asegurarTablas(pool);
    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");
        if (tipo === "compra" && referencia) {
            const ya = (await cliente.query(`SELECT 1 FROM public.timbres_movimientos WHERE tipo = 'compra' AND referencia = $1`, [referencia])).rows[0];
            if (ya) { await cliente.query("ROLLBACK"); return { ok: true, repetido: true }; }
        }
        const fila = (await cliente.query(
            `INSERT INTO public.timbres_saldo (negocio_id, saldo, comprados_total) VALUES ($1, $2, $3)
             ON CONFLICT (negocio_id) DO UPDATE SET saldo = public.timbres_saldo.saldo + EXCLUDED.saldo,
                 comprados_total = public.timbres_saldo.comprados_total + EXCLUDED.comprados_total,
                 aviso_bajo_enviado_at = NULL, updated_at = NOW()
             RETURNING saldo`,
            [negocioId, cantidad, (tipo === "compra" || tipo === "regalo") ? cantidad : 0]
        )).rows[0];
        await cliente.query(
            `INSERT INTO public.timbres_movimientos (negocio_id, tipo, cantidad, saldo_despues, referencia, monto_centavos, nota) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [negocioId, tipo, cantidad, fila.saldo, referencia, centavos, nota]
        );
        await cliente.query("COMMIT");
        return { ok: true, saldo: fila.saldo };
    } catch (error) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }
}

// Reserva 1 timbre antes de timbrar. { ok:false } si no hay saldo. Con el interruptor apagado siempre responde ok sin tocar nada.
async function reservar(pool, negocioId, referencia = null) {
    if (!(await activoPara(pool, negocioId))) return { ok: true, sinCobro: true };
    await asegurarTablas(pool);
    const fila = (await pool.query(
        `UPDATE public.timbres_saldo SET saldo = saldo - 1, consumidos_total = consumidos_total + 1, updated_at = NOW()
         WHERE negocio_id = $1 AND saldo > 0 RETURNING saldo`, [negocioId]
    )).rows[0];
    if (!fila) return { ok: false, saldo: 0 };
    await pool.query(`INSERT INTO public.timbres_movimientos (negocio_id, tipo, cantidad, saldo_despues, referencia, nota) VALUES ($1,'consumo',-1,$2,$3,'Factura timbrada')`, [negocioId, fila.saldo, referencia]);
    return { ok: true, saldo: fila.saldo };
}

// Si el PAC rechazo el timbrado, el timbre vuelve.
async function devolver(pool, negocioId, motivo = "El SAT o el PAC rechazaron la factura") {
    if (!(await activoPara(pool, negocioId))) return;
    await pool.query(`UPDATE public.timbres_saldo SET saldo = saldo + 1, consumidos_total = GREATEST(0, consumidos_total - 1), updated_at = NOW() WHERE negocio_id = $1`, [negocioId]);
    const s = (await pool.query(`SELECT saldo FROM public.timbres_saldo WHERE negocio_id = $1`, [negocioId])).rows[0];
    await pool.query(`INSERT INTO public.timbres_movimientos (negocio_id, tipo, cantidad, saldo_despues, nota) VALUES ($1,'reembolso',1,$2,$3)`, [negocioId, s ? s.saldo : 0, motivo]);
}

// ¿Puede este negocio facturar? Con el cobro encendido basta con tener saldo; apagado, manda el plan como siempre.
async function puedeFacturar(pool, negocioId, funcionDelPlan) {
    if (await activoPara(pool, negocioId)) return true;
    return Boolean((await funcionDelPlan(negocioId, "facturacion.cfdi")).incluido);
}
async function hayTimbres(pool, negocioId) {
    if (!(await activoPara(pool, negocioId))) return true;
    return (await saldoDe(pool, negocioId)).saldo > 0;
}

// Resumen para la pantalla de Facturacion.
async function resumen(pool, negocioId) {
    if (!(await activoPara(pool, negocioId))) return { habilitado: false };
    const { saldo, comprados, consumidos } = await saldoDe(pool, negocioId);
    return { habilitado: true, demo: await esDemo(pool, negocioId), saldo, comprados, consumidos, bajo: saldo <= AVISO_SALDO_BAJO, paquetes: PAQUETES.map(p => ({ id: p.id, timbres: p.timbres, precio: p.centavos / 100, porTimbre: Math.round(p.centavos / p.timbres) / 100 })), movimientos: await movimientoReciente(pool, negocioId) };
}

// Una sesion de Stripe pagada se convierte en timbres (la llaman el webhook y la confirmacion al volver de pagar).
async function acreditarDesdeSesion(pool, sesion) {
    const m = sesion && sesion.metadata ? sesion.metadata : {};
    if (m.tipo !== "timbres" || sesion.payment_status !== "paid") return { ok: false, ignorada: true };
    const paquete = paquetePorId(m.paquete);
    const negocioId = Number(m.negocio_id);
    if (!paquete || !Number.isInteger(negocioId)) return { ok: false, ignorada: true };
    // Lo acreditado sale de NUESTRA lista de paquetes (nunca del metadata), y el monto cobrado debe coincidir.
    if (Number(sesion.amount_total) !== paquete.centavos) return { ok: false, error: "El monto cobrado no coincide con el paquete." };
    return acreditar(pool, { negocioId, cantidad: paquete.timbres, tipo: "compra", referencia: sesion.id, centavos: paquete.centavos, nota: `Paquete de ${paquete.timbres} timbres` });
}

// Compra de demostracion: suma los timbres al instante, sin Stripe y sin cobrar nada.
async function comprarDemo(pool, negocioId, paquete) {
    return acreditar(pool, { negocioId, cantidad: paquete.timbres, tipo: "compra", referencia: `demo-${negocioId}-${Date.now()}`, centavos: 0, nota: `Compra de demostración: ${paquete.timbres} timbres (no se cobró)` });
}

module.exports = { olvidarDemo: () => cacheDemo.clear(), esDemo, activoPara, comprarDemo, PAQUETES, AVISO_SALDO_BAJO, habilitado, paquetePorId, asegurarTablas, saldoDe, acreditar, reservar, devolver, puedeFacturar, hayTimbres, resumen, acreditarDesdeSesion };

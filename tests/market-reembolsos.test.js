// Reembolso automatico de pedidos de Nexo Market pagados con tarjeta que se
// cancelan. Todo con un cliente de Stripe FALSO: jamas se toca Stripe real
// (la cuenta esta en modo real, ver market-reembolsos.js).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { reembolsarPedidoMarket, pedidoNecesitaReembolso } = require("../market-reembolsos");

let negocio;
let contador = 0;

before(async () => {
    // Levantar el servidor aplica las migraciones (columnas de reembolso).
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("market-reembolsos");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

async function crearPedido({ pagado = true, intento = "pi_prueba_" + Date.now() + "_" + (++contador), estado = "cancelado", total = 339 } = {}) {
    const sufijo = `${Date.now()}${++contador}`;
    const fila = await pool.query(
        `INSERT INTO public.pedidos_market
            (negocio_id, grupo_id, cliente_nombre, cliente_correo, estado, codigo_recogida, total, pagado, stripe_payment_intent_id)
         VALUES ($1, $2, 'Cliente Prueba', '', $3, $4, $5, $6, $7)
         RETURNING *`,
        [negocio.negocioId, `GRP-${sufijo}`, estado, `NXT-${sufijo}`, total, pagado, pagado ? intento : null]
    );
    return fila.rows[0];
}

function stripeFalso({ falla = null } = {}) {
    const llamadas = [];
    return {
        llamadas,
        refunds: {
            create: async (params, opciones) => {
                llamadas.push({ params, opciones });
                if (falla) throw new Error(falla);
                return { id: `re_falso_${llamadas.length}` };
            }
        }
    };
}

async function filaPedido(id) {
    return (await pool.query(`SELECT * FROM public.pedidos_market WHERE id = $1`, [id])).rows[0];
}

test("pedido pagado y cancelado se reembolsa completo, con la comision y la transferencia a la tienda", async () => {
    const pedido = await crearPedido();
    const stripe = stripeFalso();

    const resultado = await reembolsarPedidoMarket(pool, pedido, { stripe, alertar: async () => assert.fail("no debe alertar") });

    assert.equal(resultado.estado, "reembolsado");
    assert.equal(stripe.llamadas.length, 1);

    const { params, opciones } = stripe.llamadas[0];
    assert.equal(params.payment_intent, pedido.stripe_payment_intent_id);
    assert.equal(params.reverse_transfer, true, "recupera el dinero de la tienda, no de Nexo");
    assert.equal(params.refund_application_fee, true, "tambien devuelve el 3% de comision");
    assert.equal(params.amount, undefined, "sin monto = reembolso total");
    assert.equal(opciones.idempotencyKey, `reembolso-pedido-market-${pedido.id}`);

    const guardado = await filaPedido(pedido.id);
    assert.ok(guardado.reembolsado_at);
    assert.equal(guardado.reembolso_stripe_id, "re_falso_1");
    assert.equal(guardado.reembolso_error, null);
});

test("un pedido ya reembolsado no se vuelve a reembolsar", async () => {
    const pedido = await crearPedido();
    await reembolsarPedidoMarket(pool, pedido, { stripe: stripeFalso() });

    const yaReembolsado = await filaPedido(pedido.id);
    const stripe = stripeFalso();
    const resultado = await reembolsarPedidoMarket(pool, yaReembolsado, { stripe });

    assert.equal(resultado.estado, "no_aplica");
    assert.equal(stripe.llamadas.length, 0);
});

test("un pedido que nunca se pago con tarjeta no genera reembolso", async () => {
    const sinPago = await crearPedido({ pagado: false });
    const stripe = stripeFalso();

    assert.equal(pedidoNecesitaReembolso(sinPago), false);
    assert.equal((await reembolsarPedidoMarket(pool, sinPago, { stripe })).estado, "no_aplica");

    // pagado pero sin PaymentIntent registrado: no hay nada que devolver por Stripe
    const sinIntento = { ...(await crearPedido({ pagado: false })), pagado: true };
    assert.equal((await reembolsarPedidoMarket(pool, sinIntento, { stripe })).estado, "no_aplica");

    assert.equal(stripe.llamadas.length, 0);
    assert.equal((await filaPedido(sinPago.id)).reembolsado_at, null);
});

test("si Stripe falla, el error queda anotado y se avisa al operador (el pedido sigue cancelado)", async () => {
    const pedido = await crearPedido({ total: 1250.5 });
    const alertas = [];

    const resultado = await reembolsarPedidoMarket(pool, pedido, {
        stripe: stripeFalso({ falla: "Stripe esta caido" }),
        alertar: async datos => { alertas.push(datos); }
    });

    assert.equal(resultado.estado, "fallido");

    const guardado = await filaPedido(pedido.id);
    assert.equal(guardado.reembolsado_at, null, "no se marca como reembolsado si no lo fue");
    assert.equal(guardado.reembolso_error, "Stripe esta caido");
    assert.equal(guardado.estado, "cancelado");

    assert.equal(alertas.length, 1);
    assert.match(alertas[0].ruta, /REEMBOLSO PENDIENTE/);
    assert.match(alertas[0].mensaje, /1250\.50/);
    assert.match(alertas[0].mensaje, new RegExp(pedido.stripe_payment_intent_id));
    assert.equal(alertas[0].negocioId, negocio.negocioId);

    // Un reintento posterior que si funcione limpia el error.
    const reintento = await reembolsarPedidoMarket(pool, pedido, { stripe: stripeFalso() });
    assert.equal(reintento.estado, "reembolsado");
    assert.equal((await filaPedido(pedido.id)).reembolso_error, null);
});

test("sin Stripe configurado tampoco truena: queda como fallido y avisa", async () => {
    const pedido = await crearPedido();
    const alertas = [];

    const resultado = await reembolsarPedidoMarket(pool, pedido, { stripe: null, alertar: async datos => { alertas.push(datos); } });

    assert.equal(resultado.estado, "fallido");
    assert.equal(alertas.length, 1);
    assert.match((await filaPedido(pedido.id)).reembolso_error, /Stripe no esta configurado/);
});

test("si hasta la alerta falla, el reembolso fallido no tumba a quien llama", async () => {
    const pedido = await crearPedido();

    const resultado = await reembolsarPedidoMarket(pool, pedido, {
        stripe: stripeFalso({ falla: "boom" }),
        alertar: async () => { throw new Error("correo caido"); }
    });

    assert.equal(resultado.estado, "fallido");
});

test("la tienda rechaza un pedido NO pagado: se cancela como siempre y no hay reembolso", async () => {
    const pedido = await crearPedido({ pagado: false, estado: "pendiente" });

    const respuesta = await fetch(`${BASE_URL}/negocio-actual/pedidos-market/${pedido.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token },
        body: JSON.stringify({ accion: "rechazar", motivo: "Sin existencias" })
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.pedido.estado, "cancelado");
    assert.equal(datos.pedido.reembolsado, false);
    assert.equal(datos.reembolso, "no_aplica");
});

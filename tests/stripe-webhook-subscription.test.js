// Bug real encontrado en la auditoria de lanzamiento (2026-08-26):
// customer.subscription.updated nunca leia el status real de la
// suscripcion -- una suscripcion que Stripe ya daba por perdida
// ('unpaid', reintentos agotados; o 'canceled' sin pasar por
// customer.subscription.deleted) nunca bloqueaba el acceso del
// negocio. No necesita servidor HTTP ni firma real de Stripe --
// procesarEventoStripe() esta exportado directo para poder probarse
// asi, con un evento sintetico con la forma real que manda Stripe.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { procesarEventoStripe } = require("../stripe-server");

let negocio;
const stripeCustomerId = "cus_prueba_" + Date.now();

before(async () => {
    negocio = await crearNegocioPrueba("stripe-webhook-subscription");

    await pool.query(
        `INSERT INTO public.licencias (negocio_id, estado, plan, stripe_customer_id)
         VALUES ($1, 'activa', 'plus', $2)
         ON CONFLICT (negocio_id) DO UPDATE SET estado = 'activa', stripe_customer_id = $2`,
        [negocio.negocioId, stripeCustomerId]
    );
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await pool.end();
});

function eventoSuscripcionActualizada(status) {
    return {
        type: "customer.subscription.updated",
        data: {
            object: {
                customer: stripeCustomerId,
                status,
                items: { data: [] }
            }
        }
    };
}

async function estadoLicencia() {
    const resultado = await pool.query(
        `SELECT estado FROM public.licencias WHERE negocio_id = $1`,
        [negocio.negocioId]
    );
    return resultado.rows[0]?.estado;
}

test("'unpaid' (reintentos de Stripe agotados) bloquea la licencia", async () => {
    await procesarEventoStripe(pool, null, eventoSuscripcionActualizada("unpaid"));
    assert.equal(await estadoLicencia(), "cancelada");
});

test("'canceled' bloquea la licencia igual que customer.subscription.deleted", async () => {
    await pool.query(`UPDATE public.licencias SET estado = 'activa' WHERE negocio_id = $1`, [negocio.negocioId]);
    await procesarEventoStripe(pool, null, eventoSuscripcionActualizada("canceled"));
    assert.equal(await estadoLicencia(), "cancelada");
});

test("'past_due' (Stripe todavia reintentando) NO toca el acceso -- el periodo de gracia interno sigue mandando", async () => {
    await pool.query(`UPDATE public.licencias SET estado = 'activa' WHERE negocio_id = $1`, [negocio.negocioId]);
    await procesarEventoStripe(pool, null, eventoSuscripcionActualizada("past_due"));
    assert.equal(await estadoLicencia(), "activa");
});

test("'active' tampoco toca estado -- la reactivacion real la hace invoice.paid, no este evento", async () => {
    await pool.query(`UPDATE public.licencias SET estado = 'activa' WHERE negocio_id = $1`, [negocio.negocioId]);
    await procesarEventoStripe(pool, null, eventoSuscripcionActualizada("active"));
    assert.equal(await estadoLicencia(), "activa");
});

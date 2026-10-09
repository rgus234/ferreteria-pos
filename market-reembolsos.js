// Reembolso automatico de un pedido de Nexo Market pagado con tarjeta cuando
// se cancela (el cliente lo cancela estando "pendiente", o la tienda lo
// rechaza / cancela).
//
// El cobro es un "destination charge" (stripe-connect-server.js): la
// plataforma cobra, se queda con application_fee_amount (3%) y transfiere el
// resto a la cuenta de la tienda. Por eso el reembolso lleva
//   - reverse_transfer: true      -> recupera de la tienda lo que ya se le
//                                    transfirio, en vez de que lo ponga Nexo
//   - refund_application_fee: true -> la comision del 3% tambien se devuelve
// y el cliente recibe el 100% de lo que pago.
//
// Politica (decidida por el dueño): siempre se devuelve el 100%. Sin
// confirmacion manual.
//
// Orden a proposito: primero se cancela el pedido (eso ya lo hizo quien
// llama) y DESPUES se reembolsa. Si Stripe esta caido, la tienda igual puede
// cancelar y dejar de preparar el pedido; el reembolso fallido queda anotado
// (reembolso_error) y se le avisa por correo al operador para devolverlo a
// mano. Lo contrario (no cancelar hasta que Stripe responda) dejaria a la
// tienda atorada con un pedido que ya no quiere cumplir.

const { obtenerStripe } = require("./stripe-connect-server");
const { enviarCorreoAlertaError } = require("./email");

function pedidoNecesitaReembolso(pedido) {
    return Boolean(pedido?.pagado && pedido.stripe_payment_intent_id && !pedido.reembolsado_at);
}

// Regresa { estado, id?, error? } con estado "no_aplica" | "reembolsado" |
// "fallido". Nunca lanza: quien llama ya cancelo el pedido y debe poder
// seguir con correos y respuesta pase lo que pase.
//
// stripe y alertar son inyectables para poder probarlo sin tocar Stripe real.
async function reembolsarPedidoMarket(pool, pedido, { stripe = obtenerStripe(), alertar = enviarCorreoAlertaError } = {}) {
    if (!pedidoNecesitaReembolso(pedido)) return { estado: "no_aplica" };

    try {
        if (!stripe) throw new Error("Stripe no esta configurado en este servidor");

        const reembolso = await stripe.refunds.create(
            {
                payment_intent: pedido.stripe_payment_intent_id,
                reverse_transfer: true,
                refund_application_fee: true,
                metadata: { pedido_market_id: String(pedido.id), codigo_recogida: String(pedido.codigo_recogida || "") }
            },
            // Una sola llave por pedido: aunque la peticion se repita (doble
            // clic, reintento de red) Stripe no devuelve el dinero dos veces.
            { idempotencyKey: `reembolso-pedido-market-${pedido.id}` }
        );

        await pool.query(
            `UPDATE public.pedidos_market
             SET reembolsado_at = NOW(), reembolso_stripe_id = $2, reembolso_error = NULL
             WHERE id = $1`,
            [pedido.id, reembolso.id]
        );

        return { estado: "reembolsado", id: reembolso.id };
    } catch (error) {
        const mensaje = error?.message || String(error);

        try {
            await pool.query(
                `UPDATE public.pedidos_market SET reembolso_error = $2 WHERE id = $1`,
                [pedido.id, mensaje.slice(0, 500)]
            );
        } catch (falloGuardar) {
            console.error("No se pudo guardar el error de reembolso:", falloGuardar.message);
        }

        console.error(`Reembolso fallido del pedido de Market ${pedido.id}:`, mensaje);

        // El dinero del cliente sigue cobrado: se avisa al operador para que
        // lo devuelva a mano desde el panel de Stripe.
        try {
            await alertar({
                esNuevo: true,
                veces: 1,
                ruta: `REEMBOLSO PENDIENTE pedido Market ${pedido.id} (${pedido.codigo_recogida})`,
                negocioId: pedido.negocio_id,
                mensaje: `El pedido se cancelo pero el reembolso de $${Number(pedido.total || 0).toFixed(2)} fallo: ${mensaje}. PaymentIntent ${pedido.stripe_payment_intent_id}. Devuelvelo a mano desde Stripe.`,
                stack: error?.stack || null
            });
        } catch (falloAlerta) {
            console.error("No se pudo enviar la alerta de reembolso fallido:", falloAlerta.message);
        }

        return { estado: "fallido", error: mensaje };
    }
}

module.exports = { reembolsarPedidoMarket, pedidoNecesitaReembolso };

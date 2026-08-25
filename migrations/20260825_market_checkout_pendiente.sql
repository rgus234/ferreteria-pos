-- Fix de atomicidad de pagos en Nexo Market: hoy el navegador cobra
-- con Stripe y SOLO DESPUES manda un POST aparte para crear el pedido.
-- Si esa peticion nunca llega (la pestana se cierra, se pierde la
-- conexion), el pago ya se hizo pero ningun pedido queda registrado --
-- ni la tienda se entera, ni el cliente tiene comprobante.
--
-- Esta tabla guarda una foto de los datos del checkout (cliente +
-- carrito) en el momento en que se crea el PaymentIntent, para que el
-- webhook payment_intent.succeeded (que Stripe reintenta de forma
-- confiable, a diferencia del navegador del cliente) pueda crear el
-- pedido si el POST normal nunca llego.
CREATE TABLE IF NOT EXISTS public.market_checkout_pendiente (
    id SERIAL PRIMARY KEY,
    payment_intent_id TEXT NOT NULL UNIQUE,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    datos JSONB NOT NULL,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    procesado BOOLEAN NOT NULL DEFAULT false
);

-- pedidos_market es la cabecera (un pedido puede tener varias filas en
-- pedidos_publicos, una por producto, todas con el mismo
-- payment_intent_id) -- este indice evita que el POST normal del
-- navegador y el respaldo del webhook creen dos cabeceras para el
-- mismo pago si llegan casi al mismo tiempo.
ALTER TABLE public.pedidos_market ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_market_payment_intent
    ON public.pedidos_market (stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL;

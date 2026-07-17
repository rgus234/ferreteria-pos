-- Conecta el sistema de licencias que ya existia (licencias.estado,
-- fecha_vencimiento, gracia_dias) con pagos reales de Stripe. No crea
-- un sistema de suscripciones nuevo -- solo agrega las columnas que
-- necesita el webhook para saber a que cliente/suscripcion de Stripe
-- corresponde cada negocio.

ALTER TABLE public.licencias
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- Idempotencia de webhooks: Stripe puede reintentar la entrega del
-- mismo evento; si ya esta aqui, se ignora en vez de procesarlo dos
-- veces.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
    id TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    procesado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

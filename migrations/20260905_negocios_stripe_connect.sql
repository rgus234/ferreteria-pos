-- Cuenta conectada de Stripe (Connect, tipo Custom) para que cada
-- ferreteria reciba pagos reales de Nexo Market directo a su cuenta,
-- con Nexo cobrando comision automatica (application_fee_amount) en
-- cada transaccion -- ver plan "Nexo Market: pagos reales con Stripe
-- Connect (marketplace, 100% embebido)". No confundir con
-- licencias.stripe_customer_id/stripe_subscription_id (esos son de la
-- suscripcion SaaS del dueno, sin relacion con esto).
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS stripe_connect_requisitos_pendientes JSONB;

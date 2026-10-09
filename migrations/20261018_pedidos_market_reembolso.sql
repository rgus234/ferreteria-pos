-- Reembolso automatico de pedidos de Nexo Market pagados con tarjeta que se
-- cancelan (ver market-reembolsos.js). Hasta hoy no existia ningun codigo de
-- reembolso: un pedido pagado y cancelado dejaba el cobro en pie.
ALTER TABLE public.pedidos_market ADD COLUMN IF NOT EXISTS reembolsado_at TIMESTAMPTZ;
ALTER TABLE public.pedidos_market ADD COLUMN IF NOT EXISTS reembolso_stripe_id TEXT;
-- Mensaje del ultimo intento fallido (el operador devuelve el dinero a mano).
ALTER TABLE public.pedidos_market ADD COLUMN IF NOT EXISTS reembolso_error TEXT;

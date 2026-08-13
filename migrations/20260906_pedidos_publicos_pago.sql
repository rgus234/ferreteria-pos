-- Datos de pago real (Stripe Connect, destination charge) del pedido --
-- ver plan "Nexo Market: pagos reales con Stripe Connect". Nullable/false
-- por defecto: la mayoria de pedidos de hoy (pedido/cotizacion sin cobro)
-- nunca llenan estas columnas.
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS pagado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC;
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS comision_nexo NUMERIC;

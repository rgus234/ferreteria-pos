-- Politica de envio por tienda (Fase 1, sin pagos): cada dueno declara
-- si entrega, solo vende para recoger en tienda, o entrega con costo
-- fijo -- visible en la ficha de producto y en el carrito de Market.
-- Ver plan "Nexo Market -- Politica de envio por tienda (Fase 1, sin pagos)".
ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS envio_modo TEXT NOT NULL DEFAULT 'a_coordinar',
    ADD COLUMN IF NOT EXISTS envio_tarifa NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS envio_notas TEXT NOT NULL DEFAULT '';

ALTER TABLE public.sitio_web_config DROP CONSTRAINT IF EXISTS sitio_web_config_envio_modo_check;
ALTER TABLE public.sitio_web_config ADD CONSTRAINT sitio_web_config_envio_modo_check
    CHECK (envio_modo IN ('a_coordinar', 'solo_recoleccion', 'tarifa_fija'));

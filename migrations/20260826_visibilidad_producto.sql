-- Fase 8 del plan "Catalogo Maestro Nexo": hoy el unico interruptor de
-- visibilidad es a nivel negocio completo (negocios.visible_en_market)
-- -- no existe forma de ocultar UN producto especifico del POS, de
-- Nexo Market, o de aceptar pedidos por el, sin borrarlo. Default
-- true en los 3 -- reproduce exactamente el comportamiento implicito
-- de hoy (todo visible) para cada producto existente, ningun cambio
-- de comportamiento al aplicar esta migracion.
ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS visible_pos BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS visible_market BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS disponible_pedidos BOOLEAN NOT NULL DEFAULT true;

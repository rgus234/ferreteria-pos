-- Liga cada compra a credito NUEVA con su fila real en historial_ventas
-- (folio, ticket, "Cambiar producto") y registra cuando esa venta
-- especifica queda totalmente liquidada -- para que Reportes solo la
-- cuente hasta que el cliente ya la pago por completo.
--
-- Sin backfill a proposito: las compras a credito ya existentes se
-- quedan con historial_id NULL, exactamente su comportamiento actual
-- (sin folio, sin poder editarse con "Cambiar producto", sin contar
-- en Reportes -- cero regresion).

ALTER TABLE public.movimientos_credito
    ADD COLUMN IF NOT EXISTS historial_id INTEGER REFERENCES public.historial_ventas(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS liquidado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_movimientos_credito_historial
    ON public.movimientos_credito(historial_id)
    WHERE historial_id IS NOT NULL;

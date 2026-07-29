ALTER TABLE public.movimientos_credito
    ADD COLUMN IF NOT EXISTS fecha_vencimiento TIMESTAMPTZ;

-- Las filas 'venta' ya existentes no tienen fecha de vencimiento -- sin
-- este backfill quedarian exentas del calculo de vencido hasta la
-- siguiente compra de cada cliente.
UPDATE public.movimientos_credito
SET fecha_vencimiento = fecha + INTERVAL '15 days'
WHERE tipo = 'venta'
AND fecha_vencimiento IS NULL;

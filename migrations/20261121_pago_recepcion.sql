-- Pago al repartidor al recibir mercancia (abarrotes). Aditiva; el servidor tambien la crea sola (pago-recepcion.js).
ALTER TABLE IF EXISTS public.recepciones_mercancia
    ADD COLUMN IF NOT EXISTS pago_monto NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS pago_metodo TEXT,
    ADD COLUMN IF NOT EXISTS pago_por TEXT,
    ADD COLUMN IF NOT EXISTS pago_nota TEXT,
    ADD COLUMN IF NOT EXISTS pago_at TIMESTAMPTZ;

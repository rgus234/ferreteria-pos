-- Hora de cierre habitual del negocio (opcional). Alimenta el
-- recordatorio de "no olvides cerrar la caja" -- si es NULL, ese
-- recordatorio simplemente no se activa para ese negocio.
ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS hora_cierre TIME;

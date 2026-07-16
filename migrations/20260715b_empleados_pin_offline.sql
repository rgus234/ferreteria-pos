-- Verificador de PIN para cuando el dispositivo no tiene internet
-- (ver comentario en server.js junto a calcularVerificadorPinOffline).

ALTER TABLE public.empleados
    ADD COLUMN IF NOT EXISTS pin_verificador_offline TEXT,
    ADD COLUMN IF NOT EXISTS pin_salt_offline TEXT;

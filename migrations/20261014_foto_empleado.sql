-- Foto de perfil opcional por empleado, para reemplazar el circulo de
-- iniciales en la pantalla de "Quien esta trabajando?" cuando el dueno
-- o el empleado suben una. BYTEA porque el servidor no tiene disco
-- persistente entre deploys (mismo motivo que fotos_producto, ver
-- migrations/20260712_fotos_producto.sql). NULL = sigue usando el
-- circulo de iniciales de siempre.

ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS foto BYTEA;
ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS foto_tipo TEXT;

-- Foto del exhibidor (el mueble o display completo), no solo de sus productos.
-- Se guarda ya reducida (maximo ~480 px) como data URL: una por exhibidor, pocas y chicas.
ALTER TABLE public.exhibidores
    ADD COLUMN IF NOT EXISTS foto TEXT;

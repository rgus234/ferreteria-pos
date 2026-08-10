-- Mapa real de tiendas en Nexo Market (ver plan) -- coordenadas junto a
-- la columna "direccion" que ya existe en negocios y que ya leen las
-- queries de Market. Nulas hasta que el dueno capture y geocodifique
-- una direccion real desde "Sitio web" en el POS.
ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS direccion_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS direccion_lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS direccion_geocodificada_en TIMESTAMPTZ;

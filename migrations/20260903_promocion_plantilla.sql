-- Plantilla y color de acento para el banner de "Promocion" del sitio
-- web por negocio (ver refactor-arquitectura.md, rediseno Sitio web).
-- Reusa las columnas existentes promocion_activa/titulo/texto/enlace/
-- imagen -- esto solo agrega como se dibuja ese banner.
ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS promocion_plantilla TEXT NOT NULL DEFAULT 'clasica',
    ADD COLUMN IF NOT EXISTS promocion_color_acento TEXT,
    ADD COLUMN IF NOT EXISTS promocion_texto_boton TEXT;

ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS mostrar_precios BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS mostrar_existencias BOOLEAN NOT NULL DEFAULT false;

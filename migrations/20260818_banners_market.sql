CREATE TABLE IF NOT EXISTS public.banners_market (
    id SERIAL PRIMARY KEY,
    titulo TEXT NOT NULL,
    subtitulo TEXT NOT NULL DEFAULT '',
    texto_boton TEXT NOT NULL DEFAULT 'Ver ofertas',
    enlace TEXT NOT NULL DEFAULT '/market',
    tema_color TEXT NOT NULL DEFAULT 'azul',
    imagen BYTEA,
    activo BOOLEAN NOT NULL DEFAULT true,
    orden INTEGER NOT NULL DEFAULT 0,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS promocion_imagen BYTEA,
    ADD COLUMN IF NOT EXISTS promocion_imagen_actualizado_at TIMESTAMPTZ;

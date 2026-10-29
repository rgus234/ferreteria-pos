-- Enlazar el celular con QR: codigos de un solo uso que vencen a los 2 minutos (solo se guarda su hash). Aditiva.
-- El servidor tambien la crea sola la primera vez (enlace-celular-server.js).
CREATE TABLE IF NOT EXISTS public.enlaces_celular (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    codigo_hash TEXT NOT NULL,
    expira_at TIMESTAMPTZ NOT NULL,
    usado_at TIMESTAMPTZ,
    sesion_id INTEGER,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS enlaces_celular_codigo_idx ON public.enlaces_celular (codigo_hash) WHERE usado_at IS NULL;

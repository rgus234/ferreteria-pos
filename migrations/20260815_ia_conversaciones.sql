CREATE TABLE IF NOT EXISTS public.ia_conversaciones (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    titulo TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ia_conversaciones_negocio_idx
    ON public.ia_conversaciones (negocio_id, actualizado_en DESC);

CREATE TABLE IF NOT EXISTS public.ia_mensajes (
    id SERIAL PRIMARY KEY,
    conversacion_id INTEGER NOT NULL REFERENCES public.ia_conversaciones(id) ON DELETE CASCADE,
    rol TEXT NOT NULL CHECK (rol IN ('user', 'assistant')),
    contenido TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ia_mensajes_conversacion_idx
    ON public.ia_mensajes (conversacion_id, creado_en ASC);

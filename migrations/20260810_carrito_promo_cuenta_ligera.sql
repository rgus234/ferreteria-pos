ALTER TABLE public.pedidos_publicos
    ADD COLUMN IF NOT EXISTS grupo_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pedidos_publicos_grupo
    ON public.pedidos_publicos (grupo_id) WHERE grupo_id IS NOT NULL;

ALTER TABLE public.clientes_credito
    ADD COLUMN IF NOT EXISTS es_visitante_sitio BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS promocion_activa BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS promocion_titulo TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS promocion_texto TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS promocion_enlace TEXT NOT NULL DEFAULT '';

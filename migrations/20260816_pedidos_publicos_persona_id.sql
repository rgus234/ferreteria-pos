ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS persona_id INTEGER REFERENCES public.personas(id);
CREATE INDEX IF NOT EXISTS idx_pedidos_publicos_persona_id ON public.pedidos_publicos(persona_id) WHERE persona_id IS NOT NULL;

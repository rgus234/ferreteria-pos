ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS origen TEXT CHECK (origen IS NULL OR origen IN ('sitio', 'market'));

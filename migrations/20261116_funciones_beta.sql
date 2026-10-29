-- Funciones nuevas (beta) por negocio: todo apagado por defecto. Aditiva. El servidor tambien la crea sola la primera vez (funciones-beta-server.js).
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS funciones_beta JSONB NOT NULL DEFAULT '{}'::jsonb;

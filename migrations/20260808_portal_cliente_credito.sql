ALTER TABLE public.clientes_credito
    ADD COLUMN IF NOT EXISTS codigo_acceso_hash TEXT,
    ADD COLUMN IF NOT EXISTS codigo_acceso_generado_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.sesiones_cliente_credito (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES public.clientes_credito(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    ip TEXT,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revocado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sesiones_cliente_credito_cliente
    ON public.sesiones_cliente_credito (cliente_id) WHERE revocado_at IS NULL;

CREATE TABLE IF NOT EXISTS public.contactos_landing (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    negocio TEXT NOT NULL DEFAULT '',
    telefono TEXT NOT NULL DEFAULT '',
    correo TEXT NOT NULL DEFAULT '',
    mensaje TEXT NOT NULL DEFAULT '',
    ip TEXT,
    atendido BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contactos_landing_created_at
    ON public.contactos_landing (created_at DESC);

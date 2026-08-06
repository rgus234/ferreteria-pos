-- Capa de identidad "persona" global, desacoplada de negocios --
-- permite que un dueño de negocio y/o cliente de crédito tenga UNA
-- sola cuenta Nexo, sin migrar el login existente de negocios/clientes.
CREATE TABLE IF NOT EXISTS public.personas (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    correo TEXT,
    telefono TEXT,
    password_hash TEXT NOT NULL,
    correo_verificado BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_correo_unico
    ON public.personas (LOWER(correo)) WHERE correo IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_telefono_unico
    ON public.personas (telefono) WHERE telefono IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sesiones_persona (
    id SERIAL PRIMARY KEY,
    persona_id INTEGER NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    dispositivo TEXT,
    ip TEXT,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revocado_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sesiones_persona_persona
    ON public.sesiones_persona (persona_id) WHERE revocado_at IS NULL;

ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS persona_id INTEGER REFERENCES public.personas(id);
ALTER TABLE public.clientes_credito
    ADD COLUMN IF NOT EXISTS persona_id INTEGER REFERENCES public.personas(id);

-- "Olvide mi contrasena" para clientes de Nexo Market (personas) --
-- hasta ahora solo existia para el login de dueño de negocio
-- (restablecimientos_password). Mismo diseño exacto, solo que ligado a
-- personas en vez de negocios: codigo de 6 digitos por correo, hasheado
-- en reposo, expira en 15 minutos.

CREATE TABLE IF NOT EXISTS public.restablecimientos_password_persona (
    id SERIAL PRIMARY KEY,
    persona_id INTEGER NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    expira_at TIMESTAMPTZ NOT NULL,
    usado_at TIMESTAMPTZ,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restablecimientos_password_persona_persona
    ON public.restablecimientos_password_persona(persona_id);

-- Verificacion de correo real para personas (cuenta unificada de Nexo
-- Market / Nexo para negocios), mismo patron exacto que
-- public.verificaciones_correo (negocios), ver 20260714_auth_correo.sql.
-- personas.correo_verificado ya existia (20260813_personas.sql) pero
-- nada la leia ni escribia -- este es el primer uso real.

CREATE TABLE IF NOT EXISTS public.verificaciones_correo_persona (
    id SERIAL PRIMARY KEY,
    persona_id INTEGER NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
    correo TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expira_at TIMESTAMPTZ NOT NULL,
    usado_at TIMESTAMPTZ,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verificaciones_correo_persona_persona ON public.verificaciones_correo_persona(persona_id);

-- Grandfathering: activar el gate de login sin esta linea bloquearia a
-- todas las personas que ya se registraron antes de que existiera la
-- verificacion (todas quedaron en correo_verificado=false por defecto).
UPDATE public.personas
SET correo_verificado = true
WHERE correo IS NOT NULL AND correo_verificado = false;

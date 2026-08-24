-- "Continuar con Google" (pedido por el dueño, 2026-08-24) -- una
-- cuenta creada asi no tiene contraseña propia, asi que password_hash
-- deja de ser NOT NULL. google_id (el "sub" del perfil de Google) es
-- el identificador estable para reencontrar la cuenta en logins
-- futuros; si ya existia una persona con ese correo (creada antes con
-- contraseña normal), se vincula ahi en vez de duplicar la cuenta.

ALTER TABLE public.personas
    ALTER COLUMN password_hash DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS google_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_google_id_unico
    ON public.personas (google_id) WHERE google_id IS NOT NULL;

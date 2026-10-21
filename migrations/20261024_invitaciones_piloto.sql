-- Invitaciones a negocios piloto. Flujo: el negocio llena "Quiero participar" en
-- la pagina publica (contactos_landing) -> el admin acepta y se genera una
-- invitacion con un enlace personal -> el negocio configura su cuenta desde ese
-- enlace (datos precargados) y despues descarga el instalador.
--
-- El token NUNCA se guarda en claro: solo su hash SHA-256 (igual que las
-- verificaciones de correo). El enlace completo solo existe en el correo y en la
-- respuesta de la accion del admin que lo genera.
--
-- Aditiva: tabla nueva y una columna nueva con DEFAULT; no cambia ninguna fila
-- existente.
CREATE TABLE IF NOT EXISTS public.invitaciones_piloto (
    id SERIAL PRIMARY KEY,
    contacto_id INTEGER REFERENCES public.contactos_landing(id) ON DELETE SET NULL,
    token_hash TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    negocio TEXT NOT NULL DEFAULT '',
    correo TEXT NOT NULL,
    telefono TEXT NOT NULL DEFAULT '',
    giro TEXT NOT NULL DEFAULT '',
    ciudad TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'configurada', 'revocada')),
    expira_at TIMESTAMPTZ NOT NULL,
    negocio_id INTEGER REFERENCES public.negocios(id) ON DELETE SET NULL,
    enviada_at TIMESTAMPTZ,
    configurada_at TIMESTAMPTZ,
    ultimo_acceso_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitaciones_piloto_contacto
    ON public.invitaciones_piloto (contacto_id, id DESC);

-- "Descartada": el admin decidio no invitar a esta solicitud.
ALTER TABLE public.contactos_landing
    ADD COLUMN IF NOT EXISTS descartada BOOLEAN NOT NULL DEFAULT false;

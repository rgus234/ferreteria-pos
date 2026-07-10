-- Registro de auditoria: cada vez que asegurarNegocioActual() crea un negocio
-- nuevo en silencio (codigo de negocio no reconocido), queda un rastro aqui.
-- No cambia el comportamiento existente, solo agrega visibilidad.

CREATE TABLE IF NOT EXISTS public.tenant_auto_provision_log (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES public.negocios(id) ON DELETE CASCADE,
    slug_recibido TEXT,
    ip TEXT,
    user_agent TEXT,
    headers JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

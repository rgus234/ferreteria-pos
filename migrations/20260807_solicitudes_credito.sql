ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS aceptar_solicitudes_credito BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.solicitudes_credito (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL DEFAULT '',
    correo TEXT NOT NULL DEFAULT '',
    direccion TEXT NOT NULL DEFAULT '',
    monto_solicitado NUMERIC(12,2),
    comentario TEXT NOT NULL DEFAULT '',
    ine_frente BYTEA,
    ine_frente_tipo TEXT NOT NULL DEFAULT 'image/jpeg',
    ine_reverso BYTEA,
    ine_reverso_tipo TEXT NOT NULL DEFAULT 'image/jpeg',
    consentimiento_datos_sensibles BOOLEAN NOT NULL DEFAULT false,
    ip TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revisada_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_credito_negocio
    ON public.solicitudes_credito (negocio_id, estado, created_at DESC);

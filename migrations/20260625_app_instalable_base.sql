-- Base para app instalable Windows, licencias, dispositivos,
-- actualizaciones y sincronizacion local/nube.

CREATE TABLE IF NOT EXISTS public.licencias (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    estado TEXT NOT NULL DEFAULT 'activa',
    plan TEXT NOT NULL DEFAULT 'demo',
    fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_vencimiento TIMESTAMPTZ,
    gracia_dias INTEGER NOT NULL DEFAULT 15,
    ultimo_pago_at TIMESTAMPTZ,
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id)
);

CREATE TABLE IF NOT EXISTS public.dispositivos (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    nombre_equipo TEXT,
    plataforma TEXT NOT NULL DEFAULT 'windows',
    app_version TEXT,
    estado TEXT NOT NULL DEFAULT 'activo',
    ultimo_checkin_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, device_id)
);

CREATE TABLE IF NOT EXISTS public.sync_eventos (
    id BIGSERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    entidad TEXT,
    entidad_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    estado TEXT NOT NULL DEFAULT 'recibido',
    recibido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aplicado_at TIMESTAMPTZ,
    error TEXT,
    UNIQUE (negocio_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_eventos_negocio_recibido
ON public.sync_eventos (negocio_id, recibido_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_eventos_negocio_device
ON public.sync_eventos (negocio_id, device_id);

CREATE TABLE IF NOT EXISTS public.app_versiones (
    id SERIAL PRIMARY KEY,
    version TEXT NOT NULL,
    canal TEXT NOT NULL DEFAULT 'stable',
    plataforma TEXT NOT NULL DEFAULT 'windows',
    url_descarga TEXT,
    notas TEXT,
    obligatoria BOOLEAN NOT NULL DEFAULT false,
    publicada BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (version, canal, plataforma)
);

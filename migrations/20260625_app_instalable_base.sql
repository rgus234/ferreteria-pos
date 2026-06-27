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

ALTER TABLE public.licencias
ADD COLUMN IF NOT EXISTS monto_mensual NUMERIC(12,2) NOT NULL DEFAULT 0;

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

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS sync_pendientes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS sync_errores INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS sync_ultimo_error TEXT;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS local_stats JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS os_version TEXT;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS arch TEXT;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS update_latest_version TEXT;

ALTER TABLE public.dispositivos
ADD COLUMN IF NOT EXISTS update_available BOOLEAN NOT NULL DEFAULT false;

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

ALTER TABLE public.app_versiones
ADD COLUMN IF NOT EXISTS archivo TEXT;

ALTER TABLE public.app_versiones
ADD COLUMN IF NOT EXISTS sha512 TEXT;

ALTER TABLE public.app_versiones
ADD COLUMN IF NOT EXISTS tamano_bytes BIGINT;

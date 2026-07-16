-- Vinculacion de equipo (dispositivos_vinculados) y empleados con PIN
-- sincronizado (empleados), reemplazando el cajero 100% local que
-- vivia solo en localStorage por computadora.

CREATE TABLE IF NOT EXISTS public.dispositivos_vinculados (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    nombre_dispositivo TEXT,
    vinculado_por_correo TEXT,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revocado_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dispositivos_vinculados_negocio ON public.dispositivos_vinculados(negocio_id);

CREATE TABLE IF NOT EXISTS public.empleados (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'Cajero',
    pin_hash TEXT NOT NULL,
    color_avatar TEXT NOT NULL DEFAULT '#0d6efd',
    activo BOOLEAN NOT NULL DEFAULT true,
    permisos JSONB NOT NULL DEFAULT '{}'::jsonb,
    widgets JSONB NOT NULL DEFAULT '{}'::jsonb,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_empleados_negocio ON public.empleados(negocio_id);
CREATE INDEX IF NOT EXISTS idx_empleados_negocio_activo ON public.empleados(negocio_id) WHERE activo = true;

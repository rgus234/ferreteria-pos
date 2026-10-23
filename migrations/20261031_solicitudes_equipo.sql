-- Solicitudes de informacion/cotizacion de equipos (impresoras, lectores) desde la pagina oficial.
-- Separadas de contactos_landing (esas son solicitudes para probar Nexo y alimentan las invitaciones).

CREATE TABLE IF NOT EXISTS public.solicitudes_equipo (
    id SERIAL PRIMARY KEY,
    equipo_id TEXT NOT NULL,
    equipo_clave TEXT NOT NULL DEFAULT '',
    equipo_nombre TEXT NOT NULL DEFAULT '',
    cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 999),
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL DEFAULT '',
    correo TEXT NOT NULL DEFAULT '',
    ciudad TEXT NOT NULL DEFAULT '',
    mensaje TEXT NOT NULL DEFAULT '',
    atendida BOOLEAN NOT NULL DEFAULT false,
    ip TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_equipo_fecha ON public.solicitudes_equipo (created_at DESC);

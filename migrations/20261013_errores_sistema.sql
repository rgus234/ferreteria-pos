-- Seguimiento de errores de produccion (ver plan "Alertas de errores en
-- produccion + panel de administrador"). Hasta ahora un error solo
-- llegaba a console.error (logs de Render que nadie revisa) -- esta
-- tabla es el primer registro real, agrupado por "huella" (hash de
-- ruta+mensaje) para que el mismo bug repetido sea UNA fila con
-- contador, no una fila nueva cada vez.
CREATE TABLE IF NOT EXISTS public.errores_sistema (
    id SERIAL PRIMARY KEY,
    huella TEXT NOT NULL UNIQUE,
    ruta TEXT NOT NULL,
    negocio_id INTEGER REFERENCES public.negocios(id) ON DELETE SET NULL,
    mensaje TEXT NOT NULL,
    stack TEXT,
    veces INTEGER NOT NULL DEFAULT 1,
    primera_vez TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultima_vez TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notificado_at TIMESTAMPTZ,
    resuelto BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_errores_sistema_resuelto_ultima_vez
    ON public.errores_sistema (resuelto, ultima_vez DESC);

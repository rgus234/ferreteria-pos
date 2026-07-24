-- Bitacora de respaldos automaticos de la base de datos (no guarda
-- los datos en si -- eso se manda por correo -- solo el registro de
-- que corrio, cuando y si salio bien).
CREATE TABLE IF NOT EXISTS public.respaldos_automaticos (
    id SERIAL PRIMARY KEY,
    fecha DATE NOT NULL,
    exito BOOLEAN NOT NULL,
    tamano_bytes INTEGER,
    tablas_respaldadas INTEGER,
    mensaje_error TEXT,
    duracion_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_respaldos_automaticos_fecha
    ON public.respaldos_automaticos (fecha DESC);

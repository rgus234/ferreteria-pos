-- Importacion masiva del Banco de imagenes (Banco de Nexo) pasa a
-- procesarse en segundo plano -- mismo patron ya usado por
-- catalogo_pdf_trabajos. Antes, /admin/api/banco-imagenes/importar-lote
-- comprimia todas las fotos del zip dentro de la misma peticion HTTP;
-- para zips grandes eso tardaba mas que el timeout del proxy de
-- produccion y la subida se caia (502/520) aunque el archivo llegara
-- bien. Ahora la ruta solo guarda el archivo y encola el trabajo; un
-- poller lo procesa aparte.

CREATE TABLE IF NOT EXISTS public.banco_imagenes_importacion_trabajos (
    id SERIAL PRIMARY KEY,
    nombre_archivo TEXT NOT NULL,
    ruta_temporal TEXT NOT NULL,
    marca TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'procesando', 'listo', 'error')),
    fotos_guardadas INTEGER,
    solicitudes_resueltas INTEGER,
    errores JSONB,
    mensaje_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banco_imagenes_importacion_trabajos_estado
    ON public.banco_imagenes_importacion_trabajos (estado, created_at);

-- Importacion de catalogos PDF de proveedor: extiende el staging que ya
-- usa el catalogo CSV/Excel (catalogo_productos) con la imagen candidata
-- recortada y la confianza por campo que solo tiene sentido para PDF,
-- extiende plantillas_catalogo para tambien aprender el layout de PDF de
-- cada proveedor (no se duplica el mecanismo ya existente), y agrega la
-- tabla de trabajos en segundo plano que procesa el PDF pagina por pagina.
ALTER TABLE public.catalogo_productos
    ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'csv' CHECK (origen IN ('csv', 'pdf')),
    ADD COLUMN IF NOT EXISTS imagen BYTEA,
    ADD COLUMN IF NOT EXISTS imagen_tipo TEXT DEFAULT 'image/jpeg',
    ADD COLUMN IF NOT EXISTS pagina_pdf INTEGER,
    ADD COLUMN IF NOT EXISTS confianza_codigo TEXT CHECK (confianza_codigo IN ('alta', 'media', 'baja')),
    ADD COLUMN IF NOT EXISTS confianza_descripcion TEXT CHECK (confianza_descripcion IN ('alta', 'media', 'baja')),
    ADD COLUMN IF NOT EXISTS confianza_imagen TEXT CHECK (confianza_imagen IN ('alta', 'media', 'baja')),
    ADD COLUMN IF NOT EXISTS confianza_precio TEXT CHECK (confianza_precio IN ('alta', 'media', 'baja')),
    ADD COLUMN IF NOT EXISTS estado_extraccion TEXT NOT NULL DEFAULT 'completo'
        CHECK (estado_extraccion IN ('completo', 'revision', 'no_identificado'));

CREATE INDEX IF NOT EXISTS idx_catalogo_productos_estado_extraccion
    ON public.catalogo_productos (catalogo_id, estado_extraccion);

-- formato distingue plantilla de mapeo CSV (mapeo = campo -> texto de
-- encabezado) de plantilla de layout PDF (mapeo = grid/bandas/regex
-- aprendidos) -- mismo proveedor puede tener ambas sin chocar.
ALTER TABLE public.plantillas_catalogo
    ADD COLUMN IF NOT EXISTS formato TEXT NOT NULL DEFAULT 'csv' CHECK (formato IN ('csv', 'pdf'));

ALTER TABLE public.plantillas_catalogo
    DROP CONSTRAINT IF EXISTS plantillas_catalogo_negocio_id_proveedor_normalizado_key;
ALTER TABLE public.plantillas_catalogo
    DROP CONSTRAINT IF EXISTS plantillas_catalogo_negocio_proveedor_formato_key;
ALTER TABLE public.plantillas_catalogo
    ADD CONSTRAINT plantillas_catalogo_negocio_proveedor_formato_key
        UNIQUE (negocio_id, proveedor_normalizado, formato);

CREATE TABLE IF NOT EXISTS public.catalogo_pdf_trabajos (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    catalogo_id INTEGER REFERENCES public.catalogos_proveedor(id) ON DELETE CASCADE,
    proveedor TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    ruta_temporal TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'procesando', 'listo', 'error')),
    total_paginas INTEGER,
    pagina_actual INTEGER NOT NULL DEFAULT 0,
    total_productos INTEGER,
    productos_completos INTEGER,
    productos_revision INTEGER,
    productos_no_identificados INTEGER,
    llamadas_ia INTEGER NOT NULL DEFAULT 0,
    mensaje_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_pdf_trabajos_estado
    ON public.catalogo_pdf_trabajos (estado);
CREATE INDEX IF NOT EXISTS idx_catalogo_pdf_trabajos_negocio
    ON public.catalogo_pdf_trabajos (negocio_id);

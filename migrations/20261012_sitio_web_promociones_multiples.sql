-- Varias promociones por negocio (antes solo se podia tener una activa
-- a la vez, guardada como columnas sueltas en sitio_web_config). Cada
-- promocion ahora es su propia fila, con su propia imagen y su propia
-- duracion en pantalla -- se rotan solas en el sitio publico. La
-- animacion de transicion es una sola preferencia por negocio (no por
-- promocion), por eso vive en sitio_web_config.
CREATE TABLE IF NOT EXISTS public.sitio_web_promociones (
    id SERIAL PRIMARY KEY,
    negocio_id INT NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    texto TEXT NOT NULL DEFAULT '',
    texto_boton TEXT NOT NULL DEFAULT '',
    enlace TEXT NOT NULL DEFAULT '',
    plantilla TEXT NOT NULL DEFAULT 'clasica'
        CHECK (plantilla IN ('clasica', 'imagen-fondo', 'dividida', 'minimal')),
    color_acento TEXT,
    imagen BYTEA,
    imagen_actualizado_at TIMESTAMPTZ,
    duracion_segundos INT NOT NULL DEFAULT 8 CHECK (duracion_segundos BETWEEN 3 AND 60),
    orden INT NOT NULL DEFAULT 0,
    activa BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sitio_web_promociones_negocio ON public.sitio_web_promociones (negocio_id, orden);

ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS promocion_animacion TEXT NOT NULL DEFAULT 'fundido'
        CHECK (promocion_animacion IN ('arriba', 'abajo', 'lado', 'fundido'));

-- Migra la promocion unica que ya tuviera cada negocio a la tabla
-- nueva, como su primera fila -- nadie pierde la promocion que ya
-- tenia configurada. Las columnas viejas de sitio_web_config se dejan
-- tal cual (no se borran, no se leen mas desde el codigo nuevo).
INSERT INTO public.sitio_web_promociones
    (negocio_id, titulo, texto, texto_boton, enlace, plantilla, color_acento, imagen, imagen_actualizado_at, activa, orden)
SELECT
    negocio_id,
    promocion_titulo,
    COALESCE(promocion_texto, ''),
    COALESCE(promocion_texto_boton, ''),
    COALESCE(promocion_enlace, ''),
    COALESCE(promocion_plantilla, 'clasica'),
    promocion_color_acento,
    promocion_imagen,
    promocion_imagen_actualizado_at,
    COALESCE(promocion_activa, false),
    0
FROM public.sitio_web_config
WHERE promocion_titulo IS NOT NULL AND promocion_titulo <> '';

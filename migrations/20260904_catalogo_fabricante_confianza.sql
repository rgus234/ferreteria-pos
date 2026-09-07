-- Trazabilidad de COMO se leyo cada precio del catalogo de fabricante.
--
-- El dueno lo pidio con una distincion importante: "89% procesado" no es
-- lo mismo que "89% correcto". Para poder medir lo segundo hace falta
-- saber, producto por producto, de donde salio su precio y con que
-- confianza, no solo que la corrida termino.

ALTER TABLE public.catalogo_fabricante_productos
    -- Como se leyo: ocr (tesseract solo), vision (la IA rescato el modulo
    -- que el OCR no pudo), sin_precios_publicados (el fabricante deja la
    -- columna vacia), manual (una persona lo corrigio a mano).
    ADD COLUMN IF NOT EXISTS origen_lectura TEXT NOT NULL DEFAULT ''
        CHECK (origen_lectura IN ('', 'ocr', 'vision', 'sin_precios_publicados', 'manual')),
    -- Layout de la tabla de la que salio: filas (un producto por fila),
    -- transpuesta (un producto por columna), columna_vacia, o
    -- precio_por_bloque (que nunca deberia llegar a guardarse).
    ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS confianza TEXT NOT NULL DEFAULT ''
        CHECK (confianza IN ('', 'alta', 'media', 'baja')),
    -- Que precios de la variante NO venian publicados. Se guarda explicito
    -- para no confundir "el fabricante no lo publica" con "no lo supimos
    -- leer" al mirar un NULL.
    ADD COLUMN IF NOT EXISTS precios_sin_publicar TEXT NOT NULL DEFAULT '',
    -- Verificado por una persona: una vez marcado, la sincronizacion no
    -- vuelve a bajar su confianza.
    ADD COLUMN IF NOT EXISTS verificado_por_persona BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verificado_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cat_fab_productos_confianza
    ON public.catalogo_fabricante_productos (fabricante, confianza);

-- Mismo detalle a nivel modulo, para la cola de revision: agrupar por
-- motivo real (estructura ambigua vs. precios incompletos) en vez de
-- mostrar una lista plana de errores.
ALTER TABLE public.catalogo_fabricante_modulos
    ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS origen_lectura TEXT NOT NULL DEFAULT '',
    -- estructura_ambigua: no se entendio la tabla (layout raro, precio por
    --   bloque, no concuerdan los codigos) -- requiere que alguien mire.
    -- precios_incompletos: la tabla se entendio pero falto algun importe.
    ADD COLUMN IF NOT EXISTS motivo_revision TEXT NOT NULL DEFAULT ''
        CHECK (motivo_revision IN ('', 'estructura_ambigua', 'precios_incompletos')),
    ADD COLUMN IF NOT EXISTS productos_afectados INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cat_fab_modulos_revision
    ON public.catalogo_fabricante_modulos (fabricante, motivo_revision);

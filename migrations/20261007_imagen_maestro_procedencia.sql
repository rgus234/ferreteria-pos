-- Fase 9 del plan de identidad multi-proveedor: procedencia de la
-- imagen del Catalogo Maestro. Hasta ahora catalogo_maestro_productos
-- guardaba la imagen (bytea) pero nunca de DONDE salio ni que tan
-- confiable es -- sin eso, contribuirOEnlazarCatalogoMaestro no podia
-- saber si una imagen nueva era mejor que la que ya habia, asi que
-- nunca actualizaba una imagen ya puesta (ni para mejorarla).
--
-- imagen_fuente clasifica el origen ('catalogo_proveedor', 'fabricante_oficial',
-- 'negocio'; vacio = como quedaron las filas de antes de esta fase, ya
-- tenian imagen sin procedencia registrada). imagen_confianza es la
-- misma confianza 0-1 que ya calcula el extractor de PDF
-- (confianza_imagen en catalogo_productos) cuando esta disponible.
ALTER TABLE public.catalogo_maestro_productos
ADD COLUMN IF NOT EXISTS imagen_fuente TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS imagen_confianza NUMERIC,
ADD COLUMN IF NOT EXISTS imagen_actualizada_en TIMESTAMPTZ;

-- Las filas que ya traian imagen antes de esta fase (todas via
-- confirmar-producto de un catalogo de proveedor, el unico camino que
-- escribia imagen hasta ahora) quedan clasificadas como tal -- un hecho
-- ya verdadero, no una suposicion nueva.
UPDATE public.catalogo_maestro_productos
SET imagen_fuente = 'catalogo_proveedor', imagen_actualizada_en = updated_at
WHERE imagen IS NOT NULL AND imagen_fuente = '';

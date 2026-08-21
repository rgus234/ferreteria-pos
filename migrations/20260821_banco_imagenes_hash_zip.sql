-- El admin perdia toda visibilidad de la importacion masiva en cuanto
-- refrescaba la pagina: banco_imagenes_importacion_trabajos ya guardaba
-- el resultado de cada ZIP, pero no habia forma de listarlo (solo se
-- consultaba por los ids de la sesion actual del navegador) ni de
-- reconocer un ZIP repetido salvo por nombre+tamano en localStorage,
-- que no sirve entre navegadores/equipos distintos. hash_zip permite una
-- verificacion real, server-side, de "este archivo exacto ya se
-- importo" antes de siquiera subirlo -- y un historial persistente que
-- sobrevive a un refresh.

ALTER TABLE public.banco_imagenes_importacion_trabajos
    ADD COLUMN IF NOT EXISTS hash_zip TEXT;

CREATE INDEX IF NOT EXISTS idx_banco_imagenes_importacion_trabajos_hash
    ON public.banco_imagenes_importacion_trabajos (hash_zip);

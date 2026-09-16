-- Fase 5 del plan de identidad multi-proveedor: recepcion por remision
-- (GAFI entrega la mercancia con una nota de remision impresa; el CFDI
-- real puede llegar varios dias despues por correo). Dos cambios,
-- ambos aditivos:
--
-- 1) recepciones_mercancia.estado distingue una recepcion que ya se dio
--    de alta (stock aplicado) pero todavia espera su factura real, de
--    una recepcion normal ya conciliada con su documento fiscal. Las
--    filas existentes (todas vienen de una factura real o de un alta
--    manual de siempre) quedan 'conciliado' por default -- no cambia
--    nada del historial ya guardado.
--
-- 2) recepciones_inteligentes.origen suma 'remision_foto': una tercera
--    forma de "llegar" una recepcion ademas de 'manual' (XML a mano) y
--    'gmail' (correo detectado solo) -- una foto de la remision
--    interpretada por IA de vision. Comparte exactamente el mismo
--    pipeline de revision/matching/confirmacion que ya usan las otras
--    dos, nunca uno aparte.
ALTER TABLE public.recepciones_mercancia
ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'conciliado';

ALTER TABLE public.recepciones_mercancia
ADD CONSTRAINT recepciones_mercancia_estado_check
CHECK (estado = ANY (ARRAY['recibido_sin_factura'::text, 'conciliado'::text]));

-- Para la busqueda de "hay una remision pendiente de este proveedor
-- que podria corresponder a esta factura" al confirmar un CFDI real.
CREATE INDEX IF NOT EXISTS idx_recepciones_mercancia_pendientes
ON public.recepciones_mercancia (negocio_id, estado)
WHERE estado = 'recibido_sin_factura';

ALTER TABLE public.recepciones_inteligentes
DROP CONSTRAINT recepciones_inteligentes_origen_check;

ALTER TABLE public.recepciones_inteligentes
ADD CONSTRAINT recepciones_inteligentes_origen_check
CHECK (origen = ANY (ARRAY['manual'::text, 'gmail'::text, 'remision_foto'::text]));

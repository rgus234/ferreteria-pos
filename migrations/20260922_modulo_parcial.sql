-- Lectura PARCIAL de un modulo.
--
-- Hasta ahora la validacion era todo o nada: si el OCR no encontraba UNO
-- de los codigos que TRUPER lista para el modulo, se descartaba el modulo
-- entero. Medido sobre la carga real, eso tiraba a la basura:
--
--   113 modulos a los que les faltaba 1 codigo
--    58 a los que les faltaban 2
--    42 a los que les faltaban 3
--
-- El modulo 55301 es el caso perfecto: leyo 36 de 37 filas, todas
-- correctas, y se perdieron las 37. Mirando la imagen, la tabla es
-- perfectamente legible; lo que falla es la regla, no la lectura.
--
-- La distincion que importa:
--   SOBRAN codigos  -> el OCR leyo algo que no es de este modulo. Puede
--                      haber emparejado un precio con el producto
--                      equivocado. Se rechaza TODO, como hasta ahora.
--   FALTAN codigos  -> se leyeron menos productos, no productos malos.
--                      Cada fila aceptada tiene su codigo confirmado
--                      contra la fuente en texto de TRUPER.
--
-- 'parcial' guarda la firma (el trabajo se aplico, no hay que releerlo en
-- cada corrida) pero sigue contando como pendiente de revision, para que
-- los productos que faltaron no desaparezcan del radar.

ALTER TABLE public.catalogo_fabricante_modulos
    DROP CONSTRAINT IF EXISTS catalogo_fabricante_modulos_estado_check;

ALTER TABLE public.catalogo_fabricante_modulos
    ADD CONSTRAINT catalogo_fabricante_modulos_estado_check
    CHECK (estado = ANY (ARRAY['pendiente', 'ok', 'parcial', 'revision_manual', 'error']));

-- Cuantos productos quedaron sin leer en un modulo parcial. Es lo que hay
-- que mirar para decidir si vale la pena perseguirlos.
ALTER TABLE public.catalogo_fabricante_modulos
    ADD COLUMN IF NOT EXISTS codigos_faltantes TEXT NOT NULL DEFAULT '';

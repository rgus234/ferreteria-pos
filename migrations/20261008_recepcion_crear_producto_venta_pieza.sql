-- "Crear producto" en Recepcion Inteligente solo pedia nombre y un
-- precio -- para productos que se venden sueltos ademas de por bulto
-- (tornillos/pijas/taquetes por kilo, alambre por metro, etc.) eso
-- obligaba a crear el producto primero y despues ir a Inventario a
-- activar la venta suelta en un segundo paso. Estas 2 columnas dejan
-- capturar eso en el mismo formulario de creacion, con el mismo
-- significado que ya tienen unidad_suelta/precio_pieza_publico en
-- productos (ver 20260816_productos_unidad_suelta.sql y
-- 20260926_precios_por_nivel_venta_suelta.sql) -- nunca se inventa un
-- modelo de datos nuevo, solo se traslada la misma decision a un
-- momento mas temprano.
ALTER TABLE public.recepciones_inteligentes_items
ADD COLUMN IF NOT EXISTS unidad_suelta_nuevo_producto TEXT,
ADD COLUMN IF NOT EXISTS precio_pieza_nuevo_producto NUMERIC;

-- Fase 7 del plan de identidad multi-proveedor: tramos de descuento por
-- monto de factura (GAFI: $5,000-7,999 -> 10%, $8,000-11,999 -> 12%,
-- $12,000+ -> 20%). Se suman a la MISMA tabla que ya guarda margen
-- general/categoria/producto/redondeo por proveedor (reglas_precios_proveedor)
-- en vez de crear una tabla aparte -- es la misma configuracion "como
-- cotiza este proveedor", solo un campo mas.
--
-- Vacio por default para TODOS los proveedores existentes: el tramo de
-- descuento nunca se activa solo, nunca se le asignan valores reales a
-- ningun proveedor por esta migracion -- eso es una decision del dueño,
-- exclusiva de GAFI, que se configura desde la pantalla de Precios por
-- proveedor.
ALTER TABLE public.reglas_precios_proveedor
ADD COLUMN IF NOT EXISTS tramos_descuento JSONB NOT NULL DEFAULT '[]'::jsonb;

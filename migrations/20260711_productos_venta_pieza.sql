-- Venta por bolsa/caja completa o por pieza suelta del mismo producto.
-- Aditivo: todo producto existente queda en permite_venta_pieza = false,
-- sin ningun cambio de comportamiento.

ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS permite_venta_pieza BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS piezas_por_bolsa NUMERIC(12,2);
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS precio_pieza NUMERIC(12,2);
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS piezas_sueltas_stock NUMERIC(12,3) NOT NULL DEFAULT 0;

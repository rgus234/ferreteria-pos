-- Garantia por producto, para mostrarla al buscar un ticket por folio.
-- Aditivo: todo producto existente queda en tiene_garantia = false,
-- sin ningun cambio de comportamiento.

ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS tiene_garantia BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS garantia_detalle TEXT NOT NULL DEFAULT '';

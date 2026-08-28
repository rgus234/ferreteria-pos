ALTER TABLE public.productos
ADD COLUMN IF NOT EXISTS codigo_generado BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS fecha_caducidad DATE;

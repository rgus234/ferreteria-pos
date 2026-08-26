ALTER TABLE public.banners_market
    ADD COLUMN IF NOT EXISTS quitar_fondo BOOLEAN NOT NULL DEFAULT false;

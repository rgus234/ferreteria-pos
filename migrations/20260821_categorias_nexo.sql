CREATE TABLE IF NOT EXISTS public.categorias_nexo (
    id SERIAL PRIMARY KEY,
    departamento TEXT NOT NULL,
    nombre TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0,
    UNIQUE (departamento, nombre)
);

ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS categoria_nexo_id INTEGER REFERENCES public.categorias_nexo(id);

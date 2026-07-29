-- Indices de trigramas para que la busqueda ILIKE del Banco de Nexo
-- escale mas alla de unos cuantos miles de codigos (misma extension
-- ya usada por catalogo_productos).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_banco_img_producto_codigo_trgm
    ON public.banco_imagenes_producto USING GIN (codigo gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_banco_img_producto_marca_trgm
    ON public.banco_imagenes_producto USING GIN (marca gin_trgm_ops);

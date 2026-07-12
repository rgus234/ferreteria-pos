-- Fotos reales de producto. Clave por (negocio_id, codigo) y no por
-- producto_id: asi una foto importada de un catalogo de proveedor puede
-- existir antes de que el producto se de de alta, y se reusa igual
-- cuando el producto ya esta. Las imagenes se guardan en Postgres
-- (BYTEA) porque el servidor no tiene disco persistente entre deploys.

CREATE TABLE IF NOT EXISTS public.fotos_producto (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    codigo TEXT NOT NULL,
    imagen_principal BYTEA NOT NULL,
    imagen_principal_tipo TEXT NOT NULL DEFAULT 'image/jpeg',
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.fotos_producto_galeria (
    id SERIAL PRIMARY KEY,
    foto_producto_id INTEGER NOT NULL REFERENCES public.fotos_producto(id) ON DELETE CASCADE,
    orden INTEGER NOT NULL DEFAULT 0,
    imagen BYTEA NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'image/jpeg'
);

CREATE INDEX IF NOT EXISTS idx_fotos_producto_galeria_foto ON public.fotos_producto_galeria(foto_producto_id);

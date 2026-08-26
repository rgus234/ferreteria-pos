CREATE TABLE IF NOT EXISTS public.listas_producto (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    activa BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listas_producto_negocio
    ON public.listas_producto (negocio_id, activa);

CREATE TABLE IF NOT EXISTS public.listas_producto_items (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    lista_id INTEGER NOT NULL REFERENCES public.listas_producto(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    cantidad NUMERIC(12,3) NOT NULL DEFAULT 1,
    orden INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listas_producto_items_lista
    ON public.listas_producto_items (lista_id);

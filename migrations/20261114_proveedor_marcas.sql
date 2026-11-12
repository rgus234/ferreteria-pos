-- Proveedor por marca (abarrotes): a quien le compra el negocio cada marca. Se llena solo cuando el dueño asigna un proveedor a un producto.
CREATE TABLE IF NOT EXISTS public.proveedor_marcas (
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    marca_id TEXT NOT NULL,
    proveedor_id INTEGER NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (negocio_id, marca_id)
);

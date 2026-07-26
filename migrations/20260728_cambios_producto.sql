CREATE TABLE IF NOT EXISTS public.cambios_producto (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    historial_id INTEGER NOT NULL REFERENCES public.historial_ventas(id) ON DELETE CASCADE,
    folio TEXT NOT NULL,
    producto_devuelto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
    producto_devuelto_nombre TEXT NOT NULL,
    cantidad_devuelta NUMERIC(12,3) NOT NULL,
    precio_devuelto NUMERIC(12,2) NOT NULL,
    producto_nuevo_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
    producto_nuevo_nombre TEXT NOT NULL,
    cantidad_nueva NUMERIC(12,3) NOT NULL,
    precio_nuevo NUMERIC(12,2) NOT NULL,
    diferencia NUMERIC(12,2) NOT NULL,
    usuario_nombre TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cambios_producto_historial
    ON public.cambios_producto (historial_id, created_at DESC);

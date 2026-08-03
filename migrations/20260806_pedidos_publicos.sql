CREATE TABLE IF NOT EXISTS public.pedidos_publicos (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    producto_codigo TEXT NOT NULL,
    producto_nombre TEXT NOT NULL,
    cantidad NUMERIC(12,3) NOT NULL DEFAULT 1,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT NOT NULL DEFAULT '',
    cliente_correo TEXT NOT NULL DEFAULT '',
    mensaje TEXT NOT NULL DEFAULT '',
    ip TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','atendido','descartado')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_publicos_negocio
    ON public.pedidos_publicos (negocio_id, estado, created_at DESC);

CREATE TABLE IF NOT EXISTS public.encargos_clientes (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    cliente_id INTEGER REFERENCES public.clientes_credito(id) ON DELETE SET NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT NOT NULL DEFAULT '',
    anticipo NUMERIC(12,2) NOT NULL DEFAULT 0,
    fecha_entrega_esperada DATE,
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'listo', 'entregado', 'cancelado')),
    notas TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encargos_clientes_negocio
    ON public.encargos_clientes (negocio_id, estado, fecha_entrega_esperada);

CREATE TABLE IF NOT EXISTS public.encargos_clientes_items (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    encargo_id INTEGER NOT NULL REFERENCES public.encargos_clientes(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
    codigo TEXT NOT NULL DEFAULT '',
    nombre TEXT NOT NULL,
    cantidad NUMERIC(12,3) NOT NULL DEFAULT 1,
    precio_estimado NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encargos_clientes_items_encargo
    ON public.encargos_clientes_items (encargo_id);

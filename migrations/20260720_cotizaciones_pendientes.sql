-- Cotizaciones/pedidos que el dueño toma sin internet (ej. visitando
-- ranchos sin señal) desde /dueno, y que se sincronizan solos al
-- volver a tener conexion. A proposito NO se vuelven ventas
-- automaticamente al sincronizar -- quedan en estado 'pendiente' para
-- que el dueño las revise y las pase a mano al flujo normal de venta.
-- Distinto de pedidos_proveedor (que son pedidos AL proveedor, no
-- cotizaciones para un cliente).

CREATE TABLE IF NOT EXISTS public.cotizaciones_pendientes (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    event_id TEXT NOT NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'confirmada', 'descartada')),
    total_estimado NUMERIC(12,2) NOT NULL DEFAULT 0,
    creada_offline BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_pendientes_negocio
    ON public.cotizaciones_pendientes (negocio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cotizaciones_pendientes_items (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    cotizacion_id INTEGER NOT NULL REFERENCES public.cotizaciones_pendientes(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
    codigo TEXT NOT NULL DEFAULT '',
    nombre TEXT NOT NULL,
    precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
    cantidad NUMERIC(12,3) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_pendientes_items_cotizacion
    ON public.cotizaciones_pendientes_items (cotizacion_id);

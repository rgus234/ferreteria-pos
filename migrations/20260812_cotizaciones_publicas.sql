ALTER TABLE public.pedidos_publicos
    ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'pedido' CHECK (tipo IN ('pedido', 'cotizacion')),
    ADD COLUMN IF NOT EXISTS precio_cotizado NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS nota_negocio TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS respondido_at TIMESTAMPTZ;

ALTER TABLE public.pedidos_publicos DROP CONSTRAINT IF EXISTS pedidos_publicos_estado_check;
ALTER TABLE public.pedidos_publicos ADD CONSTRAINT pedidos_publicos_estado_check
    CHECK (estado IN ('pendiente', 'atendido', 'descartado', 'cotizado'));

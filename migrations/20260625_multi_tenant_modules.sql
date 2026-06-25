DO $$
DECLARE
    default_id INTEGER;
BEGIN
    SELECT id INTO default_id
    FROM public.negocios
    WHERE slug = 'ferreteria-olimpico';

    IF to_regclass('public.pedidos_proveedor') IS NOT NULL THEN
        ALTER TABLE public.pedidos_proveedor
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.pedidos_proveedor SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.pedidos_proveedor ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_pedidos_proveedor_negocio_fecha
            ON public.pedidos_proveedor (negocio_id, created_at DESC);
    END IF;

    IF to_regclass('public.pedidos_proveedor_items') IS NOT NULL THEN
        ALTER TABLE public.pedidos_proveedor_items
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.pedidos_proveedor_items i
        SET negocio_id = p.negocio_id
        FROM public.pedidos_proveedor p
        WHERE i.pedido_id = p.id
        AND i.negocio_id IS NULL;
        UPDATE public.pedidos_proveedor_items SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.pedidos_proveedor_items ALTER COLUMN negocio_id SET NOT NULL;
    END IF;

    IF to_regclass('public.recepciones_mercancia') IS NOT NULL THEN
        ALTER TABLE public.recepciones_mercancia
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.recepciones_mercancia SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.recepciones_mercancia ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_recepciones_mercancia_negocio_fecha
            ON public.recepciones_mercancia (negocio_id, created_at DESC);
    END IF;

    IF to_regclass('public.recepciones_mercancia_items') IS NOT NULL THEN
        ALTER TABLE public.recepciones_mercancia_items
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.recepciones_mercancia_items i
        SET negocio_id = r.negocio_id
        FROM public.recepciones_mercancia r
        WHERE i.recepcion_id = r.id
        AND i.negocio_id IS NULL;
        UPDATE public.recepciones_mercancia_items SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.recepciones_mercancia_items ALTER COLUMN negocio_id SET NOT NULL;
    END IF;

    IF to_regclass('public.ajustes_inventario') IS NOT NULL THEN
        ALTER TABLE public.ajustes_inventario
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.ajustes_inventario SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.ajustes_inventario ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_ajustes_inventario_negocio_fecha
            ON public.ajustes_inventario (negocio_id, created_at DESC);
    END IF;

    IF to_regclass('public.cuentas_pagar') IS NOT NULL THEN
        ALTER TABLE public.cuentas_pagar
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.cuentas_pagar SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.cuentas_pagar ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_negocio_estado
            ON public.cuentas_pagar (negocio_id, estado, vencimiento);
    END IF;

    IF to_regclass('public.pagos_proveedor') IS NOT NULL THEN
        ALTER TABLE public.pagos_proveedor
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.pagos_proveedor p
        SET negocio_id = c.negocio_id
        FROM public.cuentas_pagar c
        WHERE p.cuenta_id = c.id
        AND p.negocio_id IS NULL;
        UPDATE public.pagos_proveedor SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.pagos_proveedor ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_negocio_fecha
            ON public.pagos_proveedor (negocio_id, created_at DESC);
    END IF;

    IF to_regclass('public.gastos_operativos') IS NOT NULL THEN
        ALTER TABLE public.gastos_operativos
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.gastos_operativos SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.gastos_operativos ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_gastos_operativos_negocio_fecha
            ON public.gastos_operativos (negocio_id, created_at DESC);
    END IF;

    IF to_regclass('public.turnos_caja') IS NOT NULL THEN
        ALTER TABLE public.turnos_caja
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.turnos_caja SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.turnos_caja ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_turnos_caja_negocio_estado
            ON public.turnos_caja (negocio_id, estado, abierto_at DESC);
    END IF;

    IF to_regclass('public.movimientos_caja') IS NOT NULL THEN
        ALTER TABLE public.movimientos_caja
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);
        UPDATE public.movimientos_caja m
        SET negocio_id = t.negocio_id
        FROM public.turnos_caja t
        WHERE m.turno_id = t.id
        AND m.negocio_id IS NULL;
        UPDATE public.movimientos_caja SET negocio_id = default_id WHERE negocio_id IS NULL;
        ALTER TABLE public.movimientos_caja ALTER COLUMN negocio_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_movimientos_caja_negocio_fecha
            ON public.movimientos_caja (negocio_id, created_at DESC);
    END IF;
END $$;

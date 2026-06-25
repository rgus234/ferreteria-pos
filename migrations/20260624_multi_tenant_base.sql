CREATE TABLE IF NOT EXISTS public.negocios (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    giro TEXT NOT NULL DEFAULT 'ferreteria',
    estado TEXT NOT NULL DEFAULT 'activo',
    plan TEXT NOT NULL DEFAULT 'demo',
    telefono TEXT,
    correo TEXT,
    direccion TEXT,
    app_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.negocios (slug, nombre, giro, estado, plan)
VALUES ('ferreteria-olimpico', 'Ferreteria Olimpico', 'ferreteria', 'activo', 'demo')
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
    default_id INTEGER;
BEGIN
    SELECT id INTO default_id
    FROM public.negocios
    WHERE slug = 'ferreteria-olimpico';

    IF to_regclass('public.productos') IS NOT NULL THEN
        ALTER TABLE public.productos
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.productos
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.productos
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_productos_negocio_nombre
            ON public.productos (negocio_id, nombre);
    END IF;

    IF to_regclass('public.producto_codigos') IS NOT NULL THEN
        ALTER TABLE public.producto_codigos
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.producto_codigos pc
        SET negocio_id = p.negocio_id
        FROM public.productos p
        WHERE pc.producto_id = p.id
        AND pc.negocio_id IS NULL;

        UPDATE public.producto_codigos
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.producto_codigos
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_producto_codigos_negocio_codigo
            ON public.producto_codigos (negocio_id, codigo);
    END IF;

    IF to_regclass('public.ventas') IS NOT NULL THEN
        ALTER TABLE public.ventas
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.ventas
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.ventas
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_ventas_negocio_fecha
            ON public.ventas (negocio_id, fecha DESC);
    END IF;

    IF to_regclass('public.historial_ventas') IS NOT NULL THEN
        ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.historial_ventas
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.historial_ventas
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_historial_ventas_negocio_fecha
            ON public.historial_ventas (negocio_id, fecha DESC);
    END IF;

    IF to_regclass('public.usuarios') IS NOT NULL THEN
        ALTER TABLE public.usuarios
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.usuarios
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.usuarios
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_usuarios_negocio_usuario
            ON public.usuarios (negocio_id, usuario);
    END IF;

    IF to_regclass('public.clientes_credito') IS NOT NULL THEN
        ALTER TABLE public.clientes_credito
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.clientes_credito
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.clientes_credito
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_clientes_credito_negocio_nombre
            ON public.clientes_credito (negocio_id, nombre);
    END IF;

    IF to_regclass('public.movimientos_credito') IS NOT NULL THEN
        ALTER TABLE public.movimientos_credito
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.movimientos_credito m
        SET negocio_id = c.negocio_id
        FROM public.clientes_credito c
        WHERE m.cliente_id = c.id
        AND m.negocio_id IS NULL;

        UPDATE public.movimientos_credito
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.movimientos_credito
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_movimientos_credito_negocio_fecha
            ON public.movimientos_credito (negocio_id, fecha DESC);
    END IF;

    IF to_regclass('public.proveedores') IS NOT NULL THEN
        ALTER TABLE public.proveedores
            ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

        UPDATE public.proveedores
        SET negocio_id = default_id
        WHERE negocio_id IS NULL;

        ALTER TABLE public.proveedores
            ALTER COLUMN negocio_id SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_proveedores_negocio_nombre
            ON public.proveedores (negocio_id, nombre);
    END IF;
END $$;

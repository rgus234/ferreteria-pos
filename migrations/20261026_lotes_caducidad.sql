-- Lotes de caducidad y merma (perfil abarrotes).
--
-- Una sola fecha de caducidad por producto no sirve para lo que se compra todos
-- los dias (tortilla, pan, fruta, lacteos): cada ENTRADA de mercancia es un lote
-- con su propia fecha. El stock real sigue siendo productos.stock (lo mueven las
-- ventas de siempre); los lotes solo registran lo que entro y con que fecha, y
-- lo vigente se calcula despues (primero vence, primero sale).
--
-- Aditiva: una columna nueva con NULL y tres tablas nuevas. No cambia ninguna
-- fila existente.

ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS vida_util_dias INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productos_vida_util_dias_check') THEN
        ALTER TABLE public.productos
            ADD CONSTRAINT productos_vida_util_dias_check
            CHECK (vida_util_dias IS NULL OR vida_util_dias BETWEEN 1 AND 3650);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.producto_lotes (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    cantidad NUMERIC(14, 3) NOT NULL CHECK (cantidad > 0),
    fecha_entrada DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_caducidad DATE,
    origen TEXT NOT NULL DEFAULT 'entrada',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_producto_lotes_producto
    ON public.producto_lotes (negocio_id, producto_id, fecha_caducidad);

-- Lo que se tira: cuanto dinero se pierde (a costo y a precio de venta).
CREATE TABLE IF NOT EXISTS public.mermas_producto (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL,
    producto_nombre TEXT NOT NULL DEFAULT '',
    cantidad NUMERIC(14, 3) NOT NULL CHECK (cantidad > 0),
    motivo TEXT NOT NULL DEFAULT 'caducado' CHECK (motivo IN ('caducado', 'danado', 'otro')),
    costo_unitario NUMERIC(14, 2) NOT NULL DEFAULT 0,
    precio_unitario NUMERIC(14, 2) NOT NULL DEFAULT 0,
    usuario_nombre TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mermas_producto_negocio ON public.mermas_producto (negocio_id, created_at DESC);

-- Un solo aviso de "revisa hoy" por negocio y por dia.
CREATE TABLE IF NOT EXISTS public.avisos_caducidad (
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    cuantos INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (negocio_id, fecha)
);

-- Pedido sugerido por proveedor (abarrotes).
--
-- Los proveedores de una tienda (Coca-Cola, Sabritas, Bimbo...) pasan a surtir
-- en dias fijos. Cada proveedor guarda que dia viene y cada cuantos dias, y
-- Nexo calcula con las ventas reales que conviene pedir y avisa unos dias antes.
--
-- Aditiva: dos columnas con NULL/valor por omision y una tabla nueva. No cambia
-- ninguna fila existente.

ALTER TABLE public.proveedores
    ADD COLUMN IF NOT EXISTS dia_visita SMALLINT,
    ADD COLUMN IF NOT EXISTS frecuencia_dias INTEGER NOT NULL DEFAULT 7;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proveedores_dia_visita_check') THEN
        ALTER TABLE public.proveedores
            ADD CONSTRAINT proveedores_dia_visita_check CHECK (dia_visita IS NULL OR dia_visita BETWEEN 0 AND 6);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proveedores_frecuencia_dias_check') THEN
        ALTER TABLE public.proveedores
            ADD CONSTRAINT proveedores_frecuencia_dias_check CHECK (frecuencia_dias BETWEEN 1 AND 60);
    END IF;
END $$;

-- Un solo aviso de "viene el proveedor" por proveedor y por visita.
CREATE TABLE IF NOT EXISTS public.avisos_pedido_sugerido (
    proveedor_id INTEGER NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
    fecha_visita DATE NOT NULL,
    cuantos INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (proveedor_id, fecha_visita)
);

-- Encargos de abarrotes: nuevo estado "resurtiendo" (en proceso de resurtido: ya se pidio al proveedor) y un aviso diario sin repetir.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.encargos_clientes'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%estado%'
    LOOP
        EXECUTE format('ALTER TABLE public.encargos_clientes DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.encargos_clientes
    ADD CONSTRAINT encargos_clientes_estado_check CHECK (estado IN ('pendiente', 'resurtiendo', 'listo', 'entregado', 'cancelado'));

-- Una fila por negocio y dia para no avisar dos veces el mismo dia.
CREATE TABLE IF NOT EXISTS public.avisos_encargos (
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    cuantos INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (negocio_id, fecha)
);

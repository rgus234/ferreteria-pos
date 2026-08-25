-- Auditoria minima de acciones sensibles: quien hizo que, para poder
-- investigar despues ("quien renombro esta categoria", "quien
-- autorizo este descuento"). Alcance a proposito chico -- solo las
-- acciones que ya piden PIN de administrador o que borran/cambian
-- algo que no se deshace con un clic. No hay pantalla para consultarla
-- todavia, es solo el registro.
CREATE TABLE IF NOT EXISTS public.bitacora_acciones (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    empleado_id INTEGER REFERENCES public.empleados(id) ON DELETE SET NULL,
    accion TEXT NOT NULL,
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bitacora_acciones_negocio_fecha
    ON public.bitacora_acciones (negocio_id, created_at DESC);

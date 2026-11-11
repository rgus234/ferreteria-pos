-- Agenda de pagos a proveedores: dias de credito por proveedor (sugiere la fecha limite al recibir "a deber"). Aditiva.
ALTER TABLE IF EXISTS public.proveedores
    ADD COLUMN IF NOT EXISTS dias_credito INTEGER;

-- Cuentas por pagar (la misma tabla de Finanzas avanzadas): se crea aqui por si todavia no existe.
CREATE TABLE IF NOT EXISTS public.cuentas_pagar (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES public.negocios(id),
    proveedor TEXT NOT NULL DEFAULT '',
    origen_tipo TEXT NOT NULL DEFAULT 'manual',
    origen_id INTEGER,
    concepto TEXT NOT NULL DEFAULT '',
    monto_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo NUMERIC(12,2) NOT NULL DEFAULT 0,
    vencimiento DATE,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'cancelada')),
    notas TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_negocio_vencimiento ON public.cuentas_pagar (negocio_id, estado, vencimiento);

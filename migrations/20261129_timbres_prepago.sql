-- Timbres prepagados para facturacion electronica: cada negocio compra paquetes y cada factura timbrada descuenta 1.
-- Solo se usa cuando el servidor tiene TIMBRES_PREPAGO=1; mientras no, las tablas existen vacias y nada cambia.
CREATE TABLE IF NOT EXISTS public.timbres_saldo (
    negocio_id INTEGER PRIMARY KEY REFERENCES public.negocios(id) ON DELETE CASCADE,
    saldo INTEGER NOT NULL DEFAULT 0 CHECK (saldo >= 0),
    comprados_total INTEGER NOT NULL DEFAULT 0,
    consumidos_total INTEGER NOT NULL DEFAULT 0,
    aviso_bajo_enviado_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.timbres_movimientos (
    id BIGSERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('compra', 'regalo', 'consumo', 'reembolso', 'ajuste')),
    cantidad INTEGER NOT NULL,
    saldo_despues INTEGER NOT NULL,
    referencia TEXT,
    monto_centavos INTEGER,
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timbres_movimientos_negocio ON public.timbres_movimientos (negocio_id, created_at DESC);
-- Una compra de Stripe se acredita una sola vez (el webhook y la confirmacion al volver pueden llegar los dos).
CREATE UNIQUE INDEX IF NOT EXISTS idx_timbres_movimientos_compra_ref ON public.timbres_movimientos (referencia) WHERE tipo = 'compra';

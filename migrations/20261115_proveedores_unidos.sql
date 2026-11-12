-- Unir proveedores: registro de cada union (que proveedor se unio a cual, y que productos/facturas se movieron) para poder deshacerla.
CREATE TABLE IF NOT EXISTS public.proveedores_unidos (
    id SERIAL PRIMARY KEY,
    lote_id TEXT NOT NULL,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    destino_id INTEGER NOT NULL,
    destino_nombre TEXT NOT NULL DEFAULT '',
    origen_id INTEGER NOT NULL,
    origen_nombre TEXT NOT NULL DEFAULT '',
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    usuario TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deshecho_at TIMESTAMPTZ
);

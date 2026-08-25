-- Historial real de recepcion de mercancia (ver auditoria comercial):
-- recepciones_mercancia/_items ya existian pero solo se llenaban desde
-- el flujo de "recibir un pedido a proveedor" (fase4-server.js). El
-- flujo que el dueño realmente usa para subir una factura XML/CSV
-- suelta (ferretero-flow.js, pantalla "Recepcion") nunca escribia ahi
-- -- solo actualizaba productos.stock directo, sin dejar registro de
-- que se recibio, cuando, ni de que proveedor. pedido_id ya es
-- nullable en el esquema existente, asi que estas recepciones libres
-- conviven en la misma tabla sin pedido asociado.
ALTER TABLE public.recepciones_mercancia ADD COLUMN IF NOT EXISTS fecha_documento DATE;
ALTER TABLE public.recepciones_mercancia ADD COLUMN IF NOT EXISTS tipo_documento TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_recepciones_mercancia_negocio_fecha
    ON public.recepciones_mercancia (negocio_id, created_at DESC);

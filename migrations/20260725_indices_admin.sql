-- Indices faltantes en negocio_id usados por las consultas del panel
-- de Admin (GET /admin/api/negocios, /admin/api/resumen). Idempotente,
-- no toca datos.

CREATE INDEX IF NOT EXISTS idx_productos_negocio ON public.productos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio ON public.ventas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_dispositivos_negocio ON public.dispositivos(negocio_id);

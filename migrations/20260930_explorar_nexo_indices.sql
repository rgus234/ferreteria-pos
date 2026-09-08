-- Explorar Nexo (Fase 1, paso 1): busqueda por nombre en las 2 capas
-- de catalogo que hoy solo se consultan por codigo exacto
-- (identidadPorCodigo en catalogo-maestro-reconciliacion.js,
-- buscar-codigo en catalog-server.js). Sin este indice, un "%"/
-- similarity() sobre estas tablas es un recorrido secuencial
-- completo -- ya son 15.758+ y 14.472+ filas y van creciendo con
-- cada corrida del sincronizador de fabricante.
--
-- pg_trgm ya esta habilitado (20260722b_catalogo_proveedor.sql) y ya
-- se usa igual sobre productos.nombre y catalogo_productos.nombre_
-- proveedor -- esto solo agrega los 2 indices que faltaban, mismo
-- patron. Aditiva pura: no toca ninguna fila existente.
CREATE INDEX IF NOT EXISTS idx_catalogo_maestro_productos_nombre_trgm
    ON public.catalogo_maestro_productos USING gin (nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_catalogo_fabricante_productos_descripcion_trgm
    ON public.catalogo_fabricante_productos USING gin (descripcion gin_trgm_ops);

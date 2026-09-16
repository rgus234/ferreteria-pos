-- Fase 1 de identidad multi-proveedor (GAFI y cualquier otro distribuidor
-- con el mismo patron): el catalogo de un distribuidor puede traer, ademas
-- de SU PROPIO codigo interno, la clave/codigo con la que el FABRICANTE
-- identifica el mismo producto (columna "Alterno" en el catalogo real de
-- GAFI). catalogo_productos (el staging por negocio) no tenia donde
-- guardar ese segundo valor -- se leia y se descartaba en
-- extraerProductoGenericoCatalogo (public/js/catalog-parsers.js), asi que
-- ni siquiera la busqueda dentro del catalogo propio del negocio lo
-- encontraba. Mismo patron que la columna codigo_barras agregada en
-- 20260918_catalogo_productos_codigo_barras.sql.
ALTER TABLE public.catalogo_productos
ADD COLUMN IF NOT EXISTS clave_proveedor TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_catalogo_productos_clave_proveedor
    ON public.catalogo_productos (clave_proveedor)
    WHERE clave_proveedor <> '';

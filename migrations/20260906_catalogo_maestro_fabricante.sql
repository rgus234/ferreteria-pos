-- Conecta el catalogo de fabricante con el Catalogo Maestro.
--
-- El Maestro guarda IDENTIDAD de producto (marca, nombre, presentacion,
-- categoria, imagen) y NUNCA precio -- esa regla no cambia aqui. Lo que
-- se agrega es de donde salio esa identidad, porque hasta hoy el Maestro
-- solo se llenaba cuando un negocio confirmaba un producto de su
-- proveedor, y ahora tambien puede llenarse desde el catalogo oficial de
-- un fabricante.
--
-- El problema que resuelven estas columnas: `codigo` es UNIQUE GLOBAL. El
-- codigo "103013" de TRUPER y un "103013" de URREA son productos
-- distintos, y sin saber de que fabricante viene cada fila, el segundo se
-- enlazaria en silencio al primero. Con `fabricante` se puede distinguir
-- y negarse a mezclarlos.

ALTER TABLE public.catalogo_maestro_productos
    -- Fabricante del que salio la identidad. Vacio = lo aporto un negocio
    -- al confirmar un producto (el flujo que ya existia).
    ADD COLUMN IF NOT EXISTS fabricante TEXT NOT NULL DEFAULT '',
    -- Codigo tal como lo publica ese fabricante. Puede diferir de
    -- `codigo` si este ultimo ya estaba tomado.
    ADD COLUMN IF NOT EXISTS codigo_fabricante TEXT NOT NULL DEFAULT '',
    -- EAN cuando se conoce. Para abarrote es la identidad real del
    -- producto; para ferreteria casi nunca se publica.
    ADD COLUMN IF NOT EXISTS ean TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'negocio'
        CHECK (origen IN ('negocio', 'fabricante'));

CREATE INDEX IF NOT EXISTS idx_catalogo_maestro_fabricante
    ON public.catalogo_maestro_productos (fabricante) WHERE fabricante <> '';
CREATE INDEX IF NOT EXISTS idx_catalogo_maestro_ean
    ON public.catalogo_maestro_productos (ean) WHERE ean <> '';

-- Enlace del producto del fabricante hacia su fila del Maestro, para no
-- recalcular la correspondencia en cada corrida y para poder ver cuales
-- ya se aportaron.
ALTER TABLE public.catalogo_fabricante_productos
    ADD COLUMN IF NOT EXISTS catalogo_maestro_id INTEGER
        REFERENCES public.catalogo_maestro_productos(id),
    -- Por que un producto NO llego al Maestro: sin nombre utilizable, o
    -- su codigo ya lo tiene otro fabricante. Se guarda para poder
    -- revisarlo en vez de que desaparezca en silencio.
    ADD COLUMN IF NOT EXISTS maestro_detalle TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cat_fab_productos_maestro
    ON public.catalogo_fabricante_productos (fabricante, catalogo_maestro_id);

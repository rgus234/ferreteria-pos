-- Que cambio cuando el proveedor manda un catalogo nuevo.
--
-- Hasta ahora la importacion contaba los cambios --nuevos y cambios de
-- precio publico-- y los mostraba en una linea que se iba al recargar la
-- pagina. Ni se guardaban, ni cubrian el mayoreo o el medio mayoreo, ni
-- detectaban lo que el proveedor dejo de vender.
--
-- La unica huella que quedaba era catalogo_productos.precio_publico_anterior,
-- que guarda UN valor y se pisa en cada importacion. Y no habia pantalla
-- que lo mostrara: el dato existia y nadie podia verlo.
--
-- Importa porque el catalogo de un proveedor se actualiza una o dos veces
-- al año y lo que el dueno necesita saber es exactamente esto: que subio,
-- que bajo, que hay de nuevo y que dejaron de vender. Medido en Ferreteria
-- Olimpico: 1.343 productos donde TRUPER esta mas caro que su lista, o sea
-- meses de cambios que nadie vio pasar.

CREATE TABLE IF NOT EXISTS public.catalogo_proveedor_importaciones (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    catalogo_id INTEGER NOT NULL REFERENCES public.catalogos_proveedor(id) ON DELETE CASCADE,
    proveedor TEXT NOT NULL DEFAULT '',

    filas_recibidas INTEGER NOT NULL DEFAULT 0,
    nuevos INTEGER NOT NULL DEFAULT 0,
    modificados INTEGER NOT NULL DEFAULT 0,
    descontinuados INTEGER NOT NULL DEFAULT 0,
    -- Cuantos venian identicos. Sirve para que el dueno sepa que la
    -- importacion SI funciono aunque el reporte salga casi vacio.
    sin_cambio INTEGER NOT NULL DEFAULT 0,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_prov_import_negocio
    ON public.catalogo_proveedor_importaciones (negocio_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS public.catalogo_proveedor_cambios (
    id BIGSERIAL PRIMARY KEY,
    importacion_id INTEGER NOT NULL
        REFERENCES public.catalogo_proveedor_importaciones(id) ON DELETE CASCADE,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,

    codigo_proveedor TEXT NOT NULL,
    -- Se guarda el nombre del momento: si el producto luego se renombra o
    -- se borra del catalogo, el reporte viejo sigue siendo legible.
    nombre TEXT NOT NULL DEFAULT '',

    -- 'nuevo' | 'modificado' | 'descontinuado'
    tipo TEXT NOT NULL,
    -- Para 'modificado': que campo. Vacio en los otros.
    campo TEXT NOT NULL DEFAULT '',
    valor_anterior TEXT NOT NULL DEFAULT '',
    valor_nuevo TEXT NOT NULL DEFAULT '',

    CONSTRAINT catalogo_proveedor_cambios_tipo_check
        CHECK (tipo = ANY (ARRAY['nuevo', 'modificado', 'descontinuado']))
);

CREATE INDEX IF NOT EXISTS idx_cat_prov_cambios_importacion
    ON public.catalogo_proveedor_cambios (importacion_id, tipo);

-- Plantillas de mapeo de columnas por proveedor, movidas de
-- localStorage (por navegador, no por negocio, se perdian al limpiar
-- datos o cambiar de equipo) al servidor -- consistente con que los
-- catalogos mismos ya viven en el servidor (catalogos_proveedor).
--
-- proveedor_normalizado lo calcula el cliente con la misma funcion
-- que ya usa para todo lo demas (normalizarEncabezadoCatalogo,
-- product-inventory.js) y se manda explicito -- el servidor no
-- reimplementa esa logica de normalizacion, solo la guarda/compara.
CREATE TABLE IF NOT EXISTS public.plantillas_catalogo (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    proveedor TEXT NOT NULL,
    proveedor_normalizado TEXT NOT NULL,
    parser TEXT NOT NULL DEFAULT 'generico',
    mapeo JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, proveedor_normalizado)
);

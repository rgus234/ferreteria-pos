-- Motor de vinculacion real para "Catalogo de proveedor" -- hoy los
-- catalogos parseados viven solo en localStorage del navegador, sin
-- ninguna tabla ni algoritmo de coincidencia contra el inventario
-- real. Esta migracion mueve el almacenamiento al servidor y agrega
-- el estado de vinculacion (vinculado/coincidencia_parcial/
-- sin_vincular/conflicto) que el rediseno del modulo necesita.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.catalogos_proveedor (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    proveedor TEXT NOT NULL,
    total_productos INTEGER NOT NULL DEFAULT 0,
    productos_vinculados INTEGER NOT NULL DEFAULT 0,
    productos_conflicto INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, proveedor)
);

-- codigo_proveedor: clave del producto tal como la manda el proveedor
-- (no es el codigo interno de Nexo POS) -- unico por catalogo, se usa
-- para el upsert en cada re-subida.
CREATE TABLE IF NOT EXISTS public.catalogo_productos (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    catalogo_id INTEGER NOT NULL REFERENCES public.catalogos_proveedor(id) ON DELETE CASCADE,
    codigo_proveedor TEXT NOT NULL,
    nombre_proveedor TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    marca TEXT NOT NULL DEFAULT '',
    categoria TEXT NOT NULL DEFAULT '',
    codigo_interno TEXT NOT NULL DEFAULT '',
    precio_distribuidor NUMERIC(12,2),
    precio_medio_mayoreo NUMERIC(12,2),
    precio_publico NUMERIC(12,2),
    precio_publico_anterior NUMERIC(12,2),
    producto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
    estado TEXT NOT NULL DEFAULT 'sin_vincular'
        CHECK (estado IN ('vinculado', 'coincidencia_parcial', 'sin_vincular', 'conflicto')),
    porcentaje_coincidencia NUMERIC(5,2),
    vinculado_manualmente BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (catalogo_id, codigo_proveedor)
);

CREATE INDEX IF NOT EXISTS idx_catalogo_productos_negocio
    ON public.catalogo_productos (negocio_id, catalogo_id, estado);
CREATE INDEX IF NOT EXISTS idx_catalogo_productos_nombre_trgm
    ON public.catalogo_productos USING gin (nombre_proveedor gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm
    ON public.productos USING gin (nombre gin_trgm_ops);

-- Mapa de la tienda: pasillos y estantes (zona "tienda") y secciones de bodega (zona "bodega"), cada lugar con su codigo
-- para imprimir y escanear. Un producto puede estar exhibido y tambien en bodega.
-- Aditiva: tablas nuevas y columnas nuevas NULL; no cambia ninguna fila existente. productos.ubicacion (texto) se conserva.
CREATE TABLE IF NOT EXISTS public.ubicaciones (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    zona TEXT NOT NULL DEFAULT 'tienda' CHECK (zona IN ('tienda', 'bodega')),
    tipo TEXT NOT NULL DEFAULT 'estante' CHECK (tipo IN ('pasillo', 'seccion', 'estante', 'rack', 'nivel')),
    nombre TEXT NOT NULL,
    codigo TEXT NOT NULL,
    padre_id INTEGER REFERENCES public.ubicaciones(id) ON DELETE CASCADE,
    orden INTEGER NOT NULL DEFAULT 0,
    activa BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_ubicaciones_negocio ON public.ubicaciones (negocio_id, zona, padre_id);

-- Lugar de exhibicion y lugar de bodega de cada producto (el total para vender sigue siendo productos.stock).
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES public.ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS ubicacion_bodega_id INTEGER REFERENCES public.ubicaciones(id) ON DELETE SET NULL;

-- Desglose de existencias por lugar (conteo y traslados bodega -> exhibicion); encima del total, nunca en lugar de el.
CREATE TABLE IF NOT EXISTS public.producto_ubicaciones (
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    ubicacion_id INTEGER NOT NULL REFERENCES public.ubicaciones(id) ON DELETE CASCADE,
    cantidad NUMERIC(12,3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (producto_id, ubicacion_id)
);

-- Fase 7 del plan "Catalogo Maestro Nexo": tabla global (sin
-- negocio_id) con informacion GENERAL de un producto -- marca,
-- nombre, presentacion, categoria sugerida, imagen, descripcion.
-- NUNCA precio -- el precio de venta siempre pertenece a cada
-- negocio (productos.precio), nunca se sobreescribe desde aqui.
-- Aditiva pura: nada la lee ni escribe todavia, riesgo cero para
-- datos existentes.
CREATE TABLE IF NOT EXISTS public.catalogo_maestro_productos (
    id SERIAL PRIMARY KEY,
    codigo TEXT NOT NULL,
    marca TEXT NOT NULL DEFAULT '',
    nombre TEXT NOT NULL,
    presentacion TEXT NOT NULL DEFAULT '',
    categoria_nexo_id INTEGER REFERENCES public.categorias_nexo(id),
    descripcion TEXT NOT NULL DEFAULT '',
    imagen BYTEA,
    imagen_tipo TEXT,
    -- Solo para saber quien lo aporto primero (auditoria) -- nunca se
    -- usa para filtrar ni restringir quien puede ENLAZAR este
    -- producto a su propio inventario.
    contribuido_por_negocio_id INTEGER REFERENCES public.negocios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (codigo)
);

-- El negocio que trae un producto ya conocido del Catalogo Maestro
-- queda enlazado -- su propio precio/stock/proveedor/ubicacion siguen
-- viviendo exclusivamente en su propia fila de productos.
ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS catalogo_maestro_id INTEGER REFERENCES public.catalogo_maestro_productos(id);

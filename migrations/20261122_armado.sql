-- Armar productos: convierte producto a granel en bolsitas o porciones. Aditiva y apagada por defecto
-- (se usa solo con la funcion nueva "armado" encendida). El servidor tambien las crea solas la primera vez (armado-server.js).
CREATE TABLE IF NOT EXISTS public.producto_armado (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    producto_origen_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    producto_destino_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    cantidad_origen NUMERIC(12, 3) NOT NULL CHECK (cantidad_origen > 0),
    merma_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (merma_pct >= 0 AND merma_pct < 100),
    costo_extra NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (costo_extra >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, producto_destino_id)
);

CREATE TABLE IF NOT EXISTS public.armados_log (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    armado_id INTEGER,
    producto_origen_id INTEGER NOT NULL,
    producto_destino_id INTEGER NOT NULL,
    unidades NUMERIC(12, 3) NOT NULL,
    origen_usado NUMERIC(12, 3) NOT NULL,
    usuario_nombre TEXT,
    deshecho_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

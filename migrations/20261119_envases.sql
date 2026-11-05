-- Envases retornables (abarrotes): importe del envase por producto. Aditiva y apagada por defecto
-- (se usa solo con la funcion nueva "envases" encendida). El servidor tambien la crea sola la primera vez (envases-server.js).
CREATE TABLE IF NOT EXISTS public.producto_envases (
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    importe NUMERIC(10, 2) NOT NULL CHECK (importe > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (negocio_id, producto_id)
);

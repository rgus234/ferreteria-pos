-- Venta de alcohol (abarrotes): horario en que no se vende y productos marcados a mano. Aditiva y apagada por defecto
-- (se usa solo con la funcion nueva "alcohol" encendida). El servidor tambien la crea sola la primera vez (alcohol-server.js).
CREATE TABLE IF NOT EXISTS public.alcohol_config (
    negocio_id INTEGER PRIMARY KEY REFERENCES public.negocios(id) ON DELETE CASCADE,
    activa BOOLEAN NOT NULL DEFAULT false,
    desde TEXT NOT NULL DEFAULT '22:00',
    hasta TEXT NOT NULL DEFAULT '10:00',
    ley_seca_fecha DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.producto_alcohol (
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    es_alcohol BOOLEAN NOT NULL,
    PRIMARY KEY (negocio_id, producto_id)
);

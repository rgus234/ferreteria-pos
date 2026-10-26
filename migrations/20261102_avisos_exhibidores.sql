-- Aviso diario de "exhibidores por surtir": una fila por negocio y dia para no avisar dos veces el mismo dia.
CREATE TABLE IF NOT EXISTS public.avisos_exhibidores (
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    cuantos INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (negocio_id, fecha)
);

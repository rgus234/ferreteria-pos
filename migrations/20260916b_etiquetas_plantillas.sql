CREATE TABLE IF NOT EXISTS public.etiquetas_plantillas (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    nombre TEXT NOT NULL,
    ancho_mm NUMERIC(6,2) NOT NULL DEFAULT 50,
    alto_mm NUMERIC(6,2) NOT NULL DEFAULT 25,
    columnas INTEGER NOT NULL DEFAULT 3,
    margen_mm NUMERIC(6,2) NOT NULL DEFAULT 5,
    espaciado_mm NUMERIC(6,2) NOT NULL DEFAULT 3,
    mostrar_nombre BOOLEAN NOT NULL DEFAULT true,
    mostrar_codigo_barras BOOLEAN NOT NULL DEFAULT true,
    mostrar_numero_codigo BOOLEAN NOT NULL DEFAULT true,
    mostrar_precio BOOLEAN NOT NULL DEFAULT true,
    mostrar_marca BOOLEAN NOT NULL DEFAULT false,
    mostrar_categoria BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_etiquetas_plantillas_negocio
    ON public.etiquetas_plantillas (negocio_id);

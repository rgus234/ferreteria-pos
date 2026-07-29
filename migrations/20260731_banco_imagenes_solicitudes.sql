-- Solicitudes de fotografia: cuando un negocio Pro no encuentra imagen
-- para un codigo en Agregar producto, puede pedirla. Se resuelve sola
-- (ver procesarZipBancoImagenes) cuando el admin importa un ZIP que
-- trae ese codigo.

CREATE TABLE IF NOT EXISTS public.banco_imagenes_solicitudes (
    id SERIAL PRIMARY KEY,
    codigo TEXT NOT NULL,
    marca TEXT,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'resuelta')),
    banco_imagen_id INTEGER REFERENCES public.banco_imagenes_producto(id) ON DELETE SET NULL,
    resuelta_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un negocio no acumula solicitudes duplicadas del mismo codigo
-- mientras siga pendiente; una vez resuelta, puede volver a solicitar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_banco_img_solicitudes_pendiente_unica
    ON public.banco_imagenes_solicitudes (codigo, negocio_id)
    WHERE estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_banco_img_solicitudes_estado
    ON public.banco_imagenes_solicitudes (estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_banco_img_solicitudes_codigo
    ON public.banco_imagenes_solicitudes (codigo);

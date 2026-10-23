-- Capturar codigos (herramienta temporal y PRIVADA para construir el catalogo maestro).
--
-- Codigos de barras reales con el nombre que escribe el propietario, tomados en una tienda. No toca
-- productos, ventas, existencias ni precios de ningun negocio: tabla aparte, sin llave a negocios.
-- El codigo es TEXTO (conserva los ceros iniciales). Un registro por (propietario, codigo).

CREATE TABLE IF NOT EXISTS public.capturas_codigos (
    id SERIAL PRIMARY KEY,
    propietario_correo TEXT NOT NULL,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    nombre_anterior TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (propietario_correo, codigo)
);

CREATE INDEX IF NOT EXISTS idx_capturas_codigos_propietario ON public.capturas_codigos (propietario_correo, created_at DESC);

-- Banco de imagenes global ("Banco de Nexo") -- Pro-only, curado por el
-- admin. Espejo de fotos_producto/fotos_producto_galeria salvo que NO
-- esta scoped por negocio_id (UNIQUE directo en codigo) -- coexiste como
-- una segunda fuente de imagen distinta, tal como ya proponia la nota de
-- arquitectura previa en docs/arquitectura-planes-y-modulos.md.

CREATE TABLE IF NOT EXISTS public.banco_imagenes_producto (
    id SERIAL PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    marca TEXT,
    imagen_principal BYTEA NOT NULL,
    imagen_principal_tipo TEXT NOT NULL DEFAULT 'image/jpeg',
    origen TEXT,
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banco_imagenes_producto_codigo
    ON public.banco_imagenes_producto(codigo);

CREATE TABLE IF NOT EXISTS public.banco_imagenes_producto_galeria (
    id SERIAL PRIMARY KEY,
    banco_imagen_id INTEGER NOT NULL REFERENCES public.banco_imagenes_producto(id) ON DELETE CASCADE,
    orden INTEGER NOT NULL DEFAULT 0,
    imagen BYTEA NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'image/jpeg'
);

CREATE INDEX IF NOT EXISTS idx_banco_imagenes_producto_galeria_banco
    ON public.banco_imagenes_producto_galeria(banco_imagen_id);

-- La fila ya estaba sembrada como 'planeado' desde
-- 20260716_catalogo_funciones_planes.sql (pro:true, basico/plus:false) --
-- ahora que la tabla que la respalda existe, se marca activa.
UPDATE public.catalogo_funciones
SET estado = 'activo'
WHERE clave = 'banco_imagenes.compartido';

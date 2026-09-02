-- Galeria de producto POR REFERENCIA, en vez de por copia.
--
-- El Banco de Nexo guardaba cada foto secundaria dentro de la base: 75.794
-- imagenes, 1.2 GB, el 74% de toda la base de datos. Se hizo para tener
-- galeria de varias fotos por producto, como Amazon o Mercado Libre.
--
-- El fabricante ya publica esas fotos, mejores y accesibles:
--   https://www.truper.com/media/import/imagenes/{CLAVE}.jpg  -> 1800x1800
--   mas variantes {CLAVE}+FC1, +FC2, +E1, +EI1, +EIND1, +EM1, +D1
--   sirviendolas con Cache-Control de un ano y sin bloqueo de hotlinking.
--
-- Asi que en vez de copiar la imagen se guarda QUE FOTOS TIENE cada
-- producto. Una fila de texto pesa ~200 bytes contra ~16 KB por imagen.
--
-- Se llena BAJO DEMANDA: solo se averigua que fotos tiene un producto
-- cuando alguien abre su galeria. Precargar los 15.758 seria hacer
-- ~126.000 peticiones para algo que casi nadie mira (el banco entero
-- acumula 61 usos).

CREATE TABLE IF NOT EXISTS public.banco_imagenes_fabricante (
    id SERIAL PRIMARY KEY,
    -- Codigo con el que el POS pide la galeria (codigo de fabricante).
    codigo TEXT NOT NULL UNIQUE,
    -- Clave/SKU: es el nombre del archivo en el servidor del fabricante.
    clave TEXT NOT NULL DEFAULT '',
    fabricante TEXT NOT NULL DEFAULT '',
    -- Sufijos de las fotos que SI existen, ya verificados:
    -- ["", "+FC1", "+FC2", "+E1"]. Vacio = se comprobo y no hay ninguna.
    sufijos JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Cuando se comprobo. Sirve para volver a mirar cada tanto: el
    -- fabricante puede agregar fotos a un producto que ya existia.
    verificado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banco_fabricante_clave
    ON public.banco_imagenes_fabricante (clave) WHERE clave <> '';

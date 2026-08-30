-- Agrega una columna dedicada para el codigo de barras real (EAN/UPC) del
-- fabricante en el catalogo de proveedor. Hasta ahora catalogo_productos
-- solo guardaba codigo_proveedor/codigo_interno -- ninguno de los dos es
-- el codigo de barras real impreso en el producto, asi que escanear el
-- codigo de barras al agregar un producto nunca encontraba nada en el
-- catalogo, aunque el archivo del proveedor si trajera una columna "ean"
-- (confirmado con un catalogo real de Diprofer/Truper: la columna "ean"
-- existe en el CSV pero nunca se leia ni se guardaba).
ALTER TABLE public.catalogo_productos
ADD COLUMN IF NOT EXISTS codigo_barras TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_catalogo_productos_codigo_barras
    ON public.catalogo_productos (codigo_barras)
    WHERE codigo_barras <> '';

-- Venta rapida con favoritos (abarrotes).
--
-- Los productos que el tendero marca como favoritos salen como tarjetas grandes arriba del carrito en el
-- Punto de venta. favorito_orden es la posicion en esa franja: NULL = no es favorito.
--
-- Aditiva: una columna con NULL. No cambia ninguna fila existente.

ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS favorito_orden INTEGER;

CREATE INDEX IF NOT EXISTS idx_productos_favoritos
    ON public.productos (negocio_id, favorito_orden)
    WHERE favorito_orden IS NOT NULL;

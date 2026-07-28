-- Dimensiones reales de cada foto del Banco de Nexo -- necesarias para la
-- tarjeta "Imagen encontrada en el banco" (muestra resolucion) y para la
-- galeria de seleccion de principal. Nulas en filas existentes hasta que
-- se re-importen (procesarZipBancoImagenes las llena desde ahora).

ALTER TABLE public.banco_imagenes_producto
    ADD COLUMN IF NOT EXISTS imagen_principal_ancho INTEGER,
    ADD COLUMN IF NOT EXISTS imagen_principal_alto INTEGER;

ALTER TABLE public.banco_imagenes_producto_galeria
    ADD COLUMN IF NOT EXISTS ancho INTEGER,
    ADD COLUMN IF NOT EXISTS alto INTEGER;

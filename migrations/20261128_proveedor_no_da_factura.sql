-- Llegada sin factura (Gafi, la camioneta de escobas y mallas...): hay proveedores
-- que nunca dan factura. Con esta marca, lo que se recibe de ellos queda cerrado
-- al momento y no se queda esperando una factura que nunca va a llegar.
--
-- Aditiva: una columna con valor por omision false. No cambia ninguna fila existente.

ALTER TABLE public.proveedores
    ADD COLUMN IF NOT EXISTS no_da_factura BOOLEAN NOT NULL DEFAULT false;

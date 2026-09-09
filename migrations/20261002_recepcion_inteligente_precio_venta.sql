-- Recepcion Inteligente: al crear un producto nuevo desde una factura,
-- el precio de venta elegido (uno de los 3 precios de referencia del
-- candidato -- publico/medio mayoreo/distribuidor -- o capturado a mano
-- si no habia candidato con precios) se guarda junto con la decision,
-- para que /confirmar lo use en vez de copiar el costo de la factura
-- tal cual (que era el comportamiento anterior, sin opcion de elegir).
--
-- Nullable a proposito: solo aplica cuando accion = 'crear'. Aditiva
-- pura, no toca ninguna fila existente.
ALTER TABLE public.recepciones_inteligentes_items
    ADD COLUMN IF NOT EXISTS precio_venta_nuevo_producto NUMERIC(12,2);

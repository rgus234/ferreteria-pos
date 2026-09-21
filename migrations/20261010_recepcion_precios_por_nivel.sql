-- El modal de "Crear producto"/"Relacionar" en Recepcion Inteligente
-- solo pedia un precio de venta unico (precio_venta_nuevo_producto),
-- que se copiaba igual a precio_publico y precio_mayoreo del producto
-- nuevo -- nunca dejaba capturar los 2 niveles de venta por separado
-- como si hace en Agregar producto (Inventario). Pedido real de
-- Ferreteria Olimpico al revisar una factura de Diprofer: "quiero
-- cambiar el precio desde ahi", especificamente el de medio mayoreo.
--
-- Solo publico/medio mayoreo -- a proposito sin "distribuidor": mas
-- abajo en este mismo archivo (confirmar recepcion), precio_distribuidor
-- ya se mantiene sincronizado con el costo REAL de la factura para todo
-- concepto no omitido (crear o relacionar) -- nunca fue un precio de
-- venta libre en este flujo, asi que exponerlo aqui como editable
-- hubiera sido un control que el usuario mueve y el propio confirmar
-- pisa sin avisar.
--
-- Aditiva pura: columnas nuevas, ninguna fila existente se toca.
-- precio_venta_nuevo_producto se queda (fallback cuando el modal viejo
-- o una prueba manda un solo precio, ver recepcion-inteligente-server.js).
ALTER TABLE public.recepciones_inteligentes_items
ADD COLUMN IF NOT EXISTS precio_publico_nuevo_producto NUMERIC,
ADD COLUMN IF NOT EXISTS precio_medio_mayoreo_nuevo_producto NUMERIC;

-- Mismo pedido pero para "Relacionar" (vincular con un producto que YA
-- existe): antes solo se podia elegir CUAL producto era, nunca ajustar
-- su precio desde aqui. Columnas separadas de las de arriba a
-- proposito -- "_actualizar_producto" nunca crea nada, solo dispara un
-- UPDATE sobre el producto ya vinculado, y solo hasta que se confirma
-- la recepcion (mismo principio del archivo: nada toca inventario real
-- antes de POST /:id/confirmar, para que "Cambiar" siga pudiendo
-- deshacer una decision sin dejar un precio a medias en un producto
-- distinto al que finalmente se eligio).
ALTER TABLE public.recepciones_inteligentes_items
ADD COLUMN IF NOT EXISTS precio_publico_actualizar_producto NUMERIC,
ADD COLUMN IF NOT EXISTS precio_medio_mayoreo_actualizar_producto NUMERIC,
ADD COLUMN IF NOT EXISTS unidad_suelta_actualizar_producto TEXT,
ADD COLUMN IF NOT EXISTS precio_pieza_actualizar_producto NUMERIC;

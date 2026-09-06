-- Los tres niveles de precio tambien para la venta SUELTA.
--
-- El contenedor (bulto, caja, bolsa) ya tenia sus tres precios --
-- precio_publico / precio_mayoreo / precio_distribuidor -- pero lo que
-- se vende suelto tenia UNO solo: precio_pieza. Y el POS ni siquiera
-- intentaba aplicarle nivel:
--
--     if (modoVenta !== "pieza" && nivelPrecioActual !== "publico") {
--         aplicarNivelPrecioAItem(...)      <- se saltaba lo suelto
--     }
--
-- Caso real que lo destapo, PERRON ADULTO en Ferreteria Olimpico:
-- llega en bulto de 25 kg y se vende por kilo.
--
--     bulto:  535 distribuidor / 700 medio mayoreo / 750 publico
--     kilo:    23 distribuidor /  33 medio mayoreo /  43 publico
--
-- Sin estas columnas habia que elegir: o registrarlo como granel para
-- conservar los tres precios del kilo pero sin poder vender el bulto, o
-- registrarlo como bulto con venta suelta y cobrar SIEMPRE 33 el kilo,
-- perdiendo los 43 del publico. En un producto que se vende por kilo
-- todos los dias, eso es dinero real.
--
-- Se nombran igual que las del contenedor para que la correspondencia
-- sea obvia. Ojo con el historico: precio_mayoreo es el MEDIO mayoreo
-- (asi lo etiqueta el POS), no el mayoreo grande.

ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS precio_pieza_publico NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS precio_pieza_mayoreo NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS precio_pieza_distribuidor NUMERIC(12,2);

-- Los productos que ya vendian suelto conservan su unico precio como el
-- nivel medio mayoreo, que es el que el POS venia cobrando: sin esto,
-- al encender los niveles pasarian a cobrar 0.
UPDATE public.productos
   SET precio_pieza_mayoreo = precio_pieza
 WHERE precio_pieza IS NOT NULL
   AND precio_pieza > 0
   AND precio_pieza_mayoreo IS NULL;

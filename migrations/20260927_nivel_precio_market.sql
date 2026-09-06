-- Con que nivel de precio publica el negocio en Nexo Market y en su
-- sitio web.
--
-- Hasta ahora estaba FIJO en el codigo, en 7 consultas distintas:
--
--     COALESCE(precio_publico, precio) AS precio
--
-- Asi que un negocio que quisiera competir en linea con su precio de
-- medio mayoreo no tenia como: el cliente siempre veia el publico, y al
-- llegar a pagar tampoco cambiaba.
--
-- Es un ajuste SEPARADO del nivel del punto de venta
-- (negocios.nivel_precio_por_defecto) a proposito: son dos decisiones
-- comerciales distintas. Hay quien vende en mostrador a medio mayoreo y
-- en linea a publico para no competirle a su propio local, y quien hace
-- justo lo contrario para ganar la venta en linea.
--
-- Los tres valores son los mismos que usa el POS. Se listan todos desde
-- el principio: agregar uno al codigo sin agregarlo aqui ya reventó una
-- corrida entera antes (ver 20260924_motivo_precios_incoherentes.sql).

ALTER TABLE public.sitio_web_config
    ADD COLUMN IF NOT EXISTS nivel_precio TEXT NOT NULL DEFAULT 'publico';

ALTER TABLE public.sitio_web_config
    DROP CONSTRAINT IF EXISTS sitio_web_config_nivel_precio_check;

ALTER TABLE public.sitio_web_config
    ADD CONSTRAINT sitio_web_config_nivel_precio_check
    CHECK (nivel_precio = ANY (ARRAY[
        'publico'::text,
        'mayoreo'::text,
        'distribuidor'::text
    ]));

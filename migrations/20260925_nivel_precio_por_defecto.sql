-- Con que nivel de precio arranca cada venta en el punto de venta.
--
-- Hasta ahora el carrito empezaba SIEMPRE en publico, y solo cambiaba de
-- nivel si se seleccionaba un cliente de credito con
-- nivel_precio_preferido. Pero hay negocios que venden casi todo a otro
-- nivel: Ferreteria Olimpico vende los productos de Diprofer a medio
-- mayoreo, asi que su cajero tenia que cambiar el nivel a mano en cada
-- venta, o cobrar de mas sin darse cuenta.
--
-- Los tres valores son los mismos que ya usan los botones de "Precio
-- aplicado" del POS (recalcularPreciosPorNivel):
--
--     publico       -> "Publico"
--     mayoreo       -> "Medio mayoreo"     (el nombre interno no coincide
--                                           con la etiqueta, es historico)
--     distribuidor  -> "Mayoreo / distribuidor"
--
-- El CHECK lista los tres desde el principio a proposito: agregar un
-- valor al codigo sin agregarlo aqui ya reventó una corrida entera antes
-- (ver 20260924_motivo_precios_incoherentes.sql).
--
-- El nivel del CLIENTE sigue mandando sobre este: al seleccionar un
-- cliente de credito con su propio nivel preferido, ese gana.

ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS nivel_precio_por_defecto TEXT NOT NULL DEFAULT 'publico';

ALTER TABLE public.negocios
    DROP CONSTRAINT IF EXISTS negocios_nivel_precio_por_defecto_check;

ALTER TABLE public.negocios
    ADD CONSTRAINT negocios_nivel_precio_por_defecto_check
    CHECK (nivel_precio_por_defecto = ANY (ARRAY[
        'publico'::text,
        'mayoreo'::text,
        'distribuidor'::text
    ]));

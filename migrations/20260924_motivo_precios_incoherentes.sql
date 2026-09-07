-- Un motivo de revision nuevo: 'precios_incoherentes'.
--
-- Marca los modulos a los que se les retiraron precios porque el valor
-- de una variante no cuadra con el de la otra. Caso real, producto 14958
-- del modulo 18004:
--
--     pub  495 / 545 / 595   (coherente entre si, se acepta)
--     dis  110               (18% del publico: mal leido, se acepta)
--
-- Cada variante se lee por separado, asi que el extractor no ve el
-- problema: las dos lecturas salen "confiables" y el modulo queda en
-- 'ok'. La incoherencia solo aparece al cruzarlas, ya en el nucleo. Sin
-- esta marca el modulo se queda en 'ok' para siempre, la vision nunca
-- entra a corregirlo, y ese producto no se recupera jamas.
--
-- El CHECK original solo admitia los motivos que se conocian entonces
-- ('estructura_ambigua', 'precios_incompletos'), asi que el UPDATE que
-- pone la marca reventaba la corrida entera:
--
--     violates check constraint
--     "catalogo_fabricante_modulos_motivo_revision_check"
--
-- Es el mismo tropiezo que ya hubo con origen_lectura al agregar
-- 'archivo' (ver 20260905_catalogo_fabricante_origenes.sql): cada motivo
-- nuevo tiene que aparecer aqui.

ALTER TABLE public.catalogo_fabricante_modulos
    DROP CONSTRAINT IF EXISTS catalogo_fabricante_modulos_motivo_revision_check;

ALTER TABLE public.catalogo_fabricante_modulos
    ADD CONSTRAINT catalogo_fabricante_modulos_motivo_revision_check
    CHECK (motivo_revision = ANY (ARRAY[
        ''::text,
        'estructura_ambigua'::text,
        'precios_incompletos'::text,
        'precios_incoherentes'::text
    ]));

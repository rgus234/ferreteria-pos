-- Cada producto del catalogo maestro lleva el giro al que pertenece, para que un abarrotes no vea cosas de ferreteria (ni al reves)
-- en las busquedas por nombre. "" = sin marcar: se decide por su origen (los de fabricante son de ferreteria).
ALTER TABLE public.catalogo_maestro_productos
    ADD COLUMN IF NOT EXISTS giro TEXT NOT NULL DEFAULT '';

-- Catalogo oficial de fabricante (Truper, Urrea, Diprofer...): ferreteria.
UPDATE public.catalogo_maestro_productos SET giro = 'ferreteria' WHERE giro = '' AND origen = 'fabricante';

-- Lo capturado con "Capturar codigos" es de abarrotes.
UPDATE public.catalogo_maestro_productos SET giro = 'abarrotes' WHERE giro = '' AND fuente_identidad = 'captura_propietario';

-- Lo que aporto un negocio toma el giro principal de ese negocio.
UPDATE public.catalogo_maestro_productos m
   SET giro = n.giro
  FROM public.negocios n
 WHERE m.giro = '' AND m.contribuido_por_negocio_id = n.id AND n.giro IN ('ferreteria', 'abarrotes', 'papeleria');

CREATE INDEX IF NOT EXISTS idx_catalogo_maestro_giro ON public.catalogo_maestro_productos (giro) WHERE giro <> '';

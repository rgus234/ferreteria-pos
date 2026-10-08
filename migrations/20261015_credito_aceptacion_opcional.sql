-- Exigir que el cliente acepte el acuerdo de credito (QR / enlace) pasa a
-- ser una opcion por negocio, apagada por defecto. Antes era obligatorio
-- para todos: un cliente sin acuerdo aceptado no podia comprar a credito,
-- y en una ferreteria real eso bloqueo clientes de toda la vida (11 de 18
-- en Ferreteria Olimpico). Apagado = se puede vender a credito sin ese
-- paso; encendido = el comportamiento estricto de siempre.

ALTER TABLE public.configuracion_credito_negocio
    ADD COLUMN IF NOT EXISTS exigir_aceptacion_acuerdo BOOLEAN NOT NULL DEFAULT false;

-- Costo real de compra por producto (Fase "Finanzas avanzadas real",
-- ver plan). Nunca se rellena desde precio_distribuidor -- esa columna
-- es un nivel de PRECIO DE VENTA (para clientes tipo distribuidor),
-- no el costo real; Recepcion Inteligente ya la sobreescribe con el
-- costo al confirmar una factura real, una inconsistencia preexistente
-- que esta migracion no corrige. NULL = costo desconocido (nunca 0 --
-- un producto sin costo capturado no es lo mismo que un producto que
-- de verdad cuesta $0).
ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS costo NUMERIC(12,2);

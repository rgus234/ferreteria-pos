-- Ventas con cantidades fraccionarias (0.96 kg, 0.715 m) en productos cuyo
-- stock es entero. productos.stock es INTEGER y el UPDATE de la venta
-- ("stock = stock - $1") hacia que Postgres leyera la cantidad como entero:
-- la venta completa fallaba con 500 y no se registraba.
--
-- stock sigue siendo la parte entera (todas las pantallas lo siguen leyendo
-- igual); stock_resto guarda la fraccion (0 <= resto < 1). Existencia real =
-- stock + stock_resto. Aditiva: DEFAULT 0, sin reescribir la tabla, y todo
-- producto existente queda con resto 0 (comportamiento identico al de hoy).
ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS stock_resto NUMERIC(12,3) NOT NULL DEFAULT 0;

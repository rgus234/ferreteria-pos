-- Margen de ganancia por categoria, independiente de proveedor -- caso
-- real pedido por el dueño: un producto llega sin factura (el
-- proveedor solo le dio el costo de palabra, ej. por telefono), y en
-- "Agregar producto" quiere escribir el costo, elegir la categoria
-- (ej. "Tornilleria y fijacion") y que Nexo calcule el precio de venta
-- solo, sin tener que abrir "Precios por proveedor" (que exige saber
-- de que proveedor exacto vino, y cuyos margenes son por proveedor+
-- categoria, no solo por categoria).
--
-- Una sola fila por negocio (a diferencia de reglas_precios_proveedor,
-- que tiene una fila POR proveedor) -- el mismo mapa categoria->margen
-- de siempre (JSONB, misma forma que reglas_precios_proveedor.margenes_categoria),
-- reusando categoria tal cual la guarda productos.categoria (los 15
-- departamentos de Categorias de Nexo cuando el negocio los usa, o
-- texto libre para negocios sin esa taxonomia activada).
CREATE TABLE IF NOT EXISTS public.margenes_categoria_negocio (
    negocio_id INTEGER PRIMARY KEY REFERENCES public.negocios(id) ON DELETE CASCADE,
    margenes_categoria JSONB NOT NULL DEFAULT '{}'::jsonb,
    redondeo TEXT NOT NULL DEFAULT 'ninguno',
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

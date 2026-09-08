-- Explorar Nexo, paso 7: un resultado que no esta en el inventario
-- (Catalogo Nexo o catalogo de proveedor) puede volverse un encargo
-- para un cliente. encargos_clientes_items ya aceptaba un producto
-- libre (nombre/codigo, producto_id opcional) pero no tenia donde
-- guardar el proveedor ni la marca -- se perdian en el camino.
-- Aditiva pura: nullable, no toca ninguna fila existente.
ALTER TABLE public.encargos_clientes_items
    ADD COLUMN IF NOT EXISTS proveedor TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS marca TEXT NOT NULL DEFAULT '';

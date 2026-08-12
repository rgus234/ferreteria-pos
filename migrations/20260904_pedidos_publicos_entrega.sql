-- Modo de entrega elegido por el cliente en el checkout de carrito de
-- Market (recoger en tienda vs domicilio) -- ver plan "Nexo Market --
-- disponibilidad, pedido/cotizacion y entrega seleccionable".
-- Nullable: pedidos creados antes de esta fase, o via el formulario de
-- "pedido rapido" de un solo producto (fuera de alcance), no lo traen.
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS entrega_modo TEXT CHECK (entrega_modo IS NULL OR entrega_modo IN ('recoleccion', 'domicilio'));

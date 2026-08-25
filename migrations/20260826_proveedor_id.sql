-- Fase 6 del plan "Catalogo Maestro Nexo": productos.proveedor es hoy
-- texto libre sin relacion real con la tabla proveedores -- un typo o
-- una mayuscula distinta saca al producto del conteo sin ningun
-- aviso. Aditiva pura: proveedor_id nullable, el texto proveedor se
-- queda intacto (dual-write mientras dura la transicion).
ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES public.proveedores(id);

-- Marca los proveedores creados automaticamente (por el backfill de
-- productos existentes, o al crear un producto desde un catalogo
-- cuyo nombre de proveedor no tenia fila real todavia) -- para poder
-- identificarlos/limpiarlos aparte si algo sale mal, sin tocar los
-- que el dueño si dio de alta a mano.
ALTER TABLE public.proveedores
    ADD COLUMN IF NOT EXISTS creado_automatico BOOLEAN NOT NULL DEFAULT false;

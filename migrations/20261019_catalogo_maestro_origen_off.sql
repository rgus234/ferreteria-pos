-- El Catalogo Maestro empieza a recibir identidad de abarrotes desde Open
-- Food Facts (base abierta de productos, licencia ODbL). Esa carga necesita
-- un valor propio en `origen` para poder distinguirla -- y revertirla -- sin
-- mezclarla con lo que vino de fabricantes (Truper/Diprofer) o de negocios.
--
-- Solo AMPLIA el CHECK (los valores existentes siguen siendo validos), asi que
-- ninguna fila actual se ve afectada.
ALTER TABLE public.catalogo_maestro_productos
    DROP CONSTRAINT IF EXISTS catalogo_maestro_productos_origen_check;

ALTER TABLE public.catalogo_maestro_productos
    ADD CONSTRAINT catalogo_maestro_productos_origen_check
    CHECK (origen IN ('negocio', 'fabricante', 'open_food_facts'));

-- Arbol de 3 niveles para ferreteria (departamento > categoria > subcategoria).
-- categorias_nexo.nombre sigue siendo la subcategoria (lo que ya lee el selector de producto);
-- "categoria" es el nivel de en medio y queda vacio en los arboles anteriores.
-- Aditiva pura: las filas nuevas viven con giro 'ferreteria_v2', asi que ningun negocio las ve hasta que
-- el codigo nuevo las pida; las 93 filas de giro 'ferreteria' no cambian (productos.categoria_nexo_id apunta a ellas).
ALTER TABLE public.categorias_nexo
    ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT '';

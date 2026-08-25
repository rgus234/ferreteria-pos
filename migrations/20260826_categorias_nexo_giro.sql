-- Fase 2 del plan "Catalogo Maestro Nexo": la taxonomia de categorias
-- estaba hardcodeada para un solo giro (ferreteria). Se agrega una
-- columna giro para poder tener arboles distintos por giro de negocio
-- (ferreteria, abarrotes, papeleria, ...) en la misma tabla.
--
-- Las 93 filas existentes de ferreteria NO cambian de id (el DEFAULT
-- las deja en 'ferreteria' sin tocarlas) -- critico porque
-- productos.categoria_nexo_id ya apunta a esos ids.
ALTER TABLE public.categorias_nexo
    ADD COLUMN IF NOT EXISTS giro TEXT NOT NULL DEFAULT 'ferreteria';

-- El UNIQUE anterior (departamento, nombre) no dejaria que abarrotes y
-- papeleria tuvieran, por ejemplo, un departamento "General" cada uno
-- sin chocar entre si. Se amplia el alcance -- no invalida ninguna
-- fila existente, todas siguen siendo unicas dentro de su giro.
ALTER TABLE public.categorias_nexo
    DROP CONSTRAINT IF EXISTS categorias_nexo_departamento_nombre_key;

ALTER TABLE public.categorias_nexo
    ADD CONSTRAINT categorias_nexo_giro_departamento_nombre_key UNIQUE (giro, departamento, nombre);

CREATE INDEX IF NOT EXISTS idx_categorias_nexo_giro ON public.categorias_nexo (giro);

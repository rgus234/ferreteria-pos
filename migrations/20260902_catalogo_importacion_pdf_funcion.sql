-- Nueva funcion de plan para el importador de catalogos PDF -- mismo
-- nivel que catalogo.importacion_listas (Plus en adelante), consistente
-- con que es la misma familia de funcion (automatizar la carga de
-- catalogos de proveedor) solo que para PDF en vez de CSV/Excel.
INSERT INTO public.catalogo_funciones (clave, nombre, categoria_id, descripcion, estado)
SELECT 'catalogo.importacion_pdf', 'Importación de catálogo PDF', c.id,
       'Extrae código, descripción, imagen y precio de catálogos PDF de proveedor', 'activo'
FROM public.categorias_funcion c
WHERE c.clave = 'catalogo_proveedor'
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.plan_funciones (plan_id, funcion_id, incluido, limite_numerico)
SELECT p.id, f.id, v.incluido, NULL::integer
FROM (VALUES
    ('basico', false), ('plus', true), ('pro', true)
) AS v(plan_clave, incluido)
JOIN public.planes p ON p.clave = v.plan_clave
JOIN public.catalogo_funciones f ON f.clave = 'catalogo.importacion_pdf'
ON CONFLICT (plan_id, funcion_id) DO NOTHING;

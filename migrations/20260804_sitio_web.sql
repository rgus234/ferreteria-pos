CREATE TABLE IF NOT EXISTS public.sitio_web_config (
    negocio_id INTEGER PRIMARY KEY REFERENCES public.negocios(id) ON DELETE CASCADE,
    activo BOOLEAN NOT NULL DEFAULT false,
    descripcion TEXT NOT NULL DEFAULT '',
    portada TEXT,
    horario_texto TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    facebook TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.categorias_funcion (clave, nombre, orden)
VALUES ('sitio_web', 'Sitio web', 100)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.catalogo_funciones (clave, nombre, categoria_id, descripcion, estado)
SELECT 'sitio_web.pagina', 'Sitio web propio', id, 'Pagina publica automatica en {slug}.nexoposoficial.com', 'activo'
FROM public.categorias_funcion WHERE clave = 'sitio_web'
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.plan_funciones (plan_id, funcion_id, incluido)
SELECT p.id, f.id, (p.clave IN ('plus', 'pro'))
FROM public.planes p, public.catalogo_funciones f
WHERE f.clave = 'sitio_web.pagina'
ON CONFLICT (plan_id, funcion_id) DO NOTHING;

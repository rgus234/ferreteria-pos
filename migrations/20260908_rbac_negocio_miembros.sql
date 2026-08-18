-- Fase 0 del ecosistema Nexo: primera pieza real de RBAC (roles y
-- permisos), evolucionando lo que ya existe en vez de reemplazarlo.
--
-- Hoy hay tres sistemas de sesion sin ningun puente entre si: empleados
-- (PIN + dispositivo vinculado, sin persona_id), sesiones_cuenta (dueno,
-- correo+contrasena, 1 token por negocio) y personas (identidad Nexo
-- raiz, se vincula a negocios.persona_id como "administrador" sin
-- ningun campo de rol). negocio_miembros es la tabla nueva que unifica
-- "que rol tiene esta persona en este negocio" sin tocar ni borrar
-- negocios.persona_id (varias rutas ya leen de ahi, se queda igual).

CREATE TABLE IF NOT EXISTS public.negocio_miembros (
    id SERIAL PRIMARY KEY,
    persona_id INTEGER NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    rol TEXT NOT NULL CHECK (rol IN ('owner', 'employee')),
    permisos JSONB NOT NULL DEFAULT '{}'::jsonb,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (persona_id, negocio_id)
);
CREATE INDEX IF NOT EXISTS idx_negocio_miembros_persona ON public.negocio_miembros(persona_id) WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_negocio_miembros_negocio ON public.negocio_miembros(negocio_id) WHERE activo = true;

-- Backfill: todo negocio que ya tiene un persona_id vinculado (flujo
-- "Administrar" ya existente, NEX3) obtiene su fila rol='owner' aqui,
-- sin tocar la columna original.
INSERT INTO public.negocio_miembros (persona_id, negocio_id, rol, permisos, activo)
SELECT persona_id, id, 'owner', '{}'::jsonb, true
FROM public.negocios
WHERE persona_id IS NOT NULL
ON CONFLICT (persona_id, negocio_id) DO NOTHING;

-- Puente que falta hoy entre "empleado con PIN" y "persona con cuenta
-- Nexo propia" -- sin esto un empleado nunca puede entrar con su
-- propio celular, solo con el PIN en un equipo ya vinculado.
ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS persona_id INTEGER REFERENCES public.personas(id);
ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS codigo_vinculo_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_empleados_codigo_vinculo ON public.empleados(codigo_vinculo_hash) WHERE codigo_vinculo_hash IS NOT NULL;

-- Gancho inerte para "identificar producto por foto" (RBAC3) -- mismo
-- espiritu que catalogo_funciones ya declara: puramente aditivo, sin
-- ningun enforcement todavia, solo deja el catalogo listo.
INSERT INTO public.catalogo_funciones (clave, nombre, categoria_id, descripcion, estado)
SELECT 'ia.identificar_producto_foto', 'Identificar producto por fotografia', c.id,
       'IA Nexo -- el empleado toma una foto de una pieza y Nexo sugiere el producto mas parecido del inventario', 'planeado'
FROM public.categorias_funcion c
WHERE c.clave = 'ia'
ON CONFLICT (clave) DO NOTHING;

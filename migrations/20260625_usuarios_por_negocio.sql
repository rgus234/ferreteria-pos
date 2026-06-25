-- Permite que distintos negocios usen el mismo nombre de usuario
-- sin mezclar accesos entre clientes.

ALTER TABLE IF EXISTS public.usuarios
ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id);

UPDATE public.usuarios
SET negocio_id = (SELECT id FROM public.negocios WHERE slug = 'ferreteria-olimpico')
WHERE negocio_id IS NULL;

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
        AND rel.relname = 'usuarios'
        AND con.contype = 'u'
        AND (
            SELECT array_agg(att.attname ORDER BY att.attnum)
            FROM unnest(con.conkey) key(attnum)
            JOIN pg_attribute att
            ON att.attrelid = rel.oid
            AND att.attnum = key.attnum
        ) = ARRAY['usuario']
    LOOP
        EXECUTE format(
            'ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS %I',
            constraint_name
        );
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_negocio_usuario_unique
ON public.usuarios (negocio_id, usuario);

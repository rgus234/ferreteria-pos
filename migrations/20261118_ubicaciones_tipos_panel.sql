-- Mas tipos de lugar para el mapa de la tienda: panel (pared de ganchos), mostrador y vitrina.
-- Solo AMPLIA la regla de tipos: los lugares que ya existen no cambian. Se puede correr varias veces.
DO $$
DECLARE c RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ubicaciones'::regclass AND conname = 'ubicaciones_tipo_check_v2') THEN
        FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.ubicaciones'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%tipo%' LOOP
            EXECUTE format('ALTER TABLE public.ubicaciones DROP CONSTRAINT %I', c.conname);
        END LOOP;
        ALTER TABLE public.ubicaciones ADD CONSTRAINT ubicaciones_tipo_check_v2
            CHECK (tipo IN ('pasillo', 'seccion', 'estante', 'rack', 'nivel', 'panel', 'mostrador', 'vitrina'));
    END IF;
END $$;

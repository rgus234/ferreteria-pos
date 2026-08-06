ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS oficio TEXT;
ALTER TABLE public.personas ADD CONSTRAINT personas_oficio_valido
    CHECK (oficio IS NULL OR oficio IN
        ('herramientas','construccion','electrico','plomeria',
         'pintura','seguridad','jardin','limpieza','otro'));

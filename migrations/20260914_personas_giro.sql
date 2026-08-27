ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS giro TEXT;
ALTER TABLE public.personas ADD CONSTRAINT personas_giro_valido
    CHECK (giro IS NULL OR giro IN
        ('ferreteria','abarrotes','papeleria','otro'));

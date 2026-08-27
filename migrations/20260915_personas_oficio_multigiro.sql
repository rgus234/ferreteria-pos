-- personas_oficio_valido (20260814_personas_oficio.sql) solo conocia
-- las 9 claves de ferreteria. Con oficio giro-consciente (ver
-- 20260914_personas_giro.sql), las claves validas de abarrotes y
-- papeleria (oficios-persona.js) tambien deben poder guardarse.
ALTER TABLE public.personas DROP CONSTRAINT IF EXISTS personas_oficio_valido;
ALTER TABLE public.personas ADD CONSTRAINT personas_oficio_valido
    CHECK (oficio IS NULL OR oficio IN
        ('herramientas','construccion','electrico','plomeria',
         'pintura','seguridad','jardin','limpieza',
         'despensa','bebidas','lacteos_panaderia','frescos',
         'botanas_dulces','limpieza_hogar','higiene_personal','congelados',
         'escolar','oficina','arte_manualidades','impresion_copiado',
         'empastado','tecnologia',
         'otro'));

-- Fase 1 del plan "Catalogo Maestro Nexo": el giro de un negocio hoy
-- vive en dos lugares que no se sincronizan -- negocios.giro (columna
-- real pero solo usada como etiqueta cosmetica en Nexo Market) y
-- configuracionNegocio().giroNegocio (100% localStorage del navegador,
-- nunca llega al servidor, y es el que de verdad decide si aparece la
-- taxonomia estructurada de categorias). Esta tabla se vuelve la unica
-- fuente real, y permite que un negocio tenga varios giros activos a
-- la vez (ferreteria + abarrotes + papeleria en el mismo negocio).
CREATE TABLE IF NOT EXISTS public.negocio_giros (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    giro TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (negocio_id, giro)
);

CREATE INDEX IF NOT EXISTS idx_negocio_giros_negocio_activo
    ON public.negocio_giros (negocio_id, activo);

-- Backfill aditivo: un giro inicial por negocio, tomado de su
-- negocios.giro actual (que ya tiene default 'ferreteria', asi que
-- cubre a todos los negocios existentes sin ambiguedad). No se toca
-- ni se borra negocios.giro -- sigue sirviendo su unico proposito de
-- hoy (etiqueta cosmetica en las tarjetas de Nexo Market).
INSERT INTO public.negocio_giros (negocio_id, giro, activo)
SELECT id, COALESCE(NULLIF(TRIM(giro), ''), 'ferreteria'), true
FROM public.negocios
ON CONFLICT (negocio_id, giro) DO NOTHING;

-- Prueba de 45 dias para negocios piloto: seguimiento de la prueba, encuesta de
-- opinion y decision de seguir (cuota de $100 al mes) o no.
--
-- Aditiva: columnas nuevas con DEFAULT/NULL y una tabla nueva. No cambia ninguna
-- fila existente salvo marcar como piloto las licencias que ya nacieron de una
-- invitacion (por su nota "Piloto por invitacion ...").

ALTER TABLE public.licencias
    ADD COLUMN IF NOT EXISTS piloto BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS aviso_fin_prueba_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decision_piloto TEXT,
    ADD COLUMN IF NOT EXISTS decision_piloto_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'licencias_decision_piloto_check'
    ) THEN
        ALTER TABLE public.licencias
            ADD CONSTRAINT licencias_decision_piloto_check
            CHECK (decision_piloto IS NULL OR decision_piloto IN ('seguir', 'no_por_ahora'));
    END IF;
END $$;

UPDATE public.licencias SET piloto = true WHERE notas LIKE 'Piloto por invitacion%';

CREATE TABLE IF NOT EXISTS public.encuestas_piloto (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    calificacion SMALLINT NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
    lo_mejor TEXT NOT NULL DEFAULT '',
    lo_que_falta TEXT NOT NULL DEFAULT '',
    seguiria BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encuestas_piloto_negocio ON public.encuestas_piloto (negocio_id, created_at DESC);

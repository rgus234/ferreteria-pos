-- Enfriamiento para el correo de "tu prueba gratuita esta por
-- terminar" (prueba-recordatorios-server.js) -- mismo patron que
-- recordatorios_credito_vencido, un renglon por negocio evita que se
-- reenvie el mismo aviso en cada corrida del programador.
CREATE TABLE IF NOT EXISTS public.recordatorios_prueba_por_terminar (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    enviado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordatorios_prueba_negocio
    ON public.recordatorios_prueba_por_terminar (negocio_id, enviado_at);

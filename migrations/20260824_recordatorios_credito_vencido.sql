-- Bitacora de recordatorios automaticos de credito vencido ("no
-- olvides pagar tu credito", idea original del dueño). Un renglon por
-- push enviado -- credito-recordatorios-server.js la usa para no
-- reavisarle al mismo cliente por el mismo adeudo cada vez que corre
-- la revision (enfriamiento de unos dias entre avisos).

CREATE TABLE IF NOT EXISTS public.recordatorios_credito_vencido (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES public.clientes_credito(id) ON DELETE CASCADE,
    enviado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordatorios_credito_vencido_cliente
    ON public.recordatorios_credito_vencido (cliente_id, enviado_at);

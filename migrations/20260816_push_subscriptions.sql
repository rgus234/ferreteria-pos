-- Suscripciones de notificaciones push (Web Push/VAPID) -- avisos de
-- pedido nuevo al dueno (tipo='admin', ligado a un negocio) y avisos de
-- cambio de estado al cliente (tipo='cliente', ligado a una persona).
-- Una fila por dispositivo/navegador suscrito -- el mismo negocio o
-- persona puede tener varias filas (varios equipos/celulares).

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id SERIAL PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('admin', 'cliente')),
    negocio_id INTEGER REFERENCES public.negocios(id) ON DELETE CASCADE,
    persona_id INTEGER REFERENCES public.personas(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso_at TIMESTAMPTZ,
    CONSTRAINT push_subscriptions_dueno_valido CHECK (
        (tipo = 'admin' AND negocio_id IS NOT NULL)
        OR (tipo = 'cliente' AND persona_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_negocio
    ON public.push_subscriptions (negocio_id) WHERE negocio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_persona
    ON public.push_subscriptions (persona_id) WHERE persona_id IS NOT NULL;

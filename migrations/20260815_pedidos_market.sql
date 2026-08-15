-- Rediseno del flujo de pedidos de Nexo Market (solo recoleccion en
-- tienda por ahora). Hoy "el pedido" es implicito -- pedidos_publicos
-- guarda una fila por producto agrupada por grupo_id, y el backend ya
-- tiene que hacer UPDATE...WHERE grupo_id=$1 para tratarlas como una
-- sola cosa (ver PATCH /negocio-actual/pedidos-publicos/:id). Esta
-- migracion agrega una tabla cabecera real (una fila por pedido) con su
-- propio estado, codigo de recogida, tiempos y QR/barcode. pedidos_publicos
-- sigue existiendo tal cual para cotizaciones y pedidos del sitio propio
-- del negocio; solo gana una columna opcional para enlazar con la
-- cabecera cuando el pedido es de Market.
--
-- fulfillment ya incluye 'delivery' en el CHECK aunque hoy solo se use
-- 'pickup' -- para no tener que tocar el constraint cuando se construya
-- envio a domicilio despues.

CREATE TABLE IF NOT EXISTS public.pedidos_market (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    persona_id INTEGER REFERENCES public.personas(id),
    grupo_id TEXT NOT NULL UNIQUE,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT NOT NULL DEFAULT '',
    cliente_correo TEXT NOT NULL DEFAULT '',
    fulfillment TEXT NOT NULL DEFAULT 'pickup'
        CHECK (fulfillment IN ('pickup', 'delivery')),
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'recibido', 'confirmado', 'preparando', 'listo', 'entregado', 'cancelado')),
    motivo_cancelacion TEXT,
    codigo_recogida TEXT NOT NULL UNIQUE,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    pagado BOOLEAN NOT NULL DEFAULT false,
    tiempo_prep_min INTEGER,
    tiempo_prep_max INTEGER,
    recogida_estimada_desde TIMESTAMPTZ,
    recogida_estimada_hasta TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recibido_at TIMESTAMPTZ,
    confirmado_at TIMESTAMPTZ,
    preparando_at TIMESTAMPTZ,
    listo_at TIMESTAMPTZ,
    entregado_at TIMESTAMPTZ,
    cancelado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pedidos_market_negocio_estado
    ON public.pedidos_market (negocio_id, estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pedidos_market_persona
    ON public.pedidos_market (persona_id) WHERE persona_id IS NOT NULL;

ALTER TABLE public.pedidos_publicos
    ADD COLUMN IF NOT EXISTS pedido_market_id INTEGER REFERENCES public.pedidos_market(id);

-- Configuracion de tiempo de preparacion por negocio (Sitio web). Cada
-- pedido copia estos valores a tiempo_prep_min/max al crearse, para que
-- un cambio de configuracion despues no reescriba pedidos ya hechos.
ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS pedido_prep_min INTEGER NOT NULL DEFAULT 30;
ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS pedido_prep_max INTEGER NOT NULL DEFAULT 45;

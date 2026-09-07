-- Capa de "Acuerdo de Credito": condiciones por negocio, plazo/limite
-- individuales por cliente, y un acuerdo versionado e inmutable que el
-- cliente debe aceptar antes de que la cuenta quede operable. Ver el
-- diseno completo (arquitectura discutida y cerrada con el dueno,
-- incluyendo el porque de cada decision) antes de tocar este archivo.

-- 1. Condiciones que cada negocio ofrece (plazos, requisitos, politica).
-- Separado de sitio_web_config.aceptar_solicitudes_credito, que sigue
-- siendo el interruptor general -- esto es la configuracion fina.
CREATE TABLE IF NOT EXISTS public.configuracion_credito_negocio (
    negocio_id INTEGER PRIMARY KEY REFERENCES public.negocios(id) ON DELETE CASCADE,
    plazos_disponibles INTEGER[] NOT NULL DEFAULT ARRAY[15, 30, 60],
    requiere_identificacion BOOLEAN NOT NULL DEFAULT false,
    requiere_domicilio BOOLEAN NOT NULL DEFAULT false,
    politica_texto TEXT NOT NULL DEFAULT '',
    actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. clientes_credito gana plazo individual, suspension y el puntero
-- al acuerdo vigente. dias_credito reemplaza el "15 dias" hardcodeado
-- de server.js -- todo cliente ya existente se llena con 15 (su
-- comportamiento actual, sin sorpresas para nadie).
ALTER TABLE public.clientes_credito
    ADD COLUMN IF NOT EXISTS dias_credito INTEGER,
    ADD COLUMN IF NOT EXISTS suspendido BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS acuerdo_vigente_id INTEGER;

UPDATE public.clientes_credito SET dias_credito = 15 WHERE dias_credito IS NULL;

ALTER TABLE public.clientes_credito
    ALTER COLUMN dias_credito SET NOT NULL,
    ALTER COLUMN dias_credito SET DEFAULT 15;

-- Una persona no puede tener dos filas de clientes_credito en el mismo
-- negocio -- el hueco de integridad que negocio_miembros ya resolvia
-- bien y esta tabla no.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clientes_credito_persona_negocio
    ON public.clientes_credito (persona_id, negocio_id)
    WHERE persona_id IS NOT NULL;

-- 3. solicitudes_credito gana el puente hacia clientes_credito, el
-- vinculo a personas (obligatorio para solicitudes nuevas desde
-- Market -- se aplica en el codigo, no aqui, para no romper filas
-- viejas ya anonimas) y el plazo que el cliente pidio.
ALTER TABLE public.solicitudes_credito
    ADD COLUMN IF NOT EXISTS persona_id INTEGER REFERENCES public.personas(id),
    ADD COLUMN IF NOT EXISTS cliente_credito_id INTEGER REFERENCES public.clientes_credito(id),
    ADD COLUMN IF NOT EXISTS plazo_solicitado_dias INTEGER;

-- Amplia el catalogo de estados (antes solo pendiente/aprobado/
-- rechazado) sin asumir el nombre exacto que Postgres le dio al CHECK
-- original.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.solicitudes_credito'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%estado%'
    LOOP
        EXECUTE 'ALTER TABLE public.solicitudes_credito DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE public.solicitudes_credito
    ADD CONSTRAINT solicitudes_credito_estado_check
    CHECK (estado IN ('pendiente', 'informacion_solicitada', 'aprobado', 'rechazado', 'cancelada', 'expirada'));

-- 4. El acuerdo mismo: una fotografia inmutable por version. Nunca se
-- edita una fila ya existente -- un cambio siempre crea una fila
-- nueva con version+1.
CREATE TABLE IF NOT EXISTS public.acuerdos_credito (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    cliente_credito_id INTEGER NOT NULL REFERENCES public.clientes_credito(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    limite_credito NUMERIC(12,2) NOT NULL,
    dias_credito INTEGER NOT NULL,
    condiciones_texto TEXT NOT NULL,
    contenido_hash TEXT NOT NULL,
    pdf_bytes BYTEA,
    origen TEXT NOT NULL CHECK (origen IN ('solicitud_online', 'alta_pos', 'cambio_limite', 'cambio_plazo')),
    solicitud_id INTEGER REFERENCES public.solicitudes_credito(id),
    generado_por JSONB NOT NULL DEFAULT '{}'::jsonb,
    generado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado TEXT NOT NULL DEFAULT 'pendiente_aceptacion'
        CHECK (estado IN ('pendiente_aceptacion', 'aceptado', 'rechazado_por_cliente', 'expirado', 'reemplazado')),
    -- Aceptacion sin cuenta Nexo (alta directa en el POS): enlace/QR de
    -- un solo uso, nunca el token en claro -- mismo patron que
    -- clientes_credito.codigo_acceso_hash.
    token_aceptacion_hash TEXT,
    token_aceptacion_expira_at TIMESTAMPTZ,
    token_aceptacion_usado_at TIMESTAMPTZ,
    UNIQUE (cliente_credito_id, version)
);

CREATE INDEX IF NOT EXISTS idx_acuerdos_credito_cliente
    ON public.acuerdos_credito (cliente_credito_id, version DESC);

-- Puntero al acuerdo vigente -- se agrega como FK aparte porque la
-- tabla no existia todavia cuando se creo la columna arriba.
DO $$ BEGIN
    ALTER TABLE public.clientes_credito
        ADD CONSTRAINT fk_clientes_credito_acuerdo_vigente
        FOREIGN KEY (acuerdo_vigente_id) REFERENCES public.acuerdos_credito(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. La aceptacion: quien, cuando, desde donde, y con que metodo de
-- identidad. 1 a 1 con un acuerdo -- un acuerdo que nunca se acepta
-- simplemente no tiene fila aqui.
CREATE TABLE IF NOT EXISTS public.aceptaciones_credito (
    id SERIAL PRIMARY KEY,
    acuerdo_credito_id INTEGER NOT NULL UNIQUE REFERENCES public.acuerdos_credito(id) ON DELETE CASCADE,
    persona_id INTEGER REFERENCES public.personas(id),
    aceptado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip TEXT,
    user_agent TEXT,
    metodo TEXT NOT NULL CHECK (metodo IN ('sesion_persona', 'presencial_pos', 'enlace_token')),
    contenido_hash_verificado TEXT NOT NULL
);

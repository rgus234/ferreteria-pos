-- Salud de la API de IA.
--
-- El 2026-09-02 se descubrio por casualidad que la cuenta de Anthropic
-- estaba SIN SALDO: "Your credit balance is too low to access the
-- Anthropic API". Eso deja a Nexo IA sin responder para todos los
-- clientes, y a la lectura asistida de catalogos sin respaldo.
--
-- Nadie se entero. No habia forma de enterarse: cada llamada fallaba en
-- su propio try/catch, el cliente veia un mensaje generico y el dueno no
-- veia nada. Se descubrio porque una prueba de otra cosa choco con ello.
--
-- Una sola fila con el ultimo estado conocido. No es un historial: es un
-- semaforo para el panel del dueno.

CREATE TABLE IF NOT EXISTS public.ia_salud (
    -- Fuerza que exista una sola fila.
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),

    -- 'ok' | 'sin_saldo' | 'llave_invalida' | 'limite' | 'caida'
    estado TEXT NOT NULL DEFAULT 'ok',
    detalle TEXT NOT NULL DEFAULT '',
    -- De donde salio el fallo: nexo_ia, catalogo_pdf, catalogo_fabricante.
    origen TEXT NOT NULL DEFAULT '',

    fallos_seguidos INTEGER NOT NULL DEFAULT 0,
    ultimo_fallo_en TIMESTAMPTZ,
    ultimo_exito_en TIMESTAMPTZ,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.ia_salud (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

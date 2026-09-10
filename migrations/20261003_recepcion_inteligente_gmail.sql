-- Recepcion Inteligente, Fase 2: la factura llega sola por Gmail en vez
-- de subirse a mano. Una sola tabla, una fila por negocio (a lo mas un
-- correo conectado por negocio a la vez -- si mas adelante hace falta
-- mas de uno, esto se amplia, no se rehace).
--
-- El pipeline que interpreta el XML (parsearCfdi, resolverProveedorPorRfc,
-- resolverConceptoFactura, y "queda pendiente hasta que confirmes") es
-- EXACTAMENTE el mismo de la Fase 1 (procesarFacturaXml en
-- recepcion-inteligente-server.js) -- esta tabla solo guarda la conexion
-- OAuth y el cursor de hasta donde ya se reviso ese buzon, nada de logica
-- de negocio nueva.
--
-- refresh_token en texto plano: mismo nivel de proteccion que el resto de
-- credenciales de este proyecto (acceso a la base ya requiere SSL +
-- usuario/password de Postgres) -- no hay todavia un cifrado de secretos
-- a nivel de aplicacion en este proyecto, y no es esta migracion el lugar
-- para introducirlo solo para este caso.
CREATE TABLE IF NOT EXISTS public.recepcion_inteligente_gmail (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL UNIQUE REFERENCES public.negocios(id),
    correo_conectado TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    -- Arranca en el momento de conectar (NOW()), nunca en el pasado: no
    -- se quiere importar de golpe todo el historial del buzon la primera
    -- vez que alguien conecta su Gmail.
    ultima_revision_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activo BOOLEAN NOT NULL DEFAULT true,
    conectado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    desconectado_en TIMESTAMPTZ
);

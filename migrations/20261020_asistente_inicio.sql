-- Asistente de inicio (primer uso). Un cliente nuevo configura su negocio
-- paso a paso (giro, correos, datos, como vende) en vez de caer directo a un
-- sistema vacio.
--
-- slogan: antes vivia SOLO en el localStorage de cada caja y se perdia al
-- reconectar (la config local se reconstruia desde el servidor sin el).
-- correo_negocio: correo de contacto del negocio (reportes, avisos). Es
-- distinto de negocios.correo, que es el correo de ACCESO de la cuenta.
-- onboarding_respuestas: como vende (granel, fiado, caducidades, tickets...).
--   Se guardan para adaptar la experiencia por giro; hoy solo algunas se
--   aplican (nivel de precio, impresion automatica).
-- onboarding_completado_at: NULL = el asistente sigue pendiente.
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS slogan TEXT NOT NULL DEFAULT '';
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS correo_negocio TEXT NOT NULL DEFAULT '';
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS onboarding_respuestas JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS onboarding_completado_at TIMESTAMPTZ;

-- Los negocios que ya operan no pasan por el asistente: ya tienen su
-- configuracion hecha. Solo los que se registren a partir de ahora.
UPDATE public.negocios
   SET onboarding_completado_at = COALESCE(created_at, NOW())
 WHERE onboarding_completado_at IS NULL;

-- Fase 1 del ecosistema Nexo: sesiones_cuenta necesita saber si el
-- token que emitio pertenece a una persona (empleado con cuenta Nexo
-- propia, via negocio_miembros) o si es una sesion clasica de dueno
-- (correo+contrasena del negocio, como hasta hoy). Ambas columnas
-- nullable: las filas existentes se quedan en NULL, que sigue
-- significando exactamente lo que significa hoy -- sesion de dueno sin
-- restriccion. Aditivo, sin backfill necesario.

ALTER TABLE public.sesiones_cuenta ADD COLUMN IF NOT EXISTS persona_id INTEGER REFERENCES public.personas(id);
ALTER TABLE public.sesiones_cuenta ADD COLUMN IF NOT EXISTS rol TEXT CHECK (rol IS NULL OR rol IN ('owner', 'employee'));

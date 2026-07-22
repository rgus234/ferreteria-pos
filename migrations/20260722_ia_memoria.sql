-- Memoria minima de Nexo AI (v2): cuenta cuantas veces se abre cada
-- modulo por conversacion, para inyectar un resumen barato (una
-- linea) al system prompt -- nunca se manda el JSON completo ni un
-- historial de conversacion real. JSONB en la misma tabla que ya
-- guarda el estado de IA por negocio (ia_nivel3_usos/periodo),
-- evita una tabla nueva para algo de este tamano.
--
-- El default arranca con la clave "modulosAbiertos" ya presente
-- (objeto vacio) para que jsonb_set pueda escribir directo en
-- ia_memoria->modulosAbiertos->>modulo sin necesitar crear el nivel
-- intermedio en cada UPDATE.
ALTER TABLE public.licencias
    ADD COLUMN IF NOT EXISTS ia_memoria JSONB NOT NULL DEFAULT '{"modulosAbiertos": {}}'::jsonb;

-- Contador de uso mensual de Nexo IA Nivel 3 (unico nivel con costo
-- real por llamada) para aplicar los limites por plan de IA-4.
ALTER TABLE public.licencias
    ADD COLUMN IF NOT EXISTS ia_nivel3_usos INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ia_nivel3_periodo TEXT;

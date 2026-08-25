-- Horario laboral por empleado + turnos de caja por empleado (ver plan
-- "Horario laboral por empleado + turnos de caja simultaneos +
-- bloqueo"). NULL en horario_laboral significa "sin horario
-- configurado" -- el empleado no se ve afectado por el bloqueo.
ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS horario_laboral JSONB;

-- Nullable a proposito: turnos de negocios que no usan "usuarios del
-- sistema" siguen sin empleado_id, igual que hoy (turnos_caja.usuario
-- sigue siendo el campo de texto libre existente).
ALTER TABLE public.turnos_caja ADD COLUMN IF NOT EXISTS empleado_id INTEGER REFERENCES public.empleados(id);

CREATE INDEX IF NOT EXISTS idx_turnos_caja_empleado_estado
    ON public.turnos_caja (empleado_id, estado)
    WHERE empleado_id IS NOT NULL;

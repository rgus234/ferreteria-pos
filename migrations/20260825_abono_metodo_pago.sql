-- Un abono a credito no distinguia como se pago (efectivo, tarjeta o
-- transferencia) -- se registraba el monto y ya, sin rastro para el
-- corte de caja ni los reportes. Mismo nombre de columna que ya usa
-- historial_ventas.metodo_pago.
ALTER TABLE public.movimientos_credito ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'efectivo';

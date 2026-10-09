-- Recepcion rapida de mercancia desde el celular (POST
-- /recepciones-mercancia/rapida): suma stock, guarda costo, registra el
-- ajuste de inventario y el historial en una sola transaccion. Con mala
-- señal el celular puede reintentar la misma peticion, y repetir una
-- recepcion duplicaria el stock -- esta llave (la genera el celular una
-- vez por recepcion) hace que un reintento devuelva la recepcion ya
-- guardada en vez de sumar otra vez. Mismo patron que
-- historial_ventas.idempotency_key.

ALTER TABLE public.recepciones_mercancia
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recepciones_mercancia_idempotencia
    ON public.recepciones_mercancia (negocio_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

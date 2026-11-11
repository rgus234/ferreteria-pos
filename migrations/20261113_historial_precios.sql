-- Historial de precios: cada cambio de precio o costo de un producto queda registrado (de donde venga: edicion, recepcion, lote, catalogo...).
-- Se llena con un disparador en productos: asi no se escapa ningun camino. Nunca puede tumbar un guardado: si algo falla, se ignora.
-- El origen, el lote y el motivo los pone la pantalla de "Actualizar precios" con set_config('nexo.origen' ...) dentro de su transaccion.
CREATE TABLE IF NOT EXISTS public.historial_precios (
    id BIGSERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL,
    producto_nombre TEXT NOT NULL DEFAULT '',
    campo TEXT NOT NULL,
    anterior NUMERIC(12, 2),
    nuevo NUMERIC(12, 2),
    origen TEXT NOT NULL DEFAULT 'edicion',
    lote_id TEXT,
    motivo TEXT NOT NULL DEFAULT '',
    usuario TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS historial_precios_producto_idx ON public.historial_precios (negocio_id, producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS historial_precios_lote_idx ON public.historial_precios (negocio_id, lote_id) WHERE lote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.registrar_historial_precios() RETURNS trigger AS $$
DECLARE
    v_origen TEXT;
    v_lote TEXT;
    v_motivo TEXT;
    v_usuario TEXT;
BEGIN
    BEGIN
        v_origen := COALESCE(NULLIF(current_setting('nexo.origen', true), ''), CASE WHEN TG_OP = 'INSERT' THEN 'alta' ELSE 'edicion' END);
        v_lote := NULLIF(current_setting('nexo.lote', true), '');
        v_motivo := COALESCE(current_setting('nexo.motivo', true), '');
        v_usuario := COALESCE(current_setting('nexo.usuario', true), '');

        IF TG_OP = 'INSERT' THEN
            IF NEW.precio_publico IS NOT NULL AND NEW.precio_publico <> 0 THEN
                INSERT INTO public.historial_precios (negocio_id, producto_id, producto_nombre, campo, anterior, nuevo, origen, lote_id, motivo, usuario)
                VALUES (NEW.negocio_id, NEW.id, COALESCE(NEW.nombre, ''), 'precio_publico', NULL, NEW.precio_publico, v_origen, v_lote, v_motivo, v_usuario);
            END IF;
        ELSE
            IF NEW.precio_publico IS DISTINCT FROM OLD.precio_publico THEN
                INSERT INTO public.historial_precios (negocio_id, producto_id, producto_nombre, campo, anterior, nuevo, origen, lote_id, motivo, usuario)
                VALUES (NEW.negocio_id, NEW.id, COALESCE(NEW.nombre, ''), 'precio_publico', OLD.precio_publico, NEW.precio_publico, v_origen, v_lote, v_motivo, v_usuario);
            END IF;
            IF NEW.precio_mayoreo IS DISTINCT FROM OLD.precio_mayoreo THEN
                INSERT INTO public.historial_precios (negocio_id, producto_id, producto_nombre, campo, anterior, nuevo, origen, lote_id, motivo, usuario)
                VALUES (NEW.negocio_id, NEW.id, COALESCE(NEW.nombre, ''), 'precio_mayoreo', OLD.precio_mayoreo, NEW.precio_mayoreo, v_origen, v_lote, v_motivo, v_usuario);
            END IF;
            IF NEW.precio_distribuidor IS DISTINCT FROM OLD.precio_distribuidor THEN
                INSERT INTO public.historial_precios (negocio_id, producto_id, producto_nombre, campo, anterior, nuevo, origen, lote_id, motivo, usuario)
                VALUES (NEW.negocio_id, NEW.id, COALESCE(NEW.nombre, ''), 'precio_distribuidor', OLD.precio_distribuidor, NEW.precio_distribuidor, v_origen, v_lote, v_motivo, v_usuario);
            END IF;
            IF NEW.costo IS DISTINCT FROM OLD.costo THEN
                INSERT INTO public.historial_precios (negocio_id, producto_id, producto_nombre, campo, anterior, nuevo, origen, lote_id, motivo, usuario)
                VALUES (NEW.negocio_id, NEW.id, COALESCE(NEW.nombre, ''), 'costo', OLD.costo, NEW.costo, v_origen, v_lote, v_motivo, v_usuario);
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historial_precios_actualizar ON public.productos;
CREATE TRIGGER trg_historial_precios_actualizar
    AFTER UPDATE OF precio_publico, precio_mayoreo, precio_distribuidor, costo ON public.productos
    FOR EACH ROW
    WHEN (OLD.precio_publico IS DISTINCT FROM NEW.precio_publico
       OR OLD.precio_mayoreo IS DISTINCT FROM NEW.precio_mayoreo
       OR OLD.precio_distribuidor IS DISTINCT FROM NEW.precio_distribuidor
       OR OLD.costo IS DISTINCT FROM NEW.costo)
    EXECUTE FUNCTION public.registrar_historial_precios();

DROP TRIGGER IF EXISTS trg_historial_precios_alta ON public.productos;
CREATE TRIGGER trg_historial_precios_alta
    AFTER INSERT ON public.productos
    FOR EACH ROW
    EXECUTE FUNCTION public.registrar_historial_precios();

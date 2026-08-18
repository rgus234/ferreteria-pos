-- Verificacion de picking por item (escaneo o manual) al preparar un
-- pedido de Market -- ver "flujo tipo almacen (Amazon/Mercado Libre)":
-- imprimir pedido, escanear cada producto para confirmarlo antes de
-- marcarlo listo. verificado_metodo distingue escaneo (codigo
-- confirmado contra producto_codigo) de manual (el empleado confirmo a
-- ojo, ej. productos sin codigo de barras real) para poder auditar
-- despues cuales items no pasaron por lector.
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS verificado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS verificado_at TIMESTAMPTZ;
ALTER TABLE public.pedidos_publicos ADD COLUMN IF NOT EXISTS verificado_metodo TEXT CHECK (verificado_metodo IS NULL OR verificado_metodo IN ('escaneo', 'manual'));

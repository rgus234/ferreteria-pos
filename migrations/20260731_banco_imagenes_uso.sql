-- Log de solo apendizado de cada vez que un negocio copia una foto del
-- Banco de Nexo a su propia ficha (POST /banco-imagenes/:codigo/usar).
-- Alimenta el conteo "Usos (N)" y la pestana "Historial" del panel de
-- detalle en Admin.

CREATE TABLE IF NOT EXISTS public.banco_imagenes_uso (
    id SERIAL PRIMARY KEY,
    banco_imagen_id INTEGER NOT NULL REFERENCES public.banco_imagenes_producto(id) ON DELETE CASCADE,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    galeria_id INTEGER REFERENCES public.banco_imagenes_producto_galeria(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banco_img_uso_banco
    ON public.banco_imagenes_uso (banco_imagen_id, created_at DESC);

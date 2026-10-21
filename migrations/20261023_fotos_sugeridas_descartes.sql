-- Pantalla "Fotos sugeridas": el negocio revisa, producto por producto, la foto
-- que el Banco de Nexo sugiere y confirma con un toque. Cuando dice "no es",
-- se recuerda para no volver a ofrecer la misma foto para el mismo producto.
--
-- Aditiva: tabla nueva, no toca productos ni fotos. Si se borra el producto se
-- borra su registro (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS public.fotos_sugeridas_descartes (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    codigo_banco TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (producto_id, codigo_banco)
);

CREATE INDEX IF NOT EXISTS idx_fotos_sugeridas_descartes_negocio
    ON public.fotos_sugeridas_descartes (negocio_id);

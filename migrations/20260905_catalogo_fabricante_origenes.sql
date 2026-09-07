-- El CHECK de origen_lectura se escribio cuando la unica fuente era
-- TRUPER, asi que solo admitia los origenes de una lectura de imagen
-- (ocr / vision / sin_precios_publicados / manual). Al correr el mismo
-- nucleo con un proveedor que manda lista de precios en CSV, el INSERT
-- reventaba: 'archivo' no estaba permitido.
--
-- Se amplia a los origenes del contrato generico. Cada formato nuevo que
-- se soporte (api, pdf) tiene que aparecer aqui.

ALTER TABLE public.catalogo_fabricante_productos
    DROP CONSTRAINT IF EXISTS catalogo_fabricante_productos_origen_lectura_check;

ALTER TABLE public.catalogo_fabricante_productos
    ADD CONSTRAINT catalogo_fabricante_productos_origen_lectura_check
    CHECK (origen_lectura IN (
        '',
        'ocr',                     -- imagen leida con tesseract
        'vision',                  -- imagen rescatada con IA
        'sin_precios_publicados',  -- la fuente deja la columna vacia
        'archivo',                 -- CSV / Excel del proveedor
        'api',                     -- respuesta de una API
        'pdf',
        'manual'                   -- corregido por una persona
    ));

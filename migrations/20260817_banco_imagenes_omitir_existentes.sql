-- La importacion masiva del Banco de imagenes siempre sobreescribia
-- (upsert) cada codigo dentro de un zip, incluso si ya tenia foto --
-- comprimir de nuevo cientos de imagenes ya cubiertas hacia que subir
-- carpetas grandes de un proveedor fuera lento e inutil para el caso
-- real: rellenar solo los codigos que todavia no tienen foto. Estas
-- columnas dejan que procesarZipBancoImagenes salte los codigos que ya
-- existen (sin comprimir ni tocar la fila) y que el trabajo reporte
-- cuantos/cuales se omitieron vs. cuales son nuevos.

ALTER TABLE public.banco_imagenes_importacion_trabajos
    ADD COLUMN IF NOT EXISTS omitir_existentes BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS fotos_omitidas INTEGER,
    ADD COLUMN IF NOT EXISTS codigos_omitidos JSONB,
    ADD COLUMN IF NOT EXISTS codigos_nuevos JSONB;

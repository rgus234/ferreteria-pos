-- Exhibidores: muebles/displays de la tienda (despachador de brocas, exhibidor
-- de lijas, rack de dulces...). Un exhibidor agrupa productos YA existentes en
-- "espacios" para venderlos con tarjetas visuales, recibir mercancia por
-- exhibidor y surtir lo que falta.
--
-- Aditiva y sin tocar productos ni inventario: el exhibidor NO guarda copia de
-- nombre/precio/stock, siempre se lee en vivo contra productos (mismo criterio
-- que listas_producto). Un negocio que no los usa no nota nada.
--
-- capacidad = cuantas piezas caben con el espacio lleno (0 = sin definir); la
-- usa "Surtir" para calcular lo que falta (capacidad - stock actual).
CREATE TABLE IF NOT EXISTS public.exhibidores (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'azul',
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exhibidores_negocio
    ON public.exhibidores (negocio_id, activo);

CREATE TABLE IF NOT EXISTS public.exhibidor_espacios (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    exhibidor_id INTEGER NOT NULL REFERENCES public.exhibidores(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    etiqueta TEXT NOT NULL DEFAULT '',
    capacidad NUMERIC(12,3) NOT NULL DEFAULT 0,
    orden INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un producto aparece una sola vez por exhibidor (puede estar en varios).
CREATE UNIQUE INDEX IF NOT EXISTS idx_exhibidor_espacios_unico
    ON public.exhibidor_espacios (exhibidor_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_exhibidor_espacios_exhibidor
    ON public.exhibidor_espacios (exhibidor_id, orden);

-- Conteos de inventario por estante / seccion con aprobacion: quien cuenta guarda el resultado como "pendiente" y un encargado
-- con permiso lo aprueba (se aplica la diferencia a las existencias) o lo rechaza. Aditiva: tablas nuevas, no toca ninguna fila existente.
CREATE TABLE IF NOT EXISTS public.conteos_inventario (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    ubicacion_id INTEGER REFERENCES public.ubicaciones(id) ON DELETE SET NULL,
    ubicacion_texto TEXT NOT NULL DEFAULT '',
    zona TEXT NOT NULL DEFAULT 'tienda',
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
    faltan NUMERIC(12,3) NOT NULL DEFAULT 0,
    sobran NUMERIC(12,3) NOT NULL DEFAULT 0,
    nota TEXT NOT NULL DEFAULT '',
    creado_por_empleado_id INTEGER,
    creado_por_nombre TEXT NOT NULL DEFAULT '',
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revisado_por_empleado_id INTEGER,
    revisado_por_nombre TEXT NOT NULL DEFAULT '',
    revisado_at TIMESTAMPTZ,
    nota_revision TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_conteos_inventario_negocio ON public.conteos_inventario (negocio_id, estado, creado_at DESC);

CREATE TABLE IF NOT EXISTS public.conteo_lineas (
    id SERIAL PRIMARY KEY,
    conteo_id INTEGER NOT NULL REFERENCES public.conteos_inventario(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES public.productos(id) ON DELETE SET NULL,
    nombre TEXT NOT NULL,
    codigo TEXT NOT NULL DEFAULT '',
    esperado NUMERIC(12,3) NOT NULL DEFAULT 0,
    contado NUMERIC(12,3),
    diferencia NUMERIC(12,3) NOT NULL DEFAULT 0,
    no_escaneado BOOLEAN NOT NULL DEFAULT false,
    aplicada BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_conteo_lineas_conteo ON public.conteo_lineas (conteo_id);

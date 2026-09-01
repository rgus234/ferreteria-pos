-- Catalogo de fabricante (TRUPER, y despues URREA/MAKITA/DEWALT):
-- precios de LISTA publicados por el fabricante. Tablas GLOBALES (sin
-- negocio_id) igual que catalogo_maestro_productos, porque un precio de
-- lista de TRUPER es el mismo para todos los negocios.
--
-- SEPARACION QUE PIDIO EL DUENO -- estas tres capas nunca se pisan:
--   catalogo_fabricante_productos -> lo que TRUPER publica (esta tabla)
--   catalogo_productos            -> lo que Diprofer me cobra (ya existe, por negocio)
--   productos / recepcion CFDI    -> mi costo real de factura y mi precio de venta
-- Un cambio de precio aqui NUNCA escribe hacia abajo: solo genera un
-- renglon en catalogo_fabricante_cambios para que el dueno decida.

CREATE TABLE IF NOT EXISTS public.catalogo_fabricante_productos (
    id SERIAL PRIMARY KEY,
    fabricante TEXT NOT NULL,
    -- codigo del fabricante (TRUPER: numerico, ej. 103013) -- es la
    -- identidad primaria, estable entre ediciones del catalogo.
    codigo TEXT NOT NULL,
    clave TEXT NOT NULL DEFAULT '',
    -- TRUPER no publica EAN en ninguna fuente oficial (verificado en
    -- ficha tecnica, modulo, buscador y sitio comercial). Se puebla solo
    -- por cruce con datos propios; ean_origen deja constancia de cual.
    ean TEXT NOT NULL DEFAULT '',
    ean_origen TEXT NOT NULL DEFAULT ''
        CHECK (ean_origen IN ('', 'inventario', 'catalogo_proveedor', 'cfdi', 'manual')),
    descripcion TEXT NOT NULL DEFAULT '',
    marca TEXT NOT NULL DEFAULT '',

    precio_mayoreo NUMERIC(12,2),
    precio_medio_mayoreo NUMERIC(12,2),
    precio_publico NUMERIC(12,2),
    precio_distribuidor NUMERIC(12,2),

    -- Valor previo de cada precio, para el reporte "$100 -> $105" sin
    -- tener que releer el historial completo.
    precio_mayoreo_anterior NUMERIC(12,2),
    precio_medio_mayoreo_anterior NUMERIC(12,2),
    precio_publico_anterior NUMERIC(12,2),
    precio_distribuidor_anterior NUMERIC(12,2),

    -- Trazabilidad hacia la fuente: de que modulo/pagina salio la fila.
    modulo TEXT NOT NULL DEFAULT '',
    pagina INTEGER,

    estado TEXT NOT NULL DEFAULT 'activo'
        CHECK (estado IN ('activo', 'descontinuado', 'revision_manual')),
    -- visto_en: ultima corrida en que el fabricante seguia listandolo
    -- (sirve para marcar descontinuados). actualizado_en: ultima vez que
    -- algun dato REALMENTE cambio -- es la "Fecha de actualizacion" que
    -- pidio el dueno, no se toca si la corrida no encontro cambios.
    visto_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fabricante, codigo)
);

CREATE INDEX IF NOT EXISTS idx_cat_fab_productos_estado
    ON public.catalogo_fabricante_productos (fabricante, estado);
CREATE INDEX IF NOT EXISTS idx_cat_fab_productos_clave
    ON public.catalogo_fabricante_productos (fabricante, clave);
CREATE INDEX IF NOT EXISTS idx_cat_fab_productos_ean
    ON public.catalogo_fabricante_productos (ean) WHERE ean <> '';

-- Estado de sincronizacion por (modulo, variante). La variante importa:
-- en TRUPER el mismo modulo tiene ETag INDEPENDIENTE en mx-pub y mx-dis
-- (ej. modulo 29901: pub 21-jul, dis 13-ago), asi que llevar el estado
-- solo por modulo perderia cambios de una de las dos listas de precio.
CREATE TABLE IF NOT EXISTS public.catalogo_fabricante_modulos (
    id SERIAL PRIMARY KEY,
    fabricante TEXT NOT NULL,
    modulo TEXT NOT NULL,
    variante TEXT NOT NULL,
    etag TEXT NOT NULL DEFAULT '',
    last_modified TEXT NOT NULL DEFAULT '',
    -- hash del recorte normalizado: si el fabricante regenera el JPG sin
    -- cambiar la tabla, el ETag cambia pero el hash no -- evita reextraer.
    hash_contenido TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'ok', 'revision_manual', 'error')),
    detalle TEXT NOT NULL DEFAULT '',
    filas_extraidas INTEGER NOT NULL DEFAULT 0,
    extraido_en TIMESTAMPTZ,
    UNIQUE (fabricante, modulo, variante)
);

CREATE INDEX IF NOT EXISTS idx_cat_fab_modulos_estado
    ON public.catalogo_fabricante_modulos (fabricante, estado);

-- Una corrida de "Actualizar catalogo". esperando_confirmacion es el
-- freno para regeneraciones masivas: si el fabricante regenera todo el
-- catalogo de golpe (paso real en TRUPER el 13-ago-2026 con mx-dis),
-- cambian miles de ETag aunque los precios sean identicos -- la corrida
-- se detiene y pregunta antes de gastar en reextraer todo.
CREATE TABLE IF NOT EXISTS public.catalogo_fabricante_sincronizaciones (
    id SERIAL PRIMARY KEY,
    fabricante TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'en_curso'
        CHECK (estado IN ('en_curso', 'esperando_confirmacion', 'completada', 'cancelada', 'error')),
    modulos_revisados INTEGER NOT NULL DEFAULT 0,
    modulos_cambiados INTEGER NOT NULL DEFAULT 0,
    productos_nuevos INTEGER NOT NULL DEFAULT 0,
    productos_modificados INTEGER NOT NULL DEFAULT 0,
    productos_descontinuados INTEGER NOT NULL DEFAULT 0,
    productos_sin_coincidencia INTEGER NOT NULL DEFAULT 0,
    productos_incompletos INTEGER NOT NULL DEFAULT 0,
    detalle TEXT NOT NULL DEFAULT '',
    iniciada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminada_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cat_fab_sync_fabricante
    ON public.catalogo_fabricante_sincronizaciones (fabricante, iniciada_en DESC);

-- Reporte de cambios de una corrida. Un renglon por campo cambiado, para
-- poder mostrar exactamente "Mayoreo: $100 -> $105 / Medio mayoreo: sin
-- cambio" sin recalcular nada.
CREATE TABLE IF NOT EXISTS public.catalogo_fabricante_cambios (
    id SERIAL PRIMARY KEY,
    sincronizacion_id INTEGER NOT NULL
        REFERENCES public.catalogo_fabricante_sincronizaciones(id) ON DELETE CASCADE,
    fabricante TEXT NOT NULL,
    codigo TEXT NOT NULL,
    tipo TEXT NOT NULL
        CHECK (tipo IN ('nuevo', 'modificado', 'descontinuado', 'sin_coincidencia', 'incompleto')),
    -- campo/valores solo aplican a tipo='modificado'
    campo TEXT NOT NULL DEFAULT '',
    valor_anterior TEXT NOT NULL DEFAULT '',
    valor_nuevo TEXT NOT NULL DEFAULT '',
    detalle TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_fab_cambios_sync
    ON public.catalogo_fabricante_cambios (sincronizacion_id, tipo);

-- Respaldo/versionado previo a cada corrida: se guarda el estado completo
-- de las filas que la corrida va a tocar ANTES de tocarlas. El dueno pidio
-- explicitamente "nunca sobrescribas el catalogo original directamente".
CREATE TABLE IF NOT EXISTS public.catalogo_fabricante_respaldos (
    id SERIAL PRIMARY KEY,
    sincronizacion_id INTEGER NOT NULL
        REFERENCES public.catalogo_fabricante_sincronizaciones(id) ON DELETE CASCADE,
    fabricante TEXT NOT NULL,
    codigo TEXT NOT NULL,
    fila JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_fab_respaldos_sync
    ON public.catalogo_fabricante_respaldos (sincronizacion_id);

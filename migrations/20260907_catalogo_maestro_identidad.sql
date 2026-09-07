-- Fase 1 de la reconciliacion: convertir el catalogo de un proveedor en
-- IDENTIDAD GLOBAL de producto, para que cualquier negocio reconozca un
-- producto al escanearlo sin haber cargado ningun catalogo.
--
-- Lo que esta migracion agrega es la estructura; los datos los escribe
-- scripts/reconciliar-catalogo-maestro.js, que corre primero en seco.
--
-- REGLAS (las fijo el dueno):
--   - El Maestro es global y guarda SOLO identidad del producto.
--   - NO se copian precios de Diprofer (son su relacion comercial), ni
--     costo, stock, proveedor o precio de venta de ningun negocio.
--   - Diprofer se usa unicamente como fuente de RECONCILIACION, para
--     establecer EAN <-> codigo de fabricante <-> producto.
--   - Los precios de referencia (mayoreo / medio mayoreo / publico) vienen
--     del catalogo oficial del fabricante. NO se copian aqui: viven en
--     catalogo_fabricante_productos con su historial y su confianza, y se
--     alcanzan por el identificador de tipo 'fabricante'. Copiarlos
--     crearia una segunda verdad que habria que mantener sincronizada.
--   - Un EAN valido corresponde a un unico producto maestro.
--   - Ante conflicto no se fusiona: se marca para revision.

-- ---------------------------------------------------------------------
-- Corridas de reconciliacion. Existen para que la carga sea REVERSIBLE:
-- cada producto maestro creado recuerda que corrida lo creo, asi que
-- deshacer una carga es borrar lo que esa corrida escribio.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalogo_maestro_reconciliaciones (
    id SERIAL PRIMARY KEY,
    fuente TEXT NOT NULL,
    modo TEXT NOT NULL DEFAULT 'simulacion'
        CHECK (modo IN ('simulacion', 'aplicada', 'revertida')),
    productos_creados INTEGER NOT NULL DEFAULT 0,
    identificadores_creados INTEGER NOT NULL DEFAULT 0,
    coincidencias_seguras INTEGER NOT NULL DEFAULT 0,
    conflictos INTEGER NOT NULL DEFAULT 0,
    sin_ean INTEGER NOT NULL DEFAULT 0,
    duplicados_evitados INTEGER NOT NULL DEFAULT 0,
    detalle TEXT NOT NULL DEFAULT '',
    iniciada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminada_en TIMESTAMPTZ,
    revertida_en TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- Identificadores de un producto maestro.
--
-- Un mismo producto se conoce por varios codigos: el EAN que trae impreso,
-- el codigo del fabricante (TRUPER 103013) y el codigo con que lo maneja
-- cada proveedor. Todos apuntan al MISMO producto maestro; por eso van en
-- una tabla aparte y no como columnas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalogo_maestro_identificadores (
    id SERIAL PRIMARY KEY,
    producto_maestro_id INTEGER NOT NULL
        REFERENCES public.catalogo_maestro_productos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('ean', 'fabricante', 'proveedor', 'clave')),
    valor TEXT NOT NULL,
    -- De donde salio este identificador y cuando: sin esto no se puede
    -- auditar despues por que un producto quedo unido a otro.
    fuente TEXT NOT NULL DEFAULT '',
    fuente_fecha TIMESTAMPTZ,
    reconciliacion_id INTEGER REFERENCES public.catalogo_maestro_reconciliaciones(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un EAN valido pertenece a UN solo producto maestro. Esta restriccion es
-- la que impide crear duplicados aunque dos catalogos traigan el mismo
-- producto: el segundo choca y se cuenta como duplicado evitado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_maestro_ident_unico
    ON public.catalogo_maestro_identificadores (tipo, valor);
CREATE INDEX IF NOT EXISTS idx_cat_maestro_ident_producto
    ON public.catalogo_maestro_identificadores (producto_maestro_id);

-- ---------------------------------------------------------------------
-- Identidad y trazabilidad en el producto maestro
-- ---------------------------------------------------------------------
ALTER TABLE public.catalogo_maestro_productos
    -- Clave/SKU del fabricante (PMU-8PX). Diprofer no la trae: solo la
    -- publica el catalogo oficial de TRUPER.
    ADD COLUMN IF NOT EXISTS clave TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT '',
    -- Que corrida creo esta fila. NULL = la aporto un negocio por el
    -- flujo viejo. Es lo que hace reversible la carga.
    ADD COLUMN IF NOT EXISTS reconciliacion_id INTEGER
        REFERENCES public.catalogo_maestro_reconciliaciones(id),
    -- Trazabilidad de la identidad: de que catalogo salio y de cuando es.
    ADD COLUMN IF NOT EXISTS fuente_identidad TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS fuente_fecha TIMESTAMPTZ,
    -- Marcado para revision humana: el dueno pidio que ante cualquier
    -- conflicto NO se fusione automaticamente.
    ADD COLUMN IF NOT EXISTS necesita_revision BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS revision_motivo TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cat_maestro_reconciliacion
    ON public.catalogo_maestro_productos (reconciliacion_id);
CREATE INDEX IF NOT EXISTS idx_cat_maestro_revision
    ON public.catalogo_maestro_productos (necesita_revision) WHERE necesita_revision;

-- ---------------------------------------------------------------------
-- Conflictos: lo que NO se fusiono, y por que.
--
-- Se guardan aunque no se aplique la carga, para poder revisarlos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalogo_maestro_conflictos (
    id SERIAL PRIMARY KEY,
    reconciliacion_id INTEGER
        REFERENCES public.catalogo_maestro_reconciliaciones(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL
        CHECK (tipo IN ('ean_repetido', 'codigo_distinto', 'marca_distinta', 'descripcion_distinta', 'ean_invalido', 'sin_ean')),
    ean TEXT NOT NULL DEFAULT '',
    codigo_fabricante TEXT NOT NULL DEFAULT '',
    fuente TEXT NOT NULL DEFAULT '',
    detalle TEXT NOT NULL DEFAULT '',
    producto_maestro_id INTEGER REFERENCES public.catalogo_maestro_productos(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_maestro_conflictos
    ON public.catalogo_maestro_conflictos (reconciliacion_id, tipo);

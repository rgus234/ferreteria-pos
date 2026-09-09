-- Recepcion Inteligente, Fase 1 (sin Gmail todavia): una factura de
-- proveedor -- hoy subida a mano, mas adelante detectada por correo --
-- se guarda como "pendiente de revision" ANTES de tocar inventario.
--
-- Corrige el hallazgo mas importante de la auditoria previa: el flujo
-- actual de Recepcion de mercancia (ferretero-flow.js) aplica el stock
-- de inmediato al confirmar, sin ningun punto de revision real. Esta
-- tabla nunca se toca desde ahi -- vive aparte, y solo al confirmarla
-- se actualiza productos.stock (via recepcion-inteligente-server.js).
--
-- Aditiva pura, reversible: una columna nueva en proveedores, dos
-- tablas nuevas. Nada destructivo, ninguna fila existente se toca.

-- Identidad fiscal del proveedor. No existia en ningun lugar del
-- catalogo (solo existe para el propio negocio como emisor, y para
-- clientes de credito como receptor). Sin esto no se puede resolver el
-- emisor de un CFDI contra un proveedor real por su RFC -- el nombre
-- de texto libre se puede escribir de mil formas distintas, el RFC no.
ALTER TABLE public.proveedores
    ADD COLUMN IF NOT EXISTS rfc TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_proveedores_rfc
    ON public.proveedores (negocio_id, rfc) WHERE rfc <> '';

-- Una factura de proveedor detectada -- origen 'manual' por ahora
-- (subida a mano, Fase 1), 'gmail' cuando exista la Fase 2.
--
-- El UUID del CFDI es la regla de deduplicacion que pidio el dueno: un
-- correo reenviado, duplicado, o la misma factura subida dos veces
-- nunca debe generar una segunda recepcion. Mismo mecanismo que ya
-- protege /ventas con idempotency_key: indice unico PARCIAL por
-- negocio (permite mas de un NULL -- documentos sin timbre, ej. un
-- CSV suelto -- sin bloquearse entre si), y el codigo que inserta
-- filas de esta tabla debe replicar el patron ya probado ahi: verificar
-- antes de insertar, insertar con SAVEPOINT, y capturar el error
-- 23505 en la carrera real (dos peticiones casi simultaneas para el
-- mismo correo).
--
-- pedido_id y recepcion_mercancia_id NO llevan REFERENCES a proposito:
-- esas dos tablas las crea fase4-server.js de forma perezosa (en el
-- primer request a sus endpoints), no una migracion -- una base de
-- datos nueva donde nunca se hizo ese request aun no las tiene, y esta
-- migracion no debe depender de eso para poder aplicarse.
CREATE TABLE IF NOT EXISTS public.recepciones_inteligentes (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'gmail')),
    uuid_cfdi TEXT,
    proveedor_id INTEGER REFERENCES public.proveedores(id),
    rfc_emisor TEXT NOT NULL DEFAULT '',
    nombre_emisor TEXT NOT NULL DEFAULT '',
    rfc_receptor TEXT NOT NULL DEFAULT '',
    folio TEXT NOT NULL DEFAULT '',
    serie TEXT NOT NULL DEFAULT '',
    fecha_documento DATE,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'confirmada', 'rechazada')),
    xml_bytes BYTEA,
    pdf_bytes BYTEA,
    pedido_id INTEGER,
    recepcion_mercancia_id INTEGER,
    revisado_por_empleado_id INTEGER,
    confirmada_en TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recepciones_inteligentes_uuid
    ON public.recepciones_inteligentes (negocio_id, uuid_cfdi) WHERE uuid_cfdi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recepciones_inteligentes_negocio_estado
    ON public.recepciones_inteligentes (negocio_id, estado, created_at DESC);

-- Cada concepto de la factura, con el candidato que encontro el motor
-- de matching (si encontro alguno) y su nivel de confianza -- nunca
-- "coincidencia exacta": mismos dos niveles honestos que ya establecio
-- Explorar Nexo (fuerte/probable). Bajo el umbral probable no se
-- guarda candidato: el costo de un falso positivo aqui es dinero e
-- inventario real, asi que se deja en null para busqueda manual desde
-- cero en vez de sugerir un parecido debil.
--
-- Nada de esto toca productos.stock. Eso solo ocurre al confirmar la
-- recepcion completa (recepcion-inteligente-server.js), y unicamente
-- para los items cuya accion ya fue decidida por una persona.
CREATE TABLE IF NOT EXISTS public.recepciones_inteligentes_items (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL,
    recepcion_id INTEGER NOT NULL REFERENCES public.recepciones_inteligentes(id) ON DELETE CASCADE,
    codigo_factura TEXT NOT NULL DEFAULT '',
    clave_prod_serv TEXT NOT NULL DEFAULT '',
    descripcion TEXT NOT NULL DEFAULT '',
    cantidad NUMERIC(12,3) NOT NULL DEFAULT 0,
    unidad TEXT NOT NULL DEFAULT 'pieza',
    costo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
    importe NUMERIC(12,2) NOT NULL DEFAULT 0,
    descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Candidato sugerido por el motor de matching. JSONB porque la
    -- forma cambia segun de donde salio (inventario propio ya trae
    -- productoId; Catalogo Maestro trae catalogoMaestroId y precios de
    -- lista; nunca se normaliza a columnas separadas para no inventar
    -- una tabla de union que nadie mas necesita).
    candidato JSONB,
    nivel TEXT CHECK (nivel IS NULL OR nivel IN ('fuerte', 'probable')),
    -- producto_id solo se llena cuando la fila queda RESUELTA contra un
    -- producto real de este negocio -- por decision humana al revisar,
    -- nunca automatico solo porque el motor encontro un candidato.
    producto_id INTEGER REFERENCES public.productos(id),
    accion TEXT NOT NULL DEFAULT '' CHECK (accion IN ('', 'relacionar', 'crear', 'omitir')),
    nombre_nuevo_producto TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_recepciones_inteligentes_items_recepcion
    ON public.recepciones_inteligentes_items (recepcion_id);

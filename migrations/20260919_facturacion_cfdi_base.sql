-- Facturacion electronica (CFDI real via PAC): esquema base.
-- Nexo nunca guarda el CSD crudo (.cer/.key/contrasena) -- se sube una
-- sola vez a Facturama (API Multiemisor) y ellos lo resguardan. Aqui
-- solo se persiste metadata publica del certificado (numero de serie,
-- vigencia) para poder avisar al dueno cuando este por vencer.

-- Identidad fiscal del negocio (emisor). Hoy "negocios" no tiene
-- ningun campo fiscal -- "nombre" es el nombre comercial que ya se usa
-- en Market/tickets, razon_social puede ser distinta y debe coincidir
-- exacto con el padron del SAT.
ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS rfc TEXT,
    ADD COLUMN IF NOT EXISTS razon_social TEXT,
    ADD COLUMN IF NOT EXISTS regimen_fiscal TEXT,
    ADD COLUMN IF NOT EXISTS codigo_postal_fiscal TEXT;

-- Estado de la integracion con el PAC. facturacion_pac deja la puerta
-- abierta a otro proveedor sin construir una capa de abstraccion
-- multi-PAC todavia (no hay un segundo PAC real que la justifique).
ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS facturacion_activa BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS facturacion_pac TEXT NOT NULL DEFAULT 'facturama',
    ADD COLUMN IF NOT EXISTS facturacion_csd_id TEXT,
    ADD COLUMN IF NOT EXISTS facturacion_certificado_numero TEXT,
    ADD COLUMN IF NOT EXISTS facturacion_certificado_vigencia_hasta DATE,
    ADD COLUMN IF NOT EXISTS facturacion_csd_subido_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS facturacion_csd_subido_por TEXT,
    ADD COLUMN IF NOT EXISTS facturacion_clave_prod_serv_default TEXT,
    ADD COLUMN IF NOT EXISTS facturacion_clave_unidad_default TEXT NOT NULL DEFAULT 'H87';

-- Identidad fiscal del receptor (cliente). Todas opcionales a
-- proposito -- la mayoria de clientes de una ferreteria son "publico
-- en general" y nunca las van a llenar.
ALTER TABLE public.clientes_credito
    ADD COLUMN IF NOT EXISTS rfc TEXT,
    ADD COLUMN IF NOT EXISTS razon_social TEXT,
    ADD COLUMN IF NOT EXISTS regimen_fiscal TEXT,
    ADD COLUMN IF NOT EXISTS codigo_postal_fiscal TEXT,
    ADD COLUMN IF NOT EXISTS uso_cfdi_preferido TEXT,
    ADD COLUMN IF NOT EXISTS correo_facturacion TEXT;

-- Marca intencion al cobrar ("requiere factura") sin timbrar en el
-- momento -- timbrar es siempre una llamada sincrona al PAC, y el
-- cobro debe seguir funcionando offline sin cambios.
ALTER TABLE public.historial_ventas
    ADD COLUMN IF NOT EXISTS requiere_factura BOOLEAN NOT NULL DEFAULT false;

-- Una fila por CFDI emitido. Siempre ligada a una venta real
-- (historial_venta_id NOT NULL) -- nunca se factura "en el aire".
-- Sin tabla de conceptos aparte: historial_ventas.productos (JSONB)
-- ya trae codigo/nombre/precio/importe/cantidad/unidadVenta por linea,
-- suficiente para reconstruir el CFDI al timbrar o al reimprimir.
CREATE TABLE IF NOT EXISTS public.facturas_cfdi (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
    historial_venta_id INTEGER NOT NULL REFERENCES public.historial_ventas(id),
    cliente_id INTEGER REFERENCES public.clientes_credito(id),

    -- Snapshot del receptor AL MOMENTO de timbrar -- si el cliente
    -- edita su RFC despues en su ficha, las facturas ya emitidas no
    -- deben cambiar de texto retroactivamente.
    receptor_rfc TEXT NOT NULL,
    receptor_nombre TEXT NOT NULL,
    receptor_uso_cfdi TEXT NOT NULL,
    receptor_regimen_fiscal TEXT NOT NULL,
    receptor_codigo_postal TEXT NOT NULL,
    receptor_correo TEXT,

    serie TEXT,
    folio TEXT,
    uuid TEXT UNIQUE,
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'timbrada', 'error', 'cancelada')),
    error_mensaje TEXT,

    subtotal NUMERIC(12,2) NOT NULL,
    total NUMERIC(12,2) NOT NULL,
    xml_cfdi TEXT,

    facturama_id TEXT,
    creado_por TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    timbrada_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_facturas_cfdi_negocio_fecha ON public.facturas_cfdi (negocio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_cfdi_historial_venta ON public.facturas_cfdi (historial_venta_id);

-- Catalogo de funciones: complemento de pago, no incluido por defecto
-- en ningun plan (el PAC cobra por timbre -- costo variable real que
-- un plan de precio fijo no deberia absorber, mismo criterio ya usado
-- para api.integraciones/api.panel_desarrollador).
INSERT INTO public.categorias_funcion (clave, nombre, orden) VALUES
    ('facturacion', 'Facturación electrónica', 23)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.catalogo_funciones (clave, nombre, categoria_id, descripcion, estado)
SELECT 'facturacion.cfdi', 'Facturación electrónica (CFDI 4.0)', c.id,
       'Timbrado de CFDI via PAC (Facturama) para ventas ya cobradas -- el negocio sube su propio CSD',
       'activo'
FROM public.categorias_funcion c WHERE c.clave = 'facturacion'
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.plan_funciones (plan_id, funcion_id, incluido, limite_numerico)
SELECT p.id, f.id, false, NULL::integer
FROM public.planes p
CROSS JOIN public.catalogo_funciones f
WHERE f.clave = 'facturacion.cfdi'
ON CONFLICT (plan_id, funcion_id) DO NOTHING;

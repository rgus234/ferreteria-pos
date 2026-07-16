-- Catalogo de funciones (features) y planes comerciales.
--
-- Esto es PURAMENTE ADITIVO E INERTE: no se agrega ninguna columna a
-- negocios/licencias, no hay ningun middleware ni ruta que lea estas
-- tablas todavia. Es el catalogo de referencia para cuando en el
-- futuro se decida implementar el enforcement real de planes -- por
-- ahora todo el sistema sigue funcionando exactamente igual para
-- todos los negocios, sin importar que diga esta tabla.
--
-- Ver docs/arquitectura-planes-y-modulos.md para el documento
-- completo (arquitectura, catalogo, funciones futuras y
-- recomendaciones).

CREATE TABLE IF NOT EXISTS public.planes (
    id SERIAL PRIMARY KEY,
    clave TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    orden INTEGER NOT NULL,
    descripcion TEXT,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.categorias_funcion (
    id SERIAL PRIMARY KEY,
    clave TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.catalogo_funciones (
    id SERIAL PRIMARY KEY,
    clave TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    categoria_id INTEGER NOT NULL REFERENCES public.categorias_funcion(id),
    descripcion TEXT,
    estado TEXT NOT NULL DEFAULT 'activo',
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT catalogo_funciones_estado_valido CHECK (estado IN ('activo', 'en_desarrollo', 'planeado'))
);
CREATE INDEX IF NOT EXISTS idx_catalogo_funciones_categoria ON public.catalogo_funciones(categoria_id);

CREATE TABLE IF NOT EXISTS public.plan_funciones (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES public.planes(id) ON DELETE CASCADE,
    funcion_id INTEGER NOT NULL REFERENCES public.catalogo_funciones(id) ON DELETE CASCADE,
    incluido BOOLEAN NOT NULL DEFAULT true,
    limite_numerico INTEGER,
    UNIQUE(plan_id, funcion_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_funciones_plan ON public.plan_funciones(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_funciones_funcion ON public.plan_funciones(funcion_id);

-- ---------------------------------------------------------------
-- Siembra: planes
-- ---------------------------------------------------------------

INSERT INTO public.planes (clave, nombre, orden, descripcion) VALUES
    ('basico', 'Básico', 1, 'Arranca y vende -- un negocio de una caja, completamente funcional sin recortes'),
    ('plus', 'Plus', 2, 'Deja de capturar a mano -- para negocios de 2 a 5 puntos de cobro'),
    ('pro', 'Pro', 3, 'Automatización e inteligencia -- el techo actual de la plataforma')
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------
-- Siembra: categorias de funcion
-- ---------------------------------------------------------------

INSERT INTO public.categorias_funcion (clave, nombre, orden) VALUES
    ('ventas', 'Ventas / Punto de venta', 1),
    ('inventario', 'Inventario', 2),
    ('catalogo_proveedor', 'Catálogo de proveedor', 3),
    ('recepcion', 'Recepción de mercancía', 4),
    ('creditos', 'Créditos / Clientes', 5),
    ('caja', 'Caja', 6),
    ('finanzas', 'Finanzas', 7),
    ('pedidos', 'Pedidos a proveedor', 8),
    ('proveedores', 'Proveedores', 9),
    ('reportes', 'Reportes', 10),
    ('dashboard_ejecutivo', 'Dashboard ejecutivo', 11),
    ('multiusuario', 'Multiusuario / PIN', 12),
    ('seguridad', 'Seguridad de cuenta', 13),
    ('dispositivos', 'Gestión de dispositivos', 14),
    ('centro_seguridad', 'Centro de Seguridad', 15),
    ('admin_licencias', 'Licencias / Administración (interno)', 16),
    ('sync_actualizaciones', 'Sincronización y actualizaciones', 17),
    ('ayuda', 'Manuales y ayuda', 18),
    ('ia', 'IA Nexo', 19),
    ('banco_imagenes', 'Banco Global de Imágenes', 20),
    ('api', 'API / Integraciones', 21),
    ('respaldos', 'Respaldos y continuidad', 22)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------
-- Siembra: catalogo de funciones
-- ---------------------------------------------------------------

INSERT INTO public.catalogo_funciones (clave, nombre, categoria_id, descripcion, estado)
SELECT v.clave, v.nombre, c.id, v.descripcion, v.estado
FROM (VALUES
    ('ventas.pos_completo', 'Punto de venta completo', 'ventas', 'Carrito, escaneo de código de barras, todos los métodos de pago, tickets', 'activo'),
    ('ventas.venta_pieza', 'Venta por bolsa o pieza suelta', 'ventas', 'Apertura automática de bolsa al vender piezas sueltas', 'activo'),
    ('ventas.notas_autorizacion', 'Notas de venta con autorización', 'ventas', 'Ajustes de venta que requieren PIN de administrador', 'activo'),
    ('ventas.reimpresion_tickets', 'Reimpresión de tickets', 'ventas', 'Reimprimir el ticket de una venta ya cerrada', 'activo'),

    ('inventario.catalogo_productos', 'Catálogo de productos', 'inventario', 'Categorías, código alterno, stock mínimo', 'activo'),
    ('inventario.alertas_stock_bajo', 'Alertas de inventario bajo', 'inventario', 'Sugerencia de pedido cuando el stock cae', 'activo'),
    ('inventario.ajustes_inventario', 'Ajustes de inventario', 'inventario', 'Wizard con usuario y fecha real de cada ajuste', 'activo'),
    ('inventario.codigos_barras', 'Impresión de códigos de barras propios', 'inventario', 'Para productos sin código de fábrica', 'activo'),
    ('inventario.fotos_producto', 'Foto de producto (individual)', 'inventario', 'Una foto por producto, subida manual', 'activo'),

    ('catalogo.importacion_listas', 'Importación de listas de proveedor', 'catalogo_proveedor', 'Parsers dedicados: Truper, Diprofer, Gafi, Volteck', 'activo'),
    ('catalogo.reglas_precio', 'Reglas de precio automáticas', 'catalogo_proveedor', 'Margen y redondeo configurable por proveedor/categoría/producto', 'activo'),
    ('catalogo.fotos_lote', 'Fotos de producto por lote', 'catalogo_proveedor', 'Importación de fotos vía ZIP + galería', 'activo'),
    ('catalogo.sync_automatica', 'Sincronización automática de catálogos', 'catalogo_proveedor', 'Actualizar listas de proveedor sin subir el archivo a mano', 'planeado'),

    ('recepcion.xml_csv', 'Recepción por XML CFDI / CSV', 'recepcion', 'Revisión antes de actualizar stock', 'activo'),

    ('creditos.clientes', 'Clientes con crédito', 'creditos', 'Saldo, abonos, cargos, vencimiento real', 'activo'),
    ('creditos.estado_cuenta', 'Estado de cuenta en ticket', 'creditos', 'Formato de 58mm', 'activo'),

    ('caja.turnos', 'Turnos y cortes de caja', 'caja', 'Bitácora de movimientos', 'activo'),
    ('caja.metodo_pago', 'Caja por método de pago', 'caja', 'Desglose de caja por forma de cobro', 'activo'),

    ('finanzas.utilidad_neta', 'Utilidad neta real', 'finanzas', 'No solo ventas brutas', 'activo'),
    ('finanzas.cuentas_por_cobrar', 'Cuentas por cobrar consolidadas', 'finanzas', 'Alimentado desde Créditos', 'activo'),

    ('pedidos.estadisticas', 'Pedidos a proveedor', 'pedidos', 'Estadísticas y bitácora con estado del pedido', 'activo'),

    ('proveedores.gestion', 'Gestión de proveedores', 'proveedores', 'Alta, edición, estado activo/baja', 'activo'),

    ('reportes.basicos', 'Reportes esenciales', 'reportes', 'Ventas del día, historial, ticket promedio', 'activo'),
    ('reportes.comparativas', 'Reportes con comparativas', 'reportes', 'Gráficas y comparativas entre periodos', 'activo'),

    ('dashboard_ejecutivo.panel', 'Dashboard ejecutivo', 'dashboard_ejecutivo', 'Panel consolidado para dueños y gerencia', 'en_desarrollo'),

    ('multiusuario.empleados_pin', 'Empleados con PIN sincronizado', 'multiusuario', 'PIN de 4-6 dígitos, sincronizado entre computadoras del negocio', 'activo'),
    ('multiusuario.permisos_roles', 'Permisos por rol', 'multiusuario', 'Administrador / Cajero / Inventario', 'activo'),
    ('multiusuario.permisos_granulares', 'Permisos granulares por empleado', 'multiusuario', 'Ajuste fino por módulo y por persona', 'activo'),
    ('multiusuario.pin_offline', 'Login por PIN sin internet', 'multiusuario', 'Verificación PBKDF2 local, funciona sin conexión', 'activo'),

    ('seguridad.cuenta', 'Seguridad de la cuenta', 'seguridad', 'Correo, verificación obligatoria, recuperación por código, límite de intentos', 'activo'),
    ('seguridad.sesiones', 'Sesiones revocables', 'seguridad', 'Cerrar sesión en todos los dispositivos', 'activo'),

    ('dispositivos.vincular', 'Vinculación de equipo', 'dispositivos', 'Correo+contraseña una sola vez por computadora', 'activo'),
    ('dispositivos.revocacion_remota', 'Revocación remota de dispositivos', 'dispositivos', 'Desvincular equipos perdidos o robados desde Cuenta', 'activo'),

    ('centro_seguridad.panel_unificado', 'Centro de Seguridad', 'centro_seguridad', 'Panel unificado de accesos, dispositivos y alertas de anomalías', 'en_desarrollo'),

    ('admin.licencias', 'Gestión de licencias', 'admin_licencias', 'Panel interno Nexo Admin -- infraestructura, no una función de plan', 'activo'),
    ('admin.deteccion_anomalias', 'Detección de anomalías', 'admin_licencias', 'Cuentas fantasma, auditoría de auto-provisión -- infraestructura interna', 'activo'),

    ('sync.escritorio', 'Sincronización de escritorio', 'sync_actualizaciones', 'App de escritorio con caché offline y cola de eventos', 'activo'),
    ('sync.actualizaciones_automaticas', 'Actualizaciones automáticas', 'sync_actualizaciones', 'Mantiene el software al día y seguro', 'activo'),

    ('ayuda.manuales', 'Manuales y tutoriales integrados', 'ayuda', 'Ayuda dentro de la app -- reduce soporte y abandono', 'planeado'),

    ('ia.sugerencia_precio', 'Sugerencia inteligente de precio', 'ia', 'IA Nexo -- precios sugeridos por comportamiento del catálogo', 'planeado'),
    ('ia.deteccion_duplicados', 'Detección de productos duplicados', 'ia', 'IA Nexo -- limpieza automática del catálogo', 'planeado'),
    ('ia.pronostico_demanda', 'Pronóstico de demanda', 'ia', 'IA Nexo -- anticipar quiebres de stock', 'planeado'),

    ('banco_imagenes.compartido', 'Banco Global de Imágenes', 'banco_imagenes', 'Fotos de producto compartidas entre todos los negocios Nexo POS', 'planeado'),

    ('api.integraciones', 'API de integraciones', 'api', 'Conectar con contabilidad, e-commerce o terceros', 'planeado'),
    ('api.panel_desarrollador', 'Panel de desarrollador', 'api', 'Llaves de API, documentación, webhooks', 'planeado'),

    ('respaldos.automaticos', 'Respaldos automáticos', 'respaldos', 'Copia y restauración de datos accesible para el cliente', 'planeado')
) AS v(clave, nombre, categoria_clave, descripcion, estado)
JOIN public.categorias_funcion c ON c.clave = v.categoria_clave
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------
-- Siembra: matriz plan x funcion (incluido + limite numerico)
--
-- limite_numerico solo aplica a funciones de conteo (empleados,
-- equipos vinculados); NULL significa "sin limite" o "no aplica".
-- ---------------------------------------------------------------

INSERT INTO public.plan_funciones (plan_id, funcion_id, incluido, limite_numerico)
SELECT p.id, f.id, v.incluido, v.limite
FROM (VALUES
    -- Ventas -- incluido en los 3 planes sin excepcion
    ('basico', 'ventas.pos_completo', true, NULL::integer), ('plus', 'ventas.pos_completo', true, NULL::integer), ('pro', 'ventas.pos_completo', true, NULL::integer),
    ('basico', 'ventas.venta_pieza', true, NULL::integer), ('plus', 'ventas.venta_pieza', true, NULL::integer), ('pro', 'ventas.venta_pieza', true, NULL::integer),
    ('basico', 'ventas.notas_autorizacion', true, NULL::integer), ('plus', 'ventas.notas_autorizacion', true, NULL::integer), ('pro', 'ventas.notas_autorizacion', true, NULL::integer),
    ('basico', 'ventas.reimpresion_tickets', true, NULL::integer), ('plus', 'ventas.reimpresion_tickets', true, NULL::integer), ('pro', 'ventas.reimpresion_tickets', true, NULL::integer),

    -- Inventario -- incluido en los 3 planes sin excepcion
    ('basico', 'inventario.catalogo_productos', true, NULL::integer), ('plus', 'inventario.catalogo_productos', true, NULL::integer), ('pro', 'inventario.catalogo_productos', true, NULL::integer),
    ('basico', 'inventario.alertas_stock_bajo', true, NULL::integer), ('plus', 'inventario.alertas_stock_bajo', true, NULL::integer), ('pro', 'inventario.alertas_stock_bajo', true, NULL::integer),
    ('basico', 'inventario.ajustes_inventario', true, NULL::integer), ('plus', 'inventario.ajustes_inventario', true, NULL::integer), ('pro', 'inventario.ajustes_inventario', true, NULL::integer),
    ('basico', 'inventario.codigos_barras', true, NULL::integer), ('plus', 'inventario.codigos_barras', true, NULL::integer), ('pro', 'inventario.codigos_barras', true, NULL::integer),
    ('basico', 'inventario.fotos_producto', true, NULL::integer), ('plus', 'inventario.fotos_producto', true, NULL::integer), ('pro', 'inventario.fotos_producto', true, NULL::integer),

    -- Catalogo de proveedor -- automatizacion empieza en Plus
    ('basico', 'catalogo.importacion_listas', false, NULL::integer), ('plus', 'catalogo.importacion_listas', true, NULL::integer), ('pro', 'catalogo.importacion_listas', true, NULL::integer),
    ('basico', 'catalogo.reglas_precio', false, NULL::integer), ('plus', 'catalogo.reglas_precio', true, NULL::integer), ('pro', 'catalogo.reglas_precio', true, NULL::integer),
    ('basico', 'catalogo.fotos_lote', false, NULL::integer), ('plus', 'catalogo.fotos_lote', true, NULL::integer), ('pro', 'catalogo.fotos_lote', true, NULL::integer),
    ('basico', 'catalogo.sync_automatica', false, NULL::integer), ('plus', 'catalogo.sync_automatica', false, NULL::integer), ('pro', 'catalogo.sync_automatica', true, NULL::integer),

    -- Recepcion -- Plus en adelante
    ('basico', 'recepcion.xml_csv', false, NULL::integer), ('plus', 'recepcion.xml_csv', true, NULL::integer), ('pro', 'recepcion.xml_csv', true, NULL::integer),

    -- Creditos -- esencial, en los 3
    ('basico', 'creditos.clientes', true, NULL::integer), ('plus', 'creditos.clientes', true, NULL::integer), ('pro', 'creditos.clientes', true, NULL::integer),
    ('basico', 'creditos.estado_cuenta', true, NULL::integer), ('plus', 'creditos.estado_cuenta', true, NULL::integer), ('pro', 'creditos.estado_cuenta', true, NULL::integer),

    -- Caja -- esencial, en los 3
    ('basico', 'caja.turnos', true, NULL::integer), ('plus', 'caja.turnos', true, NULL::integer), ('pro', 'caja.turnos', true, NULL::integer),
    ('basico', 'caja.metodo_pago', true, NULL::integer), ('plus', 'caja.metodo_pago', true, NULL::integer), ('pro', 'caja.metodo_pago', true, NULL::integer),

    -- Finanzas -- exclusivo Pro
    ('basico', 'finanzas.utilidad_neta', false, NULL::integer), ('plus', 'finanzas.utilidad_neta', false, NULL::integer), ('pro', 'finanzas.utilidad_neta', true, NULL::integer),
    ('basico', 'finanzas.cuentas_por_cobrar', false, NULL::integer), ('plus', 'finanzas.cuentas_por_cobrar', false, NULL::integer), ('pro', 'finanzas.cuentas_por_cobrar', true, NULL::integer),

    -- Pedidos -- Plus en adelante
    ('basico', 'pedidos.estadisticas', false, NULL::integer), ('plus', 'pedidos.estadisticas', true, NULL::integer), ('pro', 'pedidos.estadisticas', true, NULL::integer),

    -- Proveedores -- esencial, en los 3
    ('basico', 'proveedores.gestion', true, NULL::integer), ('plus', 'proveedores.gestion', true, NULL::integer), ('pro', 'proveedores.gestion', true, NULL::integer),

    -- Reportes
    ('basico', 'reportes.basicos', true, NULL::integer), ('plus', 'reportes.basicos', true, NULL::integer), ('pro', 'reportes.basicos', true, NULL::integer),
    ('basico', 'reportes.comparativas', false, NULL::integer), ('plus', 'reportes.comparativas', true, NULL::integer), ('pro', 'reportes.comparativas', true, NULL::integer),

    -- Dashboard ejecutivo -- exclusivo Pro
    ('basico', 'dashboard_ejecutivo.panel', false, NULL::integer), ('plus', 'dashboard_ejecutivo.panel', false, NULL::integer), ('pro', 'dashboard_ejecutivo.panel', true, NULL::integer),

    -- Multiusuario -- escalonado por limite numerico
    ('basico', 'multiusuario.empleados_pin', true, 2), ('plus', 'multiusuario.empleados_pin', true, 8), ('pro', 'multiusuario.empleados_pin', true, NULL::integer),
    ('basico', 'multiusuario.permisos_roles', true, NULL::integer), ('plus', 'multiusuario.permisos_roles', true, NULL::integer), ('pro', 'multiusuario.permisos_roles', true, NULL::integer),
    ('basico', 'multiusuario.permisos_granulares', false, NULL::integer), ('plus', 'multiusuario.permisos_granulares', true, NULL::integer), ('pro', 'multiusuario.permisos_granulares', true, NULL::integer),
    ('basico', 'multiusuario.pin_offline', true, NULL::integer), ('plus', 'multiusuario.pin_offline', true, NULL::integer), ('pro', 'multiusuario.pin_offline', true, NULL::integer),

    -- Seguridad -- nunca se paywallea, en los 3
    ('basico', 'seguridad.cuenta', true, NULL::integer), ('plus', 'seguridad.cuenta', true, NULL::integer), ('pro', 'seguridad.cuenta', true, NULL::integer),
    ('basico', 'seguridad.sesiones', true, NULL::integer), ('plus', 'seguridad.sesiones', true, NULL::integer), ('pro', 'seguridad.sesiones', true, NULL::integer),

    -- Dispositivos -- escalonado por limite numerico
    ('basico', 'dispositivos.vincular', true, 1), ('plus', 'dispositivos.vincular', true, NULL::integer), ('pro', 'dispositivos.vincular', true, NULL::integer),
    ('basico', 'dispositivos.revocacion_remota', false, NULL::integer), ('plus', 'dispositivos.revocacion_remota', true, NULL::integer), ('pro', 'dispositivos.revocacion_remota', true, NULL::integer),

    -- Centro de Seguridad -- exclusivo Pro
    ('basico', 'centro_seguridad.panel_unificado', false, NULL::integer), ('plus', 'centro_seguridad.panel_unificado', false, NULL::integer), ('pro', 'centro_seguridad.panel_unificado', true, NULL::integer),

    -- Admin/licencias -- infraestructura interna, no se le oculta a ningun plan
    ('basico', 'admin.licencias', true, NULL::integer), ('plus', 'admin.licencias', true, NULL::integer), ('pro', 'admin.licencias', true, NULL::integer),
    ('basico', 'admin.deteccion_anomalias', true, NULL::integer), ('plus', 'admin.deteccion_anomalias', true, NULL::integer), ('pro', 'admin.deteccion_anomalias', true, NULL::integer),

    -- Sync y actualizaciones -- nunca se paywallea, es mantenimiento
    ('basico', 'sync.escritorio', true, NULL::integer), ('plus', 'sync.escritorio', true, NULL::integer), ('pro', 'sync.escritorio', true, NULL::integer),
    ('basico', 'sync.actualizaciones_automaticas', true, NULL::integer), ('plus', 'sync.actualizaciones_automaticas', true, NULL::integer), ('pro', 'sync.actualizaciones_automaticas', true, NULL::integer),

    -- Ayuda -- nunca se paywallea, reduce soporte
    ('basico', 'ayuda.manuales', true, NULL::integer), ('plus', 'ayuda.manuales', true, NULL::integer), ('pro', 'ayuda.manuales', true, NULL::integer),

    -- IA Nexo -- exclusivo Pro
    ('basico', 'ia.sugerencia_precio', false, NULL::integer), ('plus', 'ia.sugerencia_precio', false, NULL::integer), ('pro', 'ia.sugerencia_precio', true, NULL::integer),
    ('basico', 'ia.deteccion_duplicados', false, NULL::integer), ('plus', 'ia.deteccion_duplicados', false, NULL::integer), ('pro', 'ia.deteccion_duplicados', true, NULL::integer),
    ('basico', 'ia.pronostico_demanda', false, NULL::integer), ('plus', 'ia.pronostico_demanda', false, NULL::integer), ('pro', 'ia.pronostico_demanda', true, NULL::integer),

    -- Banco Global de Imagenes -- exclusivo Pro
    ('basico', 'banco_imagenes.compartido', false, NULL::integer), ('plus', 'banco_imagenes.compartido', false, NULL::integer), ('pro', 'banco_imagenes.compartido', true, NULL::integer),

    -- API -- complemento de pago, no incluido en ningun plan por defecto
    ('basico', 'api.integraciones', false, NULL::integer), ('plus', 'api.integraciones', false, NULL::integer), ('pro', 'api.integraciones', false, NULL::integer),
    ('basico', 'api.panel_desarrollador', false, NULL::integer), ('plus', 'api.panel_desarrollador', false, NULL::integer), ('pro', 'api.panel_desarrollador', false, NULL::integer),

    -- Respaldos automaticos -- exclusivo Pro
    ('basico', 'respaldos.automaticos', false, NULL::integer), ('plus', 'respaldos.automaticos', false, NULL::integer), ('pro', 'respaldos.automaticos', true, NULL::integer)
) AS v(plan_clave, funcion_clave, incluido, limite)
JOIN public.planes p ON p.clave = v.plan_clave
JOIN public.catalogo_funciones f ON f.clave = v.funcion_clave
ON CONFLICT (plan_id, funcion_id) DO NOTHING;

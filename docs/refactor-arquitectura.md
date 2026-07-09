# Refactor arquitectonico local

Este documento guia la refactorizacion local del POS. La regla principal es no cambiar comportamiento ni publicar a produccion hasta que el resultado este aprobado.

## Objetivo

Reducir deuda tecnica acumulada sin perder:

- Estilo Liquid Glass.
- Modo claro y oscuro.
- Flujo actual de ventas.
- Inventario, historial, caja, tickets y configuracion.

## Estado inicial medido

- `public/style.css`: 12,836 lineas, 2,405 usos de `!important`, 228 selectores duplicados.
- `public/app.js`: 12,908 lineas, 409 funciones, 115 `onclick` en strings HTML.
- `server.js`: 4,436 lineas, 45 rutas HTTP y migraciones mezcladas con logica de negocio.
- `public/index.html`: 1,078 lineas, 64 botones, 65 `onclick` inline.

## Reglas de trabajo

1. Crear respaldo antes de cada fase.
2. Cambios pequenos y verificables.
3. No eliminar funciones sin buscar referencias.
4. No reescribir modulos completos de golpe.
5. Consolidar primero tokens y componentes visuales.
6. Probar despues de cada fase con `npm run check` y revision local.

## Fases aprobables

1. Seguridad y respaldo.
2. Tokens de sistema de diseno.
3. Limpieza CSS por componente.
4. Componentes UI reutilizables.
5. Modales y formularios.
6. JavaScript compartido.
7. Punto de venta.
8. Inventario y Agregar producto.
9. Historial, tickets y comprobantes.
10. Caja, finanzas y reportes.
11. Backend por dominios.
12. Migraciones y base de datos.

## Contrato visual

Todo componente nuevo o migrado debe usar los tokens `--nexo-*` y conservar equivalentes para las variables historicas:

- `--surface`
- `--surface-soft`
- `--surface-strong`
- `--line-soft`
- `--text-main`
- `--text-muted`
- `--shadow-soft`

Esto permite migrar sin romper los selectores antiguos.

## Componentes migrados

### Punto de venta: carrito y productos destacados

Archivo nuevo:

- `public/css/components/pos-cart.css`

Objetivo:

- Sacar del final de `public/style.css` el bloque de cierre del carrito.
- Centralizar reglas de carrito, cobro, productos destacados y ultimas ventas.
- Mantener compatibilidad con el CSS historico usando carga posterior y tokens `--nexo-*`.

Resultado de fase:

- `public/style.css` bajo de 12,836 a 10,795 lineas.
- Los usos de `!important` en `public/style.css` bajaron de 2,405 a 1,486.
- El componente nuevo conserva reglas de compatibilidad mientras se termina de retirar CSS historico.

Regla:

- No agregar nuevos arreglos del carrito al final de `style.css`.
- Cualquier ajuste visual del carrito debe ir en `public/css/components/pos-cart.css`.

### Inventario: modal Agregar producto

Archivo nuevo:

- `public/css/components/pos-product-form.css`

Objetivo:

- Centralizar el estilo del modal Agregar producto.
- Mantener el formulario por pestanas, tarjetas de tipo de producto y campos proporcionados.
- Evitar nuevos cierres visuales de `#modalAgregar` al final de `style.css`.

Regla:

- Cualquier ajuste visual del modal Agregar producto debe ir en `public/css/components/pos-product-form.css`.

Resultado de limpieza:

- Respaldo: `backups/before-remove-add-product-legacy-css-20260630-222038`.
- `public/style.css` bajo de 10,795 a 9,907 lineas.
- Los usos de `!important` en `public/style.css` bajaron de 1,486 a 1,252.
- `public/style.css` ya no contiene reglas especificas de `#modalAgregar`, `.producto-tab-panel`, `.campo-ficha`, `.ficha-producto` ni `.producto-tipo-ayuda`.
- El componente `public/css/components/pos-product-form.css` queda como unica fuente visual del modal Agregar producto.
- Validado localmente con `npm run check` y HTTP 200 en `/health`, la app y los CSS migrados.

## Siguiente fase detectada: modales

Hallazgos:

- `public/style.css` todavia concentra reglas base de `.modal-overlay`, `.modal-producto`, `.modal-header` y `.modal-botones`.
- `#modalCreditos .modal-producto` aparece en tres bloques separados.
- Los modales de venta completada, detalle y nota tienen estilos propios cerca del final del archivo.
- Las reglas globales de botones usan `.modal-producto button` y `.modal-botones`, por lo que se deben separar con cuidado para no cambiar todos los botones de golpe.

Propuesta segura:

1. Crear `public/css/components/modals.css` solo con tokens base de overlay, tarjeta, encabezado y acciones.
2. Crear `public/css/components/pos-credit-modal.css` para `#modalCreditos`.
3. Crear `public/css/components/sale-documents.css` para venta completada, detalle y nota.
4. Quitar del CSS monolitico solo los bloques migrados y validar cada modal localmente.

### Modales: creditos y comprobantes

Archivos nuevos:

- `public/css/components/pos-credit-modal.css`
- `public/css/components/sale-documents.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-modals-20260630-230113`.
- `public/style.css` bajo de 9,907 a 8,884 lineas.
- Los usos de `!important` en `public/style.css` bajaron de 1,252 a 980.
- Se migraron los bloques de `#modalCreditos`, clientes con credito, movimientos de cuenta, venta completada, detalle de venta, nota de venta e historial de comprobantes.
- `public/style.css` conserva solo menciones globales de tema/tablas que afectan varios modulos; no debe recibir nuevos ajustes puntuales de creditos o comprobantes.

Regla:

- Ajustes visuales de creditos van en `public/css/components/pos-credit-modal.css`.
- Ajustes visuales de tickets, detalle, nota y venta completada van en `public/css/components/sale-documents.css`.

Validacion:

- `npm run check` correcto.
- HTTP 200 en `/health`, la app local, `pos-credit-modal.css` y `sale-documents.css`.

### Modal de cobro / metodo de pago

Archivo nuevo:

- `public/css/components/pos-payment-modal.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-payment-modal-20260701-070821`.
- `public/style.css` bajo de 8,884 a 8,334 lineas.
- Los usos de `!important` en `public/style.css` bajaron de 980 a 807.
- Se migraron las tres capas historicas del modal de metodo de pago: base, selector sin tarjetas azules y cierre visual Liquid Glass.
- `public/style.css` ya no contiene reglas especificas de `.modal-metodo-pago`, `.metodo-pago-*` ni `.metodo-flecha`.

Regla:

- Ajustes visuales del cobro y selector de metodo de pago van en `public/css/components/pos-payment-modal.css`.
- No mezclar estos ajustes con inventario bajo aunque compartan estructura de modal.

Validacion:

- `npm run check` correcto.
- HTTP 200 en `/health`, la app local y `pos-payment-modal.css`.

### Inventario bajo y sugerencia de pedido

Archivo nuevo:

- `public/css/components/low-stock-order.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-low-stock-modal-20260701-072147`.
- `public/style.css` bajo de 8,334 a 8,069 lineas.
- Los usos de `!important` en `public/style.css` bajaron de 807 a 794.
- Se migraron las reglas de `modal-inventario-bajo`, `inventario-bajo-card`, detalle de inventario bajo, `modalSugerenciaPedido`, `modal-pedido-card`, `pedido-lista`, `pedido-item`, KPIs, tabla de pedido y prioridades.
- `public/style.css` ya no contiene reglas especificas de pedido o modal de inventario bajo.

Regla:

- Ajustes visuales del flujo inventario bajo / sugerencia de pedido van en `public/css/components/low-stock-order.css`.
- Las reglas de productos por categoria se mantienen fuera de este componente porque pertenecen al modulo de categorias.

Validacion:

- `npm run check` correcto.
- HTTP 200 en `/health`, la app local y `low-stock-order.css`.

### Contacto desarrollador, recordatorios y notificaciones

Archivo nuevo:

- `public/css/components/support-reminders.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-contact-reminders-20260701-072831`.
- `public/style.css` bajo de 8,069 a 7,523 lineas.
- Los usos de `!important` en `public/style.css` bajaron de 794 a 632.
- Se migraron las reglas de panel de notificaciones, items de notificacion, modal de recordatorio, captura de fecha/hora y modal de contacto desarrollador.
- `public/style.css` conserva solo contraste del shell principal y reglas globales compartidas.

Regla:

- Ajustes visuales de notificaciones, recordatorios y contacto desarrollador van en `public/css/components/support-reminders.css`.
- No volver a agregar reglas puntuales de `#modalRecordatorioPOS` ni `#modalContactoDesarrolladorPOS` en `public/style.css`.

Validacion:

- `npm run check` correcto.
- Balance de llaves correcto en `public/style.css` y `public/css/components/support-reminders.css`.
- HTTP 200 en `/health` y `support-reminders.css`.
- Navegador local carga la app con `support-reminders.css` activo y sin errores de consola.

### Shell principal, sidebar y topbar

Archivo nuevo:

- `public/css/components/app-shell.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-app-shell-css-20260701-continue`.
- `public/style.css` bajo de 7,523 a 6,806 lineas.
- Los usos de `!important` en `public/style.css` bajaron de 632 a 455.
- Se migraron layout principal, sidebar, marca del negocio, botones del menu, topbar, badge de notificaciones, menu Nexo POS y comportamiento de scroll fijo en escritorio.
- `public/style.css` conserva reglas antiguas no extraidas que aun afectan modulos especificos; el shell visual final vive en `app-shell.css`.

Regla:

- Ajustes visuales de sidebar, topbar, layout base, marca del negocio y menu Nexo POS van en `public/css/components/app-shell.css`.
- No agregar nuevos cierres visuales del shell en `public/style.css`.

Validacion:

- `npm run check` correcto.
- Balance de llaves correcto en `public/style.css` y `public/css/components/app-shell.css`.
- HTTP 200 en la app local y `app-shell.css`.
- Navegador local carga `app-shell.css`, conserva layout/sidebar/topbar y no reporta errores de consola.

### Configuracion inicial / setup wizard

Archivo nuevo:

- `public/css/components/setup-wizard.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-setup-wizard-css-20260701`.
- `public/style.css` bajo de 6,806 a 6,510 lineas.
- Se migraron la pantalla `#configuracionInicial`, panel de marca, pasos del asistente, preview de logo, grid de campos, acciones y responsive del setup inicial.
- El archivo nuevo no usa `!important`; queda cargado despues del CSS base para conservar prioridad sobre reglas globales antiguas.

Regla:

- Ajustes visuales de la configuracion inicial van en `public/css/components/setup-wizard.css`.
- No mezclar el setup inicial con la pantalla de Configuracion interna del POS; esa sera una fase separada.

Validacion:

- `npm run check` correcto.
- Balance de llaves correcto en `public/style.css` y `public/css/components/setup-wizard.css`.
- HTTP 200 en `setup-wizard.css`.
- Navegador local carga `setup-wizard.css`, detecta `#configuracionInicial` y no reporta errores de consola.

### Configuracion interna, tickets, hardware y usuarios

Archivo nuevo:

- `public/css/components/config-settings.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-config-settings-css-20260701`.
- `public/style.css` bajo de 6,510 a 5,633 lineas.
- Se migraron estilos de `#pantallaConfiguracion`, `config-shell`, header, paneles, tabs, formularios, preview de ticket, opciones 58/80 mm, hardware, estado de impresora, zona de peligro, usuarios y permisos.
- `public/style.css` ya no contiene reglas especificas fuertes de configuracion; las menciones restantes de configuracion viven en `config-settings.css`.

Regla:

- Ajustes visuales de Configuracion interna, Ticket, Hardware y Usuarios van en `public/css/components/config-settings.css`.
- No mezclar la Configuracion interna con `setup-wizard.css`, que solo cubre la configuracion inicial.

Validacion:

- `npm run check` correcto.
- Balance de llaves correcto en `public/style.css` y `public/css/components/config-settings.css`.
- HTTP 200 en `config-settings.css`.
- Navegador local carga `config-settings.css`, detecta la pantalla de configuracion y no reporta errores de consola.

### Recepcion de mercancia

Archivo nuevo:

- `public/css/components/receiving.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-recepcion-css-20260701`.
- `public/style.css` bajo de 5,633 a 5,333 lineas.
- Se migraron las reglas de Recepcion inteligente de mercancia: shell, header, carga de documentos, formulario, ayuda, KPIs, resumen del documento, preview, tabla, estados y responsive.
- `public/style.css` ya no contiene reglas especificas de `recepcion-*` ni `btn-recepcion-confirmar`.

Regla:

- Ajustes visuales de Recepcion de mercancia van en `public/css/components/receiving.css`.
- La logica de Recepcion permanece en `public/app.js`; esta fase solo separa estilos.

Validacion:

- `server.js` y `public/app.js` pasan `node --check`.
- Balance de llaves correcto en `public/style.css`, `public/css/components/receiving.css` y `public/css/components/config-settings.css`.
- HTTP 200 en la app local, `/health` y `receiving.css` usando el servidor local con `.env`.
- La verificacion visual en navegador interno no se pudo completar por un cierre del controlador del navegador del entorno; no hubo errores de sintaxis ni de servidor.

### Dialogos del sistema

Archivo nuevo:

- `public/css/components/system-dialogs.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-system-dialogs-css-20260701`.
- `public/style.css` bajo de 5,333 a 5,207 lineas.
- Se migraron los estilos de `alertaPOS` / dialogos del sistema: overlay, tarjeta, iconos por estado, cuerpo, input, acciones y modo oscuro.
- Se movio tambien la regla final de `dialogo-cancelar` que estaba agrupada con botones secundarios para conservar la prioridad visual.
- `public/style.css` ya no contiene selectores `dialogo-pos-*`.

Regla:

- Ajustes visuales de alertas, confirmaciones y prompts internos van en `public/css/components/system-dialogs.css`.
- La logica de dialogos sigue en `public/app.js`; no cambiarla durante fases de CSS salvo que haya un bug funcional claro.

Validacion:

- `server.js` y `public/app.js` pasan `node --check`.
- Balance de llaves correcto en `public/style.css`, `public/css/components/system-dialogs.css` y `public/css/components/receiving.css`.
- HTTP 200 en `/health` y `system-dialogs.css`.

Nota para siguiente fase:

- `Catalogo proveedor` todavia no se debe mover de golpe: tiene base, diagnostico/importador y overrides de tema repartidos en distintas zonas de `public/style.css`. La extraccion debe hacerse con CSS final efectivo para no alterar el estilo Liquid Glass.

### Catalogo proveedor

Archivo nuevo:

- `public/css/components/supplier-catalog.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-supplier-catalog-css-20260701`.
- `public/style.css` bajo de 5,207 a 4,843 lineas.
- Se migraron los bloques propios de Catalogo proveedor: pantalla, shell, header, boton subir, resumen, grid, paneles, items, vista de catalogo, diagnostico, acciones e importador comercial de catalogos.
- Se dejaron en `public/style.css` las reglas compartidas de tema global que tambien afectan clientes, proveedores, inventario bajo y reportes.

Regla:

- Ajustes visuales propios de Catalogo proveedor van en `public/css/components/supplier-catalog.css`.
- No mover todavia la capa global compartida hasta separar primero clientes/proveedores/reportes para no romper consistencia visual.

Validacion:

- `server.js` y `public/app.js` pasan `node --check`.
- Balance de llaves correcto en `public/style.css` y `public/css/components/supplier-catalog.css`.
- HTTP 200 en `/health` y `supplier-catalog.css`.

### Paginacion y modales operativos

Archivo nuevo:

- `public/css/components/operational-tables.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-operational-tables-css-20260701`.
- `public/style.css` bajo de 4,843 a 4,707 lineas.
- Se migraron paginacion de tablas, modal de productos por categoria, filas/vacios de productos por categoria y `producto-mini-icon`.

Regla:

- Estilos reutilizables de paginacion, listas operativas y modal de productos por categoria van en `public/css/components/operational-tables.css`.
- Mantener reglas globales compactas fuera de este archivo hasta ordenarlas en una fase de utilidades/base.

Validacion:

- `server.js` y `public/app.js` pasan `node --check`.
- Balance de llaves correcto en `public/style.css`, `public/css/components/operational-tables.css` y `public/css/components/supplier-catalog.css`.
- HTTP 200 en la app local, `/health` y `operational-tables.css`.

### Pulido operativo POS / sync

Archivo nuevo:

- `public/css/components/pos-operational-polish.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-pos-polish-css-20260701`.
- `public/style.css` bajo de 4,707 a 4,616 lineas.
- Se migraron ajustes de filtro activo, vista de productos en lista y chip de sincronizacion de escritorio.
- Se dejo separado de alertas/notificaciones para no mezclar POS operativo con centro de notificaciones.

Regla:

- Ajustes puntuales de busqueda/listado POS y estado de sync van en `public/css/components/pos-operational-polish.css`.
- Alertas de inventario y centro de notificaciones se revisan en fases independientes.

Validacion:

- `server.js` y `public/app.js` pasan `node --check`.
- Balance de llaves correcto en `public/style.css` y `public/css/components/pos-operational-polish.css`.
- HTTP 200 en `/health` y `pos-operational-polish.css`.

### Alertas de inventario en dashboard

Archivo nuevo:

- `public/css/components/dashboard-alerts.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-dashboard-alerts-css-20260701`.
- `public/style.css` bajo de 4,616 a 4,355 lineas.
- Se migraron las capas `Fase 8.5` y `Fase 8.6` de alertas de inventario Liquid Glass, incluyendo la version compacta final que mantiene la prioridad visual actual.
- Se retiro de `public/style.css` un duplicado de acciones del centro de notificaciones.
- El responsive de `notificaciones-head-actions` se reubico en `public/css/components/support-reminders.css`, que es el componente propietario de notificaciones.

Regla:

- Alertas del dashboard e inventario bajo compacto van en `public/css/components/dashboard-alerts.css`.
- Notificaciones y recordatorios permanecen en `public/css/components/support-reminders.css`.

Validacion:

- `server.js` y `public/app.js` pasan `node --check`.
- Balance de llaves correcto en `public/style.css`, `public/css/components/dashboard-alerts.css` y `public/css/components/support-reminders.css`.
- HTTP 200 en `/health` y `dashboard-alerts.css`.

### Login y cierre compacto de modales

Archivos:

- `public/css/components/auth-login.css`
- `public/css/components/system-dialogs.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-login-modal-close-css-20260701`.
- `public/style.css` bajo de 4,355 a 4,287 lineas.
- Se migraron los ajustes finales de login legible a `auth-login.css`.
- Se movio el estilo global de `button.modal-cerrar-x` a `system-dialogs.css`, porque pertenece a modales y controles de dialogo.

Regla:

- Ajustes de login/autenticacion van en `public/css/components/auth-login.css`.
- Botones universales de cierre de modal van en `public/css/components/system-dialogs.css`.

Validacion:

- `server.js` y `public/app.js` pasan `node --check`.
- Balance de llaves correcto en `public/style.css`, `public/css/components/auth-login.css` y `public/css/components/system-dialogs.css`.
- HTTP 200 en `/health`, `auth-login.css` y `system-dialogs.css`.

### Clientes

Archivo nuevo:

- `public/css/components/customers.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-customers-suppliers-reports-css-20260701`.
- Se migraron pantalla de clientes, shell, encabezado, resumen, buscador, tabla, estados, acciones y modo oscuro.
- Las reglas responsive y de tema global compartidas siguen temporalmente en `public/style.css`.

Validacion:

- Balance de llaves correcto en `public/css/components/customers.css`.
- HTTP 200 en `customers.css`.

### Proveedores

Archivo nuevo:

- `public/css/components/suppliers.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-customers-suppliers-reports-css-20260701`.
- Se migraron pantalla de proveedores, shell, encabezado, resumen, buscador, tabla, contador de productos, acciones y modo oscuro.
- Las reglas responsive y de tema global compartidas siguen temporalmente en `public/style.css`.

Validacion:

- Balance de llaves correcto en `public/css/components/suppliers.css`.
- HTTP 200 en `suppliers.css`.

### Reportes

Archivo nuevo:

- `public/css/components/reports.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-customers-suppliers-reports-css-20260701`.
- Se migraron pantalla de reportes, resumen, paneles, ventas recientes, estados vacios, modo oscuro, filtros, grid secundario y lista compacta.
- No se movio `topbar-help` porque pertenece al shell superior.

Validacion:

- Balance de llaves correcto en `public/css/components/reports.css`.
- HTTP 200 en `reports.css`.

### Inventario bajo - pantalla principal

Archivo actualizado:

- `public/css/components/low-stock-order.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-low-stock-screen-css-20260701`.
- Se agrego al componente existente la pantalla principal de Inventario bajo: shell, header, resumen, toolbar, tabla, estados, acciones y modo oscuro.
- El componente ahora agrupa pantalla, modal de detalle y sugerencia de pedido.

Validacion:

- Balance de llaves correcto en `public/css/components/low-stock-order.css`.
- HTTP 200 en `low-stock-order.css`.

### Credito desde carrito y detalle de venta legacy

Archivo actualizado:

- `public/css/components/pos-credit-modal.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-credit-sale-detail-css-20260701`.
- Se movio el bloque `CREDITO DESDE CARRITO` al final de `pos-credit-modal.css` para conservar prioridad visual.
- Incluye boton de credito, boton ver detalle, modal legacy de detalle de venta, resumen, tabla y modo oscuro.

Validacion:

- Balance de llaves correcto en `public/css/components/pos-credit-modal.css`.
- HTTP 200 en `pos-credit-modal.css`.

### Inventario principal y categorias

Archivo nuevo:

- `public/css/components/inventory.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-inventory-css-20260701`.
- Se migraron Inventario principal, buscador, boton agregar, categorias, tarjetas de categoria, tabla de inventario, estados, acciones, modo oscuro y pulido final de columnas.
- Se dejaron reglas antiguas iniciales y de tema compartido en `public/style.css` para una fase posterior de utilidades/base.

Validacion:

- Balance de llaves correcto en `public/css/components/inventory.css`.
- HTTP 200 en `inventory.css`.

### Login base

Archivo actualizado:

- `public/css/components/auth-login.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-auth-login-base-css-20260701`.
- Se movieron los estilos base del login, `login-box`, marca de login y logo/fallback al componente de autenticacion.
- `auth-login.css` ahora contiene base y ajustes finales del login.

Validacion:

- Balance de llaves correcto en `public/css/components/auth-login.css`.

### Validacion acumulada de esta tanda

- `public/style.css` bajo de 4,287 a 2,731 lineas.
- `public/style.css` conserva 298 usos de `!important`; al inicio de la refactorizacion habia mas de 800.
- `server.js` y `public/app.js` pasan `node --check`.
- HTTP 200 en la app local y `/health`, con base conectada.

### Separacion final de capas CSS legacy

Archivos nuevos:

- `public/css/layers/legacy-layout.css`
- `public/css/layers/theme-runtime.css`
- `public/css/layers/pos-restoration.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-style-layers-css-20260701`.
- `public/style.css` bajo de 2,731 a 17 lineas.
- `legacy-layout.css` conserva la capa antigua/base que aun mezcla dashboard, POS legacy, modales antiguos y responsive inicial.
- `theme-runtime.css` conserva la capa global de tema, modo oscuro y variables efectivas que estaban despues de los modulos.
- `pos-restoration.css` conserva la capa final de restauracion Liquid Glass, controles tactiles y ajustes de carrito/cliente/productos que ganaban prioridad visual.
- Se mantuvo el mismo orden de carga original: `style.css` -> capas -> componentes.

Regla:

- `public/style.css` queda como base minima global.
- Las capas `css/layers/*` son transitorias: sirven para no romper visualmente mientras se terminan de migrar reglas a componentes reales.
- No agregar nuevas reglas a las capas legacy salvo que sea una correccion temporal documentada.

Validacion:

- Balance de llaves correcto en `public/style.css`, `legacy-layout.css`, `theme-runtime.css` y `pos-restoration.css`.
- `server.js` y `public/app.js` pasan `node --check`.
- HTTP 200 en la app local, `/health`, `legacy-layout.css`, `theme-runtime.css` y `pos-restoration.css`.

### Extraccion de responsive legacy

Archivo nuevo:

- `public/css/layers/responsive-legacy.css`

Resultado de fase:

- Respaldo: `backups/before-refactor-responsive-legacy-css-20260702`.
- Se saco de `legacy-layout.css` el bloque responsive compartido de Inventario, Clientes, Proveedores, Catalogo, Inventario bajo, Reportes, Creditos y POS.
- `legacy-layout.css` bajo a 533 lineas y queda enfocado en estilos antiguos/base que todavia requieren clasificacion.
- `responsive-legacy.css` queda sin `!important`, como capa transitoria para reglas responsivas que cruzan varios modulos.

Validacion:

- Balance de llaves correcto en `legacy-layout.css` y `responsive-legacy.css`.
- `server.js` y `public/app.js` pasan `node --check`.
- HTTP 200 en `/health` y `responsive-legacy.css`.

### Limpieza inicial de duplicados JavaScript

Archivo actualizado:

- `public/app.js`

Resultado de fase:

- Respaldos:
  - `backups/before-refactor-config-duplicate-js-20260702`
  - `backups/before-refactor-js-duplicate-functions-20260702`
- Se eliminaron versiones legacy pisadas por funciones nuevas:
  - `mostrarConfiguracion`
  - `guardarConfiguracionSistema`
  - `mostrarPuntoVenta`
  - `mostrarGraficas`
- Se elimino una copia repetida identica de `limpiarTextoUI`.
- `public/app.js` bajo de 12,908 a 12,655 lineas.
- Ya no quedan duplicados directos detectados por declaraciones `function nombre()`.

Validacion:

- `public/app.js` pasa `node --check`.
- `/health` responde HTTP 200 con base conectada.

Riesgo controlado:

- Solo se retiraron funciones muertas que estaban siendo sobrescritas por declaraciones posteriores o duplicadas identicas.
- No se cambio la funcion activa de Punto de venta, Configuracion, Reportes ni limpieza de texto.

### Estado actual de deuda tecnica restante

CSS:

- `public/style.css` ya quedo como base minima de 17 lineas.
- Las capas transitorias aun pendientes son:
  - `public/css/layers/legacy-layout.css`
  - `public/css/layers/theme-runtime.css`
  - `public/css/layers/pos-restoration.css`
  - `public/css/layers/responsive-legacy.css`
- Los componentes con mayor cantidad de `!important` siguen siendo:
  - `pos-restoration.css`
  - `pos-payment-modal.css`
  - `support-reminders.css`
  - `app-shell.css`
  - `pos-cart.css`
  - `pos-credit-modal.css`

JavaScript:

- `public/app.js` sigue siendo el principal bloque de deuda tecnica: 12,655 lineas.
- Ya no hay duplicados directos por declaracion `function nombre()`.
- La separacion recomendable para siguientes fases es:
  - configuracion y ticket
  - catalogos/proveedores
  - productos e inventario
  - punto de venta/carrito/cobro
  - historial/comprobantes
  - creditos/caja
  - shell/topbar/notificaciones

Riesgo:

- Extraer JavaScript por archivos requiere una fase especifica porque las funciones dependen de estado global compartido (`carrito`, `todosProductos`, `clientesCredito`, `usuarioActual`, configuracion, etc.).
- Antes de mover logica conviene crear una capa pequena de utilidades compartidas para no duplicar estado.

### Separacion inicial del cargador backend

Archivo nuevo:

- `server-modules.js`

Archivo actualizado:

- `server.js`

Resultado de fase:

- Respaldo: `backups/before-refactor-server-modules-20260702`.
- Se movio el cargador de modulos POS por fases fuera de `server.js`.
- `server.js` ahora importa `cargarModulosPOS` y conserva el mismo orden de carga:
  - fase4 compras/ajustes
  - fase5 finanzas
  - fase6 caja
  - fase7 caja por metodo
- No se modificaron rutas ni comportamiento de API.

Validacion:

- `server.js` pasa `node --check`.
- `server-modules.js` pasa `node --check`.
- App local `/` responde HTTP 200.
- `/health` responde HTTP 200 con base conectada.
- Se levanto una instancia temporal en `PORT=3101`, cargo `fase4`, `fase5`, `fase6` y `fase7`, respondio `/health` y se apago al terminar la prueba.

Nota:

- Durante la prueba temporal aparecio un warning de SSL de `pg-connection-string` relacionado con `sslmode=require`; no esta causado por esta refactorizacion.

### Separacion inicial de JavaScript frontend por dominio

Archivos nuevos:

- `public/js/shell-topbar.js`
- `public/js/scanner-usb.js`
- `public/js/offline-sync.js`
- `public/js/app-bootstrap.js`
- `public/js/ferretero-flow.js`
- `public/js/reports.js`
- `public/js/config-auth.js`
- `public/js/supplier-catalog.js`
- `public/js/low-stock.js`
- `public/js/product-inventory.js`
- `public/js/pos-sales.js`
- `public/js/sales-history-documents.js`
- `public/js/credit-customers.js`
- `public/js/supplier-catalog-view.js`

Archivos actualizados:

- `public/app.js`
- `public/index.html`

Resultado de fase:

- Respaldos:
  - `backups/before-refactor-shell-topbar-js-20260702`
  - `backups/before-refactor-scanner-usb-js-20260702`
  - `backups/before-refactor-ferretero-flow-js-20260702`
- Se saco de `app.js` el shell/topbar, menu Nexo, contacto de desarrollador, recordatorios, notificaciones y wrappers de navegacion.
- Se saco de `app.js` la captura global del lector USB.
- Se saco de `app.js` el bloque de flujo ferretero de producto/carrito y mejoras operativas relacionadas.
- Se saco de `app.js` el modulo de Reportes y ventas.
- Se saco de `app.js` el bloque de configuracion, setup inicial, ticket/hardware, usuarios, permisos y login.
- Se saco de `app.js` el importador de catalogos de proveedor: plantillas, mapeos, lectura CSV y guardado local.
- Se saco de `app.js` Inventario bajo, modal de detalle y sugerencia de pedido.
- Se saco de `app.js` Inventario/Formulario de producto: utilidades de producto/catalogo, alta, edicion, baja, categorias, listado y busqueda de inventario.
- Se saco de `app.js` Punto de venta/carrito/cobro: lectura de codigo en POS, productos destacados, carrito, cliente de venta, descuentos, ticket, cobro efectivo y cobro a credito.
- Se saco de `app.js` Historial/comprobantes: historial de ventas, pulso de ventas del dashboard, detalle de venta, reimpresion, nota de venta, ajuste documentado y modal de venta completada.
- Se saco de `app.js` Creditos/clientes: listado de creditos, detalle de cuenta, movimientos, abonos/cargos, formulario reusable de credito y administracion de clientes.
- Se saco de `app.js` Proveedores/vista de catalogo: CRUD de proveedores, pantalla de catalogos cargados, diagnostico de columnas, muestra de productos y limpieza de catalogos.
- Se saco de `app.js` Offline/sync: contexto de negocio, cache desktop, licencia, cola de eventos offline, sincronizacion y refresco local.
- Se saco de `app.js` Bootstrap: login, carga inicial de productos, resumen de dashboard, busqueda principal, `window.onload`, helper de dinero y enter para cobro.
- `public/app.js` bajo de 12,655 a 76 lineas.
- Se mantuvo carga con scripts clasicos para conservar compatibilidad con funciones globales usadas por `onclick`.

Orden de carga:

1. `app.js`
2. `js/offline-sync.js`
3. `js/config-auth.js`
4. `js/supplier-catalog.js`
5. `js/product-inventory.js`
6. `js/pos-sales.js`
7. `js/sales-history-documents.js`
8. `js/credit-customers.js`
9. `js/supplier-catalog-view.js`
10. `js/app-bootstrap.js`
11. `js/reports.js`
12. `js/shell-topbar.js`
13. `js/scanner-usb.js`
14. `js/low-stock.js`
15. `js/ferretero-flow.js`

Validacion:

- `public/app.js` pasa `node --check`.
- `offline-sync.js`, `app-bootstrap.js`, `config-auth.js`, `supplier-catalog.js`, `supplier-catalog-view.js`, `product-inventory.js`, `pos-sales.js`, `sales-history-documents.js`, `credit-customers.js`, `low-stock.js`, `reports.js`, `shell-topbar.js`, `scanner-usb.js` y `ferretero-flow.js` pasan `node --check`.
- HTTP 200 en app local `/`, `/health` y scripts nuevos.

Nota:

- El navegador interno no pudo usarse por permisos del entorno, asi que esta tanda queda validada por sintaxis y carga HTTP. La validacion visual/interactiva debe hacerse en la app local abierta.

### Cierre local de la fase de limpieza

Estado:

- Refactor arquitectonico local completado para CSS, cargador backend y separacion principal de JavaScript frontend.
- `public/app.js` quedo como base global minima de 76 lineas.
- No se publicaron cambios ni se subio nada a produccion.
- Las herramientas temporales usadas para extraccion fueron eliminadas.

Validacion final local:

- Todos los archivos `public/js/*.js` pasan `node --check`.
- `public/app.js` pasa `node --check`.
- `server.js` y `server-modules.js` pasan `node --check`.
- App local `/` responde HTTP 200.
- `/health` responde HTTP 200 con base de datos conectada.

Pendiente antes de aprobar produccion:

- Recorrido visual/manual en navegador de Punto de venta, Inventario, Agregar producto, Historial, Creditos, Caja, Reportes y Configuracion.
- Prueba manual de modo claro y modo oscuro.
- Prueba manual de venta, nota, reimpresion, credito y cierre de caja.

### Rediseno visual: sidebar, topbar y Punto de venta segun referencia

Archivos actualizados:

- `public/css/components/app-shell.css`
- `public/css/components/pos-cart.css`
- `public/js/shell-topbar.js`
- `public/js/config-auth.js`
- `public/js/pos-sales.js`
- `public/index.html`

Resultado de fase:

- Respaldo: `backups/before-shell-redesign-20260702`.
- Sidebar reescrito de tarjetas de vidrio sobre degradado azul a navy plano con filas icono+texto y estado activo en pildora azul solida, igual a la referencia entregada por el cliente.
- Topbar reescrito: se quito la pildora "Nexo POS" y el boton de texto "Recordatorio", se agrego toggle de tema (llama a `cambiarModo()` ya existente), y se reemplazo por un bloque de usuario (avatar con iniciales, rol y negocio) que abre el mismo panel `#menuNexoPOS` de siempre.
- Se agrego el boton "Creditos" al sidebar, conectado a la funcion ya existente `abrirCreditos()`.
- Se movio `#modalCreditos` de estar anidado dentro de `#pantallaInicio` a ser hermano directo dentro de `.contenido`, porque al abrirlo desde el nuevo boton del sidebar en otra pantalla quedaba oculto por su contenedor padre. La logica y el contenido del modal no cambiaron, solo su ubicacion en el DOM.
- Se reemplazaron los glifos unicode de la tira de categorias y de la fila de KPIs de Punto de venta por iconos SVG (ampliando el diccionario `iconoUISVG()`), y las placas de 2 letras de `iconoProducto()` por pictogramas.
- Se agrego un pie de sidebar con version y estado de sync, reutilizando el chip de sync ya existente en `public/js/offline-sync.js`.
- Se detecto y corrigio una regla global preexistente en `theme-runtime.css` (`button{background:var(--brand-color)!important}`) que forzaba fondo azul solido en botones de `pos-cart.css` que debian verse neutros/transparentes; se reforzaron esos selectores con `!important` siguiendo el mismo patron ya usado en el resto del archivo, sin tocar la regla global.

Validacion:

- `server.js`, `public/app.js`, `public/js/shell-topbar.js`, `public/js/config-auth.js` y `public/js/pos-sales.js` pasan `node --check`.
- Verificado en navegador local (sesion real contra la base remota): Inicio, Punto de venta, Inventario y Configuracion cargan con el shell nuevo, el boton Creditos abre el modal correcto desde cualquier pantalla, y el toggle de tema alterna modo claro/oscuro correctamente.
- Balance de etiquetas `<div>` verificado en `public/index.html` tras mover el modal de creditos.

### Ajustes de Punto de venta: espaciado y vidrio en botones clave

Archivos actualizados:

- `public/css/components/pos-cart.css`
- `public/index.html`

Resultado de fase:

- La tira de categorias paso de grid con auto-fit (se partia en dos filas y empujaba los productos) a una fila fija con scroll horizontal.
- El grid de productos ahora limita la altura a una sola fila (3 productos), con "Ver todos" para el resto.
- Se quito la seccion "Productos frecuentes" del Punto de venta (a pedido del cliente).
- Se corrigio un `max-height:300px` heredado en `#carrito` que, combinado con `overflow:visible`, hacia que el resumen de cobro y los botones se salieran de la tarjeta del carrito al agregar varios productos.
- Se agrego `flex-shrink:0` a `.pos-referencia` porque `.contenido` (flex column con `height:100vh`) estaba encogiendo la pantalla de Punto de venta y generando un scroll interno atrapado en vez de un scroll normal de pagina.
- "Cobrar" y los botones "Agregar" de las tarjetas de producto pasaron de un degradado solido a vidrio real (`backdrop-filter: blur` + brillo interior), a pedido del cliente.

Validacion:

- Probado con productos reales en el carrito en 1440x900 y 1440x800: sin empalmes, sin scroll interno atrapado, KPIs visibles sin scroll de pagina.

### Rediseno de Inventario / Productos segun referencia

Archivos actualizados:

- `public/css/components/inventory.css`
- `public/index.html`
- `public/js/product-inventory.js`
- `public/js/app-bootstrap.js`
- `public/js/shell-topbar.js`
- `public/app.js`

Resultado de fase:

- Respaldo: `backups/before-inventory-redesign-20260703`.
- Se agrego una fila de 4 tarjetas de resumen (Total productos, Stock total, Valor inventario, Productos sin stock) calculadas en el cliente a partir de `todosProductos` (sin cambios en como se cargan o guardan los productos).
- Se agregaron filtros por Categoria y Estado (dropdowns) ademas del buscador de texto que ya existia; "Estado" reutiliza el mismo calculo de `stock <= 0 / <= 5` que ya se usaba para pintar el badge.
- La tabla ahora incluye columna Categoria y una miniatura por producto (mismo pictograma que ya se usa en Punto de venta), y las acciones pasaron de texto ("Editar"/"Eliminar") a iconos.
- El pie de la tabla ahora muestra "Mostrando X a Y de Z productos" y un selector de productos por pagina (8/10/20/50); la paginacion compartida (`renderPaginacion`, tambien usada por Inventario bajo y Reportes) ahora recorta con "..." cuando hay muchas paginas, sin cambiar su comportamiento actual.
- Se corrigio que la tabla de Inventario no se refrescaba sola despues de agregar/editar/eliminar un producto (solo se actualizaba al volver a entrar a la pantalla); ahora `cargarProductos()` refresca la tabla si esta visible.
- El boton "+ Agregar producto" en Inventario ahora usa el mismo estilo de vidrio que "Cobrar" en Punto de venta.

Nota de datos:

- Varios productos en la base actual tienen `categoria` vacia o con codigos crudos (ej. "P668") en vez de nombres legibles, y algunos tienen stock negativo (ajustes o mermas sin resolver). Las tarjetas de resumen y el filtro de Categoria reflejan esos datos tal cual estan; no se inventaron ni corrigieron valores.

Validacion:

- `node --check` correcto en `server.js`, `app.js`, `product-inventory.js`, `app-bootstrap.js`, `shell-topbar.js`.
- Probado en navegador local con datos reales: filtros por categoria/estado, cambio de tamano de pagina, y refresco automatico despues de filtrar funcionan correctamente en modo claro y oscuro.

### Rediseno de Categorias: panel de dos columnas

Archivos actualizados:

- `public/css/components/inventory.css`
- `public/index.html`
- `public/js/product-inventory.js`
- `public/js/shell-topbar.js`
- `public/app.js`

Resultado de fase:

- Respaldo: `backups/before-categorias-redesign-20260703`.
- Se reemplazo la grilla de tarjetas + modal ("Ver productos") por un panel de dos columnas: lista de categorias a la izquierda (con buscador) y detalle de la categoria seleccionada a la derecha, con pestanas Productos / Informacion / Estadisticas.
- La pestana Productos reutiliza el mismo patron de tabla, badges de estado, iconos de accion y paginacion ya construido para Inventario.
- Se agrego `editarCategoriaInventario()` (no existia edicion de categorias, solo alta y baja); igual que borrar, renombrar no actualiza el campo `categoria` de los productos existentes (mismo comportamiento que ya tenia borrar).
- Se quito el modal `#modalCategoriaProductos` y sus funciones asociadas (`abrirModalCategoriaProductos`, `cerrarModalCategoriaProductos`, `irInventarioDesdeCategoria`), reemplazadas por el panel de detalle inline.
- Simplificaciones frente a la referencia: sin boton "Filtros" separado, sin alternador de vista cuadricula/lista y sin menu de tres puntos (se usan los mismos dos iconos editar/eliminar que en Inventario) porque no hay una accion adicional real que poner ahi.
- Se detecto que el bug del boton global (`button{background:var(--brand-color)!important}` en `theme-runtime.css`) tambien afectaba `.btn-agregar` en Inventario -- el boton "+ Agregar producto" nunca habia mostrado el efecto de vidrio real. Ya quedo corregido junto con todos los botones nuevos de esta fase.

Validacion:

- `node --check` correcto en `server.js`, `app.js`, `product-inventory.js`, `shell-topbar.js`.
- Probado en navegador local: seleccion de categoria, pestanas, tabla de productos por categoria, paginacion y modo oscuro funcionan correctamente.

### Creditos: pantalla completa reemplaza el modal, con fecha de vencimiento real

Archivos actualizados:

- `server.js` (schema + endpoints)
- `public/index.html`
- `public/js/credit-customers.js`
- `public/js/config-auth.js`
- `public/js/supplier-catalog-view.js`
- `public/js/shell-topbar.js`
- `public/css/components/pos-credit-modal.css`

Cambio de datos (aprobado explicitamente por el cliente antes de tocarlo):

- Se agrego la columna `fecha_vencimiento DATE` (nullable) a `public.clientes_credito`, aplicada automaticamente al iniciar el servidor (mismo patron que ya usaba esta tabla para `negocio_id`). Sin este dato no habia forma honesta de mostrar "Vencido" / "Al dia", que la referencia visual pedia.
- `GET /creditos` ahora tambien regresa `clientesVencidos`, `totalVencido` y `pagosEsteMes` (agregados calculados en el servidor). `POST` y `PUT` de `/creditos/clientes` aceptan `fechaVencimiento`.
- Se encontro y corrigio un bug en el calculo de vencidos: `pg` regresa `fecha_vencimiento` como objeto `Date`, y comparar `String(fecha)` contra una fecha ISO nunca daba `true`. Se agrego una conversion explicita a ISO antes de comparar.

Cambio de pantalla:

- `#modalCreditos` (modal-overlay) se convirtio en `#pantallaCreditos`, una pantalla mas del sistema como Inventario o Categorias, con las dos entradas existentes (tarjeta "Credito pendiente" del dashboard y el boton "Creditos" del sidebar) apuntando a la misma funcion `abrirCreditos()`.
- Se reutilizo toda la logica de render que ya funcionaba (`abrirCuentaCliente`, la tabla de movimientos con "ver mas", `registrarAbonoCredito`, `registrarCargoCredito`, `editarClienteCredito`, `desactivarClienteCredito`) sin tocarla; se agrego una funcion envoltura `abrirCuentaCreditoDetalle()` que llama a la original y encima pinta avatar, badge de estado y el resumen lateral nuevo.
- Se cambio una sola linea de comportamiento: `abrirCuentaCliente()` ya no oculta la lista de clientes al abrir el detalle, para que la lista y el detalle queden visibles en dos columnas al mismo tiempo (layout persistente, como en la referencia) en vez de alternar entre lista y detalle.
- Simplificaciones frente a la referencia: no hay boton "Filtros" ni "Exportar" separados (no hay logica de exportacion), y no se agrego el banner inferior de "rendimiento y optimizacion aplicada" porque eran afirmaciones de marketing sin nada real detras.

Validacion:

- `node --check` correcto en `server.js`, `credit-customers.js`, `config-auth.js`, `supplier-catalog-view.js`, `shell-topbar.js`.
- Confirmado en el servidor real: la columna se agrego sin error, `PUT /creditos/clientes/:id` guarda `fechaVencimiento` y se refleja en el badge "Vencido" y en la tarjeta "Creditos vencidos".
- Probado en navegador: ambas entradas (dashboard y sidebar) abren la misma pantalla, pestanas Todos/Vencidos/Al dia filtran correctamente, pestanas Movimientos/Informacion/Pagos del detalle funcionan, y modo oscuro se ve correcto.

### Bug real: KPIs de Punto de venta reflejaban el carrito, no las ventas

Reportado por el cliente: despues de completar una venta, "Ventas del dia" y "Ventas del mes" quedaban en $0.00 incluso despues de recargar la pagina.

Causa raiz:

- `actualizarMetricasPOS()` en `public/js/pos-sales.js` pintaba `#posVentasDia`, `#posVentasMes`, `#posProductosVendidos` y `#posTicketPromedio` con el TOTAL DEL CARRITO ACTUAL, no con ventas reales. Al vaciarse el carrito despues de cobrar, esas tarjetas volvian a $0.00 porque nunca estuvieron conectadas a datos historicos.
- Esto no era una regresion de las fases anteriores: la funcion nunca calculo ventas reales, solo reflejaba el carrito en progreso (de ahi que subieran mientras se armaba la venta y se resetearan al cobrar).

Arreglo:

- `public/js/sales-history-documents.js`: nueva funcion `actualizarMetricasPOSReales(historial)` que calcula ventas de hoy, ventas del mes, productos vendidos hoy y ticket promedio a partir de `/historial` (mismos helpers que ya usaba el pulso de ventas del dashboard: `ventasDeFecha`, `fechaVenta`, `mismaFecha`), mas comparativas reales "vs ayer" / "vs mes anterior". Se llama dentro de `cargarHistorial()`, que ya se ejecuta al iniciar sesion, al cargar el POS y despues de cada venta.
- `public/js/pos-sales.js`: se elimino el codigo de `actualizarMetricasPOS()` que sobreescribia esas 4 tarjetas con el total del carrito.
- `public/index.html`: se agregaron ids a los subtitulos de las 4 tarjetas para mostrar la comparativa real en vez de texto fijo.

Investigacion sobre "el ticket tardo mucho en aparecer":

- Se reprodujo el flujo de cobro completo (Cobrar → modal de metodo de pago → Efectivo → confirmar). Se confirmo que cada cobro dispara una revalidacion de licencia (`GET /licencia/estado`) ademas del registro de la venta; es un candidato razonable a la demora si la conexion es lenta, pero no se pudo aislar como causa unica de forma remota.
- No se toco la logica de licencia ni el flujo de metodo de pago (`fase7-pagos.js`) porque son reglas de negocio reales, no un tema de diseno. Si la demora persiste despues de este arreglo, hace falta revisarlo como tema aparte.

Validacion:

- `node --check` correcto en `sales-history-documents.js` y `pos-sales.js`.
- Confirmado en el servidor real: con una venta ya registrada, las 4 tarjetas del POS muestran el monto real desde que se entra a la pantalla (no en $0.00), y agregar/quitar productos del carrito ya no las mueve.

### Rediseno de Recepcion de mercancia

Archivos actualizados:

- `public/js/ferretero-flow.js`
- `public/css/components/receiving.css`
- `public/index.html`

Resultado de fase:

- Respaldo: `backups/before-recepcion-redesign-20260703`.
- Se reescribio la plantilla de `asegurarPantallaRecepcion()` manteniendo todos los ids existentes (`archivoRecepcionMercancia`, `recepcionProveedor`, `recepcionFolio`, `recepcionFecha`, `recepcionTotalConceptos`, etc.) para que las funciones ya probadas (`leerArchivoRecepcionMercancia`, `confirmarRecepcionMercancia`, `conceptosDesdeXml`, `conceptosDesdeCsv`) siguieran funcionando sin cambios.
- Encabezado nuevo con icono, descripcion y 3 insignias (formatos aceptados, vista previa, actualizacion automatica); son solo texto descriptivo del flujo que ya existe, no funciones nuevas.
- Se agrego un selector "Tipo de documento" (Factura/Remision/Nota de credito/Otro) conectado al campo `estadoRecepcion.documento.tipo` que ya existia pero no tenia control en pantalla.
- El diseno se reorganizo a dos columnas: columna principal (formulario del documento + tabla de vista previa) y una barra lateral fija de resumen (KPIs, total, banner de diferencias y acciones), como en la referencia.
- Se agrego buscador de texto, filtro por categoria y boton "Solo diferencias" sobre la tabla de vista previa, ademas de paginacion (5 productos por pagina) reutilizando `renderPaginacion()` (la misma funcion compartida con Inventario/Categorias/Reportes, sin modificarla).
- Se agrego deteccion real de diferencias de precio: `conceptosPreparados()` ahora compara el costo del archivo contra `precio_distribuidor`/`precio` del producto ya existente en inventario (cuando el concepto coincide con un producto) y marca `tieneDiferencia` si la diferencia es de un centavo o mas. El banner "N diferencias detectadas" (o "0 diferencias detectadas" en verde) y el boton "Solo diferencias" usan ese mismo calculo -- no hay datos inventados.
- "Ver ejemplo de archivo" muestra en un dialogo los encabezados de CSV que el parser realmente reconoce (Codigo, Descripcion, Cantidad, Costo, Importe, Unidad, Folio, Fecha, Proveedor) en vez de un archivo de ejemplo descargable que no existe.
- "Imprimir resumen" usa `window.print()` sobre la pantalla actual; no se construyo una plantilla de impresion separada porque no existe un endpoint ni formato de "estado de cuenta" para recepciones.
- Se corrigio que `ocultarTodoRecepcion()` no incluia `"pantallaCreditos"` en su lista de pantallas a esconder (mismo patron de bug ya encontrado y corregido en `ocultarPantallasPrincipales`, `mostrarProveedores` y `mostrarClientes`).
- Se detecto que las reglas de boton ya existentes en `receiving.css` (`.recepcion-header button`, `.btn-recepcion-confirmar`, `.recepcion-preview-head button`) no tenian `!important`, por lo que el bug global (`button{background:var(--brand-color)!important}` en `theme-runtime.css`) probablemente ya las afectaba desde que se crearon; se corrigieron junto con todos los botones nuevos de esta fase.

Simplificaciones frente a la referencia:

- No hay un dropdown de "Metodo de carga" real (arrastrar archivo vs conectar sistema externo); solo existe el flujo de subir un archivo XML/CSV, que es el unico que tiene logica real detras.
- No se agrego lectura de XLSX ni PDF (ya existian avisos informativos para esos casos, se dejaron igual).

Validacion:

- `node --check` correcto en `server.js`, `app.js` y `ferretero-flow.js`.
- Probado en el servidor real con un archivo CSV de prueba (5 conceptos, sin tocar el boton "Confirmar recepcion" para no escribir datos falsos en la base real): el contador de productos, las tarjetas de resumen, el banner de diferencias, el buscador y el boton "Solo diferencias" respondieron correctamente; texto de paginacion "Mostrando 1-5 de 5" correcto. Verificado en modo claro y oscuro.

### Recepcion de mercancia: simplificacion minimalista

El cliente reviso el diseno anterior y pidio "mas minimalista, no tan cargado con botones liquid glass". Se ajusto solo el nivel visual, sin tocar logica:

- Encabezado: se quitaron las 3 insignias con caja/borde; queda solo icono + titulo + un parrafo.
- Botones: se quitaron los degradados y sombras tipo "vidrio". "Confirmar recepcion" ahora es color solido plano sin sombra; "Cancelar" es un boton de borde simple; "Ver ejemplo de archivo" e "Imprimir resumen" pasaron de boton a enlace de texto.
- Barra lateral de resumen: las tarjetas con borde por cada KPI se volvieron una lista separada por lineas delgadas; el "Total" dejo de ser un bloque de color y ahora es texto en negritas sobre una linea divisoria; el banner de diferencias es una sola linea de texto con un punto de color en vez de una tarjeta.
- Se quito el boton "Vista previa de diferencias" (duplicaba el toggle "Solo diferencias" que ya existia en la barra de busqueda).

Validacion: `node --check` correcto; probado en servidor real (carga de CSV, busqueda, banner de diferencias) en modo claro y oscuro, sin cambios de comportamiento.

### Ajustes de inventario: wizard de 3 pasos con usuario y fecha reales

Archivos actualizados:

- `fase4-server.js` (schema + endpoints)
- `public/fase4.js` (reescrito completo; logica de "Pedidos a proveedor" preservada sin cambios, solo reformateada)
- `public/js/shell-topbar.js` (iconos nuevos)
- `public/css/components/inventory-adjustments.css` (nuevo)
- `public/css/components/system-dialogs.css` (fix de word-wrap)
- `public/js/ferretero-flow.js` (fix de un bug relacionado encontrado de paso)
- `public/index.html`, `public/app.js` (cache-busting)

Contexto:

- La pantalla "Ajustes" ya existia y su backend (`/ajustes-inventario`, tabla `ajustes_inventario`) ya era real y funcional -- estaba en `fase4-server.js`, cargado por `server-modules.js`. Lo unico que se redisenio fue el frontend: paso de un formulario de una sola pantalla a un wizard de 3 pasos (Tipo de ajuste -> Detalle -> Confirmacion) mas una bitacora en tabla, igual que la referencia.

Cambio de datos (aprobado explicitamente por el cliente antes de tocarlo):

- La referencia mostraba una columna "Usuario" y un campo "Fecha del ajuste" editable en la bitacora, pero la tabla `ajustes_inventario` no guardaba ninguno de los dos (usaba `created_at` del servidor unicamente). Se agregaron las columnas `usuario_nombre TEXT` y `fecha_ajuste DATE` (aditivo, con `IF NOT EXISTS`, mismo patron que `fecha_vencimiento` en Creditos). `POST /ajustes-inventario` ahora acepta y guarda `usuarioNombre` (tomado de `usuarioActual.nombre` en el cliente, el mismo dato que ya se muestra en la barra superior) y `fecha` (validada con regex `AAAA-MM-DD`, si no es valida usa la fecha del servidor).

Cambio de pantalla:

- El formulario simple (producto + tipo + cantidad + motivo + referencia, todo en un solo paso) se convirtio en un wizard: Paso 1 elige el tipo (Entrada/Salida/Conteo, tarjetas con icono y color) mas motivo (dropdown con opciones reales segun el tipo, con "Otro" para texto libre) y fecha; Paso 2 elige producto y cantidad (mas referencia opcional); Paso 3 muestra un resumen (stock actual, cantidad, stock resultante calculado en el cliente) antes de enviar al mismo endpoint real de siempre.
- La bitacora ahora es una tabla (Fecha, Tipo, Motivo, Descripcion, Usuario, Cantidad, Ver detalle) en vez de tarjetas sueltas; "Descripcion" se genera con una frase corta a partir de tipo+motivo+producto (dato real, no inventado). "Ver todos los ajustes" expande el listado completo (hasta 80, limite que ya tenia el endpoint) sin pedir una pagina nueva al servidor.
- Barra lateral: panel "Que es un ajuste" (texto explicativo fijo) y "Acciones rapidas" con enlaces reales a `mostrarInventario()` y `mostrarInventarioBajo()`.
- Se corrigio que `iconoUISVG("sliders-horizontal")` e `iconoUISVG("clipboard-list")` (usados por el boton del sidebar) no existian en el diccionario de iconos y caian silenciosamente al icono generico "zap"; se reemplazaron por claves validas (`settings`, `file`).
- Bug encontrado de paso: `alertaPOS(mensaje, titulo, tipo)` recibe el mensaje largo primero y el titulo corto despues (el titulo se pinta como encabezado grande, el mensaje como parrafo), pero varias llamadas nuevas en Recepcion y en este wizard tenian los argumentos invertidos; se corrigieron todas. Tambien se agrego `white-space:pre-line` a `.dialogo-pos-body p` en `system-dialogs.css` porque los saltos de linea (`\n`) dentro del mensaje no se estaban respetando.

Simplificaciones frente a la referencia:

- La bitacora sigue registrando un producto por ajuste (igual que el backend real de siempre); "Total de productos" de la referencia se muestra como "Cantidad" del unico producto ajustado, no como conteo de productos distintos (el backend no soporta ajustes con varias partidas en una sola operacion).

Validacion:

- `node --check` correcto en `fase4-server.js`, `public/fase4.js`, `public/js/shell-topbar.js`, `public/js/ferretero-flow.js`, `public/app.js`.
- Probado en el servidor real: flujo completo Paso 1 -> 2 -> 3 -> confirmar. Primero con un producto con stock negativo (el backend rechazo correctamente el ajuste por dejar stock negativo, mensaje de error real). Luego con un ajuste de tipo Conteo, que se aplico con exito y aparecio en la bitacora con fecha, hora, tipo, motivo, descripcion y boton "Ver detalle" funcionando; "Usuario" mostro "Sin registrar" porque la prueba se hizo sin pasar por el login real de la interfaz (no hay usuario de sesion en ese caso), pero el campo esta conectado a `usuarioActual.nombre` para sesiones reales. Verificado en modo claro y oscuro.
- Nota: la prueba en vivo dejo un registro real en la bitacora (ajuste de tipo Conteo) y cambio el stock de un producto de -17 a 8; el cliente confirmo dejarlo asi.

### Bug nuevo descubierto: `button{width:100%}` global en `legacy-layout.css`

Ademas del bug ya conocido de `button{background:var(--brand-color)!important}` en `theme-runtime.css`, se encontro un segundo bug del mismo tipo pero de ancho: `public/css/layers/legacy-layout.css` tiene una regla `button{width:100%; ...}` (sin `!important`, pero suficiente porque los botones nuevos no definian su propio `width`). Esto hacia que botones pensados como "pill" pequenos (toggle "Solo diferencias" en Recepcion, "Continuar"/"Atras" y el enlace "Como funcionan los ajustes" en Ajustes, los botones de periodo y "Exportar" en Reportes) se estiraran al 100% del contenedor. Se corrigio agregando `width:auto` explicito en cada boton nuevo afectado (`.btn-recepcion-diferencias`, `.ajustes-ayuda-link`, `.btn-ajuste-primario`, `.btn-ajuste-secundario`, `.btn-reporte-exportar`, `.reportes-filtros button`). El patron que ya funcionaba (botones dentro de una columna de grid/flex con ancho fijo, como `.btn-recepcion-confirmar`) no se vio afectado porque el contenedor ya limitaba su ancho.

### Bug nuevo descubierto: tokens `--pos-*` solo existen en modo oscuro

Se encontro que `--pos-text`, `--pos-muted`, `--pos-line`, `--pos-surface`, `--pos-surface-strong` y `--pos-shadow` solo estan definidos dentro de `body.oscuro` (`app-shell.css`); en modo claro esas variables no existen. El patron correcto -- ya usado en `fase4.js`/`fase6.js` originales -- es siempre dar un valor de respaldo, ej. `var(--pos-text,#172033)`. Los archivos nuevos de esta sesion (`receiving.css`, `inventory-adjustments.css`, `reports.css`) usaban las variables sin respaldo, lo que dejaba los paneles con fondo transparente y bordes oscuros en modo claro (visualmente parecian "casi bien" porque el color heredado por defecto es oscuro, pero sin el fondo blanco ni el borde gris suave que se buscaba). Se corrigieron las tres hojas agregando el valor de respaldo a las ~110 apariciones de `var(--pos-*)`.

### Reportes / Ventas: comparativas reales y paneles nuevos

Archivos actualizados:

- `server.js` (endpoint `/reportes/ventas`)
- `public/js/reports.js` (reescrito completo)
- `public/index.html`
- `public/app.js` (variable global `graficaMetodosPago`)
- `public/css/components/reports.css` (reescrito completo)

Contexto:

- A diferencia de Ajustes, esta pantalla ya estaba completa y con datos reales (KPIs, grafica de ventas por dia, metodos de pago, productos mas vendidos, horarios, ultimas ventas con paginacion) -- confirmado leyendo `server.js` antes de tocar nada. Lo que la referencia pedia y no existia era: comparativa "vs periodo anterior" en las 4 tarjetas KPI, un cuarto KPI de "Productos vendidos" (antes solo estaba "Venta mayor"), un donut de metodos de pago, un desglose real de "Ventas por categoria" y un panel de "Resumen del periodo" (mejor/peor dia, dias transcurridos, crecimiento).

Cambios reales de backend (aditivos, sin tocar los calculos que ya existian):

- Se agrego `productos_vendidos` (suma de cantidad vendida) al `resumen`, calculado con el mismo patron `LATERAL jsonb_array_elements` que ya usaba `productosVendidos`.
- Se agrego `ventasPorCategoria`: cruza cada producto vendido contra la tabla `productos` actual por `id` para tomar su `categoria` real (mismo criterio ya usado en Inventario/Categorias: refleja la categoria actual del producto, no la que tenia al momento de la venta). Productos sin categoria se agrupan como "Sin categoria" en vez de inventar una.
- Se agrego `resumenAnterior`: mismo calculo que `resumen` pero para el periodo equivalente inmediatamente anterior (ayer si es "dia", semana pasada si es "semana", mes pasado si es "mes", ano pasado si es "ano", o un rango de la misma duracion inmediatamente antes si es un rango con fechas manuales). Con esto las 4 tarjetas KPI y "Crecimiento en ventas" muestran un porcentaje real, no inventado; si el periodo anterior no tuvo ventas se muestra "Nuevo" en vez de un porcentaje sin sentido (division por cero).

Cambios de pantalla:

- KPIs: se quito "Venta mayor" (no estaba en la referencia) y se agrego "Productos vendidos"; las 4 tarjetas ahora muestran una linea de tendencia real ("+12.5% vs periodo anterior", en rojo si baja, verde si sube).
- La grafica de "Ventas por dia" cambio de barras a linea (mismo dato, solo tipo de grafica) para acercarse a la referencia.
- "Metodos de pago" paso de lista compacta a donut (Chart.js) + leyenda con porcentaje real calculado del total del periodo.
- Nuevo panel "Ventas por categoria": barras horizontales con porcentaje real; muestra las primeras 5 categorias con boton "Ver todas las categorias" (hasta 8, limite ya puesto en la consulta) que expande sin pedir datos nuevos al servidor.
- Nuevo panel "Resumen del periodo": "Dias en el periodo" (calculado en el cliente segun el filtro activo), "Mejor dia de ventas" y "Peor dia de ventas" (tomados de los mismos datos de la grafica, sin consulta nueva), "Crecimiento en ventas" (mismo dato que la tarjeta KPI de Ventas totales).
- Se agrego un boton "Exportar" real: genera un CSV en el navegador (resumen + ventas por dia + productos mas vendidos) a partir de los datos ya cargados, sin necesitar un endpoint nuevo.
- Se dejaron "Productos mas vendidos" y "Horarios con mayor venta" (no estan en la referencia, pero ya eran reales y utiles) en una fila aparte debajo, para no competir visualmente con la fila que sí coincide con la referencia.

Validacion:

- `node --check` correcto en `server.js`, `public/js/reports.js`, `public/app.js`.
- Probado en el servidor real con datos reales del ano (139 ventas, $41,163.83): las 4 tarjetas KPI, la grafica de linea, el donut de metodos de pago, las barras de categoria y el resumen del periodo (185 dias, mejor dia 28 de mayo, peor dia 3 de julio, "Nuevo vs periodo anterior" porque el ano anterior no tuvo ventas) mostraron datos correctos. Boton "Exportar" no genero errores. Verificado en modo claro y oscuro.

### Caja: rediseno completo del turno y bitacora

Archivos actualizados:

- `fase6-server.js` (nuevo endpoint auxiliar)
- `public/fase6.js` (reescrito completo)
- `public/fase7-caja-ui.js` (simplificado)
- `public/js/shell-topbar.js` (iconos nuevos, fix de icono roto)
- `public/css/components/cash-register.css` (nuevo)
- `public/app.js`, `public/index.html` (cache-busting)

Contexto:

- Backend ya real y completo: turno (abrir/cerrar), movimientos de caja (entrada/salida), resumen con desglose real por metodo de pago (efectivo/tarjeta/transferencia/credito, tomado de columnas ya existentes en `historial_ventas`), e historial de cortes. Se confirmo que `fase7-caja-ui.js` no era una pantalla aparte sino un overlay que pintaba ese mismo desglose por metodo cada 2 segundos sobre el HTML viejo de Caja.

Cambio real de backend (aditivo):

- Se agrego `resumenAyer` a `GET /caja/turno-activo`: ventas y ticket promedio del dia calendario anterior (no del turno), para poder mostrar el "vs ayer" real del ticket promedio en la referencia. No existia ningun calculo de "ticket promedio" antes; se deriva de `ventas / transacciones` ya reales.

Cambio de pantalla:

- El bloque "Turno abierto #id" se convirtio en una barra de "Sesion activa" con cronometro en vivo (`Tiempo abierta HH:MM:SS`, actualizado cada segundo desde `turno.abierto_at`, solo mientras la pantalla esta visible) y un boton "Cerrar sesion".
- Las 4 tarjetas viejas (Ventas turno/Esperado efectivo/Entradas/Salidas) se reemplazaron por 5 tarjetas reales: Efectivo en caja, Tarjeta, Transferencia, Total ventas del dia, Ticket promedio (con comparativa real "vs ayer").
- "Abrir turno" gano un campo "Motivo de apertura" (dropdown con opciones + "Otro"); como el backend solo tiene un campo `notas` libre, el motivo elegido se concatena al frente de las notas reales -- no se agrego columna nueva porque no hacia falta cambiar el esquema para esto.
- "Cerrar turno" se convirtio en un modal (antes era un panel fijo siempre visible); reutiliza los mismos 4 campos reales (efectivo/tarjeta/transferencia/credito contado) y notas.
- Nuevo modal "Ver historial de cajas" (botón en el encabezado) que lista los cortes reales (`GET /caja/cortes`) en una tabla con apertura, responsable, estado, ventas, esperado y diferencia.
- "Movimientos recientes" ahora es una lista con icono por tipo (entrada/salida), con "Ver todos" que expande sin pedir datos nuevos al servidor (el endpoint ya regresaba hasta 80).
- Acciones rapidas: "Ver reporte de ventas" (real, `mostrarGraficas()`), "Ver movimientos de caja" (hace scroll y expande la lista), "Hacer corte de caja" (abre el modal de cierre).
- Se corrigio que el icono del boton "Caja" en el sidebar usaba la clave `"banknote"`, que no existe en el diccionario de iconos (caia silenciosamente al icono generico); se cambio a `"wallet"`.
- Se simplifico `fase7-caja-ui.js`: ya no crea una caja de metodos de pago aparte ni hace polling cada 2 segundos (esos datos ahora se muestran directamente en las tarjetas KPI de Caja); solo queda como un alias de compatibilidad para que `pos-sales.js` (que llama `window.refrescarCaja7Metodos()` justo despues de cada venta) siga refrescando la pantalla de Caja en tiempo real.

Simplificaciones frente a la referencia:

- No existe un concepto real de "Devoluciones"; la fila correspondiente del "Corte de caja rapido" de la referencia se omitio en vez de inventarla.
- "Categoria/Concepto" en el formulario de movimiento es un campo de texto con sugerencias (datalist), no una lista fija en el backend -- el campo real siempre fue texto libre.

Validacion:

- `node --check` correcto en `fase6-server.js`, `public/fase6.js`, `public/fase7-caja-ui.js`, `public/js/shell-topbar.js`, `public/app.js`.
- Probado en el servidor real con un turno abierto real ya existente: las 5 tarjetas KPI mostraron datos reales, se registro un movimiento de entrada real ($50, "Cambio menudo") y aparecio de inmediato en "Movimientos recientes" y en "Turno en curso"; el modal de "Ver historial de cajas" mostro el corte real; el modal de "Cerrar sesion" se abrio y se cerro sin confirmar el cierre (para no terminar el turno real durante la prueba). Verificado en modo claro y oscuro.

### Finanzas: ingresos reales, utilidad neta y cuentas por cobrar desde Creditos

Archivos actualizados:

- `fase5-server.js` (nuevos calculos y endpoints)
- `public/fase5.js` (reescrito completo)
- `public/css/components/finance.css` (nuevo)
- `public/app.js`, `public/index.html` (cache-busting)

Contexto:

- Antes de tocar nada se confirmo que Finanzas solo llevaba gastos operativos, cuentas por pagar y pagos a proveedor -- nunca tocaba `historial_ventas`, por lo que no existia "Ingresos", "Utilidad neta" ni "Cuentas por cobrar". La referencia pedia las tres cosas.

Cambios reales de backend (aditivos, ninguno cambia una tabla ni una regla de negocio existente):

- `GET /finanzas/resumen` ahora acepta `periodo`/`desde`/`hasta` (mismo patron que Reportes) y agrega: `ingresos` (SUM real de `historial_ventas.total` en el periodo), `utilidad_neta` (ingresos - gastos), `balance_disponible` (utilidad neta menos cuentas por pagar pendientes -- formula documentada aqui, no es un saldo bancario real sino una aproximacion), `cuentas_por_cobrar` y `clientes_por_cobrar` (tomados de `clientes_credito` + `movimientos_credito`, el mismo calculo de saldo que ya usa la pantalla de Creditos), y `anterior` (ingresos/gastos/utilidad del periodo equivalente anterior, para las comparativas "vs periodo anterior").
- Nuevo `GET /finanzas/resumen-por-dia`: ingresos y gastos agrupados por dia (para la grafica) y gastos agrupados por categoria (para el donut) -- mismo patron que ya se uso en Reportes para ventas por categoria.
- Nuevo `GET /finanzas/cuentas-por-cobrar`: lista de clientes con saldo de credito pendiente (saldo > 0), con su `fecha_vencimiento` real, ordenados por vencimiento. Es una lectura de los mismos datos que usa Creditos, no una tabla ni un concepto nuevo.

Cambio de pantalla:

- 5 tarjetas KPI: Ingresos totales, Gastos totales y Utilidad neta ahora muestran comparativa real "vs periodo anterior" (mismo patron que Reportes); Cuentas por pagar muestra "N cuentas pendientes" (real); Balance disponible muestra el texto fijo "Despues de gastos y pagos" porque es una formula derivada, no una cifra de banco real.
- Se agrego un filtro de periodo (Dia/Semana/Mes/Ano/rango, igual que Reportes) -- antes Finanzas solo mostraba "este mes" sin poder cambiarlo.
- Nueva grafica "Resumen financiero" (linea: Ingresos/Gastos/Utilidad por dia) y nuevo donut "Gastos por categoria" (reutiliza las categorias reales que ya existian en el formulario de gastos: General/Renta/Servicios/Nomina/Flete/Mantenimiento).
- "Cuentas por pagar" paso de tarjetas sueltas a tabla (Proveedor/Factura-Concepto/Vencimiento/Monto/Estado + boton Pagar), con "+ Nueva cuenta" que abre un modal (antes era un formulario siempre visible en la pantalla).
- Nuevo panel "Cuentas por cobrar" (Cliente/Vencimiento/Monto/Estado), con un enlace "Ir a creditos" que navega a la pantalla real de Creditos en vez de duplicar su edicion aqui.
- "Nuevo gasto" tambien paso a modal.
- Acciones rapidas: "Registrar gasto" (abre el modal real), "Ver ventas del periodo" (real, `mostrarGraficas()`), "Pagar proveedor" (toma la primera cuenta pendiente real y reutiliza el flujo de pago ya existente), "Ver flujo de efectivo" (real, navega a Caja), "Generar reporte financiero" (exporta un CSV real generado en el navegador con los datos ya cargados, sin backend nuevo).
- Se mantuvieron "Gastos recientes" y "Pagos a proveedores recientes" (ya reales, no estan en la referencia) como una fila secundaria debajo, para no perder funcionalidad existente.

Simplificaciones frente a la referencia:

- No existe "Registrar ingreso" como accion manual -- los ingresos solo pueden venir de ventas reales registradas en el POS, no se fabrico un formulario para capturar ingresos a mano.
- "Balance disponible" es una formula derivada (utilidad neta - cuentas por pagar pendientes), documentada arriba; no representa un saldo bancario real porque este sistema no esta conectado a ninguna cuenta bancaria.

Validacion:

- `node --check` correcto en `fase5-server.js`, `public/fase5.js`, `public/app.js`.
- Probado en el servidor real: las 5 tarjetas KPI, la grafica de linea y el donut de categorias respondieron con datos reales; "Cuentas por cobrar" mostro un cliente real con saldo vencido (mismo dato que ya se ve en Creditos). Se registro un gasto de prueba real ($15, "Prueba de diseno") para verificar el flujo de extremo a extremo -- la utilidad neta se recalculo correctamente a partir de ese gasto. Se probo "Pagar proveedor" (mostro correctamente que no hay cuentas pendientes) y "Exportar" (genero el CSV sin errores). Verificado en modo claro y oscuro.
- Nota: la prueba en vivo dejo un gasto real registrado ($15.00, categoria General, concepto "Prueba de diseno - bolsas para mostrador") en la base de datos real; queda pendiente que el cliente confirme si lo deja o prefiere que se elimine manualmente (no hay endpoint de borrado de gastos).

### Bug real: Finanzas reaparecia sola al navegar a otra pantalla

Reportado por el cliente con capturas: al abrir Finanzas y luego hacer clic en Pedidos, Finanzas desaparecia un instante y luego volvia a aparecer encima de Pedidos.

Causa raiz (no tenia nada que ver con los arreglos de diseno de esta sesion):

- `public/fix-navegacion.js` es un parche ya existente que envuelve las funciones `mostrarX` de todas las pantallas para, ademas de esconder/mostrar la pantalla correspondiente al momento del clic, volver a forzar esa misma visibilidad una vez que la promesa de esa pantalla se resuelve (`setTimeout(() => show(id), 80)` para las pantallas "dinamicas": Recepcion, Pedidos, Ajustes, Caja, Finanzas).
- Finanzas hace 6 peticiones seguidas (`resumen`, `resumen-por-dia`, `cuentas-pagar`, `cuentas-por-cobrar`, `gastos-operativos`, `pagos-proveedor`) antes de resolver su promesa. Si el usuario navegaba a otra pantalla (por ejemplo Pedidos) mientras esas peticiones todavia estaban en curso, la promesa de Finanzas terminaba *despues*, y el `setTimeout` disparaba `show("pantallaFinanzas")` sin saber que el usuario ya se habia movido a otra pantalla -- la traia de vuelta encima de lo que fuera que estuviera abierto en ese momento.
- Esto ya era un riesgo latente desde que existian pantallas "dinamicas" con carga de datos lenta; se hizo mas facil de reproducir en esta sesion porque el nuevo Finanzas quedo con mas peticiones secuenciales que antes (antes solo cargaba resumen + cuentas + gastos).

Arreglo:

- Se agrego un "token de navegacion" en `fix-navegacion.js`: cada vez que se muestra cualquier pantalla (dinamica o de las de siempre) se marca un numero de turno nuevo. Los `setTimeout` retrasados (el "re-esconder" de 40ms y el "re-mostrar" de 80ms) ahora comprueban que el turno siga siendo el mismo antes de actuar; si el usuario ya navego a otra pantalla mientras tanto, se cancelan solos.

Ademas, aprovechando que ya estaba revisando esto, se corrigio el mismo patron de bug de "lista de pantallas a esconder incompleta" (ya encontrado varias veces esta sesion) en los lugares que todavia le faltaban `pantallaCaja`/`pantallaFinanzas` (y en algunos casos tambien `pantallaRecepcionMercancia`/`pantallaPedidosProveedor`/`pantallaAjustesInventario`):

- `public/js/config-auth.js`: `ocultarPantallasPrincipales()` (la funcion compartida que usan Inventario, Categorias, Punto de venta, Reportes, Configuracion) ahora incluye las 5 pantallas dinamicas.
- `public/js/sales-history-documents.js`: `mostrarInicio()` ya no repite una lista de `.style.display="none"` a mano; ahora llama a `ocultarPantallasPrincipales()`.
- `public/js/credit-customers.js`: `mostrarClientes()` -- mismo cambio.
- `public/js/supplier-catalog-view.js`: `mostrarProveedores()` -- mismo cambio.
- `public/fase4.js`: `ocultar()` (Pedidos/Ajustes) ahora incluye `pantallaCaja`/`pantallaFinanzas`.
- `public/js/ferretero-flow.js`: `ocultarTodoRecepcion()` ahora incluye `pantallaPedidosProveedor`/`pantallaAjustesInventario`/`pantallaCaja`/`pantallaFinanzas`.

Validacion:

- `node --check` correcto en los 8 archivos tocados.
- Se reprodujo la carrera exacta en el servidor real: se disparo `mostrarFinanzasPOS()` sin esperar su resolucion, se navego de inmediato a `mostrarPedidosProveedor()`, y se espero 1.8 segundos (mas que suficiente para que las 6 peticiones de Finanzas terminaran). Antes del arreglo, Finanzas volvia a aparecer; despues del arreglo, Pedidos se quedo visible y Finanzas permanecio oculta. Tambien se probaron las combinaciones Caja&harr;Clientes, Finanzas&harr;Proveedores, Ajustes&harr;Reportes, Reportes&harr;Inventario y Recepcion&harr;Inicio sin que ninguna pantalla quedara mal escondida.

### Pedidos a proveedor: estadisticas reales y bitacora con estado

Archivos actualizados:

- `public/fase4.js` (seccion de Pedidos reescrita; Ajustes no se toco)
- `public/css/components/purchase-orders.css` (nuevo)
- `public/index.html`, `public/app.js` (cache-busting)

Contexto:

- El backend de Pedidos (`fase4-server.js`: `/pedidos-proveedor` GET/POST, `/pedidos-proveedor/:id`, `/pedidos-proveedor/:id/recepciones`) ya era real y completo desde antes de esta sesion; no se toco. Solo se redisenio el frontend y se agregaron calculos nuevos en el cliente a partir de los datos ya reales.

Cambios:

- El campo "Proveedor" paso de texto libre a un combo con sugerencias (datalist) poblado con `GET /proveedores` reales, sin perder la libertad de escribir un proveedor nuevo.
- Se agrego una fila de 4 tarjetas de estadisticas (Pedidos este mes, Total compras, Pendientes, Recibidos hoy), calculadas en el cliente a partir de la lista de pedidos ya cargada -- ningun dato inventado ni endpoint nuevo.
- La lista de "Pedidos recientes" ahora muestra un badge de estado real (Borrador/Enviado/Parcial/Recibido/Cancelado) y un boton "Ver todos" que expande sin pedir datos nuevos al servidor.
- Se corrigieron 6 llamadas a `alertaPOS`/`confirmarPOS` con el orden de argumentos invertido (mismo bug de convencion `alertaPOS(mensaje, titulo, tipo)` ya corregido varias veces esta sesion en otras pantallas) que quedaban de la version original de este archivo.

Validacion:

- `node --check` correcto en `public/fase4.js`.
- Probado en el servidor real: datalist de proveedores con datos reales, agregar producto a un pedido de prueba (sin guardarlo), tabla con "Total de productos" y "Total" correctos, boton "Recibir" con badge "Enviado" visible sobre un pedido real existente. Verificado en modo claro y oscuro.

### Proveedores: filtro de estado real (Activo/Baja) y paginacion

Archivos actualizados:

- `server.js` (`GET /proveedores` acepta `?estado=`, nuevo `PUT /proveedores/:id/activar`)
- `public/js/supplier-catalog-view.js`
- `public/css/components/suppliers.css` (reescrito con tokens de diseno)
- `public/index.html`, `public/app.js` (cache-busting)

Contexto:

- La pantalla ya tenia casi toda la estructura de la referencia (tarjetas de resumen, buscador, tabla) desde una fase anterior del refactor; lo que faltaba era el filtro "Estado: Activo / Baja" y la paginacion, ademas de que el estilo de botones seguia siendo solido/antiguo en vez del estilo de borde usado en el resto de pantallas rediseñadas esta sesion.

Cambio real de backend (aditivo):

- `GET /proveedores` antes SIEMPRE filtraba `activo = true`, por lo que los proveedores dados de baja no se podian ver ni reactivar desde la interfaz. Se agrego el parametro `?estado=activo|baja` para elegir cual lista pedir.
- Se agrego `PUT /proveedores/:id/activar` (mismo patron que el soft-delete de `DELETE /proveedores/:id`, pero en sentido inverso) para poder reactivar un proveedor dado de baja.

Cambios de pantalla:

- Filtro "Estado: Activo | Baja" real, conectado al nuevo parametro del backend; al ver "Baja" las acciones cambian de Productos/Editar/Baja a un solo boton "Reactivar".
- Paginacion real con `renderPaginacion()` (mismo helper compartido de Inventario/Categorias/Reportes/Ajustes) y texto "Mostrando X a Y de Z proveedores".
- Botones de accion (Productos/Editar/Baja/Reactivar) cambiaron de relleno solido a estilo de borde (outline), igual que el resto de pantallas rediseñadas esta sesion.

Validacion:

- `node --check` correcto en `server.js`, `public/js/supplier-catalog-view.js`.
- Probado en el servidor real: filtro "Baja" mostro correctamente "No hay proveedores para mostrar" (no hay ninguno dado de baja todavia); "Activo" siguio mostrando el proveedor real existente. Verificado en modo claro y oscuro.

### Configuracion: rediseno visual minimalista (sin cambios de datos)

Archivos actualizados:

- `public/css/components/config-settings.css`
- `public/index.html` (cache-busting)

Contexto:

- A diferencia de las otras dos pantallas, aqui NO se toco nada de logica ni de datos: los 6 tabs (Empresa, Apariencia, Ticket, Hardware, Usuarios, Sistema) ya eran completamente reales (todo se guarda en `localStorage` y se aplica de verdad: nombre/logo/color al sidebar y ticket, tema claro/oscuro, diseno de ticket con vista previa en vivo, impresora/cajon, usuarios y permisos, moneda/giro/duracion de sesion). Se confirmo con una investigacion dedicada antes de tocar nada.
- La referencia del cliente muestra 4 campos que HOY NO EXISTEN en el sistema (ventas a credito, confirmacion para eliminar, control de inventario en tiempo real, redondeo de totales, respaldos) -- se decidio NO fabricarlos como toggles decorativos sin efecto real, siguiendo el mismo criterio de honestidad de todo el refactor. Tampoco se agregaron "color secundario/acento" ni "estilo de botones/menu" porque no existen ni se aplican en ningun lado.

Cambios (solo visuales):

- Encabezado: de una tarjeta con degradado azul y sombra pesada a un encabezado plano con borde inferior, igual que Ajustes/Recepcion/Caja/Finanzas/Pedidos/Proveedores.
- Tabs: de píldoras con fondo difuminado (`backdrop-filter: blur`) y el tab activo en degradado, a una barra de pestañas plana con subrayado de color en la activa.
- Tarjetas de cada tab: sombra pesada reducida a borde delgado.
- Se quitaron los degradados de "Vista rapida" (Apariencia), la vista previa del ticket, y la zona de "Restablecer configuracion inicial".
- Se confirmo que los tokens de color que usa esta pantalla (`--surface`, `--surface-soft`, `--line-soft`, `--text-main`, `--text-muted`, definidos en `design-system.css`/`theme-runtime.css`) SI tienen valores reales para modo claro y oscuro (a diferencia del bug de `--pos-*` encontrado antes en Recepcion/Ajustes/Reportes), asi que no hizo falta agregar valores de respaldo aqui.

Validacion:

- Probado en el servidor real recorriendo los 6 tabs (Empresa, Apariencia, Ticket, Hardware, Usuarios, Sistema): todos renderizan correctamente con el estilo plano nuevo, la vista previa del ticket sigue funcionando en vivo, la lista de usuarios reales (Gustavo/Administrador, Caja/Cajero) se ve correcta. Verificado en modo claro y oscuro. No se probo "Guardar cambios" para no alterar la configuracion real del negocio durante la prueba.

### Correccion de 3 bugs reportados en produccion (Catalogo proveedor, Inventario bajo, Creditos)

Reportados por el usuario tras su primera visita real al sitio ya desplegado en Render.

Archivos actualizados:

- `public/js/low-stock.js`
- `public/js/supplier-catalog-view.js`
- `public/js/credit-customers.js`
- `public/css/components/pos-credit-modal.css`
- `public/index.html` (cache-busting)

**Bug 1 -- "Catalogo proveedor" e "Inventario bajo" no hacian nada al hacer clic.**

Causa real: ambas funciones (`mostrarCatalogo`, `mostrarInventarioBajo`) se llamaban desde el sidebar, `fix-navegacion.js` y `shell-topbar.js` en varios lugares, pero **nunca estuvieron definidas en ningun archivo del proyecto** -- confirmado por busqueda exhaustiva. No es una regresion de esta sesion, es un bug preexistente y silencioso (nunca funcionaron). Se agrego `window.mostrarInventarioBajo` en `low-stock.js` (reutiliza `renderInventarioBajo()`/`productosBajoStock()` ya existentes) y `window.mostrarCatalogo` en `supplier-catalog-view.js` (reutiliza `asegurarPantallaCatalogo()`/`renderCatalogosProveedor()` ya existentes), siguiendo el mismo patron de las demas pantallas: `ocultarPantallasPrincipales()` + mostrar la pantalla + `actualizarTopbarContexto()`.

**Bug 2 -- Al abrir Creditos, la barra superior y el sidebar seguian marcando "Ajustes" (la ultima pantalla abierta antes).**

Causa real: `mostrarCreditos()` en `credit-customers.js` mostraba la pantalla de Creditos pero nunca llamaba a `actualizarTopbarContexto()`, la funcion que actualiza el titulo/subtitulo de la barra superior y el resaltado activo del sidebar (esta ultima internamente vía `actualizarModuloActivoPOS()`). El resto de pantallas de la app si la llaman; a esta se le habia quedado fuera. Se agrego la llamada correspondiente justo despues de mostrar la pantalla.

**Bug 3 -- Tabla de "Movimientos" dentro del detalle de un cliente de credito se veia "muy apretada".**

Causa real, distinta a lo que parecia a simple vista: no era solo un tema de relleno de celdas, sino que `.credito-detalle-cuerpo` repartia el panel de detalle en dos columnas lado a lado (tabla + tarjeta de resumen lateral con fecha de creacion, vencimiento, y botones de accion), y esa tarjeta lateral tomaba hasta 320px fijos de un contenedor que en un monitor tipico de 1440px de ancho solo tenia ~600px disponibles para todo el bloque -- dejando la tabla de 6 columnas en apenas ~220-270px reales de ancho. Se cambio `.credito-detalle-cuerpo` de dos columnas a una sola columna (la tabla ahora usa todo el ancho disponible del panel, ~550-600px, y la tarjeta de resumen queda debajo en vez de al lado), y se agregaron anchos de columna proporcionales (`Fecha 12% / Tipo 10% / Referencia 16% / Concepto 32% / Monto 15% / Saldo 15%`) mas relleno de celda (`12px 10px`) y `overflow-wrap: break-word` (en vez de `anywhere`, que rompia palabras a la mitad) solo dentro de `.movimientos-cliente .tabla-creditos`, sin afectar la tabla de "Pagos" que comparte la misma clase pero tiene solo 4 columnas.

Validacion:

- `node --check` correcto en los 3 archivos JS editados.
- Probado en el servidor real (misma base de datos de produccion) iniciando sesion, navegando a Catalogo proveedor e Inventario bajo desde el sidebar (ambos abren correctamente y el sidebar/topbar reflejan la pantalla activa), y abriendo Creditos -> cliente real "diego" ($828.00, estado Excedido) para confirmar que el topbar/sidebar ya marcan "Creditos" y que la tabla de Movimientos se ve con columnas legibles y espaciado comodo. Verificado en modo claro y oscuro.

### Notificaciones (contraste + boton "Ver"), cambio de rol de usuario, y rediseno de Inicio

Reportados/solicitados por el usuario en una sola sesion de seguimiento tras usar el POS ya desplegado.

Archivos actualizados:

- `public/css/components/support-reminders.css`
- `public/js/shell-topbar.js`
- `public/js/config-auth.js`
- `public/css/components/config-settings.css`
- `public/index.html`
- `public/js/app-bootstrap.js`
- `public/css/components/dashboard.css`
- `public/css/components/dashboard-alerts.css`

**Notificaciones demasiado transparentes.** Causa real: `--pos-surface-strong`, `--pos-text`, `--pos-muted` y `--pos-line` se usaban sin valor de respaldo en `support-reminders.css` (panel de notificaciones, tarjetas de notificacion, modal de recordatorio, modal de contacto al desarrollador). Esas variables solo tienen valor dentro de `body.oscuro` (definidas en `app-shell.css`); en modo claro no resuelven a nada, asi que el panel quedaba con fondo transparente dejando ver el contenido de atras -- el mismo patron de bug ya encontrado varias veces esta sesion en otras pantallas. Se agrego el valor de respaldo correspondiente (`var(--pos-surface-strong, #ffffff)`, etc.) en cada uso dentro de este archivo.

**Boton "Ver" de una notificacion no hacia nada.** Causa real, mas sutil que un simple mismatch de nombres: en `shell-topbar.js`, `renderNotificacionesPOS()` armaba el atributo `onclick` metiendo el resultado de `JSON.stringify(...)` (que envuelve el string en comillas dobles) dentro de un atributo HTML que tambien usaba comillas dobles (`onclick="..."`). Esas comillas dobles internas rompian el HTML del atributo a la mitad, dejando un `onclick` truncado e invalido -- el boton se veia normal pero al hacer clic no ejecutaba nada (ni se veia el error en consola, porque el atributo simplemente quedaba mal formado desde que se genera el HTML). Se corrigio reemplazando las comillas dobles crudas por la entidad HTML `&quot;` (que el navegador si decodifica correctamente dentro de un atributo sin romperlo), tanto para el boton "Ver" de alertas de inventario/credito como para el boton de check de recordatorios, que tenia exactamente el mismo problema.

**No se podia cambiar el rol de un usuario ya creado (ej. a "Cajero"/Caja).** Causa real: el modal de "Permisos" (`abrirPermisosUsuario`/`guardarPermisosUsuario` en `config-auth.js`) solo editaba los checkboxes de modulos y tarjetas, nunca el campo `usuario.rol` -- el rol solo se definia una vez, al crear el usuario, y no existia ninguna forma de cambiarlo despues. Se agrego una seccion "Rol del usuario" (select Cajero/Inventario/Administrador) al inicio del modal de Permisos: al cambiar el select se recalculan automaticamente los checkboxes segun la plantilla de ese rol (`plantillaUsuario()`, ya existente) para que el administrador pueda revisar/ajustar antes de guardar, y al guardar se actualiza `usuario.rol` junto con sus permisos y widgets. El administrador principal (id `admin`) no puede cambiar su propio rol (se muestra una nota en vez del select), para evitar que el negocio se quede sin ningun usuario Administrador.

**Rediseno de Inicio.** El usuario pidio rediseñar la pantalla de Inicio sin dar una referencia especifica ("usa tu criterio"). Se aplico el mismo lenguaje visual ya usado en el resto del POS esta sesion:
- Se agregaron insignias de icono a color (mismo patron que las tarjetas de resumen de Creditos/Reportes) a las 4 tarjetas KPI (Productos, Inventario bajo, Ultimas ventas, Credito pendiente), inyectadas via `iconoUISVG()` desde `actualizarDashboard()` en vez de SVG crudo en el HTML.
- Se quito el boton "Modo claro/oscuro" propio del dashboard (`#btnModoDashboard`), redundante con el toggle de tema que ya existe en la barra superior compartida desde el rediseno del shell; se confirmo que `actualizarBotonModo()` ya maneja su ausencia sin errores.
- Se aplanaron las sombras pesadas (`box-shadow` de 14-32px) de las tarjetas del dashboard a solo borde, igual que Finanzas/Recepcion/Caja/Ajustes/Pedidos (todas esas pantallas ya usan cero `box-shadow`).
- Se reescribio `dashboard-alerts.css`: el archivo tenia dos capas de reglas duplicadas literalmente tituladas "liquid glass" y "compactas finales" con `backdrop-filter: blur()` y fondos translucidos; se consolido en un solo set de reglas planas con fondo solido, sin blur, con su propia variante de modo oscuro.
- Se elimino CSS muerto: `#inventarioBajo > div` / `.alerta-dashboard-item` (una clase que ya no genera ningun `mostrarInventarioBajo`/`actualizarInventarioBajo` desde que las alertas usan `.alerta-inventario-card`).

Validacion:

- `node --check` correcto en `public/js/shell-topbar.js`, `public/js/config-auth.js`, `public/js/app-bootstrap.js`.
- Probado en el servidor real (misma base de datos de produccion): panel de notificaciones ahora con fondo solido y legible en claro/oscuro; boton "Ver" de la notificacion "Mirilla de seguridad de cromo" (producto real con stock bajo) confirmado -- abre Inventario bajo con el buscador ya filtrado a ese producto exacto; cambio de rol del usuario real "Caja" de Cajero a Administrador y de vuelta a Cajero, confirmando que los permisos/widgets se recalculan y persisten en `localStorage`; usuario "admin" confirmado sin opcion de cambiar de rol. Inicio verificado en escritorio (1440px), tablet (768px) y modo claro/oscuro -- las 4 tarjetas KPI con icono, la grafica de ventas del dia, las alertas de inventario y la lista de ultimas ventas siguen funcionando con datos reales.

### Escaner de codigo de barras duplicando cantidades, y tabla de Inventario con texto encimado

Reportados por el usuario con capturas reales de su POS en produccion.

Archivos actualizados:

- `public/js/pos-sales.js`
- `public/css/components/inventory.css`
- `public/index.html`

**Escaner USB sumaba de 2 en 2 (1, 3, 5, 7...) en vez de 1, 2, 3, 4.** Causa real: un codigo escaneado se procesa por **dos caminos independientes al mismo tiempo**. El primero es `scanner-usb.js`, que captura las teclas a nivel de `document` y al detectar Enter llama a `procesarCodigoBarrasPos()` de inmediato. El segundo es el buscador de productos (`#busqueda`): como el listener de `scanner-usb.js` deja pasar la escritura normal cuando el campo activo es justo `#busqueda` (para no bloquear busquedas manuales por teclado), cada tecla que el lector "escribe" ahi tambien dispara `buscarProductos()` -> `programarLecturaCodigoBarras()`, que agenda su **propia** llamada a `procesarCodigoBarrasPos()` 220ms despues. Resultado: el mismo codigo se procesaba dos veces (una al instante por el Enter, otra 220ms despues por el debounce del buscador), sumando el producto por partida doble. Coincide con lo que reporto el usuario: el primer escaneo del dia (antes de que `#busqueda` tuviera el foco) entraba una sola vez; desde el segundo escaneo en adelante (con el campo ya enfocado por el escaneo anterior) empezaba a duplicar. Se agrego una proteccion de 700ms en `procesarCodigoBarrasPos()`: si el mismo codigo ya se proceso hace menos de 700ms, la segunda llamada se ignora (sin bloquear un reescaneo real y deliberado del mismo producto mas tarde).

**Tabla de Inventario: el nombre del producto se encimaba con las columnas de Categoria y Precio.** Se confirmo que era un bug real (no solo la foto borrosa) reproduciendolo en el navegador con el mismo producto ("Encendedor para cocina, de arco electrico, 23 cm, TRUPER"). Causa real: `.producto-inventario-celda` es un contenedor `display:flex` (icono + nombre), y el `<div>` que envuelve el nombre no tenia `min-width:0`. Por especificacion, un elemento flex no se encoge por debajo del ancho de su contenido a menos que se le indique `min-width:0` explicitamente; como el nombre tiene `white-space:nowrap`, el navegador lo dejaba con su ancho completo (385px medidos) sin importar que la celda de la tabla solo media 264px, desbordandose sobre las columnas siguientes en vez de recortarse con "...". Se agrego `min-width:0` al div contenedor. De paso se encontro y corrigio un bug de contraste en modo oscuro sin relacion con el reporte: el nombre del producto (`.producto-inventario-celda strong`) no tenia ninguna regla de color para `body.oscuro`, quedando en azul marino oscuro sobre fondo oscuro (illegible); se agrego el color claro correspondiente.

Validacion:

- `node --check` correcto en `public/js/pos-sales.js`.
- Probado en el servidor real (misma base de datos de produccion): dos llamadas seguidas a `procesarCodigoBarrasPos()` con el mismo codigo de un producto real (id 42) dejaron la cantidad en 1 (antes hubiera quedado en 2); una tercera llamada pasados 750ms si sumo una unidad mas, confirmando que un reescaneo deliberado del mismo producto sigue funcionando. Tabla de Inventario probada buscando "ence": el nombre ahora se recorta con "..." dentro de su columna sin invadir Categoria/Precio/Stock/Estado, verificado en modo claro y oscuro.

### Rediseno de la pantalla de inicio de sesion

El usuario mando una imagen de referencia (mockup de dos columnas: marca/beneficios a la izquierda, formulario a la derecha) y pidio que el login se viera asi.

Archivos actualizados:

- `public/index.html`
- `public/css/components/auth-login.css` (reescrito completo)
- `public/js/config-auth.js`
- `public/js/app-bootstrap.js`
- `public/js/shell-topbar.js` (se agregaron iconos `lock`, `user`, `eye`, `eyeOff` al diccionario `iconoUISVG()`)

Contexto y honestidad de la implementacion (varios elementos de la referencia no tenian una funcion real detras, siguiendo el mismo criterio del resto del refactor):

- El panel izquierdo (marca, eslogan, 3 beneficios con icono) reutiliza los datos reales del negocio (`loginMarcaNegocio`, ya poblado por `aplicarConfiguracionNegocio()`) en vez de un texto generico fijo; el eslogan grande ("Tu negocio, bajo control.") es copy nuevo pero generico y honesto (no promete nada que el sistema no haga).
- El campo "Codigo del negocio" (real, ya autollenado con `negocioActivoSlug()`) se conservo pero con menor peso visual, en vez de quitarlo, porque sigue siendo necesario para el flujo de login.
- La referencia traia "¿Olvidaste tu contraseña?" y "Iniciar con codigo" (QR): ninguno de los dos existe en este sistema (no hay recuperacion de contrasena por correo, ni login por QR). En vez de fabricar botones decorativos sin funcion, se reemplazo "¿Olvidaste tu contraseña?" por "¿Necesitas ayuda para entrar?", que abre el modal real de "Contacto del desarrollador" (`abrirContactoDesarrolladorPOS()`, ya usado en la barra superior) -- mismo proposito (ayuda cuando no puedes entrar), pero conectado a algo que si existe. "Iniciar con codigo" se omitio por completo.
- "Recordar sesion" si se conecto a comportamiento real: antes, `iniciarSesion()` siempre llamaba `guardarSesionPersistente()` sin importar nada; ahora, si el checkbox (marcado por defecto, para no cambiar el comportamiento de nadie que no lo toque) esta desmarcado, se limpia la sesion guardada en vez de persistirla, asi que la proxima vez que se abra el POS pedira iniciar sesion de nuevo.
- Se agrego un boton de mostrar/ocultar contrasena (`alternarVerPasswordLogin()`), funcional de verdad (cambia el `type` del input entre `password`/`text`).
- El pie con "Conexion segura" y version usa el numero real de version (`VERSION_NEXO_POS`, la misma constante que ya se muestra en el pie del sidebar).

Bug de CSS encontrado y corregido en el camino: varias reglas globales con `!important` en `theme-runtime.css` (`h1,h2,h3,h4{color:var(--text-main)!important}` y `button{background:var(--brand-color)!important;color:white!important}`, el mismo patron de "selector de etiqueta suelta con !important" ya encontrado varias veces esta sesion) forzaban el titulo "Iniciar sesion" a texto oscuro invisible sobre el fondo oscuro del login, y convertian el boton de mostrar/ocultar contraseña en una pastilla solida azul en vez de un icono discreto. Se agregaron los `!important` correspondientes en las clases nuevas y mas especificas del login para ganarles a esas reglas globales.

Validacion:

- `node --check` correcto en `public/js/config-auth.js`, `public/js/shell-topbar.js`, `public/js/app-bootstrap.js`.
- Probado en el servidor real: inicio de sesion completo funcional (usuario real "Gustavo", PIN real), boton de mostrar/ocultar contraseña alterna el campo correctamente, "¿Necesitas ayuda para entrar?" abre el modal real de contacto al desarrollador, checkbox "Recordar sesion" probado en ambos estados. Verificado en escritorio (1440px, 920px) y tablet (768px).

**Actualizacion:** el despliegue automatico de Render que se habia detenido (ver nota de la seccion anterior) ya fue reactivado manualmente por el usuario desde el panel de Render; confirmado antes de subir este cambio.

Se agrego ademas el logo real de "Nexo POS" (`public/nexo-pos-logo.jpg`, el mismo archivo del mockup de referencia) como credito "Con la tecnologia de" al pie del panel izquierdo -- se dejo como credito secundario y no como la marca principal del login, porque la marca principal de esa pantalla sigue siendo la del negocio activo (`loginMarcaNegocio`, dinamica por cliente); reemplazarla por "Nexo POS" habria roto el sistema multi-negocio (cada cliente que use este POS vera su propio nombre/logo, no el de Nexo POS). Como el archivo es un JPG con fondo blanco solido (sin transparencia), se envolvio en una insignia blanca redondeada para que no se vea como un rectangulo desentonando con el fondo oscuro del login.

### Imprimir codigos de barras reales para productos sin codigo de fabrica

El usuario factura muchos articulos de ferreteria (conexiones de PVC, tornilleria) que no traen codigo de barras de fabrica -- hoy el sistema ya generaba un codigo interno de texto (ej. `GR-123456`) para estos casos, pero no habia forma de convertir ese codigo en un codigo de barras fisico imprimible para pegar en el producto o en una hoja de referencia y despues escanearlo con la pistola.

Archivos actualizados:

- `public/index.html` (boton nuevo "Imprimir codigos" en Inventario, libreria JsBarcode via CDN)
- `public/js/product-inventory.js` (`imprimirCodigosBarrasInventario()`)
- `public/css/components/inventory.css`

Cambios:

- Se agrego la libreria [JsBarcode](https://github.com/lindell/JsBarcode) via CDN (mismo patron que Chart.js, ya cargado asi en este proyecto) para generar codigos de barras reales en formato CODE128 (soporta letras, numeros y guiones, compatible con cualquier lector USB estandar en modo teclado).
- Nuevo boton "Imprimir codigos" junto a "+ Agregar producto" en Inventario: genera una hoja imprimible (ventana nueva, mismo patron que `imprimirSugerenciaPedido()` en `low-stock.js`) con el nombre, precio y codigo de barras escaneable de **los productos que esten visibles con los filtros/busqueda activos en ese momento** -- si el usuario busca "codo" antes de imprimir, solo imprime los codos; si no filtra nada, imprime todo el inventario.
- Los productos sin ningun codigo asignado se omiten de la hoja (no se puede generar un codigo de barras de la nada), y si absolutamente ninguno de los productos filtrados tiene codigo, se avisa con un mensaje en vez de imprimir una hoja vacia.

Validacion:

- `node --check` correcto en `public/js/product-inventory.js`.
- Probado con productos de prueba **solo en memoria del navegador** (sin escribir nada a la base de datos real, que se acababa de vaciar para el cliente): se interceptó `window.open` para capturar el HTML generado en vez de abrir una ventana real, confirmando que genera exactamente una etiqueta por producto con codigo (2 de 2), que se salta correctamente el producto sin codigo, y que el SVG del codigo de barras se genera con contenido real (no vacio). Se confirmo tambien el mensaje de aviso cuando ningun producto filtrado tiene codigo.

### Cajon en ventas a credito, estado de cuenta en formato de 58mm, e importador de catalogo Excel real

Tres reportes del usuario ya con el POS en uso real en la ferreteria.

Archivos actualizados:

- `public/js/pos-sales.js`
- `public/js/credit-customers.js`
- `public/js/supplier-catalog.js`
- `public/index.html` (boton de estado de cuenta, libreria SheetJS/xlsx via CDN, cache-busting)

**El cajon de dinero se abria tambien al vender a credito.** Causa real: la logica de abrir el cajon (`window.nexoDesktop.openCashDrawer`) vivia **dentro** de `imprimirTicketPOS()`, la misma funcion que se usa para imprimir CUALQUIER ticket, sin distincion de si la venta fue en efectivo o a credito. Ya existia un precedente correcto para esto: `reimprimirTicketVentaPOS()` en `sales-history-documents.js` ya pasaba `abrirCajonDespuesTicket:false` al reimprimir una venta pasada, pero esa misma proteccion nunca se aplico al ticket de credito recien cobrado. Se agrego un tercer parametro `opciones.abrirCajon` (default `true`, no cambia el comportamiento de ninguna venta en efectivo existente) y se paso `{ abrirCajon: false }` en el punto donde se imprime el ticket de una venta a credito.

**Estado de cuenta salia larguisimo en impresora de 58mm.** Causa real: el boton "Imprimir estado de cuenta" llamaba literalmente a `window.print()` sobre la pantalla completa del sistema (sidebar, barra superior, tarjeta de detalle del cliente tal cual se ve en escritorio) -- en una impresora termica de 58mm eso se imprime carril por carril, larguisimo y con la mayoria de las columnas vacias. Se escribio `imprimirEstadoCuentaCredito()`, que arma un ticket compacto (nombre del cliente, saldo pendiente, limite, disponible, estado y la lista de movimientos en una sola linea cada uno) y lo manda por `imprimirTicketPOS()` -- la misma plantilla angosta que ya usan los tickets de venta normales, respetando el ancho de papel configurado (58/80mm). Tambien se le paso `{ abrirCajon: false }` porque imprimir un estado de cuenta nunca deberia abrir el cajon.

**El importador de catalogos de proveedor no podia leer archivos Excel reales.** El campo de subida ya aceptaba `.xlsx` (`accept=".xlsx,.csv"` en el input), pero el codigo que procesa el archivo siempre hacia `lector.readAsText(archivo)` sin importar la extension. Un `.xlsx` real es un archivo binario (un ZIP con XML adentro), asi que leerlo como texto plano produce basura ilegible -- exactamente lo que el usuario vio en la pantalla del "Importador inteligente" (el contenido crudo del ZIP, empezando con "PK..."). El parseo de CSV en si (`separarFilaCatalogo()`, deteccion de delimitador, manejo de comillas) ya era correcto y robusto; el problema era unicamente el paso de lectura del archivo. Se agrego la libreria [SheetJS/xlsx](https://github.com/SheetJS/sheetjs) via CDN y una funcion `leerArchivoCatalogoComoCSV(archivo)`: si el archivo termina en `.xlsx`/`.xls`, se lee como binario, se toma la primera hoja y se convierte a CSV real con `XLSX.utils.sheet_to_csv()` antes de entregarlo al resto del flujo (que no cambio nada, sigue esperando un string CSV como siempre). Los archivos `.csv` genuinos siguen leyendose exactamente igual que antes.

Validacion:

- `node --check` correcto en `public/js/pos-sales.js`, `public/js/credit-customers.js`, `public/js/supplier-catalog.js`.
- Cajon: se simulo `window.nexoDesktop.openCashDrawer` con un contador y se confirmo que un ticket normal lo invoca una vez, y que un ticket con `{ abrirCajon: false }` no lo vuelve a invocar.
- Estado de cuenta: se armaron datos de credito de prueba solo en memoria del navegador (sin tocar la base de datos real) y se confirmo que el calculo de saldo/limite/disponible/estado y el formato de movimientos es correcto; la impresion en si reutiliza `imprimirTicketPOS()`, ya validado en produccion para tickets de venta.
- Importador Excel: se genero un `.xlsx` real en memoria con la propia libreria XLSX (2 productos de prueba) y se confirmo que `leerArchivoCatalogoComoCSV()` lo convierte a CSV legible correcto; se confirmo tambien que un `.csv` normal sigue leyendose sin cambios.

### Catalogo de proveedor: nombres que salian como codigo, y productos mezclados entre si (bug de fondo, no de datos)

El usuario reporto, ya usando un catalogo real de GAFI FERRETERO subido con el importador recien arreglado, dos problemas nuevos: (1) algunos productos al escanear su codigo no mostraban nombre, solo numeros parecidos al codigo de barras; (2) al escanear productos completamente distintos (un adhesivo Kolaloka, un disco de diamante), el sistema los reconocia a todos como "Tubo cobre flexible... Nacobre". Se investigaron ambos a fondo en vez de asumir que era un problema de los datos del proveedor.

Archivos actualizados:

- `public/js/product-inventory.js`
- `public/js/supplier-catalog.js`

**Nombres que salian como codigo.** La funcion que adivina el nombre de un producto cuando no hay una columna "nombre"/"descripcion" mapeada explicitamente elegia el texto mas largo de la fila que no pareciera un numero. El filtro que descartaba "esto parece un codigo" solo revisaba si el valor era 100% digitos; un codigo con separadores (ej. "7501-1026-30001", con guiones) no es 100% digitos, asi que se colaba como si fuera un nombre valido. Se agrego `pareceCodigoCatalogo()`, que quita cualquier caracter que no sea letra o numero y mide que proporcion de lo que queda son digitos -- si son 6 o mas digitos y representan 80% o mas del texto, se descarta como nombre.

**Productos completamente distintos se mostraban como el mismo (causa real, no relacionada a nombres).** La causa de fondo: el catalogo completo se partia en "filas" con un simple `.split("\n")`, sin respetar comillas. Un archivo Excel real casi siempre tiene alguna celda con texto que incluye un salto de linea (ej. una descripcion larga con varias lineas dentro de una sola celda) -- cuando SheetJS convierte esa celda a CSV, la envuelve en comillas pero el salto de linea real sigue estando ahi adentro. Al partir por `\n` sin saber que ese salto de linea estaba protegido por comillas, una sola fila real se partia en dos o mas "filas" rotas, y **todas las filas siguientes del archivo quedaban corridas/desalineadas** de ahi en adelante. Esto explica que productos sin ninguna relacion aparente (un adhesivo y un disco de diamante) terminaran mostrando los datos de otra fila (tuberia de cobre) -- no era un problema del archivo de GAFI, era que el sistema literalmente perdia la cuenta de donde empezaba y terminaba cada fila apenas encontraba la primera celda con salto de linea.

Se agrego `dividirLineasCatalogo(csv)`, un separador de filas que respeta comillas (misma tecnica que ya usaba `separarFilaCatalogo()` para separar columnas dentro de una fila, pero aplicada a nivel de filas completas), y se reemplazaron las 8 llamadas a `.split("\n")` repartidas en ambos archivos (deteccion de columnas, compactacion de catalogo, vista previa del mapeo, conteo de productos, y la busqueda real usada al escanear un codigo).

Se aprovecho la misma investigacion para confirmar (a peticion del usuario) que catalogos de distintos proveedores **no se mezclan entre si** -- cada catalogo guardado tiene su propio `csv` y `mapeo` independientes, y la busqueda recorre cada catalogo por separado sin compartir estado entre ellos.

Sobre el precio de GAFI que segun el usuario "sale 30% mas alto": se confirmo revisando el codigo que el sistema **no aplica ningun markup ni descuento oculto** -- toma el precio distribuidor/medio mayoreo/publico tal cual viene en las columnas del Excel del proveedor. La diferencia que percibe el usuario es porque su distribuidor le vende con su propia formula (descuento por volumen de compra + su propio margen) que no esta reflejada en el catalogo crudo de GAFI que le compartieron; quedo pendiente de decidir con el usuario si se agrega una funcion de ajuste de precio por catalogo/proveedor para este caso.

Validacion:

- `node --check` correcto en `public/js/product-inventory.js`, `public/js/supplier-catalog.js`.
- Se confirmo con datos de prueba (solo en memoria del navegador, sin tocar la base de datos real) que `dividirLineasCatalogo()` mantiene una celda con salto de linea como una sola fila (3 lineas reales vs. 4 lineas rotas con el separador viejo), y que al buscar dos codigos de barras distintos en ese catalogo de prueba cada uno regresa su propio nombre y precio correctos, sin mezclarse. Se confirmo tambien con dos catalogos de proveedores distintos que cada uno regresa el producto y el nombre de proveedor correctos, y que un codigo inexistente regresa `null` en vez de una coincidencia falsa.

### Rediseno grande de Punto de venta / Carrito

El usuario pidio un rediseno visual y funcional grande del carrito de venta (antes "tarjetas" apiladas), inspirado en una imagen de referencia de un POS de 3 zonas: sidebar, tabla de productos en la venta, panel derecho fijo de cobro. Se trabajo en 8 fases pequeñas, cada una validada localmente antes de seguir con la siguiente, sin tocar nunca la logica de venta ya funcional (agregar, eliminar, cambiar cantidad, descuento, impresion de ticket).

Archivos nuevos:

- `public/css/components/pos-sale-redesign.css` (CSS modular del rediseno completo, no se parcho nada encima del CSS existente)
- `public/js/pos-shortcuts.js` (atajos de teclado, aislado para poder revertirlo facil)

Archivos modificados:

- `public/js/pos-sales.js` (la mayor parte del cambio: `renderCarritoReferenciaPOS()`, `agregar()`, `cobrar()`, `cobrarCredito()`, `limpiarCarrito()`, y funciones nuevas)
- `public/app.js` (variables globales nuevas: `metodoPagoSeleccionado`, `nivelPrecioActual`)
- `public/index.html` (referencias a los archivos nuevos, cache-busting)

**Fase 1 -- Layout de 3 zonas.** Solo HTML/CSS, cero funciones JS tocadas: el panel derecho de cobro (`.pos-reference-side`) se volvio `position: sticky` con su propio scroll interno en pantallas anchas (>1080px), para que el Total y el boton Cobrar siempre esten visibles sin importar cuantos productos tenga el carrito. En pantallas angostas (tablet/celular) se cae a una sola columna apilada normal, sin scroll horizontal.

**Fase 2 -- Carrito como tabla.** Se reescribio el marcado interno de `renderCarritoReferenciaPOS()` para que cada producto en la venta sea una fila de tabla real (miniatura, codigo, nombre + marca/stock, cantidad +/-, precio unitario, total, eliminar) en vez de tarjetas apiladas. Se conservaron exactamente los mismos `onclick`/`id`s que ya usaba el resto del sistema (`cambiarCantidadCarrito`, `sumarCantidadCarrito`, `eliminar`, `id="dinero"`, `id="cambioTexto"`), asi que ninguna funcion de agregar/eliminar/cobrar cambio de logica. Estado vacio nuevo con el texto exacto pedido: "Escanea un codigo de barras o busca un producto para agregar a la venta". **Nota honesta:** se pidio mostrar el "codigo interno" del producto en vez del codigo de barras -- se reviso el esquema de base de datos y `productos` solo tiene una columna de codigo (`codigo TEXT`), sin un campo separado de codigo interno; no existe una forma confiable de distinguir "codigo de barras real" de "codigo interno" para todos los productos, asi que la tabla sigue mostrando `p.codigo` (el mismo campo que ya se usaba antes).

**Fase 3 -- Metodo de pago real (Efectivo/Tarjeta/Transferencia/Credito).** El servidor ya soportaba estos campos desde antes (`historial_ventas.metodo_pago`, `pago_tarjeta`, `pago_transferencia`, ya insertados por `POST /ventas`) -- el hueco era 100% frontend, `cobrar()` mandaba siempre `metodoPago:"efectivo"` fijo y nunca mandaba el detalle de pagos. Se agrego la variable `metodoPagoSeleccionado` y un selector de 3 botones en el panel de cobro; "Credito" del diseño de referencia sigue siendo el boton ya existente que llama a `cobrarCredito()` (no se duplico esa logica). En `cobrar()` se reemplazaron los `metodoPago:"efectivo"` fijos por la variable, y se agrego el objeto `pagos:{efectivo, tarjeta, transferencia}` al cuerpo del `POST /ventas`. Cuando el metodo no es efectivo, "Recibido" se autocompleta con el total (de solo lectura) para no forzar al cajero a escribir un numero que no aplica.

**Fase 4 -- Selector de "Precio aplicado" (Publico/Medio mayoreo/Mayoreo-distribuidor).** Cada producto ya tenia 3 niveles de precio en la base de datos (`precio_publico`, `precio_mayoreo`, `precio_distribuidor`), pero el carrito solo guardaba el precio ya resuelto al momento de agregar, sin poder cambiarlo despues. Se agrego que `agregar()` guarde los 3 niveles por linea, y una funcion `recalcularPreciosPorNivel(nivel)` que reasigna el precio de cada linea del carrito al nivel elegido -- con una regla importante: si un producto especifico no tiene guardado ese nivel de precio (ej. no tiene precio de mayoreo capturado), se usa su precio publico como respaldo en vez de dejarlo en $0.

**Fase 5 -- Atajos de teclado F2-F8.** Archivo nuevo `public/js/pos-shortcuts.js`, cargado despues de `scanner-usb.js` (se confirmo que no hay conflicto: el lector USB solo intercepta teclas de un caracter, nunca teclas F). F2 enfoca el buscador, F3 enfoca y limpia el buscador (listo para escanear), F4 abre el selector de cliente ya existente, F5 expande el bloque de descuento, F6 enfoca la cantidad de la ultima linea agregada, F8 cobra si el total es mayor a cero. Los atajos se bloquean automaticamente si Punto de venta no esta visible o si hay un modal abierto (mismo patron de guardas que ya usaba `scanner-usb.js`).

**Fase 6 -- Boton Cotizar.** Nueva funcion `cotizarVentaPOS()` que arma su propia plantilla de ticket ("COTIZACION -- No es un comprobante fiscal", sin folio de venta real) y la manda a imprimir con `imprimirTicketPOS(html, null, {abrirCajon:false})`. No reutiliza la construccion interna del ticket de `cobrar()` (mas simple y evita tocar esa funcion). Nunca llama a `/ventas` ni a `/creditos`, no descuenta inventario, no limpia el carrito -- una cotizacion es solo informativa.

**Fase 7 -- Guardar venta en espera.** Nueva clave de `localStorage` (`ventasEnEsperaFerreteriaPOS`) para guardar el carrito activo completo (productos, cliente, descuento, nivel de precio, metodo de pago) bajo un nombre/referencia que el cajero escribe, y limpiar el carrito para atender a otro cliente. Un indicador ("Ventas en espera N") aparece arriba del carrito cuando hay al menos una guardada, y abre un modal con la lista para recuperar o eliminar cada una. Si el carrito activo ya tiene productos al momento de recuperar una venta guardada, se pide confirmacion explicita antes de reemplazarlo, para no perder una venta en curso por accidente.

Bug encontrado y corregido durante la Fase 7: el modal nuevo de "Ventas en espera" se agrega directamente a `document.body` (mismo patron que el selector de cliente ya existente), fuera del contenedor `.pos-referencia` -- las variables de color `--pos-sale-*` solo estan definidas dentro de ese contenedor, asi que los botones "Recuperar"/"Eliminar" salian con texto blanco sobre fondo transparente (invisible). Se corrigio usando las variables de diseno globales (`--surface`, `--text-main`, `--line-soft`, `--text-muted`, `--brand-color`, ya definidas en `:root` y `body.oscuro` en `design-system.css`) para todo lo que vive fuera de `.pos-referencia`.

Validacion (repetida despues de cada fase, no solo al final):

- `node --check` correcto en `public/js/pos-sales.js`, `public/js/pos-shortcuts.js`, `public/app.js`.
- Se probo en el navegador con productos reales del inventario (sin escribir ninguna venta/producto falso a la base de datos real -- toda la manipulacion de datos de prueba fue en memoria del navegador, `carrito = [...]`, nunca `fetch("/ventas", ...)` con datos fabricados): agregar, quitar, cambiar cantidad con +/- y a mano, descuento por porcentaje y por monto.
- Metodo de pago: se hizo clic real en los 3 botones nuevos y se confirmo el precio/estado activo correcto; se reviso el cuerpo exacto que arma `cobrar()` para `POST /ventas` confirmando que incluye `metodoPago` y `pagos` correctos segun el boton elegido (sin ejecutar una venta real).
- Precio aplicado: se probo con un producto real con los 3 niveles de precio capturados (clic real en los 3 botones, confirmando el precio unitario y el total recalculados en pantalla) y con un producto real sin precio de mayoreo capturado (confirmando que no cae a $0 sino que usa el publico).
- Cajon: se conservo el fix de la fase anterior (`abrirCajon:false` en ventas a credito y en cotizaciones), verificado que `cotizarVentaPOS()` pasa esa opcion.
- Atajos F2-F8: se disparo cada tecla con eventos de teclado reales y se confirmo el efecto en el DOM real (foco en el buscador, apertura del modal de cliente, expansion del descuento con foco en su campo, foco en la cantidad de la ultima fila, y F8 invocando `cobrar(total)` con el total correcto via un espia temporal sin ejecutar una venta real). Se confirmo tambien que F8 no hace nada con el carrito vacio y que ningun atajo se dispara con el modal de cliente genuinamente abierto.
- Cotizar: se interceptó `imprimirTicketPOS` para confirmar que el HTML generado dice "COTIZACION" y "No es un comprobante fiscal", que se le pasa `abrirCajon:false`, y que el carrito no se modifica ni se vacia.
- Guardar venta en espera: se guardo una venta de prueba real (con dialogo real, escribiendo el nombre), se confirmo que el carrito se vacio y el indicador aparecio con el conteo correcto, se recupero y se confirmo que el producto volvio intacto y la venta guardada desaparecio de la lista; se probo tambien el caso de recuperar con el carrito activo ocupado, confirmando el dialogo de confirmacion real y que cancelar no cambia nada.
- Modo claro y oscuro probados en cada fase (incluyendo el fix del modal de ventas en espera). `preview_resize` a tablet (768px) y escritorio (~1014-1280px) sin scroll horizontal en ningun caso, con el boton Cobrar y el Total siempre visibles en escritorio.
- Se confirmo que Inventario, Creditos, Clientes y Caja siguen funcionando sin cambios -- Caja en particular ya mostraba el desglose real por Efectivo/Tarjeta/Transferencia con datos historicos reales, confirmando que el soporte de metodo de pago del servidor ya funcionaba de fondo.

### Rediseno desde cero de Punto de venta (buscador flyout) + arquitectura de adaptadores de catalogo

El usuario rechazo el rediseno incremental anterior del carrito (tablas, panel de cobro -- todo eso quedo implementado pero sin publicar) y pidio en su lugar un **rediseno de la forma en que se buscan y agregan productos**, inspirado en Square/Lightspeed/Shopify/Odoo POS: eliminar por completo la cuadricula fija de tarjetas de producto, reemplazarla por un buscador inteligente tipo autocomplete (flyout), y dejar que el carrito sea el protagonista absoluto de la pantalla. Por separado, en la misma sesion, pidio dejar preparada la arquitectura del importador de catalogos para soportar decenas de proveedores mediante adaptadores independientes en vez de un parser generico unico. Se investigo primero con 3 agentes de exploracion + 1 agente de diseno, se presento un plan tecnico completo y se espero aprobacion explicita antes de escribir codigo.

**Archivos nuevos:**

- `public/js/pos-search-flyout.js` -- buscador flyout
- `public/js/catalog-parsers.js` -- registro de adaptadores por proveedor
- `public/js/catalog-provider-picker.js` -- selector visual de proveedor (tiles)

**Archivos modificados:** `public/js/pos-sales.js`, `public/js/pos-shortcuts.js`, `public/js/app-bootstrap.js`, `public/js/supplier-catalog.js`, `public/js/product-inventory.js`, `public/index.html`, `public/css/components/pos-cart.css`, `public/css/components/pos-sale-redesign.css`, `public/css/components/supplier-catalog.css`.

**Eliminacion de la cuadricula fija de productos.** Se borraron `mostrarProductos()`, `filtrarProductosPOSCategoria()` y `renderProductosFrecuentesPOS()` (esta ultima ya era codigo muerto: apuntaba a un `#posFrecuentes` que no existia en el HTML) de `pos-sales.js`, junto con su marcado (`.pos-section-title`, `.productos.pos-grid`) y su CSS. Se confirmo primero (con un agente de exploracion) que esta cuadricula era exclusiva de Punto de venta, no compartida con Inventario ni con el formulario de "Agregar producto".

**Buscador flyout.** `buscarProductos()` (`app-bootstrap.js`) reusa exactamente el mismo filtro en memoria de siempre sobre `todosProductos`, pero ahora redirige el resultado a `mostrarFlyoutBusquedaPOS()` (`pos-search-flyout.js`) en vez de renderizar una cuadricula permanente: una lista flotante de maximo 8 resultados (icono, nombre, marca, codigo, stock, precio, boton Agregar) que aparece debajo del buscador, se cierra con Escape, con clic afuera, o al agregar un producto, y se oculta automaticamente si la busqueda esta vacia. Las categorias del listón superior ahora filtran ese mismo flyout (`filtrarFlyoutPOSCategoria()`, mismo filtro de categoria/subcategoria/nombre de siempre) en vez de una cuadricula fija. Bug encontrado durante la implementacion: el contenedor del flyout se anido primero dentro de `.pos-reference-search`, que tiene `overflow:hidden` (para recortar las esquinas redondeadas del buscador) -- eso recortaba el flyout entero, invisible aunque el DOM y el CSS eran correctos. Se corrigio moviendo el flyout a un nuevo `.pos-search-wrap` hermano (sin `overflow:hidden`) que envuelve tanto el buscador como el flyout.

**El carrito como protagonista (~70% del ancho).** Antes de este cambio, el carrito y el panel de cobro vivian juntos dentro del mismo panel lateral derecho, mientras la cuadricula de productos ocupaba el panel izquierdo. Se invirtio esa relacion: `renderCarritoReferenciaPOS()` se dividio en `renderCarritoTablaPOS()` (la tabla del carrito, ahora en el panel izquierdo/central, dentro de un nuevo contenedor `#carritoTabla`) y `renderResumenCobroPOS()` (cliente, precio aplicado, metodo de pago, subtotal/descuento/IVA/total, recibido/cambio, botones -- en el panel derecho, ahora angosto, dentro de `#resumenCobro`). `renderCarritoReferenciaPOS()` se conservo como funcion delgada que llama a ambas, preservando el contrato de nombre que ya usaba `ferretero-flow.js`. El grid de la pantalla se ajusto de `minmax(0,1fr) minmax(460px,560px)` a `minmax(0,1fr) minmax(320px,360px)`, dejando el carrito con ~64-70% del ancho real segun el tamaño de pantalla.

**Filas del carrito con mas informacion.** Cada fila ahora muestra el nombre completo sin truncar (se quito el `white-space:nowrap` + elipsis del rediseno anterior) y, debajo, una fila de etiquetas pequeñas con marca, proveedor, categoria y stock -- en vez de una sola linea combinada. `categoria` se agrego como campo pasivo adicional al objeto que ya arma `agregar()` (no cambia cantidad, precio ni ninguna logica existente). Se aumento el espaciado/tamaño de fila para la densidad visual pedida.

**Atajo F7 "Precio".** Se agrego a `pos-shortcuts.js` siguiendo el mismo patron de guardas que los atajos existentes. Por decision explicita del usuario (elegida entre dos opciones presentadas), F7 **solo enfoca y resalta** el selector de "Precio aplicado" -- nunca cambia el precio automaticamente, para no arriesgar aplicar un nivel de precio equivocado con una sola tecla.

**Animaciones.** Se agrego `@keyframes posRowIn` (aplicado por CSS puro a `.pos-cart-row:last-child`, sin tocar JS, ya que el carrito se re-renderiza completo en cada cambio) para animar la entrada de un producto nuevo; un pulso breve (`posQtyPulso`) en el campo de cantidad al cambiar, activado por funciones envoltorio nuevas (`sumarCantidadConPulso`, `quitarUnoConPulso`, `cambiarCantidadConPulso`) que llaman a las funciones originales sin cambiarlas y luego aplican el pulso a la fila correcta via un nuevo atributo `data-id` en cada `<tr>`; y una salida animada al eliminar (`eliminarConAnimacion()`) que aplica una clase `.saliendo` y difiere ~150ms la llamada real a `eliminar()`, ya que el motor de renderizado no tiene nodos persistentes que animar al salir.

**Arquitectura de adaptadores de catalogo.** El importador de catalogos era 100% `localStorage`, sin rutas de servidor, con un unico parser generico usado para todos los proveedores y el nombre del proveedor capturado como texto libre. Se extrajo la logica de extraccion por fila de `productoDesdeCatalogo()` (antes ~250 lineas inline) a `GenericoParser.extraerProducto()` en el nuevo `catalog-parsers.js` -- mismo codigo, nueva ubicacion, sin cambio de comportamiento -- y `productoDesdeCatalogo()` paso a ser un despachador delgado que llama a `CATALOGO_PARSERS[catalogo.parser || "generico"]`. **La clave de compatibilidad hacia atras es ese `|| "generico"`:** los catalogos reales que el usuario ya tenia guardados (Diprofer, GAFI) no tienen campo `parser`, asi que siguen resolviendo productos exactamente igual sin necesidad de volver a subirlos -- verificado con un catalogo de prueba sin campo `parser` que siguio funcionando identico. Se agrego `TruperParser` (reusa la extraccion generica pero aplica "Truper" como marca de respaldo si la columna viniera vacia -- verificado que un producto sin columna de marca queda con `marca:"Truper"`), y `DiproferParser`/`GafiParser`/`VolteckParser` como wrappers delgados que por ahora delegan en el generico (sin quejas concretas de datos reales que ameriten logica especial todavia; decision explicita del usuario: "empezar simples, ajustar despues"). Se agrego un selector visual nuevo (`catalog-provider-picker.js`, modal de tiles Diprofer/GAFI/Truper/Volteck/Otro, cada uno con su propio icono y color) que se invoca **antes** del cuadro de texto libre existente -- "Otro proveedor" conserva exactamente el flujo de siempre (texto libre + parser generico); los otros 4 fijan el nombre del proveedor y el parser directamente. El campo `parser` se agrego al registro que guarda `procesarArchivosCatalogo()`.

Validacion:

- `node --check` correcto en los 8 archivos JS nuevos/modificados de esta fase.
- Flyout: probado con datos reales del inventario -- escritura instantanea, maximo 8 resultados, clic en "Agregar" agrega al carrito y cierra el flyout (verificado con `.click()` nativo del DOM, ya que el clic por coordenadas de la herramienta de pruebas no acertaba de forma confiable sobre un elemento flotante recien posicionado -- se confirmo la logica real, no un artefacto de la herramienta), categorias filtrando el flyout, Escape y clic afuera cerrandolo, busqueda vacia ocultandolo.
- Carrito ~70%: medido en el navegador real (`getBoundingClientRect()`), ~64% del ancho del layout a 1400px de viewport, visualmente dominante; sin scroll horizontal en tablet (900px) ni escritorio (1400px).
- Fila del carrito: marca/proveedor/categoria/stock visibles como etiquetas separadas, nombre largo envuelto sin cortarse, cantidad +/- y eliminar sin cambio de comportamiento.
- F7: resalta el selector real sin cambiar `nivelPrecioActual`; bloqueado con un modal abierto.
- Animaciones: confirmado con `getComputedStyle` que la fila nueva tiene `animation-name:posRowIn`, que el pulso se aplica y se quita solo, y que `.saliendo` se aplica de inmediato mientras el producto sigue en el carrito por ~150ms antes de eliminarse de verdad.
- Metodo de pago, precio aplicado, descuento, F2/F4/F5/F6/F8, Cotizar y Guardar/Recuperar venta en espera se volvieron a probar end-to-end sobre la nueva estructura de contenedores (`#carritoTabla`/`#resumenCobro`) para confirmar que la division de `renderCarritoReferenciaPOS()` no rompio nada de lo ya construido.
- Catalogos: verificado con datos sinteticos (nunca contra la base de datos compartida) que un catalogo sin campo `parser` (simulando uno real ya guardado) sigue resolviendo cada producto con sus propios datos correctos sin mezclarse; que `TruperParser` aplica la marca de respaldo correctamente; que el selector de proveedor resuelve `{parser, proveedor}` para cada tile, que "Otro" preserva el flujo de texto libre exacto, y que "Cancelar" aborta todo el flujo de subida.
- Se confirmo que Inventario, Creditos, Clientes, Caja y Catalogo proveedor siguen cargando sin errores de consola. Modo claro y oscuro probados en cada pieza nueva (flyout, filas del carrito, selector de proveedor).
- No se hizo commit ni push -- pendiente de confirmacion explicita del usuario.

### Correcciones tras uso real en tienda (post rediseno flyout)

El usuario probo el rediseno anterior ya en la ferreteria real y reporto 6 problemas concretos. Se investigo cada uno con el navegador real antes de tocar codigo.

**Flujo de Enter roto al cobrar (el mas serio).** El sintoma reportado: escribir el monto recibido y presionar Enter "se quedaba atras", habia que interactuar con las flechitas del campo numerico para que Enter empezara a funcionar, y despues de que la venta se registrara se necesitaba un Enter adicional para que el carrito se limpiara y apareciera la opcion de imprimir. Se encontraron **dos causas reales, no relacionadas entre si**:

1. `resumenCarritoPOS()` no redondeaba `subtotal`/`descuento`/`total` -- sumas de precios reales (ej. `11.99*3 + 8.45*2 + 23.33`) producen en JavaScript resultados como `76.19999999999999` en vez de `76.2` por el manejo nativo de punto flotante. Si el cliente pagaba el monto exacto mostrado en pantalla, la comparacion `dinero < total` podia fallar por una diferencia de centesimas de centavo invisibles, mostrando "Faltan $0.00 para completar la venta" -- un mensaje confuso que parece que "no paso nada". Se corrigio redondeando a centavos en el origen (`resumenCarritoPOS()`), que es la fuente unica de estos valores para toda la pantalla, el ticket y el registro de la venta.
2. **Se encontro un archivo completamente separado y mas antiguo, `public/fase7-pagos.js`**, cargado automaticamente en cada carga de pagina (`app.js`), que **sobreescribe `window.cobrar`** con su propia version: antes de dejar pasar el cobro real, abre su propio modal de "Metodo de pago" (Efectivo/Tarjeta/Transferencia/Credito/Mixto) con sus propias flechas de navegacion y su propio manejo de Enter -- que ademas **ignora deliberadamente la tecla Enter cuando el foco esta en un campo de texto** (para no chocar con el escritura). Como el campo "Recibido" del panel de cobro nuevo SI es un campo de texto, el Enter del usuario nunca llegaba al modal viejo; en cambio disparaba de nuevo el `onkeydown` del campo "Recibido", reabriendo/reiniciando el modal en un ciclo confuso -- hasta que el usuario hacia clic en una flecha del modal viejo, momento en el que el foco se movia FUERA de un campo de texto y el Enter por fin funcionaba en ese sistema. Este modal viejo es anterior al rediseno de esta sesion y quedo completamente redundante: el panel de cobro nuevo ya tiene su propio selector de Metodo de pago funcional y correctamente conectado al servidor. Se desactivo su carga (se quito la linea que lo inyecta en `app.js`); el archivo en si no se borro, solo se dejo de cargar. Se le informa al usuario que la opcion "Mixto" (dividir un pago entre efectivo/tarjeta/transferencia/credito) que ese modal viejo ofrecia **no existe hoy en el panel nuevo** -- si la necesita, es una funcion a agregar deliberadamente despues.
3. Complementario: se hizo sincrono el enfoque del boton "Entendido" en los dialogos de alerta (`dialogoPOS()` en `config-auth.js`, antes tenia un `setTimeout` de 40ms que dejaba una ventana breve donde el teclado no iba a ningun lado predecible) y se agrego un seguro anti doble-clic/doble-Enter (`window.__cobrandoEnCursoPOS`) a `cobrar()` y `cobrarCredito()` para que una venta nunca pueda dispararse dos veces en paralelo, sin importar la causa exacta de una doble pulsacion.

**Precio por defecto cambiado a "Medio mayoreo".** `nivelPrecioActual` iniciaba en `"publico"` en 8 lugares distintos (declaracion global, limpieza de carrito, cobro, cobro a credito, guardar/recuperar venta en espera). Se cambiaron todos a `"mayoreo"`, que es el precio que el usuario realmente usa en el mostrador.

**Codigo interno en vez de codigo de barras en la tabla.** Se investigo la base de datos real y se confirmo que cada producto trae, ademas de su codigo de barras (`producto_codigos` con `tipo:"barra"`), varios "codigos alternos" (`tipo:"alterno"`) capturados durante la importacion del catalogo -- entre ellos, tipicamente, una clave interna corta y puramente numerica (ej. `"48491"`, exactamente el formato de ejemplo que dio el usuario: `"29932"`). Se agrego `codigoInternoDeProducto()` (`product-inventory.js`), que busca entre los codigos alternos del producto uno que sea 100% numerico y de 4 a 7 digitos (para no confundirlo con el codigo de barras de 13 digitos ni con codigos alfanumericos tipo SKU como `"PAAPSES"` ni con codigos SAT largos como `"39121700"`), con respaldo al codigo de barras si no encuentra uno asi. Se captura como campo nuevo `codigoInterno` en `agregar()` y se muestra en la columna "Codigo" del carrito en vez del codigo de barras.

**Scroll despues de unos productos.** El carrito, al ser ahora el elemento protagonista, no tenia limite de alto -- crecia indefinidamente y obligaba a hacer scroll de toda la pagina. Se le devolvio un `max-height:480px` con scroll interno propio (aprox. 3 productos visibles antes de necesitar scroll, con el encabezado de la tabla fijo arriba).

**Nombres de productos con caracteres rotos (mojibake).** Se confirmo en la base de datos real que varios nombres de productos (ej. "l�nea", "m�dulo", "Adaptador de portal�mpara") contienen el caracter de reemplazo Unicode `�` -- esto no es un problema de como se muestra el texto, es dato ya corrompido guardado en la base de datos: el archivo `.csv` original del catalogo (mas probablemente de DIPROFER, que es el proveedor de estos productos) esta codificado en Windows-1252 (comun en exportaciones de sistemas mexicanos mas viejos), pero `leerArchivoCatalogoComoCSV()` lo leia con `FileReader.readAsText()` sin especificar codificacion, que por defecto asume UTF-8 -- cualquier acento (á, é, í, ó, ú, ñ) se convierte en el caracter de reemplazo de forma irreversible en el momento de la lectura. Se corrigio leyendo el archivo como binario y decodificando primero como UTF-8 estricto (`TextDecoder("utf-8", {fatal:true})`, que lanza error si encuentra bytes invalidos) y, si eso falla, decodificando como Windows-1252 en su lugar -- esto arregla las **proximas** subidas de catalogo. Los nombres que ya estan corrompidos en el inventario actual no se pueden recuperar automaticamente (el caracter original ya se perdio, no hay forma de adivinarlo con certeza); la unica forma de corregirlos es volver a subir el mismo archivo de catalogo del proveedor por el importador ya arreglado, o corregirlos a mano uno por uno. No se intento ninguna reparacion automatica/masiva sobre datos reales ya guardados.

**Contraste del buscador y miniaturas encimadas con el texto.** El fondo del buscador (`--pos-sale-card`, blanco/negro con opacidad baja) se veia casi invisible contra el fondo de la pantalla (tambien claro/oscuro con poca diferencia). Se le dio un fondo solido y un borde mas marcado, con estado de foco visible. Por separado, se encontro que la miniatura de producto del buscador flyout (`.pos-flyout-thumb`, 34x34px) no tenia una regla que redujera el icono interno (`.producto-mini-icon`, que por defecto mide 52x52px) -- el icono se salia de su caja y se encimaba con el nombre/texto de al lado. Se agrego la regla de tamaño faltante (mismo patron que ya existia para los iconos del carrito) y `overflow:hidden` de seguro en ambas miniaturas (carrito y flyout).

Validacion:

- `node --check` correcto en los 5 archivos JS modificados.
- Enter en cobro: reproducido el bug original con datos reales (precios que producen error de punto flotante) confirmando "Faltan $0.00" antes del fix; despues del fix, pagar el monto exacto mostrado en pantalla pasa la validacion sin alerta. Confirmado que `fase7-pagos.js` ya no se carga (`window.__fase7PagosPOS` es `undefined`) y que un solo Enter en el campo Recibido llama a `cobrarInternoPOS()` una sola vez con el total correcto.
- Precio por defecto: confirmado que el carrito abre con "Medio mayoreo" activo y que los 8 puntos de reinicio usan el mismo valor.
- Codigo interno: confirmado con un producto real de la base de datos (con codigos alternos reales, incluyendo el de tipo `"barra"` y tres `"alterno"`) que la columna Codigo del carrito muestra el codigo corto correcto en vez del codigo de barras de 13 digitos.
- Scroll: confirmado que con 5 productos el contenedor mide 480px de alto mientras el contenido real mide mas de 1000px, y que el scroll ocurre dentro del carrito sin mover la pagina completa.
- Contraste y miniaturas: confirmado visualmente en claro y oscuro que el buscador tiene fondo solido y borde visible, y que las miniaturas del carrito y del flyout ya no se encimen con el texto.
- Se confirmo que Inventario, Creditos, Clientes y Caja siguen cargando sin errores de consola despues de todos estos cambios.
- No se hizo commit ni push -- pendiente de confirmacion explicita del usuario.

### Verificacion del catalogo real de Gafi (004BE Durango) y correccion de su mapeo de columnas

El usuario mando un catalogo real de Gafi (`004BE Durango - Lista de precio - 06-Julio-2026.xls`, 9,583 productos) y un producto fisico real (disco de diamante Easy-Cut Austromex, clave 858, codigo de barras 7500012036248) para verificar que se lea igual de bien que Diprofer.

**El archivo se lee correctamente** (via SheetJS, mismo camino que Diprofer) y **el producto se encuentra y coincide exactamente**: nombre, marca (AUSTROMEX) y proveedor fabricante (Abrasivos Especiales) coinciden con el paquete fisico, buscando por la clave "858" (columna "Alterno" del catalogo, que es la clave del fabricante, la misma que trae impresa el paquete).

**Hallazgo importante sobre este catalogo especifico: no tiene columna de codigo de barras.** Sus columnas son `Corto,Alterno,Articulo,Precio Lista,Unidad,Emp,Linea,Familia,Marca,Proveedor Principal` -- "Corto" es una clave interna secuencial de Gafi y "Alterno" es la clave del fabricante (ej. "858"), pero el codigo de barras real (7500012036248 en este caso) simplemente no aparece en ningun lado del archivo. Esto significa que **escanear el codigo de barras impreso en el producto nunca va a encontrar una coincidencia en el catalogo de Gafi** -- no es un error del sistema, es que la lista de precios de Gafi esta organizada por su propia clave de mayoreo, no por codigo de barras de venta al publico. Buscando por la clave del fabricante ("858", que suele venir impresa en el empaque junto con el nombre) si funciona correctamente.

**Se encontro y corrigio un error real en la deteccion automatica de columnas** al probar con el archivo real: la regla generica para "marca" (`/\b(marca|linea|fabricante)\b/`) confundia la columna "Linea" (que en este catalogo es siempre "FERRETERÍA", no una marca) con la columna real "Marca": encontraba "Linea" primero y se quedaba con esa. De forma similar, la regla generica para "costo" (`/\b(distribuidor|costo|neto|proveedor)\b/`) confundia la columna "Proveedor Principal" (el nombre del fabricante, un texto) con un campo de precio, porque su patron acepta la palabra "proveedor". Se agrego una plantilla especifica para Gafi (`global-gafi-csv` en `plantillasCatalogoBase()`, mismo patron que ya existia para Truper) con el mapeo correcto verificado contra el archivo real, y se conecto a `GafiParser` (`catalog-parsers.js`) via `plantillaId` -- al elegir el tile "Gafi" en el selector de proveedor, el sistema ahora precarga automaticamente este mapeo correcto en vez de la deteccion generica (que el usuario de todas formas puede revisar/ajustar en la pantalla de mapeo antes de confirmar).

Validacion:

- `node --check` correcto en `supplier-catalog.js` y `catalog-parsers.js`.
- Se instalo temporalmente la libreria `xlsx` de Node (`npm install xlsx --no-save`, nunca se guardo en package.json) solo para poder leer el archivo real del usuario y generar una muestra de prueba; se desinstalo al terminar.
- Se cargo el catalogo real completo (9,583 productos) en el navegador de prueba (localStorage, nunca en la base de datos compartida) usando exactamente el mismo camino que usaria un usuario real subiendo el archivo, y se confirmo: la plantilla nueva de Gafi mapea correctamente las 7 columnas relevantes (antes 2 de ellas -- marca y costo -- quedaban mal); buscar por la clave del fabricante "858" devuelve el producto exacto con nombre, marca, proveedor y precio de lista correctos; buscar por el codigo de barras real del producto devuelve `null` como se espera dado que esa informacion no existe en este catalogo. Se restauro el `localStorage` de catalogos a su estado anterior (vacio) al terminar la prueba, sin dejar datos de prueba residuales.

### Buscador de productos por nombre en la pantalla "Catalogo proveedor"

A raiz de la verificacion del catalogo de Gafi, el usuario confirmo que le gustaria poder buscar productos por nombre dentro del catalogo ya guardado -- hoy la pantalla "Catalogo proveedor" solo mostraba una vista previa de 12 productos de muestra (`productosDesdeCsvCatalogo(csv, 12, ...)`), sin forma de buscar en el catalogo completo (que puede tener miles de productos, como el de Gafi con 9,583).

Se agrego un buscador real (`public/js/supplier-catalog-view.js`) en el panel "Lectura del catalogo": un campo de texto que busca por nombre dentro del catalogo actualmente seleccionado (`catalogoSeleccionadoIndice`, variable nueva que `renderVistaCatalogo()` actualiza cada vez que el usuario cambia de catalogo con el boton "Ver"), usando `buscarProductosEnCatalogoGuardado(indice, texto, limite=30)` -- reutiliza exactamente las mismas funciones de extraccion de datos que ya usaba la vista previa (`dividirLineasCatalogo`, `separarFilaCatalogo`, `valorMapeoCatalogo`, `valorColumnaCatalogo`, `detectarColumnasCatalogo`, `detectarMarcaDesdeFilaCatalogo`) para que el resultado sea consistente con como se lee el catalogo en el resto del sistema, respetando el mapeo/plantilla guardada de cada catalogo (incluida la plantilla nueva de Gafi). Los resultados muestran codigo, nombre, marca y precio publico -- el usuario copia el codigo desde ahi y lo pega en "Agregar producto" para traer el resto de los datos automaticamente. Limitado a 30 resultados por busqueda para no renderizar miles de filas de golpe.

Validacion:

- `node --check` correcto en `supplier-catalog-view.js`.
- Probado con el catalogo real de Gafi (9,583 productos, cargado temporalmente en localStorage de prueba, restaurado al terminar): buscar "cuarcita" encuentra exactamente el disco de diamante clave 858 con marca y precio correctos; buscar "disco diamante" (termino amplio, muchas coincidencias) confirma el limite de 30 resultados; busqueda vacia limpia los resultados; termino sin coincidencias muestra "Sin resultados" en vez de una tabla vacia confusa.
- Modo claro y oscuro probados. Pantalla sin ningun catalogo cargado (estado vacio) probada sin errores de consola.

### Sistema de reglas de precio por proveedor (margen + redondeo, configurable)

Se investigo con el usuario la formula real que usa para poner precio a los productos de Gafi: no hay ningun descuento oculto (la teoria previa de "20% de descuento + 30% de margen" quedo descartada), la formula real y confirmada es simplemente `PrecioVenta = PrecioLista * (1 + margen/100)`. El usuario pidio explicitamente que esto **no quedara quemado en codigo por proveedor** (como hubiera pasado si el 30% de Gafi se hard-codeaba dentro de `GafiParser`), sino un sistema configurable que sirva para cualquier proveedor futuro: margen general por proveedor, con la posibilidad de sobreescribirlo por categoria o por producto especifico, mas una regla de redondeo automatico (sin redondeo, al peso, multiplos de $5 o $10, o "psicologico" terminando en 49/99), y una pantalla de vista previa antes de aplicar los precios calculados al inventario real.

**Datos: nueva tabla en Postgres, no localStorage.** A diferencia de todo lo demas en este modulo (catalogos, plantillas, configuracion de negocio), que vive solo en `localStorage` del navegador, el usuario pidio explicitamente que las reglas de precio se guardaran en el servidor -- para que sobrevivan si cambia de computadora o reinstala. Se agrego `reglas_precios_proveedor` (`negocio_id`, `proveedor`, `margen_general`, `redondeo`, `margenes_categoria` y `margenes_producto` como JSONB -- mapas simples de `clave normalizada -> numero`, ya que ni las categorias ni los productos-por-codigo tienen tabla relacional propia hoy) y 3 rutas (`GET /reglas-precios`, `GET /reglas-precios/:proveedor`, `POST /reglas-precios` con upsert por `negocio_id + proveedor`).

**Motor de calculo puro** (`public/js/pricing-rules.js`, sin acceso a base de datos ni localStorage): `resolverMargenProducto()` resuelve la prioridad producto-especifico > categoria > margen general del proveedor (y `null` si no hay ninguno); `aplicarRedondeo()` implementa las 5 reglas -- el redondeo "psicologico" **siempre redondea hacia arriba** al siguiente precio terminado en 49/99 (nunca reduce el margen calculado; formula: `base=49, paso=50`, ej. `$122 -> $149`, confirmado exacto con el ejemplo real que dio el usuario); `calcularPrecioSugerido()` combina ambos. `obtenerReglasPrecioProveedor()`/`guardarReglasPrecioProveedor()` hablan con las rutas nuevas con una cache simple en memoria para no repetir el fetch en cada fila de una vista previa con miles de productos.

**Pantalla de configuracion por proveedor** (`public/js/pricing-rules-view.js`, boton nuevo "Precios" en la pantalla "Proveedores" existente): selector de proveedor -- la lista sale de `listaNombresProveedoresDisponibles()`, que une nombres desde la tabla real `proveedores` (que resulto estar completamente vacia: el usuario nunca ha dado de alta un proveedor ahi, solo ha subido catalogos), los catalogos guardados y los proveedores usados en el inventario existente, para que la pantalla sea util con los datos reales de hoy en vez de solo los 4 proveedores con parser propio. Margen general con 7 botones rapidos (10/15/20/25/30/40/50%) mas un campo de texto libre para cualquier porcentaje. Redondeo con 5 botones tipo radio. Debajo, margenes por categoria (reutiliza `categoriasInventarioGuardadas()`, que en este sistema son texto libre sin tabla propia) y margenes por producto especifico (buscador que agrega overrides por codigo).

**Pantalla de vista previa "Aplicar precios calculados"** (`public/js/pricing-apply-view.js`, boton "Precios" en cada fila de "Catalogo proveedor"): recorre el catalogo guardado completo (reutilizando exactamente el mismo camino de lectura ya usado por el buscador de catalogo: `dividirLineasCatalogo` -> `detectarColumnasCatalogo` -> por fila `separarFilaCatalogo` + el parser correcto del proveedor), cruza cada producto contra el inventario real por codigo, calcula el precio sugerido con las reglas del proveedor, y lo muestra en una tabla con busqueda, filtro por categoria y paginacion (20 por pagina) -- probada con el catalogo real de Gafi completo (9,583 productos): calculo verificado exacto contra el producto real ya conocido (disco clave 858, $127.74 de lista, margen 30% -> $166.06 -> redondeado psicologico hacia arriba a $199), busqueda/filtro/paginacion funcionando correctamente sobre el dataset completo.

**Aplicar precios: actualizar y crear productos.** Cada fila tiene un campo "Precio nuevo" editable (precargado con el precio sugerido, pero el usuario lo puede ajustar a mano) y un boton "Omitir/Incluir". El boton "Aplicar todos" opera sobre las filas actualmente visibles segun busqueda/filtro (asi el usuario puede acotar a "solo estos 2-3 productos" antes de aplicar, en vez de tener que tocar miles de filas una por una) y que no esten omitidas: para las que ya coinciden con un producto del inventario, actualiza su precio via `PUT /editar-producto/:id` (esta ruta ya existente requiere el registro completo, no un parche parcial, asi que se manda el producto existente completo con solo el precio cambiado); para las que no existen todavia, las crea via `POST /agregar-producto` con `stock:0` (la cantidad real se recibe despues por el flujo normal de Recepcion de mercancia, igual que cualquier alta manual) -- ambas son rutas ya existentes y probadas, no se creo ninguna ruta de servidor nueva para esto. Se pide confirmacion explicita antes de aplicar (cuantos se van a actualizar / crear), las llamadas van una por una en secuencia (no en paralelo, para no saturar el servidor con catalogos de miles de filas), y al terminar se recarga el inventario y se muestra un resumen de exitos/errores.

**Sugerencia de precio en "Agregar producto" (cambio aditivo).** Cuando se abre la ficha de un producto que viene de un catalogo de proveedor, si ese proveedor tiene reglas de precio guardadas, aparece un boton "Usar precio sugerido: $X (margen Y%)" junto al selector de tipo de precio -- un clic llena el campo de precio de venta, pero no toca el mecanismo existente de tabs Distribuidor/Medio mayoreo/Publico. Si el proveedor no tiene reglas guardadas (el caso de la gran mayoria hoy, incluido Diprofer, cuyo catalogo ya trae el precio final y no necesita margen calculado), el boton simplemente no aparece y el formulario se comporta exactamente igual que antes de este cambio.

**Bug real encontrado y corregido de paso: `mostrarProductos is not defined`.** Al probar el flujo de aplicar precios se descubrio que `cargarProductos()` (funcion central que recarga el inventario desde el servidor, usada en todo el sistema) llamaba a `mostrarProductos(todosProductos)` -- una funcion que ya no existe en el codigo, eliminada durante el rediseno del POS de esta misma sesion (cuando se elimino la cuadricula fija de productos) sin limpiar sus 5 puntos de llamada (`app-bootstrap.js`, dos veces en `product-inventory.js`, dos veces en `offline-sync.js`). El efecto real: cada vez que se llamaba `cargarProductos()`, la lista de productos SI se actualizaba (el `fetch` corria antes del error), pero la excepcion interrumpia la funcion antes de llegar a `actualizarDashboard()`, `actualizarInventarioBajo()`, `actualizarDatalistCategorias()` y el refresco de la tabla de Inventario -- silenciosamente, porque casi todos los que llaman a `cargarProductos()` lo hacen dentro de un `try/catch` que solo hace `console.warn`. Se elimino la llamada muerta en los 5 lugares (los caminos de exito normales de agregar/editar/eliminar producto ya refrescan la tabla de Inventario por su cuenta con `cargarTablaInventario()`, asi que no hacia falta reemplazar la llamada eliminada por nada).

Validacion:

- `node --check` correcto en los 12 archivos JS/servidor tocados o creados (`pricing-rules.js`, `pricing-rules-view.js`, `pricing-apply-view.js`, `product-inventory.js`, `app-bootstrap.js`, `offline-sync.js`, `pos-sales.js`, `config-auth.js`, `supplier-catalog.js`, `supplier-catalog-view.js`, `catalog-parsers.js`, `server.js`).
- Formula verificada con los ejemplos reales del usuario: $100 al 50% -> $150, al 25% -> $125, al 15% -> $115. Redondeo psicologico verificado: $122 -> $149 (ejemplo exacto del usuario), $100 -> $149, $149 -> $149 (idempotente), $150 -> $199, $300.01 -> $349.
- Prioridad producto > categoria > general probada con reglas reales guardadas y confirmada tras recargar la pagina (persistencia real en Postgres, no solo en memoria).
- Rutas de servidor probadas con un registro temporal (`proveedor:"PruebaTemp"`), confirmado que se guarda y se lee de vuelta correctamente, borrado de la base de datos compartida inmediatamente despues de cada prueba.
- Vista previa probada contra el catalogo real completo de Gafi (9,583 productos, cargado temporalmente en localStorage de prueba y restaurado al terminar): calculo correcto verificado en varios productos reales incluyendo el disco clave 858 ya conocido de una verificacion anterior, busqueda/filtro/paginacion correctos sobre el dataset completo, sin scroll horizontal en ancho de escritorio normal.
- Aplicar precios probado con datos 100% sinteticos para no tocar ningun producto real del usuario sin su autorizacion especifica: se creo un producto de prueba, se uso "Aplicar todos" para actualizar su precio y crear un segundo producto de prueba nuevo en un solo paso, se confirmo en la base de datos que ambos quedaron con el precio y estado correctos (incluyendo `stock:0` en el producto creado), y se borraron ambos productos de prueba de la base de datos compartida al terminar.
- Sugerencia de precio en "Agregar producto" probada con un proveedor con reglas guardadas (aparece el boton con el calculo correcto, el clic llena el precio) y con un proveedor sin reglas (el boton no aparece); confirmado que abrir el formulario en blanco para un alta manual tambien oculta/reinicia el boton correctamente.
- Bug de `mostrarProductos` confirmado reproducido antes del fix (`cargarProductos()` lanzaba `ReferenceError` en consola) y confirmado resuelto despues (recarga completa sin errores, dashboard/inventario bajo/categorias se actualizan).
- Modo claro y oscuro probados en las 2 pantallas nuevas (`pantallaReglasPrecios`, `pantallaAplicarPrecios`) y en el boton de sugerencia dentro de "Agregar producto". Sin scroll horizontal en ancho de escritorio normal (1440px).
- Se confirmo que Punto de venta, Caja, Creditos y Clientes siguen cargando sin errores de consola despues de todos estos cambios.
- No se hizo commit ni push -- pendiente de confirmacion explicita del usuario.

### Correccion de nombres corruptos ya guardados de Diprofer y modal de confirmacion de pago con Mixto

Tras desplegar el sistema de precios, el usuario probo la app real y reporto tres cosas mas.

**35 productos de Diprofer con nombre corrupto ya guardados en inventario real.** El arreglo de codificacion de la sesion anterior solo evita que se corrompan catalogos subidos de ahora en adelante -- no repara nombres que ya se guardaron mal antes del arreglo. Se confirmo con una consulta real que 35 productos de Diprofer (de un total revisado en toda la tabla) tenian el caracter de reemplazo `�` en el nombre. El usuario compartio el archivo original del catalogo de Diprofer (`catalogo_xls NUEVO.csv`); se leyo con la misma logica ya corregida (UTF-8 estricto con respaldo a Windows-1252), se cruzo cada uno de los 35 productos corruptos contra el catalogo por su codigo de barras (EAN), y se corrigio el campo `nombre` de los 35 con un script de una sola vez -- confirmado que los 35 coincidieron exactamente contra el catalogo (0 sin encontrar) y que despues del arreglo no queda ningun nombre corrupto en toda la tabla `productos`. El registro de ventas historicas (`historial_ventas.productos`) guarda una copia congelada del nombre al momento de cada venta -- esas copias historicas conservan el nombre viejo (corrupto si asi se vendio en su momento) a proposito, no se tocaron.

**Boton "Credito" en el carrito parecia estar "seleccionado".** Tenia un color azul claro fijo (para distinguirlo visualmente) que el usuario confundio con un estado activo/toggle, como si estuviera pre-seleccionado para cobrar a credito. Se cambio su estilo (`pos-cart.css`) al mismo gris neutro que usan Cotizar/Guardar/Cancelar -- ya no se distingue visualmente de los demas botones secundarios, pero sigue funcionando igual (abre el flujo de credito solo si se le da clic).

**Se investigo un reporte de "el carrito se limpio pero no salio el ticket" y se encontraron ventas duplicadas reales.** Revisando el historial de ventas real (solo lectura) se encontraron 4 ventas identicas del mismo producto (`Placa de ABS duplex, Standard, blanco VOLTECK`, $10), 3 de ellas en menos de 90 segundos, mismo cajero -- un patron clasico de "reintentar la venta porque no quedaba claro si ya se habia hecho". El usuario no estaba seguro si eran ventas reales o pruebas propias, asi que no se corrigio el stock (dato ambiguo, no se toca sin confirmacion clara). Se identifico ademas una debilidad real en `imprimirTicketPOS()`: la impresion via iframe (`iframe.contentWindow.print()`) se dispara dentro de un `setTimeout` desacoplado del valor de retorno de la funcion, asi que esta *siempre* reporta exito aunque la impresion real falle o no haya impresora configurada -- es una limitacion del navegador (`window.print()` no tiene forma de confirmar que imprimio de verdad), no algo que se pueda arreglar del todo, pero ya existe una red de seguridad: despues de cada venta aparece un modal "Venta completada" con boton "Reimprimir ticket" (`mostrarAccionesVentaCompletadaPOS()` en `sales-history-documents.js`). Tambien existe una casilla real "Imprimir al cobrar" en Configuracion (`configImprimirAutomatico`) que, si esta desmarcada, hace que nunca se intente imprimir automaticamente, sin ningun aviso -- es la explicacion mas simple y probable del reporte original.

**Se reconstruyo el modal de confirmacion de metodo de pago (con Mixto) que existia antes.** El usuario extraño el flujo viejo: un modal chico, navegable con las flechas del teclado, que servia como paso de confirmacion antes de cobrar (proteccion contra un clic/Enter accidental) y donde podia dividir el pago entre Efectivo/Tarjeta/Transferencia/Credito (Mixto). Ese modal vivia en `public/fase7-pagos.js`, desactivado esta misma sesion porque **interceptaba `window.fetch` y `window.cobrar` desde afuera** -- exactamente la causa raiz del bug del Enter doble que se arreglo antes. En vez de reactivar ese archivo, se reconstruyo la misma experiencia (mismas clases CSS, que ya existian sin usar en `pos-payment-modal.css`) como una funcion nativa nueva, `pedirMetodoPagoPOS(total, opciones)` en `public/js/pos-payment-modal.js`: una Promesa que muestra el modal, deja navegar los 5 metodos con flecha izquierda/derecha (excepto mientras se esta escribiendo en un campo numerico, para no interferir con el cursor), calcula el cambio o el faltante en vivo, y se resuelve con `{metodoPago, pagos, recibido, cambio}` o `{accion:"credito"}` o `null` si se cancela. A diferencia del sistema viejo, Enter confirma el modal **sin importar que campo tenga el foco** (el bug original era que Enter se ignoraba a proposito mientras se escribia en el campo de dinero de la pagina de atras -- aqui el modal es dueño exclusivo del Enter mientras esta abierto, no hay dos sistemas compitiendo). `cobrarInternoPOS()` (`pos-sales.js`) ahora llama a este modal en vez de leer directo el campo `#dinero` de la pantalla -- el panel inline de "Metodo de pago"/"Recibido" que ya existia se dejo tal cual, solo sirve ahora como precarga (lo que ya se habia seleccionado/escrito ahi se pasa como valor inicial del modal).

Validacion:

- `node --check` correcto en `pos-sales.js` y en el archivo nuevo `pos-payment-modal.js`.
- Reparacion de Diprofer: probado primero en modo solo-revision (mostrando "antes"/"despues" de los 35 sin tocar la base de datos), confirmado que los 35 coincidian exactamente contra el catalogo real antes de aplicar; despues de aplicar, confirmado con una consulta real que 0 productos en toda la tabla tienen el caracter corrupto.
- Boton Credito: confirmado visualmente en claro y oscuro que ahora tiene el mismo color que Cotizar/Guardar/Cancelar.
- Modal de pago probado a fondo: navegacion con flecha izquierda/derecha entre los 5 metodos (bloqueada correctamente mientras el foco esta en un campo numerico, para no chocar con el cursor); Mixto probado con math en vivo (Efectivo $10 + Tarjeta $5 = "Falta $14.00", agregar Transferencia $14 cambia a "Cambio $0.00"); intentar confirmar un Mixto incompleto muestra la alerta correcta y no cierra el modal; Credito resuelve `{accion:"credito"}` sin necesidad de escribir nada; Escape cancela con `null` sin tocar el carrito; Enter con el campo Recibido enfocado confirma en el primer intento (el escenario exacto del bug original) con el cambio calculado correctamente. Todo probado en modo aislado (llamando `pedirMetodoPagoPOS()` directo) para no generar ninguna venta real de prueba.
- Modo oscuro del modal confirmado visualmente (fondo oscuro, texto claro, tarjetas legibles).
- Se confirmo que Inventario, Creditos, Clientes y Caja siguen sin cambios.
- No se hizo commit ni push -- pendiente de confirmacion explicita del usuario.

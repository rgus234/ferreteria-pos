# Arquitectura de catálogo de funciones y planes

**Estado: preparación de arquitectura, sin enforcement.** Nada de lo
descrito aquí bloquea ni oculta ninguna función hoy. El sistema sigue
funcionando exactamente igual para todos los negocios, sin importar
lo que digan estas tablas. Este documento existe para que, cuando se
decida activar los planes comerciales, asignar cualquier función a
cualquier plan sea cuestión de cambiar datos, no de escribir código
nuevo.

Fecha: 16 jul 2026. Fuente: inventario directo del código +
[la nota de estrategia comercial](.) acordada con el dueño del
negocio (planes Básico / Plus / Pro).

---

## 1. Arquitectura propuesta

Cuatro tablas nuevas, aditivas, sin ninguna relación obligatoria con
las tablas existentes (`negocios`, `licencias`):

```
planes                 catalogo_funciones          categorias_funcion
├─ id                   ├─ id                       ├─ id
├─ clave (unico)         ├─ clave (unico)              ├─ clave (unico)
├─ nombre                 ├─ nombre                       ├─ nombre
├─ orden                   ├─ categoria_id ──────────────┘
└─ descripcion              ├─ descripcion
                              └─ estado (activo|en_desarrollo|planeado)
      │                          │
      └──────────┐    ┌──────────┘
                  ▼    ▼
              plan_funciones
              ├─ plan_id
              ├─ funcion_id
              ├─ incluido (bool)
              └─ limite_numerico (nullable)
```

**Por qué así:**

- **`catalogo_funciones` es la fuente de verdad de "qué existe".**
  Cada función real o planeada del sistema tiene una fila con una
  `clave` estable (ej. `catalogo.reglas_precio`,
  `ia.sugerencia_precio`) que nunca cambia aunque cambie el nombre
  mostrado al usuario. Cualquier código futuro que necesite
  preguntar "¿esta función existe/está lista?" lo hace por esa clave,
  no por texto libre.
- **`estado` distingue lo real de lo planeado** (`activo` /
  `en_desarrollo` / `planeado`). Evita que el catálogo mienta sobre
  qué se puede vender hoy — ahora mismo 9 de las 46 funciones
  registradas son `planeado` (IA Nexo, Banco Global de Imágenes, API,
  respaldos automáticos, manuales integrados) y 2 están
  `en_desarrollo` (Dashboard ejecutivo, Centro de Seguridad).
- **`plan_funciones` es la única tabla que sabe de planes.** Relaciona
  un plan con una función y dice si está incluida y, si aplica, con
  qué límite numérico (`limite_numerico`) — por ejemplo,
  `multiusuario.empleados_pin` está incluida en los tres planes, pero
  con límite 2 en Básico, 8 en Plus y sin límite en Pro. Cambiar a
  qué plan pertenece una función, o su límite, es un `UPDATE` de una
  fila — nunca un despliegue de código.
- **`negocios.plan` (ya existente) no se toca.** Hoy ese campo es
  texto libre y solo tiene el valor `"demo"` en producción. La tabla
  `planes` nueva es un catálogo independiente que se podrá relacionar
  por valor (`negocios.plan = planes.clave`) el día que se construya
  el enforcement real, sin necesitar otra migración para eso.
- **`features.js` (nuevo, sin usar todavía)** es la capa de lectura:
  `listarPlanes()`, `listarCatalogoFunciones()`,
  `funcionesDelPlan(clave)`. No se importa desde `server.js` en esta
  fase. Cuando llegue el momento de aplicar límites de verdad, el
  patrón natural es un middleware nuevo (ej.
  `requerirFuncionDelPlan('multiusuario.empleados_pin')`) que consulte
  esta capa — pero eso es trabajo futuro, deliberadamente fuera de
  este cambio.

Migración: `migrations/20260716_catalogo_funciones_planes.sql`
(esquema + siembra completa en un solo archivo, siguiendo el patrón
ya establecido del proyecto).

---

## 2. Catálogo completo de funciones existentes

46 funciones registradas, agrupadas en 22 categorías. "Básico / Plus /
Pro" refleja el mapeo ya acordado en la estrategia comercial — el
número entre paréntesis es el límite (`limite_numerico`) donde aplica.

### Ventas / Punto de venta (`ventas`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Notas de venta con autorización | `ventas.notas_autorizacion` | activo | ✓ | ✓ | ✓ |
| Punto de venta completo | `ventas.pos_completo` | activo | ✓ | ✓ | ✓ |
| Reimpresión de tickets | `ventas.reimpresion_tickets` | activo | ✓ | ✓ | ✓ |
| Venta por bolsa o pieza suelta | `ventas.venta_pieza` | activo | ✓ | ✓ | ✓ |

### Inventario (`inventario`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Ajustes de inventario | `inventario.ajustes_inventario` | activo | ✓ | ✓ | ✓ |
| Alertas de inventario bajo | `inventario.alertas_stock_bajo` | activo | ✓ | ✓ | ✓ |
| Catálogo de productos | `inventario.catalogo_productos` | activo | ✓ | ✓ | ✓ |
| Impresión de códigos de barras propios | `inventario.codigos_barras` | activo | ✓ | ✓ | ✓ |
| Foto de producto (individual) | `inventario.fotos_producto` | activo | ✓ | ✓ | ✓ |

### Catálogo de proveedor (`catalogo_proveedor`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Fotos de producto por lote | `catalogo.fotos_lote` | activo | — | ✓ | ✓ |
| Importación de listas de proveedor | `catalogo.importacion_listas` | activo | — | ✓ | ✓ |
| Reglas de precio automáticas | `catalogo.reglas_precio` | activo | — | ✓ | ✓ |
| Sincronización automática de catálogos | `catalogo.sync_automatica` | planeado | — | — | ✓ |

### Recepción de mercancía (`recepcion`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Recepción por XML CFDI / CSV | `recepcion.xml_csv` | activo | — | ✓ | ✓ |

### Créditos / Clientes (`creditos`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Clientes con crédito | `creditos.clientes` | activo | ✓ | ✓ | ✓ |
| Estado de cuenta en ticket | `creditos.estado_cuenta` | activo | ✓ | ✓ | ✓ |

### Caja (`caja`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Caja por método de pago | `caja.metodo_pago` | activo | ✓ | ✓ | ✓ |
| Turnos y cortes de caja | `caja.turnos` | activo | ✓ | ✓ | ✓ |

### Finanzas (`finanzas`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Cuentas por cobrar consolidadas | `finanzas.cuentas_por_cobrar` | activo | — | — | ✓ |
| Utilidad neta real | `finanzas.utilidad_neta` | activo | — | — | ✓ |

### Pedidos a proveedor (`pedidos`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Pedidos a proveedor | `pedidos.estadisticas` | activo | — | ✓ | ✓ |

### Proveedores (`proveedores`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Gestión de proveedores | `proveedores.gestion` | activo | ✓ | ✓ | ✓ |

### Reportes (`reportes`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Reportes esenciales | `reportes.basicos` | activo | ✓ | ✓ | ✓ |
| Reportes con comparativas | `reportes.comparativas` | activo | — | ✓ | ✓ |

### Dashboard ejecutivo (`dashboard_ejecutivo`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Dashboard ejecutivo | `dashboard_ejecutivo.panel` | en_desarrollo | — | — | ✓ |

### Multiusuario / PIN (`multiusuario`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Empleados con PIN sincronizado | `multiusuario.empleados_pin` | activo | ✓ (2) | ✓ (8) | ✓ |
| Permisos granulares por empleado | `multiusuario.permisos_granulares` | activo | — | ✓ | ✓ |
| Permisos por rol | `multiusuario.permisos_roles` | activo | ✓ | ✓ | ✓ |
| Login por PIN sin internet | `multiusuario.pin_offline` | activo | ✓ | ✓ | ✓ |

### Seguridad de cuenta (`seguridad`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Seguridad de la cuenta | `seguridad.cuenta` | activo | ✓ | ✓ | ✓ |
| Sesiones revocables | `seguridad.sesiones` | activo | ✓ | ✓ | ✓ |

### Gestión de dispositivos (`dispositivos`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Revocación remota de dispositivos | `dispositivos.revocacion_remota` | activo | — | ✓ | ✓ |
| Vinculación de equipo | `dispositivos.vincular` | activo | ✓ (1) | ✓ | ✓ |

### Centro de Seguridad (`centro_seguridad`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Centro de Seguridad | `centro_seguridad.panel_unificado` | en_desarrollo | — | — | ✓ |

### Licencias / Administración — interno (`admin_licencias`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Detección de anomalías | `admin.deteccion_anomalias` | activo | ✓ | ✓ | ✓ |
| Gestión de licencias | `admin.licencias` | activo | ✓ | ✓ | ✓ |

*Nota: estas dos funciones son infraestructura interna de soporte
(el panel "Nexo Admin"), no algo que el cliente ve o compra. Se
incluyeron en el catálogo para que quede completo, marcadas `true` en
los tres planes.*

### Sincronización y actualizaciones (`sync_actualizaciones`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Actualizaciones automáticas | `sync.actualizaciones_automaticas` | activo | ✓ | ✓ | ✓ |
| Sincronización de escritorio | `sync.escritorio` | activo | ✓ | ✓ | ✓ |

### Manuales y ayuda (`ayuda`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Manuales y tutoriales integrados | `ayuda.manuales` | planeado | ✓ | ✓ | ✓ |

### IA Nexo (`ia`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Detección de productos duplicados | `ia.deteccion_duplicados` | planeado | — | — | ✓ |
| Pronóstico de demanda | `ia.pronostico_demanda` | planeado | — | — | ✓ |
| Sugerencia inteligente de precio | `ia.sugerencia_precio` | planeado | — | — | ✓ |

### Banco Global de Imágenes (`banco_imagenes`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Banco Global de Imágenes | `banco_imagenes.compartido` | planeado | — | — | ✓ |

### API / Integraciones (`api`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| API de integraciones | `api.integraciones` | planeado | — | — | — |
| Panel de desarrollador | `api.panel_desarrollador` | planeado | — | — | — |

*No incluida en ningún plan por defecto — se vende como complemento
aparte (ver sección 5 de la nota de estrategia comercial).*

### Respaldos y continuidad (`respaldos`)

| Función | Clave | Estado | Básico | Plus | Pro |
|---|---|---|---|---|---|
| Respaldos automáticos | `respaldos.automaticos` | planeado | — | — | ✓ |

---

## 3. Funciones futuras: cómo se implementarían sin romper nada

Para las funciones marcadas `planeado`, esto es *solo el plan de
implementación* — nada de esto se construye en este cambio.

### IA Nexo (`ia.*`)

Viviría en un módulo nuevo `ia-server.js`, cargado exactamente igual
que `fase4-server.js`/`fase5-server.js` vía `cargarModulosPOS()` en
`server-modules.js` — el patrón ya existe, solo se agrega una llamada
más. Sus propias tablas usarían el prefijo `ia_` (ej.
`ia_sugerencias_precio`) para no mezclarse con nada existente. No
necesita tocar `server.js` en absoluto, solo `server-modules.js`.

### Banco Global de Imágenes (`banco_imagenes.compartido`)

La tabla `fotos_producto` actual es por negocio (`negocio_id`). El
banco global necesita una tabla nueva y separada, sin `negocio_id`
(ej. `banco_imagenes_producto`, indexada por código/SKU de proveedor
en vez de por negocio), y una ruta de consulta que primero busque ahí
antes de pedirle al negocio que suba su propia foto. No requiere
modificar `fotos_producto` — conviven como dos fuentes de imagen
distintas, la del banco global es "gratis" para el negocio, la propia
sigue funcionando igual que hoy.

### API pública (`api.*`)

Necesita, antes que nada, un modelo de autenticación por API key (no
existe hoy — todas las rutas actuales se resuelven por slug o por
sesión de cuenta, pensadas para el navegador, no para un tercero).
Requiere: tabla de `api_keys` por negocio, un middleware nuevo
`requerirApiKey`, límite de tasa dedicado, y documentación. Es, con
diferencia, la función futura de mayor esfuerzo de las cuatro.

### Centro de Seguridad (`centro_seguridad.panel_unificado`)

Es principalmente trabajo de frontend: ya existen todas las piezas de
datos por separado (`GET /cuenta/sesiones`, `GET /cuenta/dispositivos`,
`GET /admin/api/negocios` con detección de anomalías) — "Centro de
Seguridad" es una pantalla nueva en `account-view.js` que las junta y
les agrega alertas, no una arquitectura de datos nueva.

### Dashboard ejecutivo (`dashboard_ejecutivo.panel`)

Mismo caso: los datos de Finanzas (`fase5-server.js`) y Reportes ya
existen. "Dashboard ejecutivo" es una vista nueva que los consolida
con mejor diseño, no una fuente de datos nueva.

---

## 4. Recomendaciones para crecer sin reescribir el proyecto

Auditoría de código hecha en paralelo a este cambio — **hallazgos, no
correcciones aplicadas**. Nada de lo siguiente se tocó.

### Lo que ya está bien y conviene extender, no reinventar

- **`fase4-server.js` / `fase5-server.js` / `fase6-server.js` /
  `fase7-caja-server.js`**, cargados vía `cargarModulosPOS()` en
  `server-modules.js`, ya demuestran el patrón correcto para sacar
  rutas de `server.js` sin romper nada. Es el mismo patrón que se
  propone arriba para `ia-server.js`.
- **`GenericoParser`** (clase base de la que heredan
  `TruperParser`/`DiproferParser`/`GafiParser`/`VolteckParser`) es un
  buen ejemplo de evitar duplicación al agregar un proveedor nuevo.
- **`crearLimitadorPorIp()`** se reutiliza tal cual en 6+ límites de
  tasa distintos (login, registro, PIN de empleado, recuperación de
  contraseña...) sin duplicar lógica.
- **`hashPassword()`/`verificarPassword()`** (scrypt) se reutilizan
  para contraseña de cuenta y PIN de empleado sin reinventar hashing
  en cada lugar nuevo.

### Duplicación real encontrada

- **Dos rutas de creación de venta casi idénticas** en `server.js`
  (`INSERT INTO historial_ventas` en ~línea 3846 y otra vez en
  ~línea 4992), con el mismo listado de columnas repetido dos veces.
  Recomendación: extraer un helper `insertarHistorialVenta(client,
  datos)` compartido entre ambas rutas la próxima vez que se toque
  ese código — no ahora, para no mezclar este cambio con uno de
  comportamiento.

### Archivos que conviene dividir cuando se vuelva a tocar esa zona

- **`server.js` (6,764 líneas).** El monolito ya tiene una via de
  escape probada (`cargarModulosPOS`) — cada módulo nuevo (recepción,
  reportes, catálogo de proveedor, créditos...) es candidato a salir
  de ahí siguiendo el mismo patrón, sin necesidad de un rediseño.
- **`public/js/config-auth.js` (3,312 líneas).** Mezcla wizard de
  configuración inicial, diálogos genéricos del sistema
  (`dialogoPOS`), login por correo/contraseña, administración de
  empleados con PIN, y vinculación de dispositivo — cinco
  responsabilidades que no dependen mucho entre sí. Candidato natural
  a dividirse en `setup-wizard.js`, `system-dialogs.js`,
  `employees.js` y `device-link.js` el día que se vuelva a trabajar
  ahí a fondo.
- **`public/js/product-inventory.js` (3,955 líneas)**, el archivo de
  frontend más grande del proyecto — vale la pena revisarlo con
  calma la próxima vez que se le agregue algo grande, antes de seguir
  creciéndolo.

### Riesgos de escalabilidad que no son "duplicación" pero sí importan

- **No existe ningún framework de pruebas automatizadas.** `npm run
  check` solo corre `node --check` (verifica que el JavaScript sea
  sintácticamente válido, no que funcione). Toda la verificación de
  cada función nueva esta sesión se hizo a mano, con `curl` y con el
  navegador — funciona, pero no escala indefinidamente conforme el
  proyecto crece. Recomendación a futuro: al menos pruebas de
  integración para las rutas más sensibles (auth, ventas, licencias)
  antes de que el equipo crezca más allá de una persona tocando el
  código.
- **El cache-busting de `public/index.html` es manual** (~40
  `<script>`/`<link>` con `?v=fecha-descripcion` que hay que
  recordar subir a mano en cada cambio). Esta misma sesión causó dos
  bugs reales (JavaScript viejo corriendo en el navegador después de
  una edición, porque no se habia bumpeado la version) que costaron
  tiempo de depuración. Recomendación: cache-busting por hash de
  contenido del archivo (automático) en vez de una fecha escrita a
  mano, cuando se justifique meter un paso de build.
- **Dependencias del proyecto (`package.json`)**: `adm-zip`,
  `express`, `multer`, `pg`, `resend`, `sharp` — las seis están en
  uso real y verificable, ninguna sobra hoy.

---

## 5. Siguiente paso natural (no incluido en este cambio)

Cuando se decida activar el enforcement de planes de verdad:

1. Agregar un middleware `requerirFuncionDelPlan(clave)` que use
   `features.js` (ya construido) para consultar si
   `negocios.plan` incluye esa función, y aplicar el `limite_numerico`
   donde exista (ej. contar empleados activos antes de dejar crear
   uno nuevo).
2. Exponer `GET /admin/api/funciones` (protegido por `ADMIN_KEY`,
   igual que el resto del panel Nexo Admin) para poder ver y editar
   la matriz `plan_funciones` desde una pantalla en vez de SQL directo.
3. Decidir entonces, y solo entonces, qué mensaje ve un cliente
   Básico cuando toca algo de Plus/Pro (upsell en el momento, no un
   error genérico).

Ninguno de estos tres pasos requiere otra migración de esquema — el
catálogo ya está listo para soportarlos.

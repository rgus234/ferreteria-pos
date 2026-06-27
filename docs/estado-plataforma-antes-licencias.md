# Estado de Nexo POS antes de licencias

Este documento marca el punto de cierre de la base multi-cliente, desktop y sync antes de avanzar al sistema formal de licencias/suscripciones.

## Ya queda preparado

- Separacion por negocio mediante `negocio_slug`.
- Encabezado `x-negocio-slug` en las peticiones.
- App web en produccion con Render.
- Base PostgreSQL multi-cliente.
- Base local SQLite para la app instalada.
- Cola local de eventos offline.
- Sincronizacion de ventas, creditos, productos y clientes.
- Mapeo de IDs temporales locales a IDs reales de la nube.
- Cache local de productos y clientes.
- Indicador visual de estado de sync en la app desktop.
- Reintento manual de eventos con error.
- Check-in periodico de dispositivos.
- Endpoint de dispositivos por negocio.
- Instalador Windows preparado con Electron Builder.

## Lo que debe probarse antes del primer cliente

1. Instalar dependencias de desktop:
   ```bash
   cd apps/desktop
   npm install
   ```
2. Ejecutar la app:
   ```bash
   npm start
   ```
3. Activar con un `negocioSlug` real.
4. Crear productos con internet.
5. Crear ventas con internet.
6. Cortar internet.
7. Crear productos y ventas offline.
8. Cerrar y abrir la app.
9. Confirmar que los datos locales siguen visibles.
10. Volver a internet.
11. Presionar el chip de sync.
12. Confirmar que pendientes quedan en cero.
13. Confirmar en la web que los datos ya estan en la nube.
14. Revisar `/dispositivos` para confirmar ultimo check-in, version, pendientes y errores.

## Riesgos que siguen abiertos

- Conflictos avanzados: si dos equipos editan el mismo producto al mismo tiempo, todavia falta una politica formal de resolucion.
- Impresion local: la app ya puede abrir el POS, pero falta pulir impresoras/tamano ticket desde Electron.
- Actualizaciones automaticas: existe base de versionado, pero todavia falta descargar/instalar versiones desde la app.
- Licencias: ya existe la base inicial y cache local, pero falta la logica comercial completa de planes, pagos, vencimientos y modo limitado.

## Siguiente etapa

La siguiente etapa recomendada es construir licencias:

- Planes.
- Suscripcion activa/vencida.
- Periodo de gracia.
- Avisos al cliente.
- Modo limitado sin borrar datos.
- Panel interno para administrar clientes, pagos y dispositivos.

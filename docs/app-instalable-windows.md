# Nexo POS instalable para Windows

## Objetivo

Preparar Nexo POS para funcionar como aplicacion instalada en Windows con control de licencia, dispositivos, actualizaciones y sincronizacion local/nube.

## Decision tecnica

Primera version recomendada: Electron + SQLite local + API nube.

- Electron permite convertir el POS actual en `NexoPOS_Setup.exe`.
- SQLite guarda datos locales sin instalar PostgreSQL en la PC del cliente.
- La nube sigue siendo respaldo, panel del dueno, licencias y actualizaciones.

## Carpeta creada

La base de la app Windows vive en:

```text
apps/desktop/
```

Esta carpeta tiene su propio `package.json` para no afectar el despliegue de Render. Render sigue usando el `package.json` principal del proyecto.

## Probar app desktop en desarrollo

Desde la raiz del proyecto:

```bash
cd apps/desktop
npm install
npm run rebuild
npm start
```

`npm run rebuild` recompila dependencias nativas como SQLite para Electron. Si no se ejecuta, en algunas maquinas Windows la app puede abrir pero fallar al crear la base local.

Primer arranque:

1. Escribe la URL del servidor, por ejemplo `https://ferreteria-pos.onrender.com`.
2. Escribe el codigo del negocio, por ejemplo `ferreteria-olimpico`.
3. Escribe el nombre del equipo, por ejemplo `Caja principal`.
4. La app llama a `/dispositivos/activar`.
5. Si activa correctamente, abre el POS con `?desktop=1&negocio=...`.

## Generar instalador Windows

Cuando ya este lista para empaquetar:

```bash
cd apps/desktop
npm run dist
```

El instalador esperado queda como:

```text
apps/desktop/dist/NexoPOS_Setup_0.1.0.exe
```

## Nuevas piezas de backend

- `licencias`: estado comercial del negocio.
- `dispositivos`: cada PC instalada del cliente.
- `sync_eventos`: cola de operaciones local/nube.
- `app_versiones`: versiones disponibles para actualizar.

## Endpoints base

- `GET /licencia/estado`: devuelve plan, vencimiento, gracia y modo operativo.
- `POST /dispositivos/activar`: registra una PC instalada y devuelve `device_id`.
- `POST /dispositivos/checkin`: actualiza ultima conexion y version instalada.
- `POST /sync/push`: recibe eventos locales pendientes.
- `GET /sync/pull`: devuelve eventos nuevos del negocio para otro dispositivo.
- `GET /updates/latest`: consulta la ultima version publicada por canal/plataforma.

Todas las llamadas deben mandar:

- `x-negocio-slug`: codigo del negocio.
- `x-device-id`: identificador de la PC instalada, cuando aplique.

## Flujo base

1. La app instalada arranca y tiene un `device_id`.
2. Llama a `/dispositivos/activar`.
3. Consulta `/licencia/estado`.
4. Si no hay internet, usa la ultima licencia valida guardada localmente.
5. Cada venta o movimiento local genera un evento con `event_id`.
6. Cuando hay internet, manda eventos a `/sync/push`.
7. La nube ignora duplicados por `event_id`.
8. La app consulta `/updates/latest` para saber si hay nueva version.

## Base local SQLite

La app desktop crea una base local en la carpeta de datos del usuario de Windows:

```text
%APPDATA%\Nexo POS\nexo-pos-local.sqlite
```

Tablas locales iniciales:

- `settings`: configuracion local de la app.
- `device_state`: equipo activado, negocio y servidor.
- `license_cache`: ultima licencia valida consultada.
- `sync_outbox`: eventos creados localmente pendientes de subir.
- `sync_inbox`: eventos recibidos desde la nube.

APIs disponibles dentro de Electron:

- `window.nexoDesktop.licenseStatus()`
- `window.nexoDesktop.queueEvent({...})`
- `window.nexoDesktop.syncPush()`
- `window.nexoDesktop.syncPull()`
- `window.nexoDesktop.syncStats()`

Nota: esta fase crea la base y la cola offline. El siguiente paso es conectar ventas, inventario, clientes y creditos reales del POS a esta cola.

## Reglas de licencia

- Los datos nunca se borran por falta de pago.
- Si la licencia vence, se permite periodo de gracia.
- Despues del periodo de gracia, la app debe activar modo limitado.
- La nube devuelve `modo: normal`, `gracia`, `limitado` o `bloqueado`.

## Pendiente despues de esta fase

- SQLite local.
- Motor que aplique eventos a inventario/ventas/creditos.
- Auto-update firmado.
- Panel admin para editar licencias, pagos y versiones.

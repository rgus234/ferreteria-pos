# Instalacion del primer cliente

Checklist rapido para instalar Nexo POS con un cliente real.

## 1. Antes de ir con el cliente

En Render, confirma variables:

- `DATABASE_URL`
- `PGSSLMODE=require`
- `APP_ENV=production`
- `APP_NAME=Nexo POS`
- `APP_VERSION=1.0.0`
- `ADMIN_KEY` con una clave larga

Despues haz deploy desde `main`.

## 2. Probar que la nube esta viva

Abrir:

```text
https://ferreteria-pos.onrender.com/health
```

Debe responder:

```json
{ "ok": true, "database": "connected" }
```

## 3. Entrar al panel de desarrollador

Abrir:

```text
https://ferreteria-pos.onrender.com/admin/
```

El navegador pedira la clave `ADMIN_KEY`.

Desde ahi puedes editar:

- Estado del negocio.
- Plan.
- Estado de licencia.
- Mensualidad.
- Fecha de vencimiento.
- Ultimo pago.
- Dias de gracia.
- Notas internas.

## 4. Configurar licencia del cliente

Para instalar sin problemas:

- `Estado negocio`: Activo
- `Plan`: Ferreteria Pro o Ferreteria Base
- `Estado licencia`: Activa
- `Mensualidad`: monto acordado
- `Vence`: fecha del siguiente corte
- `Dias de gracia`: 7, 15 o el valor que decidas

## 5. Probar POS web

Abrir:

```text
https://ferreteria-pos.onrender.com/?negocio=ferreteria-olimpico
```

Si es otro cliente, cambia el slug.

## 6. Preparar app de Windows

En tu computadora:

```bash
cd apps/desktop
npm install
npm run check
npm run rebuild
npm start
```

Para generar instalador:

```bash
cd apps/desktop
npm run dist:win
```

Desde la raiz tambien puedes ejecutar:

```bash
npm run desktop:dist
npm run desktop:release
```

El instalador saldra en:

```text
apps/desktop/dist/
```

El nombre esperado para esta version es:

```text
apps/desktop/dist/NexoPOS_Setup_1.0.0.exe
```

Si tu disco `C:` esta lleno y npm falla con `ENOSPC`, usa cache temporal en `D:`:

```powershell
$env:LOCALAPPDATA='D:\Desarrollo\LocalAppData'
$env:npm_config_cache='D:\Desarrollo\npm-cache'
$env:ELECTRON_CACHE='D:\Desarrollo\electron-cache'
$env:ELECTRON_BUILDER_CACHE='D:\Desarrollo\electron-builder-cache'
$env:TEMP='D:\Desarrollo\tmp'
$env:TMP='D:\Desarrollo\tmp'
npm run desktop:dist
```

Nota: el instalador actual es funcional, pero todavia no esta firmado digitalmente. Windows puede mostrar aviso de seguridad la primera vez.

## 6.1. Publicar archivos de actualizacion

Antes del deploy, confirma que existen:

```text
public/downloads/NexoPOS_Setup_1.0.0.exe
public/downloads/NexoPOS_Setup_1.0.0.exe.blockmap
public/downloads/latest.yml
public/downloads/release.json
```

Estos archivos se generan localmente, pero el instalador no se versiona en Git por tamano. Para que el auto-update funcione en produccion, publica esos archivos en el hosting de descargas configurado antes de entregar una nueva version.

Despues del deploy, abre:

```text
https://ferreteria-pos.onrender.com/downloads/latest.yml
```

Debe responder el YAML de Electron con `version: 1.0.0`.

## 7. Activar en la computadora del cliente

Al abrir la app instalada, captura:

- URL servidor: `https://ferreteria-pos.onrender.com`
- Negocio slug: el slug del cliente
- Nombre equipo: nombre de la computadora

Despues inicia sesion con el usuario creado en el POS.

## 8. Prueba obligatoria en sitio

1. Crear un producto.
2. Hacer una venta.
3. Imprimir ticket.
4. Abrir panel `/admin/` y confirmar que el equipo aparece con:
   - version instalada
   - ultima conexion
   - ultima sync
   - sistema operativo
   - estado de licencia
5. Desconectar internet.
6. Navegar por inventario, ventas y clientes para validar cache local.
7. Reconectar internet.
8. Presionar el chip de sync.
9. Confirmar que pendientes quedan en cero.
10. Confirmar en Render que `/health` sigue en `ok: true`.
11. Confirmar que `/downloads/latest.yml` carga desde internet.
12. Confirmar que `/updates/latest?canal=stable&plataforma=windows&currentVersion=0.9.0` devuelve `updateAvailable: true`.

## 9. Si algo falla

- Si no abre el admin: revisar `ADMIN_KEY`.
- Si no carga el POS: revisar `/health`.
- Si no guarda datos: revisar `DATABASE_URL`.
- Si la app desktop no abre: ejecutar `npm install` en `apps/desktop`.
- Si sync queda con error: abrir el chip de sync y reintentar.

## 10. Antes de salir del negocio

- Hacer una venta real pequena y entregar ticket.
- Validar que el ticket salga en tamano termico de la impresora del cliente.
- Confirmar que el inventario bajo cambie si aplica.
- Confirmar que el panel admin muestra ultima conexion reciente.
- Confirmar que la licencia queda activa y con fecha de vencimiento correcta.
- Anotar el nombre de la PC, usuario del POS y telefono del encargado.

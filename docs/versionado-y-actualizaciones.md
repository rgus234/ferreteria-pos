# Versionado y actualizaciones de Nexo POS

Esta guia documenta el flujo real para publicar instaladores de Windows y permitir actualizaciones automaticas con `electron-updater`.

## Version actual

La version base estable queda en:

```text
1.0.0
```

Debe coincidir en:

- `package.json`
- `apps/desktop/package.json`
- `render.yaml`
- variable `APP_VERSION` en Render
- `public/downloads/latest.yml`

## Regla de versionado

Usar versionado semantico:

- `1.0.1`: correccion pequena sin cambiar flujo.
- `1.1.0`: mejora compatible, por ejemplo nuevo reporte o pantalla.
- `2.0.0`: cambio grande que puede modificar datos, instalador o contratos.

## Generar instalador

Desde la raiz:

```bash
cd apps/desktop
npm install
npm run check
npm run rebuild
npm run dist:win
```

Si Windows o npm reportan `ENOSPC`, mueve cache y temporales a `D:` antes de construir:

```powershell
$env:LOCALAPPDATA='D:\Desarrollo\LocalAppData'
$env:npm_config_cache='D:\Desarrollo\npm-cache'
$env:ELECTRON_CACHE='D:\Desarrollo\electron-cache'
$env:ELECTRON_BUILDER_CACHE='D:\Desarrollo\electron-builder-cache'
$env:TEMP='D:\Desarrollo\tmp'
$env:TMP='D:\Desarrollo\tmp'
npm run desktop:dist
```

Salida esperada:

```text
apps/desktop/dist/NexoPOS_Setup_1.0.0.exe
apps/desktop/dist/NexoPOS_Setup_1.0.0.exe.blockmap
apps/desktop/dist/latest.yml
```

Despues prepara los archivos que se serviran desde la nube:

```bash
npm run desktop:release
```

Esto copia a:

```text
public/downloads/NexoPOS_Setup_1.0.0.exe
public/downloads/NexoPOS_Setup_1.0.0.exe.blockmap
public/downloads/latest.yml
public/downloads/release.json
```

El instalador y los manifiestos generados no se suben a Git porque el `.exe` es pesado. Para publicar una version nueva, copia el contenido generado de `public/downloads/` al hosting que sirve `/downloads/`.

## Registrar una version para el panel

Cuando exista un instalador publicado, registrar en `app_versiones`:

```sql
INSERT INTO public.app_versiones
    (version, canal, plataforma, url_descarga, archivo, notas, obligatoria, publicada)
VALUES
    ('1.0.0', 'stable', 'windows', 'https://TU-DOMINIO/downloads/NexoPOS_Setup_1.0.0.exe', 'NexoPOS_Setup_1.0.0.exe', 'Primer instalador estable', false, true)
ON CONFLICT (version, canal, plataforma)
DO UPDATE SET
    url_descarga = EXCLUDED.url_descarga,
    archivo = EXCLUDED.archivo,
    notas = EXCLUDED.notas,
    obligatoria = EXCLUDED.obligatoria,
    publicada = EXCLUDED.publicada;
```

## Auto-update

La app instalada hace este flujo:

1. Consulta `/updates/latest` para que el panel admin sepa si hay una version nueva.
2. Si esta empaquetada como app de Windows, `electron-updater` consulta:

```text
https://ferreteria-pos.onrender.com/downloads/latest.yml
```

3. Si hay una version nueva, descarga automaticamente el instalador.
4. Cuando termina la descarga, reinicia la app e instala la actualizacion.
5. La base local queda en `%APPDATA%\\Nexo POS`, separada del codigo, por lo que no se borra al actualizar.

## Que ya queda terminado

- La app Windows consulta `GET /updates/latest`.
- `electron-updater` descarga e instala nuevas versiones desde `/downloads/`.
- Se genera `latest.yml` y `.blockmap`.
- El servidor compara la version instalada contra la ultima publicada.
- El dispositivo reporta al panel:
  - version instalada
  - version mas nueva disponible
  - si hay actualizacion pendiente
  - sistema operativo
  - arquitectura
  - fecha de instalacion
  - ultima conexion
  - ultima sincronizacion
- El instalador usa icono personalizado desde `apps/desktop/build/icon.ico`.

## Firma digital

El instalador actual se genera sin firma digital porque falta comprar/configurar el certificado.

Para firmar en el futuro:

1. Comprar certificado Code Signing para Windows.
2. Configurar variables antes del build:

```powershell
$env:CSC_LINK='D:\ruta\certificado.pfx'
$env:CSC_KEY_PASSWORD='password-del-certificado'
```

3. Generar instalador firmado:

```bash
cd apps/desktop
npm run dist:win:signed
```

Mientras no haya certificado, usar:

```bash
npm run desktop:dist
```

Windows puede mostrar aviso de seguridad en instaladores sin firma. Eso no rompe la app, pero para venta comercial conviene firmar antes de escalar.

## Regla de seguridad

Nunca se deben guardar secretos dentro del frontend ni del instalador. La app instalada solo debe conocer:

- URL del servidor.
- slug del negocio.
- device_id local.
- token/sesion si se agrega login avanzado.

Las claves sensibles viven en Render como variables de entorno.

# Versionado y actualizaciones de Nexo POS

Esta guia deja preparada la base para publicar instaladores de Windows y, en una fase posterior, activar actualizaciones automaticas.

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
```

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

## Que ya queda preparado

- La app Windows consulta `GET /updates/latest`.
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

## Que falta para auto-update real

1. Agregar `electron-updater`.
2. Publicar instaladores y metadatos `latest.yml` en una URL estable.
3. Configurar firma de codigo para Windows.
4. Mostrar aviso visual en la app cuando `updateAvailable` sea true.
5. Descargar update.
6. Reiniciar la app al terminar.
7. Probar que la base local SQLite no se borra entre versiones.

## Regla de seguridad

Nunca se deben guardar secretos dentro del frontend ni del instalador. La app instalada solo debe conocer:

- URL del servidor.
- slug del negocio.
- device_id local.
- token/sesion si se agrega login avanzado.

Las claves sensibles viven en Render como variables de entorno.

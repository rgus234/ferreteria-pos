# Descargas de Nexo POS

Esta carpeta es el destino local de `npm run desktop:release`.

Los instaladores, blockmaps y manifiestos generados no se versionan en Git porque el instalador de Windows supera el limite practico de GitHub. Para publicar una actualizacion hay que copiar el contenido generado de esta carpeta al hosting de descargas configurado para Electron:

`https://ferreteria-pos.onrender.com/downloads/`

Archivos esperados despues de generar una version:

- `NexoPOS_Setup_<version>.exe`
- `NexoPOS_Setup_<version>.exe.blockmap`
- `latest.yml`
- `release.json`

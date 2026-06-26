# Pruebas de Nexo POS Desktop + Sync

Esta guia sirve para probar una instalacion local de Nexo POS antes de entregarla a un cliente.

## 1. Preparar ambiente

1. Verifica que la app web de produccion tenga `DATABASE_URL` correcto.
2. Verifica que el negocio tenga `negocio_slug` unico.
3. Activa la app desktop con:
   - `negocioSlug`
   - `deviceId`
   - `apiBaseUrl`
4. Entra al POS y confirma que el topbar muestre el chip de sync.

## 2. Prueba con internet

1. Agrega un producto nuevo.
2. Edita el producto.
3. Crea un cliente de credito.
4. Haz una venta normal.
5. Haz una venta a credito.
6. Presiona el chip de sync.
7. Confirma que el estado quede como `Sincronizado`.
8. En la version web, refresca y confirma que los datos aparezcan.

## 3. Prueba sin internet

1. Desconecta internet.
2. Agrega un producto.
3. Edita un producto existente.
4. Haz una venta.
5. Haz un cargo a credito.
6. Confirma que el chip marque `Local` o pendientes.
7. Cierra y abre la app.
8. Confirma que los productos, clientes y datos locales sigan visibles.

## 4. Volver a internet

1. Conecta internet.
2. Presiona el chip de sync o espera hasta 30 segundos.
3. Confirma que los pendientes bajen a cero.
4. Refresca la version web.
5. Confirma que los datos offline ya existan en la nube.

## 5. Prueba multi cliente

1. Activa una instalacion con `negocioSlug` del cliente A.
2. Crea productos y ventas.
3. Activa otra instalacion o navegador con `negocioSlug` del cliente B.
4. Confirma que el cliente B no vea productos, ventas, creditos ni usuarios del cliente A.
5. Repite la prueba con ventas offline y sincronizacion.

## 6. Senales de problema

- El chip queda en `Revisar sync`.
- Un producto aparece duplicado despues de sincronizar.
- Una venta offline no aparece en reportes despues de volver internet.
- Un negocio ve datos de otro negocio.
- La app desktop pierde datos despues de cerrar.

Si pasa cualquiera de estos puntos, no entregar esa version al cliente todavia.

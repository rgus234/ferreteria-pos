# Copia aislada de Nexo

Una base de datos aparte, en tu computadora, para probar sin tocar la real.

## Usarla

```
npm run copia
```

Abre http://localhost:3200. La primera vez crea todo; después solo arranca.

| Negocio de ejemplo | Correo | Para probar |
|---|---|---|
| Tienda Nueva (abarrotes, vacía) | copia-tienda-nueva@copia.test | meter el primer producto |
| Ferretería de 20 años (vacía) | copia-ferreteria@copia.test | cargar inventario |
| Tienda con productos | copia-con-productos@copia.test | vender y cobrar |

Contraseña: `Copia-12345`. PIN del administrador: `1234`. Solo existen en la copia.

Otros comandos: `npm run copia:probar` (comprueba que sirve) y `npm run copia:reiniciar` (la borra y la vuelve a crear con las tablas actuales).

## Qué tiene y qué no

- Se lee de la base real **solo** la forma de las tablas y las tablas de referencia (planes, funciones, categorías, catálogo maestro). Ningún negocio, venta, cliente, persona ni correo.
- `.env.copia` no lleva llaves de correo, cobros (Stripe), IA, notificaciones ni Taecel. Desde la copia no se manda ni se cobra nada. Por lo mismo, ahí no funcionan Nexo IA, el cobro en línea ni los correos.
- No trae fotos del banco de imágenes.
- Candado: si `NEXO_COPIA_AISLADA` está puesto y la base no es local, el servidor no arranca.
- Los datos viven en `D:\nexo-copia` y Postgres escucha solo en esta computadora (puerto 5440).

## Las pruebas

- `npm test` usa la copia (la arranca sola). `npm test -- tests/caja.test.js` corre solo ese archivo.
- `npm run test:real` las corre contra la base real, a propósito. Crea negocios de prueba y los borra.
- En la copia se saltan 4 pruebas de exhibidores que necesitan las fotos del Banco de Nexo.
- El servidor normal (`.env`) sigue usando la base real.

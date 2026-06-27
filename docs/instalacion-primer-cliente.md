# Instalacion del primer cliente

Checklist rapido para instalar Nexo POS con un cliente real.

## 1. Antes de ir con el cliente

En Render, confirma variables:

- `DATABASE_URL`
- `PGSSLMODE=require`
- `APP_ENV=production`
- `APP_NAME=Nexo POS`
- `APP_VERSION=0.1.0`
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
npm start
```

Para generar instalador:

```bash
cd apps/desktop
npm run dist
```

El instalador saldra en:

```text
apps/desktop/dist/
```

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
4. Abrir panel `/admin/` y confirmar que el equipo aparece.
5. Desconectar internet.
6. Hacer una venta offline.
7. Reconectar internet.
8. Presionar el chip de sync.
9. Confirmar que pendientes quedan en cero.

## 9. Si algo falla

- Si no abre el admin: revisar `ADMIN_KEY`.
- Si no carga el POS: revisar `/health`.
- Si no guarda datos: revisar `DATABASE_URL`.
- Si la app desktop no abre: ejecutar `npm install` en `apps/desktop`.
- Si sync queda con error: abrir el chip de sync y reintentar.

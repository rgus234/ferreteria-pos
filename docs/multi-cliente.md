# Nexo POS multi-cliente

## Objetivo

Preparar Nexo POS para que un solo servidor pueda atender varios negocios sin mezclar productos, ventas, creditos, proveedores ni reportes.

## Modelo base

La tabla principal es `negocios`.

Cada negocio tiene:

- `id`: identificador interno.
- `slug`: clave legible para URL o configuracion, por ejemplo `ferreteria-olimpico`.
- `nombre`: nombre comercial del cliente.
- `giro`: por ahora `ferreteria`, despues puede ser `abarrotes`, `papeleria`, etc.
- `estado`: `activo`, `prueba`, `suspendido`.
- `plan`: plan comercial contratado.

Las tablas operativas principales ahora quedan ligadas con `negocio_id`:

- `productos`
- `producto_codigos`
- `ventas`
- `historial_ventas`
- `usuarios`
- `clientes_credito`
- `movimientos_credito`
- `proveedores`

## Como se selecciona el negocio

Por ahora el backend acepta estas formas:

- Header HTTP: `x-negocio-slug: ferreteria-olimpico`
- Query string: `?negocio=ferreteria-olimpico`
- Body JSON: `negocioSlug`
- Fallback automatico: `ferreteria-olimpico`

Esto permite que el primer cliente siga funcionando sin cambios, pero deja lista la puerta para:

- `app.nexopos.com/` con negocio detectado por login.
- `app.nexopos.com/?negocio=cliente-demo` para pruebas.
- Instalaciones locales que manden `x-negocio-slug`.

## Regla de seguridad

Toda consulta de datos operativos debe filtrar por `negocio_id`.

Ejemplo correcto:

```sql
SELECT *
FROM public.productos
WHERE negocio_id = $1;
```

Ejemplo incorrecto:

```sql
SELECT *
FROM public.productos;
```

## Fase actual

Ya esta preparada la base multi-cliente del nucleo:

- Productos.
- Codigos alternos.
- Ventas.
- Historial.
- Login.
- Creditos.
- Proveedores.
- Dashboard.
- Reportes.
- Recepcion de mercancia.
- Pedidos a proveedor.
- Ajustes de inventario.
- Finanzas.
- Caja y cortes.

## Pendiente fase 3

Los modulos siguientes son la siguiente capa para venderlo a muchos clientes:

- Login con seleccion de negocio o subdominio.
- Roles por negocio sin usuario global unico.
- Panel admin interno conectado a negocios reales.
- Dispositivos instalados por cliente.
- Cola de sincronizacion local/nube.

## Camino a modo local + nube

Para instalar Nexo POS en la computadora del cliente y sincronizar con internet, la recomendacion es:

1. Mantener la nube como fuente de respaldo y panel del dueno.
2. Crear una app local con base local.
3. Guardar cada operacion local en una cola `sync_eventos`.
4. Cuando vuelva internet, enviar eventos pendientes a la nube.
5. La nube responde con cambios nuevos para inventario, creditos, clientes y ventas.
6. Cada evento debe llevar `negocio_id`, `device_id`, `event_id` y fecha.

## Actualizaciones

Para enviar mejoras sin instalar todo a mano:

1. Separar ramas `dev` y `main`.
2. Render produccion solo despliega `main`.
3. La PC del cliente usa version estable.
4. Las actualizaciones locales se distribuyen con instalador/versionador.
5. El panel admin interno debe mostrar version instalada por cliente.

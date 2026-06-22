# Flujo DEV / PROD para Nexo POS

## Objetivo

Mantener una version de desarrollo para cambios diarios y una version estable de produccion para clientes reales.

## Ambientes

### DEV

- Corre en la computadora del desarrollador.
- Usa `.env`.
- Usa una base de datos de pruebas.
- Puede tener cambios incompletos.
- Rama sugerida: `dev`.

### PROD

- Corre en internet para clientes.
- Usa `.env.production` o variables del proveedor de hosting.
- Usa una base de datos exclusiva del cliente.
- Solo se actualiza desde `main` cuando el cambio ya fue probado.
- Rama sugerida: `main`.

## Primer cliente

Para el primer cliente conviene usar una base separada:

- App: `nexo-pos-prod`
- Base: `nexo_pos_cliente_001`
- Usuario de base: limitado a esa base
- Dominio sugerido: `app.nexopos.mx`

Esto evita mezclar datos reales con pruebas y facilita respaldos.

## Git

Flujo recomendado:

1. Trabajar cambios en `dev`.
2. Probar local con `npm run dev`.
3. Revisar sintaxis con `npm run check`.
4. Hacer commit.
5. Mezclar a `main` solo cuando este aprobado.
6. Crear tag de release, por ejemplo `v0.1.0`.
7. Desplegar produccion desde `main`.

## Variables de entorno

No subir `.env` ni `.env.production` a Git.

Usar `.env.example` como molde.

Variables actuales:

- `APP_NAME`
- `APP_ENV`
- `APP_VERSION`
- `PORT`
- `DATABASE_URL`
- `PGSSLMODE`

## Checklist antes de produccion

- `npm run check` pasa sin errores.
- `/health` responde `ok: true`.
- `.env` real no esta en Git.
- Base PROD es diferente a base DEV.
- Hay respaldo de la base antes de actualizar.
- La version PROD tiene tag en Git.

## Siguiente fase tecnica

Antes del modo offline real:

- Mover migraciones SQL fuera de `server.js`.
- Agregar transacciones a ventas, creditos y movimientos de inventario.
- Agregar `uuid`, `created_at`, `updated_at` y `deleted_at` a tablas principales.
- Preparar tablas `sync_devices`, `sync_events` y `sync_queue`.
- Separar datos por cliente con base independiente o `tenant_id`.

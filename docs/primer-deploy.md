# Primer deploy de Nexo POS

## Meta

Publicar una version estable para el primer cliente sin bloquear el desarrollo local.

## Orden recomendado

1. Trabajar cambios en `dev`.
2. Probar local:

```bash
npm run check
npm run check:env
npm run dev
```

3. Crear respaldo de la base si ya hay datos reales.
4. Mezclar `dev` hacia `main` cuando este aprobado.
5. Crear tag de version:

```bash
git tag v0.1.0
```

6. Desplegar desde `main`.

## Hosting sugerido para el primer cliente

Para empezar rapido:

- App Node/Express: Render Web Service.
- Base de datos: PostgreSQL administrado.
- Variables: configuradas en el panel del proveedor, no en Git.
- Health check: `/health`.

## Estado del repositorio

Ramas remotas esperadas:

- `main`: produccion estable.
- `dev`: desarrollo y pruebas.

Tag base:

- `v0.1.0-preprod`

Para desplegar el primer cliente, conectar el proveedor de hosting a `main`, no a `dev`.

## Variables requeridas en PROD

- `APP_NAME=Nexo POS`
- `APP_ENV=production`
- `APP_VERSION=0.1.0`
- `DATABASE_URL=...`
- `PGSSLMODE=require`

## Validaciones despues del deploy

Abrir:

```text
https://TU-DOMINIO/health
```

Debe responder:

```json
{
  "ok": true,
  "app": "Nexo POS",
  "env": "production",
  "database": "connected"
}
```

## Regla de oro

Nunca probar cambios nuevos directamente en la base del cliente.

## Checklist de Render

1. Crear Web Service desde GitHub.
2. Seleccionar rama `main`.
3. Build command:

```bash
npm ci
```

4. Start command:

```bash
npm start
```

5. Agregar variables de entorno reales.
6. Confirmar que `/health` responde `ok: true`.
7. Entrar al POS y hacer una venta de prueba pequeña solo en base de pruebas.

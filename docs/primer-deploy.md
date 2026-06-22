# Primer deploy de Nexo POS

## Meta

Publicar una version estable para el primer cliente sin bloquear el desarrollo local.

## Orden recomendado

1. Trabajar cambios en `dev`.
2. Probar local:

```bash
npm run check
npm run check:env
npm start
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

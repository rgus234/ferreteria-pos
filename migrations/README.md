# Migraciones de base de datos

Aqui van los cambios versionados de PostgreSQL para Nexo POS.

Formato recomendado:

```text
000001_descripcion_corta.sql
000002_otra_descripcion.sql
```

Reglas:

- No editar una migracion ya aplicada en produccion.
- Crear una migracion nueva para cada cambio de estructura.
- Probar primero en DEV.
- Hacer respaldo antes de aplicar migraciones en PROD.

Comandos:

```bash
npm run migrate
npm run migrate:prod
```

El script registra migraciones aplicadas en `public.schema_migrations`.

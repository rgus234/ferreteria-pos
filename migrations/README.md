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

Migraciones actuales relevantes:

- `20260624_multi_tenant_base.sql`: separa datos por negocio.
- `20260625_app_instalable_base.sql`: licencias, dispositivos, sync y versiones.
- `20260627_licencias_alta_clientes.sql`: claves unicas de licencia para activar instalaciones reales.

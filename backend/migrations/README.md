# Migrations

## Aplicar Stage 2 (indices de performance)
1. Verifica que `DATABASE_URL` apunte a la base correcta.
2. Ejecuta:

```bash
psql "$DATABASE_URL" -f backend/migrations/20260211_stage2_performance_indexes.sql
```

## Verificacion rapida
```sql
\d+ productos
\d+ cotizaciones
\d+ cotizacion_items
```

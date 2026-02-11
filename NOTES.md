Riesgo crítico detectado:
- El backend sigue levantando el servidor HTTP aunque falle la conexión a PostgreSQL en `initDB()`.
- En ese estado, varias rutas responden 500 en runtime y el login puede quedar parcialmente operativo (rate limit sí, autenticación no).
- Recomendación para etapa posterior: fail-fast de arranque cuando DB no esté disponible.

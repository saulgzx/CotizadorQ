Arranque sin base de datos (resuelto):
- Antes, el backend levantaba el servidor HTTP aunque PostgreSQL no respondiera, y varias rutas quedaban respondiendo 500.
- Ahora `startServer` hace `SELECT 1` antes de abrir HTTP, con `DB_CONNECT_RETRIES` intentos (default 5) y espera creciente (`DB_CONNECT_RETRY_DELAY_MS` × intento, default 3000 ms; ~30 s en total). Si no hay conexión, el proceso termina con código 1 y Railway lo reinicia.
- Con conexión, los pasos de migración siguen aislados: si falla un ALTER dentro de `initDB()`, se registra y el arranque continúa; `ensureCotizacionNumero` (folio) y `ensureCotizacionEdicion` corren igual.

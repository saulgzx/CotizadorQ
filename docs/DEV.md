# Dev y Validacion

## Requisitos
- Node.js 18+
- npm 9+

## Backend
```bash
cd backend
npm ci
npm run lint
npm test
npm run build
npm start
```

## Frontend
```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
npm run dev
```

## Smoke rapido sugerido
1. Login con usuario valido.
2. Usuario client sin permisos admin recibe `403` en endpoints de admin.
3. Crear cotizacion y revisar historial.
4. Verificar que frontend build genera `frontend/dist`.

## Estado de integraciones tras un deploy
- Al arrancar (despues de abrir HTTP e `initDB`) y cada `INTEGRACIONES_CHECK_MIN` minutos (default 15, `0` lo apaga) el backend revisa PostgreSQL, una lectura real de la pestana de stock en Google Sheets (sin cache) y que haya costo Chile real. Una falla de Google no tumba el arranque.
- Cada integracion caida deja un error `integracion_fallo` en los logs de Railway. Con WhatsApp configurado llega un aviso al caer y otro al recuperarse.
- Como admin: `GET /api/estado/integraciones` (ultimo resultado) o `?forzar=1` (chequeo nuevo). Cada item trae `nombre`, `ok`, `estado` (`ok`/`fallo`/`no_configurado`), `detalle` (sin secretos), `duracion_ms`, `revisado_en`.
- `GET /` (publico) suma `integraciones_ok` (booleano) cuando ya hubo un primer chequeo.
- `POST /api/precios/calcular` agrega `costo_chile_motivo` (`timeout`, `error_lectura`, `fallo_reciente`, `sheets_no_configurado`) cuando `costo_chile_disponible` es false.

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

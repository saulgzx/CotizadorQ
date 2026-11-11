# Seguridad operativa

## Primer usuario admin (sin autogeneracion)
1. Inicia el backend con `JWT_SECRET` (>=32 chars) y `ALLOWED_ORIGINS` configurados.
2. Crea temporalmente un usuario con rol `admin` desde SQL directo:
   `INSERT INTO usuarios (usuario, password, nombre, role) VALUES ('admin_inicial', '<HASH_BCRYPT>', 'Admin Inicial', 'admin');`
3. Genera el hash con bcrypt (ejemplo): `node -e "require('bcryptjs').hash('TuPasswordSegura123!',10).then(h=>console.log(h))"`.
4. Inicia sesion con ese usuario y crea los demas admins desde `/api/usuarios` (ruta protegida por admin).
5. Rota la clave inicial y elimina cualquier credencial temporal usada durante bootstrap.

## Notas
- El backend no siembra usuarios al arrancar ni guarda hashes de contrasenas en el codigo.
  Las cuentas que ya existen en la BD se conservan; las nuevas se crean como se indica arriba
  o desde `/api/usuarios`.
- El backend no inicia si `JWT_SECRET` falta o tiene menos de 32 caracteres.
- `ALLOWED_ORIGINS` controla CORS para navegadores; requests sin `Origin` (curl/postman) siguen permitidos.

## Sesiones
- Toda ruta con `requireAuth` exige `Authorization: Bearer <JWT>` y `X-Session-Id`. El JWT solo
  vale junto a una sesion creada por `POST /api/login` para ese usuario, no revocada ni vencida.
  Un `X-Session-Id` desconocido responde 401 `Sesion invalida` (antes se creaba al vuelo).
- El cliente manda su propio `X-Session-Id` en el login (el frontend lo guarda en
  `localStorage.sessionId`; el MCP usa uno fijo por proceso) y debe reusar ese mismo id en las
  peticiones. Si el login llega sin `X-Session-Id`, el backend genera uno y lo devuelve en
  `session.session_id`.
- `POST /api/logout` y la revocacion desde el panel admin invalidan el token de esa sesion.

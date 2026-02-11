# Seguridad operativa

## Primer usuario admin (sin autogeneracion)
1. Inicia el backend con `JWT_SECRET` (>=32 chars) y `ALLOWED_ORIGINS` configurados.
2. Crea temporalmente un usuario con rol `admin` desde SQL directo:
   `INSERT INTO usuarios (usuario, password, nombre, role) VALUES ('admin_inicial', '<HASH_BCRYPT>', 'Admin Inicial', 'admin');`
3. Genera el hash con bcrypt (ejemplo): `node -e "require('bcryptjs').hash('TuPasswordSegura123!',10).then(h=>console.log(h))"`.
4. Inicia sesion con ese usuario y crea los demas admins desde `/api/usuarios` (ruta protegida por admin).
5. Rota la clave inicial y elimina cualquier credencial temporal usada durante bootstrap.

## Notas
- El backend no inicia si `JWT_SECRET` falta o tiene menos de 32 caracteres.
- `ALLOWED_ORIGINS` controla CORS para navegadores; requests sin `Origin` (curl/postman) siguen permitidos.

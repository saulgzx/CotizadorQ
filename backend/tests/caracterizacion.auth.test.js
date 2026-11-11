/**
 * Tests de caracterizacion: login, sesiones y roles.
 *
 * Documentan lo que el backend HACE hoy (no lo que "deberia" hacer) para que un
 * refactor grande no cambie el comportamiento sin que se note. Si algo parece
 * un bug se fija igual y se marca con "SOSPECHOSO".
 *
 * No dependen del bypass de rate limit de usuarios concretos ni de usuarios
 * sembrados: cada test fabrica su propia fila de usuario.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockCompare = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, connect: mockConnect }))
}));

jest.mock('bcryptjs', () => ({
  compare: mockCompare,
  hash: jest.fn()
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'false';

const app = require('../src/app');

const SECRET = process.env.JWT_SECRET;
const makeToken = (payload, options = { expiresIn: '1h' }) => jwt.sign(payload, SECRET, options);
const hace = (ms) => new Date(Date.now() - ms).toISOString();
const HORA = 60 * 60 * 1000;

// Cada test que falla el login usa una IP distinta (X-Forwarded-For, trust proxy = 1)
// para no compartir el contador en memoria de express-rate-limit.
let ipSeq = 0;
const nuevaIp = () => `10.20.0.${++ipSeq}`;

// Enruta SQL -> respuesta. Un SQL sin ruta lanza: asi un cambio de consultas se nota.
const dbRouter = (tabla) => (sql, params) => {
  for (const [coincide, salida] of tabla) {
    if (coincide(sql)) return Promise.resolve(typeof salida === 'function' ? salida(sql, params) : salida);
  }
  throw new Error(`SQL sin manejar: ${sql}`);
};
const incluye = (...partes) => (sql) => partes.every((p) => sql.includes(p));

const sesionRow = (extra = {}) => ({ id: 10, revoked: false, last_seen: hace(1000), device_id: 'dev-1', ...extra });
const rutasSesion = (rowSesion) => [
  [incluye('SELECT id, revoked, last_seen, device_id FROM sesiones'), { rows: rowSesion ? [rowSesion] : [] }],
  [incluye('UPDATE sesiones', 'SET last_seen = CURRENT_TIMESTAMP'), { rows: [] }]
];

const usuarioDb = (extra = {}) => ({
  id: 1,
  usuario: 'admin',
  password: 'hash',
  nombre: 'Admin Demo',
  role: 'admin',
  empresa: 'ACME',
  logo_url: null,
  partner_category: 'Partner Gold',
  intcomex_profile: null,
  ...extra
});

const rutasLogin = ({ usuarios = [usuarioDb()], fallos = { user_failures: 0, ip_failures: 0 }, activas = [], onInsertLog } = {}) => [
  [incluye('FROM login_logs', 'success = false'), { rows: [fallos] }],
  [incluye('SELECT * FROM usuarios WHERE usuario = $1'), { rows: usuarios }],
  [incluye('DELETE FROM sesiones WHERE user_id = $1'), { rows: [] }],
  [incluye('SELECT id FROM sesiones WHERE user_id = $1 AND session_id = $2'), { rows: [] }],
  [incluye('FROM sesiones', 'revoked = false'), { rows: activas }],
  [incluye('UPDATE sesiones SET revoked = true WHERE id = $1'), { rows: [] }],
  [incluye('INSERT INTO sesiones'), { rows: [] }],
  [incluye('INSERT INTO login_logs'), (sql, params) => { if (onInsertLog) onInsertLog(params); return { rows: [{ id: 1 }] }; }]
];

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockCompare.mockReset();
});

describe('POST /api/login', () => {
  test('exito: devuelve token, usuario sin password y sesion; registra el intento exitoso', async () => {
    mockCompare.mockResolvedValue(true);
    const logs = [];
    mockQuery.mockImplementation(dbRouter(rutasLogin({ onInsertLog: (p) => logs.push(p) })));

    const res = await request(app)
      .post('/api/login')
      .set('x-session-id', 'sess-a')
      .set('x-device-id', 'dev-a')
      .send({ usuario: 'admin', password: 'password123' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['session', 'token', 'user']);
    expect(res.body.user).toEqual({
      id: 1,
      usuario: 'admin',
      nombre: 'Admin Demo',
      empresa: 'ACME',
      logo_url: '',
      role: 'admin',
      partner_category: 'Partner Gold',
      intcomex_profile: null
    });
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.session).toEqual({ session_id: 'sess-a', revoked_sessions: [] });
    expect(mockCompare).toHaveBeenCalledWith('password123', 'hash');
    // [user_id, usuario, success, ip, ua, device, session]
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe(1);
    expect(logs[0][2]).toBe(true);
    expect(logs[0][5]).toBe('dev-a');
    expect(logs[0][6]).toBe('sess-a');
  });

  test('forma del JWT de admin: claims fijos y vigencia de 7 dias', async () => {
    mockCompare.mockResolvedValue(true);
    mockQuery.mockImplementation(dbRouter(rutasLogin()));

    const res = await request(app).post('/api/login').set('x-session-id', 's').send({ usuario: 'admin', password: 'password123' });
    const claims = jwt.verify(res.body.token, SECRET);

    expect(claims).toEqual({
      id: 1,
      usuario: 'admin',
      empresa: 'ACME',
      role: 'admin',
      partner_category: 'Partner Gold',
      intcomex_profile: null,
      iat: expect.any(Number),
      exp: expect.any(Number)
    });
    expect(claims.exp - claims.iat).toBe(7 * 24 * 3600);
    expect(claims.password).toBeUndefined();
  });

  test('forma del JWT de no-admin: vigencia de 24h', async () => {
    mockCompare.mockResolvedValue(true);
    mockQuery.mockImplementation(
      dbRouter(rutasLogin({ usuarios: [usuarioDb({ id: 5, usuario: 'cliente1', role: 'client', empresa: null, partner_category: 'Partner Silver' })] }))
    );

    const res = await request(app).post('/api/login').set('x-session-id', 's').send({ usuario: 'cliente1', password: 'password123' });
    const claims = jwt.verify(res.body.token, SECRET);

    expect(res.status).toBe(200);
    expect(claims.role).toBe('client');
    expect(claims.empresa).toBe('');
    expect(claims.exp - claims.iat).toBe(24 * 3600);
    expect(res.body.user.empresa).toBe('');
  });

  test('sin cabecera x-session-id el login igual responde 200 con session_id null', async () => {
    mockCompare.mockResolvedValue(true);
    mockQuery.mockImplementation(dbRouter(rutasLogin()));

    const res = await request(app).post('/api/login').send({ usuario: 'admin', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.session).toEqual({ session_id: null, revoked_sessions: [] });
  });

  test('un cliente con otra sesion activa la revoca al iniciar una nueva (limite 1; admin 2)', async () => {
    mockCompare.mockResolvedValue(true);
    const actualizaciones = [];
    const tabla = rutasLogin({
      usuarios: [usuarioDb({ id: 5, usuario: 'cliente1', role: 'client' })],
      activas: [{ id: 77, session_id: 'sess-vieja', last_seen: hace(1000) }]
    });
    tabla.unshift([incluye('UPDATE sesiones SET revoked = true WHERE id = $1'), (sql, p) => { actualizaciones.push(p); return { rows: [] }; }]);
    mockQuery.mockImplementation(dbRouter(tabla));

    const res = await request(app).post('/api/login').set('x-session-id', 'sess-nueva').send({ usuario: 'cliente1', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.session.revoked_sessions).toEqual(['sess-vieja']);
    expect(actualizaciones).toEqual([[77]]);
  });

  test('un admin con una sesion activa NO la revoca (permite 2)', async () => {
    mockCompare.mockResolvedValue(true);
    mockQuery.mockImplementation(
      dbRouter(rutasLogin({ activas: [{ id: 77, session_id: 'sess-vieja', last_seen: hace(1000) }] }))
    );

    const res = await request(app).post('/api/login').set('x-session-id', 'sess-nueva').send({ usuario: 'admin', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.session.revoked_sessions).toEqual([]);
  });

  test('contrasena incorrecta: 401, mensaje generico y se registra el fallo', async () => {
    mockCompare.mockResolvedValue(false);
    const logs = [];
    mockQuery.mockImplementation(dbRouter(rutasLogin({ onInsertLog: (p) => logs.push(p) })));

    const res = await request(app)
      .post('/api/login')
      .set('x-forwarded-for', nuevaIp())
      .send({ usuario: 'admin', password: 'incorrecta123' });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(res.body.error).toMatch(/^Usuario o contrase.+a incorrectos$/);
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe(1);
    expect(logs[0][2]).toBe(false);
  });

  test('usuario inexistente: 401 con el MISMO mensaje, sin consultar bcrypt, fallo registrado sin user_id', async () => {
    const logs = [];
    mockQuery.mockImplementation(dbRouter(rutasLogin({ usuarios: [], onInsertLog: (p) => logs.push(p) })));

    const res = await request(app)
      .post('/api/login')
      .set('x-forwarded-for', nuevaIp())
      .send({ usuario: 'fantasma', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/^Usuario o contrase.+a incorrectos$/);
    expect(mockCompare).not.toHaveBeenCalled();
    expect(logs[0][0]).toBeNull();
    expect(logs[0][1]).toBe('fantasma');
    expect(logs[0][2]).toBe(false);
  });

  test.each([
    ['sin password', { usuario: 'admin' }],
    ['password de 7 caracteres (minimo 8)', { usuario: 'admin', password: '1234567' }],
    ['usuario de 2 caracteres (minimo 3)', { usuario: 'ab', password: 'password123' }],
    ['tipos incorrectos', { usuario: 123, password: ['x'] }]
  ])('payload invalido (%s): 400 sin tocar la BD', async (_nombre, body) => {
    const res = await request(app).post('/api/login').set('x-forwarded-for', nuevaIp()).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Payload invalido');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('usuario con espacios alrededor se recorta antes de buscarlo (zod trim)', async () => {
    mockCompare.mockResolvedValue(true);
    const buscados = [];
    const tabla = rutasLogin();
    tabla.unshift([incluye('SELECT * FROM usuarios WHERE usuario = $1'), (sql, p) => { buscados.push(p[0]); return { rows: [usuarioDb()] }; }]);
    mockQuery.mockImplementation(dbRouter(tabla));

    const res = await request(app).post('/api/login').set('x-session-id', 's').send({ usuario: '  admin  ', password: 'password123' });

    expect(res.status).toBe(200);
    expect(buscados).toEqual(['admin']);
  });

  test('limite de intentos por BD (>=5 fallos en la ventana): 429 sin buscar el usuario', async () => {
    mockQuery.mockImplementation(dbRouter(rutasLogin({ fallos: { user_failures: 5, ip_failures: 0 } })));

    const res = await request(app)
      .post('/api/login')
      .set('x-forwarded-for', nuevaIp())
      .send({ usuario: 'cliente-bloqueado', password: 'password123' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Demasiados intentos/);
    expect(mockCompare).not.toHaveBeenCalled();
    const sqls = mockQuery.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => s.includes('SELECT * FROM usuarios'))).toBe(false);
  });

  test('el limitador en memoria bloquea la 6a peticion fallida desde la misma IP', async () => {
    const ip = nuevaIp();
    mockCompare.mockResolvedValue(false);
    mockQuery.mockImplementation(dbRouter(rutasLogin()));

    const estados = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app).post('/api/login').set('x-forwarded-for', ip).send({ usuario: 'admin', password: 'incorrecta123' });
      estados.push(res.status);
    }
    expect(estados).toEqual([401, 401, 401, 401, 401, 429]);
  });

  test('error de BD durante el login: 500 generico', async () => {
    mockQuery.mockImplementation(() => Promise.reject(new Error('db caida')));

    const res = await request(app).post('/api/login').set('x-forwarded-for', nuevaIp()).send({ usuario: 'admin', password: 'password123' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
  });
});

describe('autenticacion y sesion en rutas protegidas (probado con POST /api/logout)', () => {
  const logout = (token, sessionId) => {
    const req = request(app).post('/api/logout');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (sessionId) req.set('x-session-id', sessionId);
    return req;
  };
  const tokenCliente = () => makeToken({ id: 2, usuario: 'cliente', role: 'client' });

  test('sin Authorization: 401 "Token requerido"', async () => {
    const res = await logout();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token requerido' });
  });

  test('"Bearer" sin token: 401 "Token requerido"', async () => {
    const res = await request(app).post('/api/logout').set('Authorization', 'Bearer');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token requerido');
  });

  test('token basura: 401 "Token invalido"', async () => {
    const res = await logout('esto-no-es-un-jwt', 's1');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token invalido' });
  });

  test('token firmado con otro secreto: 401 "Token invalido"', async () => {
    const falso = jwt.sign({ id: 1, role: 'admin' }, 'otro-secreto-distinto-de-32-caracteres!!');
    const res = await logout(falso, 's1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token invalido');
  });

  test('token vencido: 401 "Token invalido"', async () => {
    const vencido = makeToken({ id: 2, role: 'client' }, { expiresIn: -60 });
    const res = await logout(vencido, 's1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token invalido');
  });

  test('token valido pero sin cabecera x-session-id: 401 "Sesion requerida" (no consulta la BD)', async () => {
    const res = await logout(tokenCliente());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Sesion requerida');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('sesion revocada: 401 "Sesion revocada"', async () => {
    mockQuery.mockImplementation(dbRouter(rutasSesion(sesionRow({ revoked: true }))));
    const res = await logout(tokenCliente(), 's1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Sesion revocada');
  });

  test('sesion de cliente inactiva > 10 min (TTL por defecto): 401 "Sesion expirada"', async () => {
    mockQuery.mockImplementation(dbRouter(rutasSesion(sesionRow({ last_seen: hace(HORA) }))));
    const res = await logout(tokenCliente(), 's1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Sesion expirada');
  });

  test('sesion sin last_seen: 401 "Sesion expirada"', async () => {
    mockQuery.mockImplementation(dbRouter(rutasSesion(sesionRow({ last_seen: null }))));
    const res = await logout(tokenCliente(), 's1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Sesion expirada');
  });

  test('la misma inactividad de 1h NO expira la sesion de un admin (TTL 7 dias)', async () => {
    mockQuery.mockImplementation(dbRouter([
      ...rutasSesion(sesionRow({ last_seen: hace(HORA) })),
      [incluye('UPDATE sesiones SET revoked = true WHERE user_id = $1 AND session_id = $2'), { rows: [] }]
    ]));
    const res = await logout(makeToken({ id: 1, usuario: 'admin', role: 'admin' }), 's1');
    expect(res.status).toBe(200);
  });

  test('sesion activa: pasa, refresca last_seen y logout la marca revocada', async () => {
    const revocaciones = [];
    mockQuery.mockImplementation(dbRouter([
      ...rutasSesion(sesionRow()),
      [incluye('UPDATE sesiones SET revoked = true WHERE user_id = $1 AND session_id = $2'), (sql, p) => { revocaciones.push(p); return { rows: [] }; }]
    ]));
    const res = await logout(tokenCliente(), 'sess-xyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(revocaciones).toEqual([[2, 'sess-xyz']]);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('SET last_seen = CURRENT_TIMESTAMP'))).toBe(true);
  });

  test('SOSPECHOSO: token valido sin fila de sesion NO se rechaza; se crea la sesion al vuelo y sigue', async () => {
    // validateSession devuelve reason "missing" -> onMissingSession -> upsertSession -> next().
    const inserts = [];
    mockQuery.mockImplementation(dbRouter([
      ...rutasSesion(null),
      [incluye('DELETE FROM sesiones WHERE user_id = $1'), { rows: [] }],
      [incluye('SELECT id FROM sesiones WHERE user_id = $1 AND session_id = $2'), { rows: [] }],
      [incluye('FROM sesiones', 'revoked = false'), { rows: [] }],
      [incluye('INSERT INTO sesiones'), (sql, p) => { inserts.push(p); return { rows: [] }; }],
      [incluye('UPDATE sesiones SET revoked = true WHERE user_id = $1 AND session_id = $2'), { rows: [] }]
    ]));
    const res = await logout(tokenCliente(), 'sess-fantasma');
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].slice(0, 2)).toEqual([2, 'sess-fantasma']);
  });
});

describe('roles frente a rutas protegidas', () => {
  const sesionOk = rutasSesion(sesionRow());
  const get = (ruta, token) => request(app).get(ruta).set('Authorization', `Bearer ${token}`).set('x-session-id', 's1');

  test('GET /api/usuarios: admin 200', async () => {
    mockQuery.mockImplementation(dbRouter([
      ...sesionOk,
      [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role: 'admin' }] }],
      [incluye('SELECT id, usuario, nombre, empresa, logo_url, role'), { rows: [{ id: 1, usuario: 'admin' }] }]
    ]));
    const res = await get('/api/usuarios', makeToken({ id: 1, usuario: 'admin', role: 'admin' }));
    expect(res.status).toBe(200);
    expect(res.body[0].usuario).toBe('admin');
  });

  test.each(['client', 'cot_stock_admin'])('GET /api/usuarios: %s recibe 403 "Permiso denegado"', async (role) => {
    mockQuery.mockImplementation(dbRouter([...sesionOk, [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role }] }]]));
    const res = await get('/api/usuarios', makeToken({ id: 9, usuario: 'x', role }));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Permiso denegado' });
  });

  test('requireAdmin consulta el rol en la BD, no el claim del token (token "admin" + BD "client" => 403)', async () => {
    mockQuery.mockImplementation(dbRouter([...sesionOk, [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role: 'client' }] }]]));
    const res = await get('/api/usuarios', makeToken({ id: 9, usuario: 'x', role: 'admin' }));
    expect(res.status).toBe(403);
  });

  test('requireAdmin con usuario borrado de la BD: 403', async () => {
    mockQuery.mockImplementation(dbRouter([...sesionOk, [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [] }]]));
    const res = await get('/api/usuarios', makeToken({ id: 9, usuario: 'x', role: 'admin' }));
    expect(res.status).toBe(403);
  });

  test('requireAdmin: el rol de la BD se compara en minusculas ("ADMIN" cuenta como admin)', async () => {
    mockQuery.mockImplementation(dbRouter([
      ...sesionOk,
      [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role: 'ADMIN' }] }],
      [incluye('SELECT id, usuario, nombre, empresa, logo_url, role'), { rows: [] }]
    ]));
    const res = await get('/api/usuarios', makeToken({ id: 1, usuario: 'admin', role: 'admin' }));
    expect(res.status).toBe(200);
  });

  test('SOSPECHOSO: GET /api/cotizaciones decide admin por el claim del JWT, no por la BD (admin degradado conserva la vista completa hasta que vence el token)', async () => {
    let sqlLista = '';
    mockQuery.mockImplementation(dbRouter([
      ...sesionOk,
      [incluye('FROM cotizaciones c', 'LEFT JOIN usuarios u'), (sql) => { sqlLista = sql; return { rows: [{ id: 1 }] }; }]
    ]));
    const res = await get('/api/cotizaciones', makeToken({ id: 9, usuario: 'degradado', role: 'admin' }));
    expect(res.status).toBe(200);
    expect(sqlLista).not.toContain('c.usuario_id = $1');
    // Ningun SELECT role FROM usuarios: la BD ni se consulta.
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('FROM usuarios'))).toBe(false);
  });

  test('GET /api/sessions (solo admin): client y cot_stock_admin reciben 403', async () => {
    for (const role of ['client', 'cot_stock_admin']) {
      mockQuery.mockReset();
      mockQuery.mockImplementation(dbRouter([...sesionOk, [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role }] }]]));
      const res = await get('/api/sessions', makeToken({ id: 9, usuario: 'x', role }));
      expect(res.status).toBe(403);
    }
  });

  test('PUT /api/cotizaciones/:id (solo admin): cot_stock_admin recibe 403 antes de validar el cuerpo', async () => {
    mockQuery.mockImplementation(dbRouter([...sesionOk, [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role: 'cot_stock_admin' }] }]]));
    const res = await request(app)
      .put('/api/cotizaciones/5')
      .set('Authorization', `Bearer ${makeToken({ id: 3, usuario: 'nsteck', role: 'cot_stock_admin' })}`)
      .set('x-session-id', 's1')
      .send({});
    expect(res.status).toBe(403);
  });

  test('ruta inexistente responde 404 por el notFoundHandler', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
  });
});

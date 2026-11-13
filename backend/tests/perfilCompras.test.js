/**
 * El perfil intcomex 'compras' se eliminó: Órdenes y Compras son solo para admin.
 * - Las 5 rutas de órdenes/BO exigen admin (un usuario intcomex con perfil 'compras' recibe 403).
 * - La API ya no permite asignar el perfil 'compras' (se guarda NULL); 'ventas' no cambia.
 * - initDB trae la migración que desactiva las cuentas que lo tenían.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, connect: mockConnect }))
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(async () => '$2a$10$hash-de-relleno')
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'false';

const app = require('../src/app');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const incluye = (...partes) => (sql) => partes.every((p) => sql.includes(p));
const dbRouter = (tabla) => (sql, params) => {
  for (const [coincide, salida] of tabla) {
    if (coincide(sql)) return Promise.resolve(typeof salida === 'function' ? salida(sql, params) : salida);
  }
  throw new Error(`SQL sin manejar: ${sql}`);
};

// Sesión vigente + rol actual de la BD (lo que leen requireAuth y requireAdmin).
const rutasBase = (role) => [
  [incluye('FROM sesiones s JOIN usuarios u ON u.id = s.user_id'), () => ({
    rows: [{ id: 10, revoked: false, last_seen: new Date().toISOString(), device_id: 'd', role }]
  })],
  [incluye('UPDATE sesiones', 'SET last_seen = CURRENT_TIMESTAMP'), { rows: [] }],
  [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role }] }],
  [incluye('SELECT role, empresa, intcomex_profile FROM usuarios WHERE id = $1'), {
    rows: [{ role, empresa: 'Intcomex', intcomex_profile: 'compras' }]
  }]
];

const llamar = (metodo, ruta, token, cuerpo) => {
  const req = request(app)[metodo](ruta).set('Authorization', `Bearer ${token}`).set('x-session-id', 's1');
  return cuerpo ? req.send(cuerpo) : req;
};

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockConnect.mockImplementation(async () => ({ query: mockQuery, release: jest.fn() }));
});

const RUTAS = [
  ['get', '/api/oso/orders'],
  ['get', '/api/bo-meta'],
  ['put', '/api/bo-meta/BO123'],
  ['put', '/api/bo-lines/BO123'],
  ['post', '/api/bo-meta/BO123/delete']
];

describe('Órdenes y Compras: solo admin', () => {
  test.each(RUTAS)('%s %s: usuario intcomex con perfil compras recibe 403', async (metodo, ruta) => {
    mockQuery.mockImplementation(dbRouter(rutasBase('client')));
    const token = makeToken({ id: 30, usuario: 'compras1', role: 'client', empresa: 'Intcomex', intcomex_profile: 'compras' });
    const res = await llamar(metodo, ruta, token, metodo === 'get' ? undefined : {});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Permiso denegado' });
  });

  test.each(RUTAS)('%s %s: un admin pasa la autorización', async (metodo, ruta) => {
    // Cualquier SQL fuera de la autorización falla con 500 en el handler: basta con que no sea 401/403.
    mockQuery.mockImplementation(dbRouter(rutasBase('admin')));
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    const res = await llamar(metodo, ruta, token, metodo === 'get' ? undefined : {});
    expect([401, 403]).not.toContain(res.status);
  });
});

describe('usuarios: el perfil compras ya no se puede asignar', () => {
  const rutasAdmin = (extra = []) => [...rutasBase('admin'), ...extra];
  const tokenAdmin = () => makeToken({ id: 1, usuario: 'admin', role: 'admin' });

  test('POST /api/usuarios con intcomex_profile "compras" guarda NULL y no fuerza rol client', async () => {
    const inserts = [];
    mockQuery.mockImplementation(dbRouter(rutasAdmin([
      [incluye('SELECT id FROM usuarios WHERE usuario = $1'), { rows: [] }],
      [incluye('INSERT INTO usuarios'), (sql, p) => { inserts.push(p); return { rows: [{ id: 50 }] }; }]
    ])));
    const res = await llamar('post', '/api/usuarios', tokenAdmin(), {
      usuario: 'nuevo', password: 'password123', empresa: 'Intcomex', intcomex_profile: ' Compras '
    });
    expect(res.status).toBe(201);
    // [usuario, hash, nombre, empresa, logo, role, gp, gpQnap, gpAxis, partner, intcomex_profile]
    expect(inserts[0][10]).toBeNull();
    expect(inserts[0][5]).toBe('client');
  });

  test('POST /api/usuarios con "ventas" sigue guardando ventas y aplicando su política', async () => {
    const inserts = [];
    mockQuery.mockImplementation(dbRouter(rutasAdmin([
      [incluye('SELECT id FROM usuarios WHERE usuario = $1'), { rows: [] }],
      [incluye('INSERT INTO usuarios'), (sql, p) => { inserts.push(p); return { rows: [{ id: 51 }] }; }]
    ])));
    const res = await llamar('post', '/api/usuarios', tokenAdmin(), {
      usuario: 'vend', password: 'password123', empresa: 'Intcomex', role: 'admin', intcomex_profile: 'ventas'
    });
    expect(res.status).toBe(201);
    expect(inserts[0][10]).toBe('ventas');
    expect(inserts[0][5]).toBe('client'); // la política de ventas fuerza rol client
    expect(inserts[0][7]).toBe(0.15);
    expect(inserts[0][8]).toBe(0.13);
  });

  test('PUT /api/usuarios/:id con "compras" guarda NULL (también si la fila aún lo tenía)', async () => {
    const updates = [];
    mockQuery.mockImplementation(dbRouter(rutasAdmin([
      [incluye('SELECT empresa, role, gp, gp_qnap, gp_axis, partner_category, intcomex_profile FROM usuarios WHERE id = $1'), {
        rows: [{ empresa: 'Intcomex', role: 'client', gp: 0.15, gp_qnap: 0.15, gp_axis: 0.15, partner_category: 'Partner Autorizado', intcomex_profile: 'compras' }]
      }],
      [incluye('UPDATE usuarios', 'SET usuario = COALESCE'), (sql, p) => { updates.push(p); return { rows: [{ id: 30 }] }; }]
    ])));
    // Sin intcomex_profile en el cuerpo: se hereda 'compras' de la fila y debe salir NULL.
    const res = await llamar('put', '/api/usuarios/30', tokenAdmin(), { nombre: 'X' });
    expect(res.status).toBe(200);
    expect(updates[0][9]).toBeNull();
    const res2 = await llamar('put', '/api/usuarios/30', tokenAdmin(), { intcomex_profile: 'compras' });
    expect(res2.status).toBe(200);
    expect(updates[1][9]).toBeNull();
  });

  test('PUT /api/usuarios/:id con "ventas" sigue guardando ventas', async () => {
    const updates = [];
    mockQuery.mockImplementation(dbRouter(rutasAdmin([
      [incluye('SELECT empresa, role, gp, gp_qnap, gp_axis, partner_category, intcomex_profile FROM usuarios WHERE id = $1'), {
        rows: [{ empresa: 'Intcomex', role: 'client', gp: 0.15, gp_qnap: 0.15, gp_axis: 0.15, partner_category: 'Partner Autorizado', intcomex_profile: null }]
      }],
      [incluye('UPDATE usuarios', 'SET usuario = COALESCE'), (sql, p) => { updates.push(p); return { rows: [{ id: 30 }] }; }]
    ])));
    const res = await llamar('put', '/api/usuarios/30', tokenAdmin(), { intcomex_profile: 'ventas' });
    expect(res.status).toBe(200);
    expect(updates[0][9]).toBe('ventas');
    expect(updates[0][4]).toBe('client');
  });
});

describe('migración del perfil compras en initDB', () => {
  // El arnés mockea pg: no se puede ejecutar el SQL real. Se verifica que initDB lo trae,
  // en el orden correcto (después de crear las columnas) y que no tumba el arranque.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'legacyRoutes.js'), 'utf8');
  const initDB = source.slice(source.indexOf('const initDB = async'), source.indexOf('\n};', source.indexOf('const initDB = async')));

  test('corre después de crear intcomex_profile y activo', () => {
    const pos = initDB.indexOf("event: 'perfil_compras_eliminado'");
    expect(pos).toBeGreaterThan(initDB.indexOf('ADD COLUMN IF NOT EXISTS intcomex_profile'));
    expect(pos).toBeGreaterThan(initDB.indexOf('ADD COLUMN IF NOT EXISTS activo'));
  });

  test('desactiva solo NO admin de intcomex y limpia el perfil de los demás', () => {
    expect(initDB).toMatch(/SET activo = false, intcomex_profile = NULL[\s\S]*?LOWER\(TRIM\(COALESCE\(intcomex_profile, ''\)\)\) = 'compras'[\s\S]*?LOWER\(TRIM\(COALESCE\(empresa, ''\)\)\) = 'intcomex'[\s\S]*?LOWER\(COALESCE\(role, ''\)\) <> 'admin'/);
    expect(initDB).toMatch(/SET intcomex_profile = NULL\s+WHERE LOWER\(TRIM\(COALESCE\(intcomex_profile, ''\)\)\) = 'compras'/);
  });

  test('el log no incluye nombres de usuario y la migración tiene su propio try/catch', () => {
    const bloque = initDB.slice(initDB.indexOf("event: 'perfil_compras_eliminado'") - 200);
    expect(bloque).toMatch(/desactivadas: nDesactivadas/);
    expect(initDB).toContain("event: 'perfil_compras_eliminado_failed'");
  });
});

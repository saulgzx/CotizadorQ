const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockCompare = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    connect: mockConnect
  }))
}));

jest.mock('bcryptjs', () => ({
  compare: mockCompare,
  hash: jest.fn()
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

const app = require('../src/app');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const activeSessionRow = {
  id: 10,
  revoked: false,
  last_seen: new Date(Date.now() + 60_000).toISOString(),
  device_id: 'device-1'
};

describe('API security and critical endpoints', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockCompare.mockReset();
  });

  test('POST /api/login returns token with valid credentials', async () => {
    mockCompare.mockResolvedValue(true);
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('FROM login_logs') && sql.includes('success = false')) {
        return Promise.resolve({ rows: [{ user_failures: 0, ip_failures: 0 }] });
      }
      if (sql.includes('SELECT * FROM usuarios WHERE usuario = $1')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              usuario: 'admin',
              password: 'hashed-password',
              nombre: 'Admin',
              role: 'admin',
              empresa: 'ACME'
            }
          ]
        });
      }
      if (sql.includes('DELETE FROM sesiones WHERE user_id = $1')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT id FROM sesiones WHERE user_id = $1 AND session_id = $2')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM sesiones') && sql.includes('revoked = false')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO sesiones')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO login_logs')) return Promise.resolve({ rows: [] });
      throw new Error(`Unhandled SQL in login test: ${sql}`);
    });

    const response = await request(app)
      .post('/api/login')
      .set('x-session-id', 'session-login-1')
      .set('x-device-id', 'device-1')
      .send({ usuario: 'admin', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(response.body.user?.usuario).toBe('admin');
    expect(response.body.session?.session_id).toBe('session-login-1');
  });

  test('GET /api/usuarios returns 403 for non-admin', async () => {
    const token = makeToken({ id: 2, usuario: 'client', role: 'client' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT role FROM usuarios WHERE id = $1')) {
        return Promise.resolve({ rows: [{ role: 'client' }] });
      }
      throw new Error(`Unhandled SQL in non-admin permissions test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-user-1');

    expect(response.status).toBe(403);
  });

  test('GET /api/usuarios returns 200 for admin', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT role FROM usuarios WHERE id = $1')) {
        return Promise.resolve({ rows: [{ role: 'admin' }] });
      }
      if (sql.includes('SELECT id, usuario, nombre, empresa, logo_url, role')) {
        return Promise.resolve({ rows: [{ id: 1, usuario: 'admin', role: 'admin' }] });
      }
      throw new Error(`Unhandled SQL in admin permissions test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-1');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.usuario).toBe('admin');
  });

  test('GET /api/productos returns critical data for authenticated admin', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT * FROM productos')) {
        return Promise.resolve({ rows: [{ id: 10, sku: 'SKU-1', descripcion: 'Producto 1', activo: true }] });
      }
      throw new Error(`Unhandled SQL in productos test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/productos')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-2');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.sku).toBe('SKU-1');
  });

  test('GET /api/cotizaciones returns critical data for authenticated admin', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM cotizaciones c') && sql.includes('LEFT JOIN usuarios u')) {
        return Promise.resolve({ rows: [{ id: 99, cliente_nombre: 'Cliente Demo', estado: 'revision' }] });
      }
      throw new Error(`Unhandled SQL in cotizaciones test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-3');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.cliente_nombre).toBe('Cliente Demo');
  });
});

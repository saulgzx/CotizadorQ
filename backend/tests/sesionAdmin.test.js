const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    connect: jest.fn()
  }))
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn()
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'false';
delete process.env.ADMIN_SESSION_TTL_MIN;
delete process.env.ADMIN_JWT_EXPIRES_IN;

const app = require('../src/app');

const SIETE_DIAS_SEG = 7 * 24 * 60 * 60;

describe('duracion por defecto de la sesion admin', () => {
  test('el JWT admin vence en 7 dias y la sesion usa 10080 minutos', async () => {
    const parametrosSesiones = [];
    mockQuery.mockImplementation((sql, params) => {
      if (sql.includes('FROM login_logs') && sql.includes('success = false')) {
        return Promise.resolve({ rows: [{ user_failures: 0, ip_failures: 0 }] });
      }
      if (sql.includes('SELECT * FROM usuarios WHERE usuario = $1')) {
        return Promise.resolve({
          rows: [{ id: 1, usuario: 'admin', password: 'hash', nombre: 'Admin', role: 'admin', empresa: '' }]
        });
      }
      if (sql.includes('DELETE FROM sesiones WHERE user_id = $1')) {
        parametrosSesiones.push(params);
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM sesiones') || sql.includes('INSERT INTO sesiones')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO login_logs')) return Promise.resolve({ rows: [] });
      throw new Error(`SQL inesperado: ${sql}`);
    });

    const antes = Date.now();
    const response = await request(app)
      .post('/api/login')
      .set('x-session-id', 'sesion-admin-1')
      .send({ usuario: 'admin', password: 'password123' });

    expect(response.status).toBe(200);
    const payload = jwt.decode(response.body.token);
    expect(payload.exp - payload.iat).toBe(SIETE_DIAS_SEG);

    // upsertSession borra sesiones con last_seen anterior a ahora - TTL admin.
    const corte = new Date(parametrosSesiones[0][1]).getTime();
    expect(Math.round((antes - corte) / 60000)).toBe(10080);
  });
});

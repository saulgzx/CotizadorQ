const request = require('supertest');

const mockQuery = jest.fn();
const mockCompare = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    connect: jest.fn()
  }))
}));

jest.mock('bcryptjs', () => ({
  compare: mockCompare,
  hash: jest.fn()
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.LOGIN_RATE_LIMIT_MAX = '5';
process.env.GEO_ENABLED = 'false';
delete process.env.LOGIN_RATE_LIMIT_ENABLED;

const app = require('../src/app');

// Cada prueba usa una IP distinta para no compartir el contador en memoria.
const loginDesde = (ip, usuario) =>
  request(app)
    .post('/api/login')
    .set('X-Forwarded-For', ip)
    .send({ usuario, password: 'clave-incorrecta' });

describe('limite de intentos de login sin excepciones por usuario', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockCompare.mockReset();
    mockCompare.mockResolvedValue(false);
  });

  test.each(['agonz', 'AGONZ', 'admin', 'mcp_bot'])(
    'el limite en BD tambien aplica a %s',
    async (usuario) => {
      const consultas = [];
      mockQuery.mockImplementation((sql) => {
        consultas.push(sql);
        if (sql.includes('FROM login_logs') && sql.includes('success = false')) {
          return Promise.resolve({ rows: [{ user_failures: 99, ip_failures: 0 }] });
        }
        throw new Error(`SQL inesperado: ${sql}`);
      });

      const response = await loginDesde(`203.0.113.${10 + usuario.length}`, usuario);

      expect(response.status).toBe(429);
      expect(consultas.some((sql) => sql.includes('FROM usuarios'))).toBe(false);
      // El conteo por usuario va atado a la IP: nadie bloquea una cuenta desde otra IP.
      expect(consultas.some((sql) => sql.includes('usuario = $1 AND ip_address = $2'))).toBe(true);
    }
  );

  test('el limitador en memoria corta a agonz tras LOGIN_RATE_LIMIT_MAX fallos', async () => {
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('FROM login_logs') && sql.includes('success = false')) {
        return Promise.resolve({ rows: [{ user_failures: 0, ip_failures: 0 }] });
      }
      if (sql.includes('SELECT * FROM usuarios WHERE usuario = $1')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO login_logs')) return Promise.resolve({ rows: [{ id: 1 }] });
      if (sql.includes('UPDATE login_logs')) return Promise.resolve({ rows: [] });
      throw new Error(`SQL inesperado: ${sql}`);
    });

    const estados = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await loginDesde('198.51.100.7', 'agonz');
      estados.push(response.status);
    }

    expect(estados.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(estados[5]).toBe(429);
  });
});

/**
 * Tests de POST /api/cotizaciones/pdf: el rol sale del usuario autenticado,
 * nunca del body, y los errores no filtran detalle interno.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockTextos = [];

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, connect: mockConnect }))
}));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));
// Registra cada texto que se escribe en el PDF para poder inspeccionar las notas.
jest.mock('pdfkit', () => {
  const Real = jest.requireActual('pdfkit');
  return class PdfEspia extends Real {
    text(t, ...rest) {
      mockTextos.push(String(t));
      return super.text(t, ...rest);
    }
  };
});

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'false';
process.env.GOOGLE_SHEETS_ID = '';
process.env.GOOGLE_SHEETS_URL = '';

const app = require('../src/app');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const dbRouter = (tabla) => (sql, params) => {
  for (const [coincide, salida] of tabla) {
    if (coincide(sql)) return Promise.resolve(typeof salida === 'function' ? salida(sql, params) : salida);
  }
  throw new Error(`SQL sin manejar: ${sql}`);
};
const incluye = (...partes) => (sql) => partes.every((p) => sql.includes(p));
const sesionActiva = () => [
  [incluye('SELECT id, revoked, last_seen, device_id FROM sesiones'), { rows: [{ id: 10, revoked: false, last_seen: new Date(Date.now() - 1000).toISOString(), device_id: 'd' }] }],
  [incluye('UPDATE sesiones', 'SET last_seen = CURRENT_TIMESTAMP'), { rows: [] }]
];
const conAuth = (req, user) => req.set('Authorization', `Bearer ${makeToken(user)}`).set('x-session-id', 'sess-1');

const CLIENTE = { id: 2, usuario: 'cliente', role: 'client' };
const ADMIN = { id: 1, usuario: 'admin', role: 'admin' };
const BODY = {
  cliente: { nombre: 'Ana', empresa: 'ACME' },
  items: [{ marca: 'QNAP', cantidad: 2, sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS', precio_unitario: 100, precio_total: 200 }],
  total: 200
};
const NOTA_CLIENTE = 'no constituye oferta formal';

beforeEach(() => {
  mockQuery.mockReset();
  mockTextos.length = 0;
  mockQuery.mockImplementation(dbRouter(sesionActiva()));
});

describe('POST /api/cotizaciones/pdf', () => {
  test('cliente que manda usuario_role "admin": se usa su rol real (client) y el PDF lleva la nota de cliente', async () => {
    const res = await conAuth(request(app).post('/api/cotizaciones/pdf'), CLIENTE).send({ ...BODY, usuario_role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(mockTextos.some((t) => t.includes(NOTA_CLIENTE))).toBe(true);
  });

  test('admin que manda usuario_role "client": se usa su rol real (admin) y no lleva la nota de cliente', async () => {
    const res = await conAuth(request(app).post('/api/cotizaciones/pdf'), ADMIN).send({ ...BODY, usuario_role: 'client' });
    expect(res.status).toBe(200);
    expect(mockTextos.some((t) => t.includes(NOTA_CLIENTE))).toBe(false);
  });

  test('sin items: 400', async () => {
    const res = await conAuth(request(app).post('/api/cotizaciones/pdf'), CLIENTE).send({ items: [] });
    expect(res.status).toBe(400);
  });
});

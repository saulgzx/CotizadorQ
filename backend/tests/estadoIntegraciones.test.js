const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query: mockQuery, connect: jest.fn() })) }));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
delete process.env.GOOGLE_SHEETS_ID;
delete process.env.GOOGLE_SHEETS_URL;

const app = require('../src/app');

const token = (id) => jwt.sign({ id, usuario: `u${id}`, role: id === 1 ? 'admin' : 'client' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const auth = (id) => ({ Authorization: `Bearer ${token(id)}`, 'x-session-id': 'sesion-test' });
const rolPorId = { 1: 'admin', 2: 'client' };

const dbOk = (sql, params) => {
  if (/FROM sesiones/.test(sql)) return Promise.resolve({ rows: [{ id: 1, revoked: false, last_seen: new Date(), device_id: null }] });
  if (/SELECT role FROM usuarios/.test(sql)) return Promise.resolve({ rows: [{ role: rolPorId[params[0]] }] });
  return Promise.resolve({ rows: [] });
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(dbOk);
});

describe('GET /api/estado/integraciones', () => {
  test('sin token: 401', async () => {
    expect((await request(app).get('/api/estado/integraciones')).status).toBe(401);
  });

  test('usuario no admin: 403', async () => {
    const res = await request(app).get('/api/estado/integraciones').set(auth(2));
    expect(res.status).toBe(403);
  });

  test('si PostgreSQL falla, el chequeo lo marca sin exponer el error original', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/^SELECT 1$/.test(String(sql).trim())) return Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
      return dbOk(sql, params);
    });
    const res = await request(app).get('/api/estado/integraciones?forzar=1').set(auth(1));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5/);
    expect(res.body.integraciones.find((i) => i.nombre === 'postgresql')).toMatchObject({ ok: false, estado: 'fallo' });
    expect((await request(app).get('/')).body.integraciones_ok).toBe(false);
  });

  test('admin con ?forzar=1: Sheets sin configurar no es fallo; sin forzar devuelve lo guardado', async () => {
    const res = await request(app).get('/api/estado/integraciones?forzar=1').set(auth(1));
    expect(res.status).toBe(200);
    expect(res.body.chequeado).toBe(true);
    expect(res.body.ok).toBe(true);
    const por = Object.fromEntries(res.body.integraciones.map((i) => [i.nombre, i]));
    expect(por.postgresql).toMatchObject({ ok: true, estado: 'ok' });
    expect(por.google_sheets).toMatchObject({ ok: true, estado: 'no_configurado' });
    expect(por.costo_chile).toMatchObject({ ok: true, estado: 'no_configurado' });
    expect(Object.keys(por.postgresql).sort()).toEqual(['detalle', 'duracion_ms', 'estado', 'nombre', 'ok', 'revisado_en']);

    const guardado = await request(app).get('/api/estado/integraciones').set(auth(1));
    expect(guardado.body.revisado_en).toBe(res.body.revisado_en);
    const health = await request(app).get('/');
    expect(health.body.integraciones_ok).toBe(true);
    expect(JSON.stringify(health.body)).not.toMatch(/postgresql|google_sheets/);
  });
});

describe('POST /api/precios/calcular', () => {
  test('sin costo Chile real informa el motivo, sin detalles', async () => {
    const res = await request(app)
      .post('/api/precios/calcular')
      .set(auth(1))
      .send({ items: [{ producto_id: 1, cantidad: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.costo_chile_disponible).toBe(false);
    expect(res.body.costo_chile_motivo).toBe('sheets_no_configurado');
  });
});

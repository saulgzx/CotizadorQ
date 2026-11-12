const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query: mockQuery, connect: jest.fn() })) }));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.IA_AGENTE_TOKEN = 'token-agente-de-prueba';
delete process.env.SEGUIMIENTO_ACTIVO;

const app = require('../src/app');

const token = (id) => jwt.sign({ id, usuario: `u${id}`, role: id === 1 ? 'admin' : 'client' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const auth = (id) => ({ Authorization: `Bearer ${token(id)}`, 'x-session-id': 'sesion-test' });
const agente = { Authorization: 'Bearer token-agente-de-prueba' };
const rolPorId = { 1: 'admin', 2: 'client' };

const dbOk = (sql, params) => {
  if (/FROM sesiones/.test(sql)) return Promise.resolve({ rows: [{ id: 1, revoked: false, last_seen: new Date(), device_id: null, role: rolPorId[params[0]] }] });
  if (/SELECT role FROM usuarios/.test(sql)) return Promise.resolve({ rows: [{ role: rolPorId[params[0]] }] });
  return Promise.resolve({ rows: [], rowCount: 0 });
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(dbOk);
});

describe('rutas admin /api/seguimiento', () => {
  test('sin token 401, no admin 403', async () => {
    expect((await request(app).get('/api/seguimiento/hoy')).status).toBe(401);
    expect((await request(app).get('/api/seguimiento/hoy').set(auth(2))).status).toBe(403);
    expect((await request(app).get('/api/seguimiento/hoy').set(agente)).status).toBe(401);
  });

  test('GET /hoy devuelve las listas del resumen y el texto', async () => {
    const res = await request(app).get('/api/seguimiento/hoy').set(auth(1));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activo: false,
      borradores_listos: [],
      respuestas: [],
      borradores_sin_enviar: [],
      vencen_esta_semana: [],
      sin_correo: []
    });
    expect(res.body.texto).toMatch(/Sin pendientes/);
  });

  test('GET /lista devuelve los seguimientos con su proximo paso y sin datos del correo', async () => {
    expect((await request(app).get('/api/seguimiento/lista').set(auth(2))).status).toBe(403);
    const vacia = await request(app).get('/api/seguimiento/lista').set(auth(1));
    expect(vacia.status).toBe(200);
    expect(vacia.body).toEqual({ activo: false, total: 0, items: [] });

    mockQuery.mockImplementation((sql, params) => (/crm_seguimientos s/.test(sql)
      ? Promise.resolve({
        rows: [{
          id: 9, oportunidad_id: 5, cotizacion_id: 7, estado: 'esperando', paso: 0, numero: 'COT-65424',
          titulo: 'NAS para respaldo', empresa_nombre: 'Acme SpA', contacto_nombre: 'Ana', monto: '1200.50',
          etapa: 'cotizada', enviado_en: new Date('2026-11-02T13:00:00Z'), updated_at: new Date('2026-11-02T13:00:00Z'),
          conversation_id: 'conv-secreta', message_id: 'msg-secreto', contacto_email: 'ana@acme.cl'
        }]
      })
      : dbOk(sql, params)));
    const res = await request(app).get('/api/seguimiento/lista').set(auth(1));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      oportunidad_id: 5, numero: 'COT-65424', empresa_nombre: 'Acme SpA', monto: 1200.5, estado: 'esperando', paso: 0
    });
    expect(res.body.items[0].siguiente).toMatchObject({ accion: 'crear_borrador_1' });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|acme\.cl/);
  });

  test('GET /valor valida fechas y responde la forma del contrato', async () => {
    expect((await request(app).get('/api/seguimiento/valor?desde=ayer').set(auth(1))).status).toBe(400);
    expect((await request(app).get('/api/seguimiento/valor?desde=2026-11-10&hasta=2026-11-01').set(auth(1))).status).toBe(400);
    const res = await request(app).get('/api/seguimiento/valor?desde=2026-10-01&hasta=2026-11-01').set(auth(1));
    expect(res.status).toBe(200);
    for (const k of ['tiempo_ahorrado_min', 'ingreso_atribuido', 'margen_atribuido', 'respuestas_por_paso', 'tasa_cierre', 'ciclo_promedio_dias']) {
      expect(res.body).toHaveProperty(k);
    }
  });

  test('oportunidad inexistente: 404 en detalle, pausar y reanudar', async () => {
    expect((await request(app).get('/api/seguimiento/oportunidad/5').set(auth(1))).status).toBe(404);
    expect((await request(app).post('/api/seguimiento/oportunidad/5/pausar').set(auth(1))).status).toBe(404);
    expect((await request(app).post('/api/seguimiento/oportunidad/5/reanudar').set(auth(1))).status).toBe(404);
  });

  test('un error de base responde 500 sin detalles', async () => {
    mockQuery.mockImplementation((sql, params) => (/crm_seguimientos s/.test(sql) ? Promise.reject(new Error('relation "crm_oportunidades" does not exist')) : dbOk(sql, params)));
    const res = await request(app).get('/api/seguimiento/hoy').set(auth(1));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/relation/);
  });
});

describe('rutas del agente /api/seguimiento/agente', () => {
  test('exigen el token del agente (no un JWT de admin)', async () => {
    expect((await request(app).get('/api/seguimiento/agente/tarea')).status).toBe(401);
    expect((await request(app).get('/api/seguimiento/agente/tarea').set(auth(1))).status).toBe(401);
    expect((await request(app).get('/api/seguimiento/agente/tarea').set({ Authorization: 'Bearer otro' })).status).toBe(401);
  });

  test('sin tareas responde 204', async () => {
    const res = await request(app).get('/api/seguimiento/agente/tarea?espera=0').set(agente);
    expect(res.status).toBe(204);
  });

  test('con tarea responde su JSON', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/SET estado = 'tomada'/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 3, tipo: 'buscar_envios', created_at: new Date('2026-11-11T12:00:00Z'), items: [{ cotizacion_id: 1 }] }] });
      }
      return dbOk(sql, params);
    });
    const res = await request(app).get('/api/seguimiento/agente/tarea?espera=0').set(agente);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 3, tipo: 'buscar_envios', creada_en: '2026-11-11T12:00:00.000Z', items: [{ cotizacion_id: 1 }] });
    expect(res.body.instrucciones).toMatch(/Nunca envíes/);
  });

  test('resultado: 404 si la tarea no existe; 400 si viene malformado', async () => {
    const r404 = await request(app).post('/api/seguimiento/agente/tarea/77/resultado').set(agente).send({ ok: true, items: [] });
    expect(r404.status).toBe(404);
    mockQuery.mockImplementation((sql, params) => {
      if (/SELECT \* FROM crm_seguimiento_tareas WHERE id = \$1/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 77, tipo: 'buscar_envios', estado: 'tomada', intentos: 1, items: [{ cotizacion_id: 1 }] }] });
      }
      return dbOk(sql, params);
    });
    const r400 = await request(app).post('/api/seguimiento/agente/tarea/77/resultado').set(agente).send({ ok: true, items: [{ cotizacion_id: 1 }] });
    expect(r400.status).toBe(400);
    const reintento = mockQuery.mock.calls.find(([sql]) => /SET estado = \$2, error = \$3/.test(sql));
    expect(reintento[1][1]).toBe('pendiente');
  });
});

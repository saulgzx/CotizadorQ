/**
 * CRM dentro de la app real (legacyRoutes) con pg simulado por SQL, como los tests de
 * caracterizacion: permisos de /api/crm, enlace automatico en POST /api/cotizaciones
 * (y que un fallo del CRM no impide crear la cotizacion) y cierre de la oportunidad al
 * cambiar el estado.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, connect: mockConnect }))
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'false';
process.env.GOOGLE_SHEETS_ID = '';
process.env.GOOGLE_SHEETS_URL = '';

const app = require('../src/app');
const crm = require('../src/crm');
const { crearBdCotizacionEstado } = require('./helpers/bdCotizacionEstado');
const { logger } = require('../src/utils/logger');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const ADMIN = { id: 1, usuario: 'admin', role: 'admin' };
const CLIENTE = { id: 2, usuario: 'cliente', role: 'client' };
const BOT = { id: 5, usuario: 'mcp_bot', role: 'client' };
const ROL_POR_ID = { 1: 'admin', 2: 'client', 5: 'client' };

const incluye = (...partes) => (sql) => partes.every((p) => sql.includes(p));
const dbRouter = (tabla) => (sql, params) => {
  for (const [coincide, salida] of tabla) {
    if (coincide(sql)) return Promise.resolve(typeof salida === 'function' ? salida(sql, params) : salida);
  }
  throw new Error(`SQL sin manejar: ${sql}`);
};
const sesionActiva = () => [
  [incluye('FROM sesiones s JOIN usuarios u ON u.id = s.user_id'), (sql, p) => ({
    rows: [{ id: 10, revoked: false, last_seen: new Date(Date.now() - 1000).toISOString(), device_id: 'd', role: ROL_POR_ID[p[0]] || 'client' }]
  })],
  [incluye('UPDATE sesiones', 'SET last_seen = CURRENT_TIMESTAMP'), { rows: [] }],
  [incluye('SELECT role FROM usuarios WHERE id = $1'), (sql, p) => ({ rows: [{ role: ROL_POR_ID[p[0]] || 'client' }] })]
];
const conAuth = (req, user) => req.set('Authorization', `Bearer ${makeToken(user)}`).set('x-session-id', 'sess-1');

const transaccion = (handler) => {
  const llamadas = [];
  const client = {
    query: jest.fn((sql, params) => {
      llamadas.push({ sql, params });
      return Promise.resolve(handler(sql, params));
    }),
    release: jest.fn()
  };
  mockConnect.mockResolvedValue(client);
  return { client, llamadas };
};

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  jest.restoreAllMocks();
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});

describe('permisos de /api/crm', () => {
  const RUTAS = [
    ['get', '/api/crm/empresas'],
    ['post', '/api/crm/empresas'],
    ['get', '/api/crm/empresas/duplicados'],
    ['get', '/api/crm/empresas/1'],
    ['patch', '/api/crm/empresas/1'],
    ['post', '/api/crm/empresas/1/fusionar'],
    ['post', '/api/crm/contactos'],
    ['patch', '/api/crm/contactos/1'],
    ['get', '/api/crm/oportunidades'],
    ['post', '/api/crm/oportunidades'],
    ['patch', '/api/crm/oportunidades/1'],
    ['post', '/api/crm/oportunidades/1/cotizaciones'],
    ['get', '/api/crm/embudo']
  ];

  test.each(RUTAS)('%s %s sin token => 401', async (metodo, ruta) => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const res = await request(app)[metodo](ruta).send({});
    expect(res.status).toBe(401);
  });

  test.each(RUTAS)('%s %s con un usuario no admin => 403 sin tocar el CRM', async (metodo, ruta) => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const res = await conAuth(request(app)[metodo](ruta), CLIENTE).send({});
    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /crm_/.test(sql))).toBe(false);
  });

  test('la cuenta de servicio mcp_bot tampoco entra al CRM', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    expect((await conAuth(request(app).get('/api/crm/embudo'), BOT)).status).toBe(403);
  });

  test('un token con claim "admin" pero rol "client" en la BD => 403', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    expect((await conAuth(request(app).get('/api/crm/embudo'), { id: 2, usuario: 'x', role: 'admin' })).status).toBe(403);
  });

  test('admin: llega al router (embudo con las 5 etapas, validacion 400)', async () => {
    mockQuery.mockImplementation(dbRouter([
      ...sesionActiva(),
      [incluye('WITH ops AS'), { rows: [{ tipo: 'etapa', clave: 'cotizada', cantidad: 2, monto: '150.50' }] }]
    ]));
    const res = await conAuth(request(app).get('/api/crm/embudo'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.etapas.map((e) => e.etapa)).toEqual(['nueva', 'cotizada', 'negociacion', 'ganada', 'perdida']);
    expect(res.body.abiertas).toEqual({ cantidad: 2, monto: 150.5 });

    const malo = await conAuth(request(app).post('/api/crm/empresas'), ADMIN).send({ nombre: '' });
    expect(malo.status).toBe(400);
  });
});

describe('POST /api/cotizaciones enlaza con el CRM', () => {
  const COT = { id: 501, numero: 65900, estado: 'revision' };
  const handlerBase = (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('INSERT INTO cotizaciones')) return { rows: [COT] };
    if (sql.includes('INSERT INTO cotizacion_items')) return { rows: [] };
    return undefined;
  };
  // Lineas de admin: se guardan tal cual (con su origen).
  const ITEMS = [
    { descripcion: 'Camara', marca: 'AXIS', origen: 'AXIS', cantidad: 1, precio_unitario: 100 },
    { descripcion: 'NAS', marca: 'QNAP', origen: 'QNAP', cantidad: 1, precio_unitario: 200 }
  ];
  const BODY = { cliente: { nombre: 'Ana', empresa: 'SONDA S.A.', email: 'ana@sonda.cl' }, items: ITEMS, total: 300 };

  test('crea empresa, contacto y oportunidad (marca MIXTA) despues del COMMIT y los devuelve', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas, client } = transaccion((sql, params) => {
      const base = handlerBase(sql);
      if (base) return base;
      if (sql.includes('FROM cotizaciones c') && sql.includes('FOR UPDATE')) {
        return { rows: [{ ...COT, cliente_nombre: 'Ana', cliente_empresa: 'SONDA S.A.', cliente_email: 'ana@sonda.cl', empresa_id: null, oportunidad_id: null }] };
      }
      if (sql.includes('FROM crm_empresas WHERE nombre_normalizado')) return { rows: [] };
      if (sql.includes('INSERT INTO crm_empresas')) return { rows: [{ id: 7, nombre: params[0], nombre_normalizado: params[1] }] };
      if (sql.includes('FROM crm_contactos')) return { rows: [] };
      if (sql.includes('INSERT INTO crm_contactos')) return { rows: [{ id: 8 }] };
      if (sql.includes('INSERT INTO crm_oportunidades')) return { rows: [{ id: 9 }] };
      if (sql.includes('UPDATE cotizaciones SET empresa_id')) return { rows: [{ id: 501 }] };
      throw new Error(`SQL sin manejar: ${sql}`);
    });

    const res = await conAuth(request(app).post('/api/cotizaciones'), ADMIN).send(BODY);

    expect(res.status).toBe(201);
    expect(res.body.cotizacion).toEqual({ ...COT, empresa_id: 7, contacto_id: 8, oportunidad_id: 9 });
    const sqls = llamadas.map((l) => l.sql);
    // La cotizacion se confirma ANTES de tocar el CRM, que corre en su propia transaccion.
    expect(sqls.slice(0, 4)).toEqual(['BEGIN', expect.stringContaining('INSERT INTO cotizaciones'), expect.stringContaining('INSERT INTO cotizacion_items'), 'COMMIT']);
    expect(sqls[4]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(llamadas.find((l) => l.sql.includes('INSERT INTO crm_empresas')).params.slice(0, 2)).toEqual(['SONDA S.A.', 'sonda']);
    const op = llamadas.find((l) => l.sql.includes('INSERT INTO crm_oportunidades')).params;
    // Cotizacion nueva (estado revision) => oportunidad en etapa 'nueva' (antes 'cotizada').
    expect(op.slice(0, 5)).toEqual([7, 8, 'Cotización #65900', 'nueva', 'MIXTA']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('si el CRM falla, la cotizacion se crea igual (201) y el error queda en el log', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas, client } = transaccion((sql) => {
      const base = handlerBase(sql);
      if (base) return base;
      throw new Error('relation "crm_empresas" does not exist');
    });

    const res = await conAuth(request(app).post('/api/cotizaciones'), ADMIN).send(BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'Cotizacion guardada', cotizacion: COT });
    const sqls = llamadas.map((l) => l.sql);
    expect(sqls.indexOf('COMMIT')).toBeLessThan(sqls.indexOf('ROLLBACK'));
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'crm_enlace_error', cotizacion_id: 501 }), expect.any(String));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('aunque el enlace lanzara (no deberia), la ruta responde 201', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    transaccion((sql) => handlerBase(sql) || { rows: [] });
    jest.spyOn(crm, 'enlazarCotizacionNueva').mockRejectedValue(new Error('inesperado'));
    const res = await conAuth(request(app).post('/api/cotizaciones'), ADMIN).send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.cotizacion).toEqual(COT);
  });

  test('pasa oportunidad_id del body y la marca de las lineas al enlace', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { client } = transaccion((sql) => handlerBase(sql) || { rows: [] });
    const espia = jest.spyOn(crm, 'enlazarCotizacionNueva').mockResolvedValue({ empresa_id: 3, contacto_id: null, oportunidad_id: 44 });
    const res = await conAuth(request(app).post('/api/cotizaciones'), ADMIN).send({ ...BODY, items: [ITEMS[0]], oportunidad_id: 44 });
    expect(res.status).toBe(201);
    expect(espia).toHaveBeenCalledWith(client, { cotizacionId: 501, marca: 'AXIS', oportunidadId: 44 });
    expect(res.body.cotizacion.oportunidad_id).toBe(44);
  });
});

describe('PATCH /api/cotizaciones/:id/estado mueve la etapa de la oportunidad', () => {
  // Antes: UPDATE del estado + cierre best-effort de la oportunidad (solo aprobada/rechazada).
  // Ahora la etapa manda: se cambia con las reglas del CRM y el estado se deriva, todo en
  // una transaccion; si la BD falla, nada cambia y responde 500.
  const preparar = ({ etapa = 'cotizada', oportunidadId = 9, falla = null } = {}) => {
    const bd = crearBdCotizacionEstado({
      cotizaciones: [{ id: 77, usuario_id: 1, estado: 'enviada', oportunidad_id: oportunidadId, empresa_id: oportunidadId ? 3 : 4 }],
      oportunidades: oportunidadId ? [{ id: oportunidadId, etapa }] : [],
      falla
    });
    mockQuery.mockImplementation(bd.conRespaldo(dbRouter([
      ...sesionActiva(),
      [incluye('SELECT role, empresa, intcomex_profile FROM usuarios WHERE id = $1'), { rows: [{ role: 'admin', empresa: '', intcomex_profile: null }] }]
    ])));
    mockConnect.mockResolvedValue(bd.cliente);
    return bd;
  };
  const patch = (body) => conAuth(request(app).patch('/api/cotizaciones/77/estado'), ADMIN).send(body);

  test('aprobada => ganada; rechazada => perdida con motivo del cotizador; enviada reabre', async () => {
    let bd = preparar();
    expect((await patch({ estado: 'aprobada' })).status).toBe(200);
    expect(bd.ops.get(9)).toMatchObject({ etapa: 'ganada', motivo_perdida: null });

    bd = preparar();
    expect((await patch({ estado: 'rechazada' })).status).toBe(200);
    expect(bd.ops.get(9)).toMatchObject({ etapa: 'perdida', motivo_perdida: 'Rechazada en el cotizador' });

    const res = await patch({ estado: 'enviada' });
    expect(res.body).toMatchObject({ estado: 'enviada', etapa: 'cotizada', motivo_perdida: null });
    expect(bd.ops.get(9).cerrada_en).toBeNull();
  });

  test('sin oportunidad vinculada: no toca crm_oportunidades', async () => {
    const bd = preparar({ oportunidadId: null });
    expect((await patch({ estado: 'aprobada' })).status).toBe(200);
    expect(bd.sqls.some((s) => s.includes('crm_oportunidades SET'))).toBe(false);
    expect(bd.cots.get(77).estado).toBe('aprobada');
  });

  test('si la BD falla al cambiar la etapa: 500 y la oportunidad no cambia', async () => {
    const bd = preparar({ falla: (sql) => sql.startsWith('UPDATE crm_oportunidades') });
    const res = await patch({ etapa: 'ganada' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
    expect(bd.ops.get(9).etapa).toBe('cotizada');
    expect(bd.cliente.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
  });
});

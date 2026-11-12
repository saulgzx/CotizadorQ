/**
 * Archivado de cotizaciones (y de sus oportunidades): POST /api/cotizaciones/archivar,
 * GET /api/cotizaciones/archivar/previa, POST /api/cotizaciones/restaurar, y su efecto en
 * el listado, el detalle y el funnel. App real con pg simulado por texto SQL. La
 * semantica de las consultas contra PostgreSQL real esta en crm.postgres.test.js.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, connect: mockConnect }))
}));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'false';
process.env.GOOGLE_SHEETS_ID = '';
process.env.GOOGLE_SHEETS_URL = '';

const app = require('../src/app');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const ADMIN = { id: 1, usuario: 'admin', role: 'admin' };
const CLIENTE = { id: 2, usuario: 'cliente', role: 'client' };
const STOCK_ADMIN = { id: 3, usuario: 'nsteck', role: 'cot_stock_admin' };
const ROLES = { 1: 'admin', 2: 'client', 3: 'cot_stock_admin' };
const incluye = (...partes) => (sql) => partes.every((p) => sql.includes(p));
const dbRouter = (tabla) => (sql, params) => {
  for (const [coincide, salida] of tabla) {
    if (coincide(sql)) return Promise.resolve(typeof salida === 'function' ? salida(sql, params) : salida);
  }
  throw new Error(`SQL sin manejar: ${sql}`);
};
const sesionActiva = () => [
  [incluye('FROM sesiones s JOIN usuarios u ON u.id = s.user_id'), (sql, p) => ({
    rows: [{ id: 10, revoked: false, last_seen: new Date(Date.now() - 1000).toISOString(), device_id: 'd', role: ROLES[p[0]] || 'client' }]
  })],
  [incluye('UPDATE sesiones', 'SET last_seen = CURRENT_TIMESTAMP'), { rows: [] }],
  [incluye('SELECT role FROM usuarios WHERE id = $1'), (sql, p) => ({ rows: [{ role: ROLES[p[0]] || 'client' }] })]
];
const conAuth = (req, user) => req.set('Authorization', `Bearer ${makeToken(user)}`).set('x-session-id', 'sess-1');
const plano = (sql) => sql.replace(/\s+/g, ' ');

/** Transaccion: responde a cada UPDATE de archivado con `filas[n]` filas. */
const transaccion = (filas = []) => {
  const llamadas = [];
  let n = 0;
  const client = {
    query: jest.fn(async (sql, params) => {
      llamadas.push({ sql: plano(sql), params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      const cantidad = filas[n] ?? 0;
      n += 1;
      return { rows: Array.from({ length: cantidad }, (_, i) => ({ id: i + 1, oportunidad_id: i < 2 ? 9 + i : null })) };
    }),
    release: jest.fn()
  };
  mockConnect.mockResolvedValue(client);
  return { client, llamadas };
};

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockQuery.mockImplementation(dbRouter(sesionActiva()));
});

describe('permisos', () => {
  const RUTAS = [
    ['post', '/api/cotizaciones/archivar', { ids: [1] }],
    ['get', '/api/cotizaciones/archivar/previa?antes_de=2026-01-01', undefined],
    ['post', '/api/cotizaciones/restaurar', { ids: [1] }]
  ];
  test.each(RUTAS)('%s %s sin token => 401', async (metodo, ruta, body) => {
    expect((await request(app)[metodo](ruta).send(body)).status).toBe(401);
  });
  test.each(RUTAS)('%s %s cliente o cot_stock_admin => 403 sin abrir transaccion', async (metodo, ruta, body) => {
    for (const user of [CLIENTE, STOCK_ADMIN]) {
      expect((await conAuth(request(app)[metodo](ruta), user).send(body)).status).toBe(403);
    }
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('POST /api/cotizaciones/archivar', () => {
  const archivar = (body) => conAuth(request(app).post('/api/cotizaciones/archivar'), ADMIN).send(body);

  test('por ids: marca las cotizaciones y luego las oportunidades que quedaron sin cotizaciones vigentes', async () => {
    const { llamadas, client } = transaccion([3, 1]);
    const res = await archivar({ ids: [5, '6', 5, 7] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cotizaciones: 3, oportunidades: 1 });
    const [begin, cot, op, commit] = llamadas;
    expect([begin.sql, commit.sql]).toEqual(['BEGIN', 'COMMIT']);
    expect(cot.sql).toMatch(/UPDATE cotizaciones SET archivada_en = CURRENT_TIMESTAMP WHERE id = ANY\(\$1::int\[\]\) AND archivada_en IS NULL RETURNING id, oportunidad_id/);
    expect(cot.params).toEqual([[5, 6, 7]]); // sin repetidos
    expect(op.sql).toMatch(/UPDATE crm_oportunidades o SET archivada_en = CURRENT_TIMESTAMP WHERE o\.id = ANY\(\$1::int\[\]\) AND o\.archivada_en IS NULL/);
    expect(op.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM cotizaciones c WHERE c\.oportunidad_id = o\.id AND c\.archivada_en IS NULL\)/);
    expect(op.params).toEqual([[9, 10]]); // las oportunidades de las cotizaciones archivadas
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('por ids ya archivadas o sin oportunidad: no toca crm_oportunidades', async () => {
    const { llamadas } = transaccion([0]);
    const res = await archivar({ ids: [5] });
    expect(res.body).toEqual({ cotizaciones: 0, oportunidades: 0 });
    expect(llamadas.some((l) => l.sql.includes('crm_oportunidades'))).toBe(false);
  });

  test('por fecha: todas las no archivadas anteriores, sus oportunidades y las oportunidades vacias anteriores', async () => {
    const { llamadas } = transaccion([40, 12]);
    const res = await archivar({ antes_de: '2026-01-01' });
    expect(res.body).toEqual({ cotizaciones: 40, oportunidades: 12 });
    const [, cot, op] = llamadas;
    expect(cot.sql).toMatch(/WHERE archivada_en IS NULL AND created_at < \$1::date/);
    expect(cot.params).toEqual(['2026-01-01']);
    expect(op.sql).toMatch(/OR \(NOT EXISTS \(SELECT 1 FROM cotizaciones c WHERE c\.oportunidad_id = o\.id\) AND o\.created_at < \$1::date\)/);
    expect(op.params).toEqual(['2026-01-01']);
  });

  test.each([
    [{}],
    [{ ids: [] }],
    [{ ids: Array.from({ length: 501 }, (_, i) => i + 1) }],
    [{ ids: [1], antes_de: '2026-01-01' }],
    [{ ids: [0] }],
    [{ ids: ['x'] }],
    [{ antes_de: '2026-02-31' }],
    [{ antes_de: '01-01-2026' }],
    [{ ids: [1], otro: true }]
  ])('cuerpo invalido %p => 400 sin abrir transaccion', async (body) => {
    const res = await archivar(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Payload invalido');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('error de BD: 500 y ROLLBACK', async () => {
    const llamadas = [];
    mockConnect.mockResolvedValue({
      query: jest.fn(async (sql) => { llamadas.push(sql); if (sql.includes('UPDATE')) throw new Error('boom'); return { rows: [] }; }),
      release: jest.fn()
    });
    const res = await archivar({ ids: [1] });
    expect(res.status).toBe(500);
    expect(llamadas).toContain('ROLLBACK');
  });
});

describe('GET /api/cotizaciones/archivar/previa', () => {
  test('cuenta sin modificar nada', async () => {
    let consulta;
    mockQuery.mockImplementation(dbRouter([
      ...sesionActiva(),
      [incluye('AS cotizaciones', 'AS oportunidades'), (sql, p) => { consulta = { sql: plano(sql), p }; return { rows: [{ cotizaciones: 40, oportunidades: 12 }] }; }]
    ]));
    const res = await conAuth(request(app).get('/api/cotizaciones/archivar/previa?antes_de=2026-01-01'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cotizaciones: 40, oportunidades: 12 });
    expect(consulta.p).toEqual(['2026-01-01']);
    expect(consulta.sql).toMatch(/^SELECT/);
    expect(consulta.sql).not.toMatch(/UPDATE/);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('sin antes_de o invalida: 400', async () => {
    expect((await conAuth(request(app).get('/api/cotizaciones/archivar/previa'), ADMIN)).status).toBe(400);
    expect((await conAuth(request(app).get('/api/cotizaciones/archivar/previa?antes_de=ayer'), ADMIN)).status).toBe(400);
  });
});

describe('POST /api/cotizaciones/restaurar', () => {
  test('quita archivada_en a las cotizaciones y a sus oportunidades', async () => {
    const { llamadas } = transaccion([2, 1]);
    const res = await conAuth(request(app).post('/api/cotizaciones/restaurar'), ADMIN).send({ ids: [5, 6] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cotizaciones: 2, oportunidades: 1 });
    const [, cot, op] = llamadas;
    expect(cot.sql).toMatch(/UPDATE cotizaciones SET archivada_en = NULL WHERE id = ANY\(\$1::int\[\]\) AND archivada_en IS NOT NULL/);
    expect(op.sql).toMatch(/UPDATE crm_oportunidades o SET archivada_en = NULL WHERE o\.archivada_en IS NOT NULL AND o\.id IN \(SELECT c\.oportunidad_id FROM cotizaciones c WHERE c\.id = ANY\(\$1::int\[\]\)\)/);
    expect(op.params).toEqual([[5, 6]]);
  });

  test('sin ids (o con antes_de): 400', async () => {
    expect((await conAuth(request(app).post('/api/cotizaciones/restaurar'), ADMIN).send({})).status).toBe(400);
    expect((await conAuth(request(app).post('/api/cotizaciones/restaurar'), ADMIN).send({ antes_de: '2026-01-01' })).status).toBe(400);
  });
});

describe('GET /api/cotizaciones con archivadas', () => {
  const listaDb = (calls) => dbRouter([
    ...sesionActiva(),
    [incluye('FROM cotizaciones c', 'LEFT JOIN usuarios u'), (sql, p) => {
      calls.lista = { sql: plano(sql), p };
      return { rows: [{ id: 77, estado: 'enviada', etapa: 'negociacion', motivo_perdida: null, archivada_en: null }] };
    }],
    [incluye('COUNT(*)::int AS total'), (sql, p) => { calls.count = { sql: plano(sql), p }; return { rows: [{ total: 1 }] }; }]
  ]);

  test('admin: por defecto excluye las archivadas y agrega etapa, motivo_perdida y empresa_crm', async () => {
    const calls = {};
    mockQuery.mockImplementation(listaDb(calls));
    const res = await conAuth(request(app).get('/api/cotizaciones'), ADMIN);
    expect(res.status).toBe(200);
    expect(calls.lista.sql).toContain('WHERE c.archivada_en IS NULL');
    expect(calls.lista.sql).toMatch(/COALESCE\(o\.etapa, \(CASE WHEN c\.estado = 'revision' THEN 'nueva'/);
    expect(calls.lista.sql).toContain('o.motivo_perdida, ce.nombre AS empresa_crm');
    expect(calls.lista.sql).toContain('LEFT JOIN crm_oportunidades o ON o.id = c.oportunidad_id LEFT JOIN crm_empresas ce ON ce.id = c.empresa_id');
    expect(res.body[0]).toMatchObject({ etapa: 'negociacion', estado: 'enviada' });
  });

  test('admin con ?archivadas=1: SOLO las archivadas (con y sin paginacion)', async () => {
    const calls = {};
    mockQuery.mockImplementation(listaDb(calls));
    await conAuth(request(app).get('/api/cotizaciones?archivadas=1'), ADMIN);
    expect(calls.lista.sql).toContain('WHERE c.archivada_en IS NOT NULL');

    await conAuth(request(app).get('/api/cotizaciones?archivadas=1&page=1&pageSize=10'), ADMIN);
    expect(calls.count.sql).toContain('WHERE c.archivada_en IS NOT NULL');
    expect(calls.lista.sql).toContain('WHERE c.archivada_en IS NOT NULL');
    expect(calls.lista.p).toEqual([10, 0]);

    await conAuth(request(app).get('/api/cotizaciones?page=1'), ADMIN);
    expect(calls.count.sql).toContain('WHERE c.archivada_en IS NULL');
  });

  test('cliente: sin cambio (todas las suyas, archivadas o no; ?archivadas se ignora) y sin empresa_crm', async () => {
    for (const url of ['/api/cotizaciones', '/api/cotizaciones?archivadas=1']) {
      const calls = {};
      mockQuery.mockImplementation(listaDb(calls));
      const res = await conAuth(request(app).get(url), CLIENTE);
      expect(res.status).toBe(200);
      expect(calls.lista.sql).toContain('WHERE c.usuario_id = $1');
      expect(calls.lista.sql).not.toContain('archivada_en IS');
      expect(calls.lista.sql).not.toContain('empresa_crm');
      expect(calls.lista.sql).not.toContain('crm_empresas');
      expect(calls.lista.sql).toContain('AS etapa, o.motivo_perdida');
      expect(calls.lista.p).toEqual([2]);
    }
  });
});

describe('GET /api/cotizaciones/:id', () => {
  test('agrega etapa y motivo_perdida (y empresa_crm solo al admin)', async () => {
    const sqls = [];
    mockQuery.mockImplementation(dbRouter([
      ...sesionActiva(),
      [incluye('FROM cotizaciones c', 'WHERE c.id = $1'), (sql) => { sqls.push(plano(sql)); return { rows: [{ id: 77, usuario_id: 2, etapa: 'perdida', motivo_perdida: 'Precio', archivada_en: null }] }; }],
      [incluye('FROM cotizacion_items'), { rows: [] }]
    ]));
    const admin = await conAuth(request(app).get('/api/cotizaciones/77'), ADMIN);
    expect(admin.body).toMatchObject({ etapa: 'perdida', motivo_perdida: 'Precio', archivada_en: null });
    expect(sqls[0]).toContain('ce.nombre AS empresa_crm');
    const cliente = await conAuth(request(app).get('/api/cotizaciones/77'), CLIENTE);
    expect(cliente.status).toBe(200);
    expect(sqls[1]).not.toContain('empresa_crm');
    expect(sqls[1]).toContain('c.id = $1 AND c.usuario_id = $2');
  });
});

describe('GET /api/cotizaciones/funnel', () => {
  test('excluye las archivadas y agrega el conteo por etapa (las 5 siempre)', async () => {
    let consulta;
    mockQuery.mockImplementation(dbRouter([
      ...sesionActiva(),
      [incluye('FROM cotizaciones c', 'GROUP BY 1, 2'), (sql, p) => {
        consulta = { sql: plano(sql), p };
        return {
          rows: [
            { estado: 'enviada', etapa: 'cotizada', count: 2, amount: '100.50' },
            { estado: 'enviada', etapa: 'negociacion', count: 1, amount: '50.00' },
            { estado: 'aprobada', etapa: 'ganada', count: 1, amount: '10' }
          ]
        };
      }]
    ]));
    const res = await conAuth(request(app).get('/api/cotizaciones/funnel?empresa=acme'), ADMIN);
    expect(res.status).toBe(200);
    expect(consulta.sql).toContain('WHERE c.archivada_en IS NULL');
    expect(consulta.sql).toContain('AND c.cliente_empresa ILIKE $2');
    expect(res.body.stages).toEqual([
      { estado: 'enviada', count: 3, amount: 150.5 },
      { estado: 'aprobada', count: 1, amount: 10 }
    ]);
    expect(res.body.etapas).toEqual([
      { etapa: 'nueva', count: 0, amount: 0 },
      { etapa: 'cotizada', count: 2, amount: 100.5 },
      { etapa: 'negociacion', count: 1, amount: 50 },
      { etapa: 'ganada', count: 1, amount: 10 },
      { etapa: 'perdida', count: 0, amount: 0 }
    ]);
  });
});

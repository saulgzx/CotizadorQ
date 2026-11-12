/**
 * Versiones v1...vN de una cotizacion (PUT /api/cotizaciones/:id, GET /:id/versiones,
 * GET /:id/versiones/:version), PUT con estado por la via del CRM y la version en el
 * nombre del PDF. App real con pg simulado por texto SQL.
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
const { buildPdfFilename, buildPdfBaseName } = require('../src/routes/legacyRoutes');
const versiones = require('../src/services/cotizacionVersiones');
const { normalizarLineaAdmin } = require('../src/services/cotizacionItems');
const { crearBdCotizacionEstado } = require('./helpers/bdCotizacionEstado');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const ADMIN = { id: 1, usuario: 'admin', role: 'admin' };
const CLIENTE = { id: 2, usuario: 'cliente', role: 'client' };
const incluye = (...partes) => (sql) => partes.every((p) => sql.includes(p));
const dbRouter = (tabla) => (sql, params) => {
  for (const [coincide, salida] of tabla) {
    if (coincide(sql)) return Promise.resolve(typeof salida === 'function' ? salida(sql, params) : salida);
  }
  throw new Error(`SQL sin manejar: ${sql}`);
};
const rol = (id) => (Number(id) === 1 ? 'admin' : 'client');
const sesionActiva = () => [
  [incluye('FROM sesiones s JOIN usuarios u ON u.id = s.user_id'), (sql, p) => ({
    rows: [{ id: 10, revoked: false, last_seen: new Date(Date.now() - 1000).toISOString(), device_id: 'd', role: rol(p[0]) }]
  })],
  [incluye('UPDATE sesiones', 'SET last_seen = CURRENT_TIMESTAMP'), { rows: [] }],
  [incluye('SELECT role FROM usuarios WHERE id = $1'), (sql, p) => ({ rows: [{ role: rol(p[0]) }] })]
];
const conAuth = (req, user) => req.set('Authorization', `Bearer ${makeToken(user)}`).set('x-session-id', 'sess-1');

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

// Linea tal como la guarda la BD (DECIMAL como texto) y como la manda el editor.
const ITEM_BD = {
  id: 5, cotizacion_id: 77, producto_id: 3, marca: 'QNAP', sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS', origen: 'QNAP',
  precio_disty: '700.00', rebate_partner: null, rebate_proyecto: null, partner_category: null, costo_unitario: '800.00',
  gp: '0.1579', cantidad: 2, precio_unitario: '950.00', precio_total: '1900.00', tiempo_entrega: '8 semanas', orden: 0
};
const LINEA_EDITOR = {
  producto_id: 3, marca: 'QNAP', sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS', origen: 'QNAP', precio_disty: 700,
  costo_unitario: 800, cantidad: 2, precio_unitario: 950, tiempo_entrega: '8 semanas'
};
const COTIZACION = {
  id: 77, version: 2, total: '1900.00', estado: 'enviada', usuario: 'vendedor', updated_by: 'admin',
  created_at: new Date('2026-10-01T12:00:00Z'), updated_at: new Date('2026-10-05T12:00:00Z'),
  cliente_nombre: 'Ana', cliente_empresa: 'ACME', cliente_email: 'PID-1', cliente_telefono: 'Proyecto X',
  cliente_final: null, fecha_ejecucion: new Date(2026, 11, 1), fecha_implementacion: null, vms: null,
  oportunidad_id: null, empresa_id: 3
};
const CUERPO_IGUAL = {
  cliente: { nombre: 'Ana', empresa: 'ACME', email: 'PID-1', telefono: 'Proyecto X', fecha_ejecucion: '2026-12-01' },
  items: [LINEA_EDITOR]
};

/** Transaccion del PUT: cotizacion 77 con sus lineas; registra todo lo escrito. */
const transaccionPut = ({ cotizacion = COTIZACION, items = [ITEM_BD], bd = null } = {}) => {
  const llamadas = [];
  let itemsActuales = items;
  const client = {
    query: jest.fn(async (sql, params) => {
      llamadas.push({ sql, params });
      const crm = bd ? bd.responder(sql, params) : undefined;
      if (crm !== undefined) return crm;
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('FROM cotizaciones WHERE id = $1 FOR UPDATE')) return { rows: [{ ...cotizacion }] };
      if (sql.includes('SELECT * FROM cotizacion_items')) return { rows: itemsActuales };
      if (sql.includes('INSERT INTO cotizacion_versiones')) return { rows: [] };
      if (sql.includes('UPDATE cotizaciones') && sql.includes('cliente_nombre = $1')) {
        const estado = params[9] || (bd ? bd.cots.get(77).estado : cotizacion.estado);
        return { rows: [{ ...cotizacion, version: params[10], total: params[8], estado }] };
      }
      if (sql.includes('DELETE FROM cotizacion_items')) return { rows: [] };
      if (sql.includes('INSERT INTO cotizacion_items')) {
        itemsActuales = [{ ...ITEM_BD, cantidad: params[13], precio_unitario: params[14], precio_total: params[15] }];
        return { rows: [] };
      }
      throw new Error(`SQL sin manejar en el PUT: ${sql}`);
    }),
    release: jest.fn()
  };
  mockConnect.mockResolvedValue(client);
  return { client, llamadas };
};
const put = (body) => conAuth(request(app).put('/api/cotizaciones/77'), ADMIN).send(body);
const filasVersion = (llamadas) => llamadas.filter((l) => l.sql.includes('INSERT INTO cotizacion_versiones'));

describe('PUT /api/cotizaciones/:id: versiones', () => {
  test('sin cambios (mismo cliente, estado y lineas normalizadas): 200 sin_cambios, no versiona ni escribe', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas, client } = transaccionPut();
    const res = await put({ ...CUERPO_IGUAL, estado: 'enviada', expected_version: 2, nota: 'nada' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 77, version: 2, sin_cambios: true });
    expect(res.body.items[0]).toMatchObject({ cantidad: 2, margen_unitario: 150 });
    const sqls = llamadas.map((l) => l.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(sqls.some((s) => /^\s*(INSERT|UPDATE|DELETE)/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('cualquier cambio (cantidad, precio, costo, orden, cliente o estado) si versiona', async () => {
    const casos = [
      { items: [{ ...LINEA_EDITOR, cantidad: 3 }] },
      { items: [{ ...LINEA_EDITOR, precio_unitario: 951 }] },
      { items: [{ ...LINEA_EDITOR, costo_unitario: 799.99 }] },
      { items: [LINEA_EDITOR, LINEA_EDITOR] },
      { cliente: { ...CUERPO_IGUAL.cliente, nombre: 'Ana Maria' } },
      { cliente: { ...CUERPO_IGUAL.cliente, fecha_ejecucion: '2026-12-02' } },
      { estado: 'aprobada' }
    ];
    for (const cambio of casos) {
      mockQuery.mockImplementation(dbRouter(sesionActiva()));
      const { llamadas } = transaccionPut();
      const res = await put({ ...CUERPO_IGUAL, ...cambio });
      expect(res.status).toBe(200);
      expect(res.body.sin_cambios).toBe(false);
      expect(filasVersion(llamadas)).toHaveLength(2);
    }
  });

  test('con cambios: fila de la version anterior (autor y fecha originales, sin nota) y de la nueva (nota, quien edita, ahora)', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccionPut();
    const res = await put({ ...CUERPO_IGUAL, items: [{ ...LINEA_EDITOR, cantidad: 3 }], nota: '  Cliente pidio 3  ', expected_version: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 3, total: 2850, sin_cambios: false });

    const [anterior, nueva] = filasVersion(llamadas);
    expect(anterior.sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, NULL, \$5, COALESCE\(\$6::timestamp, CURRENT_TIMESTAMP\)\)/);
    expect(anterior.sql).toContain('ON CONFLICT (cotizacion_id, version) DO NOTHING');
    expect(anterior.params[1]).toBe(2);
    expect(JSON.parse(anterior.params[2]).items[0].cantidad).toBe(2);
    expect(anterior.params[4]).toBe('admin'); // updated_by: autor de la v2
    expect(anterior.params[5]).toEqual(COTIZACION.updated_at);

    expect(nueva.sql).toContain('CURRENT_TIMESTAMP)');
    expect(nueva.params[1]).toBe(3);
    expect(JSON.parse(nueva.params[2]).cotizacion.version).toBe(3);
    expect(JSON.parse(nueva.params[2]).items[0].cantidad).toBe(3);
    expect(nueva.params[3]).toBe(2850);
    expect(nueva.params[4]).toBe('Cliente pidio 3');
    expect(nueva.params[5]).toBe('admin');
    // La nueva se escribe despues de reemplazar las lineas y antes del COMMIT.
    const sqls = llamadas.map((l) => l.sql);
    expect(sqls.indexOf(nueva.sql)).toBeGreaterThan(sqls.findIndex((s) => s.includes('INSERT INTO cotizacion_items')));
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  test('cotizacion nunca editada (v1): la fila v1 toma usuario y created_at', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccionPut({ cotizacion: { ...COTIZACION, version: 1, updated_by: null, updated_at: null } });
    await put({ ...CUERPO_IGUAL, items: [{ ...LINEA_EDITOR, cantidad: 3 }] });
    const [v1] = filasVersion(llamadas);
    expect(v1.params[1]).toBe(1);
    expect(v1.params[4]).toBe('vendedor');
    expect(v1.params[5]).toEqual(COTIZACION.created_at);
  });

  test('409 por expected_version se mantiene', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccionPut();
    const res = await put({ ...CUERPO_IGUAL, expected_version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.version_actual).toBe(2);
    expect(filasVersion(llamadas)).toHaveLength(0);
  });

  test('PUT con estado y oportunidad: cambia la etapa en la MISMA transaccion y el estado se deriva', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const bd = crearBdCotizacionEstado({
      cotizaciones: [{ id: 77, estado: 'enviada', oportunidad_id: 9, empresa_id: 3 }, { id: 78, estado: 'enviada', oportunidad_id: 9 }],
      oportunidades: [{ id: 9, etapa: 'cotizada' }]
    });
    const { llamadas } = transaccionPut({ cotizacion: { ...COTIZACION, oportunidad_id: 9 }, bd });
    const res = await put({ ...CUERPO_IGUAL, estado: 'rechazada' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('rechazada');
    expect(bd.ops.get(9)).toMatchObject({ etapa: 'perdida', motivo_perdida: 'Rechazada en el cotizador' });
    expect(bd.cots.get(78).estado).toBe('rechazada');
    const sqls = llamadas.map((l) => l.sql);
    expect(sqls.findIndex((s) => s.startsWith('UPDATE crm_oportunidades'))).toBeLessThan(sqls.indexOf('COMMIT'));
    // El UPDATE de la cotizacion no pisa el estado derivado.
    expect(llamadas.find((l) => l.sql.includes('cliente_nombre = $1')).params[9]).toBeNull();
  });
});

describe('GET /api/cotizaciones/:id/versiones', () => {
  const preparar = ({ cotizacion = COTIZACION, filas = [] } = {}) =>
    mockQuery.mockImplementation(dbRouter([
      ...sesionActiva(),
      [incluye('SELECT * FROM cotizaciones WHERE id = $1'), (sql, p) => ({ rows: Number(p[0]) === 77 ? [cotizacion] : [] })],
      [incluye('FROM cotizacion_versiones', 'ORDER BY version DESC'), { rows: filas }],
      [incluye('FROM cotizacion_versiones', 'AND version = $2'), (sql, p) => ({ rows: filas.filter((f) => f.version === p[1]) })],
      [incluye('SELECT * FROM cotizacion_items'), { rows: [ITEM_BD] }]
    ]));

  test('sin filas (cotizacion editada antes de este cambio): sintetiza la vigente desde cotizaciones', async () => {
    preparar();
    const res = await conAuth(request(app).get('/api/cotizaciones/77/versiones'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { version: 2, total: '1900.00', nota: null, creado_por: 'admin', creado_en: COTIZACION.updated_at.toISOString(), vigente: true }
    ]);
  });

  test('con filas v1..vN: DESC, vigente marcada, sin sintetizar', async () => {
    const filas = [
      { version: 2, total: '1900.00', nota: 'Ajuste', creado_por: 'admin', creado_en: '2026-10-05T12:00:00.000Z' },
      { version: 1, total: '1000.00', nota: null, creado_por: 'vendedor', creado_en: '2026-10-01T12:00:00.000Z' }
    ];
    preparar({ filas });
    const res = await conAuth(request(app).get('/api/cotizaciones/77/versiones'), ADMIN);
    expect(res.body.map((v) => [v.version, v.vigente, v.nota])).toEqual([[2, true, 'Ajuste'], [1, false, null]]);
  });

  test('datos viejos con la v1 pero sin la vigente: agrega la vigente', async () => {
    preparar({ filas: [{ version: 1, total: '1000.00', nota: 'nota vieja', creado_por: 'admin', creado_en: '2026-10-05T12:00:00.000Z' }] });
    const res = await conAuth(request(app).get('/api/cotizaciones/77/versiones'), ADMIN);
    expect(res.body.map((v) => [v.version, v.vigente])).toEqual([[2, true], [1, false]]);
  });

  test('404 si la cotizacion no existe; 403 para no admin', async () => {
    preparar();
    expect((await conAuth(request(app).get('/api/cotizaciones/999/versiones'), ADMIN)).status).toBe(404);
    expect((await conAuth(request(app).get('/api/cotizaciones/77/versiones'), CLIENTE)).status).toBe(403);
  });

  test('GET /:id/versiones/:version: la vigente sin fila sale de las tablas actuales', async () => {
    preparar();
    const res = await conAuth(request(app).get('/api/cotizaciones/77/versiones/2'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, total: '1900.00', nota: null, creado_por: 'admin', cotizacion: { id: 77, version: 2 } });
    expect(res.body.items[0]).toMatchObject({ cantidad: 2, margen_unitario: 150 });
    expect((await conAuth(request(app).get('/api/cotizaciones/77/versiones/1'), ADMIN)).status).toBe(404);
    expect((await conAuth(request(app).get('/api/cotizaciones/77/versiones/x'), ADMIN)).status).toBe(404);
  });

  test('GET /:id/versiones/:version con fila: misma forma de siempre', async () => {
    const snapshot = { cotizacion: { id: 77, version: 1 }, items: [ITEM_BD] };
    preparar({ filas: [{ version: 1, total: '1000.00', nota: null, creado_por: 'vendedor', creado_en: '2026-10-01T12:00:00.000Z', snapshot }] });
    const res = await conAuth(request(app).get('/api/cotizaciones/77/versiones/1'), ADMIN);
    expect(res.body).toMatchObject({ version: 1, total: '1000.00', creado_por: 'vendedor', cotizacion: { id: 77, version: 1 } });
  });
});

describe('cotizacionVersiones (puro)', () => {
  test('sinCambios compara fechas DATE de pg con texto y normaliza las lineas', () => {
    const cabecera = {
      cliente_nombre: 'Ana', cliente_empresa: 'ACME', cliente_email: 'PID-1', cliente_telefono: 'Proyecto X',
      cliente_final: null, fecha_ejecucion: '2026-12-01', fecha_implementacion: null, vms: null
    };
    const lineas = [normalizarLineaAdmin(LINEA_EDITOR, 0)];
    expect(versiones.sinCambios({ actual: COTIZACION, itemsActuales: [ITEM_BD], cabecera, lineas })).toBe(true);
    expect(versiones.sinCambios({ actual: COTIZACION, itemsActuales: [ITEM_BD], cabecera, lineas, estado: 'aprobada' })).toBe(false);
    expect(versiones.sinCambios({ actual: { ...COTIZACION, estado: 'pendiente' }, itemsActuales: [ITEM_BD], cabecera, lineas, estado: 'revision' })).toBe(true);
    expect(versiones.sinCambios({ actual: COTIZACION, itemsActuales: [], cabecera, lineas })).toBe(false);
  });

  test('listarVersiones descarta filas mayores que la vigente', () => {
    const lista = versiones.listarVersiones([{ version: 5 }, { version: 1 }], { version: 2, total: 10, usuario: 'u', created_at: 'x' });
    expect(lista.map((v) => v.version)).toEqual([2, 1]);
  });
});

describe('nombre del PDF', () => {
  test('buildPdfFilename usa la version real; por defecto (o invalida) v1', () => {
    const base = buildPdfBaseName('2026-11-02T12:00:00', 'Proyecto CCTV', 'ACME', 65430);
    expect(base).toBe('COT-65430_2026-11-02_Proyecto_CCTV');
    expect(buildPdfFilename('2026-11-02T12:00:00', 'Proyecto CCTV', 'ACME', 65430)).toBe(`${base}_v1`);
    expect(buildPdfFilename('2026-11-02T12:00:00', 'Proyecto CCTV', 'ACME', 65430, 3)).toBe(`${base}_v3`);
    expect(buildPdfFilename('2026-11-02T12:00:00', 'Proyecto CCTV', 'ACME', 65430, 'x')).toBe(`${base}_v1`);
    expect(buildPdfFilename('2026-11-02T12:00:00', 'Proyecto CCTV', 'ACME', 65430, 0)).toBe(`${base}_v1`);
  });

  test('POST /api/cotizaciones/pdf con version: el archivo sale como _vN', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const body = {
      numero: 65430, version: 4, created_at: '2026-11-02T12:00:00', cliente: { nombre: 'Ana', empresa: 'ACME', telefono: 'Proyecto X' },
      items: [{ marca: 'QNAP', cantidad: 1, sku: 'NW1', descripcion: 'NAS', precio_unitario: 10 }]
    };
    const res = await conAuth(request(app).post('/api/cotizaciones/pdf'), CLIENTE).send(body);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="COT-65430_2026-11-02_Proyecto_X_v4.pdf"');
    const sinVersion = await conAuth(request(app).post('/api/cotizaciones/pdf'), CLIENTE).send({ ...body, version: undefined });
    expect(sinVersion.headers['content-disposition']).toMatch(/_v1\.pdf"$/);
  });
});

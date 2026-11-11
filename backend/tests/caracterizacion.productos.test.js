/**
 * Tests de caracterizacion: productos (permisos y exposicion de costos) y
 * POST /api/precios/calcular.
 *
 * Fijan el comportamiento actual de legacyRoutes.js. Lo que parece un bug se
 * fija igual y se marca con "SOSPECHOSO" en el nombre del test.
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
// Sin Google Sheets: el stock real no se lee (costo calculado) y escribir en la hoja falla.
process.env.GOOGLE_SHEETS_ID = '';
process.env.GOOGLE_SHEETS_URL = '';
// Usuario de servicio autorizado a /api/precios/calcular aunque no sea admin (se lee al cargar el modulo).
process.env.PRECIOS_USUARIOS = ' Svc_MCP ,otro';

const app = require('../src/app');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const ADMIN = { id: 1, usuario: 'admin', role: 'admin' };
const CLIENTE = { id: 2, usuario: 'cliente', role: 'client' };
const STOCK_ADMIN = { id: 3, usuario: 'nsteck', role: 'cot_stock_admin' };

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
const rolDb = (role) => [incluye('SELECT role FROM usuarios WHERE id = $1'), { rows: [{ role }] }];

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
});

const PRODUCTO_QNAP_DB = {
  id: 3, origen: 'QNAP', marca: 'QNAP', sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS 4 bahias', tiempo_entrega: '8 semanas',
  precio_disty: '1000.00', gp: '0.2000', activo: true,
  rebate_partner_autorizado: 0, rebate_partner_silver: 0, rebate_partner_gold: 0, rebate_partner_multiregional: 0
};
const PRODUCTO_AXIS_DB = {
  id: 8, origen: 'AXIS', marca: 'AXIS', sku: 'AX1', mpn: 'P1', descripcion: 'Camara', tiempo_entrega: '2 semanas',
  precio_disty: '500.00', gp: '0.1500', activo: true,
  rebate_partner_autorizado: 10, rebate_partner_silver: 15, rebate_partner_gold: 20, rebate_partner_multiregional: 25
};

describe('GET /api/productos', () => {
  const catalogoDb = (calls = {}, usuarioRow = { gp: 0.15, gp_qnap: null, gp_axis: null, partner_category: 'Partner Gold' }) => dbRouter([
    ...sesionActiva(),
    [incluye('SELECT * FROM productos'), (sql, p) => { calls.sql = sql; calls.params = p; return { rows: [PRODUCTO_QNAP_DB, PRODUCTO_AXIS_DB] }; }],
    [incluye('COUNT(*)::int AS total FROM productos'), { rows: [{ total: 120 }] }],
    [incluye('SELECT gp, gp_qnap, gp_axis, partner_category FROM usuarios'), { rows: [usuarioRow] }]
  ]);

  test('cliente: solo recibe campos publicos y precio_cliente; NUNCA precio_disty, gp ni rebates', async () => {
    mockQuery.mockImplementation(catalogoDb());
    const res = await conAuth(request(app).get('/api/productos'), CLIENTE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const p of res.body) {
      expect(Object.keys(p).sort()).toEqual(['descripcion', 'id', 'marca', 'mpn', 'origen', 'precio_cliente', 'sku', 'tiempo_entrega']);
    }
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/precio_disty|"gp"|rebate|costo|activo/);
  });

  test('cliente: precio_cliente se calcula con el gp del usuario (QNAP 15% => 1402.25) y el rebate de su nivel (AXIS Gold)', async () => {
    mockQuery.mockImplementation(catalogoDb());
    const res = await conAuth(request(app).get('/api/productos'), CLIENTE);

    // QNAP: 1000*1.011/0.95*1.12 = 1191.9158 ; /0.85 = 1402.25
    expect(res.body[0].precio_cliente).toBe(1402.25);
    // AXIS gold: (500*1.015/0.97*1.12 - 20) / 0.85 = 665.86
    expect(res.body[1].precio_cliente).toBe(665.86);
  });

  test('cliente sin fila de usuario usa gp 15% y nivel "Partner Autorizado" por defecto', async () => {
    mockQuery.mockImplementation(dbRouter([
      ...sesionActiva(),
      [incluye('SELECT * FROM productos'), { rows: [PRODUCTO_AXIS_DB] }],
      [incluye('FROM usuarios'), { rows: [] }]
    ]));
    const res = await conAuth(request(app).get('/api/productos'), CLIENTE);
    // (585.9794 - 10) / 0.85 = 677.62
    expect(res.body[0].precio_cliente).toBe(677.62);
  });

  test('admin: recibe las filas completas (precio_disty y gp) mas costo_chile_real', async () => {
    mockQuery.mockImplementation(catalogoDb());
    const res = await conAuth(request(app).get('/api/productos'), ADMIN);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 3, precio_disty: '1000.00', gp: '0.2000' });
    expect(res.body[0]).toHaveProperty('costo_chile_real');
    expect(res.body[0].costo_chile_real).toBeNull();
    expect(res.body[0].precio_cliente).toBeUndefined();
  });

  test('cot_stock_admin: tambien recibe precio_disty y gp (se trata como admin para el catalogo)', async () => {
    mockQuery.mockImplementation(catalogoDb());
    const res = await conAuth(request(app).get('/api/productos'), STOCK_ADMIN);

    expect(res.status).toBe(200);
    expect(res.body[0].precio_disty).toBe('1000.00');
    expect(res.body[0].gp).toBe('0.2000');
  });

  test('por defecto solo productos activos y ordenados por id desc', async () => {
    const calls = {};
    mockQuery.mockImplementation(catalogoDb(calls));
    await conAuth(request(app).get('/api/productos'), CLIENTE);
    expect(calls.sql).toContain('WHERE activo = true');
    expect(calls.sql).toContain('ORDER BY id DESC');
    expect(calls.params).toEqual([]);
  });

  test('SOSPECHOSO: con ?origen= se pierde el filtro activo = true (un cliente recibe tambien productos dados de baja)', async () => {
    const calls = {};
    mockQuery.mockImplementation(catalogoDb(calls));
    const res = await conAuth(request(app).get('/api/productos?origen=QNAP'), CLIENTE);
    expect(res.status).toBe(200);
    expect(calls.sql).toContain('WHERE origen = $1');
    expect(calls.sql).not.toContain('activo = true');
    expect(calls.params).toEqual(['QNAP']);
  });

  test('admin con ?page: respuesta paginada { data, meta } (pageSize maximo 200)', async () => {
    const calls = {};
    mockQuery.mockImplementation(catalogoDb(calls));
    const res = await conAuth(request(app).get('/api/productos?page=2&pageSize=500'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 200, total: 120, totalPages: 1, hasNext: false });
    expect(res.body.data).toHaveLength(2);
    expect(calls.params).toEqual([200, 200]);
  });

  test('cliente con ?page: la paginacion se ignora y recibe un arreglo plano', async () => {
    mockQuery.mockImplementation(catalogoDb());
    const res = await conAuth(request(app).get('/api/productos?page=2&pageSize=1'), CLIENTE);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  test('sin token: 401', async () => {
    const res = await request(app).get('/api/productos');
    expect(res.status).toBe(401);
  });

  test('error de BD: 500 generico', async () => {
    mockQuery.mockImplementation(dbRouter([...sesionActiva(), [incluye('SELECT * FROM productos'), () => { throw new Error('boom'); }]]));
    const res = await conAuth(request(app).get('/api/productos'), CLIENTE);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
  });
});

describe('permisos de escritura sobre productos', () => {
  const cuerpoValido = { descripcion: 'NAS nuevo', precio_disty: 100, marca: 'QNAP', sku: 'X', mpn: 'Y' };
  const poolRol = (role) => mockQuery.mockImplementation(dbRouter([...sesionActiva(), rolDb(role)]));

  test.each([
    ['post', '/api/productos'],
    ['put', '/api/productos/3'],
    ['delete', '/api/productos/3'],
    ['post', '/api/productos/bulk'],
    ['post', '/api/productos/sync']
  ])('cliente: %s %s => 403 sin abrir transaccion', async (metodo, ruta) => {
    poolRol('client');
    const res = await conAuth(request(app)[metodo](ruta), CLIENTE).send(cuerpoValido);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Permiso denegado' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('sin token: 401', async () => {
    const res = await request(app).post('/api/productos').send(cuerpoValido);
    expect(res.status).toBe(401);
  });

  test.each(['admin', 'cot_stock_admin'])('%s pasa el control de permisos (la validacion responde 400 con payload invalido)', async (role) => {
    poolRol(role);
    const res = await conAuth(request(app).post('/api/productos'), { id: 9, usuario: 'x', role }).send({ precio_disty: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Payload invalido');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('validacion: descripcion vacia, precio_disty no numerico o gp no numerico => 400', async () => {
    poolRol('admin');
    for (const body of [
      { descripcion: '   ', precio_disty: 1 },
      { descripcion: 'ok', precio_disty: 'abc' },
      { descripcion: 'ok', precio_disty: 1, gp: 'x' },
      { descripcion: 'x'.repeat(501), precio_disty: 1 }
    ]) {
      const res = await conAuth(request(app).post('/api/productos'), ADMIN).send(body);
      expect(res.status).toBe(400);
    }
  });

  test('bulk: lista vacia o sin descripcion => 400', async () => {
    poolRol('admin');
    expect((await conAuth(request(app).post('/api/productos/bulk'), ADMIN).send({ productos: [] })).status).toBe(400);
    expect((await conAuth(request(app).post('/api/productos/bulk'), ADMIN).send({ productos: [{ precio_disty: 1 }] })).status).toBe(400);
  });

  test('crear (cot_stock_admin): inserta en BD y despues escribe en la hoja; si la hoja no esta configurada => 500 con ROLLBACK (el alta queda atada a Google Sheets)', async () => {
    poolRol('cot_stock_admin');
    const { llamadas, client } = transaccion((sql) => (sql.includes('INSERT INTO productos') ? { rows: [{ id: 50, origen: 'QNAP' }] } : { rows: [] }));

    const res = await conAuth(request(app).post('/api/productos'), STOCK_ADMIN).send(cuerpoValido);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
    const insert = llamadas.find((l) => l.sql.includes('INSERT INTO productos'));
    expect(insert.params[0]).toBe('QNAP'); // origen por defecto
    expect(insert.params[5]).toBe(100);
    expect(insert.params[6]).toBe(0.15); // gp por defecto
    expect(insert.params[11]).toBe('ETA por confirmar');
    const sqls = llamadas.map((l) => l.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('editar un producto inexistente: 404 con ROLLBACK (antes de tocar la hoja)', async () => {
    poolRol('admin');
    const { llamadas } = transaccion(() => ({ rows: [] }));
    const res = await conAuth(request(app).put('/api/productos/999'), ADMIN).send(cuerpoValido);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Producto no encontrado' });
    expect(llamadas.map((l) => l.sql)).toContain('ROLLBACK');
  });

  test('eliminar un producto inexistente: 404 con ROLLBACK', async () => {
    poolRol('cot_stock_admin');
    const { llamadas } = transaccion(() => ({ rows: [] }));
    const res = await conAuth(request(app).delete('/api/productos/999'), STOCK_ADMIN);
    expect(res.status).toBe(404);
    expect(llamadas.map((l) => l.sql)).toContain('ROLLBACK');
  });

  test('eliminar un producto existente es baja logica (activo = false) y, sin hoja configurada, se revierte con 500', async () => {
    poolRol('admin');
    const { llamadas } = transaccion((sql) => (sql.includes('SELECT * FROM productos') ? { rows: [PRODUCTO_QNAP_DB] } : { rows: [] }));
    const res = await conAuth(request(app).delete('/api/productos/3'), ADMIN);
    expect(res.status).toBe(500);
    expect(llamadas.some((l) => l.sql.includes('UPDATE productos SET activo = false'))).toBe(true);
    expect(llamadas.map((l) => l.sql)).toContain('ROLLBACK');
  });
});

describe('POST /api/precios/calcular', () => {
  const calcular = (user, body) => conAuth(request(app).post('/api/precios/calcular'), user).send(body);
  const preciosDb = (productos, usuarioRow = {}) => mockQuery.mockImplementation(dbRouter([
    ...sesionActiva(),
    [incluye('SELECT gp, gp_qnap, gp_axis FROM usuarios'), { rows: [usuarioRow] }],
    [incluye('SELECT * FROM productos WHERE id = ANY'), { rows: productos }]
  ]));

  test('usuario sin permiso (cliente): 403 antes de validar el cuerpo', async () => {
    preciosDb([]);
    const res = await calcular(CLIENTE, { items: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/^Sin permiso/);
  });

  test('items vacio, ausente o no arreglo: 400 "items es obligatorio"', async () => {
    preciosDb([]);
    for (const body of [{ items: [] }, {}, { items: 'x' }]) {
      const res = await calcular(ADMIN, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'items es obligatorio' });
    }
  });

  test('partner_category desconocido: 400', async () => {
    preciosDb([]);
    const res = await calcular(ADMIN, { items: [{ producto_id: 3 }], partner_category: 'Diamante' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^partner_category invalido/);
  });

  test('admin QNAP: calcula costo, precio y margen con gp por defecto 15%', async () => {
    preciosDb([PRODUCTO_QNAP_DB]);
    const res = await calcular(ADMIN, { items: [{ producto_id: 3, cantidad: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.partner_category).toBe('todos');
    expect(res.body.gp_por_defecto).toEqual({ AXIS: 0.15, QNAP: 0.15 });
    expect(res.body.costo_chile_disponible).toBe(false);
    expect(res.body.no_encontrados).toEqual([]);
    expect(res.body.lineas).toHaveLength(1);
    expect(res.body.lineas[0]).toMatchObject({
      producto_id: 3,
      origen: 'QNAP',
      cantidad: 2,
      gp: 0.15,
      costo_base_fuente: 'calculado_desde_disty',
      costo_unitario: 1191.92,
      precio_unitario: 1402.25,
      margen_unitario: 210.33,
      precio_total: 2804.5,
      margen_total: 420.66
    });
  });

  test('gp del cuerpo (en porcentaje) y gp por linea tienen prioridad sobre el del usuario', async () => {
    preciosDb([PRODUCTO_QNAP_DB], { gp_qnap: 0.3 });
    const res = await calcular(ADMIN, { gp_qnap: 20, items: [{ producto_id: 3 }, { producto_id: 3, gp: 0.5 }] });

    expect(res.body.gp_por_defecto.QNAP).toBe(0.2);
    expect(res.body.lineas[0].gp).toBe(0.2);
    expect(res.body.lineas[0].precio_unitario).toBe(1489.89);
    expect(res.body.lineas[1].gp).toBe(0.5);
  });

  test('sin gp en el cuerpo se usa el del usuario (gp_qnap) y, si no, 0.15', async () => {
    preciosDb([PRODUCTO_QNAP_DB], { gp_qnap: 0.3 });
    const res = await calcular(ADMIN, { items: [{ producto_id: 3 }] });
    expect(res.body.gp_por_defecto.QNAP).toBe(0.3);
  });

  test('AXIS sin partner_category: devuelve los 4 niveles con su rebate', async () => {
    preciosDb([PRODUCTO_AXIS_DB]);
    const res = await calcular(ADMIN, { items: [{ producto_id: 8 }] });

    expect(res.status).toBe(200);
    const niveles = res.body.lineas[0].niveles;
    expect(niveles.map((n) => n.nivel)).toEqual(['Partner Autorizado', 'Partner Silver', 'Partner Gold', 'Partner Multiregional']);
    expect(niveles.map((n) => n.rebate)).toEqual([10, 15, 20, 25]);
    expect(niveles[2].precio_unitario).toBe(665.86);
    expect(res.body.lineas[0].precio_unitario).toBeUndefined();
  });

  test('AXIS con partner_category "gold": solo ese nivel (acepta alias en minusculas)', async () => {
    preciosDb([PRODUCTO_AXIS_DB]);
    const res = await calcular(ADMIN, { items: [{ producto_id: 8 }], partner_category: 'gold' });
    expect(res.body.partner_category).toBe('Partner Gold');
    expect(res.body.lineas[0].niveles).toHaveLength(1);
    expect(res.body.lineas[0].niveles[0].nivel).toBe('Partner Gold');
  });

  test('productos no encontrados se listan aparte; cantidad invalida se fuerza a minimo 1', async () => {
    preciosDb([PRODUCTO_QNAP_DB]);
    const res = await calcular(ADMIN, { items: [{ producto_id: 3, cantidad: -5 }, { producto_id: 777 }, {}] });
    expect(res.body.lineas).toHaveLength(1);
    expect(res.body.lineas[0].cantidad).toBe(1);
    expect(res.body.no_encontrados).toEqual([777, null]);
  });

  test('solo se procesan los primeros 200 items', async () => {
    preciosDb([PRODUCTO_QNAP_DB]);
    const items = Array.from({ length: 250 }, () => ({ producto_id: 3 }));
    const res = await calcular(ADMIN, { items });
    expect(res.body.lineas).toHaveLength(200);
  });

  test('cot_stock_admin tambien puede calcular (canManageCotizadorStock)', async () => {
    preciosDb([PRODUCTO_QNAP_DB]);
    const res = await calcular(STOCK_ADMIN, { items: [{ producto_id: 3 }] });
    expect(res.status).toBe(200);
  });

  test('usuario de servicio listado en PRECIOS_USUARIOS (sin importar mayusculas/espacios) tambien puede', async () => {
    preciosDb([PRODUCTO_QNAP_DB]);
    const res = await calcular({ id: 20, usuario: 'SVC_mcp', role: 'client' }, { items: [{ producto_id: 3 }] });
    expect(res.status).toBe(200);
  });

  test('sin token: 401', async () => {
    const res = await request(app).post('/api/precios/calcular').send({ items: [{ producto_id: 3 }] });
    expect(res.status).toBe(401);
  });
});

/**
 * Tests de caracterizacion: cotizaciones (crear, listar, obtener, estado, borrar)
 * y control de dueno vs admin.
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
// Sin Google Sheets: leerCostosChile cae al costo calculado (null) sin tocar la red.
process.env.GOOGLE_SHEETS_ID = '';
process.env.GOOGLE_SHEETS_URL = '';

const app = require('../src/app');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const ADMIN = { id: 1, usuario: 'admin', role: 'admin' };
const CLIENTE = { id: 2, usuario: 'cliente', role: 'client' };
const OTRO_CLIENTE = { id: 4, usuario: 'otro', role: 'client' };
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

// Pool para rutas con requireOwnerOrAdmin: rol del solicitante + duenos de cotizaciones.
const poolConDueno = ({ role, duenos = {}, extra = [] }) => dbRouter([
  ...sesionActiva(),
  [incluye('SELECT role, empresa, intcomex_profile FROM usuarios WHERE id = $1'), { rows: [{ role, empresa: '', intcomex_profile: null }] }],
  [incluye('SELECT usuario_id FROM cotizaciones WHERE id = $1'), (sql, p) => {
    const dueno = duenos[String(p[0])];
    return { rows: dueno === undefined ? [] : [{ usuario_id: dueno }] };
  }],
  ...extra
]);

const conAuth = (req, user) => req.set('Authorization', `Bearer ${makeToken(user)}`).set('x-session-id', 'sess-1');

// Cliente transaccional (pool.connect) que registra todo lo ejecutado.
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

const PRODUCTO_QNAP = { id: 3, origen: 'QNAP', marca: 'QNAP', sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS', precio_disty: 1000, tiempo_entrega: '8 semanas' };
const PRODUCTO_AXIS = {
  id: 8, origen: 'AXIS', marca: 'AXIS', sku: 'AX1', mpn: 'P1', descripcion: 'Camara', precio_disty: 500, tiempo_entrega: '2 semanas',
  rebate_partner_autorizado: 10, rebate_partner_silver: 15, rebate_partner_gold: 20, rebate_partner_multiregional: 25
};
const CLIENTE_BODY = { nombre: 'Ana', empresa: 'ACME', email: 'ana@acme.cl', telefono: '123' };

// Orden de columnas de cotizacion_items en el INSERT multi-fila (insertarItems).
const COL = { producto_id: 1, origen: 6, precio_disty: 7, rebate_partner: 8, partner_category: 10, costo_unitario: 11, gp: 12, cantidad: 13, precio_unitario: 14, precio_total: 15 };

const handlerCrear = ({ usuarioRow = { gp: 0.15, gp_qnap: null, gp_axis: null, partner_category: null }, productos = [PRODUCTO_QNAP] } = {}) => (sql) => {
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (sql.includes('FROM usuarios')) return { rows: [usuarioRow] };
  if (sql.includes('FROM productos')) return { rows: productos };
  if (sql.includes('INSERT INTO cotizaciones')) return { rows: [{ id: 501, estado: 'revision' }] };
  if (sql.includes('INSERT INTO cotizacion_items')) return { rows: [] };
  throw new Error(`SQL sin manejar en transaccion: ${sql}`);
};
const insertCotizacion = (llamadas) => llamadas.find((l) => l.sql.includes('INSERT INTO cotizaciones'));
const insertItems = (llamadas) => llamadas.find((l) => l.sql.includes('INSERT INTO cotizacion_items'));

describe('POST /api/cotizaciones', () => {
  test('cliente: el backend ignora precios/total enviados y recalcula desde el catalogo (QNAP, gp 15%)', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas, client } = transaccion(handlerCrear());

    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({
      cliente: CLIENTE_BODY,
      total: 1,
      items: [{ producto_id: 3, cantidad: 2, precio_unitario: 1, precio_total: 2, precio_disty: 1 }]
    });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Cotizacion guardada');
    expect(res.body.cotizacion.id).toBe(501);

    // costo = 1000 * 1.011 / 0.95 * 1.12 = 1191.9158 ; precio = costo / 0.85 = 1402.25
    const cab = insertCotizacion(llamadas).params;
    expect(cab[0]).toBe('Ana');
    // SOSPECHOSO (centavo): la cabecera suma unitarios SIN redondear (2804.5078 -> 2804.51)
    // mientras la linea guarda 1402.25 * 2 = 2804.5. Cabecera y suma de lineas difieren 1 centavo.
    expect(cab[4]).toBe(2804.51); // total recalculado, no el "1" enviado
    expect(cab[9]).toBe(2); // usuario_id del token
    expect(cab[10]).toBe('cliente');
    expect(cab[11]).toBe('revision'); // estado inicial

    const it = insertItems(llamadas).params;
    expect(it[COL.producto_id]).toBe(3);
    expect(it[COL.precio_disty]).toBe(1000);
    expect(it[COL.precio_unitario]).toBe(1402.25);
    expect(it[COL.cantidad]).toBe(2);
    expect(it[COL.precio_total]).toBe(2804.5);
    expect(it[COL.costo_unitario]).toBe(1191.92);
    expect(it[COL.gp]).toBeCloseTo(0.15, 3);
    expect(llamadas.map((l) => l.sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('cliente con gp_qnap propio usa ese gp; con gp > 1 lo interpreta como porcentaje', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear({ usuarioRow: { gp: 0.15, gp_qnap: 20, gp_axis: null, partner_category: null } }));

    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({
      cliente: CLIENTE_BODY,
      items: [{ producto_id: 3, cantidad: 1 }]
    });

    expect(res.status).toBe(201);
    // 1191.9158 / 0.8 = 1489.89
    expect(insertItems(llamadas).params[COL.precio_unitario]).toBe(1489.89);
    expect(insertCotizacion(llamadas).params[4]).toBe(1489.89);
  });

  test('cliente con producto AXIS: aplica el rebate del nivel de partner del usuario y guarda partner_category', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear({
      usuarioRow: { gp: 0.15, gp_qnap: null, gp_axis: 0.2, partner_category: 'Partner Gold' },
      productos: [PRODUCTO_AXIS]
    }));

    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({
      cliente: CLIENTE_BODY,
      items: [{ producto_id: 8, cantidad: 1 }]
    });

    expect(res.status).toBe(201);
    // costo = 500 * 1.015 / 0.97 * 1.12 = 585.98 ; menos rebate gold 20 = 565.98 ; / 0.8 = 707.47
    const it = insertItems(llamadas).params;
    expect(it[COL.origen]).toBe('AXIS');
    expect(it[COL.rebate_partner]).toBe(20);
    expect(it[COL.partner_category]).toBe('Partner Gold');
    expect(it[COL.precio_unitario]).toBe(707.47);
    expect(insertCotizacion(llamadas).params[4]).toBe(707.47);
  });

  test('cliente: acepta "cant" como alias de cantidad', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear());
    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({
      cliente: CLIENTE_BODY,
      items: [{ producto_id: '3', cant: '3' }]
    });
    expect(res.status).toBe(201);
    expect(insertItems(llamadas).params[COL.cantidad]).toBe(3);
  });

  test('cliente: producto inexistente => 400, ROLLBACK y nada se inserta', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas, client } = transaccion(handlerCrear({ productos: [] }));

    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({
      cliente: CLIENTE_BODY,
      items: [{ producto_id: 999, cantidad: 1 }]
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Producto no encontrado: 999');
    expect(llamadas.map((l) => l.sql)).toContain('ROLLBACK');
    expect(insertCotizacion(llamadas)).toBeUndefined();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('cliente: item sin producto_id numerico => 400 "producto_id invalido"', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear());

    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({
      cliente: CLIENTE_BODY,
      items: [{ cantidad: 1 }]
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('producto_id invalido');
    expect(llamadas.map((l) => l.sql)).toContain('ROLLBACK');
  });

  test('payload sin "cliente": 400 "Payload invalido" y ni se abre transaccion', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Payload invalido');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('sin token: 401', async () => {
    const res = await request(app).post('/api/cotizaciones').send({ cliente: CLIENTE_BODY });
    expect(res.status).toBe(401);
  });

  test('SOSPECHOSO: cliente con cantidad negativa => total NEGATIVO en la cabecera, mientras la linea se guarda con cantidad 1 y total positivo', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear());

    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({
      cliente: CLIENTE_BODY,
      items: [{ producto_id: 3, cantidad: -2 }]
    });

    expect(res.status).toBe(201);
    expect(insertCotizacion(llamadas).params[4]).toBe(-2804.51);
    const it = insertItems(llamadas).params;
    expect(it[COL.cantidad]).toBe(1);
    expect(it[COL.precio_total]).toBe(1402.25);
  });

  test('cliente con items vacios: se guarda cotizacion con total 0 y sin lineas (201)', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear());

    const res = await conAuth(request(app).post('/api/cotizaciones'), CLIENTE).send({ cliente: CLIENTE_BODY, items: [] });

    expect(res.status).toBe(201);
    expect(insertCotizacion(llamadas).params[4]).toBe(0);
    expect(insertItems(llamadas)).toBeUndefined();
  });

  test('admin: NO se recalcula; se guardan total y lineas tal como vienen (las lineas se normalizan)', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear());

    const res = await conAuth(request(app).post('/api/cotizaciones'), ADMIN).send({
      cliente: CLIENTE_BODY,
      total: 12345,
      items: [{ producto_id: 3, marca: 'QNAP', sku: 'NW1', origen: 'QNAP', cantidad: 2, precio_unitario: 950, costo_unitario: 800, precio_disty: 700 }]
    });

    expect(res.status).toBe(201);
    expect(insertCotizacion(llamadas).params[4]).toBe(12345);
    expect(llamadas.some((l) => l.sql.includes('FROM productos') || l.sql.includes('FROM usuarios'))).toBe(false);
    const it = insertItems(llamadas).params;
    expect(it[COL.precio_unitario]).toBe(950);
    expect(it[COL.precio_total]).toBe(1900);
    expect(it[COL.costo_unitario]).toBe(800);
  });

  test('SOSPECHOSO: cot_stock_admin se trata como admin al crear (confiamos en los precios que manda)', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas } = transaccion(handlerCrear());

    const res = await conAuth(request(app).post('/api/cotizaciones'), STOCK_ADMIN).send({
      cliente: CLIENTE_BODY,
      total: 5,
      items: [{ producto_id: 3, cantidad: 1, precio_unitario: 5 }]
    });

    expect(res.status).toBe(201);
    expect(insertCotizacion(llamadas).params[4]).toBe(5);
    expect(insertItems(llamadas).params[COL.precio_unitario]).toBe(5);
  });

  test('error de BD al insertar: 500 generico, ROLLBACK y se libera la conexion', async () => {
    mockQuery.mockImplementation(dbRouter(sesionActiva()));
    const { llamadas, client } = transaccion((sql) => {
      if (sql.includes('INSERT INTO cotizaciones')) throw new Error('boom');
      return handlerCrear()(sql);
    });

    const res = await conAuth(request(app).post('/api/cotizaciones'), ADMIN).send({ cliente: CLIENTE_BODY, total: 1, items: [] });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
    expect(llamadas.map((l) => l.sql)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/cotizaciones (listar)', () => {
  const itemConCosto = { id: 5, cotizacion_id: 77, producto_id: 3, marca: 'QNAP', sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS', cantidad: 2, precio_unitario: 1000, precio_total: 2000, tiempo_entrega: '8 sem', precio_disty: 700, gp: 0.2, costo_unitario: 800, rebate_partner: 10 };

  const listaDb = (calls) => dbRouter([
    ...sesionActiva(),
    [incluye('FROM cotizaciones c', 'LEFT JOIN usuarios u'), (sql, p) => { calls.lista = { sql, p }; return { rows: [{ id: 77, cliente_nombre: 'Ana' }] }; }],
    [incluye('FROM cotizacion_items'), (sql) => { calls.items = sql; return { rows: [itemConCosto] }; }],
    [incluye('COUNT(*)::int AS total'), (sql, p) => { calls.count = { sql, p }; return { rows: [{ total: 120 }] }; }]
  ]);

  test('cliente: filtra por su usuario_id', async () => {
    const calls = {};
    mockQuery.mockImplementation(listaDb(calls));
    const res = await conAuth(request(app).get('/api/cotizaciones'), CLIENTE);
    expect(res.status).toBe(200);
    expect(calls.lista.sql).toContain('WHERE c.usuario_id = $1');
    expect(calls.lista.p).toEqual([2]);
    expect(res.body).toEqual([{ id: 77, cliente_nombre: 'Ana' }]);
  });

  test('admin: sin filtro de dueno', async () => {
    const calls = {};
    mockQuery.mockImplementation(listaDb(calls));
    const res = await conAuth(request(app).get('/api/cotizaciones'), ADMIN);
    expect(res.status).toBe(200);
    expect(calls.lista.sql).not.toContain('usuario_id = $1');
    expect(calls.lista.p).toEqual([]);
  });

  test('SOSPECHOSO: cot_stock_admin lista solo las suyas (aqui "admin" es estrictamente role === admin, a diferencia de productos)', async () => {
    const calls = {};
    mockQuery.mockImplementation(listaDb(calls));
    const res = await conAuth(request(app).get('/api/cotizaciones'), STOCK_ADMIN);
    expect(res.status).toBe(200);
    expect(calls.lista.p).toEqual([3]);
  });

  test('includeItems=1: admin recibe costo y margen; cliente solo columnas publicas', async () => {
    const callsAdmin = {};
    mockQuery.mockImplementation(listaDb(callsAdmin));
    const admin = await conAuth(request(app).get('/api/cotizaciones?includeItems=1'), ADMIN);
    expect(admin.body[0].items[0]).toMatchObject({ costo_unitario: 800, precio_disty: 700, margen_unitario: 200 });
    expect(callsAdmin.items).toContain('SELECT *');

    const callsCliente = {};
    mockQuery.mockReset();
    mockQuery.mockImplementation(listaDb(callsCliente));
    const cliente = await conAuth(request(app).get('/api/cotizaciones?includeItems=1'), CLIENTE);
    expect(callsCliente.items).not.toContain('SELECT *');
    expect(callsCliente.items).not.toContain('costo_unitario');
    expect(JSON.stringify(cliente.body)).not.toMatch(/costo|margen|rebate|precio_disty|"gp"/);
    expect(cliente.body[0].items[0].precio_unitario).toBe(1000);
  });

  test('paginacion: responde { data, meta }, acota pageSize a 200 y corrige page invalida a 1', async () => {
    const calls = {};
    mockQuery.mockImplementation(listaDb(calls));
    const res = await conAuth(request(app).get('/api/cotizaciones?page=-4&pageSize=999'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 200, total: 120, totalPages: 1, hasNext: false });
    expect(res.body.data).toHaveLength(1);
    expect(calls.lista.p).toEqual([200, 0]);
  });

  test('paginacion: meta con paginas siguientes', async () => {
    const calls = {};
    mockQuery.mockImplementation(listaDb(calls));
    const res = await conAuth(request(app).get('/api/cotizaciones?page=2&pageSize=50'), ADMIN);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 50, total: 120, totalPages: 3, hasNext: true });
    expect(calls.lista.p).toEqual([50, 50]);
  });

  test('sin token: 401', async () => {
    const res = await request(app).get('/api/cotizaciones');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cotizaciones/:id', () => {
  const items = [
    { id: 1, cotizacion_id: 77, producto_id: 3, cantidad: 2, precio_unitario: 1000, precio_total: 2000, costo_unitario: 800, precio_disty: 700 },
    { id: 2, cotizacion_id: 77, producto_id: 4, cantidad: 1, precio_unitario: 500, precio_total: 500, costo_unitario: null }
  ];
  const detalleDb = (calls = {}) => dbRouter([
    ...sesionActiva(),
    [incluye('FROM cotizaciones c', 'c.id = $1 AND c.usuario_id = $2'), (sql, p) => { calls.filtrada = p; return { rows: p[1] === 2 ? [{ id: 77, usuario_id: 2 }] : [] }; }],
    [incluye('FROM cotizaciones c', 'WHERE c.id = $1'), (sql, p) => { calls.completa = p; return { rows: p[0] === '77' ? [{ id: 77, usuario_id: 2 }] : [] }; }],
    [incluye('FROM cotizacion_items'), { rows: items }]
  ]);

  test('admin: ve costos, margen por linea y resumen con costo/margen (y lineas sin costo)', async () => {
    mockQuery.mockImplementation(detalleDb());
    const res = await conAuth(request(app).get('/api/cotizaciones/77'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ costo_unitario: 800, margen_unitario: 200, margen_total: 400, margen_pct: 20 });
    expect(res.body.items[1].margen_unitario).toBeNull();
    expect(res.body.resumen).toEqual({ venta: 2500, costo: 1600, margen: 400, margen_pct: 20, lineas_sin_costo: 1 });
  });

  test('cliente dueno: items sin costos y resumen solo con "venta"', async () => {
    mockQuery.mockImplementation(detalleDb());
    const res = await conAuth(request(app).get('/api/cotizaciones/77'), CLIENTE);
    expect(res.status).toBe(200);
    expect(res.body.resumen).toEqual({ venta: 2500 });
    expect(JSON.stringify(res.body.items)).not.toMatch(/costo|margen|precio_disty/);
  });

  test('cliente que NO es dueno: 404 (no 403) porque la consulta filtra por usuario_id', async () => {
    mockQuery.mockImplementation(detalleDb());
    const res = await conAuth(request(app).get('/api/cotizaciones/77'), OTRO_CLIENTE);
    expect(res.status).toBe(404);
  });

  test('admin con id inexistente: 404', async () => {
    mockQuery.mockImplementation(detalleDb());
    const res = await conAuth(request(app).get('/api/cotizaciones/999'), ADMIN);
    expect(res.status).toBe(404);
  });

  test('SOSPECHOSO: cot_stock_admin ve la cotizacion con la vista de cliente (sin costos) y solo si es suya', async () => {
    mockQuery.mockImplementation(detalleDb());
    const res = await conAuth(request(app).get('/api/cotizaciones/77'), STOCK_ADMIN);
    expect(res.status).toBe(404); // no es de id 3
  });
});

describe('PATCH /api/cotizaciones/:id/estado', () => {
  const patch = (id, body, user) => conAuth(request(app).patch(`/api/cotizaciones/${id}/estado`), user).send(body);
  const poolEstado = (role, duenos) => {
    const updates = [];
    mockQuery.mockImplementation(poolConDueno({
      role,
      duenos,
      extra: [[incluye('UPDATE cotizaciones SET estado = $1 WHERE id = $2 RETURNING *'), (sql, p) => {
        updates.push(p);
        return { rows: String(p[1]) === '404' ? [] : [{ id: Number(p[1]), estado: p[0] }] };
      }]]
    }));
    return updates;
  };

  test.each(['enviada', 'revision', 'rechazada', 'aprobada'])('admin: estado "%s" permitido y se guarda tal cual', async (estado) => {
    const updates = poolEstado('admin', { 77: 2 });
    const res = await patch(77, { estado }, ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe(estado);
    expect(updates).toEqual([[estado, '77']]);
  });

  test('"pendiente" es un alias: se guarda como "revision"', async () => {
    const updates = poolEstado('admin', { 77: 2 });
    const res = await patch(77, { estado: 'pendiente' }, ADMIN);
    expect(res.status).toBe(200);
    expect(updates).toEqual([['revision', '77']]);
  });

  test.each([['borrada'], ['APROBADA'], ['']])('estado "%s" rechazado con 400 "Estado invalido"', async (estado) => {
    const updates = poolEstado('admin', { 77: 2 });
    const res = await patch(77, { estado }, ADMIN);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Estado invalido' });
    expect(updates).toEqual([]);
  });

  test('sin estado en el cuerpo: 400', async () => {
    poolEstado('admin', { 77: 2 });
    const res = await patch(77, {}, ADMIN);
    expect(res.status).toBe(400);
  });

  test('cliente dueno puede cambiar el estado de su cotizacion', async () => {
    const updates = poolEstado('client', { 77: 2 });
    const res = await patch(77, { estado: 'enviada' }, CLIENTE);
    expect(res.status).toBe(200);
    expect(updates).toEqual([['enviada', '77']]);
  });

  test('SOSPECHOSO: el cliente dueno puede marcar su propia cotizacion como "aprobada"', async () => {
    const updates = poolEstado('client', { 77: 2 });
    const res = await patch(77, { estado: 'aprobada' }, CLIENTE);
    expect(res.status).toBe(200);
    expect(updates).toEqual([['aprobada', '77']]);
  });

  test('cliente que no es dueno: 403 "Permiso denegado" sin actualizar', async () => {
    const updates = poolEstado('client', { 77: 2 });
    const res = await patch(77, { estado: 'aprobada' }, OTRO_CLIENTE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Permiso denegado' });
    expect(updates).toEqual([]);
  });

  test('cot_stock_admin no es admin aqui: sobre cotizacion ajena recibe 403', async () => {
    const updates = poolEstado('cot_stock_admin', { 77: 2 });
    const res = await patch(77, { estado: 'aprobada' }, STOCK_ADMIN);
    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });

  test('cotizacion inexistente: no-admin recibe 404 (resolucion de dueno); admin recibe 404 por UPDATE vacio', async () => {
    poolEstado('client', {});
    const noAdmin = await patch(404, { estado: 'enviada' }, CLIENTE);
    expect(noAdmin.status).toBe(404);

    mockQuery.mockReset();
    poolEstado('admin', {});
    const admin = await patch(404, { estado: 'enviada' }, ADMIN);
    expect(admin.status).toBe(404);
  });
});

describe('DELETE /api/cotizaciones/:id', () => {
  const borrar = (id, user) => conAuth(request(app).delete(`/api/cotizaciones/${id}`), user);
  const prepararBorrado = (role, duenos, { existe = true } = {}) => {
    mockQuery.mockImplementation(poolConDueno({ role, duenos }));
    return transaccion((sql) => {
      if (sql.includes('DELETE FROM cotizaciones')) return { rows: existe ? [{ id: 77 }] : [] };
      return { rows: [] };
    });
  };

  test('dueno cliente: borra items y luego la cotizacion dentro de una transaccion', async () => {
    const { llamadas, client } = prepararBorrado('client', { 77: 2 });
    const res = await borrar(77, CLIENTE);
    expect(res.status).toBe(200);
    expect(res.body.cotizacion).toEqual({ id: 77 });
    expect(llamadas.map((l) => l.sql.split('\n')[0].trim())).toEqual([
      'BEGIN',
      'DELETE FROM cotizacion_items WHERE cotizacion_id = $1',
      'DELETE FROM cotizaciones WHERE id = $1 RETURNING *',
      'COMMIT'
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('admin puede borrar la cotizacion de otro usuario', async () => {
    prepararBorrado('admin', { 77: 2 });
    const res = await borrar(77, ADMIN);
    expect(res.status).toBe(200);
  });

  test('no-dueno: 403 y no se abre transaccion de borrado', async () => {
    const { llamadas } = prepararBorrado('client', { 77: 2 });
    const res = await borrar(77, OTRO_CLIENTE);
    expect(res.status).toBe(403);
    expect(llamadas).toEqual([]);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('cot_stock_admin sobre cotizacion ajena: 403', async () => {
    prepararBorrado('cot_stock_admin', { 77: 2 });
    const res = await borrar(77, STOCK_ADMIN);
    expect(res.status).toBe(403);
  });

  test('cotizacion inexistente: no-admin 404 en el chequeo de dueno', async () => {
    prepararBorrado('client', {});
    const res = await borrar(77, CLIENTE);
    expect(res.status).toBe(404);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('admin y cotizacion inexistente: 404 con ROLLBACK (tras haber borrado sus items)', async () => {
    const { llamadas } = prepararBorrado('admin', {}, { existe: false });
    const res = await borrar(999, ADMIN);
    expect(res.status).toBe(404);
    expect(llamadas.map((l) => l.sql)).toContain('ROLLBACK');
    expect(llamadas.map((l) => l.sql)).not.toContain('COMMIT');
  });

  test('sin token: 401', async () => {
    const res = await request(app).delete('/api/cotizaciones/77');
    expect(res.status).toBe(401);
  });
});

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockCompare = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    connect: mockConnect
  }))
}));

jest.mock('bcryptjs', () => ({
  compare: mockCompare,
  hash: jest.fn()
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

const app = require('../src/app');

const makeToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const activeSessionRow = {
  id: 10,
  revoked: false,
  last_seen: new Date(Date.now() + 60_000).toISOString(),
  device_id: 'device-1'
};

describe('API security and critical endpoints', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockCompare.mockReset();
  });

  test('POST /api/login returns token with valid credentials', async () => {
    mockCompare.mockResolvedValue(true);
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('FROM login_logs') && sql.includes('success = false')) {
        return Promise.resolve({ rows: [{ user_failures: 0, ip_failures: 0 }] });
      }
      if (sql.includes('SELECT * FROM usuarios WHERE usuario = $1')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              usuario: 'admin',
              password: 'hashed-password',
              nombre: 'Admin',
              role: 'admin',
              empresa: 'ACME'
            }
          ]
        });
      }
      if (sql.includes('DELETE FROM sesiones WHERE user_id = $1')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT id FROM sesiones WHERE user_id = $1 AND session_id = $2')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM sesiones') && sql.includes('revoked = false')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO sesiones')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO login_logs')) return Promise.resolve({ rows: [] });
      throw new Error(`Unhandled SQL in login test: ${sql}`);
    });

    const response = await request(app)
      .post('/api/login')
      .set('x-session-id', 'session-login-1')
      .set('x-device-id', 'device-1')
      .send({ usuario: 'admin', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(response.body.user?.usuario).toBe('admin');
    expect(response.body.session?.session_id).toBe('session-login-1');
  });

  test('POST /api/login survives a concurrent login with the same session id (unique violation)', async () => {
    mockCompare.mockResolvedValue(true);
    const sesionUpdates = [];
    mockQuery.mockImplementation((sql, params) => {
      if (sql.includes('FROM login_logs') && sql.includes('success = false')) {
        return Promise.resolve({ rows: [{ user_failures: 0, ip_failures: 0 }] });
      }
      if (sql.includes('SELECT * FROM usuarios WHERE usuario = $1')) {
        return Promise.resolve({
          rows: [{ id: 7, usuario: 'mcp_bot', password: 'hashed', nombre: 'Bot', role: 'client', empresa: '' }]
        });
      }
      if (sql.includes('DELETE FROM sesiones WHERE user_id = $1')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT id FROM sesiones WHERE user_id = $1 AND session_id = $2')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM sesiones') && sql.includes('revoked = false')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO sesiones')) {
        // La otra peticion concurrente inserto primero.
        const duplicate = new Error('duplicate key value violates unique constraint "sesiones_user_session_idx"');
        duplicate.code = '23505';
        return Promise.reject(duplicate);
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('WHERE user_id = $1 AND session_id = $2')) {
        sesionUpdates.push(params);
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('INSERT INTO login_logs')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE login_logs') || sql.includes('UPDATE sesiones SET geo_')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`Unhandled SQL in concurrent login test: ${sql}`);
    });

    const response = await request(app)
      .post('/api/login')
      .set('x-session-id', 'mcp-fixed-session')
      .set('x-device-id', 'mcp-server')
      .send({ usuario: 'mcp_bot', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(sesionUpdates).toHaveLength(1);
    expect(sesionUpdates[0].slice(0, 2)).toEqual([7, 'mcp-fixed-session']);
  });

  test('GET /api/usuarios returns 403 for non-admin', async () => {
    const token = makeToken({ id: 2, usuario: 'client', role: 'client' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT role FROM usuarios WHERE id = $1')) {
        return Promise.resolve({ rows: [{ role: 'client' }] });
      }
      throw new Error(`Unhandled SQL in non-admin permissions test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-user-1');

    expect(response.status).toBe(403);
  });

  test('GET /api/usuarios returns 403 for cotizador-stock admin', async () => {
    const token = makeToken({ id: 3, usuario: 'nsteck', role: 'cot_stock_admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT role FROM usuarios WHERE id = $1')) {
        return Promise.resolve({ rows: [{ role: 'cot_stock_admin' }] });
      }
      throw new Error(`Unhandled SQL in limited permissions test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-limited-1');

    expect(response.status).toBe(403);
  });

  test('GET /api/usuarios returns 200 for admin', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT role FROM usuarios WHERE id = $1')) {
        return Promise.resolve({ rows: [{ role: 'admin' }] });
      }
      if (sql.includes('SELECT id, usuario, nombre, empresa, logo_url, role')) {
        return Promise.resolve({ rows: [{ id: 1, usuario: 'admin', role: 'admin' }] });
      }
      throw new Error(`Unhandled SQL in admin permissions test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-1');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.usuario).toBe('admin');
  });

  test('GET /api/productos returns critical data for authenticated admin', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT * FROM productos')) {
        return Promise.resolve({ rows: [{ id: 10, sku: 'SKU-1', descripcion: 'Producto 1', activo: true }] });
      }
      throw new Error(`Unhandled SQL in productos test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/productos')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-2');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.sku).toBe('SKU-1');
  });

  test('GET /api/productos returns critical data for cotizador-stock admin', async () => {
    const token = makeToken({ id: 3, usuario: 'nsteck', role: 'cot_stock_admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT * FROM productos')) {
        return Promise.resolve({ rows: [{ id: 11, sku: 'SKU-LIMITED', descripcion: 'Producto limitado', activo: true }] });
      }
      throw new Error(`Unhandled SQL in limited productos test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/productos')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-limited-2');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.sku).toBe('SKU-LIMITED');
    expect(response.body[0]?.precio_cliente).toBeUndefined();
  });

  test('GET /api/cotizaciones returns critical data for authenticated admin', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) {
        return Promise.resolve({ rows: [activeSessionRow] });
      }
      if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM cotizaciones c') && sql.includes('LEFT JOIN usuarios u')) {
        return Promise.resolve({ rows: [{ id: 99, cliente_nombre: 'Cliente Demo', estado: 'revision' }] });
      }
      throw new Error(`Unhandled SQL in cotizaciones test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-3');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.cliente_nombre).toBe('Cliente Demo');
  });

  const sesionActiva = (sql) => {
    if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) return { rows: [activeSessionRow] };
    if (sql.includes('UPDATE sesiones') && sql.includes('SET last_seen = CURRENT_TIMESTAMP')) return { rows: [] };
    return null;
  };
  const itemConCosto = {
    id: 5, cotizacion_id: 77, producto_id: 3, marca: 'QNAP', sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS',
    cantidad: 2, precio_unitario: 1000, precio_total: 2000, tiempo_entrega: '8 semanas',
    precio_disty: 700, gp: 0.2, costo_unitario: 800, rebate_partner: 10, rebate_proyecto: 5
  };

  test('GET /api/cotizaciones/:id never sends cost or margin to a client, even if the DB row has them', async () => {
    const token = makeToken({ id: 2, usuario: 'client', role: 'client' });
    mockQuery.mockImplementation((sql) => {
      const sesion = sesionActiva(sql);
      if (sesion) return Promise.resolve(sesion);
      if (sql.includes('FROM cotizaciones c') && sql.includes('c.usuario_id = $2')) {
        return Promise.resolve({ rows: [{ id: 77, total: 2000, usuario_id: 2 }] });
      }
      if (sql.includes('FROM cotizacion_items')) return Promise.resolve({ rows: [itemConCosto] });
      throw new Error(`Unhandled SQL in client cotizacion test: ${sql}`);
    });

    const response = await request(app)
      .get('/api/cotizaciones/77')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-client-77');

    expect(response.status).toBe(200);
    const texto = JSON.stringify(response.body);
    expect(texto).not.toMatch(/costo|margen|rebate|precio_disty|"gp"/);
    expect(response.body.items[0].precio_unitario).toBe(1000);
  });

  const clienteTransaccion = (handler) => {
    const client = { query: jest.fn(handler), release: jest.fn() };
    mockConnect.mockResolvedValue(client);
    return client;
  };
  const adminPut = (sql) => {
    const sesion = sesionActiva(sql);
    if (sesion) return Promise.resolve(sesion);
    if (sql.includes('SELECT role FROM usuarios WHERE id = $1')) return Promise.resolve({ rows: [{ role: 'admin' }] });
    throw new Error(`Unhandled pool SQL in PUT test: ${sql}`);
  };
  const cuerpoEdicion = {
    expected_version: 3,
    nota: 'Cliente pidio 3 unidades',
    cliente: { nombre: 'Ana', empresa: 'ACME', email: 'PID-1', telefono: 'Proyecto X' },
    items: [{ producto_id: 3, marca: 'QNAP', sku: 'NW1', mpn: 'TS-1', descripcion: 'NAS', origen: 'QNAP', cantidad: 3, precio_unitario: 950, costo_unitario: 800, precio_disty: 700 }]
  };

  test('PUT /api/cotizaciones/:id rejects a stale version with 409 and writes nothing', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation(adminPut);
    const client = clienteTransaccion((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [{ id: 77, version: 4, total: 2000 }] });
      throw new Error(`Unexpected write in stale PUT: ${sql}`);
    });

    const response = await request(app)
      .put('/api/cotizaciones/77')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-put-1')
      .send(cuerpoEdicion);

    expect(response.status).toBe(409);
    expect(response.body.version_actual).toBe(4);
    expect(client.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
  });

  test('PUT /api/cotizaciones/:id snapshots the previous version and returns margins to the admin', async () => {
    const token = makeToken({ id: 1, usuario: 'admin', role: 'admin' });
    mockQuery.mockImplementation(adminPut);
    const escrituras = [];
    clienteTransaccion((sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 77, version: 3, total: 2000, cliente_nombre: 'Ana', estado: 'enviada' }] });
      }
      if (sql.includes('SELECT * FROM cotizacion_items')) {
        const yaReemplazado = escrituras.some((e) => e.sql.includes('INSERT INTO cotizacion_items'));
        return Promise.resolve({
          rows: yaReemplazado
            ? [{ ...itemConCosto, cantidad: 3, precio_unitario: 950, precio_total: 2850, costo_unitario: 800 }]
            : [itemConCosto]
        });
      }
      escrituras.push({ sql, params });
      if (sql.includes('UPDATE cotizaciones')) {
        return Promise.resolve({ rows: [{ id: 77, version: params[10], total: params[8], estado: 'enviada' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .put('/api/cotizaciones/77')
      .set('Authorization', `Bearer ${token}`)
      .set('x-session-id', 'session-admin-put-2')
      .send(cuerpoEdicion);

    expect(response.status).toBe(200);
    const snapshot = escrituras.find((e) => e.sql.includes('INSERT INTO cotizacion_versiones'));
    expect(snapshot.params[1]).toBe(3);
    expect(JSON.parse(snapshot.params[2]).items[0].cantidad).toBe(2);
    expect(snapshot.params[4]).toBe('Cliente pidio 3 unidades');
    expect(response.body.version).toBe(4);
    expect(response.body.total).toBe(2850);
    expect(response.body.items[0].margen_unitario).toBe(150);
    expect(response.body.resumen.margen).toBe(450);
  });
});

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockValuesGet = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, connect: jest.fn() }))
}));

jest.mock('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn() },
    sheets: jest.fn(() => ({ spreadsheets: { values: { get: mockValuesGet } } }))
  }
}));

process.env.JWT_SECRET = 'stock-oso-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GOOGLE_SHEETS_ID = 'sheet-de-prueba';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'bot@test.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
process.env.GOOGLE_API_RETRIES = '0';

const app = require('../src/app');

const token = jwt.sign({ id: 2, usuario: 'cliente', role: 'client' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const sesionActiva = {
  id: 10,
  revoked: false,
  last_seen: new Date(Date.now() + 60_000).toISOString(),
  device_id: 'device-1'
};

// I = OH Unit USD (costo Chile real). RAIL-B02 viene en 4 filas que suman 40.
const STOCK = [
  ['Product Image', 'Manuf. Brand', 'Product Name Trax', 'Central SKU', 'MPN', 'Otro', 'OH Quantity', '', 'OH Unit USD'],
  ['', 'Axis', 'AXIS P1475-LE', 'ES006AXS92', '03181-001', '', 9, '', 500],
  ['', 'QNAP', 'Rail Kit', 'AC997QNA09', 'RAIL-B02', '', 15, '', 100],
  ['', 'QNAP', 'Rail Kit', 'AC997QNA09', 'RAIL-B02', '', 10, '', 100],
  ['', 'QNAP', 'Rail Kit', 'AC997QNA09', 'RAIL-B02', '', 5, '', 120],
  ['', 'QNAP', 'Rail Kit', 'AC997QNA09', 'RAIL-B02', '', 10, '', 120],
  ['', 'QNAP', 'NAS 4 bahias', 'NW001QNA07', 'TS-435XeU-4G-US', '', 2, '', 800]
];
// OSO: C=SKU, D=MPN, H=cantidad alocada
const OSO = [
  ['Trans No', 'Manuf. Brand', 'Central SKU', 'MPN', 'Product Name Trax', 'Cliente', 'PO', 'Alloc Quantity'],
  ['BO-1', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'Securitas', 'PO-1', 4],
  ['BO-2', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'Prosegur', 'PO-2', 2],
  ['BO-3', 'QNAP', 'NW001QNA07', 'TS-435XeU-4G-US', 'NAS', 'ACME', 'PO-3', 5],
  ['BO-4', 'QNAP', 'AC997QNA09', 'RAIL-B02', 'Rail', 'ACME', 'PO-4', 3]
];

const hojas = ({ osoFalla = false } = {}) => {
  mockValuesGet.mockImplementation(({ range }) => {
    if (range === 'OSO') {
      if (osoFalla) return Promise.reject(Object.assign(new Error('OSO no disponible'), { code: 403 }));
      return Promise.resolve({ data: { values: OSO } });
    }
    return Promise.resolve({ data: { values: STOCK } });
  });
};

describe('stock disponible neto de lo asignado en OSO', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockValuesGet.mockReset();
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) return Promise.resolve({ rows: [sesionActiva] });
      if (sql.includes('UPDATE sesiones')) return Promise.resolve({ rows: [] });
      throw new Error(`SQL no esperado: ${sql}`);
    });
  });

  // Va primero: la cache de stock solo se llena con lecturas buenas.
  test('si OSO no se puede leer, no se ofrece stock sin descontar', async () => {
    hojas({ osoFalla: true });
    const response = await request(app).get('/api/stock').set('Authorization', `Bearer ${token}`).set('x-session-id', 's1');
    expect(response.status).toBe(500);
    expect(response.body.items).toBeUndefined();
  });

  test('/api/stock resta la columna H de OSO por producto', async () => {
    hojas();
    const response = await request(app).get('/api/stock').set('Authorization', `Bearer ${token}`).set('x-session-id', 's2');
    expect(response.status).toBe(200);
    const porMpn = Object.fromEntries(response.body.items.map((i) => [i.mpn, i]));
    expect(porMpn['03181-001']).toEqual({ mpn: '03181-001', quantity: 3, stock_bodega: 9, asignado: 6 });
    // 4 filas del mismo MPN se suman (40) y OSO se descuenta una vez (3): 37.
    expect(porMpn['RAIL-B02']).toEqual({ mpn: 'RAIL-B02', quantity: 37, stock_bodega: 40, asignado: 3 });
    expect(response.body.items.filter((i) => i.mpn === 'RAIL-B02')).toHaveLength(1);
    // Todo asignado (5 sobre 2 en bodega): cuenta como sin stock y no se envía.
    expect(porMpn['TS-435XeU-4G-US']).toBeUndefined();
  });

  test('/api/stock/catalog muestra el disponible neto', async () => {
    hojas();
    const response = await request(app).get('/api/stock/catalog').set('Authorization', `Bearer ${token}`).set('x-session-id', 's3');
    expect(response.status).toBe(200);
    const axis = response.body.items.find((i) => i.mpn === '03181-001');
    expect(axis).toMatchObject({ sku: 'ES006AXS92', quantity: 3, stock_bodega: 9, asignado: 6, origin: 'AXIS' });
    expect(JSON.stringify(response.body)).not.toMatch(/costo|OH Unit/i);
    // El catálogo mantiene la fila (con su desglose) para auditoría; la app no la lista.
    expect(response.body.items.find((i) => i.mpn === 'TS-435XeU-4G-US')).toMatchObject({ quantity: 0, stock_bodega: 2, asignado: 5 });
  });

  test('el precio del cliente usa el costo Chile real (OH Unit USD) si hay disponible', async () => {
    hojas();
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT id, revoked, last_seen, device_id FROM sesiones')) return Promise.resolve({ rows: [sesionActiva] });
      if (sql.includes('UPDATE sesiones')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT * FROM productos')) {
        return Promise.resolve({ rows: [
          { id: 1, origen: 'QNAP', marca: 'QNAP', sku: 'AC997QNA09', mpn: 'RAIL-B02', descripcion: 'Rail', precio_disty: 90, activo: true },
          { id: 2, origen: 'QNAP', marca: 'QNAP', sku: 'NW001QNA07', mpn: 'TS-435XeU-4G-US', descripcion: 'NAS', precio_disty: 700, activo: true }
        ] });
      }
      if (sql.includes('FROM usuarios WHERE id')) return Promise.resolve({ rows: [{ gp_qnap: 0.2, gp_axis: 0.13 }] });
      throw new Error(`SQL no esperado: ${sql}`);
    });
    const response = await request(app).get('/api/productos').set('Authorization', `Bearer ${token}`).set('x-session-id', 's4');
    expect(response.status).toBe(200);
    const rail = response.body.find((p) => p.mpn === 'RAIL-B02');
    const nas = response.body.find((p) => p.mpn === 'TS-435XeU-4G-US');
    // RAIL-B02 con 37 disponibles: costo real ponderado (25*100 + 15*120)/40 = 107.5 -> 107.5 / (1 - 0.2)
    expect(rail.precio_cliente).toBeCloseTo(107.5 / 0.8, 2);
    // NAS todo asignado: sin disponible, se cotiza con el costo calculado desde el disty.
    expect(nas.precio_cliente).toBeCloseTo((((700 * 1.011) / 0.95) * 1.12) / 0.8, 2);
    // El cliente nunca recibe el costo.
    expect(JSON.stringify(response.body)).not.toMatch(/costo|disty/i);
  });
});

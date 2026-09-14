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

const STOCK = [
  ['Product Image', 'Manuf. Brand', 'Product Name Trax', 'Central SKU', 'MPN', 'Otro', 'OH Quantity'],
  ['', 'Axis', 'AXIS P1475-LE', 'ES006AXS92', '03181-001', '', '9'],
  ['', 'QNAP', 'Rail Kit', 'AC997QNA09', 'RAIL-B02', '', '15'],
  ['', 'QNAP', 'NAS 4 bahias', 'NW001QNA07', 'TS-435XeU-4G-US', '', '2']
];
// OSO: C=SKU, D=MPN, H=cantidad alocada
const OSO = [
  ['Trans No', 'Manuf. Brand', 'Central SKU', 'MPN', 'Product Name Trax', 'Cliente', 'PO', 'Alloc Quantity'],
  ['BO-1', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'Securitas', 'PO-1', 4],
  ['BO-2', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'Prosegur', 'PO-2', 2],
  ['BO-3', 'QNAP', 'NW001QNA07', 'TS-435XeU-4G-US', 'NAS', 'ACME', 'PO-3', 5]
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
    expect(porMpn['RAIL-B02']).toMatchObject({ quantity: 15, asignado: 0 });
    // Asignado mayor que bodega: disponible 0, nunca negativo.
    expect(porMpn['TS-435XeU-4G-US']).toMatchObject({ quantity: 0, stock_bodega: 2, asignado: 5 });
  });

  test('/api/stock/catalog muestra el disponible neto', async () => {
    hojas();
    const response = await request(app).get('/api/stock/catalog').set('Authorization', `Bearer ${token}`).set('x-session-id', 's3');
    expect(response.status).toBe(200);
    const axis = response.body.items.find((i) => i.mpn === '03181-001');
    expect(axis).toMatchObject({ sku: 'ES006AXS92', quantity: 3, stock_bodega: 9, asignado: 6, origin: 'AXIS' });
  });
});

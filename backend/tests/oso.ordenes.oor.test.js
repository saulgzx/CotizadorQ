/**
 * GET /api/oso/orders y el OOR: fechas de la pestana OOR (texto dia-mes-ano), ETA de la orden
 * a DIAS_A_ETA (15) dias y registro de la version del OOR sin afectar la respuesta.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockQuery = jest.fn();
const mockValuesGet = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() }))
  }))
}));

jest.mock('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn() },
    sheets: jest.fn(() => ({ spreadsheets: { values: { get: mockValuesGet } } }))
  }
}));

process.env.JWT_SECRET = 'oso-oor-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GOOGLE_SHEETS_ID = 'sheet-de-prueba';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'bot@test.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
process.env.GOOGLE_API_RETRIES = '0';
process.env.GEO_ENABLED = 'false';

const token = jwt.sign({ id: 1, usuario: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const sesion = { id: 10, revoked: false, last_seen: new Date(Date.now() + 60_000).toISOString(), device_id: 'd', role: 'admin' };

const OSO = [
  ['Trans No', 'Manuf. Brand', 'Central SKU', 'MPN', 'Product Name Trax', 'Charge Customer Name', 'Customer PO', 'Alloc Quantity'],
  ['BO-1', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'SICE', 'OC-1', 4],
  ['BO-2', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'Prosegur', 'OC-2', 2],
  ['BO-3', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'ACME', 'OC-3', 2],
  ['BO-4', 'Axis', 'ES006AXS92', '03181-001', 'AXIS P1475-LE', 'Otro', 'OC-4', 2]
];
const OOR = [
  ['Order No', 'Line No', 'Customer PO No', 'Status', 'Sales Part', 'Sales Qty', 'Planned Ship Date'],
  [9001, 1, 575740, 'Released', '03181-001', 1, '10-12-2026'], // texto dia-mes: 10 de diciembre
  [9002, 1, 575741, 'Released', '03181-001', 1, '23-12-2026'], // new Date() no la entiende
  [9003, 1, 575742, 'Released', '03181-001', 1, 46366], // numero de serie: 10-12-2026
  [9004, 1, 575743, 'Released', '03181-001', 1, 'por confirmar'] // basura: se conserva tal cual
];
const PO_POR_BO = { 'BO-1': '575740', 'BO-2': '575741', 'BO-3': '575742', 'BO-4': '575743' };

let app;
let oorModulo;
let logger;

beforeEach(() => {
  jest.resetModules(); // cada test arranca con la cache de /api/oso/orders vacia
  mockQuery.mockReset();
  mockValuesGet.mockReset();
  mockValuesGet.mockImplementation(({ range }) => Promise.resolve({ data: { values: range === 'OSO' ? OSO : OOR } }));
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM sesiones s JOIN usuarios u ON u.id = s.user_id')) return { rows: [sesion] };
    if (sql.includes('SELECT role FROM usuarios WHERE id = $1')) return { rows: [{ role: 'admin' }] };
    if (sql.includes('SELECT bo, po_axis FROM bo_meta')) {
      return { rows: Object.entries(PO_POR_BO).map(([bo, po_axis]) => ({ bo, po_axis })) };
    }
    return { rows: [] };
  });
  app = require('../src/app');
  oorModulo = require('../src/oor');
  ({ logger } = require('../src/utils/logger'));
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});

const ordenes = () => request(app).get('/api/oso/orders').set('Authorization', `Bearer ${token}`).set('x-session-id', 's1');
const porBo = (res) => Object.fromEntries(res.body.orders.map((o) => [o.bo, o]));

describe('GET /api/oso/orders y las fechas del OOR', () => {
  test('el texto dia-mes-ano se lee como dia-mes (10-12-2026 es 10 de diciembre) y la ETA suma 15 dias', async () => {
    const res = await ordenes();
    expect(res.status).toBe(200);
    const o = porBo(res);
    expect(o['BO-1'].plannedShipDate).toBe('2026-12-10');
    expect(o['BO-1'].etaEstimated).toBe('2026-12-25'); // +15 dias (antes +14: 12-24)
    expect(o['BO-2'].plannedShipDate).toBe('2026-12-23');
    expect(o['BO-2'].etaEstimated).toBe('2027-01-07');
    expect(o['BO-3'].plannedShipDate).toBe('2026-12-10'); // numero de serie, igual que siempre
    expect(o['BO-3'].etaEstimated).toBe('2026-12-25');
  });

  test('lo que no se puede leer como fecha conserva el comportamiento anterior', async () => {
    const res = await ordenes();
    const o = porBo(res);
    expect(o['BO-4'].plannedShipDate).toBe('por confirmar');
    expect(o['BO-4'].etaEstimated).toBe('');
  });

  test('el ETA por orden coincide con el de cada linea del OOR (misma constante)', async () => {
    const { DIAS_A_ETA, sumarDias } = require('../src/oor/comparar');
    expect(DIAS_A_ETA).toBe(15);
    const res = await ordenes();
    expect(porBo(res)['BO-1'].etaEstimated).toBe(sumarDias('2026-12-10', DIAS_A_ETA));
  });
});

describe('GET /api/oso/orders registra la version del OOR', () => {
  test('llama a registrarLectura con las filas del OOR', async () => {
    const espia = jest.spyOn(oorModulo, 'registrarLectura').mockResolvedValue({ id: 1 });
    const res = await ordenes();
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.mock.calls[0][1]).toEqual(OOR);
  });

  test('si registrar falla (rechaza o lanza), la respuesta de ordenes no cambia y queda en el log', async () => {
    jest.spyOn(oorModulo, 'registrarLectura').mockRejectedValue(new Error('BD caida'));
    const res = await ordenes();
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(4);
    await new Promise((r) => setImmediate(r));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'oor_registrar_fallo' }), expect.any(String));
  });

  test('con la implementacion real y la BD sin las tablas, ordenes responde igual', async () => {
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (sql, params) => {
      if (/oor_/.test(sql)) throw Object.assign(new Error('relation "oor_snapshots" does not exist'), { code: '42P01' });
      return base(sql, params);
    });
    const res = await ordenes();
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(4);
  });
});

const mockQuery = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    connect: jest.fn()
  }))
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GOOGLE_SHEETS_SYNC_HOURS = '0';
delete process.env.GOOGLE_SHEETS_ID;

require('../src/app');
const { startServer } = require('../src/routes/legacyRoutes');

const esperarHasta = async (condicion, timeoutMs = 3000) => {
  const limite = Date.now() + timeoutMs;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error('timeout esperando condicion');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('arranque del servidor', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('sin conexion a la BD reintenta y termina con codigo distinto de cero', async () => {
    const sinConexion = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    mockQuery.mockRejectedValue(sinConexion);
    const exit = jest.fn();

    const server = await startServer(0, { exit, retries: 3, delayMs: 1 });

    expect(server).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('se recupera si la BD responde en un reintento', async () => {
    mockQuery
      .mockRejectedValueOnce(Object.assign(new Error('the database system is starting up'), { code: '57P03' }))
      .mockResolvedValue({ rows: [] });
    const exit = jest.fn();

    const server = await startServer(0, { exit, retries: 3, delayMs: 1 });
    try {
      expect(server).not.toBeNull();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      await esperarHasta(() => mockQuery.mock.calls.some(([sql]) => String(sql).includes('cotizacion_versiones_idx')));
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('con conexion, un paso de initDB que falla no impide arrancar ni la migracion del folio', async () => {
    mockQuery.mockImplementation((sql) => {
      if (String(sql).includes('CREATE TABLE IF NOT EXISTS usuarios')) {
        return Promise.reject(new Error('permission denied for schema public'));
      }
      return Promise.resolve({ rows: [] });
    });
    const exit = jest.fn();

    const server = await startServer(0, { exit, retries: 2, delayMs: 1 });
    try {
      expect(server).not.toBeNull();
      await esperarHasta(() =>
        mockQuery.mock.calls.some(([sql]) => String(sql).includes('CREATE SEQUENCE IF NOT EXISTS cotizacion_numero_seq'))
      );
      await esperarHasta(() => mockQuery.mock.calls.some(([sql]) => String(sql).includes('cotizacion_versiones_idx')));
      expect(exit).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn()
  }))
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GEO_ENABLED = 'true';

const { GEO_PROVIDERS, resolveGeo } = require('../src/routes/legacyRoutes');

const respuestaJson = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('geolocalizacion por IP', () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  test('todos los proveedores usan https', () => {
    expect(GEO_PROVIDERS.length).toBeGreaterThan(0);
    for (const provider of GEO_PROVIDERS) {
      expect(provider.url('8.8.8.8')).toMatch(/^https:\/\//);
    }
  });

  test('ipapi.co mapea sus campos y descarta respuestas de error', () => {
    const ipapi = GEO_PROVIDERS.find((p) => p.name === 'ipapi.co');
    expect(ipapi).toBeDefined();
    expect(
      ipapi.parse({
        ip: '8.8.8.8',
        city: 'Santiago',
        country: 'CL',
        country_name: 'Chile',
        country_code: 'CL',
        latitude: -33.45,
        longitude: -70.66,
        org: 'ISP Ejemplo'
      })
    ).toEqual({ country: 'Chile', countryCode: 'CL', city: 'Santiago', lat: -33.45, lon: -70.66, isp: 'ISP Ejemplo' });
    expect(ipapi.parse({ error: true, reason: 'RateLimited' })).toBeNull();
  });

  test('si el primer proveedor falla usa el respaldo, siempre por https', async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith('https://ipwho.is/')) return Promise.reject(new Error('bloqueado'));
      return respuestaJson({ city: 'Lima', country_name: 'Peru', country_code: 'PE', latitude: -12.04, longitude: -77.03, org: 'X' });
    });

    const geo = await resolveGeo('203.0.113.50');

    expect(geo).toMatchObject({ country: 'Peru', countryCode: 'PE', city: 'Lima', lat: -12.04, lon: -77.03 });
    expect(global.fetch.mock.calls.every(([url]) => url.startsWith('https://'))).toBe(true);
  });

  test('si todos los proveedores fallan devuelve null sin lanzar', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('sin red')));
    await expect(resolveGeo('203.0.113.51')).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(GEO_PROVIDERS.length);
  });
});

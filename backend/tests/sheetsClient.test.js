jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: jest.fn(), connect: jest.fn() }))
}));

process.env.JWT_SECRET = 'stage6-tests-secret-with-minimum-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'bot@proyecto.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';

const { getSheetsClient } = require('../src/routes/legacyRoutes');

// Regresion: con google-auth-library 10 los argumentos posicionales de JWT se
// ignoran y el cliente queda sin credenciales (toda lectura de Sheets falla).
describe('getSheetsClient', () => {
  test('el cliente de Sheets lleva email, clave y scope de solo lectura', () => {
    const auth = getSheetsClient(true).context._options.auth;
    expect(auth.email).toBe('bot@proyecto.iam.gserviceaccount.com');
    expect(auth.key).toContain('BEGIN PRIVATE KEY');
    expect(auth.key).toContain('\n');
    expect(auth.scopes).toEqual([
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]);
  });

  test('con readOnly=false usa el scope de escritura', () => {
    const auth = getSheetsClient(false).context._options.auth;
    expect(auth.scopes).toEqual(['https://www.googleapis.com/auth/spreadsheets']);
  });
});

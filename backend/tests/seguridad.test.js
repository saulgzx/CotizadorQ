const fs = require('fs');
const path = require('path');

const LEGACY_ROUTES = path.join(__dirname, '..', 'src', 'routes', 'legacyRoutes.js');
const legacySource = () => fs.readFileSync(LEGACY_ROUTES, 'utf8');

describe('seguridad: credenciales en el codigo', () => {
  test('legacyRoutes.js no contiene hashes bcrypt', () => {
    expect(legacySource()).not.toMatch(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/);
  });

  test('initDB no siembra usuarios al arrancar', () => {
    const source = legacySource();
    const inicio = source.indexOf('const initDB = async');
    const fin = source.indexOf('\n};', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(source.slice(inicio, fin)).not.toMatch(/INSERT INTO usuarios/i);
  });
});

describe('seguridad: URLs en logs', () => {
  const { sanitizeUrlForLog } = require('../src/utils/logger');

  test('enmascara el secreto de /mcp/<secreto>', () => {
    expect(sanitizeUrlForLog('/mcp/s3cr3t/con/barras')).toBe('/mcp/[censurado]');
    expect(sanitizeUrlForLog('/mcp')).toBe('/mcp');
  });

  test('enmascara el verify_token del webhook de WhatsApp y otros parametros sensibles', () => {
    const limpia = sanitizeUrlForLog(
      '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=abc123&hub.challenge=999&api_key=k&token=t'
    );
    expect(limpia).not.toMatch(/abc123|api_key=k|token=t(&|$)/);
    expect(limpia).toContain('hub.verify_token=[censurado]');
    expect(limpia).toContain('hub.challenge=999');
  });

  test('deja intactas las URLs sin datos sensibles', () => {
    expect(sanitizeUrlForLog('/api/productos?origen=AXIS&q=P1475')).toBe('/api/productos?origen=AXIS&q=P1475');
    expect(sanitizeUrlForLog(undefined)).toBe('');
  });
});

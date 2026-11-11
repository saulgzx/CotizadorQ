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

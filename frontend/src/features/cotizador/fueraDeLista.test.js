import { esFueraDeLista, productoFueraDeLista } from './fueraDeLista';

const FILA = { name: 'AXIS Q6135-LE PTZ', brand: 'AXIS', origin: 'AXIS', sku: 'AX-Q6135', mpn: 'Q6135-LE', quantity: 1, costo_chile: 2150.456 };

describe('equipos en stock fuera de la lista de precios', () => {
  test('arma un producto cotizable desde el costo real de stock', () => {
    expect(productoFueraDeLista(FILA, { gpPorDefecto: 0.13 })).toMatchObject({
      id: 'stock:Q6135LE',
      fueraDeLista: true,
      origen: 'AXIS',
      marca: 'AXIS',
      sku: 'AX-Q6135',
      mpn: 'Q6135-LE',
      desc: 'AXIS Q6135-LE PTZ',
      precio: 0,
      gp: 0.13,
      rebate_partner_autorizado: 0,
      costoChile: 2150.46
    });
  });

  test('sin costo real o sin código no se puede cotizar', () => {
    expect(productoFueraDeLista({ ...FILA, costo_chile: null })).toBeNull();
    expect(productoFueraDeLista({ ...FILA, costo_chile: 0 })).toBeNull();
    expect(productoFueraDeLista({ ...FILA, mpn: '', sku: '' })).toBeNull();
  });

  test('usa el SKU si no hay MPN y trata como QNAP lo que no es Axis', () => {
    const p = productoFueraDeLista({ name: 'NAS', brand: 'QNAP', origin: 'QNAP', sku: 'ns 001', mpn: '', costo_chile: 500 });
    expect(p).toMatchObject({ id: 'stock:NS001', origen: 'QNAP', mpn: '', sku: 'ns 001' });
  });

  test('el mismo equipo da siempre el mismo id (se suma en el carrito, no se duplica)', () => {
    expect(productoFueraDeLista(FILA).id).toBe(productoFueraDeLista({ ...FILA, mpn: ' q6135 le ' }).id);
  });

  test('reconoce una línea fuera de lista por su marca o por su id', () => {
    expect(esFueraDeLista({ id: 'stock:Q6135LE' })).toBe(true);
    expect(esFueraDeLista({ id: 41, fueraDeLista: true })).toBe(true);
    expect(esFueraDeLista({ id: 41 })).toBe(false);
    expect(esFueraDeLista(null)).toBe(false);
  });
});

const { aNumero, agregarStock, mapaCostosChile, costoChilePara } = require('../src/services/stockAgregado');
const { calcularAsignaciones } = require('../src/services/stockDisponible');

// Stock: A imagen, B marca, C nombre, D SKU, E MPN, F -, G OH Quantity, H -, I OH Unit USD
const fila = (sku, mpn, qty, costo, nombre = 'x') => ['', 'QNAP', nombre, sku, mpn, '', qty, '', costo];
const STOCK = [
  ['Product Image', 'Manuf. Brand', 'Product Name Trax', 'Central SKU', 'MPN', '', 'OH Quantity', '', 'OH Unit USD'],
  fila('AC997QNA09', 'RAIL-B02', 10, 100),
  fila('AC997QNA09', 'RAIL-B02', '15', 'US$ 110,00'),
  fila('AC997QNA09', 'rail-b02', 5, 90),
  fila('AC997QNA09', 'RAIL-B02 ', 10, '1,100.50'),
  fila('NW001QNA07', 'TS-435XeU-4G-US', 2, 700),
  fila('ES006AXS92', '03181-001', 0, 450)
];
// OSO: C SKU, D MPN, H asignado
const OSO = [
  ['Trans No', 'Brand', 'Central SKU', 'MPN', '', '', '', 'Alloc Quantity'],
  ['BO-1', 'QNAP', 'AC997QNA09', 'RAIL-B02', '', '', '', 3],
  ['BO-2', 'QNAP', 'NW001QNA07', 'TS-435XeU-4G-US', '', '', '', 2]
];

describe('stock agregado por producto', () => {
  const items = agregarStock(STOCK, undefined, calcularAsignaciones(OSO));
  const porMpn = Object.fromEntries(items.map((i) => [i.mpn.trim().toUpperCase(), i]));

  test('suma todas las filas del mismo MPN y descuenta OSO una sola vez (caso RAIL-B02: 40 - 3 = 37)', () => {
    expect(porMpn['RAIL-B02']).toMatchObject({ stock_bodega: 40, asignado: 3, disponible: 37, filas: 4 });
  });

  test('costo Chile real = promedio ponderado por unidades de la columna I', () => {
    // (10*100 + 15*110 + 5*90 + 10*1100.5) / 40
    expect(porMpn['RAIL-B02'].costo_chile).toBeCloseTo((1000 + 1650 + 450 + 11005) / 40, 2);
  });

  test('todo asignado: 0 disponible', () => {
    expect(porMpn['TS-435XEU-4G-US']).toMatchObject({ stock_bodega: 2, asignado: 2, disponible: 0 });
  });

  test('el costo real solo aplica a productos con unidades disponibles', () => {
    const mapa = mapaCostosChile(items);
    expect(costoChilePara(mapa, { mpn: 'RAIL-B02' })).toBeCloseTo(352.63, 2);
    expect(costoChilePara(mapa, { mpn: 'TS-435XeU-4G-US' })).toBeNull();
    expect(costoChilePara(mapa, { mpn: '03181-001' })).toBeNull();
    // Por SKU cuando el MPN no calza; "To Create" nunca.
    expect(costoChilePara(mapa, { mpn: 'OTRO', sku: 'ac997qna09' })).toBeCloseTo(352.63, 2);
    expect(costoChilePara(mapa, { mpn: '', sku: 'To Create' })).toBeNull();
  });

  test('parsea montos en formatos de planilla', () => {
    expect(aNumero(12)).toBe(12);
    expect(aNumero('1.234')).toBe(1234);
    expect(aNumero('1,234')).toBe(1234);
    expect(aNumero('95,30')).toBe(95.3);
    expect(aNumero('US$ 1.234,56')).toBe(1234.56);
    expect(aNumero('1,234.56')).toBe(1234.56);
    expect(aNumero('-')).toBeNull();
    expect(aNumero('')).toBeNull();
  });
});

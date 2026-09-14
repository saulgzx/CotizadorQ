const { calcularAsignaciones, asignadoPara, aplicarAsignacion } = require('../src/services/stockDisponible');

// Fila OSO: A, B, C=SKU, D=MPN, E, F, G, H=asignado
const oso = (sku, mpn, asignado) => ['BO-1', 'Axis', sku, mpn, 'desc', 'cliente', 'po', asignado];

describe('stock disponible descontando OSO', () => {
  const rows = [
    ['Trans No', 'Brand', 'Central SKU', 'MPN', 'Desc', 'Cliente', 'PO', 'Alloc Quantity'],
    oso('ES006AXS92', '03181-001', 3),
    oso('ES006AXS92', '03181-001', '2'),
    oso('AC997QNA09', 'RAIL-B02', 0),
    oso('NW001QNA07', '', 4),
    oso('', 'ts-464-8g', '1.000')
  ];
  const asignaciones = calcularAsignaciones(rows);

  test('suma la columna H por MPN, aunque venga como texto o con miles', () => {
    expect(asignadoPara(asignaciones, { mpn: '03181-001' })).toBe(5);
    expect(asignadoPara(asignaciones, { mpn: 'TS-464-8G' })).toBe(1000);
  });

  test('si la fila OSO no trae MPN, se descuenta por SKU', () => {
    expect(asignadoPara(asignaciones, { mpn: 'TS-435XEU-4G-US', sku: 'NW001QNA07' })).toBe(4);
  });

  test('no cuenta dos veces una fila que coincide por MPN y SKU', () => {
    expect(asignadoPara(asignaciones, { mpn: '03181-001', sku: 'ES006AXS92' })).toBe(5);
  });

  test('sin asignaciones, disponible = bodega', () => {
    expect(aplicarAsignacion(15, asignadoPara(asignaciones, { mpn: 'RAIL-B02' }))).toEqual({ stock_bodega: 15, asignado: 0, disponible: 15 });
  });

  test('descuenta lo asignado y nunca queda negativo', () => {
    expect(aplicarAsignacion(9, 5)).toEqual({ stock_bodega: 9, asignado: 5, disponible: 4 });
    expect(aplicarAsignacion(3, 5)).toEqual({ stock_bodega: 3, asignado: 5, disponible: 0 });
    expect(aplicarAsignacion('12', 2).disponible).toBe(10);
  });

  test('una cantidad no numerica no se ofrece como disponible', () => {
    expect(aplicarAsignacion('Consultar', 0).disponible).toBe(0);
  });
});

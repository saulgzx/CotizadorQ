const { construirMapaEta, textoEta } = require('../src/services/etaAxis');

// A = Part Number, B = descripcion, C = estandar, D = actual, E = real
const ETA = [
  ['Part Number', 'Part Description', 'Total Standard Lead Time', 'Total Current Lead Time', 'Leadtime Real'],
  ['02930-001', 'AXIS D4200-VE', 2, 12, 12],
  ['01402-001', 'USB BLUETOOTH READER', 2, '-', 2],
  ['5505-351', 'AXIS T98A15-VE', 4, '-', ''],
  ['01964-008', 'Fila despues de la 1711', 2, '-', 6],
  ['SIN-PLAZO', 'x', '-', '-', '-'],
  ['02930-001', 'duplicado con plazo menor', 2, '-', 3]
];

describe('ETA de productos sin stock', () => {
  const mapa = construirMapaEta(ETA);

  test('misma regla que LP_AXIS columna J: Leadtime Real + 4 semanas', () => {
    expect(textoEta(mapa, '01402-001')).toBe('6 semanas tras OC');
  });

  test('lee filas que el VLOOKUP de LP_AXIS no alcanza', () => {
    expect(textoEta(mapa, '01964-008')).toBe('10 semanas tras OC');
  });

  test('si Leadtime Real viene vacio usa la actual y luego la estandar', () => {
    expect(textoEta(mapa, '5505-351')).toBe('8 semanas tras OC');
  });

  test('MPN repetido: se queda el plazo mas largo', () => {
    expect(textoEta(mapa, '02930-001')).toBe('16 semanas tras OC');
  });

  test('sin plazo o sin fila: vacio, para caer al respaldo', () => {
    expect(textoEta(mapa, 'SIN-PLAZO')).toBe('');
    expect(textoEta(mapa, 'NO-EXISTE')).toBe('');
    expect(textoEta(null, '01402-001')).toBe('');
  });

  test('ignora mayusculas y espacios del MPN', () => {
    expect(textoEta(mapa, ' 01402-001 ')).toBe('6 semanas tras OC');
  });
});

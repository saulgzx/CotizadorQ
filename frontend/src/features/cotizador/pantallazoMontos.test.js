import { calzarMontos, claveLinea, normalizarMonto } from './pantallazoMontos';

const lineas = [
  { brand: 'AXIS', sku: '02345-001', mpn: 'P1475-LE', desc: 'AXIS P1475-LE', orderQty: 4, shippedQty: 0, montoAxis: 320.5, montoIntcomex: 410 },
  { brand: 'AXIS', sku: '01234-001', mpn: 'M3086-V', desc: 'AXIS M3086-V Mini Dome', orderQty: 2, shippedQty: 0 },
  { brand: 'AXIS', sku: '5506-481', mpn: 'T91B47', desc: 'AXIS T91B47 Pole Mount', orderQty: 1, shippedQty: 0 }
];
const P1475 = '02345-001||p1475-le';
const M3086 = '01234-001||m3086-v';
const T91 = '5506-481||t91b47';

describe('normalizarMonto', () => {
  test('numeros positivos pasan tal cual, sin redondear', () => {
    expect(normalizarMonto(410)).toBe(410);
    expect(normalizarMonto(320.5)).toBe(320.5);
    expect(normalizarMonto(1234.5678)).toBe(1234.5678);
  });

  test('formato ingles: coma de miles y punto decimal', () => {
    expect(normalizarMonto('1,234.56')).toBe(1234.56);
    expect(normalizarMonto('1,234,567.8')).toBe(1234567.8);
    expect(normalizarMonto('410')).toBe(410);
    expect(normalizarMonto('410.5')).toBe(410.5);
    expect(normalizarMonto('1,234')).toBe(1234);
    expect(normalizarMonto('1,234,567')).toBe(1234567);
  });

  test('formato espanol: punto de miles y coma decimal', () => {
    expect(normalizarMonto('1.234,56')).toBe(1234.56);
    expect(normalizarMonto('1.234.567,8')).toBe(1234567.8);
    expect(normalizarMonto('410,5')).toBe(410.5);
    expect(normalizarMonto('410,50')).toBe(410.5);
    expect(normalizarMonto('1.234.567')).toBe(1234567);
  });

  test('"1.234" sin mas contexto son mil doscientos treinta y cuatro', () => {
    expect(normalizarMonto('1.234')).toBe(1234);
    expect(normalizarMonto('12.345')).toBe(12345);
  });

  test('lo que no puede ser miles se lee como decimal', () => {
    expect(normalizarMonto('0.125')).toBe(0.125);
    expect(normalizarMonto('0,125')).toBe(0.125);
    expect(normalizarMonto('12.3456')).toBe(12.3456);
    expect(normalizarMonto('1234.567')).toBe(1234.567);
  });

  test('simbolo de moneda y espacios', () => {
    expect(normalizarMonto('$1,234.56')).toBe(1234.56);
    expect(normalizarMonto(' $ 410 ')).toBe(410);
    expect(normalizarMonto('US$ 410.00')).toBe(410);
    expect(normalizarMonto('USD 1,234.56')).toBe(1234.56);
    expect(normalizarMonto('1.234,56 USD')).toBe(1234.56);
    expect(normalizarMonto('1 234,56')).toBe(1234.56);
  });

  test('vacio, nulos y basura -> null', () => {
    for (const valor of ['', '   ', null, undefined, '-', 'N/A', 'n/a', 'abc', '$', '12abc', '4l0', {}, [], true, NaN, Infinity]) {
      expect(normalizarMonto(valor)).toBeNull();
    }
  });

  test('separadores mal puestos -> null en vez de adivinar', () => {
    for (const valor of ['1,23,456', '1.2.3', '1,234.56.78', '12,34.56', '1.234,56,7', '410.', '.5', '1,,234']) {
      expect(normalizarMonto(valor)).toBeNull();
    }
  });

  test('cero y negativos -> null', () => {
    for (const valor of [0, -5, -0.01, '0', '0.00', '0,00', '$0', '-410', '-$410', '$-1,234.56', '(410)', '410-']) {
      expect(normalizarMonto(valor)).toBeNull();
    }
  });
});

describe('calzarMontos', () => {
  test('la clave de linea es sku||mpn normalizados', () => {
    expect(claveLinea({ sku: ' 02345-001 ', mpn: 'P1475-LE' })).toBe(P1475);
    expect(claveLinea({ sku: null, mpn: 'T91B47' })).toBe('||t91b47');
  });

  test('calce por mpn, sin importar mayusculas ni espacios', () => {
    const r = calzarMontos({ filas: [{ sku: '', mpn: ' p1475-le ', descripcion: null, monto: 410 }], lineas });
    expect(r.asignaciones).toEqual({ [P1475]: 410 });
    expect(r.calzadas).toEqual([{ clave: P1475, monto: 410, por: 'mpn' }]);
  });

  test('calce por sku cuando el mpn viene vacio o mal leido', () => {
    const r = calzarMontos({
      filas: [
        { sku: '01234-001', mpn: '', descripcion: '', monto: '$95.50' },
        { sku: '5506-481', mpn: 'T9IB47', descripcion: '', monto: '1,020.00' }
      ],
      lineas
    });
    expect(r.asignaciones).toEqual({ [M3086]: 95.5, [T91]: 1020 });
    expect(r.calzadas.map((c) => c.por)).toEqual(['sku', 'sku']);
  });

  test('calce por descripcion exacta contra desc de la linea', () => {
    const r = calzarMontos({ filas: [{ sku: null, mpn: null, descripcion: 'axis t91b47 pole mount', monto: '38,9' }], lineas });
    expect(r.asignaciones).toEqual({ [T91]: 38.9 });
    expect(r.calzadas).toEqual([{ clave: T91, monto: 38.9, por: 'descripcion' }]);
  });

  test('prioridad: mpn gana a sku, y sku gana a descripcion', () => {
    const r = calzarMontos({
      filas: [
        { sku: '01234-001', mpn: 'P1475-LE', descripcion: 'AXIS T91B47 Pole Mount', monto: 410 },
        { sku: '01234-001', mpn: '', descripcion: 'AXIS T91B47 Pole Mount', monto: 95 }
      ],
      lineas
    });
    expect(r.calzadas).toEqual([
      { clave: P1475, monto: 410, por: 'mpn' },
      { clave: M3086, monto: 95, por: 'sku' }
    ]);
    expect(r.lineasSinDato).toEqual([T91]);
  });

  test('fila que no calza con ninguna linea queda en sinCalce', () => {
    const ajena = { sku: '99999-001', mpn: 'Q6355-LE', descripcion: 'AXIS Q6355-LE', monto: 2500 };
    const vacia = { sku: '', mpn: null, monto: 100 };
    const r = calzarMontos({ filas: [ajena, vacia], lineas });
    expect(r.sinCalce).toEqual([ajena, vacia]);
    expect(r.sinCalce[0]).toBe(ajena);
    expect(r.asignaciones).toEqual({});
  });

  test('campos vacios nunca calzan entre si', () => {
    const r = calzarMontos({
      filas: [{ sku: '', mpn: '', descripcion: '', monto: 100 }],
      lineas: [{ sku: '', mpn: 'X-1', desc: '' }, { sku: 'S-2', mpn: '', desc: '' }]
    });
    expect(r.asignaciones).toEqual({});
    expect(r.sinCalce).toHaveLength(1);
    expect(r.lineasSinDato).toEqual(['||x-1', 's-2||']);
  });

  test('lineas que el pantallazo no cubrio quedan en lineasSinDato, en el orden de la orden', () => {
    const r = calzarMontos({ filas: [{ mpn: 'M3086-V', monto: 95 }], lineas });
    expect(r.lineasSinDato).toEqual([P1475, T91]);
  });

  test('fila que calza pero sin monto legible: sinMonto, y la linea queda sin dato', () => {
    const fila = { sku: '02345-001', mpn: 'P1475-LE', descripcion: '', monto: 'N/A' };
    const cero = { mpn: 'M3086-V', monto: 0 };
    const r = calzarMontos({ filas: [fila, cero], lineas });
    expect(r.sinMonto).toEqual([fila, cero]);
    expect(r.asignaciones).toEqual({});
    expect(r.calzadas).toEqual([]);
    expect(r.lineasSinDato).toEqual([P1475, M3086, T91]);
  });

  test('una fila sin monto no estorba a otra fila valida de la misma linea', () => {
    const r = calzarMontos({ filas: [{ mpn: 'P1475-LE', monto: '-' }, { sku: '02345-001', monto: 410 }], lineas });
    expect(r.asignaciones).toEqual({ [P1475]: 410 });
    expect(r.sinMonto).toHaveLength(1);
    expect(r.ambiguas).toEqual([]);
  });

  test('dos filas con el mismo monto sobre una linea: se asigna, no es ambigua', () => {
    const r = calzarMontos({
      filas: [{ mpn: 'P1475-LE', monto: 410 }, { sku: '02345-001', monto: '$410.00' }],
      lineas
    });
    expect(r.asignaciones).toEqual({ [P1475]: 410 });
    expect(r.calzadas).toEqual([{ clave: P1475, monto: 410, por: 'mpn' }]);
    expect(r.ambiguas).toEqual([]);
  });

  test('dos filas con montos distintos sobre una linea: ambigua y sin asignar', () => {
    const r = calzarMontos({
      filas: [
        { mpn: 'P1475-LE', monto: 410 },
        { sku: '02345-001', monto: 415 },
        { mpn: 'p1475-le', monto: '410.00' },
        { mpn: 'M3086-V', monto: 95 }
      ],
      lineas
    });
    expect(r.ambiguas).toEqual([{ clave: P1475, montos: [410, 415] }]);
    expect(r.asignaciones).toEqual({ [M3086]: 95 });
    expect(r.calzadas).toEqual([{ clave: M3086, monto: 95, por: 'mpn' }]);
    expect(r.lineasSinDato).toEqual([T91]);
  });

  test('un dato que pega con varias lineas distintas no decide: se usa el nivel siguiente', () => {
    const repetidas = [
      { sku: 'A-1', mpn: 'KIT-01', desc: 'Kit version A' },
      { sku: 'B-1', mpn: 'KIT-01', desc: 'Kit version B' }
    ];
    const porSku = calzarMontos({ filas: [{ sku: 'B-1', mpn: 'KIT-01', monto: 50 }], lineas: repetidas });
    expect(porSku.calzadas).toEqual([{ clave: 'b-1||kit-01', monto: 50, por: 'sku' }]);

    const fila = { sku: '', mpn: 'KIT-01', descripcion: '', monto: 50 };
    const sinDecidir = calzarMontos({ filas: [fila], lineas: repetidas });
    expect(sinDecidir.asignaciones).toEqual({});
    expect(sinDecidir.sinCalce).toEqual([fila]);
  });

  test('la misma linea repetida en la orden cuenta una sola vez', () => {
    const r = calzarMontos({ filas: [{ mpn: 'P1475-LE', monto: 410 }], lineas: [lineas[0], { ...lineas[0], orderQty: 1 }] });
    expect(r.asignaciones).toEqual({ [P1475]: 410 });
    expect(r.calzadas).toHaveLength(1);
    expect(r.lineasSinDato).toEqual([]);
  });

  test('no redondea: devuelve el monto tal como se leyo', () => {
    const r = calzarMontos({ filas: [{ mpn: 'P1475-LE', monto: '1,234.5678' }], lineas });
    expect(r.asignaciones[P1475]).toBe(1234.5678);
  });

  test('entradas vacias o invalidas no revientan', () => {
    const vacio = { asignaciones: {}, calzadas: [], sinCalce: [], sinMonto: [], lineasSinDato: [], ambiguas: [] };
    expect(calzarMontos({ filas: [], lineas: [] })).toEqual(vacio);
    expect(calzarMontos({})).toEqual(vacio);
    expect(calzarMontos()).toEqual(vacio);
    const r = calzarMontos({ filas: [null, 'texto', { mpn: 'P1475-LE', monto: 410 }], lineas: [null, ...lineas] });
    expect(r.asignaciones).toEqual({ [P1475]: 410 });
    expect(r.sinCalce).toEqual([null, 'texto']);
  });

  test('no muta filas ni lineas', () => {
    const filas = [
      { sku: '02345-001', mpn: ' P1475-LE ', descripcion: 'AXIS P1475-LE', monto: '$410.00' },
      { sku: '02345-001', mpn: '', descripcion: '', monto: 415 },
      { sku: 'X', mpn: 'Y', descripcion: 'Z', monto: 'N/A' },
      { sku: '', mpn: 'M3086-V', descripcion: '', monto: '' }
    ];
    const copiaFilas = structuredClone(filas);
    const copiaLineas = structuredClone(lineas);
    Object.freeze(filas);
    filas.forEach(Object.freeze);
    const congeladas = Object.freeze(lineas.map((l) => Object.freeze({ ...l })));
    calzarMontos({ filas, lineas: congeladas });
    expect(filas).toEqual(copiaFilas);
    expect(congeladas).toEqual(copiaLineas);
  });
});

import {
  aplicarMontosGuardados,
  borradorSucio,
  cambiarBorrador,
  claveLinea,
  construirPayloadMontos,
  fusionarAsignaciones,
  normalizarMontoLinea,
  numeroMonto,
  resumirLectura,
  valorMonto
} from './montosOrden';

const L1 = { sku: '02345-001', mpn: 'P1475-LE', montoAxis: 320.5, montoIntcomex: 410 };
const L2 = { sku: '01234-001', mpn: 'M3086-V' };
const K1 = '02345-001||p1475-le';
const K2 = '01234-001||m3086-v';
const orden = () => ({ bo: 'BO1', lines: [{ ...L1 }, { ...L2 }] });

describe('normalizarMontoLinea / claveLinea', () => {
  test('vacíos y no numéricos dan null; números y strings parsean', () => {
    expect(normalizarMontoLinea(undefined)).toBeNull();
    expect(normalizarMontoLinea(null)).toBeNull();
    expect(normalizarMontoLinea('')).toBeNull();
    expect(normalizarMontoLinea('abc')).toBeNull();
    expect(normalizarMontoLinea('410')).toBe(410);
    expect(normalizarMontoLinea(320.5)).toBe(320.5);
    expect(normalizarMontoLinea(0)).toBe(0);
  });

  test('clave normaliza sku y mpn', () => {
    expect(claveLinea({ sku: ' 02345-001 ', mpn: 'P1475-LE' })).toBe(K1);
    expect(claveLinea({})).toBe('||');
    expect(claveLinea(undefined)).toBe('||');
  });
});

describe('valorMonto / numeroMonto', () => {
  test('prioridad borrador > guardado > vacío', () => {
    expect(valorMonto({ [K1]: '999' }, L1, 'montoAxis')).toBe('999');
    expect(valorMonto({}, L1, 'montoAxis')).toBe('320.5');
    expect(valorMonto(undefined, L1, 'montoIntcomex')).toBe('410');
    expect(valorMonto({}, L2, 'montoAxis')).toBe('');
    expect(valorMonto(undefined, undefined, 'montoAxis')).toBe('');
  });

  test('el borrador vacío (campo vaciado a mano) gana sobre el guardado', () => {
    expect(valorMonto({ [K1]: '' }, L1, 'montoAxis')).toBe('');
  });

  test('guardado null o vacío se muestra como vacío', () => {
    expect(valorMonto({}, { ...L1, montoAxis: null }, 'montoAxis')).toBe('');
    expect(valorMonto({}, { ...L1, montoAxis: '' }, 'montoAxis')).toBe('');
  });

  test('numeroMonto parsea y cae a 0', () => {
    expect(numeroMonto({ [K1]: '12.5' }, L1, 'montoAxis')).toBe(12.5);
    expect(numeroMonto({ [K1]: '' }, L1, 'montoAxis')).toBe(0);
    expect(numeroMonto({ [K1]: 'x' }, L1, 'montoAxis')).toBe(0);
    expect(numeroMonto({}, L1, 'montoIntcomex')).toBe(410);
    expect(numeroMonto({}, L2, 'montoAxis')).toBe(0);
  });
});

describe('cambiarBorrador', () => {
  test('agrega sin mutar prev', () => {
    const prev = { BO1: { a: '1' } };
    const copia = JSON.parse(JSON.stringify(prev));
    const next = cambiarBorrador(prev, 'BO1', 'b', '2');
    expect(next).toEqual({ BO1: { a: '1', b: '2' } });
    expect(prev).toEqual(copia);
    expect(next).not.toBe(prev);
    expect(next.BO1).not.toBe(prev.BO1);
  });

  test('undefined borra la clave y no muta', () => {
    const prev = { BO1: { a: '1', b: '2' } };
    const next = cambiarBorrador(prev, 'BO1', 'a', undefined);
    expect(next).toEqual({ BO1: { b: '2' } });
    expect(prev).toEqual({ BO1: { a: '1', b: '2' } });
  });

  test('un BO sin claves desaparece; los otros BO quedan', () => {
    const prev = { BO1: { a: '1' }, BO2: { z: '9' } };
    expect(cambiarBorrador(prev, 'BO1', 'a', undefined)).toEqual({ BO2: { z: '9' } });
  });

  test('crea el BO si no existía; undefined sobre BO inexistente no lo crea', () => {
    expect(cambiarBorrador({}, 'BO1', 'a', '')).toEqual({ BO1: { a: '' } });
    expect(cambiarBorrador({}, 'BO1', 'a', undefined)).toEqual({});
  });
});

describe('borradorSucio', () => {
  test('igual al guardado no es sucio', () => {
    expect(borradorSucio(orden(), { [K1]: '320.5' }, 'montoAxis')).toBe(false);
    expect(borradorSucio(orden(), { [K1]: '410' }, 'montoIntcomex')).toBe(false);
    expect(borradorSucio(orden(), { [K2]: '' }, 'montoAxis')).toBe(false);
  });

  test('distinto es sucio, incluido vaciar un monto guardado', () => {
    expect(borradorSucio(orden(), { [K1]: '321' }, 'montoAxis')).toBe(true);
    expect(borradorSucio(orden(), { [K2]: '5' }, 'montoAxis')).toBe(true);
    expect(borradorSucio(orden(), { [K1]: '' }, 'montoAxis')).toBe(true);
  });

  test('clave sin línea es sucia', () => {
    expect(borradorSucio(orden(), { 'x||y': '1' }, 'montoAxis')).toBe(true);
  });

  test('sin borrador o sin bo no es sucio', () => {
    expect(borradorSucio(orden(), undefined, 'montoAxis')).toBe(false);
    expect(borradorSucio({ lines: [] }, { a: '1' }, 'montoAxis')).toBe(false);
    expect(borradorSucio(undefined, { a: '1' }, 'montoAxis')).toBe(false);
  });
});

describe('construirPayloadMontos', () => {
  test('editar solo Axis NO incluye montoIntcomex', () => {
    const [l] = construirPayloadMontos(orden(), { [K1]: '500' }, {});
    expect(l).toEqual({ montoAxis: 500, sku: '02345-001', mpn: 'P1475-LE' });
    expect('montoIntcomex' in l).toBe(false);
  });

  test('editar solo Intcomex NO incluye montoAxis', () => {
    const [l] = construirPayloadMontos(orden(), {}, { [K1]: '600' });
    expect(l).toEqual({ montoIntcomex: 600, sku: '02345-001', mpn: 'P1475-LE' });
    expect('montoAxis' in l).toBe(false);
  });

  test('editar ambos incluye ambos, en una sola línea', () => {
    const r = construirPayloadMontos(orden(), { [K1]: '500' }, { [K1]: '600' });
    expect(r).toEqual([{ montoAxis: 500, montoIntcomex: 600, sku: '02345-001', mpn: 'P1475-LE' }]);
  });

  test('borrador vaciado va como null (borra el monto)', () => {
    const [l] = construirPayloadMontos(orden(), { [K1]: '' }, {});
    expect(l.montoAxis).toBeNull();
  });

  test('clave que ya no existe en la orden se descarta', () => {
    const r = construirPayloadMontos(orden(), { 'x||y': '1', [K2]: '7' }, {});
    expect(r).toEqual([{ montoAxis: 7, sku: '01234-001', mpn: 'M3086-V' }]);
  });

  test('sin borradores, array vacío', () => {
    expect(construirPayloadMontos(orden(), {}, {})).toEqual([]);
    expect(construirPayloadMontos(orden(), undefined, undefined)).toEqual([]);
  });
});

describe('aplicarMontosGuardados', () => {
  const ordenes = () => [orden(), { bo: 'BO2', lines: [{ ...L1 }] }];

  test('solo toca el BO indicado y las líneas del payload', () => {
    const entrada = ordenes();
    const r = aplicarMontosGuardados(entrada, 'BO1', [{ montoAxis: 500, sku: L1.sku, mpn: L1.mpn }]);
    expect(r[0].lines[0].montoAxis).toBe(500);
    expect(r[0].lines[1]).toBe(entrada[0].lines[1]);
    expect(r[1]).toBe(entrada[1]);
  });

  test('no pisa el otro monto si el payload trae uno solo', () => {
    const r = aplicarMontosGuardados(ordenes(), 'BO1', [{ montoIntcomex: 777, sku: L1.sku, mpn: L1.mpn }]);
    expect(r[0].lines[0].montoIntcomex).toBe(777);
    expect(r[0].lines[0].montoAxis).toBe(320.5);
  });

  test('un null explícito sí se aplica (monto borrado)', () => {
    const r = aplicarMontosGuardados(ordenes(), 'BO1', [{ montoAxis: null, sku: L1.sku, mpn: L1.mpn }]);
    expect(r[0].lines[0].montoAxis).toBeNull();
    expect(r[0].lines[0].montoIntcomex).toBe(410);
  });

  test('no muta la entrada', () => {
    const entrada = ordenes();
    const copia = JSON.parse(JSON.stringify(entrada));
    aplicarMontosGuardados(entrada, 'BO1', [{ montoAxis: 1, montoIntcomex: 2, sku: L1.sku, mpn: L1.mpn }]);
    expect(entrada).toEqual(copia);
  });

  test('orden sin lines no revienta', () => {
    const r = aplicarMontosGuardados([{ bo: 'BO1' }], 'BO1', []);
    expect(r).toEqual([{ bo: 'BO1', lines: [] }]);
  });
});

describe('fusionarAsignaciones', () => {
  test('mezcla como string sobre lo existente sin mutar prev', () => {
    const prev = { BO1: { a: '1' }, BO2: { z: '9' } };
    const next = fusionarAsignaciones(prev, 'BO1', { a: 5, b: 2.5 });
    expect(next).toEqual({ BO1: { a: '5', b: '2.5' }, BO2: { z: '9' } });
    expect(prev).toEqual({ BO1: { a: '1' }, BO2: { z: '9' } });
  });

  test('crea el BO si no existía', () => {
    expect(fusionarAsignaciones({}, 'BO1', { a: 1 })).toEqual({ BO1: { a: '1' } });
  });
});

describe('resumirLectura', () => {
  test('solo líneas completadas (singular y plural)', () => {
    expect(resumirLectura({ asignaciones: { a: 1 } })).toEqual({
      mensaje: '1 línea completada. Revisa antes de guardar.',
      tipo: 'ok'
    });
    expect(resumirLectura({ asignaciones: { a: 1, b: 2 } }).mensaje).toBe(
      '2 líneas completadas. Revisa antes de guardar.'
    );
  });

  test('leídas pero ninguna trae precio', () => {
    expect(resumirLectura({ sinMonto: ['x'] })).toEqual({
      mensaje:
        'Se leyeron 1 línea, pero ninguna trae precio. ' +
        '¿El archivo incluye montos? Si solo lista producto y cantidad, no hay nada que cargar.',
      tipo: 'error'
    });
    expect(resumirLectura({ sinMonto: ['x', 'y'] }).mensaje).toMatch(/^Se leyeron 2 líneas, pero/);
  });

  test('columna de precio solo para Excel y con columna', () => {
    expect(
      resumirLectura({ asignaciones: { a: 1 }, origen: 'excel', columnas: { monto: 'Precio Proyecto' } }).mensaje
    ).toBe('1 línea completada · precio tomado de «Precio Proyecto». Revisa antes de guardar.');
    expect(
      resumirLectura({ asignaciones: { a: 1 }, origen: 'pdf', columnas: { monto: 'P' } }).mensaje
    ).toBe('1 línea completada. Revisa antes de guardar.');
    expect(resumirLectura({ asignaciones: { a: 1 }, origen: 'excel', columnas: {} }).mensaje).toBe(
      '1 línea completada. Revisa antes de guardar.'
    );
  });

  test('todos los avisos juntos, en orden', () => {
    const r = resumirLectura({
      asignaciones: { a: 1 },
      origen: 'excel',
      columnas: { monto: 'Neto' },
      sinMonto: ['s1', 's2'],
      ambiguas: ['m'],
      lineasSinDato: ['l1', 'l2'],
      sinCalce: ['f']
    });
    expect(r).toEqual({
      mensaje:
        '1 línea completada · precio tomado de «Neto» · 2 líneas sin precio en el archivo · ' +
        '1 ambigua sin llenar · 2 líneas sin dato · 1 fila sin calce. Revisa antes de guardar.',
      tipo: 'ok'
    });
  });

  test('plurales de ambiguas, líneas sin dato y filas', () => {
    expect(
      resumirLectura({ asignaciones: { a: 1 }, ambiguas: [1, 2], lineasSinDato: [1], sinCalce: [1, 2, 3] }).mensaje
    ).toBe('1 línea completada · 2 ambiguas sin llenar · 1 línea sin dato · 3 filas sin calce. Revisa antes de guardar.');
  });

  test('sin asignaciones y sin sinMonto: 0 completadas y tipo error', () => {
    expect(resumirLectura({ sinCalce: [1] })).toEqual({
      mensaje: '0 líneas completadas · 1 fila sin calce. Revisa antes de guardar.',
      tipo: 'error'
    });
    expect(resumirLectura(undefined)).toEqual({
      mensaje: '0 líneas completadas. Revisa antes de guardar.',
      tipo: 'error'
    });
  });
});

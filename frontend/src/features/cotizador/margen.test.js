import { estadoMargen, leerConfigMargen, marcaDe, MARGEN_DEFAULTS, umbralesPara } from './margen';
import { validarBorrador } from './SemaforoMargenAjustes';

describe('ajustes del semaforo', () => {
  const borrador = (qnap, axis) => ({ QNAP: qnap, AXIS: axis });

  test('acepta subir o bajar el minimo mientras no pase el objetivo', () => {
    expect(validarBorrador(borrador({ objetivo: '15', piso: '8' }, { objetivo: '13', piso: '12,5' }))).toBeNull();
  });

  test('rechaza un minimo mayor que el objetivo', () => {
    expect(validarBorrador(borrador({ objetivo: '15', piso: '16' }, { objetivo: '13', piso: '10' }))).toMatch(/QNAP: el mínimo aceptable/);
  });

  test('rechaza campos vacios o fuera de rango', () => {
    expect(validarBorrador(borrador({ objetivo: '', piso: '10' }, { objetivo: '13', piso: '10' }))).toMatch(/objetivo/);
    expect(validarBorrador(borrador({ objetivo: '15', piso: '10' }, { objetivo: '100', piso: '10' }))).toMatch(/AXIS/);
  });
});

describe('semaforo de margen', () => {
  const config = { QNAP: { objetivo: 15, piso: 10 }, AXIS: { objetivo: 13, piso: 8 } };

  test('objetivo, bajo objetivo y bajo piso por marca', () => {
    expect(estadoMargen(15, 'QNAP', config)).toBe('ok');
    expect(estadoMargen(14.999, 'QNAP', config)).toBe('ok');
    expect(estadoMargen(12, 'QNAP', config)).toBe('bajo_objetivo');
    expect(estadoMargen(9, 'QNAP', config)).toBe('bajo_piso');
    expect(estadoMargen(13, 'AXIS', config)).toBe('ok');
    expect(estadoMargen(9, 'AXIS', config)).toBe('bajo_objetivo');
  });

  test('sin costo no hay estado', () => {
    expect(estadoMargen(null, 'QNAP', config)).toBeNull();
  });

  test('un total mixto usa la marca mas exigente', () => {
    expect(umbralesPara(['QNAP', 'AXIS'], config)).toEqual({ objetivo: 15, piso: 10 });
    expect(estadoMargen(14, ['AXIS', 'QNAP'], config)).toBe('bajo_objetivo');
  });

  test('los valores por defecto son 15 % QNAP y 13 % AXIS', () => {
    expect(MARGEN_DEFAULTS.QNAP.objetivo).toBe(15);
    expect(MARGEN_DEFAULTS.AXIS.objetivo).toBe(13);
  });
});

describe('semaforo de margen: quotes', () => {
  const config = {
    QNAP: { objetivo: 15, piso: 10 },
    AXIS: { objetivo: 13, piso: 8 },
    QUOTE: { objetivo: 8, piso: 5 }
  };

  test('los valores por defecto de las quotes son objetivo 8 % y mínimo 5 %', () => {
    expect(MARGEN_DEFAULTS.QUOTE).toEqual({ objetivo: 8, piso: 5 });
  });

  test('marcaDe manda los cuatro orígenes de quote a QUOTE y deja AXIS y QNAP como estaban', () => {
    for (const origen of ['ISS', 'NEURAL', 'VAIDIO', 'MILESTONE', 'MILESTONE_HW', 'iss', ' vaidio ']) expect(marcaDe(origen)).toBe('QUOTE');
    expect(marcaDe('AXIS')).toBe('AXIS');
    expect(marcaDe('QNAP')).toBe('QNAP');
    expect(marcaDe(undefined)).toBe('QNAP');
  });

  test('Velasea se mide con los umbrales de QNAP (se cotiza con su margen)', () => {
    expect(marcaDe('VELASEA')).toBe('QNAP');
    expect(marcaDe(' velasea ')).toBe('QNAP');
    expect(estadoMargen(15, 'VELASEA', MARGEN_DEFAULTS)).toBe('ok');
    expect(estadoMargen(8, 'VELASEA', MARGEN_DEFAULTS)).toBe('bajo_piso');
    expect(estadoMargen(8, 'ISS', MARGEN_DEFAULTS)).toBe('ok');
  });

  test('una línea de quote al 8 % está en objetivo, no bajo el piso', () => {
    expect(estadoMargen(8, 'ISS', config)).toBe('ok');
    expect(estadoMargen(8, 'MILESTONE_HW', config)).toBe('ok');
    expect(estadoMargen(6, 'NEURAL', config)).toBe('bajo_objetivo');
    expect(estadoMargen(4, 'MILESTONE', config)).toBe('bajo_piso');
    // el mismo 8 % en una línea QNAP sí está bajo el piso
    expect(estadoMargen(8, 'QNAP', config)).toBe('bajo_piso');
  });

  test('por línea cuenta la marca de ESA línea', () => {
    expect(estadoMargen(8, 'ISS', config)).toBe('ok');
    expect(estadoMargen(8, 'AXIS', config)).toBe('bajo_objetivo'); // piso 8, objetivo 13
  });

  test('un total mixto QNAP + quote usa el más exigente de los presentes (el de QNAP)', () => {
    expect(umbralesPara(['QNAP', 'ISS'], config)).toEqual({ objetivo: 15, piso: 10 });
    // 9 % de un carrito mixto sale bajo el piso aunque las líneas de quote al 8 % estén bien
    expect(estadoMargen(9, ['QNAP', 'ISS'], config)).toBe('bajo_piso');
    // un carrito solo de quotes usa los umbrales de quote
    expect(umbralesPara(['ISS', 'NEURAL'], config)).toEqual({ objetivo: 8, piso: 5 });
    expect(estadoMargen(8, ['ISS', 'MILESTONE'], config)).toBe('ok');
  });

  test('una configuración sin QUOTE (guardada antes) usa el default de quotes', () => {
    const antigua = { QNAP: { objetivo: 15, piso: 10 }, AXIS: { objetivo: 13, piso: 10 } };
    expect(estadoMargen(8, 'ISS', antigua)).toBe('ok');
    expect(umbralesPara(['ISS'], antigua)).toEqual({ objetivo: 8, piso: 5 });
  });

  test('leerConfigMargen completa con el default una configuración guardada sin QUOTE', () => {
    localStorage.setItem('margenConfig', JSON.stringify({ QNAP: { objetivo: 20, piso: 12 }, AXIS: { objetivo: 14, piso: 9 } }));
    const leida = leerConfigMargen();
    expect(leida.QNAP).toEqual({ objetivo: 20, piso: 12 });
    expect(leida.QUOTE).toEqual({ objetivo: 8, piso: 5 });
    localStorage.removeItem('margenConfig');
  });

  test('validarBorrador revisa también la fila de quotes', () => {
    const fila = { QNAP: { objetivo: '15', piso: '10' }, AXIS: { objetivo: '13', piso: '10' } };
    expect(validarBorrador({ ...fila, QUOTE: { objetivo: '8', piso: '5' } })).toBeNull();
    expect(validarBorrador({ ...fila, QUOTE: { objetivo: '8', piso: '9' } })).toMatch(/Quotes/);
  });
});


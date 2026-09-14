import { estadoMargen, MARGEN_DEFAULTS, umbralesPara } from './margen';
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

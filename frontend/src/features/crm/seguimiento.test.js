import {
  ATAJOS_SEGUIMIENTO, aDiaHabil, diasHasta, esFechaValida, fechaCorta, fechaDeAtajo, hoyLocal,
  pasaFiltroSeguimiento, resumenSeguimiento, sumarDias, textoSeguimiento, urgencia, urgenciaDeOportunidad
} from './seguimiento';

// 2026-11-19 es jueves.
const HOY = '2026-11-19';

describe('fechas', () => {
  test('esFechaValida acepta solo fechas reales en formato YYYY-MM-DD', () => {
    expect(esFechaValida('2026-11-19')).toBe(true);
    expect(esFechaValida('2028-02-29')).toBe(true);
    for (const mala of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '19-11-2026', '2026-11-19T10:00:00Z', '', null, undefined, 20261119]) {
      expect(esFechaValida(mala)).toBe(false);
    }
  });

  test('hoyLocal usa el día del reloj local, no el de UTC', () => {
    expect(hoyLocal(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
    expect(hoyLocal(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  test('sumarDias cruza meses, años y el cambio de hora sin correrse', () => {
    expect(sumarDias('2026-11-28', 3)).toBe('2026-12-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    // Chile cambia la hora en abril y en septiembre: sumar de a un día no debe saltarse ninguno.
    let fecha = '2026-01-01';
    for (let i = 0; i < 365; i += 1) fecha = sumarDias(fecha, 1);
    expect(fecha).toBe('2027-01-01');
    expect(sumarDias('no es fecha', 1)).toBeNull();
  });

  test('diasHasta', () => {
    expect(diasHasta(HOY, HOY)).toBe(0);
    expect(diasHasta('2026-11-20', HOY)).toBe(1);
    expect(diasHasta('2026-11-16', HOY)).toBe(-3);
    expect(diasHasta('2027-11-19', HOY)).toBe(365);
    expect(diasHasta(null, HOY)).toBeNull();
    expect(diasHasta('2026-02-30', HOY)).toBeNull();
  });
});

describe('urgencia', () => {
  test('vencido, hoy, mañana, futuro y sin fecha', () => {
    expect(urgencia('2026-11-18', HOY)).toBe('vencido');
    expect(urgencia('2020-01-01', HOY)).toBe('vencido');
    expect(urgencia(HOY, HOY)).toBe('hoy');
    expect(urgencia('2026-11-20', HOY)).toBe('manana');
    expect(urgencia('2026-11-21', HOY)).toBe('futuro');
    expect(urgencia(null, HOY)).toBe('sin');
    expect(urgencia('', HOY)).toBe('sin');
    expect(urgencia('basura', HOY)).toBe('sin');
  });

  test('una oportunidad ganada o perdida ya no se sigue', () => {
    expect(urgenciaDeOportunidad({ etapa: 'cotizada', proximo_seguimiento: '2026-11-18' }, HOY)).toBe('vencido');
    expect(urgenciaDeOportunidad({ etapa: 'nueva', proximo_seguimiento: null }, HOY)).toBe('sin');
    expect(urgenciaDeOportunidad({ etapa: 'ganada', proximo_seguimiento: '2026-11-18' }, HOY)).toBe('cerrada');
    expect(urgenciaDeOportunidad({ etapa: 'perdida' }, HOY)).toBe('cerrada');
    expect(urgenciaDeOportunidad(null, HOY)).toBe('cerrada');
  });
});

describe('textos', () => {
  test('textoSeguimiento', () => {
    expect(textoSeguimiento(null, HOY)).toBe('Sin seguimiento');
    expect(textoSeguimiento(HOY, HOY)).toBe('Hoy');
    expect(textoSeguimiento('2026-11-20', HOY)).toBe('Mañana');
    expect(textoSeguimiento('2026-11-18', HOY)).toBe('Vencido ayer');
    expect(textoSeguimiento('2026-11-16', HOY)).toBe('Vencido hace 3 días');
    expect(textoSeguimiento('2026-11-24', HOY)).toBe('24-nov');
    expect(textoSeguimiento('2027-01-05', HOY)).toBe('05-ene-2027');
  });

  test('fechaCorta', () => {
    expect(fechaCorta('2026-12-02', HOY)).toBe('02-dic');
    expect(fechaCorta('2025-12-02', HOY)).toBe('02-dic-2025');
    expect(fechaCorta('nada', HOY)).toBe('');
  });
});

describe('atajos', () => {
  test('desde un jueves: hoy, mañana (viernes), +3 días (domingo -> lunes), +1 semana (jueves)', () => {
    expect(ATAJOS_SEGUIMIENTO.map((a) => a.clave)).toEqual(['hoy', 'manana', '3d', '1s']);
    expect(fechaDeAtajo('hoy', HOY)).toBe('2026-11-19');
    expect(fechaDeAtajo('manana', HOY)).toBe('2026-11-20');
    expect(fechaDeAtajo('3d', HOY)).toBe('2026-11-23');
    expect(fechaDeAtajo('1s', HOY)).toBe('2026-11-26');
    expect(fechaDeAtajo('otro', HOY)).toBeNull();
  });

  test('"Hoy" es hoy aunque sea sábado; "Mañana" un viernes o un sábado es el lunes', () => {
    expect(fechaDeAtajo('hoy', '2026-11-21')).toBe('2026-11-21');
    expect(fechaDeAtajo('manana', '2026-11-20')).toBe('2026-11-23');
    expect(fechaDeAtajo('manana', '2026-11-21')).toBe('2026-11-23');
    expect(fechaDeAtajo('1s', '2026-11-21')).toBe('2026-11-30');
  });

  test('aDiaHabil', () => {
    expect(aDiaHabil('2026-11-21')).toBe('2026-11-23');
    expect(aDiaHabil('2026-11-22')).toBe('2026-11-23');
    expect(aDiaHabil('2026-11-23')).toBe('2026-11-23');
    expect(aDiaHabil('x')).toBeNull();
  });
});

describe('filtros y resumen', () => {
  const ops = [
    { id: 1, etapa: 'cotizada', monto: 100.1, proximo_seguimiento: '2026-11-16' },
    { id: 2, etapa: 'negociacion', monto: 200.2, proximo_seguimiento: HOY },
    { id: 3, etapa: 'nueva', monto: 50, proximo_seguimiento: '2026-11-20' },
    { id: 4, etapa: 'cotizada', monto: 70, proximo_seguimiento: '2026-11-26' },
    { id: 5, etapa: 'cotizada', monto: 30, proximo_seguimiento: '2026-11-27' },
    { id: 6, etapa: 'nueva', monto: '40.5', proximo_seguimiento: null },
    { id: 7, etapa: 'ganada', monto: 9999, proximo_seguimiento: '2026-11-01' },
    { id: 8, etapa: 'perdida', monto: 9999, proximo_seguimiento: null }
  ];
  const pasan = (filtro) => ops.filter((o) => pasaFiltroSeguimiento(o, filtro, HOY)).map((o) => o.id);

  test('cada filtro deja pasar lo suyo; las cerradas solo pasan "Todas"', () => {
    expect(pasan('')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pasan('vencido')).toEqual([1]);
    expect(pasan('hoy')).toEqual([2]);
    // De hoy a 7 días: hoy, mañana y el jueves siguiente; el 27 queda fuera.
    expect(pasan('semana')).toEqual([2, 3, 4]);
    expect(pasan('sin')).toEqual([6]);
  });

  test('el resumen cuenta y suma sin errores de decimales, sin las cerradas', () => {
    expect(resumenSeguimiento(ops, HOY)).toEqual({
      vencido: { cantidad: 1, monto: 100.1 },
      hoy: { cantidad: 1, monto: 200.2 },
      semana: { cantidad: 3, monto: 320.2 },
      sin: { cantidad: 1, monto: 40.5 }
    });
    expect(resumenSeguimiento(undefined, HOY).vencido).toEqual({ cantidad: 0, monto: 0 });
  });
});

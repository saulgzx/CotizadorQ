const { crearCalendario, fechaChile, minutosChile, instanteChile, sumarDiasHabiles, esHabil } = require('../src/seguimiento/calendario');
const { FERIADOS, leerFeriados, leerFeriadosExtra } = require('../src/seguimiento/feriados');
const { cl } = require('./helpers/seguimientoFalso');

const cal = crearCalendario({ feriados: leerFeriados({}) });

describe('feriados de Chile', () => {
  test('2026 y 2027 tienen los feriados nacionales y ninguno repetido', () => {
    for (const anio of [2026, 2027]) {
      const fechas = FERIADOS[anio].map(([f]) => f);
      expect(new Set(fechas).size).toBe(fechas.length);
      expect(fechas.every((f) => f.startsWith(String(anio)))).toBe(true);
      expect(fechas.length).toBeGreaterThanOrEqual(16);
    }
  });

  test('trasladables 2027 según la Ley 19.668 (al lunes)', () => {
    const f2027 = FERIADOS[2027].map(([f]) => f);
    expect(f2027).toContain('2027-06-28'); // San Pedro y San Pablo (29 cae martes)
    expect(f2027).toContain('2027-10-11'); // Encuentro de Dos Mundos (12 cae martes)
    expect(f2027).not.toContain('2027-06-29');
    expect(f2027).not.toContain('2027-10-12');
  });

  test('FERIADOS_EXTRA agrega fechas ISO válidas e ignora basura', () => {
    expect(leerFeriadosExtra({ FERIADOS_EXTRA: '2026-12-31, nada,2027-13-01,2027-01-02' })).toEqual(['2026-12-31', '2027-01-02']);
    const conExtra = crearCalendario({ feriados: leerFeriados({ FERIADOS_EXTRA: '2026-11-12' }) });
    expect(conExtra.esHabil('2026-11-12')).toBe(false);
    expect(cal.esHabil('2026-11-12')).toBe(true);
  });
});

describe('calendario hábil', () => {
  test('fines de semana y feriados no son hábiles', () => {
    expect(cal.esHabil('2026-11-13')).toBe(true); // viernes
    expect(cal.esHabil('2026-11-14')).toBe(false); // sábado
    expect(cal.esHabil('2026-11-15')).toBe(false); // domingo
    expect(cal.esHabil('2026-12-08')).toBe(false); // Inmaculada Concepción (martes)
    expect(cal.esHabil('2026-09-18')).toBe(false);
  });

  test('la fecha se toma en hora de Chile, no en UTC', () => {
    const viernesNoche = cl('2026-11-13 22:30'); // en UTC ya es sábado
    expect(viernesNoche.toISOString().slice(0, 10)).toBe('2026-11-14');
    expect(fechaChile(viernesNoche)).toBe('2026-11-13');
    expect(cal.esHabil(viernesNoche)).toBe(true);
  });

  test('viernes + 1 hábil = lunes, conservando la hora local', () => {
    const r = cal.sumarDiasHabiles(cl('2026-11-13 10:15'), 1);
    expect(fechaChile(r)).toBe('2026-11-16');
    expect(minutosChile(r)).toBe(10 * 60 + 15);
  });

  test('salta un feriado en medio de la semana', () => {
    // lunes 7-dic + 3 hábiles: mar 8 es feriado -> mié 9, jue 10, vie 11
    expect(fechaChile(cal.sumarDiasHabiles(cl('2026-12-07 09:00'), 3))).toBe('2026-12-11');
  });

  test('Fiestas Patrias 2026 (viernes 18 y sábado 19)', () => {
    expect(fechaChile(cal.sumarDiasHabiles(cl('2026-09-17 12:00'), 1))).toBe('2026-09-21');
  });

  test('desde un sábado, el 1er día hábil es el lunes', () => {
    expect(fechaChile(cal.sumarDiasHabiles(cl('2026-11-14 11:00'), 1))).toBe('2026-11-16');
  });

  test('cruza el fin del horario de verano (abril) y el inicio (septiembre) sin perder la hora', () => {
    // Chile pasa de UTC-3 a UTC-4 el 5-abr-2026 y de UTC-4 a UTC-3 el 6-sep-2026.
    const abril = cal.sumarDiasHabiles(cl('2026-04-02 08:00'), 2); // jue 2 -> (vie 3 Santo) lun 6, mar 7
    expect(fechaChile(abril)).toBe('2026-04-07');
    expect(minutosChile(abril)).toBe(8 * 60);
    expect(cl('2026-04-02 08:00').getTime() % 3600000).toBe(0);

    const septiembre = cal.sumarDiasHabiles(cl('2026-09-04 08:00'), 1);
    expect(fechaChile(septiembre)).toBe('2026-09-07');
    expect(minutosChile(septiembre)).toBe(8 * 60);
    // La diferencia UTC es 1 hora menos que 3 días exactos.
    expect(septiembre.getTime() - cl('2026-09-04 08:00').getTime()).toBe(3 * 24 * 3600000 - 3600000);
  });

  test('una hora inexistente por el cambio de horario se corre hacia adelante', () => {
    // 6-sep-2026: 00:00 pasa a 01:00
    const r = instanteChile('2026-09-06', 0, 30);
    expect(fechaChile(r)).toBe('2026-09-06');
    expect(minutosChile(r)).toBeGreaterThanOrEqual(60);
  });

  test('diasHabilesEntre cuenta los días hábiles transcurridos', () => {
    expect(cal.diasHabilesEntre(cl('2026-11-13 17:00'), cl('2026-11-16 09:00'))).toBe(1);
    expect(cal.diasHabilesEntre(cl('2026-11-16 09:00'), cl('2026-11-16 18:00'))).toBe(0);
    expect(cal.diasHabilesEntre(cl('2026-12-07 09:00'), cl('2026-12-11 09:00'))).toBe(3);
  });

  test('funciones con el calendario por defecto', () => {
    expect(esHabil('2026-11-11')).toBe(true);
    expect(fechaChile(sumarDiasHabiles(cl('2026-11-11 10:00'), 2))).toBe('2026-11-13');
  });
});

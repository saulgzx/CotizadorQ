// Feriados nacionales de Chile usados por el calendario hábil del seguimiento.
//
// Solo feriados NACIONALES (no regionales como Arica 7-jun o Chillán 20-ago).
// Los trasladables ya están en la fecha en que se goza el feriado:
// - Ley 19.668 (San Pedro y San Pablo, Encuentro de Dos Mundos): si cae martes,
//   miércoles o jueves se corre al lunes de esa semana; si cae viernes, al lunes siguiente.
// - Ley 20.299/20.663 (Iglesias Evangélicas, 31-oct): si cae martes pasa al viernes 27;
//   si cae miércoles, al viernes 2-nov.
// - Ley 21.357 (Pueblos Indígenas): el día del solsticio de invierno (lo fija un decreto).
// - Ley 20.215: 17-sep es feriado si cae lunes y 20-sep si cae viernes.
// Si se agregan feriados nuevos (elecciones, leyes especiales), usar FERIADOS_EXTRA
// (fechas ISO separadas por coma) o agregarlos aquí.

const FERIADOS = {
  2026: [
    ['2026-01-01', 'Año Nuevo'],
    ['2026-04-03', 'Viernes Santo'],
    ['2026-04-04', 'Sábado Santo'],
    ['2026-05-01', 'Día del Trabajo'],
    ['2026-05-21', 'Día de las Glorias Navales'],
    ['2026-06-21', 'Día Nacional de los Pueblos Indígenas'], // domingo (solsticio 21-jun 04:24 Chile)
    ['2026-06-29', 'San Pedro y San Pablo'], // lunes, no se traslada
    ['2026-07-16', 'Virgen del Carmen'],
    ['2026-08-15', 'Asunción de la Virgen'],
    ['2026-09-18', 'Independencia Nacional'],
    ['2026-09-19', 'Glorias del Ejército'],
    ['2026-10-12', 'Encuentro de Dos Mundos'], // lunes, no se traslada
    ['2026-10-31', 'Día de las Iglesias Evangélicas y Protestantes'], // sábado
    ['2026-11-01', 'Día de Todos los Santos'],
    ['2026-12-08', 'Inmaculada Concepción'],
    ['2026-12-25', 'Navidad']
  ],
  2027: [
    ['2027-01-01', 'Año Nuevo'],
    ['2027-03-26', 'Viernes Santo'], // Pascua 28-mar-2027
    ['2027-03-27', 'Sábado Santo'],
    ['2027-05-01', 'Día del Trabajo'],
    ['2027-05-21', 'Día de las Glorias Navales'],
    // verificar: solsticio 21-jun-2027 10:11 hora de Chile; la fecha la fija el decreto anual.
    ['2027-06-21', 'Día Nacional de los Pueblos Indígenas'],
    ['2027-06-28', 'San Pedro y San Pablo'], // 29-jun cae martes -> lunes 28 (Ley 19.668)
    ['2027-07-16', 'Virgen del Carmen'],
    ['2027-08-15', 'Asunción de la Virgen'],
    // 18 y 19 de septiembre caen sábado y domingo; la Ley 20.215 no agrega el viernes 17.
    // verificar: en años así a veces se dicta una ley especial que declara feriado el 17.
    ['2027-09-18', 'Independencia Nacional'],
    ['2027-09-19', 'Glorias del Ejército'],
    ['2027-10-11', 'Encuentro de Dos Mundos'], // 12-oct cae martes -> lunes 11 (Ley 19.668)
    ['2027-10-31', 'Día de las Iglesias Evangélicas y Protestantes'], // domingo
    ['2027-11-01', 'Día de Todos los Santos'],
    ['2027-12-08', 'Inmaculada Concepción'],
    ['2027-12-25', 'Navidad']
  ]
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Fechas extra desde FERIADOS_EXTRA ("2026-12-31,2027-01-02"). Ignora lo que no sea ISO. */
const leerFeriadosExtra = (env = process.env) =>
  String(env.FERIADOS_EXTRA || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));

/** Set de fechas ISO (YYYY-MM-DD) que no son hábiles por feriado. */
const leerFeriados = (env = process.env) =>
  new Set([
    ...Object.values(FERIADOS).flat().map(([fecha]) => fecha),
    ...leerFeriadosExtra(env)
  ]);

module.exports = { FERIADOS, leerFeriados, leerFeriadosExtra };

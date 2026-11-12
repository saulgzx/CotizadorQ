// Calendario hábil de Chile (lunes a viernes sin feriados nacionales), en hora local
// America/Santiago. Todas las funciones reciben y devuelven Date (instantes UTC); la
// "fecha" de un instante es su día calendario en Chile, así que un correo enviado el
// viernes 22:30 de Chile cuenta como viernes aunque en UTC ya sea sábado.

const { leerFeriados } = require('./feriados');

const ZONA = 'America/Santiago';
const DIA_MS = 24 * 60 * 60 * 1000;

const formato = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

/** Partes de la hora local de Chile de un instante. */
const partesChile = (fecha) => {
  const p = {};
  for (const { type, value } of formato.formatToParts(new Date(fecha))) p[type] = value;
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second)
  };
};

const pad = (n) => String(n).padStart(2, '0');
const isoDe = ({ anio, mes, dia }) => `${anio}-${pad(mes)}-${pad(dia)}`;

/** Día calendario en Chile, "YYYY-MM-DD". */
const fechaChile = (fecha) => isoDe(partesChile(fecha));

/** Minutos desde la medianoche en hora de Chile. */
const minutosChile = (fecha) => {
  const p = partesChile(fecha);
  return p.hora * 60 + p.minuto;
};

/** 0 = domingo ... 6 = sábado, para un día ISO (independiente de la zona). */
const diaSemanaIso = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

const sumarDiasIso = (iso, n) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

/**
 * Instante UTC de una hora local de Chile. Si la hora no existe (salto del cambio de
 * horario) se corre hacia adelante; si existe dos veces, se toma la primera.
 */
const instanteChile = (iso, hora = 0, minuto = 0, segundo = 0) => {
  const [anio, mes, dia] = iso.split('-').map(Number);
  const objetivo = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo);
  let t = objetivo + 4 * 60 * 60 * 1000; // Chile es UTC-3 o UTC-4: arranca cerca
  for (let i = 0; i < 3; i += 1) {
    const p = partesChile(t);
    const visto = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
    if (visto === objetivo) break;
    t += objetivo - visto;
  }
  const p = partesChile(t);
  const visto = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // En el salto de primavera la hora pedida no existe: queda corrida hacia adelante.
  if (visto < objetivo) t += objetivo - visto;
  // En el retroceso de otoño, preferir la primera ocurrencia.
  const antes = t - 60 * 60 * 1000;
  const pa = partesChile(antes);
  if (Date.UTC(pa.anio, pa.mes - 1, pa.dia, pa.hora, pa.minuto, pa.segundo) === objetivo) t = antes;
  return new Date(t);
};

const crearCalendario = ({ feriados = leerFeriados() } = {}) => {
  const esHabilIso = (iso) => {
    const d = diaSemanaIso(iso);
    return d !== 0 && d !== 6 && !feriados.has(iso);
  };

  /** ¿El día (en Chile) de este instante es hábil? Acepta Date, número o "YYYY-MM-DD". */
  const esHabil = (fecha) =>
    esHabilIso(typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : fechaChile(fecha));

  /** Día hábil n posiciones después del día iso (n >= 0; con n = 0 devuelve el mismo día). */
  const sumarDiasHabilesIso = (iso, n) => {
    let actual = iso;
    let restantes = n;
    while (restantes > 0) {
      actual = sumarDiasIso(actual, 1);
      if (esHabilIso(actual)) restantes -= 1;
    }
    return actual;
  };

  /**
   * Suma n días hábiles conservando la hora local de Chile. Un inicio en día no hábil
   * cuenta desde ese día: sábado + 1 hábil = lunes.
   */
  const sumarDiasHabiles = (fecha, n) => {
    const p = partesChile(fecha);
    return instanteChile(sumarDiasHabilesIso(isoDe(p), n), p.hora, p.minuto, p.segundo);
  };

  /** Días hábiles completos que pasaron entre dos instantes (cuenta los días de b, no los de a). */
  const diasHabilesEntre = (a, b) => {
    let desde = fechaChile(a);
    const hasta = fechaChile(b);
    if (desde >= hasta) return 0;
    let n = 0;
    while (desde < hasta) {
      desde = sumarDiasIso(desde, 1);
      if (esHabilIso(desde)) n += 1;
    }
    return n;
  };

  /** Instante de la hora local hh:mm del mismo día (en Chile) que `fecha`. */
  const aLaHora = (fecha, hora, minuto = 0) => instanteChile(fechaChile(fecha), hora, minuto);

  /** Último día hábil anterior al día de `fecha`. */
  const habilAnterior = (fecha) => {
    let iso = sumarDiasIso(fechaChile(fecha), -1);
    while (!esHabilIso(iso)) iso = sumarDiasIso(iso, -1);
    return iso;
  };

  return {
    zona: ZONA,
    esHabil,
    esHabilIso,
    sumarDiasHabiles,
    sumarDiasHabilesIso,
    diasHabilesEntre,
    aLaHora,
    habilAnterior,
    fechaChile,
    minutosChile,
    partesChile,
    instanteChile,
    diaSemana: (fecha) => diaSemanaIso(fechaChile(fecha)),
    sumarDiasIso
  };
};

// Calendario con los feriados del archivo + FERIADOS_EXTRA del entorno al cargar.
let porDefecto = null;
const calendario = () => {
  if (!porDefecto) porDefecto = crearCalendario();
  return porDefecto;
};

module.exports = {
  ZONA,
  crearCalendario,
  calendario,
  sumarDiasHabiles: (fecha, n) => calendario().sumarDiasHabiles(fecha, n),
  esHabil: (fecha) => calendario().esHabil(fecha),
  fechaChile,
  minutosChile,
  partesChile,
  instanteChile,
  sumarDiasIso,
  diaSemanaIso
};

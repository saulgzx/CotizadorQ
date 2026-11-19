// Seguimiento manual de una oportunidad: la fecha en que hay que volver a tocarla y una nota
// corta de qué hacer. Módulo puro (sin React ni red): aquí viven las reglas de fechas que
// comparten el mapa de tarjetas, la tabla y el panel de la oportunidad.
//
// Campos de la oportunidad: `proximo_seguimiento` ('YYYY-MM-DD' o null) y `seguimiento_nota`
// (texto o null). Son fechas de calendario, sin hora: "hoy" es el día local de quien mira.
// Todas las cuentas se hacen en UTC a medianoche para que el cambio de hora no corra un día.

export const LARGO_NOTA_SEGUIMIENTO = 300;

/** Etapas en que el seguimiento tiene sentido; al ganar o perder se limpia. */
export const ETAPAS_CON_SEGUIMIENTO = ['nueva', 'cotizada', 'negociacion'];

const DIA_MS = 24 * 60 * 60 * 1000;
const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dos = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' -> milisegundos UTC a medianoche, o null si no es una fecha real. */
const aUtc = (fecha) => {
  const m = FORMATO.exec(String(fecha ?? '').trim());
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(anio, mes - 1, dia);
  const d = new Date(t);
  // 2026-02-31 no existe: Date lo correría a marzo.
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? t : null;
};

const deUtc = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
};

export const esFechaValida = (fecha) => aUtc(fecha) !== null;

/** El día de hoy según el reloj local, como 'YYYY-MM-DD'. */
export const hoyLocal = (ahora = new Date()) =>
  `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;

/** Fecha más `dias` días de calendario (pueden ser negativos). null si la fecha no vale. */
export const sumarDias = (fecha, dias) => {
  const t = aUtc(fecha);
  return t === null ? null : deUtc(t + Math.round(Number(dias) || 0) * DIA_MS);
};

/** Días desde `hoy` hasta `fecha`: negativo = vencido, 0 = hoy. null sin fecha válida. */
export const diasHasta = (fecha, hoy = hoyLocal()) => {
  const a = aUtc(fecha);
  const b = aUtc(hoy);
  return a === null || b === null ? null : Math.round((a - b) / DIA_MS);
};

/**
 * Urgencia de una fecha de seguimiento:
 * 'vencido' (antes de hoy) · 'hoy' · 'manana' · 'futuro' (pasado mañana o después) · 'sin'.
 */
export const urgencia = (fecha, hoy = hoyLocal()) => {
  const dias = diasHasta(fecha, hoy);
  if (dias === null) return 'sin';
  if (dias < 0) return 'vencido';
  if (dias === 0) return 'hoy';
  return dias === 1 ? 'manana' : 'futuro';
};

/** Urgencia de una oportunidad: una ganada o perdida ya no se sigue ('cerrada'). */
export const urgenciaDeOportunidad = (op, hoy = hoyLocal()) =>
  ETAPAS_CON_SEGUIMIENTO.includes(op?.etapa) ? urgencia(op?.proximo_seguimiento, hoy) : 'cerrada';

/** Qué tono visual lleva cada urgencia (los nombres de los puntos `mq-punto-*` del sistema). */
export const TONO_URGENCIA = Object.freeze({
  vencido: 'critico',
  hoy: 'aviso',
  manana: 'aviso',
  futuro: 'ok',
  sin: 'neutro',
  cerrada: 'neutro'
});

export const NOMBRE_URGENCIA = Object.freeze({
  vencido: 'Vencido',
  hoy: 'Hoy',
  manana: 'Mañana',
  futuro: 'Más adelante',
  sin: 'Sin seguimiento',
  cerrada: 'Cerrada'
});

/** '2026-11-24' -> '24-nov' (con el año si no es el de `hoy`: '05-ene-2027'). */
export const fechaCorta = (fecha, hoy = hoyLocal()) => {
  const t = aUtc(fecha);
  if (t === null) return '';
  const d = new Date(t);
  const base = `${dos(d.getUTCDate())}-${MESES[d.getUTCMonth()]}`;
  return String(hoy).slice(0, 4) === String(d.getUTCFullYear()) ? base : `${base}-${d.getUTCFullYear()}`;
};

/** Texto del seguimiento para una tarjeta o una celda. */
export const textoSeguimiento = (fecha, hoy = hoyLocal()) => {
  const dias = diasHasta(fecha, hoy);
  if (dias === null) return 'Sin seguimiento';
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  if (dias === -1) return 'Vencido ayer';
  if (dias < 0) return `Vencido hace ${-dias} días`;
  return fechaCorta(fecha, hoy);
};

/** Un sábado o domingo pasa al lunes: nadie hace seguimiento comercial el fin de semana. */
export const aDiaHabil = (fecha) => {
  const t = aUtc(fecha);
  if (t === null) return null;
  const dia = new Date(t).getUTCDay();
  return deUtc(t + (dia === 6 ? 2 : dia === 0 ? 1 : 0) * DIA_MS);
};

/** Atajos para fijar la fecha sin abrir el calendario. */
export const ATAJOS_SEGUIMIENTO = Object.freeze([
  Object.freeze({ clave: 'hoy', nombre: 'Hoy', dias: 0 }),
  Object.freeze({ clave: 'manana', nombre: 'Mañana', dias: 1 }),
  Object.freeze({ clave: '3d', nombre: '+3 días', dias: 3 }),
  Object.freeze({ clave: '1s', nombre: '+1 semana', dias: 7 })
]);

/**
 * Fecha que fija un atajo. "Hoy" es hoy aunque sea fin de semana (lo pidió quien está
 * trabajando); los demás, si caen sábado o domingo, pasan al lunes. null si el atajo no existe.
 */
export const fechaDeAtajo = (clave, hoy = hoyLocal()) => {
  const atajo = ATAJOS_SEGUIMIENTO.find((a) => a.clave === clave);
  if (!atajo) return null;
  const fecha = sumarDias(hoy, atajo.dias);
  return atajo.dias === 0 ? fecha : aDiaHabil(fecha);
};

/** Filtros rápidos por seguimiento. "Esta semana" = de hoy a 7 días, sin los vencidos. */
export const FILTROS_SEGUIMIENTO = Object.freeze([
  Object.freeze({ clave: '', nombre: 'Todas' }),
  Object.freeze({ clave: 'vencido', nombre: 'Vencidas' }),
  Object.freeze({ clave: 'hoy', nombre: 'Hoy' }),
  Object.freeze({ clave: 'semana', nombre: 'Esta semana' }),
  Object.freeze({ clave: 'sin', nombre: 'Sin seguimiento' })
]);

/** ¿La oportunidad pasa el filtro? Una cerrada solo pasa el filtro vacío ("Todas"). */
export const pasaFiltroSeguimiento = (op, filtro, hoy = hoyLocal()) => {
  if (!filtro) return true;
  const u = urgenciaDeOportunidad(op, hoy);
  if (u === 'cerrada') return false;
  if (filtro === 'semana') {
    const dias = diasHasta(op?.proximo_seguimiento, hoy);
    return dias !== null && dias >= 0 && dias <= 7;
  }
  return u === filtro;
};

const centavos = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Cuántas oportunidades y cuánta plata hay en cada filtro rápido, sobre la lista que se le pase
 * (las cerradas no cuentan). -> { vencido, hoy, semana, sin }, cada uno { cantidad, monto }.
 */
export const resumenSeguimiento = (oportunidades, hoy = hoyLocal()) => {
  const claves = ['vencido', 'hoy', 'semana', 'sin'];
  const acumulado = Object.fromEntries(claves.map((c) => [c, { cantidad: 0, centavos: 0 }]));
  (Array.isArray(oportunidades) ? oportunidades : []).forEach((op) => {
    claves.forEach((c) => {
      if (!pasaFiltroSeguimiento(op, c, hoy)) return;
      acumulado[c].cantidad += 1;
      acumulado[c].centavos += centavos(op?.monto);
    });
  });
  return Object.fromEntries(claves.map((c) => [c, { cantidad: acumulado[c].cantidad, monto: acumulado[c].centavos / 100 }]));
};

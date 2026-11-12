import { ETAPAS } from './formato';

// Una cotización se muestra con la etapa de su oportunidad en el CRM. El backend
// manda `etapa`; si viniera vacía se deriva del estado heredado.

const ETAPA_POR_ESTADO = {
  revision: 'nueva',
  pendiente: 'nueva',
  enviada: 'cotizada',
  aprobada: 'ganada',
  rechazada: 'perdida'
};

const CLAVES = new Set(ETAPAS.map((e) => e.clave));

export const etapaDeCotizacion = (cot) => {
  const etapa = String(cot?.etapa || '').trim().toLowerCase();
  if (CLAVES.has(etapa)) return etapa;
  const estado = String(cot?.estado || '').trim().toLowerCase();
  return ETAPA_POR_ESTADO[estado] || 'nueva';
};

/** Estado heredado que el backend deriva de cada etapa (para KPIs y Compras). */
export const estadoDeEtapa = (etapa) =>
  ({ ganada: 'aprobada', perdida: 'rechazada', cotizada: 'enviada', negociacion: 'enviada', nueva: 'revision' })[etapa] || 'revision';

/** Tono del punto de estado (clases mq-punto-*) por etapa. */
export const TONO_ETAPA = {
  nueva: 'neutro',
  cotizada: 'info',
  negociacion: 'aviso',
  ganada: 'ok',
  perdida: 'critico'
};

export const tonoEtapa = (etapa) => TONO_ETAPA[etapa] || 'neutro';

/** Cuántas cotizaciones hay en cada etapa: { nueva: n, ... } con todas las claves. */
export const contarPorEtapa = (cotizaciones = []) => {
  const conteo = Object.fromEntries(ETAPAS.map((e) => [e.clave, 0]));
  cotizaciones.forEach((cot) => {
    conteo[etapaDeCotizacion(cot)] += 1;
  });
  return conteo;
};

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** "3 cotizaciones y 2 oportunidades" a partir de { cotizaciones, oportunidades }. */
export const textoConteoArchivo = (resultado) => {
  const c = Number(resultado?.cotizaciones) || 0;
  const o = Number(resultado?.oportunidades) || 0;
  return `${plural(c, 'cotización', 'cotizaciones')} y ${plural(o, 'oportunidad', 'oportunidades')}`;
};

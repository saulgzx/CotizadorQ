import { useEffect, useState } from 'react';

// Semaforo de margen por marca. El objetivo es el GP con que se cotiza por
// defecto; el piso es el minimo aceptable antes de pedir confirmacion.
// Se guarda en este navegador (Ajustes del cotizador).

export const MARGEN_DEFAULTS = Object.freeze({
  QNAP: { objetivo: 15, piso: 10 },
  AXIS: { objetivo: 13, piso: 10 }
});

const CLAVE = 'margenConfig';
const EVENTO = 'margen-config-cambio';

const sanear = (config) => {
  const salida = {};
  for (const marca of Object.keys(MARGEN_DEFAULTS)) {
    const base = MARGEN_DEFAULTS[marca];
    const entrada = config?.[marca] || {};
    const objetivo = Number(entrada.objetivo);
    const piso = Number(entrada.piso);
    const objetivoOk = Number.isFinite(objetivo) && objetivo > 0 && objetivo < 100 ? objetivo : base.objetivo;
    // Sin acotar el piso al objetivo: al escribir "15" se pasa por "1" y
    // arrastraria el piso. Si el piso queda sobre el objetivo, manda el piso.
    const pisoOk = Number.isFinite(piso) && piso >= 0 && piso < 100 ? piso : base.piso;
    salida[marca] = { objetivo: objetivoOk, piso: pisoOk };
  }
  return salida;
};

export const leerConfigMargen = () => {
  try {
    return sanear(JSON.parse(localStorage.getItem(CLAVE) || 'null'));
  } catch {
    return sanear(null);
  }
};

export const guardarConfigMargen = (config) => {
  const limpio = sanear(config);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(limpio));
  } catch {
    // Sin localStorage el ajuste dura lo que dure la pestaña.
  }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: limpio }));
  return limpio;
};

export const useConfigMargen = () => {
  const [config, setConfig] = useState(leerConfigMargen);
  useEffect(() => {
    const alCambiar = (e) => setConfig(e.detail || leerConfigMargen());
    window.addEventListener(EVENTO, alCambiar);
    return () => window.removeEventListener(EVENTO, alCambiar);
  }, []);
  return [config, (next) => setConfig(guardarConfigMargen(next))];
};

const marcaDe = (origen) => (String(origen || '').toUpperCase() === 'AXIS' ? 'AXIS' : 'QNAP');

/**
 * Umbrales para un conjunto de lineas de distintas marcas: se usa el mas
 * exigente de los presentes, para que un total mixto no esconda una marca.
 */
export const umbralesPara = (origenes, config = leerConfigMargen()) => {
  const marcas = [...new Set((origenes.length ? origenes : ['QNAP']).map(marcaDe))];
  return {
    objetivo: Math.max(...marcas.map((m) => config[m].objetivo)),
    piso: Math.max(...marcas.map((m) => config[m].piso))
  };
};

/** 'ok' | 'bajo_objetivo' | 'bajo_piso' | null (sin dato). */
export const estadoMargen = (gpPct, origen, config = leerConfigMargen()) => {
  if (gpPct === null || gpPct === undefined || !Number.isFinite(Number(gpPct))) return null;
  const { objetivo, piso } = Array.isArray(origen) ? umbralesPara(origen, config) : config[marcaDe(origen)];
  const valor = Number(gpPct);
  // Tolerancia de redondeo: 14,999 % cuenta como 15 %.
  if (valor + 0.005 < piso) return 'bajo_piso';
  if (valor + 0.005 >= objetivo) return 'ok';
  if (valor + 0.005 >= piso) return 'bajo_objetivo';
  return 'bajo_piso';
};

export const ESTILO_MARGEN = {
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  bajo_objetivo: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  bajo_piso: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  null: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
};

export const TEXTO_MARGEN = { ok: 'En objetivo', bajo_objetivo: 'Bajo objetivo', bajo_piso: 'Bajo piso', null: 'Sin costo' };

export const formatoPct = (valor) =>
  valor === null || valor === undefined || !Number.isFinite(Number(valor)) ? '—' : `${Number(valor).toFixed(1)}%`;

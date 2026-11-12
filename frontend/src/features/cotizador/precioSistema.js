import { useEffect, useState } from 'react';

// Precio de sistema de la pestaña Stock disponible: costo Chile real del equipo
// dividido por (1 - margen), igual que el cotizador, pero SIN rebate de partner.
// El margen por marca es editable y se guarda en este navegador.

export const MARGEN_SISTEMA_DEFAULTS = Object.freeze({ AXIS: 13, QNAP: 15 });

const CLAVE = 'margenPrecioSistema';
const EVENTO = 'margen-precio-sistema-cambio';

const marcaDe = (origen) => (String(origen || '').toUpperCase() === 'AXIS' ? 'AXIS' : 'QNAP');

const margenValido = (valor) => {
  const n = Number(valor);
  return valor !== null && valor !== undefined && valor !== '' && Number.isFinite(n) && n >= 0 && n < 100;
};

export const sanearMargenSistema = (config) => {
  const salida = {};
  for (const marca of Object.keys(MARGEN_SISTEMA_DEFAULTS)) {
    salida[marca] = margenValido(config?.[marca]) ? Number(config[marca]) : MARGEN_SISTEMA_DEFAULTS[marca];
  }
  return salida;
};

export const leerMargenSistema = () => {
  try {
    return sanearMargenSistema(JSON.parse(localStorage.getItem(CLAVE) || 'null'));
  } catch {
    return sanearMargenSistema(null);
  }
};

export const guardarMargenSistema = (config) => {
  const limpio = sanearMargenSistema(config);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(limpio));
  } catch {
    // Sin almacenamiento (modo privado): el cambio vale solo para esta sesion.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO, { detail: limpio }));
  return limpio;
};

/**
 * Precio de sistema en USD con 2 decimales, o null si no hay costo real.
 * margenPct es un porcentaje (13 = 13%).
 */
export const precioSistema = (costo, margenPct) => {
  const c = Number(costo);
  if (costo === null || costo === undefined || !Number.isFinite(c) || c <= 0) return null;
  if (!margenValido(margenPct)) return null;
  return Math.round((c / (1 - Number(margenPct) / 100) + Number.EPSILON) * 100) / 100;
};

/** Precio de sistema de una fila del catalogo de stock (usa su origen para elegir el margen). */
export const precioSistemaDe = (item, config = leerMargenSistema()) =>
  precioSistema(item?.costo_chile, config[marcaDe(item?.origin)]);

/** Margenes vigentes y funcion para cambiarlos; se mantiene al dia entre componentes. */
export const useMargenSistema = () => {
  const [config, setConfig] = useState(leerMargenSistema);
  useEffect(() => {
    const alCambiar = (e) => setConfig(sanearMargenSistema(e.detail));
    window.addEventListener(EVENTO, alCambiar);
    return () => window.removeEventListener(EVENTO, alCambiar);
  }, []);
  const cambiar = (marca, valor) => guardarMargenSistema({ ...config, [marca]: valor });
  const restablecer = () => guardarMargenSistema(MARGEN_SISTEMA_DEFAULTS);
  return { config, cambiar, restablecer };
};

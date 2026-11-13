// Margen (GP) de una línea del carrito: módulo puro, sin React.
// Una línea usa su margen propio (gpOverride) o, si no lo tiene, el base de su origen:
//   AXIS -> margen global de AXIS · origen de quote (ISS, Neural Labs, Milestone) -> 8 %
//   cualquier otro (QNAP, sin origen) -> margen global de QNAP.
// Es plata: una línea de quote de ISS, Neural o Milestone nunca debe caer al margen global de
// QNAP. Velasea es la excepción decidida por el dueño: es "igual que QNAP", así que usa el
// margen global de QNAP aunque su costo venga de un quote.
import { GP_QUOTE_POR_DEFECTO, esOrigenQuote, usaMargenQnap } from './quoteFabricante';

/** Margen base (decimal) de un origen, según los márgenes globales vigentes. */
export const gpBaseDeOrigen = (origen, { gpQnap, gpAxis } = {}) => {
  const clave = String(origen || 'QNAP').trim().toUpperCase();
  if (clave === 'AXIS') return gpAxis;
  if (esOrigenQuote(clave) && !usaMargenQnap(clave)) return GP_QUOTE_POR_DEFECTO;
  return gpQnap;
};

/** Margen efectivo (decimal) de una línea: el propio si lo tiene, si no el base de su origen. */
export const gpDeLinea = (item, globales) => item?.gpOverride ?? gpBaseDeOrigen(item?.origen, globales);

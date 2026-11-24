// Totales del carrito tal como los guarda el servidor: el precio unitario se redondea a centavos
// y el total de la línea es ese unitario por la cantidad. El total de la cotización es la suma
// de los totales de línea. Así lo que se ve en el carrito es, al centavo, lo que queda guardado
// (antes el carrito multiplicaba el unitario con todos sus decimales y difería en centavos).
import { redondear2 } from './costoWave';

/** Precio unitario como se guarda: a 2 decimales. */
export const unitarioGuardado = (precioUnitario) => {
  const n = Number(precioUnitario);
  return Number.isFinite(n) ? redondear2(Math.max(n, 0)) : 0;
};

/** Total de una línea: unitario redondeado x cantidad (entera, mínimo 1), a 2 decimales. */
export const totalDeLinea = (precioUnitario, cantidad) => {
  const cant = Math.max(1, Math.trunc(Number(cantidad) || 1));
  return redondear2(unitarioGuardado(precioUnitario) * cant);
};

/** Total del carrito: suma de los totales de línea, en centavos enteros. `lineas`: [{ precio, cantidad }]. */
export const totalDelCarrito = (lineas) =>
  (Array.isArray(lineas) ? lineas : []).reduce((centavos, l) => centavos + Math.round(totalDeLinea(l?.precio, l?.cantidad) * 100), 0) / 100;

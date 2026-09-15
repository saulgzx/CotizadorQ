import { STOCK_DELIVERY_SUFFIX } from './cotizadorConstants';
import { formatStockQuantity } from './cotizadorHelpers';

/**
 * Texto de entrega de una línea según stock disponible y cantidad pedida.
 * - Sin disponible (o 0): plazo del catálogo (ETA).
 * - Alcanza: "N unidades disponible en entrega inmediata, salvo venta previa".
 * - No alcanza: lo anterior + " | diferencia <ETA>".
 */
export const textoEntregaLinea = ({ disponible, cantidad, etaCatalogo }) => {
  const eta = String(etaCatalogo || '').trim();
  const qty = Number(disponible);
  if (!Number.isFinite(qty) || qty <= 0) return eta;
  const base = `${formatStockQuantity(qty)} ${STOCK_DELIVERY_SUFFIX}`;
  if (Number(cantidad) > qty) return `${base} | diferencia ${eta || 'ETA por confirmar'}`;
  return base;
};

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATRON_STOCK = new RegExp(`^(\\d+(?:\\.\\d+)?) ${escapar(STOCK_DELIVERY_SUFFIX)}(?: \\| diferencia (.+))?$`);

/**
 * Descompone el texto de entrega para mostrarlo como etiquetas.
 * { inmediata, pendiente, eta } si viene de stock; { texto } si es un plazo libre.
 */
export const partesEntrega = (tiempo, cantidad) => {
  const t = String(tiempo || '').trim();
  const m = t.match(PATRON_STOCK);
  if (!m) return { texto: t };
  const inmediata = Number(m[1]);
  return {
    inmediata,
    pendiente: m[2] ? Math.max(Number(cantidad) - inmediata, 0) : 0,
    eta: m[2] || null
  };
};

/** La entrega fue generada por el sistema (no escrita a mano) y se puede recalcular. */
export const esEntregaAutomatica = (tiempo, etaCatalogo) => {
  const t = String(tiempo || '').trim();
  if (!t) return true;
  if (t.includes(STOCK_DELIVERY_SUFFIX)) return true;
  return t === String(etaCatalogo || '').trim();
};

// Rótulo de la "Compra ..." que se manda a compras para una cotización guardada.
//  - Las líneas de lista siguen la regla de siempre: Axis si alguna lo menciona, si no QNAP.
//  - Las líneas de quote aportan el nombre de su fabricante (ISS, Neural Labs, Milestone).
// Una cotización solo de quotes dice solo el fabricante; una mixta dice las dos cosas
// ("QNAP / ISS"), para que compras no pase por alto lo que hay que pedir al fabricante.
// La regla del texto "axis" mira SOLO las líneas de lista: la descripción de una licencia
// Milestone puede decir "para cámaras Axis" y no por eso es una compra a Axis.
import { esOrigenQuote } from './quoteFabricante';

const NOMBRE_FABRICANTE = { ISS: 'ISS', NEURAL: 'Neural Labs', MILESTONE: 'Milestone', MILESTONE_HW: 'Milestone' };

const origenDe = (item) => String(item?.origen ?? '').trim().toUpperCase();

export const etiquetaCompraOrigen = (items) => {
  const lineas = Array.isArray(items) ? items : [];
  const deLista = lineas.filter((item) => !esOrigenQuote(item?.origen));
  const fabricantes = [
    ...new Set(lineas.filter((item) => esOrigenQuote(item?.origen)).map((item) => NOMBRE_FABRICANTE[origenDe(item)]))
  ];
  const partes = [];
  if (deLista.length > 0 || fabricantes.length === 0) {
    const hayAxis = deLista.some((item) =>
      [item?.marca, item?.sku, item?.mpn, item?.descripcion].some((v) => String(v || '').toLowerCase().includes('axis'))
    );
    partes.push(hayAxis ? 'Axis' : 'QNAP');
  }
  return [...partes, ...fabricantes].join(' / ');
};

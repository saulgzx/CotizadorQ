// Revisión de wave: los dos costos intermedios de la cadena de precios, para corroborarlos
// contra la lista del wave. Módulo puro (sin React ni red). No interviene en ningún precio.
//
// La cadena completa de un producto de lista es:
//   precio disty  ->  Costo XUS      = disty x flete de entrada
//                 ->  Costo XUS + IC = Costo XUS / IC
//                 ->  Costo Chile    = (Costo XUS + IC) x (1 + transporte y arancel)   [no se muestra aquí]
// El flete y el IC salen de la tabla CADENA_POR_ORIGEN (QNAP 1,011 y 0,95; AXIS 1,015 y 0,97).
// Rebates, costo real de stock y margen no cambian estos dos números: son anteriores a todo eso.
import { CADENA_POR_ORIGEN } from './cotizadorConstants';

// Mismo redondeo a centavos que usa el servidor (backend/src/services/cotizacionItems.js).
export const redondear2 = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

/** Origen de la línea tal como lo usa la cadena: sin origen o con uno desconocido es QNAP, como en el carrito. */
export const origenDeCadena = (origen) => {
  const clave = String(origen ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CADENA_POR_ORIGEN, clave) ? clave : 'QNAP';
};

/**
 * Costos de revisión de un producto o de una línea del carrito (campo `precio` = precio disty).
 * -> { disty, costoXus, costoXusIc, flete, ic, origen } con los costos a 2 decimales,
 *    o null si no hay precio disty (> 0): p. ej. un equipo fuera de lista que solo tiene costo
 *    real de stock. No se inventa un costo que la lista no trae.
 */
export const costosWave = (item) => {
  const disty = Number(item?.precio);
  if (!Number.isFinite(disty) || disty <= 0) return null;
  const origen = origenDeCadena(item?.origen);
  const { INBOUND_FREIGHT: flete, IC: ic } = CADENA_POR_ORIGEN[origen];
  const xus = disty * flete;
  return { disty: redondear2(disty), costoXus: redondear2(xus), costoXusIc: redondear2(xus / ic), flete, ic, origen };
};

// Una celda no puede traer tabuladores ni saltos de línea: romperían la tabla al pegarla.
const celda = (valor) => String(valor ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/**
 * Tabla de la revisión lista para pegar en Excel (separada por tabuladores, una fila por línea).
 * Los números van con punto decimal y sin separador de miles, que es lo que Excel lee sin ambigüedad
 * al pegar. Las líneas sin precio disty van con los costos vacíos.
 */
export const tablaWave = (items) => {
  const filas = [['Marca', 'SKU', 'MPN', 'Descripción', 'Cantidad', 'Precio disty', 'Costo XUS', 'Costo XUS + IC']];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const c = costosWave(item);
    filas.push([
      celda(item?.marca || item?.origen),
      celda(item?.sku),
      celda(item?.mpn),
      celda(item?.desc ?? item?.descripcion),
      celda(item?.cant ?? item?.cantidad ?? ''),
      c ? c.disty.toFixed(2) : '',
      c ? c.costoXus.toFixed(2) : '',
      c ? c.costoXusIc.toFixed(2) : ''
    ]);
  });
  return filas.map((f) => f.join('\t')).join('\n');
};

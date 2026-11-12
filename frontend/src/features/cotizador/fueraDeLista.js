// Equipos que están en stock pero ya no figuran en la lista de precios.
// Se pueden cotizar igual: el precio sale del costo real con que entraron a
// Chile (OH Unit USD de la hoja Stock) dividido por (1 - margen), sin precio
// disty ni rebates, porque la lista ya no los trae.

const clave = (valor) => String(valor || '').trim().toUpperCase().replace(/[\s_-]+/g, '');

export const PREFIJO_FUERA_DE_LISTA = 'stock:';

export const esFueraDeLista = (item) =>
  !!item?.fueraDeLista || String(item?.id || '').startsWith(PREFIJO_FUERA_DE_LISTA);

/**
 * Producto para el carrito a partir de una fila de Stock disponible, o null si
 * la fila no trae costo real (sin costo no hay cómo fijar un precio).
 * El id no es numérico a propósito: al guardar, la línea queda sin producto_id.
 */
export const productoFueraDeLista = (item, { gpPorDefecto = 0.15 } = {}) => {
  const costo = Number(item?.costo_chile);
  const codigo = clave(item?.mpn) || clave(item?.sku);
  if (!(costo > 0) || !codigo) return null;
  const origen = String(item?.origin || item?.brand || '').toUpperCase().includes('AXIS') ? 'AXIS' : 'QNAP';
  return {
    id: `${PREFIJO_FUERA_DE_LISTA}${codigo}`,
    fueraDeLista: true,
    origen,
    marca: item?.brand || origen,
    sku: item?.sku || '',
    mpn: item?.mpn || '',
    desc: item?.name || item?.mpn || item?.sku || '',
    precio: 0,
    gp: gpPorDefecto,
    rebate_partner_autorizado: 0,
    rebate_partner_silver: 0,
    rebate_partner_gold: 0,
    rebate_partner_multiregional: 0,
    costoChile: Math.round(costo * 100) / 100,
    tiempo: 'ETA por confirmar'
  };
};

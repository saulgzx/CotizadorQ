// Stock disponible = stock en bodega - unidades ya asignadas a clientes.
//
// Las asignaciones vienen de la pestaña OSO del Excel maestro:
//   columna C = SKU, columna D = MPN, columna H = cantidad alocada.
// Una unidad alocada ya tiene dueño: no puede ofrecerse como entrega inmediata.

const OSO_COL_SKU = 2; // C
const OSO_COL_MPN = 3; // D
const OSO_COL_ASIGNADO = 7; // H

const clave = (valor) => String(valor ?? '').trim().toUpperCase();

const numero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  // "1.234" o "1,234" como miles; "12,5" como decimal.
  const texto = String(valor).trim().replace(/\s/g, '');
  const normalizado = /^\d{1,3}([.,]\d{3})+$/.test(texto) ? texto.replace(/[.,]/g, '') : texto.replace(',', '.');
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Suma lo asignado por MPN y por SKU. rows incluye el encabezado en la fila 0.
 * Cada fila de OSO se cuenta una sola vez al descontar: se busca primero por
 * MPN y solo si el producto no aparece por MPN, por SKU.
 */
const calcularAsignaciones = (rows) => {
  const porMpn = new Map();
  const porSku = new Map();
  for (let i = 1; i < (rows || []).length; i += 1) {
    const row = rows[i] || [];
    const asignado = numero(row[OSO_COL_ASIGNADO]);
    if (!(asignado > 0)) continue;
    const mpn = clave(row[OSO_COL_MPN]);
    const sku = clave(row[OSO_COL_SKU]);
    if (mpn) porMpn.set(mpn, (porMpn.get(mpn) || 0) + asignado);
    if (sku) porSku.set(sku, (porSku.get(sku) || 0) + asignado);
  }
  return { porMpn, porSku };
};

const asignadoPara = (asignaciones, { mpn, sku }) => {
  const kMpn = clave(mpn);
  if (kMpn && asignaciones.porMpn.has(kMpn)) return asignaciones.porMpn.get(kMpn);
  const kSku = clave(sku);
  if (kSku && asignaciones.porSku.has(kSku)) return asignaciones.porSku.get(kSku);
  return 0;
};

/**
 * Descuenta lo asignado de una fila de stock. Una cantidad no numerica (texto
 * en la planilla) no se puede descontar con seguridad: queda en 0 disponible.
 */
const aplicarAsignacion = (cantidadBodega, asignado) => {
  const bodega = typeof cantidadBodega === 'number' ? cantidadBodega : numero(cantidadBodega);
  const esNumero = typeof cantidadBodega === 'number' || /^\s*[\d.,]+\s*$/.test(String(cantidadBodega ?? ''));
  const total = esNumero ? bodega : 0;
  return {
    stock_bodega: total,
    asignado,
    disponible: Math.max(0, total - asignado)
  };
};

module.exports = {
  OSO_COL_SKU,
  OSO_COL_MPN,
  OSO_COL_ASIGNADO,
  calcularAsignaciones,
  asignadoPara,
  aplicarAsignacion
};

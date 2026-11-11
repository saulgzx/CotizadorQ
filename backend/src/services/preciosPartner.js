// Calculo de precios por nivel de partner y margen (GP), para el asistente IA.
//
// Misma formula que el cotizador web: costo Chile (real de stock o calculado
// desde el disty) menos el rebate del nivel de partner (solo Axis), dividido
// por (1 - GP). Solo lectura: no guarda nada.

const { costoXCL, normalizarOrigen } = require('./cotizacionItems');

const NIVELES = Object.freeze([
  { nombre: 'Partner Autorizado', campo: 'rebate_partner_autorizado' },
  { nombre: 'Partner Silver', campo: 'rebate_partner_silver' },
  { nombre: 'Partner Gold', campo: 'rebate_partner_gold' },
  { nombre: 'Partner Multiregional', campo: 'rebate_partner_multiregional' }
]);

const redondear = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const numero = (v, fallback = 0) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? fallback : n;
};

/** Acepta 0.15 o 15 (porcentaje). Devuelve null si no es un GP valido (0 <= gp < 1). */
const leerGp = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const gp = n > 1 ? n / 100 : n;
  return gp >= 0 && gp < 1 ? gp : null;
};

/** Normaliza "gold", "Partner Gold", "multi"... al nombre exacto del nivel. */
const leerNivel = (valor) => {
  const t = String(valor || '').trim().toLowerCase();
  if (!t) return null;
  if (t.includes('multi')) return 'Partner Multiregional';
  if (t.includes('gold')) return 'Partner Gold';
  if (t.includes('silver')) return 'Partner Silver';
  if (t.includes('autoriz')) return 'Partner Autorizado';
  return undefined; // nivel no reconocido
};

const lineaPrecio = (costo, gp, cantidad) => {
  // Como en la cotizacion: los totales salen del unitario ya redondeado.
  const precio = redondear(costo / (1 - gp));
  const costoR = redondear(costo);
  return {
    costo_unitario: costoR,
    precio_unitario: precio,
    margen_unitario: redondear(precio - costoR),
    precio_total: redondear(precio * cantidad),
    margen_total: redondear((precio - costoR) * cantidad)
  };
};

/**
 * Precio de un producto.
 * - producto: fila de la tabla productos.
 * - costoReal: costo Chile real de stock (OH Unit USD) o null.
 * - gp: margen decimal (0.15).
 * - nivel: nombre del nivel de partner; null calcula los 4 niveles (Axis).
 */
const calcularPrecioProducto = ({ producto, costoReal = null, gp, nivel = null, cantidad = 1 }) => {
  const origen = normalizarOrigen(producto.origen, producto);
  const base = numero(costoReal) > 0 ? numero(costoReal) : costoXCL(origen, producto.precio_disty);
  const resultado = {
    producto_id: producto.id,
    sku: producto.sku || '',
    mpn: producto.mpn || '',
    descripcion: producto.descripcion || '',
    origen,
    cantidad,
    gp,
    costo_base: redondear(base),
    costo_base_fuente: numero(costoReal) > 0 ? 'stock_chile_real' : 'calculado_desde_disty'
  };
  if (origen !== 'AXIS') return { ...resultado, ...lineaPrecio(base, gp, cantidad) };

  const niveles = NIVELES.filter((n) => !nivel || n.nombre === nivel).map((n) => {
    const rebate = numero(producto[n.campo]);
    return { nivel: n.nombre, rebate: redondear(rebate), ...lineaPrecio(Math.max(base - rebate, 0), gp, cantidad) };
  });
  return { ...resultado, niveles };
};

module.exports = { NIVELES, leerGp, leerNivel, calcularPrecioProducto };

// Pestaña Stock agregada por producto.
//
// Un mismo MPN puede venir en varias filas (lotes/bodegas): las unidades se
// SUMAN y el costo real se promedia ponderado por unidades. Despues se descuenta
// lo asignado en OSO una sola vez por producto.
//
// Columna I "OH Unit USD" = costo real con que el producto ingreso a Chile.
// Reemplaza al costo Chile calculado (disty * freight / IC * (1 + INT)) mientras
// haya unidades disponibles: es el costo de lo que efectivamente se va a vender.
// NUNCA debe viajar en respuestas para clientes.

const { asignadoPara } = require('./stockDisponible');

const STOCK_FALLBACK = { image: 0, brand: 1, name: 2, sku: 3, mpn: 4, qty: 6, costo: 8 };

const clave = (valor) => String(valor ?? '').trim().toUpperCase();
const texto = (valor) => String(valor ?? '').trim();

/**
 * Numero desde la planilla, tolerante a formato: 12, "12", "1.234", "1,234",
 * "US$ 1.234,56", "1,234.56", "95,30". Devuelve null si no es numero.
 */
const aNumero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let s = String(valor).replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const tienePunto = s.includes('.');
  const tieneComa = s.includes(',');
  if (tienePunto && tieneComa) {
    // El ultimo separador es el decimal.
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const miles = decimal === ',' ? '.' : ',';
    s = s.split(miles).join('').replace(decimal, '.');
  } else if (tieneComa || tienePunto) {
    const sep = tieneComa ? ',' : '.';
    const partes = s.split(sep);
    const soloMiles = partes.length > 1 && partes.slice(1).every((p) => p.length === 3);
    s = soloMiles ? partes.join('') : s.replace(sep, '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Agrupa filas de Stock por producto. rows incluye el encabezado en la fila 0.
 * idx: { image, brand, name, sku, mpn, qty, costo } (indices de columna, -1 si no existe).
 */
const agregarStock = (rows, idx = STOCK_FALLBACK, asignaciones = null) => {
  const col = { ...STOCK_FALLBACK, ...idx };
  const porClave = new Map();
  for (let i = 1; i < (rows || []).length; i += 1) {
    const row = rows[i] || [];
    const mpn = col.mpn >= 0 ? texto(row[col.mpn]) : '';
    const sku = col.sku >= 0 ? texto(row[col.sku]) : '';
    const name = col.name >= 0 ? texto(row[col.name]) : '';
    if (!mpn && !sku && !name) continue;
    const k = mpn ? `MPN:${clave(mpn)}` : sku ? `SKU:${clave(sku)}` : `NOMBRE:${clave(name)}`;
    const cantidad = Math.max(0, (col.qty >= 0 ? aNumero(row[col.qty]) : null) ?? 0);
    const costo = col.costo >= 0 ? aNumero(row[col.costo]) : null;

    let item = porClave.get(k);
    if (!item) {
      item = {
        mpn,
        sku,
        name,
        brand: col.brand >= 0 ? texto(row[col.brand]) : '',
        imageUrl: col.image >= 0 ? texto(row[col.image]) : '',
        stock_bodega: 0,
        filas: 0,
        _costoPonderado: 0,
        _unidadesConCosto: 0,
        _costosSinUnidades: []
      };
      porClave.set(k, item);
    }
    item.filas += 1;
    item.stock_bodega += cantidad;
    // Completa datos vacios con la primera fila que los traiga.
    if (!item.sku && sku) item.sku = sku;
    if (!item.name && name) item.name = name;
    if (!item.brand && col.brand >= 0) item.brand = texto(row[col.brand]);
    if (!item.imageUrl && col.image >= 0) item.imageUrl = texto(row[col.image]);
    if (costo !== null && costo > 0) {
      if (cantidad > 0) {
        item._costoPonderado += costo * cantidad;
        item._unidadesConCosto += cantidad;
      } else {
        item._costosSinUnidades.push(costo);
      }
    }
  }

  return [...porClave.values()].map((item) => {
    const asignado = asignaciones ? asignadoPara(asignaciones, { mpn: item.mpn, sku: item.sku }) : 0;
    let costoChile = null;
    if (item._unidadesConCosto > 0) {
      costoChile = item._costoPonderado / item._unidadesConCosto;
    } else if (item._costosSinUnidades.length) {
      costoChile = item._costosSinUnidades.reduce((a, b) => a + b, 0) / item._costosSinUnidades.length;
    }
    const { _costoPonderado, _unidadesConCosto, _costosSinUnidades, ...publico } = item;
    return {
      ...publico,
      asignado,
      disponible: Math.max(0, item.stock_bodega - asignado),
      costo_chile: costoChile === null ? null : Math.round(costoChile * 100) / 100
    };
  });
};

/**
 * Costo Chile real por producto, solo para lo que tiene unidades disponibles.
 * Sin disponible, una venta nueva requiere importar: aplica el costo calculado.
 */
const mapaCostosChile = (items) => {
  const porMpn = new Map();
  const porSku = new Map();
  for (const item of items || []) {
    if (!(item.disponible > 0) || !(item.costo_chile > 0)) continue;
    if (item.mpn) porMpn.set(clave(item.mpn), item.costo_chile);
    if (item.sku) porSku.set(clave(item.sku), item.costo_chile);
  }
  return { porMpn, porSku };
};

const costoChilePara = (mapa, { mpn, sku }) => {
  if (!mapa) return null;
  const kMpn = clave(mpn);
  if (kMpn && mapa.porMpn.has(kMpn)) return mapa.porMpn.get(kMpn);
  const kSku = clave(sku);
  if (kSku && kSku !== 'TO CREATE' && mapa.porSku.has(kSku)) return mapa.porSku.get(kSku);
  return null;
};

module.exports = { STOCK_FALLBACK, aNumero, agregarStock, mapaCostosChile, costoChilePara };

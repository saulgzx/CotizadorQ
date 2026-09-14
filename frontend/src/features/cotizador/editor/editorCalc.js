// Calculo puro del editor de cotizaciones (solo admin).
// Misma cadena de costo que el cotizador y que backend/src/services/cotizacionItems.js:
//   costo XCL = disty * freight / IC * (1 + INT)
//   costo final = max(costo XCL - rebates, 0)          (rebates solo AXIS)
//   precio = costo final / (1 - gp)
import { AXIS_CONSTANTS, CONSTANTS, DEFAULT_AXIS_PARTNER } from '../cotizadorConstants';

export const redondear = (valor, decimales = 2) => {
  const factor = 10 ** decimales;
  return Math.round((Number(valor) + Number.EPSILON) * factor) / factor;
};

const numero = (valor, fallback = 0) => {
  if (valor === null || valor === undefined || valor === '') return fallback;
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const numeroONull = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : null;
};

export const inferirOrigen = (item = {}) => {
  const origen = String(item.origen || '').toUpperCase();
  if (origen === 'AXIS' || origen === 'QNAP') return origen;
  const texto = `${item.marca || ''} ${item.sku || ''} ${item.mpn || ''} ${item.descripcion || item.desc || ''}`.toLowerCase();
  return texto.includes('axis') ? 'AXIS' : 'QNAP';
};

export const costoXCL = (origen, precioDisty) => {
  const c = origen === 'AXIS' ? AXIS_CONSTANTS : CONSTANTS;
  return ((numero(precioDisty) * c.INBOUND_FREIGHT) / c.IC) * (1 + c.INT);
};

// costo_xcl_real: "OH Unit USD" de la hoja Stock. Si viene, reemplaza al costo Chile calculado.
export const costoFinal = ({ origen, precio_disty, rebate_partner, rebate_proyecto, costo_xcl_real }) => {
  const rebates = origen === 'AXIS' ? numero(rebate_partner) + numero(rebate_proyecto) : 0;
  const base = numero(costo_xcl_real) > 0 ? numero(costo_xcl_real) : costoXCL(origen, precio_disty);
  return Math.max(base - rebates, 0);
};

export const precioDesdeGp = (costo, gpPct) => {
  const gp = numero(gpPct) / 100;
  if (costo === null || costo === undefined || gp >= 1) return null;
  return redondear(costo / (1 - gp));
};

/** GP en porcentaje, o null si no hay costo o precio. */
export const gpDe = (linea) => {
  const costo = numeroONull(linea.costo_unitario);
  const precio = numero(linea.precio_unitario);
  if (costo === null || precio <= 0) return null;
  return redondear((1 - costo / precio) * 100, 2);
};

export const rebatePartnerDeProducto = (producto, categoria) => {
  if (!producto) return 0;
  const selected = categoria || DEFAULT_AXIS_PARTNER;
  if (selected === 'Partner Silver') return numero(producto.rebate_partner_silver);
  if (selected === 'Partner Gold') return numero(producto.rebate_partner_gold);
  if (selected === 'Partner Multiregional') return numero(producto.rebate_partner_multiregional);
  return numero(producto.rebate_partner_autorizado);
};

let contador = 0;
const nuevaClave = () => {
  contador += 1;
  return `l${Date.now().toString(36)}${contador}`;
};

/**
 * Linea guardada -> estado del editor. En cotizaciones AXIS antiguas no se
 * guardaba el rebate, pero si el costo (reconstruido desde precio y gp): la
 * diferencia contra el costo XCL es el rebate que se aplico, y se marca como
 * inferido para que se vea.
 */
export const lineaDesdeItem = (item) => {
  const origen = inferirOrigen(item);
  const precioDisty = numero(item.precio_disty);
  const costo = numeroONull(item.costo_unitario);
  let rebatePartner = numeroONull(item.rebate_partner);
  let rebateProyecto = numeroONull(item.rebate_proyecto);
  let rebateInferido = false;
  if (origen === 'AXIS' && rebatePartner === null && rebateProyecto === null && costo !== null && precioDisty > 0) {
    const implicito = redondear(costoXCL(origen, precioDisty) - costo);
    if (implicito > 0.009) {
      rebatePartner = implicito;
      rebateInferido = true;
    }
  }
  const linea = {
    key: item.id ? `i${item.id}` : nuevaClave(),
    id: item.id ?? null,
    producto_id: item.producto_id ?? null,
    marca: item.marca || '',
    sku: item.sku || '',
    mpn: item.mpn || '',
    descripcion: item.descripcion || '',
    origen,
    cantidad: Math.max(1, Math.trunc(numero(item.cantidad, 1)) || 1),
    precio_disty: precioDisty,
    rebate_partner: origen === 'AXIS' ? (rebatePartner ?? 0) : null,
    rebate_proyecto: origen === 'AXIS' ? (rebateProyecto ?? 0) : null,
    partner_category: item.partner_category || null,
    rebate_inferido: rebateInferido,
    costo_unitario: costo,
    precio_unitario: redondear(numero(item.precio_unitario)),
    tiempo_entrega: item.tiempo_entrega || '',
    nueva: false
  };
  linea.original = {
    cantidad: linea.cantidad,
    precio_unitario: linea.precio_unitario,
    costo_unitario: linea.costo_unitario,
    descripcion: linea.descripcion,
    tiempo_entrega: linea.tiempo_entrega
  };
  return linea;
};

/** Producto del catalogo (formato de CotizadorPage para admin) -> linea nueva. */
export const lineaDesdeProducto = (producto, { gpPct = CONSTANTS.DEFAULT_GP * 100, partnerCategory, tiempoEntrega } = {}) => {
  const origen = inferirOrigen({ ...producto, descripcion: producto.desc });
  const categoria = origen === 'AXIS' ? (partnerCategory || DEFAULT_AXIS_PARTNER) : null;
  const rebatePartner = origen === 'AXIS' ? rebatePartnerDeProducto(producto, categoria) : null;
  const base = {
    precio_disty: numero(producto.precio),
    origen,
    rebate_partner: rebatePartner,
    rebate_proyecto: origen === 'AXIS' ? 0 : null,
    costo_xcl_real: numero(producto.costoChile) > 0 ? numero(producto.costoChile) : null
  };
  // El precio sale del costo sin redondear, igual que en el cotizador.
  const costoExacto = costoFinal(base);
  return {
    key: nuevaClave(),
    id: null,
    producto_id: producto.id ?? null,
    marca: producto.marca || '',
    sku: producto.sku || '',
    mpn: producto.mpn || '',
    descripcion: producto.desc || producto.descripcion || '',
    ...base,
    partner_category: categoria,
    rebate_inferido: false,
    costo_unitario: redondear(costoExacto),
    precio_unitario: precioDesdeGp(costoExacto, gpPct) ?? 0,
    cantidad: 1,
    tiempo_entrega: tiempoEntrega || producto.tiempo || '',
    nueva: true,
    original: null
  };
};

export const MODO_COSTO = { MANTENER_PRECIO: 'precio', MANTENER_MARGEN: 'margen' };

/**
 * Aplica un cambio a una linea. Cuando cambia el costo (disty o rebates) el
 * modo decide que se conserva: el precio que ya vio el cliente, o el margen.
 */
export const aplicarCambio = (linea, campo, valor, modo = MODO_COSTO.MANTENER_PRECIO) => {
  const next = { ...linea };
  switch (campo) {
    case 'cantidad':
      next.cantidad = Math.max(1, Math.trunc(numero(valor, 1)) || 1);
      return next;
    case 'precio_unitario':
      next.precio_unitario = Math.max(0, redondear(numero(valor)));
      return next;
    case 'gp': {
      const precio = precioDesdeGp(next.costo_unitario, valor);
      if (precio !== null) next.precio_unitario = precio;
      return next;
    }
    case 'costo_unitario': {
      const costo = numeroONull(valor);
      const gpAntes = gpDe(linea);
      next.costo_unitario = costo === null ? null : Math.max(0, redondear(costo));
      if (modo === MODO_COSTO.MANTENER_MARGEN && gpAntes !== null && next.costo_unitario !== null) {
        next.precio_unitario = precioDesdeGp(next.costo_unitario, gpAntes) ?? next.precio_unitario;
      }
      return next;
    }
    case 'precio_disty':
    case 'rebate_partner':
    case 'rebate_proyecto': {
      // Mismo valor: no se recalcula. Recalcular un costo guardado con la
      // formula mueve centavos de lineas que nadie toco.
      if (redondear(numero(valor)) === redondear(numero(linea[campo]))) return linea;
      const gpAntes = gpDe(linea);
      next[campo] = Math.max(0, numero(valor));
      if (campo !== 'precio_disty') next.rebate_inferido = false;
      // Editar el disty a mano deja de usar el costo real de stock.
      if (campo === 'precio_disty') next.costo_xcl_real = null;
      const costoExacto = costoFinal(next);
      next.costo_unitario = redondear(costoExacto);
      if (modo === MODO_COSTO.MANTENER_MARGEN && gpAntes !== null) {
        next.precio_unitario = precioDesdeGp(costoExacto, gpAntes) ?? next.precio_unitario;
      }
      return next;
    }
    default:
      next[campo] = valor;
      return next;
  }
};

export const margenDe = (linea) => {
  const costo = numeroONull(linea.costo_unitario);
  const precio = numero(linea.precio_unitario);
  if (costo === null) return { unitario: null, total: null, pct: null };
  const unitario = redondear(precio - costo);
  return {
    unitario,
    total: redondear(unitario * linea.cantidad),
    pct: precio > 0 ? redondear((unitario / precio) * 100, 2) : null
  };
};

export const totalLinea = (linea) => redondear(numero(linea.precio_unitario) * linea.cantidad);

export const resumenLineas = (lineas) => {
  const venta = redondear(lineas.reduce((s, l) => s + totalLinea(l), 0));
  const conCosto = lineas.filter((l) => numeroONull(l.costo_unitario) !== null);
  const costo = redondear(conCosto.reduce((s, l) => s + numero(l.costo_unitario) * l.cantidad, 0));
  const ventaConCosto = redondear(conCosto.reduce((s, l) => s + totalLinea(l), 0));
  const margen = redondear(ventaConCosto - costo);
  return {
    venta,
    costo,
    margen,
    margen_pct: ventaConCosto > 0 ? redondear((margen / ventaConCosto) * 100, 2) : null,
    sin_costo: lineas.length - conCosto.length,
    negativas: lineas.filter((l) => {
      const m = margenDe(l).unitario;
      return m !== null && m < 0;
    }).length
  };
};

/** Que cambio en una linea respecto de lo guardado. */
export const cambiosDeLinea = (linea) => {
  if (linea.nueva || !linea.original) return { nueva: true, campos: [] };
  const campos = ['cantidad', 'precio_unitario', 'costo_unitario', 'descripcion', 'tiempo_entrega'].filter(
    (campo) => String(linea[campo] ?? '') !== String(linea.original[campo] ?? '')
  );
  return { nueva: false, campos };
};

export const lineaAPayload = (linea, orden) => ({
  producto_id: linea.producto_id,
  marca: linea.marca,
  sku: linea.sku,
  mpn: linea.mpn,
  descripcion: linea.descripcion,
  origen: linea.origen,
  cantidad: linea.cantidad,
  precio_disty: linea.precio_disty,
  rebate_partner: linea.origen === 'AXIS' ? linea.rebate_partner : null,
  rebate_proyecto: linea.origen === 'AXIS' ? linea.rebate_proyecto : null,
  partner_category: linea.origen === 'AXIS' ? linea.partner_category : null,
  costo_unitario: linea.costo_unitario,
  precio_unitario: linea.precio_unitario,
  tiempo_entrega: linea.tiempo_entrega,
  orden
});

/** Huella para detectar cambios sin guardar. */
export const huella = (form, lineas) =>
  JSON.stringify({ form, lineas: lineas.map((l, i) => lineaAPayload(l, i)) });

/** Busqueda por palabras sobre el catalogo (sku, mpn, marca, descripcion). */
export const buscarEnCatalogo = (productos, texto, limite = 8) => {
  const palabras = String(texto || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  const clave = palabras.join('').replace(/[^a-z0-9]/g, '');
  const resultados = [];
  for (const p of productos || []) {
    const campos = `${p.sku} ${p.mpn} ${p.marca} ${p.desc || p.descripcion || ''}`.toLowerCase();
    if (!palabras.every((w) => campos.includes(w))) continue;
    const mpn = String(p.mpn || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sku = String(p.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const rango = mpn === clave || sku === clave ? 0 : mpn.startsWith(clave) || sku.startsWith(clave) ? 1 : 2;
    resultados.push({ p, rango });
  }
  return resultados
    .sort((a, b) => a.rango - b.rango)
    .slice(0, limite)
    .map((r) => r.p);
};

// Lineas de cotizacion: calculo de costo/margen, vistas por rol y persistencia.
//
// Regla dura (T1.4): la separacion de vistas vive en la SERIALIZACION, no en
// las plantillas. vistaCliente() es una lista explicita de campos permitidos;
// cualquier columna nueva (costo, rebate, margen...) queda fuera por defecto.
// Solo el rol "admin" recibe vistaAdmin().

const QNAP_CONSTANTS = { INBOUND_FREIGHT: 1.011, IC: 0.95, INT: 0.12 };
const AXIS_CONSTANTS = { INBOUND_FREIGHT: 1.015, IC: 0.97, INT: 0.12 };

const ITEM_CAMPOS_CLIENTE = Object.freeze([
  'id',
  'cotizacion_id',
  'producto_id',
  'marca',
  'sku',
  'mpn',
  'descripcion',
  'cantidad',
  'precio_unitario',
  'precio_total',
  'tiempo_entrega',
  'orden'
]);

const redondear = (valor, decimales = 2) => {
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

const normalizarOrigen = (origen, item = {}) => {
  const valor = String(origen || '').trim().toUpperCase();
  if (valor === 'AXIS' || valor === 'QNAP') return valor;
  const texto = `${item.marca || ''} ${item.sku || ''} ${item.mpn || ''} ${item.descripcion || ''}`.toLowerCase();
  return texto.includes('axis') ? 'AXIS' : 'QNAP';
};

/** Costo puesto en Chile antes de rebates: la misma cadena que usa el cotizador. */
const costoXCL = (origen, precioDisty) => {
  const c = origen === 'AXIS' ? AXIS_CONSTANTS : QNAP_CONSTANTS;
  return ((numero(precioDisty) * c.INBOUND_FREIGHT) / c.IC) * (1 + c.INT);
};

/** Costo final unitario: costo XCL menos rebates, nunca negativo. */
const costoFinal = ({ origen, precio_disty, rebate_partner, rebate_proyecto }) =>
  Math.max(costoXCL(origen, precio_disty) - numero(rebate_partner) - numero(rebate_proyecto), 0);

// gp es DECIMAL(5,4): un margen negativo muy grande no cabe, se acota.
const acotarGp = (gp) => Math.min(Math.max(gp, -9.9999), 0.9999);

/**
 * Normaliza una linea que viene del editor (admin). El editor manda el
 * costo_unitario que muestra en pantalla y se respeta: recalcularlo aca cada vez
 * cambiaria en silencio el margen de lineas antiguas guardadas con otros
 * parametros de calculo. Solo si no viene costo se calcula desde el disty.
 * El gp y los totales siempre se derivan en el servidor.
 */
const normalizarLineaAdmin = (entrada, indice = 0) => {
  const cantidad = Math.max(1, Math.trunc(numero(entrada?.cantidad, 1)) || 1);
  const origen = normalizarOrigen(entrada?.origen, entrada);
  const precioDisty = Math.max(numero(entrada?.precio_disty), 0);
  const rebatePartner = origen === 'AXIS' ? numeroONull(entrada?.rebate_partner) : null;
  const rebateProyecto = origen === 'AXIS' ? numeroONull(entrada?.rebate_proyecto) : null;
  const precioUnitario = redondear(Math.max(numero(entrada?.precio_unitario), 0));

  const enviado = numeroONull(entrada?.costo_unitario);
  const gpEnviado = numeroONull(entrada?.gp);
  let costoUnitario = null;
  if (enviado !== null && enviado >= 0) {
    costoUnitario = redondear(enviado);
  } else if (gpEnviado !== null && gpEnviado > 0 && gpEnviado < 1 && precioUnitario > 0) {
    // Lo que manda el cotizador al crear: precio = costo / (1 - gp).
    costoUnitario = redondear(precioUnitario * (1 - gpEnviado));
  } else if (precioDisty > 0) {
    costoUnitario = redondear(
      costoFinal({ origen, precio_disty: precioDisty, rebate_partner: rebatePartner, rebate_proyecto: rebateProyecto })
    );
  }

  const gp = costoUnitario !== null && precioUnitario > 0 ? acotarGp(1 - costoUnitario / precioUnitario) : null;

  return {
    producto_id: Number.isFinite(Number(entrada?.producto_id)) && Number(entrada.producto_id) > 0
      ? Number(entrada.producto_id)
      : null,
    marca: String(entrada?.marca || '').slice(0, 100),
    sku: String(entrada?.sku || '').slice(0, 100),
    mpn: String(entrada?.mpn || '').slice(0, 100),
    descripcion: String(entrada?.descripcion || ''),
    origen,
    precio_disty: redondear(precioDisty),
    rebate_partner: rebatePartner === null ? null : redondear(rebatePartner),
    rebate_proyecto: rebateProyecto === null ? null : redondear(rebateProyecto),
    partner_category: origen === 'AXIS' && entrada?.partner_category ? String(entrada.partner_category).slice(0, 60) : null,
    costo_unitario: costoUnitario,
    gp: gp === null ? 0 : redondear(gp, 4),
    cantidad,
    precio_unitario: precioUnitario,
    precio_total: redondear(precioUnitario * cantidad),
    tiempo_entrega: String(entrada?.tiempo_entrega || '').slice(0, 200),
    orden: Number.isFinite(Number(entrada?.orden)) ? Math.trunc(Number(entrada.orden)) : indice
  };
};

/** Campos permitidos para cualquier rol que no sea admin. Todo lo demas se cae. */
const vistaCliente = (item) => {
  const salida = {};
  for (const campo of ITEM_CAMPOS_CLIENTE) {
    if (item && Object.prototype.hasOwnProperty.call(item, campo)) salida[campo] = item[campo];
  }
  return salida;
};

/** Vista interna: todo, mas el margen calculado cuando hay costo. */
const vistaAdmin = (item) => {
  const precio = numero(item?.precio_unitario);
  const costo = numeroONull(item?.costo_unitario);
  const cantidad = numero(item?.cantidad, 1);
  const margenUnitario = costo === null ? null : redondear(precio - costo);
  return {
    ...item,
    margen_unitario: margenUnitario,
    margen_total: margenUnitario === null ? null : redondear(margenUnitario * cantidad),
    margen_pct: costo === null || precio <= 0 ? null : redondear(((precio - costo) / precio) * 100, 2)
  };
};

const esAdminCompleto = (role) => String(role || '').toLowerCase() === 'admin';

const serializarItems = (items, role) =>
  (Array.isArray(items) ? items : []).map((item) => (esAdminCompleto(role) ? vistaAdmin(item) : vistaCliente(item)));

/** Totales de una cotizacion. Solo el admin recibe costo y margen. */
const resumen = (items, role) => {
  const lista = Array.isArray(items) ? items : [];
  const venta = redondear(lista.reduce((suma, i) => suma + numero(i.precio_total), 0));
  if (!esAdminCompleto(role)) return { venta };
  const conCosto = lista.filter((i) => numeroONull(i.costo_unitario) !== null);
  const costo = redondear(conCosto.reduce((suma, i) => suma + numero(i.costo_unitario) * numero(i.cantidad, 1), 0));
  const ventaConCosto = redondear(conCosto.reduce((suma, i) => suma + numero(i.precio_total), 0));
  return {
    venta,
    costo,
    margen: redondear(ventaConCosto - costo),
    margen_pct: ventaConCosto > 0 ? redondear(((ventaConCosto - costo) / ventaConCosto) * 100, 2) : null,
    lineas_sin_costo: lista.length - conCosto.length
  };
};

const COLUMNAS_INSERT = [
  'cotizacion_id',
  'producto_id',
  'marca',
  'sku',
  'mpn',
  'descripcion',
  'origen',
  'precio_disty',
  'rebate_partner',
  'rebate_proyecto',
  'partner_category',
  'costo_unitario',
  'gp',
  'cantidad',
  'precio_unitario',
  'precio_total',
  'tiempo_entrega',
  'orden'
];

/** Inserta lineas ya normalizadas en un solo INSERT. */
const insertarItems = async (client, cotizacionId, items) => {
  if (!Array.isArray(items) || items.length === 0) return;
  const valores = [];
  const placeholders = items.map((item, fila) => {
    const base = fila * COLUMNAS_INSERT.length;
    for (const columna of COLUMNAS_INSERT) {
      valores.push(columna === 'cotizacion_id' ? cotizacionId : item[columna] ?? null);
    }
    return `(${COLUMNAS_INSERT.map((_, i) => `$${base + i + 1}`).join(', ')})`;
  });
  await client.query(
    `INSERT INTO cotizacion_items (${COLUMNAS_INSERT.join(', ')}) VALUES ${placeholders.join(', ')}`,
    valores
  );
};

/**
 * Migracion idempotente y aislada (como la del folio): columnas de costo y
 * version, tabla de versiones, y backfill del costo de las lineas antiguas.
 * precio = costo / (1 - gp)  =>  costo = precio * (1 - gp): exacto para toda
 * linea que se guardo con su gp, sin depender de las constantes de ese dia.
 */
const ensureCotizacionEdicion = async (pool) => {
  const sentencias = [
    `ALTER TABLE cotizacion_items ADD COLUMN IF NOT EXISTS origen VARCHAR(20)`,
    `ALTER TABLE cotizacion_items ADD COLUMN IF NOT EXISTS rebate_partner DECIMAL(12,2)`,
    `ALTER TABLE cotizacion_items ADD COLUMN IF NOT EXISTS rebate_proyecto DECIMAL(12,2)`,
    `ALTER TABLE cotizacion_items ADD COLUMN IF NOT EXISTS partner_category VARCHAR(60)`,
    `ALTER TABLE cotizacion_items ADD COLUMN IF NOT EXISTS costo_unitario DECIMAL(12,2)`,
    `ALTER TABLE cotizacion_items ADD COLUMN IF NOT EXISTS orden INTEGER`,
    `ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)`,
    `CREATE TABLE IF NOT EXISTS cotizacion_versiones (
       id SERIAL PRIMARY KEY,
       cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
       version INTEGER NOT NULL,
       snapshot JSONB NOT NULL,
       total DECIMAL(12,2),
       nota TEXT,
       creado_por VARCHAR(50),
       creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS cotizacion_versiones_idx ON cotizacion_versiones(cotizacion_id, version)`,
    `UPDATE cotizacion_items ci SET origen = p.origen
       FROM productos p
      WHERE ci.producto_id = p.id AND ci.origen IS NULL AND p.origen IS NOT NULL`,
    `UPDATE cotizacion_items
        SET costo_unitario = ROUND(precio_unitario * (1 - gp), 2)
      WHERE costo_unitario IS NULL AND gp > 0 AND gp < 1 AND precio_unitario > 0`
  ];
  try {
    for (const sql of sentencias) await pool.query(sql);
    console.log('Edicion de cotizaciones lista (costo, versiones).');
  } catch (error) {
    console.error('Error preparando la edicion de cotizaciones:', error);
  }
};

module.exports = {
  QNAP_CONSTANTS,
  AXIS_CONSTANTS,
  ITEM_CAMPOS_CLIENTE,
  costoXCL,
  costoFinal,
  normalizarOrigen,
  normalizarLineaAdmin,
  vistaCliente,
  vistaAdmin,
  serializarItems,
  resumen,
  insertarItems,
  ensureCotizacionEdicion,
  esAdminCompleto
};

// Constantes y mapas puros del Cotizador.
// Extraídos de CotizadorPage para reutilizarlos desde las vistas y poder testearlos.

export const CONSTANTS = { INBOUND_FREIGHT: 1.011, IC: 0.95, INT: 0.12, DEFAULT_GP: 0.15 };
export const AXIS_CONSTANTS = { INBOUND_FREIGHT: 1.015, IC: 0.97, INT: 0.12 };

// Cadena de costo por origen de línea: costo Chile = disty x freight / IC x (1 + INT).
// Espejo EXACTO de CADENA_POR_ORIGEN en backend/src/services/cotizacionItems.js: si cambia
// allá, cambia aquí. Los orígenes de quote ISS, NEURAL, VAIDIO, MILESTONE y MILESTONE_HW no llevan
// flete de entrada ni factor IC: solo transporte y arancel (INT) sobre el costo del quote.
// VELASEA (también se cotiza desde su quote) lleva el flete de entrada de QNAP, sin IC.
export const CADENA_POR_ORIGEN = Object.freeze({
  AXIS: Object.freeze({ INBOUND_FREIGHT: AXIS_CONSTANTS.INBOUND_FREIGHT, IC: AXIS_CONSTANTS.IC, INT: AXIS_CONSTANTS.INT }),
  QNAP: Object.freeze({ INBOUND_FREIGHT: CONSTANTS.INBOUND_FREIGHT, IC: CONSTANTS.IC, INT: CONSTANTS.INT }),
  ISS: Object.freeze({ INBOUND_FREIGHT: 1, IC: 1, INT: 0.15 }),
  NEURAL: Object.freeze({ INBOUND_FREIGHT: 1, IC: 1, INT: 0.15 }),
  VAIDIO: Object.freeze({ INBOUND_FREIGHT: 1, IC: 1, INT: 0.15 }),
  MILESTONE: Object.freeze({ INBOUND_FREIGHT: 1, IC: 1, INT: 0 }),
  MILESTONE_HW: Object.freeze({ INBOUND_FREIGHT: 1, IC: 1, INT: 0.12 }),
  // Velasea: igual que QNAP pero sin factor IC.
  VELASEA: Object.freeze({ INBOUND_FREIGHT: CONSTANTS.INBOUND_FREIGHT, IC: 1, INT: CONSTANTS.INT })
});

// Cómo se rotula en pantalla una línea que viene de un quote de fabricante.
export const ETIQUETA_ORIGEN_QUOTE = Object.freeze({
  ISS: 'Quote ISS',
  NEURAL: 'Quote Neural Labs',
  VAIDIO: 'Quote Vaidio',
  MILESTONE: 'Quote Milestone · licencia',
  MILESTONE_HW: 'Quote Milestone · servidor',
  VELASEA: 'Quote Velasea'
});

export const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const STOCK_DELIVERY_SUFFIX = 'unidades disponible en entrega inmediata, salvo venta previa';

export const SESSION_STORAGE_KEY = 'activeSessionsByUser';
export const SESSION_ID_KEY = 'sessionId';
export const DEVICE_ID_KEY = 'deviceId';
export const SESSION_TTL_MS = 10 * 60 * 1000;
export const SESSION_HEARTBEAT_MS = 30 * 1000;

export const DEFAULT_AXIS_PARTNER = 'Partner Autorizado';
// Las etapas de una cotización son las del CRM: ver ETAPAS en features/crm/formato.js.

export const COTIZADOR_STOCK_ADMIN_ROLE = 'cot_stock_admin';

export const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('es-CL', { month: 'short', year: 'numeric' });

export const COLUMN_MAP = {
  marca: ['marca', 'brand', 'fabricante'],
  sku: ['sku', 'codigo', 'code', 'partnumber'],
  mpn: ['mpn', 'model', 'modelo'],
  desc: ['descripción', 'descripcion', 'description', 'producto', 'nombre'],
  precio: ['pricedisty', 'precio disty', 'preciodisty', 'precio', 'cost', 'price'],
  gp: ['gp', 'margen', 'margin'],
  tiempo: ['tiempo', 'entrega', 'leadtime', 'tiempo entrega']
};

export const VIEW_TO_ROUTE = {
  dashboard: '/dashboard',
  cotizador: '/cotizador',
  historial: '/historial',
  ia: '/ia',
  crm: '/crm',
  usuarios: '/admin/usuarios',
  ordenes: '/admin/ordenes',
  login: '/login'
};

export const ROUTE_TO_VIEW = {
  '/dashboard': 'dashboard',
  '/cotizador': 'cotizador',
  '/historial': 'historial',
  '/ia': 'ia',
  '/crm': 'crm',
  '/admin/usuarios': 'usuarios',
  '/admin/ordenes': 'ordenes',
  '/login': 'cotizador'
};

export const ADMIN_VIEWS = new Set(['admin', 'usuarios', 'ordenes', 'compras', 'crm']);

// Constantes y mapas puros del Cotizador.
// Extraídos de CotizadorPage para reutilizarlos desde las vistas y poder testearlos.

export const CONSTANTS = { INBOUND_FREIGHT: 1.011, IC: 0.95, INT: 0.12, DEFAULT_GP: 0.15 };
export const AXIS_CONSTANTS = { INBOUND_FREIGHT: 1.015, IC: 0.97, INT: 0.12 };
export const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const STOCK_DELIVERY_SUFFIX = 'unidades disponible en entrega inmediata, salvo venta previa';

export const SESSION_STORAGE_KEY = 'activeSessionsByUser';
export const SESSION_ID_KEY = 'sessionId';
export const DEVICE_ID_KEY = 'deviceId';
export const SESSION_TTL_MS = 10 * 60 * 1000;
export const SESSION_HEARTBEAT_MS = 30 * 1000;

export const DEFAULT_AXIS_PARTNER = 'Partner Autorizado';
export const COTIZACION_ESTADOS = [
  { value: 'enviada', label: 'Cotización Enviada', short: 'E' },
  { value: 'revision', label: 'Cotización en Revisión', short: 'R' },
  { value: 'rechazada', label: 'Cotización Rechazada', short: 'X' },
  { value: 'aprobada', label: 'Cotización Aceptada', short: 'A' }
];

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
  usuarios: '/admin/usuarios',
  ordenes: '/admin/ordenes',
  login: '/login'
};

export const ROUTE_TO_VIEW = {
  '/dashboard': 'dashboard',
  '/cotizador': 'cotizador',
  '/historial': 'historial',
  '/admin/usuarios': 'usuarios',
  '/admin/ordenes': 'ordenes',
  '/login': 'cotizador'
};

export const ADMIN_VIEWS = new Set(['admin', 'usuarios', 'ordenes', 'compras']);

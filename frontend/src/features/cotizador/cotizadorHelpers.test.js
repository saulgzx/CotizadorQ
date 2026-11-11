import { vi } from 'vitest';
import {
  buildSearchTokens,
  calcularPrecioCliente,
  canAccessComprasView,
  canChangeOwnPartnerCategory,
  canManageCotizadorStock,
  clearSessionForUser,
  findValue,
  formatCurrency,
  formatDateTime,
  formatInvoiceMonthLabel,
  formatStockQuantity,
  getIntcomexProfile,
  getOrCreateDeviceId,
  getOrCreateSessionId,
  getUserKey,
  isIntcomexUser,
  isIntcomexVentas,
  isSessionActive,
  loadPdfDeps,
  normalizeIntcomexProfile,
  normalizeLookupKey,
  normalizeRole,
  normalizeSearchText,
  normalizeText,
  parseGp,
  pruneSessions,
  readSessionsByUser,
  registerSessionForUser,
  safeJsonParse,
  safeJsonParseArray,
  updateSessionHeartbeat
} from './cotizadorHelpers';
import { SESSION_ID_KEY, SESSION_STORAGE_KEY, SESSION_TTL_MS, DEVICE_ID_KEY } from './cotizadorConstants';

describe('JSON seguro', () => {
  test('safeJsonParse solo acepta objetos planos', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2]', 'fb')).toBe('fb');
    expect(safeJsonParse('5', 'fb')).toBe('fb');
    expect(safeJsonParse('null', 'fb')).toBe('fb');
    expect(safeJsonParse(null, 'fb')).toBe('fb');
    expect(safeJsonParse('{roto', 'fb')).toBe('fb');
  });

  test('safeJsonParseArray solo acepta arreglos y su fallback por defecto es []', () => {
    expect(safeJsonParseArray('[1,2]')).toEqual([1, 2]);
    expect(safeJsonParseArray('{"a":1}')).toEqual([]);
    expect(safeJsonParseArray('xx')).toEqual([]);
    expect(safeJsonParseArray(undefined, ['x'])).toEqual(['x']);
  });
});

describe('usuario y roles', () => {
  test('getUserKey prioriza id > user_id > usuario_id > usuario > username > email, en minuscula y sin espacios', () => {
    expect(getUserKey({ id: 5, usuario: 'ana' })).toBe('5');
    expect(getUserKey({ user_id: 'U-9' })).toBe('u-9');
    expect(getUserKey({ usuario_id: 3 })).toBe('3');
    expect(getUserKey({ usuario: '  Ana  ' })).toBe('ana');
    expect(getUserKey({ username: 'BOB' })).toBe('bob');
    expect(getUserKey({ email: 'A@B.cl' })).toBe('a@b.cl');
    expect(getUserKey({})).toBe('');
    expect(getUserKey(null)).toBe('');
  });

  test('getUserKey: un id 0 cuenta como valor (usa ??), no cae al siguiente campo', () => {
    expect(getUserKey({ id: 0, usuario: 'ana' })).toBe('0');
  });

  test('normalizeRole / normalizeText', () => {
    expect(normalizeRole('ADMIN')).toBe('admin');
    expect(normalizeRole(undefined)).toBe('');
    expect(normalizeText('  HoLa ')).toBe('hola');
    expect(normalizeText(null)).toBe('');
  });

  test('canManageCotizadorStock: admin y cot_stock_admin (sin importar mayusculas)', () => {
    expect(canManageCotizadorStock('admin')).toBe(true);
    expect(canManageCotizadorStock('COT_STOCK_ADMIN')).toBe(true);
    expect(canManageCotizadorStock('client')).toBe(false);
    expect(canManageCotizadorStock(undefined)).toBe(false);
  });

  test('perfil Intcomex: solo ventas/compras son validos', () => {
    expect(normalizeIntcomexProfile(' Ventas ')).toBe('ventas');
    expect(normalizeIntcomexProfile('COMPRAS')).toBe('compras');
    expect(normalizeIntcomexProfile('otro')).toBe('');
    expect(isIntcomexUser({ empresa: ' Intcomex ' })).toBe(true);
    expect(isIntcomexUser({ empresa: 'Otra' })).toBe(false);
    expect(getIntcomexProfile({ intcomex_profile: 'Compras' })).toBe('compras');
  });

  test('canAccessComprasView: admin siempre; Intcomex solo con perfil compras', () => {
    expect(canAccessComprasView({ role: 'admin' })).toBe(true);
    expect(canAccessComprasView({ role: 'client', empresa: 'intcomex', intcomex_profile: 'compras' })).toBe(true);
    expect(canAccessComprasView({ role: 'client', empresa: 'intcomex', intcomex_profile: 'ventas' })).toBe(false);
    expect(canAccessComprasView({ role: 'client', empresa: 'otra', intcomex_profile: 'compras' })).toBe(false);
    expect(canAccessComprasView(null)).toBe(false);
  });

  test('canChangeOwnPartnerCategory: admin o Intcomex ventas; cot_stock_admin NO', () => {
    expect(canChangeOwnPartnerCategory({ role: 'admin' })).toBe(true);
    expect(isIntcomexVentas({ empresa: 'intcomex', intcomex_profile: 'ventas' })).toBe(true);
    expect(canChangeOwnPartnerCategory({ role: 'client', empresa: 'intcomex', intcomex_profile: 'ventas' })).toBe(true);
    expect(canChangeOwnPartnerCategory({ role: 'cot_stock_admin' })).toBe(false);
    expect(canChangeOwnPartnerCategory({ role: 'client', empresa: 'intcomex', intcomex_profile: 'compras' })).toBe(false);
  });
});

describe('sesiones locales (localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('getOrCreateDeviceId / getOrCreateSessionId generan una vez y reutilizan', () => {
    const dev = getOrCreateDeviceId();
    const ses = getOrCreateSessionId();
    expect(dev).toBeTruthy();
    expect(ses).toBeTruthy();
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(dev);
    expect(localStorage.getItem(SESSION_ID_KEY)).toBe(ses);
    expect(getOrCreateDeviceId()).toBe(dev);
    expect(getOrCreateSessionId()).toBe(ses);
  });

  test('getOrCreate* respeta un valor ya guardado', () => {
    localStorage.setItem(SESSION_ID_KEY, 'ses-fija');
    expect(getOrCreateSessionId()).toBe('ses-fija');
  });

  test('readSessionsByUser: vacio, corrupto o arreglo => {}', () => {
    expect(readSessionsByUser()).toEqual({});
    localStorage.setItem(SESSION_STORAGE_KEY, 'roto');
    expect(readSessionsByUser()).toEqual({});
    localStorage.setItem(SESSION_STORAGE_KEY, '[]');
    expect(readSessionsByUser()).toEqual({});
  });

  test('pruneSessions descarta entradas invalidas o vencidas (TTL 10 min)', () => {
    const now = 10_000_000;
    const lista = [
      { id: 'ok', lastSeen: now - 1000 },
      { id: 'viejo', lastSeen: now - SESSION_TTL_MS },
      { id: 'sin-lastseen' },
      { lastSeen: now },
      null
    ];
    expect(pruneSessions(lista, now).map((s) => s.id)).toEqual(['ok']);
    expect(pruneSessions(undefined, now)).toEqual([]);
  });

  test('registerSessionForUser sin clave de usuario: permitido y no escribe', () => {
    expect(registerSessionForUser({})).toEqual({ allowed: true });
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  test('registerSessionForUser registra la sesion actual; repetir solo refresca lastSeen', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const r1 = registerSessionForUser({ id: 1, role: 'client' });
    expect(r1).toMatchObject({ allowed: true, userKey: '1', kickedSessionId: null, limit: 1 });
    expect(r1.sessionId).toBe(localStorage.getItem(SESSION_ID_KEY));

    now.mockReturnValue(1_000_500);
    const r2 = registerSessionForUser({ id: 1, role: 'client' });
    expect(r2.kickedSessionId).toBeNull();
    const lista = readSessionsByUser()['1'];
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ startedAt: 1_000_000, lastSeen: 1_000_500, role: 'client' });
  });

  test('limite de sesiones: cliente 1 (la mas antigua se expulsa), admin 2', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ '1': [{ id: 'otra', lastSeen: 999_000 }], '2': [{ id: 'a1', lastSeen: 999_000 }] }));
    localStorage.setItem(SESSION_ID_KEY, 'esta');

    const cliente = registerSessionForUser({ id: 1, role: 'client' });
    expect(cliente.kickedSessionId).toBe('otra');
    expect(cliente.limit).toBe(1);
    expect(readSessionsByUser()['1'].map((s) => s.id)).toEqual(['esta']);

    const admin = registerSessionForUser({ id: 2, role: 'admin' });
    expect(admin.kickedSessionId).toBeNull();
    expect(admin.limit).toBe(2);
    expect(readSessionsByUser()['2'].map((s) => s.id)).toEqual(['a1', 'esta']);
  });

  test('heartbeat e isSessionActive', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const user = { id: 1, role: 'client' };
    expect(isSessionActive({})).toBe(true); // sin clave de usuario no se controla
    expect(isSessionActive(user)).toBe(false); // sin sessionId
    expect(updateSessionHeartbeat(user)).toBe(false);

    registerSessionForUser(user);
    expect(isSessionActive(user)).toBe(true);
    now.mockReturnValue(1_000_900);
    expect(updateSessionHeartbeat(user)).toBe(true);
    expect(readSessionsByUser()['1'][0].lastSeen).toBe(1_000_900);

    now.mockReturnValue(1_000_900 + SESSION_TTL_MS + 1);
    expect(isSessionActive(user)).toBe(false);
    expect(updateSessionHeartbeat(user)).toBe(false);
    expect(updateSessionHeartbeat({})).toBe(false);
  });

  test('clearSessionForUser quita la sesion actual y borra la clave si queda vacia', () => {
    localStorage.setItem(SESSION_ID_KEY, 'esta');
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        '1': [{ id: 'esta', lastSeen: 1_000_000 }, { id: 'otra', lastSeen: 1_000_000 }],
        '2': [{ id: 'esta', lastSeen: 1_000_000 }]
      })
    );
    clearSessionForUser({ id: 1 });
    clearSessionForUser({ id: 2 });
    const guardado = readSessionsByUser();
    expect(guardado['1'].map((s) => s.id)).toEqual(['otra']);
    expect(guardado['2']).toBeUndefined();
    expect(() => clearSessionForUser({})).not.toThrow();
  });
});

describe('precios y formato', () => {
  test('calcularPrecioCliente: costo*flete/IC*(1+INT)/(1-gp) con GP por defecto 15%', () => {
    expect(calcularPrecioCliente(1000)).toBeCloseTo(1402.2539, 3);
    expect(calcularPrecioCliente(1000, 0.2)).toBeCloseTo(1489.8947, 3);
    expect(calcularPrecioCliente(0)).toBe(0);
  });

  test('calcularPrecioCliente acepta constantes propias', () => {
    const params = { INBOUND_FREIGHT: 1, IC: 1, INT: 0 };
    expect(calcularPrecioCliente(100, 0.5, params)).toBe(200);
  });

  test('calcularPrecioCliente con gp = 1 da Infinity (no valida; por eso existe parseGp)', () => {
    expect(calcularPrecioCliente(100, 1)).toBe(Infinity);
  });

  test('parseGp: decimal, porcentaje y valores invalidos caen al fallback', () => {
    expect(parseGp('0.2')).toBe(0.2);
    expect(parseGp(20)).toBe(0.2);
    expect(parseGp('25%')).toBe(0.25);
    expect(parseGp(0)).toBe(0);
    expect(parseGp(1)).toBe(0.15); // 1 => division por cero => fallback
    expect(parseGp(150)).toBe(0.15); // 1.5 => fallback
    expect(parseGp(-0.1)).toBe(0.15);
    expect(parseGp('abc')).toBe(0.15);
    expect(parseGp('abc', 0.3)).toBe(0.3);
  });

  test('formatCurrency en USD con separador de miles', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(-5)).toBe('-$5.00');
  });

  test('formatDateTime: vacio o invalido => "N/A"; valido => texto con el anio', () => {
    expect(formatDateTime('')).toBe('N/A');
    expect(formatDateTime(null)).toBe('N/A');
    expect(formatDateTime('no-es-fecha')).toBe('N/A');
    expect(formatDateTime('2025-03-15T12:00:00Z')).toContain('2025');
  });

  test('formatInvoiceMonthLabel: AAAA-MM => mes abreviado sin punto; otro formato se devuelve igual', () => {
    const etiqueta = formatInvoiceMonthLabel('2025-03');
    expect(etiqueta).toContain('2025');
    expect(etiqueta).toMatch(/mar/i);
    expect(etiqueta).not.toContain('.');
    expect(formatInvoiceMonthLabel('marzo')).toBe('marzo');
    expect(formatInvoiceMonthLabel('')).toBe('Sin mes');
    expect(formatInvoiceMonthLabel(null)).toBe('Sin mes');
  });
});

describe('busqueda y lectura de filas', () => {
  test('findValue: busca por nombre de columna sin distinguir mayusculas ni espacios del encabezado', () => {
    const fila = { ' SKU ': 'A1', Marca: 'QNAP', Precio: '', Cost: 0 };
    expect(findValue(fila, ['sku'])).toBe('A1');
    expect(findValue(fila, ['brand', 'marca'])).toBe('QNAP');
    expect(findValue(fila, ['precio'])).toBeNull(); // vacio se ignora
    expect(findValue(fila, ['precio', 'cost'])).toBe(0); // 0 es un valor valido
    expect(findValue(fila, ['nada'])).toBeNull();
    expect(findValue({}, ['sku'])).toBeNull();
  });

  test('normalizeLookupKey / normalizeSearchText / buildSearchTokens', () => {
    expect(normalizeLookupKey('  AbC ')).toBe('abc');
    expect(normalizeLookupKey(null)).toBe('');
    expect(normalizeSearchText('  NAS  Rack ')).toBe('nas  rack');
    expect(buildSearchTokens('  NAS   Rack 4bay ')).toEqual(['nas', 'rack', '4bay']);
    expect(buildSearchTokens('')).toEqual([]);
    expect(buildSearchTokens(undefined)).toEqual([]);
  });

  test('formatStockQuantity', () => {
    expect(formatStockQuantity(undefined)).toBe('');
    expect(formatStockQuantity(null)).toBe('');
    expect(formatStockQuantity('')).toBe('');
    expect(formatStockQuantity(0)).toBe('0');
    expect(formatStockQuantity('12')).toBe('12');
    expect(formatStockQuantity(2.5)).toBe('2.5');
    expect(formatStockQuantity('  varios  ')).toBe('varios');
  });
});

describe('loadPdfDeps', () => {
  afterEach(() => {
    delete window.html2canvas;
    delete window.jspdf;
  });

  test('si las librerias ya estan en window las devuelve sin cargar scripts', async () => {
    const jsPDF = function jsPDF() {};
    const html2canvas = () => {};
    window.html2canvas = html2canvas;
    window.jspdf = { jsPDF };
    await expect(loadPdfDeps()).resolves.toEqual({ html2canvas, jsPDF });
  });
});

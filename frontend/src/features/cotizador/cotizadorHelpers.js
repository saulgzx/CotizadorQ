// Helpers puros del Cotizador (sin React/hooks).
// Extraídos de CotizadorPage para reutilizarlos desde las vistas y poder testearlos.
import {
  CONSTANTS,
  CURRENCY_FORMATTER,
  MONTH_LABEL_FORMATTER,
  COTIZADOR_STOCK_ADMIN_ROLE,
  SESSION_STORAGE_KEY,
  SESSION_ID_KEY,
  DEVICE_ID_KEY,
  SESSION_TTL_MS
} from './cotizadorConstants';

export const safeJsonParse = (value, fallback) => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
};

export const safeJsonParseArray = (value, fallback = []) => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const getUserKey = (user) => {
  const raw = user?.id ?? user?.user_id ?? user?.usuario_id ?? user?.usuario ?? user?.username ?? user?.email ?? '';
  return raw.toString().toLowerCase().trim();
};

export const normalizeRole = (role) => (role || '').toString().toLowerCase();

export const canManageCotizadorStock = (role) => {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === COTIZADOR_STOCK_ADMIN_ROLE;
};

export const normalizeText = (value) => (value || '').toString().trim().toLowerCase();

export const normalizeIntcomexProfile = (value) => {
  const profile = normalizeText(value);
  return profile === 'ventas' || profile === 'compras' ? profile : '';
};

export const isIntcomexUser = (user) => normalizeText(user?.empresa) === 'intcomex';
export const getIntcomexProfile = (user) => normalizeIntcomexProfile(user?.intcomex_profile);

export const canAccessComprasView = (user) => {
  const role = normalizeRole(user?.role);
  if (role === 'admin') return true;
  return isIntcomexUser(user) && getIntcomexProfile(user) === 'compras';
};

export const isIntcomexVentas = (user) => isIntcomexUser(user) && getIntcomexProfile(user) === 'ventas';

export const canChangeOwnPartnerCategory = (user) => {
  const role = normalizeRole(user?.role);
  if (role === 'admin') return true;
  return isIntcomexVentas(user);
};

export const readSessionsByUser = () => safeJsonParse(localStorage.getItem(SESSION_STORAGE_KEY), {});

export const writeSessionsByUser = (data) => {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
};

export const getOrCreateDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = (crypto?.randomUUID?.() || `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
};

export const getOrCreateSessionId = () => {
  const existing = localStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const generated = (crypto?.randomUUID?.() || `ses_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  localStorage.setItem(SESSION_ID_KEY, generated);
  return generated;
};

export const pruneSessions = (sessions, now = Date.now()) =>
  (sessions || []).filter(s => s && s.id && s.lastSeen && (now - s.lastSeen) < SESSION_TTL_MS);

export const registerSessionForUser = (user) => {
  const userKey = getUserKey(user);
  if (!userKey) return { allowed: true };
  const now = Date.now();
  const sessionId = getOrCreateSessionId();
  const deviceId = getOrCreateDeviceId();
  const role = normalizeRole(user?.role);
  const limit = role === 'admin' ? 2 : 1;

  const allSessions = readSessionsByUser();
  const currentList = pruneSessions(allSessions[userKey], now);
  const existingIndex = currentList.findIndex(s => s.id === sessionId);

  let nextList = [...currentList];
  let kickedSessionId = null;

  if (existingIndex >= 0) {
    nextList[existingIndex] = {
      ...nextList[existingIndex],
      deviceId,
      role,
      lastSeen: now
    };
  } else {
    if (nextList.length >= limit) {
      nextList.sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0));
      const removed = nextList.shift();
      kickedSessionId = removed?.id || null;
    }
    nextList.push({
      id: sessionId,
      deviceId,
      role,
      userAgent: navigator.userAgent,
      startedAt: now,
      lastSeen: now
    });
  }

  allSessions[userKey] = nextList;
  writeSessionsByUser(allSessions);

  return { allowed: true, userKey, sessionId, kickedSessionId, limit };
};

export const updateSessionHeartbeat = (user) => {
  const userKey = getUserKey(user);
  if (!userKey) return false;
  const sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) return false;
  const allSessions = readSessionsByUser();
  const list = pruneSessions(allSessions[userKey]);
  const index = list.findIndex(s => s.id === sessionId);
  if (index === -1) return false;
  list[index] = { ...list[index], lastSeen: Date.now() };
  allSessions[userKey] = list;
  writeSessionsByUser(allSessions);
  return true;
};

export const isSessionActive = (user) => {
  const userKey = getUserKey(user);
  if (!userKey) return true;
  const sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) return false;
  const allSessions = readSessionsByUser();
  const list = pruneSessions(allSessions[userKey]);
  return list.some(s => s.id === sessionId);
};

export const clearSessionForUser = (user) => {
  const userKey = getUserKey(user);
  if (!userKey) return;
  const sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) return;
  const allSessions = readSessionsByUser();
  const list = (allSessions[userKey] || []).filter(s => s.id !== sessionId);
  if (list.length) {
    allSessions[userKey] = list;
  } else {
    delete allSessions[userKey];
  }
  writeSessionsByUser(allSessions);
};

export const calcularPrecioCliente = (precioDisty, gp = 0.15, params = CONSTANTS) => {
  const costoXUS = precioDisty * params.INBOUND_FREIGHT;
  const costoFinalXUS = costoXUS / params.IC;
  const costoXCL = costoFinalXUS * (1 + params.INT);
  return costoXCL / (1 - gp);
};

export const formatCurrency = (v) => CURRENCY_FORMATTER.format(v);

export const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
};

export const formatInvoiceMonthLabel = (monthKey) => {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return monthKey || 'Sin mes';
  const [year, month] = String(monthKey).split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return MONTH_LABEL_FORMATTER.format(d).replace('.', '');
};

export const findValue = (row, keys) => {
  const rowKeys = Object.keys(row);
  for (const key of keys) {
    const found = rowKeys.find(k => k.toLowerCase().trim() === key.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== '') return row[found];
  }
  return null;
};

export const parseGp = (value, fallback = CONSTANTS.DEFAULT_GP) => {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
};

export const normalizeLookupKey = (value) => String(value || '').trim().toLowerCase();

export const formatStockQuantity = (value) => {
  if (value === undefined || value === null || value === '') return '';
  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
  }
  return String(value).trim();
};

export const normalizeSearchText = (value) => String(value || '').toLowerCase().trim();

export const buildSearchTokens = (value) =>
  normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean);

let pdfDepsPromise = null;
export const loadPdfDeps = () => {
  if (window?.html2canvas && window?.jspdf?.jsPDF) {
    return Promise.resolve({ html2canvas: window.html2canvas, jsPDF: window.jspdf.jsPDF });
  }
  if (pdfDepsPromise) return pdfDepsPromise;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  pdfDepsPromise = (async () => {
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    if (!window?.html2canvas || !window?.jspdf?.jsPDF) {
      throw new Error('No se pudo cargar el generador de PDF');
    }
    return { html2canvas: window.html2canvas, jsPDF: window.jspdf.jsPDF };
  })();
  return pdfDepsPromise;
};

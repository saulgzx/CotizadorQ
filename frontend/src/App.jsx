import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { authAPI, productosAPI, cotizacionesAPI, usuariosAPI, sesionesAPI, osoAPI, boMetaAPI, stockAPI } from './api';

const CONSTANTS = { INBOUND_FREIGHT: 1.011, IC: 0.95, INT: 0.12, DEFAULT_GP: 0.15 };
const AXIS_CONSTANTS = { INBOUND_FREIGHT: 1.015, IC: 0.97, INT: 0.12 };
const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const STOCK_DELIVERY_SUFFIX = 'unidades disponible en entrega inmediata, salvo venta previa';

const SESSION_STORAGE_KEY = 'activeSessionsByUser';
const SESSION_ID_KEY = 'sessionId';
const DEVICE_ID_KEY = 'deviceId';
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_HEARTBEAT_MS = 30 * 1000;

const DEFAULT_AXIS_PARTNER = 'Partner Autorizado';
const COTIZACION_ESTADOS = [
  { value: 'enviada', label: 'Cotización Enviada', short: 'E' },
  { value: 'revision', label: 'Cotización en Revisión', short: 'R' },
  { value: 'rechazada', label: 'Cotización Rechazada', short: 'X' },
  { value: 'aprobada', label: 'Cotización Aceptada', short: 'A' }
];

const safeJsonParse = (value, fallback) => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
};

const getUserKey = (user) => {
  const raw = user?.id ?? user?.user_id ?? user?.usuario_id ?? user?.usuario ?? user?.username ?? user?.email ?? '';
  return raw.toString().toLowerCase().trim();
};

const normalizeRole = (role) => (role || '').toString().toLowerCase();

const readSessionsByUser = () => safeJsonParse(localStorage.getItem(SESSION_STORAGE_KEY), {});

const writeSessionsByUser = (data) => {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
};

const getOrCreateDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = (crypto?.randomUUID?.() || `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
};

const getOrCreateSessionId = () => {
  const existing = localStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const generated = (crypto?.randomUUID?.() || `ses_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  localStorage.setItem(SESSION_ID_KEY, generated);
  return generated;
};

const pruneSessions = (sessions, now = Date.now()) =>
  (sessions || []).filter(s => s && s.id && s.lastSeen && (now - s.lastSeen) < SESSION_TTL_MS);

const registerSessionForUser = (user) => {
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

const updateSessionHeartbeat = (user) => {
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

const isSessionActive = (user) => {
  const userKey = getUserKey(user);
  if (!userKey) return true;
  const sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) return false;
  const allSessions = readSessionsByUser();
  const list = pruneSessions(allSessions[userKey]);
  return list.some(s => s.id === sessionId);
};

const clearSessionForUser = (user) => {
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

const calcularPrecioCliente = (precioDisty, gp = 0.15, params = CONSTANTS) => {
  const costoXUS = precioDisty * params.INBOUND_FREIGHT;
  const costoFinalXUS = costoXUS / params.IC;
  const costoXCL = costoFinalXUS * (1 + params.INT);
  return costoXCL / (1 - gp);
};

const formatCurrency = (v) => CURRENCY_FORMATTER.format(v);
const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
};

const COLUMN_MAP = {
  marca: ['marca', 'brand', 'fabricante'],
  sku: ['sku', 'codigo', 'code', 'partnumber'],
  mpn: ['mpn', 'model', 'modelo'],
  desc: ['descripción', 'descripcion', 'description', 'producto', 'nombre'],
  precio: ['pricedisty', 'precio disty', 'preciodisty', 'precio', 'cost', 'price'],
  gp: ['gp', 'margen', 'margin'],
  tiempo: ['tiempo', 'entrega', 'leadtime', 'tiempo entrega']
};

const findValue = (row, keys) => {
  const rowKeys = Object.keys(row);
  for (const key of keys) {
    const found = rowKeys.find(k => k.toLowerCase().trim() === key.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== '') return row[found];
  }
  return null;
};

const parseGp = (value, fallback = CONSTANTS.DEFAULT_GP) => {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
};

const normalizeLookupKey = (value) => String(value || '').trim().toLowerCase();

const formatStockQuantity = (value) => {
  if (value === undefined || value === null || value === '') return '';
  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
  }
  return String(value).trim();
};

const normalizeSearchText = (value) => String(value || '').toLowerCase().trim();

const buildSearchTokens = (value) =>
  normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean);

let pdfDepsPromise = null;
const loadPdfDeps = () => {
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

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [currentView, setCurrentView] = useState('ordenes');
  const [productos, setProductos] = useState([]);
  const [stockByMpn, setStockByMpn] = useState({});
  const [stockCatalog, setStockCatalog] = useState([]);
  const [stockCatalogLoading, setStockCatalogLoading] = useState(false);
  const [stockCatalogError, setStockCatalogError] = useState('');
  const [stockCatalogQuery, setStockCatalogQuery] = useState('');
  const [stockCatalogOrigin, setStockCatalogOrigin] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState({ marca: '', sku: '', mpn: '', desc: '', precio: '', gp: '15', tiempo: 'ETA por confirmar' });
  const [searchTerm, setSearchTerm] = useState('');
  const [cotizacion, setCotizacion] = useState([]);
  const [cliente, setCliente] = useState({
    nombre: '',
    empresa: '',
    pid: '',
    proyecto: '',
    cliente_final: '',
    fecha_ejecucion: '',
    fecha_implementacion: '',
    vms: ''
  });
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const catalogInputRef = useRef(null);
  const [catalogDropdownStyle, setCatalogDropdownStyle] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [adminOrigin, setAdminOrigin] = useState('QNAP');
  const [cotizacionGpGlobalQnap, setCotizacionGpGlobalQnap] = useState(CONSTANTS.DEFAULT_GP);
  const [cotizacionGpGlobalAxis, setCotizacionGpGlobalAxis] = useState(CONSTANTS.DEFAULT_GP);
  const [cotizacionPartnerCategory, setCotizacionPartnerCategory] = useState(DEFAULT_AXIS_PARTNER);
  const [historial, setHistorial] = useState([]);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [historialError, setHistorialError] = useState('');
  const [osoOrders, setOsoOrders] = useState([]);
  const [osoLoading, setOsoLoading] = useState(false);
  const [osoError, setOsoError] = useState('');
  const [expandedBo, setExpandedBo] = useState(null);
  const [osoFilter, setOsoFilter] = useState(() => localStorage.getItem('osoFilter') || '');
  const [osoStatusFilter, setOsoStatusFilter] = useState(() => localStorage.getItem('osoStatusFilter') || 'all');
  const [missingBos, setMissingBos] = useState([]);
  const [showMissingBosModal, setShowMissingBosModal] = useState(false);
  const [deleteBoTarget, setDeleteBoTarget] = useState(null);
  const [deleteBoComment, setDeleteBoComment] = useState('');
  const [deleteBoError, setDeleteBoError] = useState('');
  const [deleteBoLoading, setDeleteBoLoading] = useState(false);
  const [invoicedSort, setInvoicedSort] = useState(() => localStorage.getItem('invoicedSort') || 'date');
  const [invoicedFilter, setInvoicedFilter] = useState(() => localStorage.getItem('invoicedFilter') || '');
  const [showInvoicedSection, setShowInvoicedSection] = useState(() => localStorage.getItem('showInvoicedSection') !== 'false');
  const [osoSort, setOsoSort] = useState(() => localStorage.getItem('osoSort') || 'eta');
  const [osoQuickFilter, setOsoQuickFilter] = useState(() => localStorage.getItem('osoQuickFilter') || 'all');
  const [osoInvoiceMonth, setOsoInvoiceMonth] = useState(() => localStorage.getItem('osoInvoiceMonth') || '');
  const [showOsoReportModal, setShowOsoReportModal] = useState(false);
  const [osoReportMode, setOsoReportMode] = useState('empresa');
  const [osoReportEdits, setOsoReportEdits] = useState({});
  const [showOsoFilters, setShowOsoFilters] = useState(false);
  const [osoReportSelect, setOsoReportSelect] = useState('');
  const [osoActionSelect, setOsoActionSelect] = useState('');
  const [osoCompanyFilter, setOsoCompanyFilter] = useState('');
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [pinnedBos, setPinnedBos] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('pinnedBos') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [boMeta, setBoMeta] = useState({});
  const [boDraft, setBoDraft] = useState({});
  const [boSaving, setBoSaving] = useState({});
  const [purchaseDraft, setPurchaseDraft] = useState({});
  const [funnelDays, setFunnelDays] = useState(30);
  const [funnelEmpresa, setFunnelEmpresa] = useState('');
  const [funnelFrom, setFunnelFrom] = useState('');
  const [funnelTo, setFunnelTo] = useState('');
  const [funnelData, setFunnelData] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelError, setFunnelError] = useState('');
  const [selectedHistorialIds, setSelectedHistorialIds] = useState(() => new Set());
  const [boByCotizacionId, setBoByCotizacionId] = useState({});
  const [compraPreviewCot, setCompraPreviewCot] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [usuariosLoading, setUsuariosLoading] = useState(false);
  const [usuariosError, setUsuariosError] = useState('');
  const [activeSessions, setActiveSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [selectedSessionUserId, setSelectedSessionUserId] = useState(null);
  const [userSessions, setUserSessions] = useState([]);
  const [userLogs, setUserLogs] = useState([]);
  const [userActivityLoading, setUserActivityLoading] = useState(false);
  const [userActivityError, setUserActivityError] = useState('');
  const [sessionAutoRefresh, setSessionAutoRefresh] = useState(true);
  const [expandedUsuarioId, setExpandedUsuarioId] = useState(null);
  const [expandedHistorialId, setExpandedHistorialId] = useState(null);
  const [dismissedRegistroById, setDismissedRegistroById] = useState({});
  const [empresaForm, setEmpresaForm] = useState({
    nombre: '',
    role: 'client',
    gp_qnap: '15',
    gp_axis: '15',
    partner_category: DEFAULT_AXIS_PARTNER,
    logo_url: ''
  });
  const [showEmpresaForm, setShowEmpresaForm] = useState(false);
  const [showUsuarioForm, setShowUsuarioForm] = useState(false);
  const [selectedUsuarioId, setSelectedUsuarioId] = useState(null);
  const [empresaConfigs, setEmpresaConfigs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('empresaConfigs') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('osoFilter', osoFilter || '');
  }, [osoFilter]);

  useEffect(() => {
    localStorage.setItem('osoStatusFilter', osoStatusFilter || 'all');
  }, [osoStatusFilter]);

  useEffect(() => {
    localStorage.setItem('invoicedSort', invoicedSort || 'date');
  }, [invoicedSort]);

  useEffect(() => {
    localStorage.setItem('invoicedFilter', invoicedFilter || '');
  }, [invoicedFilter]);

  useEffect(() => {
    localStorage.setItem('showInvoicedSection', showInvoicedSection ? 'true' : 'false');
  }, [showInvoicedSection]);

  useEffect(() => {
    localStorage.setItem('osoSort', osoSort || 'bo');
  }, [osoSort]);

  useEffect(() => {
    localStorage.setItem('osoQuickFilter', osoQuickFilter || 'all');
  }, [osoQuickFilter]);

  useEffect(() => {
    localStorage.setItem('osoInvoiceMonth', osoInvoiceMonth || '');
  }, [osoInvoiceMonth]);

  useEffect(() => {
    const safeList = Array.isArray(pinnedBos) ? pinnedBos : [];
    localStorage.setItem('pinnedBos', JSON.stringify(safeList));
  }, [pinnedBos]);

  useEffect(() => {
    if (currentView !== 'ordenes') return undefined;
    const savedScroll = Number(localStorage.getItem('osoScrollY') || 0);
    const hasExpanded = expandedBo ? osoOrders.some(order => order.bo === expandedBo) : true;
    if (savedScroll > 0 && hasExpanded) {
      requestAnimationFrame(() => window.scrollTo(0, savedScroll));
    }
    const handler = () => {
      localStorage.setItem('osoScrollY', window.scrollY.toString());
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [currentView, expandedBo, osoOrders]);

  const invoicedBos = useMemo(() => {
    const existing = new Set(osoOrders.map(order => order.bo));
    return Object.entries(boMeta)
      .filter(([bo, meta]) => meta?.invoiced && !meta?.deleted && !existing.has(bo))
      .map(([bo, meta]) => ({ bo, ...meta }))
      .sort((a, b) => new Date(b.invoicedAt || 0).getTime() - new Date(a.invoicedAt || 0).getTime());
  }, [boMeta, osoOrders]);

  const getOrderStatus = (order) => {
    const totalOrderQty = (order.lines || []).reduce((acc, line) => acc + (Number(line.orderQty) || 0), 0);
    const totalShippedQty = (order.lines || []).reduce((acc, line) => acc + (Number(line.shippedQty) || 0), 0);
    return totalOrderQty > 0
      ? (totalShippedQty >= totalOrderQty ? 'Completa' : (totalShippedQty > 0 ? 'Parcial' : 'Activa'))
      : 'Activa';
  };

  const sortedInvoicedBos = useMemo(() => {
    const query = (invoicedFilter || '').trim().toLowerCase();
    let list = [...invoicedBos];
    if (query) {
      list = list.filter(item =>
        (item.bo || '').toLowerCase().includes(query) ||
        (item.customerName || '').toLowerCase().includes(query) ||
        (item.projectName || '').toLowerCase().includes(query) ||
        (item.poAxis || '').toLowerCase().includes(query)
      );
    }
    if (invoicedSort === 'cliente') {
      return list.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    }
    if (invoicedSort === 'bo') {
      return list.sort((a, b) => (a.bo || '').localeCompare(b.bo || ''));
    }
    if (invoicedSort === 'lastSeen') {
      return list.sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime());
    }
    return list.sort((a, b) => new Date(b.invoicedAt || 0).getTime() - new Date(a.invoicedAt || 0).getTime());
  }, [invoicedBos, invoicedSort, invoicedFilter]);

  const osoStats = useMemo(() => {
    const stats = { total: osoOrders.length, activa: 0, parcial: 0, completa: 0 };
    osoOrders.forEach(order => {
      const status = getOrderStatus(order).toLowerCase();
      if (status === 'parcial') stats.parcial += 1;
      else if (status === 'completa') stats.completa += 1;
      else stats.activa += 1;
    });
    return stats;
  }, [osoOrders]);

  const safePinnedBos = useMemo(() => (Array.isArray(pinnedBos) ? pinnedBos : []), [pinnedBos]);

  const getOsoMeta = (bo) => {
    const meta = boMeta[bo] || {};
    const draft = boDraft[bo] || {};
    return { ...meta, ...draft };
  };

  const getOsoCustomerName = (order) =>
    (order?.customerName || getOsoMeta(order?.bo)?.customerName || 'Sin cliente').toString().trim() || 'Sin cliente';

  const filteredOsoOrders = useMemo(() => {
    const query = (osoFilter || '').trim().toLowerCase();
    const companyFilter = (osoCompanyFilter || '').trim().toLowerCase();
    const list = osoOrders.filter(order => {
      const bo = (order.bo || '').toString().toLowerCase();
      const customer = (order.customerName || '').toString().toLowerCase();
      const matchesText = !query || bo.includes(query) || customer.includes(query);
      if (!matchesText) return false;
      if (companyFilter) {
        const name = getOsoCustomerName(order).toLowerCase();
        if (name !== companyFilter) return false;
      }
      if (!osoStatusFilter || osoStatusFilter === 'all') return true;
      const status = getOrderStatus(order);
      return status.toLowerCase() === osoStatusFilter;
    });
    const filteredByQuick = list.filter(order => {
      const projectName = (boMeta[order.bo]?.projectName || '').trim();
      const poAxis = (boMeta[order.bo]?.poAxis || '').trim();
      const invoiceDate = boMeta[order.bo]?.estimatedInvoiceDate || '';
      const toMonthKey = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      };
      if (osoInvoiceMonth && toMonthKey(invoiceDate) !== osoInvoiceMonth) return false;
      const allowedQuickFilters = new Set(['all', 'sd-pending', 'missing-project', 'missing-po']);
      const quickFilter = allowedQuickFilters.has(osoQuickFilter) ? osoQuickFilter : 'all';
      if (!quickFilter || quickFilter === 'all') return true;
      if (quickFilter === 'sd-pending') return getSAndDStatus(order.bo) !== 'aplicado';
      if (quickFilter === 'missing-project') return !projectName;
      if (quickFilter === 'missing-po') return !poAxis;
      return true;
    });
    if (osoSort === 'empresa') {
      return [...filteredByQuick].sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    }
    if (osoSort === 'porcentaje') {
      return [...filteredByQuick].sort((a, b) => (Number(b.allocPct) || 0) - (Number(a.allocPct) || 0));
    }
    if (osoSort === 'eta') {
      const toTs = (value) => {
        if (!value) return Number.POSITIVE_INFINITY;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
      };
      return [...filteredByQuick].sort((a, b) => toTs(a.etaEstimated) - toTs(b.etaEstimated));
    }
    return [...filteredByQuick].sort((a, b) => (a.bo || '').localeCompare(b.bo || ''));
  }, [osoOrders, osoFilter, osoStatusFilter, osoSort, osoQuickFilter, osoInvoiceMonth, boMeta, osoCompanyFilter]);

  const osoCompanies = useMemo(() => {
    const map = new Map();
    osoOrders.forEach(order => {
      const name = getOsoCustomerName(order);
      map.set(name, (map.get(name) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [osoOrders, boMeta, boDraft]);

  const getOsoOrderTotals = (order) => {
    const totals = { orderQty: 0, shippedQty: 0, allocQty: 0 };
    (order?.lines || []).forEach(line => {
      totals.orderQty += Number(line.orderQty) || 0;
      totals.shippedQty += Number(line.shippedQty) || 0;
      totals.allocQty += Number(line.allocQty) || 0;
    });
    return totals;
  };

  const getOsoAllocPct = (order, totals) => {
    const meta = getOsoMeta(order?.bo);
    const raw = order?.allocPct ?? meta?.allocPct;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
    if (totals?.orderQty > 0) {
      return Math.round((totals.allocQty / totals.orderQty) * 1000) / 10;
    }
    return 0;
  };

  const toMonthKey = (value) => {
    if (!value) return 'Sin fecha';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Sin fecha';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const addDaysToIso = (isoDate, days) => {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const getAllocBucket = (pct) => {
    if (!Number.isFinite(pct)) return 'Sin %';
    if (pct < 25) return '0-24%';
    if (pct < 50) return '25-49%';
    if (pct < 75) return '50-74%';
    if (pct < 100) return '75-99%';
    return '>=100%';
  };

  const computeOsoStats = (orders) => {
    const stats = {
      total: orders.length,
      activa: 0,
      parcial: 0,
      completa: 0,
      totalOrderQty: 0,
      totalAllocQty: 0,
      totalShippedQty: 0,
      avgAllocPct: 0,
      etaOverdue: 0,
      etaSoon: 0
    };
    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    let allocPctSum = 0;
    orders.forEach(order => {
      const status = getOrderStatus(order).toLowerCase();
      if (status === 'parcial') stats.parcial += 1;
      else if (status === 'completa') stats.completa += 1;
      else stats.activa += 1;
      const totals = getOsoOrderTotals(order);
      stats.totalOrderQty += totals.orderQty;
      stats.totalAllocQty += totals.allocQty;
      stats.totalShippedQty += totals.shippedQty;
      allocPctSum += getOsoAllocPct(order, totals);
      if (order.etaEstimated) {
        const eta = new Date(order.etaEstimated);
        if (!Number.isNaN(eta.getTime())) {
          const etaUtc = Date.UTC(eta.getFullYear(), eta.getMonth(), eta.getDate());
          const diffDays = Math.round((etaUtc - todayUtc) / 86400000);
          if (diffDays < 0) stats.etaOverdue += 1;
          else if (diffDays <= 7) stats.etaSoon += 1;
        }
      }
    });
    stats.avgAllocPct = orders.length ? Math.round((allocPctSum / orders.length) * 10) / 10 : 0;
    return stats;
  };

  const buildOsoLineReportRows = (orders) => {
    const rows = [];
    orders.forEach(order => {
      const bo = order?.bo || '';
      const cliente = getOsoCustomerName(order);
      const customerPo = order?.customerPO || getOsoMeta(order?.bo)?.customerPO || '';
      (order.lines || []).forEach((line, idx) => {
        const entregaOor = line.tiempoEntrega || '';
        rows.push({
          key: `${bo}-${idx}-${line.sku || ''}-${line.mpn || ''}`.trim(),
          bo,
          customerPo,
          cliente,
          empresa: cliente,
          sku: line.sku || '',
          mpn: line.mpn || '',
          desc: line.desc || '',
          entregaOor,
          etaEstimado: entregaOor ? addDaysToIso(entregaOor, 15) : '',
          allocQty: line.allocQty ?? 0,
          orderQty: line.orderQty ?? 0,
          shippedQty: line.shippedQty ?? 0,
          notas: ''
        });
      });
    });
    return rows;
  };

  const updateOsoReportEdit = (key, patch) => {
    if (!key) return;
    setOsoReportEdits(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...patch
      }
    }));
  };

  const getOsoReportValue = (row, field) => {
    if (!row) return '';
    const edited = osoReportEdits[row.key]?.[field];
    return edited !== undefined ? edited : (row[field] ?? '');
  };

  const exportOsoReportPdf = () => {
    const element = document.getElementById('oso-report-pdf');
    const dateKey = getDateKey(new Date()) || 'export';
    const modeLabel = osoReportMode === 'proximas' ? 'proximas' : 'empresa';
    downloadPdfFromElement(element, `reporte-oso-${modeLabel}-${dateKey}`);
  };

  const exportOsoReportExcel = () => {
    const dateKey = getDateKey(new Date()) || 'export';
    const modeLabel = osoReportMode === 'proximas' ? 'proximas' : 'empresa';
    let rows = [];
    if (osoReportMode === 'empresa') {
      const grouped = new Map();
      osoLineReportRows.forEach(row => {
        const empresa = (getOsoReportValue(row, 'cliente') || 'Sin empresa').toString().trim() || 'Sin empresa';
        if (!grouped.has(empresa)) grouped.set(empresa, []);
        grouped.get(empresa).push(row);
      });
      rows = Array.from(grouped.entries()).flatMap(([empresa, items]) =>
        items.map(item => ({
          Empresa: empresa,
          BO: getOsoReportValue(item, 'bo'),
          'PO Cliente': getOsoReportValue(item, 'customerPo'),
          Cliente: getOsoReportValue(item, 'cliente'),
          MPN: item.mpn || 'N/A',
          SKU: item.sku || 'N/A',
          Producto: item.desc || 'N/A',
          'ETA Est.': getOsoReportValue(item, 'etaEstimado'),
          'Cant. Orden': item.orderQty,
          'Cant. Alocada': item.allocQty,
          'Cant. Despachada': item.shippedQty,
          Notas: getOsoReportValue(item, 'notas')
        }))
      );
    } else {
      const toTs = (value) => {
        if (!value) return Number.POSITIVE_INFINITY;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
      };
      rows = osoLineReportRows
        .map(row => ({
          ...row,
          etaEstimado: getOsoReportValue(row, 'etaEstimado'),
          cliente: getOsoReportValue(row, 'cliente'),
          bo: getOsoReportValue(row, 'bo'),
          customerPo: getOsoReportValue(row, 'customerPo'),
          notas: getOsoReportValue(row, 'notas')
        }))
        .filter(row => row.etaEstimado)
        .sort((a, b) => toTs(a.etaEstimado) - toTs(b.etaEstimado))
        .map(item => ({
          BO: item.bo,
          'PO Cliente': item.customerPo,
          Cliente: item.cliente,
          MPN: item.mpn || 'N/A',
          SKU: item.sku || 'N/A',
          Producto: item.desc || 'N/A',
          'ETA Est.': item.etaEstimado,
          'Cant. Orden': item.orderQty,
          'Cant. Alocada': item.allocQty,
          'Cant. Despachada': item.shippedQty,
          Notas: item.notas
        }));
    }
    if (!rows.length) {
      alert('No hay datos para exportar.');
      return;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Detalle');
    XLSX.writeFile(wb, `reporte-oso-${modeLabel}-${dateKey}.xlsx`);
  };

  const osoLineReportRows = useMemo(() => buildOsoLineReportRows(filteredOsoOrders), [filteredOsoOrders]);

  const exportOsoReport = () => {
    const orders = filteredOsoOrders;
    if (!orders.length) {
      alert('No hay órdenes para exportar con los filtros actuales.');
      return;
    }

    const detailRows = orders.map(order => {
      const totals = getOsoOrderTotals(order);
      const meta = getOsoMeta(order.bo);
      return {
        BO: order.bo || '',
        Cliente: getOsoCustomerName(order),
        '% Alocado': getOsoAllocPct(order, totals),
        Estado: getOrderStatus(order),
        'ETA Estimada': order.etaEstimated || '',
        'Planned Ship Date': order.plannedShipDate || '',
        'Fecha Facturación': meta.estimatedInvoiceDate || '',
        Proyecto: meta.projectName || '',
        'PO Axis': meta.poAxis || '',
        'Orden Cliente': order.customerPO || meta.customerPO || '',
        'S&D': getSAndDStatus(order.bo),
        'Cant. Orden': totals.orderQty,
        'Cant. Alocada': totals.allocQty,
        'Cant. Despachada': totals.shippedQty
      };
    });

    const customerMap = new Map();
    const etaMonthMap = new Map();
    const invoiceMonthMap = new Map();
    const allocBucketMap = new Map();

    orders.forEach(order => {
      const totals = getOsoOrderTotals(order);
      const customer = getOsoCustomerName(order);
      const allocPct = getOsoAllocPct(order, totals);
      const etaMonth = toMonthKey(order.etaEstimated);
      const invoiceMonth = toMonthKey(getOsoMeta(order.bo).estimatedInvoiceDate);
      const bucket = getAllocBucket(allocPct);

      const update = (map, key) => {
        if (!map.has(key)) {
          map.set(key, {
            key,
            orders: 0,
            totalOrderQty: 0,
            totalAllocQty: 0,
            totalShippedQty: 0,
            allocPctSum: 0
          });
        }
        const item = map.get(key);
        item.orders += 1;
        item.totalOrderQty += totals.orderQty;
        item.totalAllocQty += totals.allocQty;
        item.totalShippedQty += totals.shippedQty;
        item.allocPctSum += allocPct;
      };

      update(customerMap, customer);
      update(etaMonthMap, etaMonth);
      update(invoiceMonthMap, invoiceMonth);
      update(allocBucketMap, bucket);
    });

    const mapToRows = (map, label) =>
      Array.from(map.values())
        .map(item => ({
          [label]: item.key,
          'Órdenes': item.orders,
          'Cant. Orden': item.totalOrderQty,
          'Cant. Alocada': item.totalAllocQty,
          'Cant. Despachada': item.totalShippedQty,
          '% Alocado Prom.': item.orders ? Math.round((item.allocPctSum / item.orders) * 10) / 10 : 0
        }))
        .sort((a, b) => (b['Órdenes'] || 0) - (a['Órdenes'] || 0));

    const stats = computeOsoStats(orders);
    const uniqueCustomers = customerMap.size;
    const topCustomers = mapToRows(customerMap, 'Cliente')
      .slice(0, 5)
      .map(item => `${item.Cliente} (${item['Órdenes']})`)
      .join(', ');

    const summaryRows = [
      { Métrica: 'Total órdenes', Valor: stats.total },
      { Métrica: 'Clientes únicos', Valor: uniqueCustomers },
      { Métrica: 'Cant. Orden', Valor: stats.totalOrderQty },
      { Métrica: 'Cant. Alocada', Valor: stats.totalAllocQty },
      { Métrica: 'Cant. Despachada', Valor: stats.totalShippedQty },
      { Métrica: '% Alocado Promedio', Valor: `${stats.avgAllocPct}%` },
      { Métrica: 'Activas', Valor: stats.activa },
      { Métrica: 'Parciales', Valor: stats.parcial },
      { Métrica: 'Completas', Valor: stats.completa },
      { Métrica: 'ETA vencido', Valor: stats.etaOverdue },
      { Métrica: 'ETA <= 7 días', Valor: stats.etaSoon },
      { Métrica: 'Top clientes (órdenes)', Valor: topCustomers || 'N/A' },
      {
        Métrica: 'Filtros aplicados',
        Valor: `Texto="${osoFilter || '—'}", Estado="${osoStatusFilter}", Rápido="${osoQuickFilter}", Fact mes="${osoInvoiceMonth || '—'}"`
      }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Resumen');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(customerMap, 'Cliente')), 'Por Cliente');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(etaMonthMap, 'Mes ETA')), 'Por Mes ETA');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(invoiceMonthMap, 'Mes Fact')), 'Por Mes Fact');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(allocBucketMap, '% Alocado')), 'Por % Alocado');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detalle');

    const filename = `reporte-ordenes-${getDateKey(new Date()) || 'export'}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const copyOsoExecutiveSummary = () => {
    const orders = filteredOsoOrders;
    if (!orders.length) {
      alert('No hay órdenes para resumir con los filtros actuales.');
      return;
    }
    const stats = computeOsoStats(orders);
    const customerMap = new Map();
    orders.forEach(order => {
      const customer = getOsoCustomerName(order);
      customerMap.set(customer, (customerMap.get(customer) || 0) + 1);
    });
    const topCustomers = Array.from(customerMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name} (${count})`)
      .join(', ');

    const summary = [
      'Resumen ejecutivo - Órdenes Activas',
      `Fecha: ${new Date().toLocaleString()}`,
      `Órdenes: ${stats.total} | Clientes: ${customerMap.size}`,
      `Cant. Orden: ${stats.totalOrderQty} | Alocada: ${stats.totalAllocQty} | Despachada: ${stats.totalShippedQty}`,
      `% Alocado promedio: ${stats.avgAllocPct}%`,
      `Status: Activas ${stats.activa} | Parciales ${stats.parcial} | Completas ${stats.completa}`,
      `ETA vencido: ${stats.etaOverdue} | ETA <= 7 días: ${stats.etaSoon}`,
      `Top clientes: ${topCustomers || 'N/A'}`,
      `Filtros: Texto="${osoFilter || '—'}", Estado="${osoStatusFilter}", Rápido="${osoQuickFilter}", Fact mes="${osoInvoiceMonth || '—'}"`
    ].join('\n');

    navigator.clipboard?.writeText?.(summary);
    alert('Resumen ejecutivo copiado.');
  };

  const togglePinnedBo = (bo) => {
    if (!bo) return;
    setPinnedBos(prev => {
      const set = new Set(Array.isArray(prev) ? prev : []);
      if (set.has(bo)) set.delete(bo);
      else set.add(bo);
      return Array.from(set);
    });
  };

  const formatGpPercent = (gp) => {
    if (!Number.isFinite(gp)) return '';
    return (Math.round(gp * 1000) / 10).toString();
  };

  const updateGlobalMargin = (origin, value) => {
    const parsed = parseGp(value, CONSTANTS.DEFAULT_GP);
    if (origin === 'AXIS') {
      setCotizacionGpGlobalAxis(parsed);
      return;
    }
    setCotizacionGpGlobalQnap(parsed);
  };
  const [nuevoUsuario, setNuevoUsuario] = useState({
    usuario: '',
    nombre: '',
    password: '',
    role: 'client'
  });
  const [usuarioPasswordById, setUsuarioPasswordById] = useState({});
  const [accountPassword, setAccountPassword] = useState('');
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('');
  const [historialFilters, setHistorialFilters] = useState({
    fecha: '',
    cliente: '',
    pid: '',
    proyecto: '',
    producto: '',
    estados: []
  });
  const [printQuote, setPrintQuote] = useState(null);
  const [calcParams, setCalcParams] = useState({
    INBOUND_FREIGHT: CONSTANTS.INBOUND_FREIGHT,
    IC: CONSTANTS.IC,
    INT: CONSTANTS.INT,
    DEFAULT_GP: CONSTANTS.DEFAULT_GP
  });
  const [showProjectRegistro, setShowProjectRegistro] = useState(false);
  const [projectRegistroModal, setProjectRegistroModal] = useState(null);
  const [editingCotizacionId, setEditingCotizacionId] = useState(null);
  const [editingCotizacionForm, setEditingCotizacionForm] = useState(null);
  const userCardRefs = useRef({});

  const isAdmin = user?.role ? user.role === 'admin' : true;
  const isClient = !isAdmin;
  const fieldLabelClass = isClient
    ? 'flex flex-col gap-1 text-xs text-gray-500'
    : 'flex flex-col gap-1 text-[11px] text-gray-500';
  const fieldInputClass = isClient
    ? 'px-3 py-2 border rounded text-sm text-gray-800'
    : 'px-2 py-1 border rounded text-xs text-gray-800';

  const usuariosPorEmpresa = useMemo(() => {
    const grouped = usuarios.reduce((acc, u) => {
      const key = (u.empresa || 'Sin empresa').trim() || 'Sin empresa';
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  }, [usuarios]);

  const historialEmpresas = useMemo(() => {
    const set = new Set();
    historial.forEach(cot => {
      const name = (cot?.cliente_empresa || '').trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [historial]);

  const sessionsByUser = useMemo(() => {
    const grouped = activeSessions.reduce((acc, s) => {
      const userId = s.user_id ?? s.userId ?? s.usuario_id;
      if (!userId) return acc;
      if (!acc[userId]) {
        acc[userId] = {
          userId,
          usuario: s.usuario || '',
          nombre: s.nombre || '',
          empresa: s.empresa || '',
          role: s.role || '',
          sessions: []
        };
      }
      acc[userId].sessions.push(s);
      return acc;
    }, {});
    return Object.values(grouped)
      .map(item => {
        const lastSeen = item.sessions.reduce((max, s) => {
          const ts = new Date(s.last_seen || s.lastSeen || 0).getTime();
          if (Number.isNaN(ts)) return max;
          return Math.max(max, ts);
        }, 0);
        return { ...item, lastSeen };
      })
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }, [activeSessions]);

  const applyUserDefaults = (currentUser) => {
    if (!currentUser || currentUser.role === 'admin') return;
    if (currentUser.partner_category) setCotizacionPartnerCategory(currentUser.partner_category);
  };

  const updateCalcParam = (key, value, isPercent = false) => {
    const parsed = parseFloat(value);
    setCalcParams(prev => ({
      ...prev,
      [key]: Number.isNaN(parsed) ? 0 : (isPercent ? parsed / 100 : parsed)
    }));
  };

  const calcularPrecioClienteLocal = (precioDisty, gp = 0.15) =>
    calcularPrecioCliente(precioDisty, gp, calcParams);

  const getAxisPartnerRebate = (item, category) => {
    const selected = category || DEFAULT_AXIS_PARTNER;
    if (selected === 'Partner Silver') return item.rebate_partner_silver || 0;
    if (selected === 'Partner Gold') return item.rebate_partner_gold || 0;
    if (selected === 'Partner Multiregional') return item.rebate_partner_multiregional || 0;
    return item.rebate_partner_autorizado || 0;
  };

  const calcularPrecioClienteAxis = (precioDisty, gp, partnerRebate, projectRebate) => {
    const costoXUS = precioDisty * AXIS_CONSTANTS.INBOUND_FREIGHT;
    const costoFinalXUS = costoXUS / AXIS_CONSTANTS.IC;
    const costoXCL = costoFinalXUS * (1 + AXIS_CONSTANTS.INT);
    const rebateTotal = (partnerRebate || 0) + (projectRebate || 0);
    const costoFinalXCL = Math.max(costoXCL - rebateTotal, 0);
    return costoFinalXCL / (1 - gp);
  };

  const calcularPrecioClienteItem = (item) => {
    if (!isAdmin) {
      return Number(item.precio_cliente ?? item.precio ?? 0);
    }
    const baseGp = (item.origen || 'QNAP') === 'AXIS' ? cotizacionGpGlobalAxis : cotizacionGpGlobalQnap;
    const gpEffective = item.gpOverride ?? baseGp;
    if ((item.origen || 'QNAP') !== 'AXIS') {
      return calcularPrecioClienteLocal(item.precio, gpEffective);
    }
    const partnerRebate = getAxisPartnerRebate(item, item.partnerCategory || cotizacionPartnerCategory);
    const projectRebate = parseFloat(item.rebateProject) || 0;
    return calcularPrecioClienteAxis(item.precio, gpEffective, partnerRebate, projectRebate);
  };

  const calcularPrecioCatalogo = (producto) => {
    if (!isAdmin) {
      return Number(producto.precio_cliente ?? producto.precio ?? 0);
    }
    if ((producto.origen || 'QNAP') !== 'AXIS') {
      return calcularPrecioClienteLocal(producto.precio, cotizacionGpGlobalQnap);
    }
    const partnerRebate = getAxisPartnerRebate(producto, DEFAULT_AXIS_PARTNER);
    return calcularPrecioClienteAxis(producto.precio, cotizacionGpGlobalAxis, partnerRebate, 0);
  };

  const getDateKey = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA');
  };

  const getDateKeyCompact = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    return `${dd}${mm}${yy}`;
  };

  const sanitizeFilenamePart = (value) => {
    if (!value) return '';
    const trimmed = value.toString().trim();
    if (!trimmed || trimmed.toLowerCase() === 'n/a') return '';
    const noAccents = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return noAccents.replace(/[^a-zA-Z0-9]+/g, '');
  };

  const buildExportFilename = (dateValue, projectName, integratorName) => {
    const dateKey = getDateKeyCompact(dateValue) || getDateKeyCompact(new Date());
    const project = sanitizeFilenamePart(projectName);
    const integrator = sanitizeFilenamePart(integratorName);
    const namePart = project || integrator || 'cotizacion';
    return `${dateKey || 'export'}_${namePart}_v1`;
  };

  const downloadPdfFromElement = async (element, filenameBase) => {
    if (!element) {
      alert('No se pudo generar el PDF.');
      return;
    }
    try {
      setSaving(true);
      const { html2canvas, jsPDF } = await loadPdfDeps();
      const elementRect = element.getBoundingClientRect();
      const logoNodes = Array.from(new Set([
        ...element.querySelectorAll('img[data-pdf-logo="1"]'),
        ...element.querySelectorAll('img[alt="Logo"]')
      ]));
      const logoMetaList = logoNodes.map(img => {
        const logoRect = img.getBoundingClientRect();
        img.dataset.prevVisibility = img.style.visibility || '';
        img.style.visibility = 'hidden';
        return {
          src: img.src,
          x: logoRect.left - elementRect.left,
          y: logoRect.top - elementRect.top,
          w: logoRect.width,
          h: logoRect.height
        };
      });
      const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      logoNodes.forEach(img => {
        img.style.visibility = img.dataset.prevVisibility || '';
        delete img.dataset.prevVisibility;
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      if (logoMetaList.length && elementRect.width) {
        const domToPdfScale = pageWidth / elementRect.width;
        for (const logoMeta of logoMetaList) {
          if (!logoMeta?.src) continue;
          const logoImage = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = logoMeta.src;
          });
          const logoX = logoMeta.x * domToPdfScale;
          const logoY = logoMeta.y * domToPdfScale;
          const logoW = logoMeta.w * domToPdfScale;
          const logoH = logoMeta.h * domToPdfScale;
          pdf.addImage(logoImage, 'PNG', logoX, logoY, logoW, logoH);
        }
      }
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`${filenameBase}.pdf`);
    } catch (error) {
      alert(error.message || 'Error generando PDF');
    } finally {
      setSaving(false);
    }
  };

  const calcularPrecioAdmin = (producto) => {
    if ((producto.origen || 'QNAP') !== 'AXIS') {
      return calcularPrecioClienteLocal(producto.precio, calcParams.DEFAULT_GP);
    }
    const partnerRebate = getAxisPartnerRebate(producto, DEFAULT_AXIS_PARTNER);
    return calcularPrecioClienteAxis(producto.precio, calcParams.DEFAULT_GP, partnerRebate, 0);
  };

  // Verificar sesin al cargar
  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      setIsLoggedIn(true);
      const parsedUser = JSON.parse(savedUser);
      registerSessionForUser(parsedUser);
      setUser(parsedUser);
      applyUserDefaults(parsedUser);
      setCliente(prev => ({
        ...prev,
        nombre: parsedUser?.nombre || parsedUser?.usuario || prev.nombre || '',
        empresa: parsedUser?.empresa || prev.empresa || ''
      }));
      loadProductos(parsedUser?.role);
      loadStock();
    }
    setLoading(false);
  }, []);

  // Cargar productos del backend
  const loadProductos = async (roleOverride) => {
    try {
      const isAdminForLoad = roleOverride ? roleOverride === 'admin' : isAdmin;
      const data = await productosAPI.getAll();
      setProductos(data.map(p => ({
        id: p.id,
        origen: p.origen || 'QNAP',
        marca: p.marca || '',
        sku: p.sku || '',
        mpn: p.mpn || '',
        desc: p.descripcion || '',
        precio: isAdminForLoad ? (parseFloat(p.precio_disty) || 0) : (parseFloat(p.precio_cliente) || 0),
        precio_cliente: !isAdminForLoad ? (parseFloat(p.precio_cliente) || 0) : undefined,
        gp: isAdminForLoad ? parseGp(p.gp, calcParams.DEFAULT_GP) : undefined,
        rebate_partner_autorizado: isAdminForLoad ? (parseFloat(p.rebate_partner_autorizado) || 0) : undefined,
        rebate_partner_silver: isAdminForLoad ? (parseFloat(p.rebate_partner_silver) || 0) : undefined,
        rebate_partner_gold: isAdminForLoad ? (parseFloat(p.rebate_partner_gold) || 0) : undefined,
        rebate_partner_multiregional: isAdminForLoad ? (parseFloat(p.rebate_partner_multiregional) || 0) : undefined,
        tiempo: p.tiempo_entrega || 'ETA por confirmar'
      })));
    } catch (error) {
      console.error('Error cargando productos:', error);
    }
  };

  const loadStock = async () => {
    try {
      const data = await stockAPI.getAll();
      const items = Array.isArray(data?.items) ? data.items : [];
      const map = {};
      items.forEach(item => {
        const key = normalizeLookupKey(item?.mpn);
        if (!key) return;
        map[key] = item?.quantity ?? '';
      });
      setStockByMpn(map);
      setCotizacion(prev => prev.map(item => {
        const stockText = getStockEntregaText(item.mpn, map);
        if (!stockText) return item;
        return { ...item, tiempo: stockText };
      }));
    } catch (error) {
      console.error('Error cargando stock:', error);
      setStockByMpn({});
    }
  };

  const loadStockCatalog = async () => {
    try {
      setStockCatalogLoading(true);
      setStockCatalogError('');
      const data = await stockAPI.getCatalog();
      const items = Array.isArray(data?.items) ? data.items : [];
      setStockCatalog(items);
    } catch (error) {
      console.error('Error cargando catálogo de stock:', error);
      setStockCatalogError(error.message || 'Error cargando stock disponible');
      setStockCatalog([]);
    } finally {
      setStockCatalogLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      setLoginError('');
      getOrCreateSessionId();
      getOrCreateDeviceId();
      const data = await authAPI.login(usuario, password);
      registerSessionForUser(data.user);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      applyUserDefaults(data.user);
      setCliente(prev => ({
        ...prev,
        nombre: data.user?.nombre || data.user?.usuario || '',
        empresa: data.user?.empresa || ''
      }));
      setIsLoggedIn(true);
      loadProductos(data.user?.role);
      loadStock();
    } catch (error) {
      setLoginError(error.message || 'Error de autenticacin');
    }
  };

  const forceLogout = (message) => {
    handleLogout();
    if (message) setLoginError(message);
  };

  const handleLogout = async () => {
    clearSessionForUser(user);
    try {
      await authAPI.logout();
    } catch {
      // ignore logout errors
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsLoggedIn(false);
    setUser(null);
    setUsuario('');
    setPassword('');
    setProductos([]);
    setSelectedIds(new Set());
    setCliente({
      nombre: '',
      empresa: '',
      pid: '',
      proyecto: '',
      cliente_final: '',
      fecha_ejecucion: '',
      fecha_implementacion: '',
      vms: ''
    });
  };

  useEffect(() => {
    if (!isLoggedIn || !user) return;
    const heartbeatId = setInterval(() => {
      const stillActive = updateSessionHeartbeat(user);
      if (!stillActive) {
        forceLogout('Tu sesión fue cerrada por otro acceso.');
      }
    }, SESSION_HEARTBEAT_MS);

    const handleStorage = (event) => {
      if (event.key !== SESSION_STORAGE_KEY) return;
      if (!isSessionActive(user)) {
        forceLogout('Tu sesión fue cerrada por otro acceso.');
      }
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      clearInterval(heartbeatId);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isLoggedIn, user]);

  useEffect(() => {
    if (!isLoggedIn || currentView !== 'historial') return;
    let cancelled = false;
    const loadHistorial = async () => {
      setHistorialLoading(true);
      setHistorialError('');
      try {
        const data = await cotizacionesAPI.getAll({ includeItems: true });
        if (!cancelled) setHistorial(data);
      } catch (error) {
        if (!cancelled) setHistorialError('Error obteniendo historial');
      } finally {
        if (!cancelled) setHistorialLoading(false);
      }
    };
    loadHistorial();
    return () => {
      cancelled = true;
    };
  }, [currentView]);

  useEffect(() => {
    if (!isLoggedIn || currentView !== 'stock') return;
    loadStockCatalog();
  }, [isLoggedIn, currentView]);

  useEffect(() => {
    if (!isLoggedIn || !isAdmin || currentView !== 'usuarios') return;
    loadUsuarios();
  }, [isLoggedIn, isAdmin, currentView]);

  useEffect(() => {
    if (!isLoggedIn || !isAdmin || currentView !== 'ordenes') return;
    loadOsoOrders();
  }, [isLoggedIn, isAdmin, currentView]);


  useEffect(() => {
    if (!isLoggedIn || !isAdmin || currentView !== 'historial') return;
    loadFunnel();
  }, [isLoggedIn, isAdmin, currentView, funnelDays, funnelEmpresa, funnelFrom, funnelTo]);

  useEffect(() => {
    if (!isLoggedIn || !isAdmin || currentView !== 'usuarios') return;
    let active = true;
    const fetchNow = async (silent) => {
      if (!active) return;
      await loadActiveSessions({ silent });
    };
    fetchNow(false);
    let intervalId = null;
    if (sessionAutoRefresh) {
      intervalId = setInterval(() => {
        fetchNow(true);
      }, 10000);
    }
    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [isLoggedIn, isAdmin, currentView, sessionAutoRefresh]);

  useEffect(() => {
    if (!isLoggedIn || !isAdmin || currentView !== 'usuarios' || !selectedSessionUserId) return;
    loadUserActivity(selectedSessionUserId);
  }, [isLoggedIn, isAdmin, currentView, selectedSessionUserId]);

  useEffect(() => {
    if (!isAdmin && (currentView === 'admin' || currentView === 'usuarios' || currentView === 'ordenes' || currentView === 'compras')) {
      setCurrentView('cotizador');
    }
  }, [isAdmin, currentView]);

  useEffect(() => {
    if (!user || isAdmin) return;
    setCliente(prev => ({
      ...prev,
      nombre: prev.nombre && prev.nombre !== 'N/A' ? prev.nombre : (user.nombre || user.usuario || ''),
      empresa: prev.empresa && prev.empresa !== 'N/A' ? prev.empresa : (user.empresa || '')
    }));
  }, [user, isAdmin]);

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleLogin(); };

  // Cargar Excel
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const nuevosProductos = jsonData.map(row => {
          const precio = parseFloat(findValue(row, COLUMN_MAP.precio)) || 0;
          const gp = parseGp(findValue(row, COLUMN_MAP.gp), calcParams.DEFAULT_GP);
          
          return {
            marca: findValue(row, COLUMN_MAP.marca) || '',
            sku: String(findValue(row, COLUMN_MAP.sku) || ''),
            mpn: String(findValue(row, COLUMN_MAP.mpn) || ''),
            descripcion: findValue(row, COLUMN_MAP.desc) || '',
            precio_disty: precio,
            gp,
            tiempo_entrega: findValue(row, COLUMN_MAP.tiempo) || 'ETA por confirmar'
          };
        }).filter(p => p.sku || p.descripcion);

        // Enviar al backend
        setSaving(true);
        const result = await productosAPI.bulkCreate(nuevosProductos, adminOrigin);
        await loadProductos();
        alert(`Se importaron ${result.productos.length} productos correctamente`);
      } catch (error) {
        console.error('Error:', error);
        alert('Error al procesar el archivo');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const headers = [{
      Marca: '',
      SKU: '',
      MPN: '',
      Descripción: '',
      'Precio Disty': '',
      'GP (%)': '',
      'Tiempo Entrega': ''
    }];
    const worksheet = XLSX.utils.json_to_sheet(headers, { skipHeader: false });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla');
    XLSX.writeFile(workbook, 'plantilla_productos.xlsx');
  };

  const syncFromSheets = async () => {
    try {
      setSaving(true);
      const result = await productosAPI.sync(adminOrigin);
      await loadProductos();
      const summary = result?.inserted !== undefined
        ? `${result.inserted} nuevos, ${result.updated} actualizados, ${result.skipped} omitidos.`
        : 'Sync completado.';
      alert(`Sync OK (${adminOrigin}): ${summary}`);
    } catch (error) {
      alert(error.message || 'Error sincronizando productos');
    } finally {
      setSaving(false);
    }
  };

  // CRUD Productos
  const handleAddProduct = async () => {
    if (!newProduct.sku && !newProduct.desc) return alert('Ingrese SKU o Descripción');
    try {
      setSaving(true);
      const gp = parseGp(newProduct.gp, calcParams.DEFAULT_GP);

      await productosAPI.create({
        origen: adminOrigin,
        marca: newProduct.marca,
        sku: newProduct.sku,
        mpn: newProduct.mpn,
        descripcion: newProduct.desc,
        precio_disty: parseFloat(newProduct.precio) || 0,
        gp,
        tiempo_entrega: newProduct.tiempo || 'ETA por confirmar'
      });
      
      await loadProductos();
      setNewProduct({ marca: '', sku: '', mpn: '', desc: '', precio: '', gp: '15', tiempo: 'ETA por confirmar' });
      setShowAddForm(false);
    } catch (error) {
      alert('Error al guardar producto');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p) => { 
    setEditingId(p.id); 
    setEditForm({ ...p, gp: (p.gp * 100).toFixed(0), precio: p.precio.toString() }); 
  };
  
  const saveEdit = async () => {
    try {
      setSaving(true);
      const gp = parseGp(editForm.gp, calcParams.DEFAULT_GP);

      await productosAPI.update(editingId, {
        origen: editForm.origen || adminOrigin,
        marca: editForm.marca,
        sku: editForm.sku,
        mpn: editForm.mpn,
        descripcion: editForm.desc,
        precio_disty: parseFloat(editForm.precio) || 0,
        gp,
        tiempo_entrega: editForm.tiempo || 'ETA por confirmar'
      });
      
      await loadProductos();
      setEditingId(null);
    } catch (error) {
      alert('Error al actualizar producto');
    } finally {
      setSaving(false);
    }
  };

  const deleteProductosByIds = async (ids, successMessage) => {
    const validIds = ids.filter(id => id !== undefined && id !== null && id !== '');
    if (validIds.length === 0) {
      alert('No hay IDs válidos para eliminar.');
      return;
    }
    setSaving(true);
    try {
      const results = await Promise.allSettled(validIds.map(id => productosAPI.delete(id)));
      const failed = results.filter(r => r.status === 'rejected');
      const failedMessages = results
        .filter(r => r.status === 'rejected')
        .map(r => r.reason?.message)
        .filter(Boolean);
      await loadProductos();
      setSelectedIds(new Set());
      if (failed.length > 0) {
        const detail = failedMessages.length > 0 ? ' Detalle: ' + failedMessages[0] : '';
        alert('Se eliminaron ' + (validIds.length - failed.length) + ' productos. Fallaron ' + failed.length + '.' + detail);
      } else {
        alert(successMessage);
      }
    } catch (error) {
      console.error('Error eliminando productos:', error);
      alert(error.message || 'Error al eliminar productos');
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedProducts = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm('Eliminar ' + ids.length + ' productos seleccionados?')) return;
    await deleteProductosByIds(ids, 'Productos seleccionados eliminados.');
  };

  const deleteAllProducts = async () => {
    if (productos.length === 0) return;
    if (!confirm('Eliminar todos los productos (' + productos.length + ')?')) return;
    await deleteProductosByIds(productos.map(p => p.id), 'Todos los productos fueron eliminados.');
  };

  // Cotización
  const getStockEntregaText = (mpn, lookup = stockByMpn) => {
    const key = normalizeLookupKey(mpn);
    if (!key) return '';
    const qty = lookup[key];
    if (qty === undefined || qty === null || qty === '') return '';
    const qtyText = formatStockQuantity(qty);
    if (!qtyText) return '';
    return `${qtyText} ${STOCK_DELIVERY_SUFFIX}`;
  };

  const addToCotizacion = (producto) => {
    const exists = cotizacion.find(x => x.id === producto.id);
    if (exists) setCotizacion(c => c.map(x => x.id === producto.id ? { ...x, cant: x.cant + 1 } : x));
    else setCotizacion(c => [...c, {
      ...producto,
      cant: 1,
      partnerCategory: producto.origen === 'AXIS' ? cotizacionPartnerCategory : undefined,
      rebateProject: producto.origen === 'AXIS' ? 0 : undefined,
      gpOverride: null,
      tiempo: getStockEntregaText(producto.mpn) || producto.tiempo
    }]);
  };

  const applyPartnerCategoryToAxis = (category) => {
    setCotizacionPartnerCategory(category);
    setCotizacion(items => items.map(item => (
      (item.origen || 'QNAP') === 'AXIS' ? { ...item, partnerCategory: category } : item
    )));
  };

  const normalizeEstado = (estado) => {
    if (!estado || estado === 'pendiente') return 'revision';
    return estado;
  };

  const updateItem = (id, field, value) => {
    setCotizacion(c => c.map(x => {
      if (x.id !== id) return x;
      if (field === 'gp') {
        const parsed = parseFloat(value);
        if (Number.isNaN(parsed)) return x;
        return { ...x, gp: parsed > 1 ? parsed / 100 : parsed };
      }
      if (field === 'rebateProject') {
        const parsed = parseFloat(value);
        return { ...x, rebateProject: Number.isNaN(parsed) ? 0 : parsed };
      }
      if (field === 'partnerCategory') return { ...x, partnerCategory: value };
      if (field === 'gpOverride') {
        const parsed = parseFloat(value);
        if (Number.isNaN(parsed)) return { ...x, gpOverride: null, gpOverrideInput: value };
        return { ...x, gpOverride: parsed / 100, gpOverrideInput: value };
      }
      if (field === 'precio') return { ...x, precio: parseFloat(value) || 0 };
      if (field === 'cant') return { ...x, cant: parseInt(value) || 1 };
      if (field === 'tiempo') {
        return { ...x, tiempo: value };
      }
      if (field === 'mpn') {
        const stockText = getStockEntregaText(value);
        return { ...x, mpn: value, tiempo: stockText || x.tiempo };
      }
      return { ...x, [field]: value };
    }));
  };

  const removeItem = (id) => setCotizacion(c => c.filter(x => x.id !== id));
  const clearCotizacion = () => {
    if (cotizacion.length === 0) return;
    if (!confirm('Limpiar todos los productos de la cotización?')) return;
    setCotizacion([]);
  };
  const totalCotizacion = useMemo(
    () => cotizacion.reduce((t, i) => t + calcularPrecioClienteItem(i) * i.cant, 0),
    [cotizacion, calcParams, cotizacionGpGlobalQnap, cotizacionGpGlobalAxis]
  );

  // Guardar cotización
  const saveCotizacion = async () => {
    try {
      setSaving(true);
      const registroProyecto = {
        cliente_final: cliente.cliente_final?.trim() || '',
        fecha_ejecucion: cliente.fecha_ejecucion || '',
        fecha_implementacion: cliente.fecha_implementacion || '',
        vms: cliente.vms?.trim() || ''
      };
      const hasRegistroProyecto = Object.values(registroProyecto).some(v => String(v).trim() !== '');
      const clientePayload = {
        nombre: cliente.nombre?.trim() || 'N/A',
        empresa: cliente.empresa?.trim() || 'N/A',
        pid: cliente.pid?.trim() || 'N/A',
        proyecto: cliente.proyecto?.trim() || 'N/A',
        ...(hasRegistroProyecto ? registroProyecto : {})
      };
      const items = isAdmin
        ? cotizacion.map(item => ({
            producto_id: item.id,
            marca: item.marca,
            sku: item.sku,
            mpn: item.mpn,
            descripcion: item.desc,
            precio_disty: item.precio,
            gp: item.gpOverride ?? ((item.origen || 'QNAP') === 'AXIS' ? cotizacionGpGlobalAxis : cotizacionGpGlobalQnap),
            cantidad: item.cant,
            precio_unitario: calcularPrecioClienteItem(item),
            precio_total: calcularPrecioClienteItem(item) * item.cant,
            tiempo_entrega: item.tiempo
          }))
        : cotizacion.map(item => ({
            producto_id: item.id,
            cantidad: item.cant
          }));

      await cotizacionesAPI.create({
        cliente: {
          nombre: clientePayload.nombre,
          empresa: clientePayload.empresa,
          email: clientePayload.pid,
          telefono: clientePayload.proyecto
        },
        items,
        total: totalCotizacion
      });

      alert('Cotización guardada correctamente');
    } catch (error) {
      alert(error.message || 'Error al guardar cotización');
    } finally {
      setSaving(false);
    }
  };

  const loadUsuarios = async () => {
    try {
      setUsuariosLoading(true);
      setUsuariosError('');
      const data = await usuariosAPI.getAll();
      setUsuarios(data.map(u => ({
        ...u,
        gp: Number.isFinite(Number(u.gp)) ? Number(u.gp) : u.gp,
        gp_qnap: Number.isFinite(Number(u.gp_qnap)) ? Number(u.gp_qnap) : (Number.isFinite(Number(u.gp)) ? Number(u.gp) : u.gp),
        gp_axis: Number.isFinite(Number(u.gp_axis)) ? Number(u.gp_axis) : (Number.isFinite(Number(u.gp)) ? Number(u.gp) : u.gp)
      })));
    } catch (error) {
      setUsuariosError(error.message || 'Error cargando usuarios');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const loadOsoOrders = async () => {
    try {
      setOsoLoading(true);
      setOsoError('');
      const [data, metaRows] = await Promise.all([
        osoAPI.getOrders(),
        boMetaAPI.getAll()
      ]);
      const orders = data.orders || [];
      const metaMap = (metaRows || []).reduce((acc, row) => {
        if (!row?.bo) return acc;
        acc[row.bo] = {
          projectName: row.project_name || row.projectName || '',
          poAxis: row.po_axis || row.poAxis || '',
          estimatedInvoiceDate: row.estimated_invoice_date || row.estimatedInvoiceDate || '',
          sAndDStatus: row.s_and_d_status || row.sAndDStatus || '',
          invoiced: row.invoiced ?? false,
          invoicedAt: row.invoiced_at || row.invoicedAt || '',
          customerName: row.customer_name || row.customerName || '',
          allocPct: row.alloc_pct ?? row.allocPct,
          customerPO: row.customer_po || row.customerPO || '',
          lastSeenAt: row.last_seen_at || row.lastSeenAt || '',
          purchaseStatus: row.purchase_status || row.purchaseStatus || '',
          purchaseDispatch: row.purchase_dispatch || row.purchaseDispatch || '',
          purchaseShipping: row.purchase_shipping || row.purchaseShipping || '',
          purchaseSo: row.purchase_so || row.purchaseSo || '',
          deleted: row.deleted ?? false,
          deletedAt: row.deleted_at || row.deletedAt || '',
          deletedComment: row.deleted_comment || row.deletedComment || '',
          deletedBy: row.deleted_by || row.deletedBy || null
        };
        return acc;
      }, {});
      setOsoOrders(orders);
      setBoMeta(metaMap);
      const existingBos = new Set(orders.map(order => order.bo));
      const missingBos = Object.keys(metaMap).filter(bo =>
        !existingBos.has(bo) && !metaMap[bo]?.invoiced && !metaMap[bo]?.deleted
      );
      setMissingBos(missingBos);
      setShowMissingBosModal(missingBos.length > 0);
    } catch (error) {
      setOsoError(error.message || 'Error cargando ordenes');
    } finally {
      setOsoLoading(false);
    }
  };

  const markBoInvoiced = (bo) => {
    if (!bo) return;
    const invoicedAt = new Date().toISOString();
    updateBoMetaLocal(bo, { invoiced: true, invoicedAt });
    boMetaAPI.save(bo, { invoiced: true, invoicedAt }).catch(() => {});
    setMissingBos(prev => prev.filter(item => item !== bo));
  };

  const unmarkBoInvoiced = (bo) => {
    if (!bo) return;
    updateBoMetaLocal(bo, { invoiced: false });
    boMetaAPI.save(bo, { invoiced: false }).catch(() => {});
  };

  const dismissMissingBo = (bo) => {
    setMissingBos(prev => prev.filter(item => item !== bo));
  };

  const openDeleteBoModal = (bo) => {
    if (!bo) return;
    setDeleteBoTarget(bo);
    setDeleteBoComment('');
    setDeleteBoError('');
  };

  const closeDeleteBoModal = () => {
    setDeleteBoTarget(null);
    setDeleteBoComment('');
    setDeleteBoError('');
  };

  const confirmDeleteBo = async () => {
    if (!deleteBoTarget) return;
    const comment = deleteBoComment.trim();
    if (!comment) {
      setDeleteBoError('Comentario requerido.');
      return;
    }
    try {
      setDeleteBoLoading(true);
      setDeleteBoError('');
      await boMetaAPI.remove(deleteBoTarget, comment);
      updateBoMetaLocal(deleteBoTarget, {
        deleted: true,
        deletedAt: new Date().toISOString(),
        deletedComment: comment
      });
      setMissingBos(prev => prev.filter(item => item !== deleteBoTarget));
      closeDeleteBoModal();
    } catch (error) {
      setDeleteBoError(error.message || 'Error eliminando BO');
    } finally {
      setDeleteBoLoading(false);
    }
  };

  const loadFunnel = async ({ days = funnelDays, empresa = funnelEmpresa, from = funnelFrom, to = funnelTo } = {}) => {
    try {
      setFunnelLoading(true);
      setFunnelError('');
      const data = await cotizacionesAPI.getFunnel({ days, empresa, from, to });
      setFunnelData(data);
    } catch (error) {
      setFunnelError(error.message || 'Error cargando funnel');
    } finally {
      setFunnelLoading(false);
    }
  };

  const loadActiveSessions = async ({ silent = false } = {}) => {
    try {
      if (!silent) setSessionsLoading(true);
      setSessionsError('');
      const data = await sesionesAPI.getActive();
      setActiveSessions(data);
      if (!selectedSessionUserId || !data.some(s => (s.user_id ?? s.userId) === selectedSessionUserId)) {
        setSelectedSessionUserId(data[0]?.user_id ?? data[0]?.userId ?? null);
      }
    } catch (error) {
      setSessionsError(error.message || 'Error cargando sesiones');
    } finally {
      if (!silent) setSessionsLoading(false);
    }
  };

  const loadUserActivity = async (userId) => {
    if (!userId) return;
    try {
      setUserActivityLoading(true);
      setUserActivityError('');
      const [sessions, logs] = await Promise.all([
        sesionesAPI.getByUser(userId),
        sesionesAPI.getUserLogs(userId, 200)
      ]);
      setUserSessions(sessions);
      setUserLogs(logs);
    } catch (error) {
      setUserActivityError(error.message || 'Error cargando actividad');
    } finally {
      setUserActivityLoading(false);
    }
  };

  const revokeSession = async (sessionId) => {
    if (!sessionId) return;
    if (!confirm('Cerrar esta sesiÃ³n?')) return;
    try {
      await sesionesAPI.revoke(sessionId);
      await loadActiveSessions({ silent: true });
      await loadUserActivity(selectedSessionUserId);
    } catch (error) {
      alert(error.message || 'Error revocando sesiÃ³n');
    }
  };

  const syncFromSheetsAll = async () => {
    try {
      setSaving(true);
      const qnap = await productosAPI.sync('QNAP');
      const axis = await productosAPI.sync('AXIS');
      await loadProductos();
      const qnapSummary = qnap?.inserted !== undefined
        ? `QNAP: ${qnap.inserted} nuevos, ${qnap.updated} actualizados, ${qnap.skipped} omitidos.`
        : 'QNAP: Sync completado.';
      const axisSummary = axis?.inserted !== undefined
        ? `AXIS: ${axis.inserted} nuevos, ${axis.updated} actualizados, ${axis.skipped} omitidos.`
        : 'AXIS: Sync completado.';
      alert(`Sync OK: ${qnapSummary} ${axisSummary}`);
    } catch (error) {
      alert(error.message || 'Error sincronizando productos');
    } finally {
      setSaving(false);
    }
  };

  const syncFromSheetsOrigin = async (origin) => {
    try {
      setSaving(true);
      const result = await productosAPI.sync(origin);
      await loadProductos();
      const summary = result?.inserted !== undefined
        ? `${origin}: ${result.inserted} nuevos, ${result.updated} actualizados, ${result.skipped} omitidos.`
        : `${origin}: Sync completado.`;
      alert(`Sync OK: ${summary}`);
    } catch (error) {
      alert(error.message || 'Error sincronizando productos');
    } finally {
      setSaving(false);
    }
  };

  const exportCotizacionExcel = () => {
    if (cotizacion.length === 0) {
      alert('No hay productos para exportar');
      return;
    }
    const fechaKey = getDateKey(new Date());
    const filenameBase = buildExportFilename(new Date(), cliente.proyecto, cliente.empresa);
    const headerRows = [
      ['Nombre', cliente.nombre || 'N/A', 'Empresa', cliente.empresa || 'N/A'],
      ['PID', cliente.pid || 'N/A', 'Proyecto', cliente.proyecto || 'N/A'],
      ['Fecha', fechaKey || '', '', ''],
      []
    ];
    const tableHeader = ['Marca', 'Cant.', 'SKU', 'MPN', 'Descripción', 'P. Unit.', 'P. Total', 'Entrega'];
    const tableRows = cotizacion.map(item => {
      const pu = calcularPrecioClienteItem(item);
      return [
        item.marca,
        item.cant,
        item.sku,
        item.mpn,
        item.desc,
        pu,
        pu * item.cant,
        item.tiempo
      ];
    });
    const totalRow = ['', '', '', '', 'TOTAL', '', totalCotizacion, ''];
    const ws = XLSX.utils.aoa_to_sheet([...headerRows, tableHeader, ...tableRows, [], totalRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion');
    XLSX.writeFile(wb, `${filenameBase}.xlsx`);
  };

  const buildAxisPayload = (sourceItems, meta) => {
    const products = (sourceItems || []).map(item => ({
      quantity: item.cantidad ?? item.cant ?? 1,
      partNumber: (item.mpn || item.sku || '').toString().trim()
    })).filter(p => p.partNumber);
    const projectId = meta?.id ? `project:${meta.id}` : `project:${(crypto?.randomUUID?.() || `${Date.now()}`)}`;
    return {
      metadata: {
        source: 'AXIS Site Designer',
        id: projectId,
        customer: meta?.customer || '',
        customerCountry: meta?.customerCountry || 'cl'
      },
      products
    };
  };

  const exportAxisJson = (payload, filename) => {
    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportCotizacionAxis = () => {
    if (cotizacion.length === 0) {
      alert('No hay productos para exportar');
      return;
    }
    const payload = buildAxisPayload(cotizacion, {
      customer: cliente.empresa || '',
      id: getDateKey(new Date()) || ''
    });
    exportAxisJson(payload, `axis-${getDateKey(new Date()) || 'export'}.json`);
  };

  const exportHistorialAxis = (cot) => {
    const payload = buildAxisPayload(cot.items || [], {
      customer: cot.cliente_empresa || '',
      id: cot.id || ''
    });
    exportAxisJson(payload, `axis-${cot.id || 'export'}.json`);
  };

  const exportCotizacionPdf = async () => {
    const filenameBase = buildExportFilename(new Date(), cliente.proyecto, cliente.empresa);
    const element = document.querySelector('.print-area');
    await downloadPdfFromElement(element, filenameBase);
  };

  const exportHistorialPdf = (cot) => {
    setPrintQuote(cot);
  };

  const exportHistorialExcel = (cot) => {
    const fechaKey = getDateKey(cot.created_at || new Date());
    const filenameBase = buildExportFilename(cot.created_at || new Date(), cot.cliente_telefono, cot.cliente_empresa);
    const headerRows = [
      ['Nombre', cot.cliente_nombre || 'N/A', 'Empresa', cot.cliente_empresa || 'N/A'],
      ['PID', cot.cliente_email || 'N/A', 'Proyecto', cot.cliente_telefono || 'N/A'],
      ['Fecha', fechaKey || '', '', ''],
      []
    ];
    const tableHeader = ['Marca', 'Cant.', 'SKU', 'MPN', 'Descripción', 'P. Unit.', 'P. Total', 'Entrega'];
    const items = Array.isArray(cot.items) ? cot.items : [];
    const tableRows = items.map(item => ([
      item.marca,
      item.cantidad,
      item.sku,
      item.mpn,
      item.descripcion,
      item.precio_unitario,
      item.precio_total,
      item.tiempo_entrega
    ]));
    const totalRow = ['', '', '', '', 'TOTAL', '', cot.total || 0, ''];
    const ws = XLSX.utils.aoa_to_sheet([...headerRows, tableHeader, ...tableRows, [], totalRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion');
    XLSX.writeFile(wb, `${filenameBase}.xlsx`);
  };

  useEffect(() => {
    if (!printQuote) return;
    const filenameBase = buildExportFilename(printQuote.created_at || new Date(), printQuote.cliente_telefono, printQuote.cliente_empresa);
    const run = async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const element = document.querySelector('.print-area');
      await downloadPdfFromElement(element, filenameBase);
      setPrintQuote(null);
    };
    run();
  }, [printQuote]);

  const handleProjectUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      let pidCandidate = '';
      let added = 0;
      let skipped = 0;
      setCotizacion(prev => {
        const next = [...prev];
        rows.forEach(row => {
          const pidRaw = String(row[0] || '').trim();
          const pidLower = pidRaw.toLowerCase();
          const isHeaderRow = pidLower.includes('pid') || pidLower.includes('project');
          const pid = isHeaderRow ? '' : pidRaw;
          const producto = String(row[4] || '').trim();
          const mpn = String(row[5] || '').trim();
          const cantidad = parseInt(row[6], 10) || 0;
          const rebate = parseFloat(row[8]) || 0;
          if (!producto && !mpn) return;
          if (pid) pidCandidate = pid;
          const mpnLower = mpn.toLowerCase();
          const productoLower = producto.toLowerCase();
          let match = null;
          if (mpnLower) {
            match = productos.find(p => (p.mpn || '').toLowerCase() === mpnLower);
          }
          if (!match && productoLower) {
            match = productos.find(p => (p.desc || '').toLowerCase().includes(productoLower));
          }
          if (!match) {
            skipped += 1;
            return;
          }
          const qty = cantidad > 0 ? cantidad : 1;
          const existingIndex = next.findIndex(item => item.id === match.id);
          const isAxisMatch = (match.origen || 'QNAP') === 'AXIS';
          const partnerRebate = isAxisMatch ? getAxisPartnerRebate(match, cotizacionPartnerCategory) : 0;
          const rebateTotal = isAxisMatch ? Math.max(match.precio - rebate, 0) : 0;
          const rebateProject = isAxisMatch ? Math.max(rebateTotal - partnerRebate, 0) : 0;
          if (existingIndex >= 0) {
            const existing = next[existingIndex];
            const isAxis = (existing.origen || 'QNAP') === 'AXIS';
            const nextRebate = isAxis ? (parseFloat(existing.rebateProject) || 0) + rebateProject : (existing.rebateProject || 0);
            const stockText = getStockEntregaText(match.mpn);
            next[existingIndex] = {
              ...existing,
              cant: (existing.cant || 1) + qty,
              rebateProject: nextRebate,
              tiempo: stockText || existing.tiempo
            };
          } else {
            const isAxis = (match.origen || 'QNAP') === 'AXIS';
            const stockText = getStockEntregaText(match.mpn);
            next.push({
              ...match,
              cant: qty,
              gpOverride: null,
              gpOverrideInput: '',
              rebateProject: isAxis ? rebateProject : 0,
              partnerCategory: isAxis ? cotizacionPartnerCategory : undefined,
              tiempo: stockText || match.tiempo
            });
          }
          added += 1;
        });
        return next;
      });
      if (pidCandidate) {
        setCliente(c => ({ ...c, pid: pidCandidate }));
      }
      alert(`Carga completa. Agregados: ${added}, omitidos: ${skipped}.`);
    } catch (error) {
      console.error('Error leyendo proyecto:', error);
      alert('Error leyendo archivo de proyecto');
    }
  };

  const adminProductos = useMemo(
    () => productos.filter(p => (p.origen || 'QNAP') === adminOrigin),
    [productos, adminOrigin]
  );

  const hasProjectRegistro = (cot) => {
    const keys = [
      'cliente_final',
      'cliente_telefono',
      'fecha_ejecucion',
      'fecha_implementacion',
      'vms'
    ];
    return keys.some(key => {
      const value = cot?.[key];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
  };

  const handleLogoUpload = (file, setter) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setter(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const isClienteQuote = (cot) => {
    const roleCandidates = [
      cot?.usuario_role,
      cot?.user_role,
      cot?.created_by_role,
      cot?.createdByRole,
      cot?.usuario?.role,
      cot?.user?.role
    ].filter(Boolean);
    if (roleCandidates.some(role => String(role).toLowerCase() === 'client')) return true;
    return false;
  };

  const filteredHistorial = useMemo(() => {
    const fecha = historialFilters.fecha;
    const clienteTerm = historialFilters.cliente.trim().toLowerCase();
    const pidTerm = historialFilters.pid.trim().toLowerCase();
    const proyectoTerm = historialFilters.proyecto.trim().toLowerCase();
    const productoTerm = historialFilters.producto.trim().toLowerCase();
    const estadosSeleccionados = historialFilters.estados || [];
    const currentUserId = user?.id ?? user?.user_id ?? user?.usuario_id ?? null;
    const currentUserName = (user?.usuario || user?.username || user?.user || '').toString().toLowerCase();
    const isOwnCotizacion = (cot) => {
      if (isAdmin) return true;
      if (!user) return false;
      const idCandidates = [
        cot.usuario_id,
        cot.user_id,
        cot.created_by,
        cot.createdBy,
        cot.usuarioId,
        cot.userId,
        cot.usuario?.id,
        cot.user?.id
      ].filter(v => v !== undefined && v !== null);
      if (currentUserId !== null && idCandidates.some(v => String(v) === String(currentUserId))) return true;
      const nameCandidates = [
        cot.usuario,
        cot.user,
        cot.username,
        cot.created_by_name,
        cot.createdByName,
        cot.usuario?.usuario,
        cot.user?.usuario
      ].filter(v => v !== undefined && v !== null);
      if (currentUserName && nameCandidates.some(v => (v || '').toString().toLowerCase() === currentUserName)) return true;
      return false;
    };
    return historial.filter(cot => {
      if (!isOwnCotizacion(cot)) return false;
      if (estadosSeleccionados.length > 0) {
        const estado = normalizeEstado(cot.estado);
        if (!estadosSeleccionados.includes(estado)) return false;
      }
      if (fecha && getDateKey(cot.created_at) !== fecha) return false;
      if (clienteTerm) {
        const hayCliente = [
          cot.cliente_nombre,
          cot.cliente_empresa
        ].some(v => (v || '').toLowerCase().includes(clienteTerm));
        if (!hayCliente) return false;
      }
      if (pidTerm) {
        const pidValue = (cot.cliente_email || '').toLowerCase();
        if (!pidValue.includes(pidTerm)) return false;
      }
      if (proyectoTerm) {
        const proyectoValue = (cot.cliente_telefono || '').toLowerCase();
        if (!proyectoValue.includes(proyectoTerm)) return false;
      }
      if (productoTerm) {
        const items = cot.items || [];
        const hayProducto = items.some(item =>
          [item.marca, item.sku, item.mpn, item.descripcion]
            .some(v => (v || '').toLowerCase().includes(productoTerm))
        );
        if (!hayProducto) return false;
      }
      return true;
    });
  }, [historial, historialFilters, isAdmin, user]);

  const historialCounts = useMemo(() => {
    const clienteQuotes = historial.filter(cot => isClienteQuote(cot)).length;
    const registroQuotes = historial.filter(cot => isClienteQuote(cot) && hasProjectRegistro(cot)).length;
    const registroPendientes = historial.filter(cot => isClienteQuote(cot) && hasProjectRegistro(cot) && !dismissedRegistroById[cot.id]).length;
    return { clienteQuotes, registroQuotes, registroPendientes };
  }, [historial, dismissedRegistroById]);

  const funnelStages = useMemo(() => {
    const stageMap = new Map();
    (funnelData?.stages || []).forEach(stage => {
      stageMap.set((stage.estado || '').toLowerCase(), stage);
    });
    const buildStage = (key, label, tone) => {
      const row = stageMap.get(key) || {};
      return {
        key,
        label,
        tone,
        count: Number(row.count || 0),
        amount: Number(row.amount || 0)
      };
    };
    return [
      buildStage('enviada', 'Enviadas', 'text-blue-700 bg-blue-50'),
      buildStage('revision', 'En revisión', 'text-amber-700 bg-amber-50'),
      buildStage('aprobada', 'Aprobadas', 'text-emerald-700 bg-emerald-50'),
      buildStage('rechazada', 'Rechazadas', 'text-rose-700 bg-rose-50')
    ];
  }, [funnelData]);

  const toggleEstadoFilter = (estado) => {
    setHistorialFilters(prev => {
      const current = new Set(prev.estados || []);
      if (current.has(estado)) current.delete(estado);
      else current.add(estado);
      return { ...prev, estados: Array.from(current) };
    });
  };

  useEffect(() => {
    setSelectedHistorialIds(prev => {
      const validIds = new Set(historial.map(cot => cot.id));
      const next = new Set();
      prev.forEach(id => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [historial]);

  const toggleSelectHistorial = (id) => {
    setSelectedHistorialIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllHistorialFiltered = () => {
    setSelectedHistorialIds(prev => {
      const next = new Set(prev);
      const filteredIds = filteredHistorial.map(cot => cot.id);
      const allSelected = filteredIds.length > 0 && filteredIds.every(id => next.has(id));
      if (allSelected) {
        filteredIds.forEach(id => next.delete(id));
      } else {
        filteredIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const deleteSelectedCotizaciones = async () => {
    const ids = Array.from(selectedHistorialIds);
    if (ids.length === 0) return;
    const msg = ids.length === 1
      ? 'Eliminar 1 cotizacion guardada?'
      : `Eliminar ${ids.length} cotizaciones guardadas?`;
    if (!confirm(msg)) return;
    try {
      setSaving(true);
      const results = await Promise.allSettled(ids.map(id => cotizacionesAPI.delete(id)));
      const failed = results.filter(r => r.status === 'rejected');
      setHistorial(prev => prev.filter(cot => !ids.includes(cot.id)));
      setSelectedHistorialIds(new Set());
      if (failed.length > 0) {
        const firstError = failed[0]?.reason?.message || 'Error eliminando cotizaciones';
        alert(`Se eliminaron ${ids.length - failed.length}. Fallaron ${failed.length}. ${firstError}`);
      }
    } catch (error) {
      alert(error.message || 'Error eliminando cotizaciones');
    } finally {
      setSaving(false);
    }
  };

  const createUsuario = async () => {
    if (!nuevoUsuario.usuario || !nuevoUsuario.password) {
      alert('Usuario y contraseña son requeridos');
      return;
    }
    try {
      setUsuariosLoading(true);
      const payload = {
        usuario: nuevoUsuario.usuario,
        nombre: nuevoUsuario.nombre,
        password: nuevoUsuario.password,
        role: 'client',
        gp: 0.15,
        gp_qnap: 0.15,
        gp_axis: 0.15,
        partner_category: DEFAULT_AXIS_PARTNER,
        empresa: '',
        logo_url: ''
      };
      const created = await usuariosAPI.create(payload);
      const createdNormalized = {
        ...created,
        gp: Number.isFinite(Number(created.gp)) ? Number(created.gp) : created.gp,
        gp_qnap: Number.isFinite(Number(created.gp_qnap)) ? Number(created.gp_qnap) : (Number.isFinite(Number(created.gp)) ? Number(created.gp) : created.gp),
        gp_axis: Number.isFinite(Number(created.gp_axis)) ? Number(created.gp_axis) : (Number.isFinite(Number(created.gp)) ? Number(created.gp) : created.gp)
      };
      setUsuarios(prev => [createdNormalized, ...prev]);
      setNuevoUsuario({
        usuario: '',
        nombre: '',
        password: '',
        role: 'client'
      });
    } catch (error) {
      alert(error.message || 'Error creando usuario');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const updateUsuario = async (userId, changes) => {
    try {
      setUsuariosLoading(true);
      const payload = { ...changes };
      if (payload.gp !== undefined) {
        const parsed = parseFloat(payload.gp);
        if (Number.isNaN(parsed)) {
          payload.gp = 0.15;
        } else {
          payload.gp = parsed > 1 ? parsed / 100 : parsed;
        }
      }
      if (payload.gp_qnap !== undefined) {
        const parsed = parseFloat(payload.gp_qnap);
        if (Number.isNaN(parsed)) {
          payload.gp_qnap = 0.15;
        } else {
          payload.gp_qnap = parsed > 1 ? parsed / 100 : parsed;
        }
      }
      if (payload.gp_axis !== undefined) {
        const parsed = parseFloat(payload.gp_axis);
        if (Number.isNaN(parsed)) {
          payload.gp_axis = 0.15;
        } else {
          payload.gp_axis = parsed > 1 ? parsed / 100 : parsed;
        }
      }
      const updated = await usuariosAPI.update(userId, payload);
      const updatedNormalized = {
        ...updated,
        gp: Number.isFinite(Number(updated.gp)) ? Number(updated.gp) : updated.gp,
        gp_qnap: Number.isFinite(Number(updated.gp_qnap)) ? Number(updated.gp_qnap) : (Number.isFinite(Number(updated.gp)) ? Number(updated.gp) : updated.gp),
        gp_axis: Number.isFinite(Number(updated.gp_axis)) ? Number(updated.gp_axis) : (Number.isFinite(Number(updated.gp)) ? Number(updated.gp) : updated.gp)
      };
      setUsuarios(prev => prev.map(u => (u.id === userId ? updatedNormalized : u)));
    } catch (error) {
      alert(error.message || 'Error actualizando usuario');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const resetUsuarioPassword = async (userId, newPassword) => {
    if (!newPassword) {
      alert('Ingrese una contraseña');
      return;
    }
    try {
      setUsuariosLoading(true);
      await usuariosAPI.updatePassword(userId, newPassword);
      alert('Contraseña actualizada');
    } catch (error) {
      alert(error.message || 'Error actualizando contraseña');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const updateOwnPassword = async () => {
    if (!accountPassword) {
      alert('Ingrese una contraseña');
      return;
    }
    if (accountPassword !== accountPasswordConfirm) {
      alert('Las contraseñas no coinciden');
      return;
    }
    try {
      setSaving(true);
      await usuariosAPI.updateOwnPassword(accountPassword);
      setAccountPassword('');
      setAccountPasswordConfirm('');
      alert('Contraseña actualizada');
    } catch (error) {
      alert(error.message || 'Error actualizando contraseña');
    } finally {
      setSaving(false);
    }
  };

  const deleteUsuario = async (userId) => {
    if (!confirm('Eliminar este usuario?')) return;
    try {
      setUsuariosLoading(true);
      await usuariosAPI.delete(userId);
      setUsuarios(prev => prev.filter(u => u.id !== userId));
    } catch (error) {
      alert(error.message || 'Error eliminando usuario');
    } finally {
      setUsuariosLoading(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('empresaConfigs', JSON.stringify(empresaConfigs));
  }, [empresaConfigs]);

  useEffect(() => {
    if (!usuarios.length) return;
    setEmpresaConfigs(prev => {
      let changed = false;
      const next = { ...prev };
      usuarios.forEach(u => {
        const empresa = (u.empresa || '').trim();
        if (!empresa || next[empresa]) return;
        const gpQnap = Number.isFinite(Number(u.gp_qnap)) ? Number(u.gp_qnap) * 100
          : (Number.isFinite(Number(u.gp)) ? Number(u.gp) * 100 : 15);
        const gpAxis = Number.isFinite(Number(u.gp_axis)) ? Number(u.gp_axis) * 100
          : (Number.isFinite(Number(u.gp)) ? Number(u.gp) * 100 : 15);
        next[empresa] = {
          nombre: empresa,
          role: u.role || 'client',
          gp_qnap: Math.round(gpQnap),
          gp_axis: Math.round(gpAxis),
          partner_category: u.partner_category || DEFAULT_AXIS_PARTNER,
          logo_url: u.logo_url || ''
        };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [usuarios]);

  const saveEmpresaConfig = () => {
    const nombre = empresaForm.nombre.trim();
    if (!nombre) {
      alert('Ingrese nombre de empresa');
      return;
    }
    const gpQnap = parseFloat(empresaForm.gp_qnap);
    const gpAxis = parseFloat(empresaForm.gp_axis);
    setEmpresaConfigs(prev => ({
      ...prev,
      [nombre]: {
        nombre,
        role: empresaForm.role || 'client',
        gp_qnap: Number.isNaN(gpQnap) ? 15 : gpQnap,
        gp_axis: Number.isNaN(gpAxis) ? 15 : gpAxis,
        partner_category: empresaForm.partner_category || DEFAULT_AXIS_PARTNER,
        logo_url: empresaForm.logo_url || ''
      }
    }));
    setEmpresaForm({
      nombre: '',
      role: 'client',
      gp_qnap: '15',
      gp_axis: '15',
      partner_category: DEFAULT_AXIS_PARTNER,
      logo_url: ''
    });
  };

  const loadEmpresaForm = (empresa) => {
    if (!empresa) return;
    setShowEmpresaForm(true);
    setEmpresaForm({
      nombre: empresa.nombre || '',
      role: empresa.role || 'client',
      gp_qnap: empresa.gp_qnap?.toString?.() || '15',
      gp_axis: empresa.gp_axis?.toString?.() || '15',
      partner_category: empresa.partner_category || DEFAULT_AXIS_PARTNER,
      logo_url: empresa.logo_url || ''
    });
  };

  const assignUserToEmpresa = async (userId, empresaName) => {
    if (!empresaName) {
      await updateUsuario(userId, { empresa: '', logo_url: '' });
      return;
    }
    const config = empresaConfigs[empresaName];
    if (!config) return;
    await updateUsuario(userId, {
      empresa: empresaName,
      role: config.role || 'client',
      gp_qnap: config.gp_qnap ?? 15,
      gp_axis: config.gp_axis ?? 15,
      gp: config.gp_qnap ?? 15,
      partner_category: config.partner_category || DEFAULT_AXIS_PARTNER,
      logo_url: config.logo_url || ''
    });
  };

  const deleteEmpresa = async (empresaName) => {
    if (!empresaName) return;
    const confirmMsg = `Eliminar la empresa "${empresaName}" y desasignar sus usuarios?`;
    if (!confirm(confirmMsg)) return;
    const usuariosEmpresa = usuarios.filter(u => (u.empresa || '').trim() === empresaName);
    try {
      setUsuariosLoading(true);
      await Promise.allSettled(
        usuariosEmpresa.map(u => updateUsuario(u.id, { empresa: '', logo_url: '' }))
      );
      setEmpresaConfigs(prev => {
        const next = { ...prev };
        delete next[empresaName];
        return next;
      });
    } catch (error) {
      alert(error.message || 'Error eliminando empresa');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const updateCotizacionEstado = async (cotizacionId, estado) => {
    try {
      setSaving(true);
      const result = await cotizacionesAPI.updateEstado(cotizacionId, estado);
      const newEstado = result?.estado || estado;
      setHistorial(prev => prev.map(cot => (
        cot.id === cotizacionId ? { ...cot, estado: newEstado } : cot
      )));
    } catch (error) {
      alert(error.message || 'Error actualizando estado');
    } finally {
      setSaving(false);
    }
  };

  const startEditCotizacion = (cot) => {
    setEditingCotizacionId(cot.id);
    setEditingCotizacionForm({
      cliente_nombre: cot.cliente_nombre || '',
      cliente_empresa: cot.cliente_empresa || '',
      cliente_email: cot.cliente_email || '',
      cliente_telefono: cot.cliente_telefono || '',
      cliente_final: cot.cliente_final || '',
      fecha_ejecucion: cot.fecha_ejecucion || '',
      fecha_implementacion: cot.fecha_implementacion || '',
      vms: cot.vms || '',
      items: (cot.items || []).map(item => ({
        id: item.id,
        producto_id: item.producto_id,
        marca: item.marca || '',
        sku: item.sku || '',
        mpn: item.mpn || '',
        descripcion: item.descripcion || '',
        precio_unitario: Number(item.precio_unitario) || 0,
        cantidad: Number(item.cantidad) || 1,
        tiempo_entrega: item.tiempo_entrega || ''
      }))
    });
  };

  const cancelEditCotizacion = () => {
    setEditingCotizacionId(null);
    setEditingCotizacionForm(null);
  };

  const updateEditingItem = (index, field, value) => {
    setEditingCotizacionForm(prev => {
      if (!prev) return prev;
      const items = [...prev.items];
      const next = { ...items[index], [field]: value };
      if (field === 'precio_unitario' || field === 'cantidad') {
        const precio = Number(field === 'precio_unitario' ? value : next.precio_unitario) || 0;
        const cant = Number(field === 'cantidad' ? value : next.cantidad) || 0;
        next.precio_unitario = precio;
        next.cantidad = cant;
      }
      items[index] = next;
      return { ...prev, items };
    });
  };

  const saveEditedCotizacion = async (cotId) => {
    if (!editingCotizacionForm) return;
    try {
      setSaving(true);
      const items = (editingCotizacionForm.items || []).map(item => ({
        id: item.id,
        producto_id: item.producto_id,
        marca: item.marca,
        sku: item.sku,
        mpn: item.mpn,
        descripcion: item.descripcion,
        precio_disty: 0,
        gp: 0,
        cantidad: Number(item.cantidad) || 1,
        precio_unitario: Number(item.precio_unitario) || 0,
        precio_total: (Number(item.precio_unitario) || 0) * (Number(item.cantidad) || 1),
        tiempo_entrega: item.tiempo_entrega
      }));
      const total = items.reduce((sum, i) => sum + (Number(i.precio_total) || 0), 0);
      await cotizacionesAPI.update(cotId, {
        cliente: {
          nombre: editingCotizacionForm.cliente_nombre,
          empresa: editingCotizacionForm.cliente_empresa,
          email: editingCotizacionForm.cliente_email,
          telefono: editingCotizacionForm.cliente_telefono,
          cliente_final: editingCotizacionForm.cliente_final,
          fecha_ejecucion: editingCotizacionForm.fecha_ejecucion,
          fecha_implementacion: editingCotizacionForm.fecha_implementacion,
          vms: editingCotizacionForm.vms
        },
        items,
        total
      });
      setHistorial(prev => prev.map(c => (c.id === cotId ? { ...c, ...editingCotizacionForm, total, items } : c)));
      cancelEditCotizacion();
      alert('Cotización actualizada');
    } catch (error) {
      alert(error.message || 'Error actualizando cotización');
    } finally {
      setSaving(false);
    }
  };

  const getCompraOrigenLabel = (cot) => {
    const items = cot.items || [];
    const hasAxis = items.some(item => {
      const marca = (item.marca || '').toLowerCase();
      const sku = (item.sku || '').toLowerCase();
      const mpn = (item.mpn || '').toLowerCase();
      const desc = (item.descripcion || '').toLowerCase();
      return marca.includes('axis') || sku.includes('axis') || mpn.includes('axis') || desc.includes('axis');
    });
    return hasAxis ? 'Axis' : 'QNAP';
  };

  const buildCompraMailto = (cot) => {
    const origenLabel = getCompraOrigenLabel(cot);
    const bo = (boByCotizacionId[cot.id] || '').trim() || cot.id || 'XXXX';
    const subject = `Compra ${origenLabel} - BO ${bo}`;
    const items = cot.items || [];
    const headers = ['Marca', 'Cantidad', 'SKU', 'MPN', 'Costo XUS'];
    const dataRows = items.map(item => ([
      item.marca || '',
      String(item.cantidad || item.cant || 1),
      item.sku || '',
      item.mpn || '',
      formatCurrency(parseFloat(item.precio_disty || 0))
    ]));
    const allRows = [headers, ...dataRows];
    const colWidths = headers.map((_, idx) =>
      Math.max(...allRows.map(r => (r[idx] || '').toString().length))
    );
    const formatRow = (row) =>
      `| ${row.map((cell, i) => (cell || '').toString().padEnd(colWidths[i], ' ')).join(' | ')} |`;
    const sep = `| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |`;
    const tableLines = [
      formatRow(headers),
      sep,
      ...dataRows.map(formatRow)
    ];
    const body = [
      'Juan',
      'Favor tu apoyo gestionando la siguiente compra:',
      '',
      `Compra ${origenLabel}, aéreo consolidado, XCL – BO ${bo}`,
      '',
      ...tableLines,
      '',
      'Muchas gracias',
      'Quedo atento',
      'Saludos.'
    ].join('\n');
    return `mailto:juan.parral@intcomex.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const buildCompraTableHtml = (cot) => {
    const rows = (cot.items || []).map(item => {
      const marca = item.marca || '';
      const cantidad = item.cantidad || item.cant || 1;
      const sku = item.sku || '';
      const mpn = item.mpn || '';
      const costo = formatCurrency(parseFloat(item.precio_disty || 0));
      return `<tr><td>${marca}</td><td>${cantidad}</td><td>${sku}</td><td>${mpn}</td><td>${costo}</td></tr>`;
    }).join('');
    return [
      `<table border=\"1\" cellpadding=\"4\" cellspacing=\"0\">`,
      `<tr><th>Marca</th><th>Cantidad</th><th>SKU</th><th>MPN</th><th>Costo XUS</th></tr>`,
      rows || '',
      `</table>`
    ].join('');
  };

  const buildCompraHtml = (cot) => {
    const origenLabel = getCompraOrigenLabel(cot);
    const bo = (boByCotizacionId[cot.id] || '').trim() || cot.id || 'XXXX';
    return [
      `<p>Juan</p>`,
      `<p>Favor tu apoyo gestionando la siguiente compra:</p>`,
      `<p>Compra ${origenLabel}, aéreo consolidado, XCL – BO ${bo}</p>`,
      buildCompraTableHtml(cot),
      `<p>Muchas gracias<br>Quedo atento<br>Saludos.</p>`
    ].join('');
  };

  const updateBoMetaLocal = (bo, patch) => {
    if (!bo) return;
    setBoMeta(prev => ({
      ...prev,
      [bo]: {
        ...prev[bo],
        ...patch
      }
    }));
  };

  const updateBoDraft = (bo, patch) => {
    if (!bo) return;
    setBoDraft(prev => ({
      ...prev,
      [bo]: {
        ...prev[bo],
        ...patch
      }
    }));
  };

  const saveBoMeta = async (bo) => {
    if (!bo) return;
    const draft = boDraft[bo] || {};
    const normalizeEmpty = (value) => {
      if (value === undefined || value === null) return null;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };
    const payload = {
      projectName: normalizeEmpty(draft.projectName ?? boMeta[bo]?.projectName ?? ''),
      poAxis: normalizeEmpty(draft.poAxis ?? boMeta[bo]?.poAxis ?? ''),
      estimatedInvoiceDate: normalizeEmpty(draft.estimatedInvoiceDate ?? boMeta[bo]?.estimatedInvoiceDate ?? '')
    };
    try {
      setBoSaving(prev => ({ ...prev, [bo]: true }));
      const saved = await boMetaAPI.save(bo, payload);
      updateBoMetaLocal(bo, {
        projectName: saved.project_name || saved.projectName || payload.projectName,
        poAxis: saved.po_axis || saved.poAxis || payload.poAxis,
        estimatedInvoiceDate: saved.estimated_invoice_date || saved.estimatedInvoiceDate || payload.estimatedInvoiceDate,
        sAndDStatus: saved.s_and_d_status || saved.sAndDStatus || boMeta[bo]?.sAndDStatus,
        invoiced: saved.invoiced ?? boMeta[bo]?.invoiced,
        invoicedAt: saved.invoiced_at || saved.invoicedAt || boMeta[bo]?.invoicedAt
      });
      setBoDraft(prev => {
        const next = { ...prev };
        delete next[bo];
        return next;
      });
    } catch (error) {
      alert(error.message || 'No se pudo guardar la información del BO');
    } finally {
      setBoSaving(prev => ({ ...prev, [bo]: false }));
    }
  };

  const copyHtmlToClipboard = async (html) => {
    try {
      if (navigator.clipboard?.write) {
        const blob = new Blob([html], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        await navigator.clipboard.write([item]);
        alert('HTML copiado al portapapeles');
        return;
      }
      await navigator.clipboard.writeText(html);
      alert('Texto copiado al portapapeles');
    } catch (error) {
      alert('No se pudo copiar automáticamente. Selecciona y copia manualmente.');
    }
  };

  const normalizeBrand = (value) => {
    const raw = (value || '').toString().toLowerCase();
    if (raw.includes('axis')) return 'Axis';
    if (raw.includes('qnap')) return 'QNAP';
    if (raw.includes('iss')) return 'ISS';
    if (raw.includes('neural')) return 'Neural Labs';
    if (raw.includes('milestone')) return 'Milestone';
    return (value || '').toString().trim();
  };

  const getOrderBrand = (order) => {
    const candidate =
      order?.brand ||
      order?.marca ||
      order?.manufBrand ||
      order?.manufacturer ||
      order?.lines?.[0]?.brand ||
      order?.lines?.[0]?.marca ||
      '';
    return normalizeBrand(candidate);
  };

  const buildSAndDHtml = (order) => {
    const bo = order?.bo || '';
    const po = boDraft[order?.bo]?.projectName ?? boMeta[order?.bo]?.projectName ?? '';
    const brand = getOrderBrand(order) || '';
    return [
      `<p>Estimados.</p>`,
      `<p>Favor su apoyo gestionando la siguiente protección</p>`,
      `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">`,
      `<tr><th>Orden de Venta</th><td>${bo}</td></tr>`,
      `<tr><th>Usuario Final</th><td></td></tr>`,
      `<tr><th>País</th><td>XCL</td></tr>`,
      `<tr><th>Marca</th><td>${brand}</td></tr>`,
      `<tr><th>Número de proyecto</th><td>${po}</td></tr>`,
      `</table>`,
      `<p>Muchas gracias<br>Quedo atento<br>Saludos.</p>`
    ].join('');
  };

  const getSAndDStatus = (bo) => {
    const status = boMeta[bo]?.sAndDStatus;
    return status === 'aplicado' ? 'aplicado' : 'pendiente';
  };

  const setSAndDStatus = (bo, status) => {
    updateBoMetaLocal(bo, { sAndDStatus: status });
    boMetaAPI.save(bo, { sAndDStatus: status }).catch(() => {});
  };

  const updatePurchaseDraft = (bo, patch) => {
    if (!bo) return;
    setPurchaseDraft(prev => ({
      ...prev,
      [bo]: {
        ...prev[bo],
        ...patch
      }
    }));
  };

  const clearPurchaseDraft = (bo) => {
    setPurchaseDraft(prev => {
      const next = { ...prev };
      delete next[bo];
      return next;
    });
  };

  const savePurchaseMeta = async (bo) => {
    if (!bo) return;
    const draft = purchaseDraft[bo] || {};
    const normalizeEmpty = (value) => {
      if (value === undefined || value === null) return null;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };
    const payload = {
      purchaseStatus: normalizeEmpty(draft.purchaseStatus ?? boMeta[bo]?.purchaseStatus ?? ''),
      purchaseDispatch: normalizeEmpty(draft.purchaseDispatch ?? boMeta[bo]?.purchaseDispatch ?? ''),
      purchaseShipping: normalizeEmpty(draft.purchaseShipping ?? boMeta[bo]?.purchaseShipping ?? ''),
      purchaseSo: normalizeEmpty(draft.purchaseSo ?? boMeta[bo]?.purchaseSo ?? ''),
      poAxis: normalizeEmpty(draft.poAxis ?? boMeta[bo]?.poAxis ?? '')
    };
    try {
      await boMetaAPI.save(bo, payload);
      updateBoMetaLocal(bo, {
        purchaseStatus: payload.purchaseStatus || '',
        purchaseDispatch: payload.purchaseDispatch || '',
        purchaseShipping: payload.purchaseShipping || '',
        purchaseSo: payload.purchaseSo || '',
        poAxis: payload.poAxis || ''
      });
      clearPurchaseDraft(bo);
    } catch {
      // ignore save errors
    }
  };

  const handleSAndDClick = async (order) => {
    if (!order?.bo) return;
    const current = getSAndDStatus(order.bo);
    if (current === 'aplicado') {
      if (confirm('¿Marcar S&D como pendiente?')) {
        setSAndDStatus(order.bo, 'pendiente');
      }
      return;
    }
    await copyHtmlToClipboard(buildSAndDHtml(order));
    if (confirm('¿Marcar S&D como aplicado?')) {
      setSAndDStatus(order.bo, 'aplicado');
    }
  };

  const renderOrderCard = (order, { pinned = false, mode = 'ordenes' } = {}) => {
    const totalOrderQty = (order.lines || []).reduce((acc, line) => acc + (Number(line.orderQty) || 0), 0);
    const totalShippedQty = (order.lines || []).reduce((acc, line) => acc + (Number(line.shippedQty) || 0), 0);
    const totalAllocQty = (order.lines || []).reduce((acc, line) => acc + (Number(line.allocQty) || 0), 0);
    const status = getOrderStatus(order);
    const statusClass = status === 'Completa'
      ? 'bg-emerald-100 text-emerald-700'
      : (status === 'Parcial' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700');
    const sAndDStatus = mode === 'ordenes' ? getSAndDStatus(order.bo) : null;
    const sAndDClass = sAndDStatus === 'aplicado'
      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
      : 'bg-slate-100 text-slate-700 hover:bg-slate-200';
    const etaBadge = (() => {
      if (!order.etaEstimated) return null;
      const eta = new Date(order.etaEstimated);
      if (Number.isNaN(eta.getTime())) return null;
      const today = new Date();
      const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
      const etaUtc = Date.UTC(eta.getFullYear(), eta.getMonth(), eta.getDate());
      const diffDays = Math.round((etaUtc - todayUtc) / 86400000);
      if (diffDays < 0) return { label: `ETA vencido: ${order.etaEstimated}`, className: 'bg-rose-100 text-rose-700' };
      if (diffDays <= 7) return { label: `ETA ≤ 7 días: ${order.etaEstimated}`, className: 'bg-amber-100 text-amber-700' };
      return { label: `ETA estimado: ${order.etaEstimated}`, className: 'bg-emerald-100 text-emerald-700' };
    })();
    const progress = totalOrderQty > 0 ? Math.min((totalShippedQty / totalOrderQty) * 100, 100) : 0;
    const draft = boDraft[order.bo] || {};
    const projectValue = draft.projectName ?? boMeta[order.bo]?.projectName ?? '';
    const poAxisValue = draft.poAxis ?? boMeta[order.bo]?.poAxis ?? '';
    const invoiceDateValue = draft.estimatedInvoiceDate ?? boMeta[order.bo]?.estimatedInvoiceDate ?? '';
    const purchaseDraftRow = purchaseDraft[order.bo] || {};
    const purchaseStatus = (purchaseDraftRow.purchaseStatus ?? boMeta[order.bo]?.purchaseStatus ?? '').toString().toLowerCase() === 'comprado'
      ? 'comprado'
      : 'pendiente';
    const purchaseDispatch = purchaseDraftRow.purchaseDispatch ?? boMeta[order.bo]?.purchaseDispatch ?? '';
    const purchaseShipping = purchaseDraftRow.purchaseShipping ?? boMeta[order.bo]?.purchaseShipping ?? '';
    const purchaseSo = purchaseDraftRow.purchaseSo ?? boMeta[order.bo]?.purchaseSo ?? '';
    const purchasePoAxis = purchaseDraftRow.poAxis ?? boMeta[order.bo]?.poAxis ?? '';
    const isDirty =
      (draft.projectName !== undefined && draft.projectName !== (boMeta[order.bo]?.projectName ?? '')) ||
      (draft.poAxis !== undefined && draft.poAxis !== (boMeta[order.bo]?.poAxis ?? '')) ||
      (draft.estimatedInvoiceDate !== undefined && draft.estimatedInvoiceDate !== (boMeta[order.bo]?.estimatedInvoiceDate ?? ''));
    const isPurchaseDirty = mode === 'compras' && (
      (purchaseDraftRow.purchaseStatus !== undefined && (purchaseDraftRow.purchaseStatus ?? '') !== (boMeta[order.bo]?.purchaseStatus ?? '')) ||
      (purchaseDraftRow.purchaseDispatch !== undefined && (purchaseDraftRow.purchaseDispatch ?? '') !== (boMeta[order.bo]?.purchaseDispatch ?? '')) ||
      (purchaseDraftRow.purchaseShipping !== undefined && (purchaseDraftRow.purchaseShipping ?? '') !== (boMeta[order.bo]?.purchaseShipping ?? '')) ||
      (purchaseDraftRow.purchaseSo !== undefined && (purchaseDraftRow.purchaseSo ?? '') !== (boMeta[order.bo]?.purchaseSo ?? '')) ||
      (purchaseDraftRow.poAxis !== undefined && (purchaseDraftRow.poAxis ?? '') !== (boMeta[order.bo]?.poAxis ?? ''))
    );

    const isEmbarcador = mode === 'compras' && String(purchaseDispatch || '').toLowerCase() === 'embarcador';
    const isPendingPurchase = mode === 'compras' && purchaseStatus === 'pendiente';
    const oorAlerts = mode === 'compras'
      ? (order.lines || [])
        .map((line, idx) => ({
          key: `${order.bo}-${idx}`,
          label: line.mpn || line.sku || line.desc || `Linea ${idx + 1}`,
          date: line.tiempoEntrega || ''
        }))
        .filter(item => item.date)
      : [];

    return (
      <div
        key={order.bo}
        className={`border rounded-2xl bg-white shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] ${
          isPendingPurchase
            ? 'border-rose-300 ring-1 ring-rose-200 bg-rose-50/40'
            : (isEmbarcador ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200')
        }`}
      >
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex flex-col gap-2">
            {isPendingPurchase && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <div className="font-semibold">Pendiente compra</div>
              </div>
            )}
            {isEmbarcador && !isPendingPurchase && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <div className="font-semibold">Despacho Embarcador</div>
                {oorAlerts.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {oorAlerts.map(item => (
                      <div key={item.key} className="flex flex-wrap gap-1">
                        <span className="font-medium">{item.label}:</span>
                        <span>OOR {item.date}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1">Sin fecha OOR registrada.</div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedBo(prev => (prev === order.bo ? null : order.bo))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedBo(prev => (prev === order.bo ? null : order.bo));
                  }
                }}
                className="flex flex-wrap items-center gap-3 text-xs text-gray-600 flex-1 min-w-0 text-left cursor-pointer"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard?.writeText?.(String(order.bo || ''));
                  }}
                  className="text-sm font-semibold text-slate-900 whitespace-nowrap hover:text-blue-700"
                  title="Copiar BO"
                  type="button"
                >
                  BO {order.bo}
                </button>
                <span className="text-slate-700 break-words">{order.customerName || 'Cliente N/A'}</span>
                <span className={`whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full ${statusClass}`}>{status}</span>
              </div>
              {etaBadge && (
                <span className={`whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full ${etaBadge.className}`}>
                  {etaBadge.label}
                </span>
              )}
              <span className="whitespace-nowrap text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">% {order.allocPct ?? 0}</span>
              <button
                onClick={() => togglePinnedBo(order.bo)}
                className={`text-xs px-2 py-1 rounded-full ${pinned ? 'text-amber-700 bg-amber-100' : 'text-slate-700 bg-slate-100'}`}
              >
                {pinned ? 'Quitar pin' : 'Fijar'}
              </button>
              {mode === 'ordenes' && (
                <button
                  onClick={() => saveBoMeta(order.bo)}
                  disabled={!isDirty || boSaving[order.bo]}
                  className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${isDirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400'} ${boSaving[order.bo] ? 'opacity-60' : ''}`}
                >
                  {boSaving[order.bo] ? 'Guardando...' : 'Guardar'}
                </button>
              )}
              {mode === 'ordenes' && (
                <button
                  onClick={() => handleSAndDClick(order)}
                  className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${sAndDClass}`}
                >
                  {sAndDStatus === 'aplicado' ? 'S&D Aplicado' : 'S&D Pendiente'}
                </button>
              )}
              {mode === 'compras' && (
                <button
                  onClick={() => savePurchaseMeta(order.bo)}
                  disabled={!isPurchaseDirty}
                  className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${isPurchaseDirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400'}`}
                >
                  Guardar cambios
                </button>
              )}
              <button
                onClick={() => setExpandedBo(prev => (prev === order.bo ? null : order.bo))}
                className="text-xs text-blue-600 whitespace-nowrap hover:text-blue-700"
              >
                {expandedBo === order.bo ? 'Ocultar' : 'Ver detalle'}
              </button>
            </div>
            {mode === 'ordenes' ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <label className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">Proyecto</span>
                  <input
                    value={projectValue}
                    onChange={(e) => updateBoDraft(order.bo, { projectName: e.target.value })}
                    className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-56 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                    placeholder="Nombre del proyecto"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">PO Axis</span>
                  <input
                    value={poAxisValue}
                    onChange={(e) => updateBoDraft(order.bo, { poAxis: e.target.value })}
                    className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                    placeholder="PO Axis"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">Fecha fact.</span>
                  <input
                    type="date"
                    value={invoiceDateValue}
                    onChange={(e) => updateBoDraft(order.bo, { estimatedInvoiceDate: e.target.value })}
                    className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-44 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                  />
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <label className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">Compra</span>
                  <select
                    value={purchaseStatus}
                    onChange={(e) => updatePurchaseDraft(order.bo, { purchaseStatus: e.target.value })}
                    className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                  >
                    <option value="pendiente">Pendiente compra</option>
                    <option value="comprado">Comprado</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">SO</span>
                  <input
                    value={purchaseSo}
                    onChange={(e) => updatePurchaseDraft(order.bo, { purchaseSo: e.target.value })}
                    className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                    placeholder="SO"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">PO</span>
                  <input
                    value={purchasePoAxis}
                    onChange={(e) => updatePurchaseDraft(order.bo, { poAxis: e.target.value })}
                    className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                    placeholder="PO Axis"
                  />
                </label>
                {purchaseStatus === 'comprado' && (
                  <>
                    <label className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500">Despacho</span>
                      <select
                        value={purchaseDispatch}
                        onChange={(e) => updatePurchaseDraft(order.bo, { purchaseDispatch: e.target.value })}
                        className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                      >
                        <option value="">Seleccionar</option>
                        <option value="xus">XUS</option>
                        <option value="embarcador">Embarcador</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500">Vía</span>
                      <select
                        value={purchaseShipping}
                        onChange={(e) => updatePurchaseDraft(order.bo, { purchaseShipping: e.target.value })}
                        className="px-2 py-1 border border-slate-200 rounded-full text-xs text-slate-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-slate-50"
                      >
                        <option value="">Seleccionar</option>
                        <option value="aerea">Aérea</option>
                        <option value="maritima">Marítima</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
        {expandedBo === order.bo && (
          <div className="px-4 pb-4">
            <div className="text-xs text-gray-500 mb-2">
              Orden Cliente: {order.customerPO || 'N/A'}
            </div>
            <div className="text-xs text-gray-500 mb-2">
              Planned Ship Date: {order.plannedShipDate || 'N/A'}
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left">MPN</th>
                    <th className="px-2 py-2 text-left">SKU</th>
                    <th className="px-2 py-2 text-left">Producto</th>
                    <th className="px-2 py-2 text-left">Entrega (OOR)</th>
                    <th className="px-2 py-2 text-right">Cant. Alocada</th>
                    <th className="px-2 py-2 text-right">Cant. Orden</th>
                    <th className="px-2 py-2 text-right">Cant. Despachada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(order.lines || []).map((line, idx) => (
                    <tr key={`${order.bo}-${idx}`} className={idx % 2 === 1 ? 'bg-slate-50/40' : ''}>
                      <td className="px-2 py-2">{line.mpn || 'N/A'}</td>
                      <td className="px-2 py-2">{line.sku || 'N/A'}</td>
                      <td className="px-2 py-2">{line.desc || 'N/A'}</td>
                      <td className="px-2 py-2">{line.tiempoEntrega || 'N/A'}</td>
                      <td className="px-2 py-2 text-right">{line.allocQty ?? 0}</td>
                      <td className="px-2 py-2 text-right">{line.orderQty ?? 0}</td>
                      <td className="px-2 py-2 text-right">{line.shippedQty ?? 0}</td>
                    </tr>
                  ))}
                  {(order.lines || []).length > 0 && (
                    <tr className="bg-slate-100/70 font-semibold text-slate-700">
                      <td className="px-2 py-2" colSpan={4}>Totales</td>
                      <td className="px-2 py-2 text-right">{totalAllocQty}</td>
                      <td className="px-2 py-2 text-right">{totalOrderQty}</td>
                      <td className="px-2 py-2 text-right">{totalShippedQty}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const enviarACompras = (cot) => {
    window.location.href = buildCompraMailto(cot);
    setCompraPreviewCot(cot);
  };

  const filteredProductos = useMemo(() => {
    const t = searchTerm.toLowerCase();
    return adminProductos.filter(p =>
      p.marca.toLowerCase().includes(t) ||
      p.sku.toLowerCase().includes(t) ||
      p.desc.toLowerCase().includes(t)
    );
  }, [adminProductos, searchTerm]);

  const filteredCatalogo = useMemo(() => {
    const t = catalogSearch.toLowerCase();
    return productos.filter(p =>
      p.marca.toLowerCase().includes(t) ||
      p.sku.toLowerCase().includes(t) ||
      (p.mpn || '').toLowerCase().includes(t) ||
      p.desc.toLowerCase().includes(t)
    );
  }, [productos, catalogSearch]);

  const filteredStockCatalog = useMemo(() => {
    const tokens = buildSearchTokens(stockCatalogQuery);
    const originFilter = stockCatalogOrigin;
    return stockCatalog.filter(item => {
      if (originFilter !== 'all' && (item.origin || '').toUpperCase() !== originFilter) return false;
      if (tokens.length === 0) return true;
      const haystack = [
        item.brand,
        item.name,
        item.sku,
        item.mpn
      ].map(normalizeSearchText).join(' ');
      return tokens.every(token => haystack.includes(token));
    });
  }, [stockCatalog, stockCatalogQuery, stockCatalogOrigin]);

  useEffect(() => {
    if (currentView !== 'cotizador' || !catalogSearch.trim()) {
      setCatalogDropdownStyle(null);
      return;
    }
    const updatePosition = () => {
      const el = catalogInputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCatalogDropdownStyle({
        position: 'absolute',
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX,
        width: rect.width,
        zIndex: 60
      });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [catalogSearch, filteredCatalogo.length, currentView]);

  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const validIds = new Set(adminProductos.map(p => p.id));
      const next = new Set([...prev].filter(id => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [adminProductos]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [adminOrigin]);

  const toggleSelectAllFiltered = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = filteredProductos.length > 0 && filteredProductos.every(p => prev.has(p.id));
      if (allSelected) {
        filteredProductos.forEach(p => next.delete(p.id));
      } else {
        filteredProductos.forEach(p => next.add(p.id));
      }
      return next;
    });
  };

  const toggleSelectOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filteredProductos.length > 0 && filteredProductos.every(p => selectedIds.has(p.id));

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Cargando...</div>
      </div>
    );
  }

  // LOGIN
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0b1220] relative overflow-hidden">
        <div className="absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[520px] w-[520px] rounded-full bg-amber-300/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#1f2a44,transparent_55%)] opacity-60" />
        <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
          <div className="w-full max-w-5xl grid md:grid-cols-[1.1fr_0.9fr] rounded-[28px] overflow-hidden border border-white/15 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.9)]">
            <div className="hidden md:flex flex-col justify-between p-10 text-white bg-white/5">
              <div>
                <img src="/2-removebg-preview.png" alt="MyQuote" className="h-28 w-28 object-contain" />
                <p className="font-display text-2xl mt-4">myquote</p>
                <p className="text-sm text-blue-200/70 mt-3">Cotización Axis / Qnap - Intcomex</p>
              </div>
              <div className="space-y-3 text-sm text-blue-100/70">
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  <span>Gestiona cotizaciones con trazabilidad y control comercial.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  <span>Centraliza productos, márgenes y estados en un solo flujo.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  <span>Exporta reportes y comparte propuestas más rápido.</span>
                </div>
              </div>
            </div>
            <div className="p-8 sm:p-10 bg-white/10 backdrop-blur-2xl">
              <div className="flex flex-col items-center gap-2 text-center mb-8">
                <img src="/2-removebg-preview.png" alt="MyQuote" className="h-24 w-24 object-contain md:hidden" />
                <p className="text-blue-100/80 text-sm">Cotización Axis / Qnap - Intcomex</p>
                <p className="text-blue-100/60 text-xs">Ingrese sus credenciales</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-blue-100/80 mb-1">Usuario</label>
                  <input
                    type="text"
                    value={usuario}
                    onChange={e => setUsuario(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                    placeholder="Usuario"
                  />
                </div>
                <div>
                  <label className="block text-sm text-blue-100/80 mb-1">Contraseña</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                      placeholder="Contraseña"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-200/70 hover:text-white text-sm"
                    >
                      {showPassword ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                </div>
                {loginError && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-200 text-sm text-center">
                    {loginError}
                  </div>
                )}
                <button
                  onClick={handleLogin}
                  className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl hover:from-cyan-600 hover:to-blue-600"
                >
                  Ingresar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VISTA CLIENTE
  if (currentView === 'cliente') {
    const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
    return (
      <div className="min-h-screen bg-gray-100 p-4 print:bg-white">
        <div className={`max-w-4xl mx-auto bg-white shadow-xl print:shadow-none rounded-lg overflow-hidden ${printQuote ? '' : 'print-area'}`}>
          <div className="p-8 border-b bg-white">
            <div className="flex items-center justify-between gap-4">
              <div style={{ width: '208px', height: '56px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <img
                  src="/logo.png"
                  alt="Logo"
                  width={208}
                  height={56}
                  style={{ width: '208px', height: '56px', objectFit: 'contain', objectPosition: 'left center', display: 'block' }}
                />
              </div>
              <div className="text-right text-xs text-gray-500">
                <div><span className="font-semibold text-gray-700">Fecha:</span> {fecha}</div>
              </div>
            </div>
          </div>
          <div className="p-4 bg-gray-50 border-b grid grid-cols-2 gap-2 text-sm">
            <div><b>Nombre:</b> {cliente.nombre || 'N/A'}</div>
            <div><b>Empresa:</b> {cliente.empresa || 'N/A'}</div>
            <div><b>PID:</b> {cliente.pid || 'N/A'}</div>
            <div><b>Nombre del proyecto:</b> {cliente.proyecto || 'N/A'}</div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-2 text-left">Marca</th>
                  <th className="px-2 py-2 text-center">Cant.</th>
                  <th className="px-2 py-2 text-left">SKU</th>
                  <th className="px-2 py-2 text-left">MPN</th>
                  <th className="px-2 py-2 text-left">Descripción</th>
                  <th className="px-2 py-2 text-right">P. Unit.</th>
                  <th className="px-2 py-2 text-right">P. Total</th>
                  <th className="px-2 py-2 text-center">Entrega</th>
                </tr>
              </thead>
              <tbody>
                {cotizacion.map((item, i) => {
                  const pu = calcularPrecioClienteItem(item);
                  return (
                    <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-2">{item.marca}</td>
                      <td className="px-2 py-2 text-center">{item.cant}</td>
                      <td className="px-2 py-2 font-mono text-xs">{item.sku}</td>
                      <td className="px-2 py-2 font-mono text-xs">{item.mpn}</td>
                      <td className="px-2 py-2">{item.desc}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(pu)}</td>
                      <td className="px-2 py-2 text-right font-semibold">{formatCurrency(pu * item.cant)}</td>
                      <td className="px-2 py-2 text-center text-xs">{item.tiempo}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end">
              <div className="bg-blue-600 text-white px-6 py-3 rounded-lg">
                <span className="text-sm">TOTAL (No incluye IVA): </span>
                <span className="text-xl font-bold">{formatCurrency(totalCotizacion)}</span>
              </div>
            </div>
          </div>
          <div className="p-4 bg-gray-50 border-t text-xs text-gray-600">
            <h3 className="font-bold text-gray-800 mb-2">OBSERVACIONES Y CONDICIONES:</h3>
            <ol className="list-decimal list-inside space-y-1">
              <li>Los valores están expresados en dólares americanos. No incluye IVA.</li>
              <li>La cotización posee una validez de 15 días desde la fecha de emisión.</li>
              <li>El tipo de cambio a utilizar será el dólar observado del día anterior más $5.</li>
              <li>Los valores son válidos considerando la compra total de la cotización.</li>
              <li>Las garantías son de acuerdo con las políticas de cada marca.</li>
              <li>Intcomex Chile otorga 24hrs para informar problemas de garantías en pantallas.</li>
              <li>No se permite la anulación de OC sobre equipos a importación calzada.</li>
              <li>La persona que autoriza la OC es responsable del cumplimiento del pago.</li>
              {!isAdmin && (
                <li>La presente cotizacion, no constituye una oferta formal ni vinculante hasta su validación por el Product Manager. (Alexis González)</li>
              )}
            </ol>
          </div>
          <div className="p-3 bg-gray-800 text-white text-center text-sm">
            <p className="font-semibold">Favor Emitir Orden de Compra a: INTCOMEX CHILE S.A.</p>
            <p className="text-gray-300">Rut: 96.705.940-4 - Cordillera 331 - Quilicura - Santiago</p>
          </div>
        </div>
        <div className="mt-4 flex justify-center gap-3 flex-wrap print:hidden">
          <button onClick={() => setCurrentView('cotizador')} className="px-5 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
            Volver
          </button>
          <button onClick={exportCotizacionPdf} className="px-5 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800">
            Exportar PDF
          </button>
          <button onClick={exportCotizacionExcel} className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
            Exportar Excel
          </button>
          <button onClick={saveCotizacion} disabled={saving} className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar Cotización'}
          </button>
        </div>
      </div>
    );
  }

  // VISTA PRINCIPAL
  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(1200px_circle_at_top_left,#e0f2fe,transparent_55%),radial-gradient(900px_circle_at_bottom_right,#fef3c7,transparent_60%)] bg-[#f7f4ef]">
      {printQuote && (
        <div className="print-area bg-white">
          <div className="max-w-4xl mx-auto bg-white rounded-lg overflow-hidden">
            <div className="p-8 border-b bg-white">
              <div className="flex items-center justify-between gap-4">
                <div style={{ width: '208px', height: '56px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  <img
                    src="/logo.png"
                    alt="Logo"
                    width={208}
                    height={56}
                    style={{ width: '208px', height: '56px', objectFit: 'contain', objectPosition: 'left center', display: 'block' }}
                  />
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>
                    <span className="font-semibold text-gray-700">Fecha:</span>{' '}
                    {printQuote.created_at
                      ? new Date(printQuote.created_at).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })
                      : 'N/A'}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-b grid grid-cols-2 gap-2 text-sm">
              <div><b>Nombre:</b> {printQuote.cliente_nombre || 'N/A'}</div>
              <div><b>Empresa:</b> {printQuote.cliente_empresa || 'N/A'}</div>
              <div><b>PID:</b> {printQuote.cliente_email || 'N/A'}</div>
              <div><b>Nombre del proyecto:</b> {printQuote.cliente_telefono || 'N/A'}</div>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-2 py-2 text-left">Marca</th>
                    <th className="px-2 py-2 text-center">Cant.</th>
                    <th className="px-2 py-2 text-left">SKU</th>
                    <th className="px-2 py-2 text-left">MPN</th>
                    <th className="px-2 py-2 text-left">Descripción</th>
                    <th className="px-2 py-2 text-right">P. Unit.</th>
                    <th className="px-2 py-2 text-right">P. Total</th>
                    <th className="px-2 py-2 text-center">Entrega</th>
                  </tr>
                </thead>
                <tbody>
                  {(printQuote.items || []).map((item, i) => (
                    <tr key={`${printQuote.id}-${item.id || i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-2">{item.marca}</td>
                      <td className="px-2 py-2 text-center">{item.cantidad}</td>
                      <td className="px-2 py-2 font-mono text-xs">{item.sku}</td>
                      <td className="px-2 py-2 font-mono text-xs">{item.mpn}</td>
                      <td className="px-2 py-2">{item.descripcion}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(item.precio_unitario || 0)}</td>
                      <td className="px-2 py-2 text-right font-semibold">{formatCurrency(item.precio_total || 0)}</td>
                      <td className="px-2 py-2 text-center text-xs">{item.tiempo_entrega}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex justify-end">
                <div className="bg-blue-600 text-white px-6 py-3 rounded-lg">
                  <span className="text-sm">TOTAL (No incluye IVA): </span>
                  <span className="text-xl font-bold">{formatCurrency(printQuote.total || 0)}</span>
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t text-xs text-gray-600">
              <h3 className="font-bold text-gray-800 mb-2">OBSERVACIONES Y CONDICIONES:</h3>
              <ol className="list-decimal list-inside space-y-1">
                <li>Los valores están expresados en dólares americanos. No incluye IVA.</li>
                <li>La cotización posee una validez de 15 días desde la fecha de emisión.</li>
                <li>El tipo de cambio a utilizar será el dólar observado del día anterior más $5.</li>
                <li>Los valores son válidos considerando la compra total de la cotización.</li>
                <li>Las garantías son de acuerdo con las políticas de cada marca.</li>
                <li>Intcomex Chile otorga 24hrs para informar problemas de garantías en pantallas.</li>
                <li>No se permite la anulación de OC sobre equipos a importación calzada.</li>
                <li>La persona que autoriza la OC es responsable del cumplimiento del pago.</li>
                {printQuote?.usuario_role === 'client' && (
                  <li>La presente cotizacion, no constituye una oferta formal ni vinculante hasta su validación por el Product Manager. (Alexis González)</li>
                )}
              </ol>
            </div>
            <div className="p-3 bg-gray-800 text-white text-center text-sm">
              <p className="font-semibold">Favor Emitir Orden de Compra a: INTCOMEX CHILE S.A.</p>
              <p className="text-gray-300">Rut: 96.705.940-4 - Cordillera 331 - Quilicura - Santiago</p>
            </div>
          </div>
        </div>
      )}
      {!isAdmin && (
        <a
          href="https://wa.me/56935134131"
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg bg-green-500 text-white hover:bg-green-600"
          aria-label="Necesitas Ayuda? WhatsApp"
        >
          <span className="text-sm font-semibold">¿Necesitas Ayuda?</span>
        </a>
      )}
      <div className="flex-1 flex flex-col">
        <header className="bg-white/80 backdrop-blur-xl border-b border-white/60 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {user?.logo_url ? (
                <img
                  src={user.logo_url}
                  alt="Logo"
                  className="w-12 h-12 rounded-xl object-contain bg-white shadow-sm"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-white/60 border border-white" />
              )}
              <div>
                <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">myquote</div>
                <h1 className="text-lg md:text-xl font-display text-slate-900">Cotización Axis / Qnap - Intcomex</h1>
                <p className="text-xs text-slate-500">Bienvenido, {user?.nombre || user?.usuario}</p>
              </div>
            </div>
            <nav className="flex items-center gap-2 flex-wrap">
              {isAdmin && (
                <>
                  <button
                    onClick={() => setCurrentView('ordenes')}
                    className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'ordenes' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}
                  >
                    Ordenes Activas
                  </button>
                  <button
                    onClick={() => setCurrentView('compras')}
                    className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'compras' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}
                  >
                    Vista Compras
                  </button>
                </>
              )}
              {isAdmin && (
                <button
                  onClick={() => setCurrentView('admin')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'admin' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}
                >
                  Listas de precio
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => setCurrentView('usuarios')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'usuarios' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}
                >
                  Gestión de usuarios
                </button>
              )}
            <button onClick={() => setCurrentView('cotizador')} className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'cotizador' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}>
              Cotizador {cotizacion.length > 0 && <span className="ml-1 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full">{cotizacion.length}</span>}
            </button>
            <button onClick={() => setCurrentView('stock')} className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'stock' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}>
              Stock disponible
            </button>
            <button onClick={() => setCurrentView('historial')} className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'historial' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}>
              {isAdmin ? 'Historial de cotizaciones' : 'Mis cotizaciones'}
              {isAdmin && historialCounts.registroPendientes > 0 && (
                <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-800">
                  {historialCounts.registroPendientes}
                </span>
              )}
            </button>
            {!isAdmin && (
              <button onClick={() => setCurrentView('cuenta')} className={`px-3 py-2 rounded-xl text-sm font-medium transition ${currentView === 'cuenta' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70'}`}>
                Mi cuenta
              </button>
            )}
            <button onClick={handleLogout} className="px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-sm font-medium">
              Salir
            </button>
            </nav>
          </div>
        </header>

        <main className={`${isClient ? 'w-[92%]' : 'max-w-7xl'} mx-auto px-4 py-6`}>
        {currentView === 'stock' && (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl shadow-[0_18px_36px_-28px_rgba(15,23,42,0.35)] border border-white/70 overflow-hidden">
              <div className="p-4 border-b bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-gray-800">Stock disponible</h3>
                  <p className="text-xs text-gray-500">Disponible para entrega inmediata según inventario.</p>
                </div>
                <span className="text-xs text-gray-500">{filteredStockCatalog.length} ítems</span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <input
                    type="text"
                    placeholder="Buscar por marca, SKU, MPN o descripción..."
                    value={stockCatalogQuery}
                    onChange={e => setStockCatalogQuery(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  />
                  <div className="flex items-center gap-2">
                    {['all', 'AXIS', 'QNAP'].map(origin => (
                      <button
                        key={origin}
                        onClick={() => setStockCatalogOrigin(origin)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                          stockCatalogOrigin === origin ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {origin === 'all' ? 'Todos' : origin}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  Tip: puedes buscar por varias palabras, por ejemplo "Axis 03181".
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Producto</th>
                      <th className="px-4 py-3 text-left">Marca</th>
                      <th className="px-4 py-3 text-left">SKU</th>
                      <th className="px-4 py-3 text-left">MPN</th>
                      <th className="px-4 py-3 text-right">Disponible</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockCatalogLoading && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-gray-500">Cargando stock...</td>
                      </tr>
                    )}
                    {!stockCatalogLoading && stockCatalogError && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-red-600">{stockCatalogError}</td>
                      </tr>
                    )}
                    {!stockCatalogLoading && !stockCatalogError && filteredStockCatalog.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-gray-500">Sin resultados.</td>
                      </tr>
                    )}
                    {!stockCatalogLoading && !stockCatalogError && filteredStockCatalog.map((item, idx) => (
                      <tr key={`${item.mpn || item.sku || 'item'}-${idx}`} className={idx % 2 === 1 ? 'bg-slate-50/40' : ''}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name || 'Producto'}
                                className="w-14 h-14 object-contain bg-white border rounded"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-14 h-14 bg-slate-100 border rounded" />
                            )}
                            <div className="min-w-0">
                              <div className="font-medium text-gray-800 truncate">{item.name || 'Sin descripción'}</div>
                              {item.origin && (
                                <div className="text-[11px] text-gray-500">{item.origin}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">{item.brand || 'N/A'}</td>
                        <td className="px-4 py-3">{item.sku || 'N/A'}</td>
                        <td className="px-4 py-3">{item.mpn || 'N/A'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-700">{formatStockQuantity(item.quantity) || '0'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {currentView === 'usuarios' && isAdmin && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
              <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-gray-800">Empresas</h2>
                  <span className="text-xs text-gray-500">{Object.keys(empresaConfigs).length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowEmpresaForm(v => !v)}
                    className="px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-sm"
                  >
                    {showEmpresaForm ? 'Cerrar' : 'Crear empresa'}
                  </button>
                </div>
                {showEmpresaForm && (
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <input
                      placeholder="Nombre de empresa"
                      value={empresaForm.nombre}
                      onChange={e => setEmpresaForm(f => ({ ...f, nombre: e.target.value }))}
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-[11px] text-gray-500">
                        Rol
                        <select
                          value={empresaForm.role}
                          onChange={e => setEmpresaForm(f => ({ ...f, role: e.target.value }))}
                          className="px-3 py-2 border rounded-lg text-sm text-gray-800"
                        >
                          <option value="client">Cliente</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-gray-500">
                        GP QNAP (%)
                        <input
                          type="number"
                          value={empresaForm.gp_qnap}
                          onChange={e => setEmpresaForm(f => ({ ...f, gp_qnap: e.target.value }))}
                          className="px-3 py-2 border rounded-lg text-sm text-gray-800"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-gray-500">
                        GP AXIS (%)
                        <input
                          type="number"
                          value={empresaForm.gp_axis}
                          onChange={e => setEmpresaForm(f => ({ ...f, gp_axis: e.target.value }))}
                          className="px-3 py-2 border rounded-lg text-sm text-gray-800"
                        />
                      </label>
                    </div>
                    <select
                      value={empresaForm.partner_category}
                      onChange={e => setEmpresaForm(f => ({ ...f, partner_category: e.target.value }))}
                      className="px-3 py-2 border rounded-lg text-sm"
                    >
                      <option>Partner Autorizado</option>
                      <option>Partner Silver</option>
                      <option>Partner Gold</option>
                      <option>Partner Multiregional</option>
                    </select>
                    <div className="flex items-center gap-3">
                      <label className="px-3 py-2 border rounded-lg text-sm cursor-pointer bg-white">
                        Cargar logo (500x500)
                        <input
                          type="file"
                          accept="image/*"
                          onChange={e => handleLogoUpload(e.target.files?.[0], (val) => setEmpresaForm(f => ({ ...f, logo_url: val })))}
                          className="hidden"
                        />
                      </label>
                      {empresaForm.logo_url && (
                        <img src={empresaForm.logo_url} alt="Preview" className="w-12 h-12 rounded object-contain border bg-white" />
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={saveEmpresaConfig}
                        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                      >
                        Guardar empresa
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-4 space-y-3 max-h-[60vh] overflow-auto pr-1">
                  {Object.values(empresaConfigs).length === 0 ? (
                    <div className="text-xs text-gray-500">Crea una empresa para asignar usuarios.</div>
                  ) : (
                    Object.values(empresaConfigs).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(empresa => (
                      <div
                        key={empresa.nombre}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={async (e) => {
                          e.preventDefault();
                          const userId = e.dataTransfer.getData('text/plain');
                          if (userId) await assignUserToEmpresa(Number(userId), empresa.nombre);
                        }}
                        className="border-2 border-dashed border-slate-200 rounded-xl p-3 bg-white/70"
                      >
                        {(() => {
                          const usersInEmpresa = usuarios.filter(u => (u.empresa || '').trim() === empresa.nombre);
                          const handleUserClick = (userId) => {
                            setSelectedUsuarioId(userId);
                            const target = userCardRefs.current[userId];
                            if (target) {
                              setTimeout(() => {
                                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }, 50);
                            }
                          };
                          return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {empresa.logo_url ? (
                              <img src={empresa.logo_url} alt={empresa.nombre} className="w-8 h-8 rounded object-contain border bg-white" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-slate-100 border" />
                            )}
                            <div>
                              <div className="text-sm font-semibold text-slate-800">{empresa.nombre}</div>
                              <div className="text-[11px] text-slate-500">
                                Rol: {empresa.role === 'admin' ? 'Administrador' : 'Cliente'} • GP QNAP {empresa.gp_qnap}% • GP AXIS {empresa.gp_axis}%
                              </div>
                              <div className="text-[11px] text-slate-500">Partner: {empresa.partner_category}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => loadEmpresaForm(empresa)}
                            className="px-2 py-1 text-[11px] bg-slate-100 rounded hover:bg-slate-200"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => deleteEmpresa(empresa.nombre)}
                            className="px-2 py-1 text-[11px] bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Eliminar
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          {usersInEmpresa.length === 0 ? (
                            <span className="text-slate-400">Arrastra usuarios aquí para asignar y aplicar márgenes.</span>
                          ) : (
                            <>
                              <span className="text-slate-400">Usuarios:</span>
                              {usersInEmpresa.map(u => {
                                const initials = (u.nombre || u.usuario || 'U')
                                  .split(' ')
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map(word => word[0]?.toUpperCase())
                                  .join('');
                                return (
                                  <button
                                    key={u.id}
                                    onClick={() => handleUserClick(u.id)}
                                    className="flex items-center gap-2 px-2 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                                  >
                                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] flex items-center justify-center">
                                      {initials || 'U'}
                                    </span>
                                    <span className="text-[11px] text-slate-700">{u.nombre || u.usuario}</span>
                                  </button>
                                );
                              })}
                            </>
                          )}
                        </div>
                        </div>
                          );
                        })()}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-800">Usuarios</h3>
                  <span className="text-xs text-gray-500">{usuarios.length}</span>
                </div>
                {selectedUsuarioId && (() => {
                  const selectedUser = usuarios.find(u => u.id === selectedUsuarioId);
                  if (!selectedUser) return null;
                  const isFixedAdmin = (selectedUser.usuario || '').toLowerCase() === 'agonz';
                  return (
                    <div className="mb-3 border rounded-xl p-3 bg-white/80">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{selectedUser.usuario}</div>
                          <div className="text-[11px] text-slate-500">{selectedUser.nombre || 'Sin nombre'}</div>
                          <div className="text-[11px] text-slate-400">
                            {selectedUser.empresa ? `Empresa: ${selectedUser.empresa}` : 'Sin empresa'}
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedUsuarioId(null)}
                          className="text-[11px] text-slate-500 hover:text-slate-700"
                        >
                          Cerrar
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2">
                        <select
                          value={selectedUser.empresa || ''}
                          onChange={e => assignUserToEmpresa(selectedUser.id, e.target.value)}
                          className="px-2 py-1 border rounded text-xs"
                          disabled={Object.keys(empresaConfigs).length === 0}
                        >
                          <option value="">Sin empresa</option>
                          {Object.values(empresaConfigs).map(emp => (
                            <option key={emp.nombre} value={emp.nombre}>{emp.nombre}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <input
                            placeholder="Nueva contraseña"
                            value={usuarioPasswordById[selectedUser.id] || ''}
                            onChange={e => setUsuarioPasswordById(prev => ({ ...prev, [selectedUser.id]: e.target.value }))}
                            className="px-2 py-1 border rounded text-xs flex-1"
                          />
                          <button
                            onClick={() => resetUsuarioPassword(selectedUser.id, usuarioPasswordById[selectedUser.id])}
                            disabled={usuariosLoading}
                            className="px-2 py-1 bg-slate-200 rounded hover:bg-slate-300 text-xs"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => deleteUsuario(selectedUser.id)}
                            disabled={usuariosLoading || isFixedAdmin}
                            className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 text-xs"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => setShowUsuarioForm(v => !v)}
                    className="px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-sm"
                  >
                    {showUsuarioForm ? 'Cerrar' : 'Crear usuario'}
                  </button>
                </div>
                {showUsuarioForm && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                    <input
                      placeholder="Usuario"
                      value={nuevoUsuario.usuario}
                      onChange={e => setNuevoUsuario(u => ({ ...u, usuario: e.target.value }))}
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      placeholder="Nombre"
                      value={nuevoUsuario.nombre}
                      onChange={e => setNuevoUsuario(u => ({ ...u, nombre: e.target.value }))}
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      placeholder="Contraseña"
                      type="password"
                      value={nuevoUsuario.password}
                      onChange={e => setNuevoUsuario(u => ({ ...u, password: e.target.value }))}
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <button
                      onClick={createUsuario}
                      disabled={usuariosLoading}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm md:col-span-3"
                    >
                      Crear usuario
                    </button>
                    {usuariosError && (
                      <div className="text-xs text-red-600 md:col-span-3">{usuariosError}</div>
                    )}
                  </div>
                )}

                {usuariosLoading ? (
                  <div className="text-xs text-gray-500">Cargando...</div>
                ) : usuarios.length === 0 ? (
                  <div className="text-xs text-gray-500">Sin usuarios.</div>
                ) : (
                  <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                    {usuarios.filter(u => !(u.empresa || '').trim()).map(u => {
                      const isFixedAdmin = (u.usuario || '').toLowerCase() === 'agonz';
                      return (
                        <div
                          key={u.id}
                          draggable={!isFixedAdmin}
                          onDragStart={(e) => {
                            if (isFixedAdmin) return;
                            e.dataTransfer.setData('text/plain', String(u.id));
                          }}
                          ref={(el) => { userCardRefs.current[u.id] = el; }}
                          className={`border rounded-xl p-3 bg-white/70 ${isFixedAdmin ? 'opacity-70' : 'cursor-grab'}`}
                        >
                          <div className="w-full text-left flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-800">{u.usuario}</div>
                              <div className="text-[11px] text-slate-500">{u.nombre || 'Sin nombre'}</div>
                              <div className="text-[11px] text-slate-400">
                                {u.empresa ? `Empresa: ${u.empresa}` : 'Sin empresa'}
                              </div>
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">
                              {u.role === 'admin' ? 'Administrador' : 'Cliente'}
                            </div>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              onClick={() => setSelectedUsuarioId(u.id)}
                              className="px-2 py-1 text-xs bg-slate-900 text-white rounded hover:bg-slate-800"
                            >
                              Editar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-800">Sesiones activas</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => loadActiveSessions()}
                    className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800"
                  >
                    Refrescar
                  </button>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={sessionAutoRefresh}
                      onChange={(e) => setSessionAutoRefresh(e.target.checked)}
                    />
                    Actualizacion automatica (10s)
                  </label>
                </div>
              </div>
              {sessionsError && <div className="mt-2 text-sm text-rose-600">{sessionsError}</div>}
              <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-4">
                <div className="border border-white/70 rounded-xl p-3 bg-white/70">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">Usuarios activos</h3>
                    <span className="text-xs text-gray-500">{sessionsByUser.length}</span>
                  </div>
                  {sessionsLoading ? (
                    <div className="text-sm text-gray-500">Cargando sesiones...</div>
                  ) : sessionsByUser.length === 0 ? (
                    <div className="text-sm text-gray-500">No hay sesiones activas.</div>
                  ) : (
                    <div className="space-y-2">
                      {sessionsByUser.map(item => (
                        <button
                          key={item.userId}
                          onClick={() => setSelectedSessionUserId(item.userId)}
                          className={`w-full text-left p-3 rounded-xl border transition ${selectedSessionUserId === item.userId ? 'border-slate-900 bg-white' : 'border-white/70 bg-white/70 hover:bg-white'}`}
                        >
                          <div className="text-sm font-semibold text-slate-900">{item.nombre || item.usuario || 'Usuario'}</div>
                          <div className="text-xs text-gray-500">{item.empresa || 'Sin empresa'} - {item.role || 'client'}</div>
                          <div className="text-[11px] text-gray-400">
                            Sesiones: {item.sessions.length} - Ultima actividad: {formatDateTime(item.lastSeen)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  <div className="border border-white/70 rounded-xl p-3 bg-white/70">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-800">Sesiones del usuario</h3>
                      <button
                        onClick={() => loadUserActivity(selectedSessionUserId)}
                        className="px-2 py-1 text-xs rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                      >
                        Actualizar
                      </button>
                    </div>
                    {userActivityLoading ? (
                      <div className="text-sm text-gray-500">Cargando actividad...</div>
                    ) : userActivityError ? (
                      <div className="text-sm text-rose-600">{userActivityError}</div>
                    ) : userSessions.length === 0 ? (
                      <div className="text-sm text-gray-500">Selecciona un usuario con sesiones activas.</div>
                    ) : (
                      <div className="space-y-2">
                        {userSessions.map(session => (
                          <div key={session.session_id} className="p-3 rounded-xl border border-white/70 bg-white/70">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-900">
                                  Ses. #{(session.session_id || '').toString().slice(-6)}
                                </div>
                                <div className="text-[11px] text-gray-500">
                                  {session.device_id || 'Dispositivo N/A'} - {session.ip_address || 'IP N/A'}
                                </div>
                                <div className="text-[11px] text-gray-400">
                                  Inicio: {formatDateTime(session.started_at)} - Ultima: {formatDateTime(session.last_seen)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[11px] px-2 py-0.5 rounded-full ${session.active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                  {session.active ? 'Activa' : 'Inactiva'}
                                </span>
                                {session.active && (
                                  <button
                                    onClick={() => revokeSession(session.session_id)}
                                    className="px-2 py-1 text-xs rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100"
                                  >
                                    Cerrar
                                  </button>
                                )}
                              </div>
                            </div>
                            {session.user_agent && (
                              <div className="mt-2 text-[11px] text-gray-500">UA: {session.user_agent}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border border-white/70 rounded-xl p-3 bg-white/70">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-800">Logs de acceso</h3>
                      <span className="text-xs text-gray-500">{userLogs.length}</span>
                    </div>
                    {userActivityLoading ? (
                      <div className="text-sm text-gray-500">Cargando logs...</div>
                    ) : userLogs.length === 0 ? (
                      <div className="text-sm text-gray-500">Sin registros para este usuario.</div>
                    ) : (
                      <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                        {userLogs.map(log => (
                          <div key={log.id} className="p-3 rounded-xl border border-white/70 bg-white/70">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold text-slate-900">
                                {log.success ? 'Login OK' : 'Login fallido'}
                              </div>
                              <span className="text-[11px] text-gray-400">{formatDateTime(log.created_at)}</span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                              IP: {log.ip_address || 'N/A'} - Sesion: {(log.session_id || '').toString().slice(-6) || 'N/A'}
                            </div>
                            {log.user_agent && (
                              <div className="text-[11px] text-gray-500 mt-1">UA: {log.user_agent}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {currentView === 'admin' && (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Listas de precio</h2>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <button
                  onClick={() => setAdminOrigin('QNAP')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${adminOrigin === 'QNAP' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Gestión de Productos QNAP
                </button>
                <button
                  onClick={() => setAdminOrigin('AXIS')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${adminOrigin === 'AXIS' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Gestión de Productos Axis
                </button>
                <a
                  href="https://docs.google.com/spreadsheets/d/1dF7GCG0NZe5MIo_DZHuDMiFWueR4vdieGYpaSALqbQM/edit?gid=436802384#gid=436802384"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
                >
                  Abrir Excel maestro
                </a>
                <button
                  onClick={() => syncFromSheetsOrigin('QNAP')}
                  disabled={saving}
                  className="px-3 py-1.5 text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Sync rápido QNAP
                </button>
                <button
                  onClick={() => syncFromSheetsOrigin('AXIS')}
                  disabled={saving}
                  className="px-3 py-1.5 text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Sync rápido AXIS
                </button>
              </div>
              {showAddForm && (
                <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <h3 className="font-semibold mb-3">Nuevo Producto</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <input placeholder="Marca" value={newProduct.marca} onChange={e => setNewProduct(p => ({ ...p, marca: e.target.value }))} className="px-3 py-2 border rounded-lg" />
                    <input placeholder="SKU *" value={newProduct.sku} onChange={e => setNewProduct(p => ({ ...p, sku: e.target.value }))} className="px-3 py-2 border rounded-lg" />
                    <input placeholder="MPN" value={newProduct.mpn} onChange={e => setNewProduct(p => ({ ...p, mpn: e.target.value }))} className="px-3 py-2 border rounded-lg" />
                    <input placeholder="Descripción" value={newProduct.desc} onChange={e => setNewProduct(p => ({ ...p, desc: e.target.value }))} className="px-3 py-2 border rounded-lg" />
                    <input type="number" placeholder="Precio Disty" value={newProduct.precio} onChange={e => setNewProduct(p => ({ ...p, precio: e.target.value }))} className="px-3 py-2 border rounded-lg" />
                    <input placeholder="GP % (ej: 15)" value={newProduct.gp} onChange={e => setNewProduct(p => ({ ...p, gp: e.target.value }))} className="px-3 py-2 border rounded-lg" />
                    <input placeholder="Tiempo Entrega" value={newProduct.tiempo} onChange={e => setNewProduct(p => ({ ...p, tiempo: e.target.value }))} className="px-3 py-2 border rounded-lg" />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={handleAddProduct} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      {saving ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button onClick={() => setShowAddForm(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Cancelar</button>
                  </div>
                </div>
              )}
            </div>
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Parametros de calculo</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="p-2 bg-slate-50 rounded-lg border">
                  <label className="text-xs text-gray-500">Inbound Freight</label>
                  <input
                    type="number"
                    step="0.001"
                    value={adminOrigin === 'AXIS' ? AXIS_CONSTANTS.INBOUND_FREIGHT : (Number.isFinite(calcParams.INBOUND_FREIGHT) ? calcParams.INBOUND_FREIGHT : '')}
                    onChange={e => updateCalcParam('INBOUND_FREIGHT', e.target.value)}
                    className="mt-1 w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
                <div className="p-2 bg-slate-50 rounded-lg border">
                  <label className="text-xs text-gray-500">IC</label>
                  <input
                    type="number"
                    step="0.001"
                    value={adminOrigin === 'AXIS' ? AXIS_CONSTANTS.IC : (Number.isFinite(calcParams.IC) ? calcParams.IC : '')}
                    onChange={e => updateCalcParam('IC', e.target.value)}
                    className="mt-1 w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
                <div className="p-2 bg-slate-50 rounded-lg border">
                  <label className="text-xs text-gray-500">INT (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={adminOrigin === 'AXIS' ? (AXIS_CONSTANTS.INT * 100) : (Number.isFinite(calcParams.INT) ? (calcParams.INT * 100) : '')}
                    onChange={e => updateCalcParam('INT', e.target.value, true)}
                    className="mt-1 w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 overflow-hidden">
              <div className="p-3 border-b flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-semibold">Catlogo ({adminProductos.length})</h3>
                <input type="text" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="px-3 py-1.5 border rounded-lg text-sm" />
              </div>
              {selectedIds.size > 1 && (
                <div className="px-3 py-2 border-b bg-white">
                  <button
                    onClick={deleteSelectedProducts}
                    disabled={saving}
                    className="px-2 py-1 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
                  >
                    Eliminar seleccionados ({selectedIds.size})
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-center">
                        <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAllFiltered} />
                      </th>
                      <th className="px-3 py-2 text-left">Marca</th>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">MPN</th>
                      <th className="px-3 py-2 text-left">Descripción</th>
                      <th className="px-3 py-2 text-right">Precio Disty</th>
                      <th className="px-3 py-2 text-right">Precio Cliente</th>
                      <th className="px-3 py-2 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredProductos.length === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">{adminProductos.length === 0 ? 'No hay productos. Cargue un Excel o agregue uno.' : 'Sin resultados.'}</td></tr>
                    ) : filteredProductos.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        {editingId === p.id ? (
                          <>
                            <td className="px-2 py-1 text-center">
                              <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelectOne(p.id)} />
                            </td>
                            <td className="px-2 py-1"><input value={editForm.marca} onChange={e => setEditForm(f => ({ ...f, marca: e.target.value }))} className="w-full px-2 py-1 border rounded" /></td>
                            <td className="px-2 py-1"><input value={editForm.sku} onChange={e => setEditForm(f => ({ ...f, sku: e.target.value }))} className="w-full px-2 py-1 border rounded" /></td>
                            <td className="px-2 py-1"><input value={editForm.mpn} onChange={e => setEditForm(f => ({ ...f, mpn: e.target.value }))} className="w-full px-2 py-1 border rounded" /></td>
                            <td className="px-2 py-1"><input value={editForm.desc} onChange={e => setEditForm(f => ({ ...f, desc: e.target.value }))} className="w-full px-2 py-1 border rounded" /></td>
                            <td className="px-2 py-1"><input type="number" value={editForm.precio} onChange={e => setEditForm(f => ({ ...f, precio: e.target.value }))} className="w-20 px-2 py-1 border rounded text-right" /></td>
                            <td className="px-2 py-1 text-right text-gray-600">{formatCurrency(calcularPrecioClienteLocal(parseFloat(editForm.precio) || 0, calcParams.DEFAULT_GP))}</td>
                            <td className="px-2 py-1 text-center">
                              <button onClick={saveEdit} disabled={saving} className="px-2 py-1 text-green-600 hover:bg-green-50 rounded text-xs">Guardar</button>
                              <button onClick={() => setEditingId(null)} className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded text-xs">Cancelar</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelectOne(p.id)} />
                            </td>
                            <td className="px-3 py-2">{p.marca}</td>
                            <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                            <td className="px-3 py-2 font-mono text-xs">{p.mpn}</td>
                            <td className="px-3 py-2">{p.desc}</td>
                            <td className="px-3 py-2 text-right">{formatCurrency(p.precio)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-blue-600">{formatCurrency(calcularPrecioAdmin(p))}</td>
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => startEdit(p)} className="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded text-xs">Editar</button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t flex items-center justify-between flex-wrap gap-2">
                <div className="text-xs text-gray-500 flex items-center gap-2">
                  <span>{selectedIds.size > 0 ? `${selectedIds.size} seleccionados` : 'Sin seleccionados'}</span>
                  {filteredProductos.length > 0 && (
                    <button
                      onClick={toggleSelectAllFiltered}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Seleccionar todo
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2" />
              </div>
            </div>
          </div>
        )}

        {currentView === 'historial' && (
          <div className="space-y-4">
            {isAdmin && (
              <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-800">Funnel de aprobacion</h2>
                    <p className="text-xs text-gray-500">
                      {(funnelFrom || funnelTo)
                        ? `Rango: ${funnelFrom || '...'} - ${funnelTo || '...'}${funnelEmpresa ? ` - ${funnelEmpresa}` : ''}`
                        : `Ultimos ${funnelDays} dias${funnelEmpresa ? ` - ${funnelEmpresa}` : ''}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="date"
                        value={funnelFrom}
                        onChange={(e) => setFunnelFrom(e.target.value)}
                        className="px-2 py-1.5 border rounded-lg text-xs text-slate-700"
                      />
                      <span>hasta</span>
                      <input
                        type="date"
                        value={funnelTo}
                        onChange={(e) => setFunnelTo(e.target.value)}
                        className="px-2 py-1.5 border rounded-lg text-xs text-slate-700"
                      />
                      <button
                        onClick={() => { setFunnelFrom(''); setFunnelTo(''); }}
                        className="px-2 py-1.5 border rounded-lg text-xs text-slate-600 hover:bg-slate-100"
                      >
                        Limpiar
                      </button>
                    </div>
                    <select
                      value={funnelDays}
                      onChange={(e) => setFunnelDays(Number(e.target.value))}
                      disabled={Boolean(funnelFrom || funnelTo)}
                      className={`px-2 py-1.5 border rounded-lg text-xs ${funnelFrom || funnelTo ? 'text-slate-400 bg-slate-100 cursor-not-allowed' : 'text-slate-700'}`}
                    >
                      <option value={7}>7 dias</option>
                      <option value={30}>30 dias</option>
                      <option value={90}>90 dias</option>
                    </select>
                    <select
                      value={funnelEmpresa}
                      onChange={(e) => setFunnelEmpresa(e.target.value)}
                      className="px-2 py-1.5 border rounded-lg text-xs text-slate-700"
                    >
                      <option value="">Todas las empresas</option>
                      {historialEmpresas.map(emp => (
                        <option key={emp} value={emp}>{emp}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => loadFunnel()}
                      className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-800"
                    >
                      Refrescar
                    </button>
                  </div>
                </div>
                {funnelError && <div className="mt-2 text-sm text-rose-600">{funnelError}</div>}
                {funnelLoading ? (
                  <div className="mt-4 text-sm text-gray-500">Cargando funnel...</div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    {funnelStages.map(stage => (
                      <div key={stage.key} className="rounded-xl border border-white/70 bg-white/70 p-3">
                        <div className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold ${stage.tone}`}>
                          {stage.label}
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">{stage.count}</div>
                        <div className="text-xs text-slate-500">Cotizaciones</div>
                        <div className="mt-2 text-sm font-semibold text-slate-800">{formatCurrency(stage.amount)}</div>
                        <div className="text-[11px] text-slate-400">Monto total</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-gray-800">{isAdmin ? 'Historial de cotizaciones' : 'Mis cotizaciones'}</h2>
                  {selectedHistorialIds.size > 0 && (
                    <button
                      onClick={deleteSelectedCotizaciones}
                      disabled={saving}
                      className="px-2 py-1 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
                    >
                      Eliminar seleccionados ({selectedHistorialIds.size})
                    </button>
                  )}
                </div>
                <span className="text-xs text-gray-500">{filteredHistorial.length} resultados</span>
              </div>
              {isAdmin && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                    Cotizaciones de clientes: <b>{historialCounts.clienteQuotes}</b>
                  </span>
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-amber-50 text-amber-700">
                    Con registro de proyecto: <b>{historialCounts.registroQuotes}</b>
                  </span>
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
                <input
                  type="date"
                  value={historialFilters.fecha}
                  onChange={e => setHistorialFilters(f => ({ ...f, fecha: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Buscar cliente..."
                  value={historialFilters.cliente}
                  onChange={e => setHistorialFilters(f => ({ ...f, cliente: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Buscar PID..."
                  value={historialFilters.pid}
                  onChange={e => setHistorialFilters(f => ({ ...f, pid: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Buscar proyecto..."
                  value={historialFilters.proyecto}
                  onChange={e => setHistorialFilters(f => ({ ...f, proyecto: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={historialFilters.producto}
                  onChange={e => setHistorialFilters(f => ({ ...f, producto: e.target.value }))}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <button
                  onClick={() => setHistorialFilters({ fecha: '', cliente: '', pid: '', proyecto: '', producto: '', estados: [] })}
                  className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm"
                >
                  Limpiar filtros
                </button>
              </div>
              {isAdmin && (
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
                  {COTIZACION_ESTADOS.map(option => (
                    <label key={option.value} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(historialFilters.estados || []).includes(option.value)}
                        onChange={() => toggleEstadoFilter(option.value)}
                      />
                      <span className="font-semibold">{option.short}</span>
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 overflow-hidden">
              {historialLoading ? (
                <div className="p-6 text-center text-gray-500">Cargando...</div>
              ) : historialError ? (
                <div className="p-6 text-center text-red-600">{historialError}</div>
              ) : filteredHistorial.length === 0 ? (
                <div className="p-6 text-center text-gray-500">No hay cotizaciones guardadas.</div>
              ) : (
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={filteredHistorial.length > 0 && filteredHistorial.every(cot => selectedHistorialIds.has(cot.id))}
                            onChange={toggleSelectAllHistorialFiltered}
                          />
                        </th>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-left">Proyecto</th>
                        <th className="px-3 py-2 text-left">Empresa</th>
                        <th className="px-3 py-2 text-left">PID</th>
                        <th className="px-3 py-2 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredHistorial.map(cot => {
                        const highlightCliente = isAdmin && isClienteQuote(cot);
                        const showRegistroAlert = isAdmin && isClienteQuote(cot) && hasProjectRegistro(cot) && !dismissedRegistroById[cot.id];
                        const highlightRegistro = highlightCliente && showRegistroAlert;
                        const isGanada = normalizeEstado(cot.estado) === 'aprobada';
                        const isExpanded = expandedHistorialId === cot.id;
                        return (
                        <>
                          <tr
                            key={cot.id}
                            onClick={() => {
                              setExpandedHistorialId(prev => (prev === cot.id ? null : cot.id));
                              if (showRegistroAlert) setProjectRegistroModal(cot);
                            }}
                            className={`cursor-pointer ${
                              highlightRegistro
                                ? 'bg-amber-50/70 border-l-4 border-amber-300'
                                : isGanada
                                  ? 'bg-green-50/70 border-l-4 border-green-300'
                                  : highlightCliente
                                    ? 'bg-blue-50/60'
                                    : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedHistorialIds.has(cot.id)}
                                onChange={() => toggleSelectHistorial(cot.id)}
                              />
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600">{getDateKey(cot.created_at) || 'N/A'}</td>
                            <td className="px-3 py-2">{cot.cliente_telefono || 'N/A'}</td>
                            <td className="px-3 py-2">{cot.cliente_empresa || 'N/A'}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span>{cot.cliente_email || 'N/A'}</span>
                                {showRegistroAlert && (
                                  <span
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold"
                                    title="Registro de proyecto"
                                  >
                                    !
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{formatCurrency(cot.total || 0)}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-white">
                              <td colSpan={6} className="px-4 py-3 border-t">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <div className="text-xs text-gray-500">Proyecto</div>
                                    <div className="font-semibold text-gray-800">{cot.cliente_telefono || 'N/A'}</div>
                                  </div>
                                  {isAdmin && (
                                    <div>
                                      <div className="text-xs text-gray-500">Estado</div>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {COTIZACION_ESTADOS.map(option => {
                                          const isActive = normalizeEstado(cot.estado) === option.value;
                                          const isRechazada = option.value === 'rechazada';
                                          const isAceptada = option.value === 'aprobada';
                                          const baseClass = isActive
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200';
                                          const toneClass = isRechazada
                                            ? 'text-red-700 font-semibold'
                                            : isAceptada
                                              ? 'text-green-700 font-semibold'
                                              : '';
                                          return (
                                            <button
                                              key={option.value}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                updateCotizacionEstado(cot.id, option.value);
                                              }}
                                              className={`px-2 py-0.5 text-[11px] rounded ${baseClass} ${toneClass}`}
                                              title={option.label}
                                            >
                                              {option.short}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {isAdmin && (
                                    <div className="md:col-span-2">
                                      <div className="flex items-center justify-between">
                                        <div className="text-xs text-gray-500">Edición</div>
                                        {editingCotizacionId === cot.id ? (
                                          <div className="flex gap-2">
                                            <button
                                              onClick={(e) => { e.stopPropagation(); saveEditedCotizacion(cot.id); }}
                                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                            >
                                              Guardar cambios
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); cancelEditCotizacion(); }}
                                              className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                                            >
                                              Cancelar
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); startEditCotizacion(cot); }}
                                            className="px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                                          >
                                            Editar cotización
                                          </button>
                                        )}
                                      </div>
                                      {editingCotizacionId === cot.id && editingCotizacionForm && (
                                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                          <input
                                            value={editingCotizacionForm.cliente_nombre}
                                            onChange={e => setEditingCotizacionForm(f => ({ ...f, cliente_nombre: e.target.value }))}
                                            placeholder="Nombre"
                                            className="px-2 py-1 border rounded"
                                          />
                                          <input
                                            value={editingCotizacionForm.cliente_empresa}
                                            onChange={e => setEditingCotizacionForm(f => ({ ...f, cliente_empresa: e.target.value }))}
                                            placeholder="Empresa"
                                            className="px-2 py-1 border rounded"
                                          />
                                          <input
                                            value={editingCotizacionForm.cliente_email}
                                            onChange={e => setEditingCotizacionForm(f => ({ ...f, cliente_email: e.target.value }))}
                                            placeholder="PID"
                                            className="px-2 py-1 border rounded"
                                          />
                                          <input
                                            value={editingCotizacionForm.cliente_telefono}
                                            onChange={e => setEditingCotizacionForm(f => ({ ...f, cliente_telefono: e.target.value }))}
                                            placeholder="Proyecto"
                                            className="px-2 py-1 border rounded"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <div>
                                    <div className="text-xs text-gray-500">PDF</div>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); exportHistorialPdf(cot); }}
                                        className="px-2 py-1 text-xs bg-slate-700 text-white rounded hover:bg-slate-800"
                                      >
                                        PDF
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); exportHistorialExcel(cot); }}
                                        className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                                      >
                                        Excel
                                      </button>
                                      {isAdmin && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); exportHistorialAxis(cot); }}
                                          className="px-2 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600"
                                        >
                                          Exportar a Axis
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {isAdmin && (
                                    <div>
                                      <div className="text-xs text-gray-500">Compras</div>
                                      {normalizeEstado(cot.estado) === 'aprobada' ? (
                                        <div className="mt-1 flex items-center gap-2">
                                          <input
                                            type="text"
                                            value={boByCotizacionId[cot.id] || ''}
                                            onChange={e => setBoByCotizacionId(prev => ({ ...prev, [cot.id]: e.target.value }))}
                                            placeholder="BO"
                                            className="w-24 px-2 py-1 border rounded text-xs"
                                          />
                                          <button
                                            onClick={(e) => { e.stopPropagation(); enviarACompras(cot); }}
                                            className="inline-flex px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                                          >
                                            Enviar a compras
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="mt-1 text-xs text-gray-400">No disponible</div>
                                      )}
                                    </div>
                                  )}
                                  <div className="md:col-span-2">
                                    <div className="text-xs text-gray-500 mb-1">Productos</div>
                                    {editingCotizacionId === cot.id && editingCotizacionForm ? (
                                      <div className="space-y-2 text-xs text-gray-600">
                                        {editingCotizacionForm.items.map((item, idx) => (
                                          <div key={`${cot.id}-edit-${item.id || idx}`} className="grid grid-cols-1 md:grid-cols-6 gap-2">
                                            <input
                                              value={item.descripcion}
                                              onChange={e => updateEditingItem(idx, 'descripcion', e.target.value)}
                                              placeholder="Descripción"
                                              className="px-2 py-1 border rounded md:col-span-2"
                                            />
                                            <input
                                              value={item.sku}
                                              onChange={e => updateEditingItem(idx, 'sku', e.target.value)}
                                              placeholder="SKU"
                                              className="px-2 py-1 border rounded"
                                            />
                                            <input
                                              value={item.mpn}
                                              onChange={e => updateEditingItem(idx, 'mpn', e.target.value)}
                                              placeholder="MPN"
                                              className="px-2 py-1 border rounded"
                                            />
                                            <input
                                              type="number"
                                              value={item.cantidad}
                                              onChange={e => updateEditingItem(idx, 'cantidad', e.target.value)}
                                              placeholder="Cant."
                                              className="px-2 py-1 border rounded"
                                            />
                                            <input
                                              type="number"
                                              value={item.precio_unitario}
                                              onChange={e => updateEditingItem(idx, 'precio_unitario', e.target.value)}
                                              placeholder="P. Unit."
                                              className="px-2 py-1 border rounded"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    ) : Array.isArray(cot.items) && cot.items.length > 0 ? (
                                      <div className="space-y-1 text-xs text-gray-600">
                                        {cot.items.map(item => (
                                          <div key={`${cot.id}-${item.id}`} className="truncate">
                                            {(item.sku || item.mpn || 'SKU')} - {item.descripcion || 'Sin descripción'}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-400">Sin productos</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === 'ordenes' && isAdmin && (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-[220px]">
                  <h2 className="text-lg font-semibold text-gray-800">Ordenes Activas (OSO)</h2>
                  <p className="text-xs text-slate-500">Filtra por BO o cliente para encontrar rápido.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <input
                    value={osoFilter}
                    onChange={(e) => setOsoFilter(e.target.value)}
                    placeholder="Buscar BO o cliente"
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 w-full md:w-52 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <select
                    value={osoStatusFilter}
                    onChange={(e) => setOsoStatusFilter(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 w-full md:w-40 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="all">Todos</option>
                    <option value="activa">Activas</option>
                    <option value="parcial">Parciales</option>
                    <option value="completa">Completas</option>
                  </select>
                  <select
                    value={osoSort}
                    onChange={(e) => setOsoSort(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 w-full md:w-44 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="bo">Ordenar por BO</option>
                    <option value="empresa">Ordenar por empresa</option>
                    <option value="porcentaje">Ordenar por %</option>
                  </select>
                  <div className="relative w-full md:w-52">
                    <button
                      onClick={() => setShowCompanyDropdown(prev => !prev)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white text-left focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {osoCompanyFilter ? `Empresa: ${osoCompanyFilter}` : 'Empresa: Todas'}
                    </button>
                    {showCompanyDropdown && (
                      <div className="absolute z-20 mt-2 w-full max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                        <button
                          onClick={() => {
                            setOsoCompanyFilter('');
                            setShowCompanyDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          Todas las empresas
                        </button>
                        {osoCompanies.map(item => (
                          <button
                            key={item.name}
                            onClick={() => {
                              setOsoCompanyFilter(item.name);
                              setShowCompanyDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            {item.name} <span className="text-slate-400">({item.count})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <select
                    value={osoActionSelect}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      if (value === 'refresh') loadOsoOrders();
                      if (value === 'export') exportOsoReport();
                      if (value === 'copy') copyOsoExecutiveSummary();
                      setOsoActionSelect('');
                    }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 w-full md:w-44 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="">Acciones...</option>
                    <option value="refresh">Refrescar</option>
                    <option value="export">Exportar reporte</option>
                    <option value="copy">Copiar resumen</option>
                  </select>
                  <select
                    value={osoReportSelect}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      setOsoReportMode(value);
                      setShowOsoReportModal(true);
                      setOsoReportSelect('');
                    }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 w-full md:w-52 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="">Informes...</option>
                    <option value="empresa">Informe por empresa</option>
                    <option value="proximas">Próximas entregas</option>
                  </select>
                  </div>
                </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                  Total: {osoStats.total} · Activas: {osoStats.activa} · Parciales: {osoStats.parcial} · Completas: {osoStats.completa} · Facturadas: {invoicedBos.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  onClick={() => setShowOsoFilters(prev => !prev)}
                  className="px-2 py-1 rounded-full border text-xs bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                >
                  {showOsoFilters ? 'Ocultar filtros' : 'Más filtros'}
                </button>
                {showOsoFilters && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">Filtros rápidos:</span>
                    {[
                      { key: 'all', label: 'Todos' },
                      { key: 'sd-pending', label: 'S&D pendiente' },
                      { key: 'missing-project', label: 'Proyecto vacío' },
                      { key: 'missing-po', label: 'PO Axis vacío' }
                    ].map(item => (
                      <button
                        key={item.key}
                        onClick={() => setOsoQuickFilter(item.key)}
                        className={`px-2 py-1 rounded-full border text-xs ${osoQuickFilter === item.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                    <label className="flex items-center gap-2 ml-2">
                      <span className="text-slate-500">Facturación mes</span>
                      <input
                        type="month"
                        value={osoInvoiceMonth}
                        onChange={(e) => setOsoInvoiceMonth(e.target.value)}
                        className="px-2 py-1 border border-slate-200 rounded-lg text-xs text-slate-700"
                      />
                    </label>
                  </div>
                )}
              </div>
              {osoError && <div className="mt-2 text-sm text-rose-600">{osoError}</div>}
              {osoLoading ? (
                <div className="mt-4 text-sm text-gray-500">Cargando ordenes...</div>
              ) : filteredOsoOrders.length === 0 ? (
                <div className="mt-4 text-sm text-gray-500">Sin ordenes activas.</div>
              ) : (
                <div className="mt-4 space-y-4">
                  {safePinnedBos.length > 0 && (
                    <div className="border border-amber-200 rounded-2xl bg-amber-50/40 p-3">
                      <div className="text-xs font-semibold text-amber-700 mb-2">BOs fijados</div>
                      <div className="space-y-3">
                        {filteredOsoOrders
                          .filter(order => safePinnedBos.includes(order.bo))
                          .map(order => renderOrderCard(order, { pinned: true, mode: 'ordenes' }))}
                      </div>
                    </div>
                  )}
                  {filteredOsoOrders
                    .filter(order => !safePinnedBos.includes(order.bo))
                    .map(order => renderOrderCard(order, { mode: 'ordenes' }))}
                </div>
              )}
            </div>

            {invoicedBos.length > 0 && (
              <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-gray-800">
                      Ordenes facturadas <span className="text-xs text-slate-500">({invoicedBos.length})</span>
                    </h3>
                    <p className="text-xs text-slate-500">BOs que ya no están en OSO y marcaste como facturados.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      value={invoicedFilter}
                      onChange={(e) => setInvoicedFilter(e.target.value)}
                      placeholder="Buscar BO o cliente"
                      className="px-2 py-1 border border-slate-200 rounded-lg text-xs text-slate-700 w-40"
                    />
                    <label className="text-slate-500">Ordenar por:</label>
                    <select
                      value={invoicedSort}
                      onChange={(e) => setInvoicedSort(e.target.value)}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-xs text-slate-700"
                    >
                      <option value="date">Fecha (reciente)</option>
                      <option value="lastSeen">Última vez en OSO</option>
                      <option value="cliente">Cliente (A-Z)</option>
                      <option value="bo">BO</option>
                    </select>
                    <button
                      onClick={() => setShowInvoicedSection(prev => !prev)}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      {showInvoicedSection ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                </div>
                {showInvoicedSection && (
                  <div className="mt-3 space-y-2">
                    {sortedInvoicedBos.map(item => (
                      <div key={item.bo} className="border border-slate-200 rounded-xl bg-white px-3 py-2 flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-0 text-xs text-slate-600">
                          <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">BO {item.bo}</span>
                          <span className="ml-2 text-slate-700">{item.customerName || 'Cliente N/A'}</span>
                          <span className="ml-2 text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">% {item.allocPct ?? 0}</span>
                          <span className="ml-2 text-[11px] text-slate-500">Proyecto: {item.projectName || 'N/A'}</span>
                          <span className="ml-2 text-[11px] text-slate-500">PO Axis: {item.poAxis || 'N/A'}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 whitespace-nowrap">
                          Facturado: {item.invoicedAt ? new Date(item.invoicedAt).toLocaleDateString() : 'N/A'}
                        </div>
                        <button
                          onClick={() => unmarkBoInvoiced(item.bo)}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          Reactivar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {currentView === 'compras' && isAdmin && (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-[220px]">
                  <h2 className="text-lg font-semibold text-gray-800">Vista Compras (OSO)</h2>
                  <p className="text-xs text-slate-500">Filtra por BO o cliente para encontrar rápido.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <input
                    value={osoFilter}
                    onChange={(e) => setOsoFilter(e.target.value)}
                    placeholder="Buscar BO o cliente"
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 w-full md:w-52 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <select
                    value={osoStatusFilter}
                    onChange={(e) => setOsoStatusFilter(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 w-full md:w-40 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="all">Todos</option>
                    <option value="activa">Activas</option>
                    <option value="parcial">Parciales</option>
                    <option value="completa">Completas</option>
                  </select>
                  <select
                    value={osoSort}
                    onChange={(e) => setOsoSort(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 w-full md:w-44 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="bo">Ordenar por BO</option>
                    <option value="empresa">Ordenar por empresa</option>
                    <option value="porcentaje">Ordenar por %</option>
                  </select>
                  <div className="relative w-full md:w-52">
                    <button
                      onClick={() => setShowCompanyDropdown(prev => !prev)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white text-left focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {osoCompanyFilter ? `Empresa: ${osoCompanyFilter}` : 'Empresa: Todas'}
                    </button>
                    {showCompanyDropdown && (
                      <div className="absolute z-20 mt-2 w-full max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                        <button
                          onClick={() => {
                            setOsoCompanyFilter('');
                            setShowCompanyDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          Todas las empresas
                        </button>
                        {osoCompanies.map(item => (
                          <button
                            key={item.name}
                            onClick={() => {
                              setOsoCompanyFilter(item.name);
                              setShowCompanyDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            {item.name} <span className="text-slate-400">({item.count})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <select
                    value={osoActionSelect}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      if (value === 'refresh') loadOsoOrders();
                      if (value === 'export') exportOsoReport();
                      if (value === 'copy') copyOsoExecutiveSummary();
                      setOsoActionSelect('');
                    }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 w-full md:w-44 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="">Acciones...</option>
                    <option value="refresh">Refrescar</option>
                    <option value="export">Exportar reporte</option>
                    <option value="copy">Copiar resumen</option>
                  </select>
                  <select
                    value={osoReportSelect}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      setOsoReportMode(value);
                      setShowOsoReportModal(true);
                      setOsoReportSelect('');
                    }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 w-full md:w-52 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="">Informes...</option>
                    <option value="empresa">Informe por empresa</option>
                    <option value="proximas">Próximas entregas</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                  Total: {osoStats.total} · Activas: {osoStats.activa} · Parciales: {osoStats.parcial} · Completas: {osoStats.completa}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  onClick={() => setShowOsoFilters(prev => !prev)}
                  className="px-2 py-1 rounded-full border text-xs bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                >
                  {showOsoFilters ? 'Ocultar filtros' : 'Más filtros'}
                </button>
                {showOsoFilters && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">Filtros rápidos:</span>
                    {[
                      { key: 'all', label: 'Todos' },
                      { key: 'sd-pending', label: 'S&D pendiente' },
                      { key: 'missing-project', label: 'Proyecto vacío' },
                      { key: 'missing-po', label: 'PO Axis vacío' }
                    ].map(item => (
                      <button
                        key={item.key}
                        onClick={() => setOsoQuickFilter(item.key)}
                        className={`px-2 py-1 rounded-full border text-xs ${osoQuickFilter === item.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                    <label className="flex items-center gap-2 ml-2">
                      <span className="text-slate-500">Facturación mes</span>
                      <input
                        type="month"
                        value={osoInvoiceMonth}
                        onChange={(e) => setOsoInvoiceMonth(e.target.value)}
                        className="px-2 py-1 border border-slate-200 rounded-lg text-xs text-slate-700"
                      />
                    </label>
                  </div>
                )}
              </div>
              {osoError && <div className="mt-2 text-sm text-rose-600">{osoError}</div>}
              {osoLoading ? (
                <div className="mt-4 text-sm text-gray-500">Cargando ordenes...</div>
              ) : filteredOsoOrders.length === 0 ? (
                <div className="mt-4 text-sm text-gray-500">Sin ordenes activas.</div>
              ) : (
                <div className="mt-4 space-y-4">
                  {safePinnedBos.length > 0 && (
                    <div className="border border-amber-200 rounded-2xl bg-amber-50/40 p-3">
                      <div className="text-xs font-semibold text-amber-700 mb-2">BOs fijados</div>
                      <div className="space-y-3">
                        {filteredOsoOrders
                          .filter(order => safePinnedBos.includes(order.bo))
                          .map(order => renderOrderCard(order, { pinned: true, mode: 'compras' }))}
                      </div>
                    </div>
                  )}
                  {filteredOsoOrders
                    .filter(order => !safePinnedBos.includes(order.bo))
                    .map(order => renderOrderCard(order, { mode: 'compras' }))}
                </div>
              )}
            </div>
          </div>
        )}

        {showMissingBosModal && missingBos.length > 0 && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="font-semibold">BO no encontrados en OSO</h3>
                <button
                  onClick={() => setShowMissingBosModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-sm text-gray-600">
                  Estos BO ya no están en OSO. ¿Marcar como facturados?
                </div>
                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {missingBos.map(bo => (
                    <div key={bo} className="flex items-center justify-between gap-2 border rounded-lg p-2">
                      <div className="text-sm font-semibold text-slate-800">BO {bo}</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => markBoInvoiced(bo)}
                          className="px-2 py-1 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          Marcar facturado
                        </button>
                        <button
                          onClick={() => openDeleteBoModal(bo)}
                          className="px-2 py-1 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                        >
                          Eliminar
                        </button>
                        <button
                          onClick={() => dismissMissingBo(bo)}
                          className="px-2 py-1 text-xs rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                        >
                          Omitir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      missingBos.forEach(bo => markBoInvoiced(bo));
                      setShowMissingBosModal(false);
                    }}
                    className="px-3 py-2 text-xs rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                  >
                    Marcar todos
                  </button>
                  <button
                    onClick={() => setShowMissingBosModal(false)}
                    className="px-3 py-2 text-xs rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {deleteBoTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-md overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="font-semibold">Eliminar BO {deleteBoTarget}</h3>
                <button
                  onClick={closeDeleteBoModal}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-gray-600">
                  Indica el motivo de eliminación. Este comentario quedará en los registros.
                </p>
                <textarea
                  className="w-full rounded-lg border border-slate-200 p-2 text-sm"
                  rows={4}
                  value={deleteBoComment}
                  onChange={(e) => {
                    setDeleteBoComment(e.target.value);
                    if (deleteBoError) setDeleteBoError('');
                  }}
                  placeholder="Comentario obligatorio"
                />
                {deleteBoError && (
                  <div className="text-sm text-rose-600">{deleteBoError}</div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={closeDeleteBoModal}
                    className="px-3 py-2 text-xs rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                    disabled={deleteBoLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmDeleteBo}
                    className="px-3 py-2 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                    disabled={deleteBoLoading}
                  >
                    {deleteBoLoading ? 'Eliminando...' : 'Eliminar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showOsoReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
            <div className="bg-white rounded-2xl shadow-lg w-[96vw] h-[90vh] overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Informe de órdenes activas</h3>
                  <p className="text-xs text-slate-500">ETA estimado por línea = Entrega OOR + 15 días.</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setOsoReportMode('empresa')}
                    className={`px-2 py-1 rounded-lg border ${osoReportMode === 'empresa' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}
                  >
                    Por empresa
                  </button>
                  <button
                    onClick={() => setOsoReportMode('proximas')}
                    className={`px-2 py-1 rounded-lg border ${osoReportMode === 'proximas' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}
                  >
                    Próximas entregas
                  </button>
                  <button
                    onClick={exportOsoReportPdf}
                    className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    Exportar PDF
                  </button>
                  <button
                    onClick={exportOsoReportExcel}
                    className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    Exportar Excel
                  </button>
                  <button
                    onClick={() => setOsoReportEdits({})}
                    className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    Limpiar cambios
                  </button>
                  <button
                    onClick={() => setShowOsoReportModal(false)}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <div className="p-4 overflow-auto flex-1">
                {osoLineReportRows.length === 0 ? (
                  <div className="text-sm text-slate-500">No hay líneas con los filtros actuales.</div>
                ) : (
                  <div className="space-y-6">
                    {osoReportMode === 'empresa' ? (
                      (() => {
                        const groups = new Map();
                        osoLineReportRows.forEach(row => {
                          const empresa = (getOsoReportValue(row, 'cliente') || 'Sin empresa').toString().trim() || 'Sin empresa';
                          if (!groups.has(empresa)) groups.set(empresa, []);
                          groups.get(empresa).push(row);
                        });
                        const ordered = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                        return ordered.map(([empresa, rows]) => (
                          <div key={empresa} className="border border-slate-200 rounded-2xl overflow-hidden">
                            <div className="px-3 py-2 bg-slate-50 text-sm font-semibold text-slate-700">{empresa}</div>
                            <div className="overflow-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-2 py-2 text-left">BO</th>
                                    <th className="px-2 py-2 text-left">PO Cliente</th>
                                    <th className="px-2 py-2 text-left">Cliente</th>
                                    <th className="px-2 py-2 text-left">MPN</th>
                                    <th className="px-2 py-2 text-left">SKU</th>
                                    <th className="px-2 py-2 text-left">Producto</th>
                                    <th className="px-2 py-2 text-left">ETA Est.</th>
                                    <th className="px-2 py-2 text-right">Cant. Orden</th>
                                    <th className="px-2 py-2 text-right">Cant. Alocada</th>
                                    <th className="px-2 py-2 text-right">Cant. Despachada</th>
                                    <th className="px-2 py-2 text-left">Notas</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {rows.map(row => (
                                    <tr key={row.key}>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'bo')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { bo: e.target.value })}
                                          className="w-24 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'customerPo')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { customerPo: e.target.value })}
                                          className="w-28 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'cliente')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { cliente: e.target.value })}
                                          className="w-48 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                      <td className="px-2 py-2">{row.mpn || 'N/A'}</td>
                                      <td className="px-2 py-2">{row.sku || 'N/A'}</td>
                                      <td className="px-2 py-2">{row.desc || 'N/A'}</td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'etaEstimado')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { etaEstimado: e.target.value })}
                                          className="w-28 px-2 py-1 border border-slate-200 rounded text-xs"
                                          placeholder="YYYY-MM-DD"
                                        />
                                      </td>
                                      <td className="px-2 py-2 text-right">{row.orderQty}</td>
                                      <td className="px-2 py-2 text-right">{row.allocQty}</td>
                                      <td className="px-2 py-2 text-right">{row.shippedQty}</td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'notas')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { notas: e.target.value })}
                                          className="w-40 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ));
                      })()
                    ) : (
                      (() => {
                        const toTs = (value) => {
                          if (!value) return Number.POSITIVE_INFINITY;
                          const d = new Date(value);
                          return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
                        };
                        const rows = osoLineReportRows
                          .map(row => ({
                            ...row,
                            etaEstimado: getOsoReportValue(row, 'etaEstimado'),
                            cliente: getOsoReportValue(row, 'cliente')
                          }))
                          .filter(row => row.etaEstimado)
                          .sort((a, b) => toTs(a.etaEstimado) - toTs(b.etaEstimado));
                        return (
                          <div className="border border-slate-200 rounded-2xl overflow-hidden">
                            <div className="px-3 py-2 bg-slate-50 text-sm font-semibold text-slate-700">
                              Próximas entregas ({rows.length})
                            </div>
                            <div className="overflow-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-2 py-2 text-left">BO</th>
                                    <th className="px-2 py-2 text-left">PO Cliente</th>
                                    <th className="px-2 py-2 text-left">Cliente</th>
                                    <th className="px-2 py-2 text-left">MPN</th>
                                    <th className="px-2 py-2 text-left">SKU</th>
                                    <th className="px-2 py-2 text-left">Producto</th>
                                    <th className="px-2 py-2 text-left">ETA Est.</th>
                                    <th className="px-2 py-2 text-right">Cant. Orden</th>
                                    <th className="px-2 py-2 text-right">Cant. Alocada</th>
                                    <th className="px-2 py-2 text-right">Cant. Despachada</th>
                                    <th className="px-2 py-2 text-left">Notas</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {rows.map(row => (
                                    <tr key={row.key}>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'bo')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { bo: e.target.value })}
                                          className="w-24 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'customerPo')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { customerPo: e.target.value })}
                                          className="w-28 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'cliente')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { cliente: e.target.value })}
                                          className="w-48 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                      <td className="px-2 py-2">{row.mpn || 'N/A'}</td>
                                      <td className="px-2 py-2">{row.sku || 'N/A'}</td>
                                      <td className="px-2 py-2">{row.desc || 'N/A'}</td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'etaEstimado')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { etaEstimado: e.target.value })}
                                          className="w-28 px-2 py-1 border border-slate-200 rounded text-xs"
                                          placeholder="YYYY-MM-DD"
                                        />
                                      </td>
                                      <td className="px-2 py-2 text-right">{row.orderQty}</td>
                                      <td className="px-2 py-2 text-right">{row.allocQty}</td>
                                      <td className="px-2 py-2 text-right">{row.shippedQty}</td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'notas')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { notas: e.target.value })}
                                          className="w-40 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="fixed left-[-9999px] top-0 w-[900px]">
          <div id="oso-report-pdf" className="bg-white p-6 text-xs text-slate-800">
            <div className="flex items-center justify-between border-b pb-3 mb-3">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Logo" data-pdf-logo="1" className="h-10 w-auto object-contain" />
                <img src="/2-removebg-preview.png" alt="Logo Intcomex" data-pdf-logo="1" className="h-10 w-auto object-contain" />
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">Informe de órdenes activas</div>
                <div className="text-[11px] text-slate-500">Generado: {new Date().toLocaleDateString()}</div>
                <div className="text-[11px] text-slate-500">Modo: {osoReportMode === 'proximas' ? 'Próximas entregas' : 'Por empresa'}</div>
              </div>
            </div>
            {osoReportMode === 'empresa' ? (
              (() => {
                const groups = new Map();
                osoLineReportRows.forEach(row => {
                  const empresa = (getOsoReportValue(row, 'cliente') || 'Sin empresa').toString().trim() || 'Sin empresa';
                  if (!groups.has(empresa)) groups.set(empresa, []);
                  groups.get(empresa).push(row);
                });
                const ordered = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                return ordered.map(([empresa, rows]) => (
                  <div key={`pdf-${empresa}`} className="mb-4">
                    <div className="font-semibold text-slate-700 mb-2">{empresa}</div>
                    <table className="w-full text-[10px] border border-slate-200">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-2 py-1 text-left">BO</th>
                          <th className="px-2 py-1 text-left">PO Cliente</th>
                          <th className="px-2 py-1 text-left">Cliente</th>
                          <th className="px-2 py-1 text-left">MPN</th>
                          <th className="px-2 py-1 text-left">SKU</th>
                          <th className="px-2 py-1 text-left">Producto</th>
                          <th className="px-2 py-1 text-left">ETA Est.</th>
                          <th className="px-2 py-1 text-right">Cant. Orden</th>
                          <th className="px-2 py-1 text-right">Cant. Alocada</th>
                          <th className="px-2 py-1 text-right">Cant. Despachada</th>
                          <th className="px-2 py-1 text-left">Notas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map(row => (
                          <tr key={`pdf-${row.key}`}>
                            <td className="px-2 py-1">{getOsoReportValue(row, 'bo')}</td>
                            <td className="px-2 py-1">{getOsoReportValue(row, 'customerPo')}</td>
                            <td className="px-2 py-1">{getOsoReportValue(row, 'cliente')}</td>
                            <td className="px-2 py-1">{row.mpn || 'N/A'}</td>
                            <td className="px-2 py-1">{row.sku || 'N/A'}</td>
                            <td className="px-2 py-1">{row.desc || 'N/A'}</td>
                            <td className="px-2 py-1">{getOsoReportValue(row, 'etaEstimado')}</td>
                            <td className="px-2 py-1 text-right">{row.orderQty}</td>
                            <td className="px-2 py-1 text-right">{row.allocQty}</td>
                            <td className="px-2 py-1 text-right">{row.shippedQty}</td>
                            <td className="px-2 py-1">{getOsoReportValue(row, 'notas')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ));
              })()
            ) : (
              (() => {
                const toTs = (value) => {
                  if (!value) return Number.POSITIVE_INFINITY;
                  const d = new Date(value);
                  return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
                };
                const rows = osoLineReportRows
                  .map(row => ({
                    ...row,
                    etaEstimado: getOsoReportValue(row, 'etaEstimado'),
                    cliente: getOsoReportValue(row, 'cliente'),
                    bo: getOsoReportValue(row, 'bo'),
                    customerPo: getOsoReportValue(row, 'customerPo'),
                    notas: getOsoReportValue(row, 'notas')
                  }))
                  .filter(row => row.etaEstimado)
                  .sort((a, b) => toTs(a.etaEstimado) - toTs(b.etaEstimado));
                return (
                  <table className="w-full text-[10px] border border-slate-200">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2 py-1 text-left">BO</th>
                        <th className="px-2 py-1 text-left">PO Cliente</th>
                        <th className="px-2 py-1 text-left">Cliente</th>
                        <th className="px-2 py-1 text-left">MPN</th>
                        <th className="px-2 py-1 text-left">SKU</th>
                        <th className="px-2 py-1 text-left">Producto</th>
                        <th className="px-2 py-1 text-left">ETA Est.</th>
                        <th className="px-2 py-1 text-right">Cant. Orden</th>
                        <th className="px-2 py-1 text-right">Cant. Alocada</th>
                        <th className="px-2 py-1 text-right">Cant. Despachada</th>
                        <th className="px-2 py-1 text-left">Notas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map(row => (
                        <tr key={`pdf-${row.key}`}>
                          <td className="px-2 py-1">{row.bo}</td>
                          <td className="px-2 py-1">{row.customerPo}</td>
                          <td className="px-2 py-1">{row.cliente}</td>
                          <td className="px-2 py-1">{row.mpn || 'N/A'}</td>
                          <td className="px-2 py-1">{row.sku || 'N/A'}</td>
                          <td className="px-2 py-1">{row.desc || 'N/A'}</td>
                          <td className="px-2 py-1">{row.etaEstimado}</td>
                          <td className="px-2 py-1 text-right">{row.orderQty}</td>
                          <td className="px-2 py-1 text-right">{row.allocQty}</td>
                          <td className="px-2 py-1 text-right">{row.shippedQty}</td>
                          <td className="px-2 py-1">{row.notas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()
            )}
          </div>
        </div>

        {currentView === 'cotizador' && (
          <>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <h2 className="text-2xl font-display text-slate-900">Cotización</h2>
                <p className="text-sm text-slate-500">
                  {(cliente.empresa?.trim() || cliente.nombre?.trim())
                    ? `${cliente.empresa?.trim() || 'Empresa'} • ${cliente.nombre?.trim() || 'Cliente'}`
                    : 'Completa los datos del cliente para comenzar.'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const input = document.getElementById('catalog-search');
                    if (input) input.focus();
                  }}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm hover:bg-slate-800"
                >
                  Agregar productos
                </button>
                {isAdmin && (
                  <>
                    <label
                      htmlFor="project-upload"
                      className="px-3 py-2 text-sm border rounded-xl bg-white text-slate-700 hover:bg-white/80 cursor-pointer"
                    >
                      Cargar proyecto
                    </label>
                    <input
                      id="project-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleProjectUpload}
                      className="hidden"
                    />
                  </>
                )}
              </div>
            </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 space-y-4">
            <div className="glass-card rounded-2xl shadow-[0_18px_36px_-28px_rgba(15,23,42,0.35)] border border-white/70 overflow-hidden">
              <div className={`${isClient ? 'p-4' : 'p-3'} border-b bg-gray-50`}>
                <h3 className="font-semibold">Datos del Cliente</h3>
              </div>
              <div className={isClient ? 'p-4' : 'p-2'}>
                <div className={`grid grid-cols-1 md:grid-cols-2 ${isClient ? 'gap-3' : 'gap-2'}`}>
                  {(() => {
                    const canEditClienteBase = isAdmin || showProjectRegistro;
                    return (
                      <>
                  <label className={fieldLabelClass}>
                    Empresa
                    <input
                      placeholder="Empresa"
                      value={cliente.empresa}
                      onChange={e => setCliente(c => ({ ...c, empresa: e.target.value }))}
                      onBlur={e => { if (!e.target.value.trim()) setCliente(c => ({ ...c, empresa: 'N/A' })); }}
                      disabled={!canEditClienteBase}
                      className={`${fieldInputClass} ${!canEditClienteBase ? 'bg-gray-50 text-gray-500' : ''}`}
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    Nombre
                    <input
                      placeholder="Nombre"
                      value={cliente.nombre}
                      onChange={e => setCliente(c => ({ ...c, nombre: e.target.value }))}
                      onBlur={e => { if (!e.target.value.trim()) setCliente(c => ({ ...c, nombre: 'N/A' })); }}
                      disabled={!canEditClienteBase}
                      className={`${fieldInputClass} ${!canEditClienteBase ? 'bg-gray-50 text-gray-500' : ''}`}
                    />
                  </label>
                  {isAdmin ? (
                    <>
                      <label className={fieldLabelClass}>
                        PID
                        <input
                          placeholder="PID"
                          value={cliente.pid}
                          onChange={e => setCliente(c => ({ ...c, pid: e.target.value }))}
                          onBlur={e => { if (!e.target.value.trim()) setCliente(c => ({ ...c, pid: 'N/A' })); }}
                          className={fieldInputClass}
                        />
                      </label>
                      <label className={fieldLabelClass}>
                        Nombre del proyecto
                        <input
                          placeholder="Nombre del proyecto"
                          value={cliente.proyecto}
                          onChange={e => setCliente(c => ({ ...c, proyecto: e.target.value }))}
                          onBlur={e => { if (!e.target.value.trim()) setCliente(c => ({ ...c, proyecto: 'N/A' })); }}
                          className={fieldInputClass}
                        />
                      </label>
                    </>
                  ) : (
                    <div className="md:col-span-2 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setShowProjectRegistro(v => !v)}
                        className={`${isClient ? 'px-4 py-3 text-sm' : 'px-3 py-2 text-xs'} text-left bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200`}
                      >
                        ¿Registro de proyecto?
                      </button>
                      {showProjectRegistro && (
                        <div className={`grid grid-cols-1 md:grid-cols-2 ${isClient ? 'gap-3' : 'gap-2'}`}>
                          <label className={fieldLabelClass}>
                            Nombre Cliente final
                            <input
                              placeholder="Nombre Cliente final"
                              value={cliente.cliente_final}
                              onChange={e => setCliente(c => ({ ...c, cliente_final: e.target.value }))}
                              onBlur={e => { if (!e.target.value.trim()) setCliente(c => ({ ...c, cliente_final: 'N/A' })); }}
                              className={fieldInputClass}
                            />
                          </label>
                          <label className={fieldLabelClass}>
                            Nombre del proyecto
                            <input
                              placeholder="Nombre del proyecto"
                              value={cliente.proyecto}
                              onChange={e => setCliente(c => ({ ...c, proyecto: e.target.value }))}
                              onBlur={e => { if (!e.target.value.trim()) setCliente(c => ({ ...c, proyecto: 'N/A' })); }}
                              className={fieldInputClass}
                            />
                          </label>
                          <label className={fieldLabelClass}>
                            Fecha de adjudicación
                            <input
                              type="date"
                              value={cliente.fecha_ejecucion}
                              onChange={e => setCliente(c => ({ ...c, fecha_ejecucion: e.target.value }))}
                              className={fieldInputClass}
                            />
                          </label>
                          <label className={fieldLabelClass}>
                            Fecha de implementación
                            <input
                              type="date"
                              value={cliente.fecha_implementacion}
                              onChange={e => setCliente(c => ({ ...c, fecha_implementacion: e.target.value }))}
                              className={fieldInputClass}
                            />
                          </label>
                          <label className={`${fieldLabelClass} md:col-span-2`}>
                            VMS a utilizar
                            <input
                              placeholder="VMS a utilizar"
                              value={cliente.vms}
                              onChange={e => setCliente(c => ({ ...c, vms: e.target.value }))}
                              onBlur={e => { if (!e.target.value.trim()) setCliente(c => ({ ...c, vms: 'N/A' })); }}
                              className={fieldInputClass}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            <div className="glass-card rounded-2xl shadow-[0_18px_36px_-28px_rgba(15,23,42,0.35)] border border-white/70 overflow-hidden">
              <div className={`${isClient ? 'p-4' : 'p-3'} border-b bg-gray-50`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">Cotización</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isAdmin && (
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[11px] text-gray-500">
                          GP QNAP
                          <input
                            type="number"
                            step="0.1"
                            value={formatGpPercent(cotizacionGpGlobalQnap)}
                            onChange={e => updateGlobalMargin('QNAP', e.target.value)}
                            className="w-14 px-2 py-0.5 border rounded text-[11px]"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-[11px] text-gray-500">
                          GP AXIS
                          <input
                            type="number"
                            step="0.1"
                            value={formatGpPercent(cotizacionGpGlobalAxis)}
                            onChange={e => updateGlobalMargin('AXIS', e.target.value)}
                            className="w-14 px-2 py-0.5 border rounded text-[11px]"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-[11px] text-gray-500">
                          Partner
                          <select
                            value={cotizacionPartnerCategory}
                            onChange={e => setCotizacionPartnerCategory(e.target.value)}
                            className="px-2 py-0.5 border rounded text-[11px]"
                          >
                            <option>Partner Autorizado</option>
                            <option>Partner Silver</option>
                            <option>Partner Gold</option>
                            <option>Partner Multiregional</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <button
                      onClick={clearCotizacion}
                      disabled={cotizacion.length === 0}
                      className={`${isClient ? 'text-sm' : 'text-xs'} px-2 py-1 rounded-lg ${
                        cotizacion.length === 0
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                      }`}
                    >
                      Limpiar productos
                    </button>
                  </div>
                </div>
              </div>
              <div className={`${isClient ? 'p-4' : 'p-2'} border-b relative`}>
                <div className={`${isClient ? 'text-sm' : 'text-xs'} text-gray-500 mb-2`}>
                  Busca por SKU, MPN o modelo.
                </div>
                <input
                  type="text"
                  placeholder="Buscar productos..."
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  id="catalog-search" ref={catalogInputRef}
                  className={`${isClient ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs'} w-full border rounded`}
                />
                {catalogSearch.trim() !== '' && catalogDropdownStyle && createPortal(
                  <div style={catalogDropdownStyle} className="bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {filteredCatalogo.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">Sin resultados.</div>
                    ) : filteredCatalogo.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { addToCotizacion(p); setCatalogSearch(''); }}
                        className="w-full text-left p-2 hover:bg-blue-50 flex items-center justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded">{p.marca}</span>
                          <p className="text-xs font-medium text-gray-800 truncate">{p.desc}</p>
                          <p className="text-[11px] text-gray-500">SKU: {p.sku}</p>
                          <p className="text-xs font-semibold text-blue-600">{formatCurrency(calcularPrecioCatalogo(p))}</p>
                        </div>
                        <span className="ml-2 text-xs text-blue-600">Agregar</span>
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
              <div>
                {cotizacion.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    <span className="text-sm text-gray-500">Carrito</span>
                    <p className="mt-2 text-sm">No hay productos. Busca por SKU, MPN o modelo.</p>
                  </div>
                ) : cotizacion.map((item, index) => {
                  const pu = calcularPrecioClienteItem(item);
                  const isAxis = (item.origen || 'QNAP') === 'AXIS';
                  const baseGp = isAxis ? cotizacionGpGlobalAxis : cotizacionGpGlobalQnap;
                  const partnerRebate = isAxis ? getAxisPartnerRebate(item, item.partnerCategory || cotizacionPartnerCategory) : 0;
                  const projectRebate = isAxis ? (parseFloat(item.rebateProject) || 0) : 0;
                  const rebateTotal = partnerRebate + projectRebate;
                  const costoXUS = item.precio * AXIS_CONSTANTS.INBOUND_FREIGHT;
                  const costoFinalXUS = costoXUS / AXIS_CONSTANTS.IC;
                  const costoXCL = costoFinalXUS * (1 + AXIS_CONSTANTS.INT);
                  const costoTotalXCL = Math.max(costoXCL - rebateTotal, 0);
                  const descuentoPorcentualAxis = item.precio > 0 ? (rebateTotal / item.precio) * 100 : 0;
                  return (
                    <div key={item.id} className={`p-2 border-b ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex-1 min-w-0">
                          {isAdmin ? (
                            <>
                              <span className="text-[11px] text-blue-600">{item.marca}</span>
                              <p className="text-xs font-medium truncate">{item.desc}</p>
                            </>
                          ) : (
                            <p className="text-xs font-medium truncate">Modelo: {item.desc}</p>
                          )}
                          <p className="text-[11px] text-gray-500">SKU: {item.sku} | MPN: {item.mpn || 'N/A'} | {item.tiempo}</p>
                        </div>
                        <button onClick={() => removeItem(item.id)} className="text-red-500 hover:bg-red-50 px-2 py-0.5 rounded text-[11px]">Quitar</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <label className="text-[11px] text-gray-500">Cant:</label>
                        <input type="number" min="1" value={item.cant} onChange={e => updateItem(item.id, 'cant', e.target.value)} className="w-12 px-2 py-0.5 border rounded text-xs text-center" />
                        {isAdmin && (
                          <>
                            <label className="text-[11px] text-gray-500">Margen</label>
                            <input
                              type="number"
                              value={
                                item.gpOverrideInput !== undefined
                                  ? item.gpOverrideInput
                                  : (item.gpOverride === null || item.gpOverride === undefined
                                    ? ''
                                    : (Math.round(item.gpOverride * 10000) / 100).toString())
                              }
                              onChange={e => updateItem(item.id, 'gpOverride', e.target.value)}
                              placeholder={(baseGp * 100).toFixed(2)}
                              className="w-16 px-2 py-0.5 border rounded text-[11px]"
                            />
                            <label className="text-[11px] text-gray-500">Entrega</label>
                            <input
                              type="text"
                              value={item.tiempo || ''}
                              onChange={e => updateItem(item.id, 'tiempo', e.target.value)}
                              className="w-36 px-2 py-0.5 border rounded text-[11px]"
                            />
                          </>
                        )}
                        {isAdmin && isAxis && (
                          <>
                            <label className="text-[11px] text-gray-500">Partner</label>
                            <select
                              value={item.partnerCategory || DEFAULT_AXIS_PARTNER}
                              onChange={e => updateItem(item.id, 'partnerCategory', e.target.value)}
                              className="px-2 py-0.5 border rounded text-[11px]"
                            >
                              <option>Partner Autorizado</option>
                              <option>Partner Silver</option>
                              <option>Partner Gold</option>
                              <option>Partner Multiregional</option>
                            </select>
                            <label className="text-[11px] text-gray-500">Rebate</label>
                            <input
                              type="number"
                              value={item.rebateProject ?? 0}
                              onChange={e => updateItem(item.id, 'rebateProject', e.target.value)}
                              className="w-16 px-2 py-0.5 border rounded text-[11px]"
                            />
                          </>
                        )}
                        <div className="flex-1 text-right">
                          <p className="text-[11px] text-gray-500">{formatCurrency(pu)} x {item.cant}</p>
                          <p className="text-xs font-semibold text-blue-600">{formatCurrency(pu * item.cant)}</p>
                        </div>
                      </div>
                      {isAdmin && isAxis && (
                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-500">
                            <span>Partner: {formatCurrency(partnerRebate)}</span>
                            <span>Rebate Total: <span className="font-semibold text-gray-800">{formatCurrency(rebateTotal)}</span></span>
                            <span>Descuento porcentual Axis: <span className="font-semibold text-gray-800">{descuentoPorcentualAxis.toFixed(2)}%</span></span>
                            <span>Costo XUS: <span className="font-semibold text-gray-800">{formatCurrency(costoXUS)}</span></span>
                            <span>Costo Final XCL: <span className="font-semibold text-gray-800">{formatCurrency(costoTotalXCL)}</span></span>
                          </div>
                        )}
                      {showAdminPanel && isAdmin && (
                        <div className="mt-2 p-2 bg-gray-50 rounded border text-xs">
                          <div className="grid grid-cols-1 gap-2">
                            <div>
                              <label className="text-gray-500">Precio Disty:</label>
                              <input type="number" value={item.precio} onChange={e => updateItem(item.id, 'precio', e.target.value)} className="w-full mt-1 px-2 py-1 border rounded" />
                            </div>
                          </div>
                          <div className="mt-1 text-gray-500">Freight: {calcParams.INBOUND_FREIGHT} | IC: {calcParams.IC} | INT: {(calcParams.INT * 100).toFixed(0)}%</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
            <div className="lg:col-span-4 space-y-4">
              <div className="glass-card rounded-2xl shadow-[0_18px_36px_-28px_rgba(15,23,42,0.35)] border border-white/70 overflow-hidden lg:sticky lg:top-24">
                <div className="p-4 border-b bg-gray-50">
                  <h3 className="font-semibold">Resumen</h3>
                </div>
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Ítems</span>
                    <span className="text-sm font-semibold">{cotizacion.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Total</span>
                    <span className="text-xl font-bold text-blue-600">{formatCurrency(totalCotizacion)}</span>
                  </div>
                  <div className="space-y-2">
                    {isAdmin && (
                      <button
                        onClick={() => setShowAdminPanel(!showAdminPanel)}
                        className="w-full px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                      >
                        {showAdminPanel ? 'Ocultar' : 'Mostrar'} Panel Admin
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={exportCotizacionAxis}
                        disabled={cotizacion.length === 0}
                        className="w-full py-2 bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50"
                      >
                        Exportar a Axis
                      </button>
                    )}
                    <button
                      onClick={() => setCurrentView('cliente')}
                      disabled={cotizacion.length === 0}
                      className="w-full py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-lg hover:from-green-600 hover:to-emerald-600 disabled:opacity-50"
                    >
                      Generar Cotización
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </>
        )}

        {currentView === 'cuenta' && !isAdmin && (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl shadow-[0_18px_36px_-28px_rgba(15,23,42,0.35)] border border-white/70 overflow-hidden">
              <div className="p-4 border-b bg-gray-50">
                <h3 className="font-semibold">Mi cuenta</h3>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Nombre
                  <input
                    value={user?.nombre || user?.usuario || ''}
                    readOnly
                    className="px-3 py-2 border rounded text-sm text-gray-800 bg-gray-50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Empresa
                  <input
                    value={user?.empresa || ''}
                    readOnly
                    className="px-3 py-2 border rounded text-sm text-gray-800 bg-gray-50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Nivel de partner
                  <input
                    value={user?.partner_category || 'Partner Autorizado'}
                    readOnly
                    className="px-3 py-2 border rounded text-sm text-gray-800 bg-gray-50"
                  />
                </label>
              </div>
            </div>

            <div className="glass-card rounded-2xl shadow-[0_18px_36px_-28px_rgba(15,23,42,0.35)] border border-white/70 overflow-hidden">
              <div className="p-4 border-b bg-gray-50">
                <h3 className="font-semibold">Cambiar contraseña</h3>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Nueva contraseña
                  <input
                    type="password"
                    value={accountPassword}
                    onChange={e => setAccountPassword(e.target.value)}
                    className="px-3 py-2 border rounded text-sm text-gray-800"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-500">
                  Confirmar contraseña
                  <input
                    type="password"
                    value={accountPasswordConfirm}
                    onChange={e => setAccountPasswordConfirm(e.target.value)}
                    className="px-3 py-2 border rounded text-sm text-gray-800"
                  />
                </label>
                <div>
                  <button
                    onClick={updateOwnPassword}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                  >
                    Guardar contraseña
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {projectRegistroModal && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="font-semibold">Registro de proyecto</h3>
                <button
                  onClick={() => setProjectRegistroModal(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-gray-500">Cliente final</div>
                  <div className="font-semibold text-gray-800">{projectRegistroModal.cliente_final || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Nombre del proyecto</div>
                  <div className="font-semibold text-gray-800">{projectRegistroModal.cliente_telefono || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Fecha ejecución</div>
                  <div className="font-semibold text-gray-800">{projectRegistroModal.fecha_ejecucion || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Fecha implementación</div>
                  <div className="font-semibold text-gray-800">{projectRegistroModal.fecha_implementacion || 'N/A'}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-gray-500">VMS a utilizar</div>
                  <div className="font-semibold text-gray-800">{projectRegistroModal.vms || 'N/A'}</div>
                </div>
                <div className="md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={Boolean(dismissedRegistroById[projectRegistroModal.id])}
                      onChange={(e) => {
                        setDismissedRegistroById(prev => ({
                          ...prev,
                          [projectRegistroModal.id]: e.target.checked
                        }));
                      }}
                    />
                    Marcar registro como completado (ocultar alerta)
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
        {compraPreviewCot && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="font-semibold">Enviar a compras</h3>
                <button onClick={() => setCompraPreviewCot(null)} className="text-gray-500 hover:text-gray-700">Cerrar</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-sm">
                  <p><span className="font-semibold">Para:</span> juan.parral@intcomex.com</p>
                  <p>
                    <span className="font-semibold">Asunto:</span>{' '}
                    Compra {getCompraOrigenLabel(compraPreviewCot)} - BO {(boByCotizacionId[compraPreviewCot.id] || '').trim() || compraPreviewCot.id || 'XXXX'}
                  </p>
                </div>
                <div
                  className="border rounded-lg p-3 bg-gray-50 text-sm"
                  dangerouslySetInnerHTML={{ __html: buildCompraHtml(compraPreviewCot) }}
                ></div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => copyHtmlToClipboard(buildCompraTableHtml(compraPreviewCot))}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm"
                  >
                    Copiar tabla HTML
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(`Compra ${getCompraOrigenLabel(compraPreviewCot)} - BO ${(boByCotizacionId[compraPreviewCot.id] || '').trim() || compraPreviewCot.id || 'XXXX'}`)}
                    className="px-3 py-1.5 bg-slate-200 text-slate-800 rounded hover:bg-slate-300 text-sm"
                  >
                    Copiar asunto
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </main>
      </div>
      {!isAdmin && (
        <footer className="mt-auto px-2 py-3 text-[10px] leading-4 text-gray-500 border-t bg-white/70">
          <div className="w-[97%] mx-auto">
            <p>
              Plataforma de gestión de cotizaciones comerciales diseñada para la emisión de propuestas formales.
              Solución desarrollada como iniciativa de optimización de procesos comerciales por Alexis González – Product Manager.
              Las cotizaciones generadas están sujetas a validación comercial, disponibilidad de stock y condiciones vigentes al momento de la confirmación.
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}
























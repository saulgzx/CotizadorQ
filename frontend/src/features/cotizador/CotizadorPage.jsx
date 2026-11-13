import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
// xlsx (SheetJS) se carga bajo demanda para sacar ~400KB del bundle inicial.
let _xlsxModulePromise = null;
const getXLSX = () => {
  if (!_xlsxModulePromise) _xlsxModulePromise = import('xlsx');
  return _xlsxModulePromise;
};
import { authAPI, productosAPI, cotizacionesAPI, usuariosAPI, sesionesAPI, osoAPI, boMetaAPI, stockAPI } from '../../api';
import { queryClient } from '../../app/queryClient';
import { queryKeys } from '../../app/queryKeys';

import {
  CONSTANTS,
  AXIS_CONSTANTS,
  CADENA_POR_ORIGEN,
  STOCK_DELIVERY_SUFFIX,
  SESSION_STORAGE_KEY,
  SESSION_HEARTBEAT_MS,
  DEFAULT_AXIS_PARTNER,
  COTIZADOR_STOCK_ADMIN_ROLE,
  COLUMN_MAP,
  VIEW_TO_ROUTE,
  ROUTE_TO_VIEW,
  ADMIN_VIEWS
} from './cotizadorConstants';
import {
  safeJsonParse,
  normalizeRole,
  canManageCotizadorStock,
  normalizeText,
  normalizeIntcomexProfile,
  isIntcomexVentas,
  canChangeOwnPartnerCategory,
  getOrCreateDeviceId,
  getOrCreateSessionId,
  registerSessionForUser,
  updateSessionHeartbeat,
  isSessionActive,
  clearSessionForUser,
  calcularPrecioCliente,
  formatCurrency,
  formatDateTime,
  formatInvoiceMonthLabel,
  findValue,
  parseGp,
  normalizeLookupKey,
  formatStockQuantity,
  normalizeSearchText,
  buildSearchTokens,
  loadPdfDeps
} from './cotizadorHelpers';
import { CotizadorContext } from './cotizadorContext';
import useTheme from '../theme/useTheme';
import { BarraSuperior, Cortina, Indice, direccionDeVista } from '../ui/Navegacion';
import ThemeToggle from '../theme/ThemeToggle';
import { notify, Toaster } from '../ui/toast';
import MargenChip from './MargenChip';
import { estadoMargen, formatoPct, useConfigMargen } from './margen';
import { pareceLista } from './listaPegada';
import PegarListaModal from './PegarListaModal';
import CargarQuoteModal from './CargarQuoteModal';
import { gpBaseDeOrigen, gpDeLinea } from './gpLinea';
import { esOrigenQuote, productoDeQuoteGuardado } from './quoteFabricante';
import { etiquetaCompraOrigen } from './compraOrigen';
import AtajosAyuda from './AtajosAyuda';
import RevisionEnvioModal from './RevisionEnvioModal';
import SemaforoMargenAjustes from './SemaforoMargenAjustes';
import CarritoLineas from './CarritoLineas';
import NumeroInput from '../ui/NumeroInput';
import { precioSistemaDe, useMargenSistema } from './precioSistema';
import { productoFueraDeLista } from './fueraDeLista';
import Resaltado from '../ui/Resaltado';
import Icono from '../ui/Icono';
import EncabezadoPagina from '../ui/EncabezadoPagina';
import { EstadoVacio, FilasEsqueleto } from '../ui/Esqueleto';
import PanelVersiones from './editor/PanelVersiones';
import {
  ArchivarAnterioresDialogo,
  ConmutadorArchivo,
  EtapaCotizacion,
  EtiquetaVersion,
  FiltroEtapas,
  SelectorEtapa
} from '../crm/CotizacionesPiezas';
import { PerdidaDialogo } from '../crm/DialogosCrm';
import { contarPorEtapa, etapaDeCotizacion, textoConteoArchivo } from '../crm/etapasCotizacion';
import { nombreEtapa } from '../crm/formato';
import { guardarCache, leerCache, limpiarCaches } from './cacheLocal';
import { VIDA_UTIL_DATOS_MS, estaVencido, mismoMapaDeStock } from './frescura';
import { esEntregaAutomatica, textoEntregaLinea } from './entregaStock';
import { numeroMonto } from './montosOrden';
import {
  mesFacturacionDeBo,
  metaDeOrden,
  opcionesMesFacturacion,
  procesarCargaOso,
  semanaFacturacionDeBo
} from '../ordenes/ordenesOso';

// Margen de una cotización guardada. Solo el rol admin recibe margen_total por línea.
const margenCotizacion = (cot) => {
  const items = Array.isArray(cot?.items) ? cot.items : [];
  let venta = 0;
  let margen = 0;
  let conCosto = 0;
  for (const item of items) {
    if (item.margen_total === null || item.margen_total === undefined) continue;
    conCosto += 1;
    venta += Number(item.precio_total) || 0;
    margen += Number(item.margen_total) || 0;
  }
  if (conCosto === 0 || venta <= 0) return null;
  return { venta, margen, gpPct: (margen / venta) * 100, origenes: items.map(i => i.origen || 'QNAP'), parcial: conCosto < items.length };
};

const FILTROS_HISTORIAL_VACIOS = { fecha: '', cliente: '', pid: '', proyecto: '', producto: '', etapas: [] };
const CRM_TABS = new Set(['resumen', 'embudo', 'cotizaciones', 'empresas', 'seguimiento']);

// /crm?tab=cotizaciones&cotizacion=ID: la página se vuelve a montar al cambiar de
// ruta, así que la pestaña y la cotización a abrir viajan en la URL. Si otra
// navegación pisa la URL durante ese cambio, el destino pedido se recuerda unos
// segundos a nivel de módulo para no caer en la pestaña por defecto.
let destinoCrmPendiente = null;
const recordarDestinoCrm = (tab, cotizacion = null) => {
  destinoCrmPendiente = { tab, cotizacion, en: Date.now() };
};
const leerParamsCrm = (search) => {
  const params = new URLSearchParams(search || '');
  const tab = params.get('tab');
  const cotizacion = Number(params.get('cotizacion'));
  const pendiente = destinoCrmPendiente && Date.now() - destinoCrmPendiente.en < 4000 ? destinoCrmPendiente : null;
  if (!CRM_TABS.has(tab) && pendiente) return { tab: pendiente.tab, cotizacion: pendiente.cotizacion };
  return {
    tab: CRM_TABS.has(tab) ? tab : 'resumen',
    cotizacion: Number.isFinite(cotizacion) && cotizacion > 0 ? cotizacion : null
  };
};

const DashboardView = lazy(() => import('./views/DashboardView'));
const ConnectionsMap = lazy(() => import('./views/ConnectionsMap'));
const CotizacionEditor = lazy(() => import('./editor/CotizacionEditor'));
const AsistenteIAView = lazy(() => import('../ia/AsistenteIAView'));
const CrmView = lazy(() => import('../crm/CrmView'));
const OrdenesComprasView = lazy(() => import('../ordenes/OrdenesComprasView'));

const NAV_ICON_PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5.25 9.75V21h4.5v-6h4.5v6h4.5V9.75',
  truck: 'M3 7.5h10.5V17H3zM13.5 10.5H18l3 3V17h-7.5M6 17a1.9 1.9 0 1 0 0 3.8A1.9 1.9 0 0 0 6 17zm10.5 0a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z',
  cart: 'M2.5 4h2l2.3 11.5h11l2.2-8.5H6M9.5 19.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  tag: 'M3 11.25V4.5A1.5 1.5 0 0 1 4.5 3h6.75L21 12.75 12.75 21zM7.5 7.5h.008',
  users: 'M15 19.5a4.5 4.5 0 0 0-9 0M16.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM18.4 12.6a4.5 4.5 0 0 1 3.1 4.4M16 4.7a3 3 0 0 1 0 5.6',
  calc: 'M7.5 3h9A1.5 1.5 0 0 1 18 4.5v15A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3zM9 6.75h6M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01',
  box: 'M21 7.5 12 3 3 7.5m18 0L12 12m9-4.5V16.5L12 21m0-9L3 7.5m9 4.5v9m-9-13.5V16.5L12 21',
  clock: 'M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  user: 'M17.98 19.4a8.25 8.25 0 0 0-11.96 0M15.75 9.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0zM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  menu: 'M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5',
  search: 'M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
  sun: 'M12 3v2M12 19v2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M3 12h2M19 12h2M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  close: 'M6 18 18 6M6 6l12 12',
  sparkles: 'M9.8 4.5 11 8.2a2 2 0 0 0 1.3 1.3l3.7 1.2-3.7 1.2a2 2 0 0 0-1.3 1.3L9.8 17l-1.2-3.8a2 2 0 0 0-1.3-1.3L3.6 10.7l3.7-1.2a2 2 0 0 0 1.3-1.3zM18 3v4M16 5h4M17.5 16v3M16 17.5h3',
  logout: 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18.75 15.75 21.75 12l-3-3.75M9 12h12.75'
};

const NavIcon = ({ name, className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d={NAV_ICON_PATHS[name] || NAV_ICON_PATHS.menu} />
  </svg>
);

// Agrupa controles de filtro: en desktop siempre visibles, en móvil colapsados
// tras un botón "Filtros" para despejar la pantalla.
// GP global en %: se puede borrar y reescribir; al salir vacío vuelve al último valor válido.
function GpGlobalCampo({ etiqueta, gp, onCambio }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
      {etiqueta}
      <span className="relative inline-flex">
        <NumeroInput
          value={Number.isFinite(gp) ? Math.round(gp * 1000) / 10 : null}
          decimales={1}
          onCommit={onCambio}
          ariaLabel={`${etiqueta} %`}
          className="h-8 w-20 pr-6"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
      </span>
    </label>
  );
}

function CollapsibleFilters({ label = 'Filtros', children, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`w-full lg:w-auto ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
        {label}
      </button>
      <div className={`${open ? 'flex mt-2' : 'hidden'} lg:flex lg:mt-0 flex-wrap items-center gap-2`}>
        {children}
      </div>
    </div>
  );
}

// Usuarios con navegación restringida: solo ven estas vistas (clave = usuario en minúsculas).
// Nota: restringe la UI, no los permisos de API (el rol sigue mandando en el backend).
const RESTRICTED_NAV_BY_USER = {
  jleon: ['cotizador', 'stock', 'historial']
};

// Cuentas exentas de aceptar la ubicación (administrador supremo). El resto debe conceder GPS.

// Buscador rápido (Ctrl+K): navegar vistas, buscar productos y ejecutar acciones.
function CommandPalette({ open, onClose, navItems, currentView, onNavigate, productos, onPickProducto, theme, onToggleTheme, onLogout }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const tokens = buildSearchTokens(query);
  const matches = (text) => !tokens.length || tokens.every(t => normalizeSearchText(text).includes(t));

  const viewResults = navItems
    .filter(item => item.key !== currentView && matches(item.label))
    .map(item => ({ id: `view-${item.key}`, icon: item.icon, label: item.label, hint: 'Vista', run: () => onNavigate(item.key) }));
  const productResults = tokens.length
    ? (productos || [])
        .filter(p => matches(`${p.marca || ''} ${p.sku || ''} ${p.mpn || ''} ${p.desc || ''}`))
        .slice(0, 8)
        .map(p => ({
          id: `prod-${p.id}`,
          icon: 'box',
          label: `${p.sku || p.mpn || 'S/C'} · ${(p.desc || '').slice(0, 70)}`,
          hint: p.origen || 'Producto',
          run: () => onPickProducto(p)
        }))
    : [];
  const actionResults = [
    { id: 'accion-tema', icon: 'sun', label: theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro', hint: 'Acción', run: onToggleTheme },
    { id: 'accion-salir', icon: 'logout', label: 'Cerrar sesión', hint: 'Acción', run: onLogout }
  ].filter(a => matches(a.label));
  const results = [...viewResults, ...productResults, ...actionResults];

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = results[activeIndex];
      if (selected) {
        selected.run();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Buscador rápido">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="relative mx-auto mt-[12vh] w-[640px] max-w-[92vw] rounded-2xl bg-white dark:bg-slate-900 shadow-float border border-slate-200/70 dark:border-slate-700/60 overflow-hidden animate-scale-in">
        <div className="flex items-center gap-2 px-4 border-b border-slate-100 dark:border-slate-800">
          <NavIcon name="search" className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar vistas, productos o acciones…"
            className="flex-1 py-3.5 bg-transparent outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 border-0"
          />
          <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 shrink-0">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">Sin resultados para “{query}”</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => { r.run(); onClose(); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition ${i === activeIndex ? 'bg-slate-100 text-slate-900 font-semibold' : 'text-slate-700'}`}
              >
                <NavIcon name={r.icon} className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{r.label}</span>
                <span className={`text-xs uppercase tracking-wide shrink-0 ${i === activeIndex ? 'opacity-70' : 'text-slate-400'}`}>{r.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function CotizadorPage({ routeView = 'cotizador' }) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const DEFAULT_PAGE_SIZE = 15;
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const userRole = normalizeRole(user?.role);
  const isFullAdmin = user?.role ? userRole === 'admin' : true;
  const isCotizadorStockAdmin = userRole === COTIZADOR_STOCK_ADMIN_ROLE;
  const isAdmin = user?.role ? canManageCotizadorStock(userRole) : true;
  const isVentasUser = !isFullAdmin && isIntcomexVentas(user);
  const canViewDashboard = !isVentasUser && !isCotizadorStockAdmin;
  const canViewCotizador = true;
  const canViewStock = true;
  // Precio de sistema del stock (costo real / (1 - margen), sin rebate): solo admin.
  const { config: margenSistema, cambiar: cambiarMargenSistema, restablecer: restablecerMargenSistema } = useMargenSistema();
  const canViewHistorial = !isCotizadorStockAdmin;
  const canViewAccount = !isFullAdmin && !isCotizadorStockAdmin;
  // Asistente IA: solo personal interno (usa la sesion de IA y las skills de cada usuario).
  const canViewIA = isAdmin && !isCotizadorStockAdmin;
  const canEditPartnerCategory = canChangeOwnPartnerCategory(user);
  const isClient = !isAdmin;
  const navRestriction = RESTRICTED_NAV_BY_USER[normalizeText(user?.usuario)] || null;
  const [loading, setLoading] = useState(true);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [currentView, setCurrentView] = useState(routeView || 'cotizador');
  const hasRouteSync = !!ROUTE_TO_VIEW[location.pathname];
  const [adminSearchByView, setAdminSearchByView] = useState({
    dashboard: '',
    admin: '',
    historial: '',
    crm: '',
    usuarios: '',
    ordenes: '',
    compras: ''
  });
  const adminSearchView = (isAdmin && Object.prototype.hasOwnProperty.call(adminSearchByView, currentView))
    ? currentView
    : null;
  const globalSearch = adminSearchView ? (adminSearchByView[adminSearchView] || '') : '';
  const globalQuery = globalSearch.trim().toLowerCase();
  const setGlobalSearch = (value) => {
    if (!adminSearchView) return;
    setAdminSearchByView(prev => ({ ...prev, [adminSearchView]: value }));
  };
  const [pageByTable, setPageByTable] = useState({
    productos: 1,
    historial: 1,
    usuarios: 1
  });
  const [pageSizeByTable, setPageSizeByTable] = useState({
    productos: DEFAULT_PAGE_SIZE,
    historial: DEFAULT_PAGE_SIZE,
    usuarios: DEFAULT_PAGE_SIZE
  });
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
  const [currentQuoteNumero, setCurrentQuoteNumero] = useState(null);
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
  const [semaforoAbierto, setSemaforoAbierto] = useState(false);
  const stockExportRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [adminOrigin, setAdminOrigin] = useState('QNAP');
  const [cotizacionGpGlobalQnap, setCotizacionGpGlobalQnap] = useState(CONSTANTS.DEFAULT_GP);
  const [cotizacionGpGlobalAxis, setCotizacionGpGlobalAxis] = useState(CONSTANTS.DEFAULT_GP);
  // Ventana «Cargar quote» (ISS, Neural Labs, Milestone): solo admin.
  const [quoteAbierto, setQuoteAbierto] = useState(false);
  const [cotizacionPartnerCategory, setCotizacionPartnerCategory] = useState(DEFAULT_AXIS_PARTNER);
  const [historial, setHistorial] = useState([]);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [historialError, setHistorialError] = useState('');
  // Datos de órdenes SOLO para el dashboard (la vista de órdenes lleva los suyos).
  const [dashboardOrders, setDashboardOrders] = useState([]);
  const [dashboardBoMeta, setDashboardBoMeta] = useState({});
  const [dashboardInvoiceMonth, setDashboardInvoiceMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [syncStatus, setSyncStatus] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const cerrarIndice = useCallback(() => setMobileMenuOpen(false), []);
  // CRM: pestaña activa (Cotizaciones = la lista de cotizaciones del admin completo).
  const [crmTab, setCrmTab] = useState(() => leerParamsCrm(location.search).tab);
  // Cotizaciones del admin: activas o archivadas (estas se cargan aparte).
  const [historialVista, setHistorialVista] = useState('activas');
  const [historialArchivadas, setHistorialArchivadas] = useState([]);
  const [archivadasLoading, setArchivadasLoading] = useState(false);
  const [archivadasError, setArchivadasError] = useState('');
  const [archivadasRecarga, setArchivadasRecarga] = useState(0);
  // Al restaurar, las activas se vuelven a pedir (la invalidación sola no relanza la carga).
  const [activasRecarga, setActivasRecarga] = useState(0);
  const [archivarFechaAbierto, setArchivarFechaAbierto] = useState(false);
  const [versionesDe, setVersionesDe] = useState(null);
  const [perdidaDe, setPerdidaDe] = useState(null);
  const historialBase = isFullAdmin && historialVista === 'archivadas' ? historialArchivadas : historial;
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
  const [expandedHistorialId, setExpandedHistorialId] = useState(() => leerParamsCrm(location.search).cotizacion);
  // Cotización que hay que mostrar (página correcta y a la vista) cuando llegue la lista.
  const enfocarCotizacionRef = useRef(leerParamsCrm(location.search).cotizacion);
  const [dismissedRegistroById, setDismissedRegistroById] = useState({});
  const [empresaForm, setEmpresaForm] = useState({
    nombre: '',
    role: 'client',
    gp_qnap: '15',
    gp_axis: '15',
    intcomex_profile: '',
    partner_category: DEFAULT_AXIS_PARTNER,
    logo_url: ''
  });
  const [showEmpresaForm, setShowEmpresaForm] = useState(false);
  const [showUsuarioForm, setShowUsuarioForm] = useState(false);
  const [selectedUsuarioId, setSelectedUsuarioId] = useState(null);
  const [empresaConfigs, setEmpresaConfigs] = useState(() => {
    return safeJsonParse(localStorage.getItem('empresaConfigs'), {});
  });

  const updateGlobalMargin = (origin, value) => {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct >= 99.9) return;
    const parsed = pct / 100;
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
  const [accountPasswordCurrent, setAccountPasswordCurrent] = useState('');
  const [ownPartnerCategory, setOwnPartnerCategory] = useState(DEFAULT_AXIS_PARTNER);
  const [updatingOwnPartnerCategory, setUpdatingOwnPartnerCategory] = useState(false);
  const [updatingCotizacionPartner, setUpdatingCotizacionPartner] = useState(false);
  const [historialFilters, setHistorialFilters] = useState(FILTROS_HISTORIAL_VACIOS);
  const [calcParams, setCalcParams] = useState({
    INBOUND_FREIGHT: CONSTANTS.INBOUND_FREIGHT,
    IC: CONSTANTS.IC,
    INT: CONSTANTS.INT,
    DEFAULT_GP: CONSTANTS.DEFAULT_GP
  });
  const [showProjectRegistro, setShowProjectRegistro] = useState(false);
  const [projectRegistroModal, setProjectRegistroModal] = useState(null);
  // Id de la cotización abierta en el editor (solo admin); null = cerrado.
  const [editorCotizacionId, setEditorCotizacionId] = useState(null);
  // Rework de uso: lista pegada (null = cerrado), ayuda de atajos, revisión previa.
  const [pegarListaTexto, setPegarListaTexto] = useState(null);
  const [atajosAbiertos, setAtajosAbiertos] = useState(false);
  const [revisionAbierta, setRevisionAbierta] = useState(false);
  const [catalogActivo, setCatalogActivo] = useState(0);
  // Frescura del catálogo y del stock en memoria (ver frescura.js): marca de la última
  // carga que terminó bien, cuántas hay en vuelo y la última respuesta cruda aplicada.
  const ultimaCargaProductosRef = useRef(null);
  const ultimaCargaStockRef = useRef(null);
  const productosEnCursoRef = useRef(0);
  const stockEnCursoRef = useRef(0);
  const ultimoCrudoProductosRef = useRef(null);
  // Sube al cerrar sesión: una carga que termina después ya no pisa la pantalla.
  const generacionSesionRef = useRef(0);
  // Lectura de la ruta y de la vista sin volver a disparar efectos.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
  // `navigate` cambia de identidad en cada cambio de ruta: se lee por referencia para que no
  // dispare efectos que solo deben reaccionar a un cambio de vista.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const vistaAnteriorRef = useRef(currentView);
  // El asistente IA cambia de vista Y abre "pegar lista" a la vez: esa lista no se cierra.
  const conservarPegarListaRef = useRef(false);
  // Solo lectura aquí: se edita y guarda en SemaforoMargenAjustes.
  const [configMargen] = useConfigMargen();
  // Pila de líneas quitadas para Deshacer (Ctrl+Z o el botón del aviso).
  const quitadasRef = useRef([]);
  const userCardRefs = useRef({});
  const nuevoUsuarioFormRef = useRef(null);

  const fieldLabelClass = isClient
    ? 'flex flex-col gap-1 text-xs text-slate-500'
    : 'flex flex-col gap-1 text-xs text-slate-500';
  const fieldInputClass = isClient
    ? 'px-3 py-2 border rounded text-sm text-slate-800'
    : 'px-2 py-1 border rounded text-xs text-slate-800';

  const usuariosPorEmpresa = useMemo(() => {
    const grouped = usuarios.reduce((acc, u) => {
      const key = (u.empresa || 'Sin empresa').trim() || 'Sin empresa';
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  }, [usuarios]);


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

  // costoChile = "OH Unit USD" de la hoja Stock (costo real con que ingresó a Chile).
  // Si el producto tiene unidades disponibles, reemplaza al costo Chile calculado.
  const calcularPrecioClienteLocal = (precioDisty, gp = 0.15, costoChile = null) =>
    costoChile > 0 ? costoChile / (1 - gp) : calcularPrecioCliente(precioDisty, gp, calcParams);

  const getAxisPartnerRebate = (item, category) => {
    const selected = category || DEFAULT_AXIS_PARTNER;
    if (selected === 'Partner Silver') return item.rebate_partner_silver || 0;
    if (selected === 'Partner Gold') return item.rebate_partner_gold || 0;
    if (selected === 'Partner Multiregional') return item.rebate_partner_multiregional || 0;
    return item.rebate_partner_autorizado || 0;
  };

  const calcularPrecioClienteAxis = (precioDisty, gp, partnerRebate, projectRebate, costoChile = null) => {
    const costoXUS = precioDisty * AXIS_CONSTANTS.INBOUND_FREIGHT;
    const costoFinalXUS = costoXUS / AXIS_CONSTANTS.IC;
    const costoXCL = costoChile > 0 ? costoChile : costoFinalXUS * (1 + AXIS_CONSTANTS.INT);
    const rebateTotal = (partnerRebate || 0) + (projectRebate || 0);
    const costoFinalXCL = Math.max(costoXCL - rebateTotal, 0);
    return costoFinalXCL / (1 - gp);
  };

  // Márgenes globales vigentes: base de las líneas sin margen propio (las de quote usan 8 %).
  const gpGlobales = { gpQnap: cotizacionGpGlobalQnap, gpAxis: cotizacionGpGlobalAxis };

  const calcularPrecioClienteItem = (item) => {
    if (!isAdmin) {
      return Number(item.precio_cliente ?? item.precio ?? 0);
    }
    const gpEffective = gpDeLinea(item, gpGlobales);
    if (esOrigenQuote(item.origen)) {
      // Línea de quote: costo Chile = costo del quote x (1 + transporte y arancel), ya calculado al
      // cargarla. Nunca pasa por calcParams (cadena de QNAP): si faltara costoChile se usa la
      // cadena de su propio origen.
      const cadena = CADENA_POR_ORIGEN[String(item.origen).trim().toUpperCase()];
      const costoChile = item.costoChile > 0
        ? item.costoChile
        : ((Number(item.precio) || 0) * cadena.INBOUND_FREIGHT / cadena.IC) * (1 + cadena.INT);
      return costoChile / (1 - gpEffective);
    }
    if ((item.origen || 'QNAP') !== 'AXIS') {
      return calcularPrecioClienteLocal(item.precio, gpEffective, item.costoChile);
    }
    const effectivePartnerCategory = isAdmin
      ? (item.partnerCategory || cotizacionPartnerCategory)
      : cotizacionPartnerCategory;
    const partnerRebate = getAxisPartnerRebate(item, effectivePartnerCategory);
    const projectRebate = parseFloat(item.rebateProject) || 0;
    return calcularPrecioClienteAxis(item.precio, gpEffective, partnerRebate, projectRebate, item.costoChile);
  };

  const calcularPrecioCatalogo = (producto) => {
    if (!isAdmin) {
      return Number(producto.precio_cliente ?? producto.precio ?? 0);
    }
    if ((producto.origen || 'QNAP') !== 'AXIS') {
      return calcularPrecioClienteLocal(producto.precio, cotizacionGpGlobalQnap, producto.costoChile);
    }
    const partnerRebate = getAxisPartnerRebate(producto, DEFAULT_AXIS_PARTNER);
    return calcularPrecioClienteAxis(producto.precio, cotizacionGpGlobalAxis, partnerRebate, 0, producto.costoChile);
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

  const buildExportFilename = (dateValue, projectName, integratorName, version = 1) => {
    const dateKey = getDateKeyCompact(dateValue) || getDateKeyCompact(new Date());
    const project = sanitizeFilenamePart(projectName);
    const integrator = sanitizeFilenamePart(integratorName);
    const namePart = project || integrator || 'cotizacion';
    return `${dateKey || 'export'}_${namePart}_v${Math.max(1, Math.trunc(Number(version)) || 1)}`;
  };

  const downloadPdfFromElement = async (element, filenameBase) => {
    if (!element) {
      notify('No se pudo generar el PDF.');
      return;
    }
    const captureElement = element.querySelector('[data-pdf-root="1"]') || element;
    try {
      setSaving(true);
      if (document?.fonts?.ready) {
        await document.fonts.ready;
      }
      const { html2canvas, jsPDF } = await loadPdfDeps();
      const elementRect = captureElement.getBoundingClientRect();
      const elementWidth = Math.max(captureElement.scrollWidth || 0, elementRect.width || 0);
      const elementHeight = Math.max(captureElement.scrollHeight || 0, elementRect.height || 0);
      const imageNodes = Array.from(captureElement.querySelectorAll('img'));
      await Promise.all(imageNodes.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      }));
      const logoNodes = Array.from(new Set([
        ...captureElement.querySelectorAll('img[data-pdf-logo="1"]'),
        ...captureElement.querySelectorAll('img[alt="Logo"]')
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
      const canvas = await html2canvas(captureElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: elementWidth || undefined,
        height: elementHeight || undefined,
        windowWidth: elementWidth || undefined,
        windowHeight: elementHeight || undefined
      });
      logoNodes.forEach(img => {
        img.style.visibility = img.dataset.prevVisibility || '';
        delete img.dataset.prevVisibility;
      });
      const extraPadding = 24;
      let renderCanvas = canvas;
      if (extraPadding > 0) {
        const padded = document.createElement('canvas');
        padded.width = canvas.width;
        padded.height = canvas.height + extraPadding;
        const ctx = padded.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, padded.width, padded.height);
          ctx.drawImage(canvas, 0, 0);
          renderCanvas = padded;
        }
      }
      const imgData = renderCanvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (renderCanvas.height * imgWidth) / renderCanvas.width;
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
          // Los logos pueden ser SVG (marca MyQuote): se rasterizan a PNG a 4x
          // respetando la proporción, como object-contain alineado a la izquierda.
          const naturalW = logoImage.naturalWidth || logoImage.width || logoMeta.w;
          const naturalH = logoImage.naturalHeight || logoImage.height || logoMeta.h;
          const fit = Math.min(logoMeta.w / naturalW, logoMeta.h / naturalH) || 1;
          const drawW = naturalW * fit;
          const drawH = naturalH * fit;
          const raster = document.createElement('canvas');
          raster.width = Math.max(1, Math.round(drawW * 4));
          raster.height = Math.max(1, Math.round(drawH * 4));
          raster.getContext('2d')?.drawImage(logoImage, 0, 0, raster.width, raster.height);
          const logoX = logoMeta.x * domToPdfScale;
          const logoY = (logoMeta.y + (logoMeta.h - drawH) / 2) * domToPdfScale;
          const logoW = drawW * domToPdfScale;
          const logoH = drawH * domToPdfScale;
          pdf.addImage(raster.toDataURL('image/png'), 'PNG', logoX, logoY, logoW, logoH);
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
      notify(error.message || 'Error generando PDF');
    } finally {
      setSaving(false);
    }
  };

  const calcularPrecioAdmin = (producto) => {
    if ((producto.origen || 'QNAP') !== 'AXIS') {
      return calcularPrecioClienteLocal(producto.precio, calcParams.DEFAULT_GP, producto.costoChile);
    }
    const partnerRebate = getAxisPartnerRebate(producto, DEFAULT_AXIS_PARTNER);
    return calcularPrecioClienteAxis(producto.precio, calcParams.DEFAULT_GP, partnerRebate, 0, producto.costoChile);
  };

  // Verificar sesin al cargar
  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      const parsedUser = safeJsonParse(savedUser, null);
      if (!parsedUser) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setIsLoggedIn(false);
        setUser(null);
        setLoading(false);
        return;
      }
      setIsLoggedIn(true);
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
  // `silencioso`: recarga en segundo plano (no cambia nada visible salvo que haya datos nuevos).
  const loadProductos = async (roleOverride, { silencioso = false } = {}) => {
    const sesion = generacionSesionRef.current;
    const isAdminForLoad = roleOverride ? canManageCotizadorStock(roleOverride) : isAdmin;
    const usuarioCache = (() => {
      const u = safeJsonParse(localStorage.getItem('user'), null);
      return u ? `${u.id}-${u.role}` : null;
    })();
    const mapear = (data) => (Array.isArray(data) ? data : []).map(p => ({
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
        // Costo Chile real (OH Unit USD) si hay stock disponible; solo llega al admin.
        costoChile: isAdminForLoad && Number(p.costo_chile_real) > 0 ? Number(p.costo_chile_real) : null,
        tiempo: p.tiempo_entrega || 'ETA por confirmar'
      }));
    // Carga instantánea: se muestra el catálogo guardado en este navegador y se
    // refresca en segundo plano con la versión del servidor.
    if (usuarioCache) {
      const guardado = leerCache('productos', usuarioCache);
      if (guardado) setProductos(prev => (prev.length ? prev : mapear(guardado)));
    }
    productosEnCursoRef.current += 1;
    try {
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.productos,
        queryFn: () => productosAPI.getAll(),
        staleTime: 0
      });
      // Se cerró la sesión mientras llegaba: no se muestra el catálogo del usuario que salió.
      if (sesion !== generacionSesionRef.current) return [];
      ultimaCargaProductosRef.current = Date.now();
      // React Query conserva la referencia si el contenido no cambió: en segundo plano
      // no hay nada que volver a pintar ni que volver a guardar.
      if (silencioso && data === ultimoCrudoProductosRef.current) return [];
      ultimoCrudoProductosRef.current = data;
      const mapped = mapear(data);
      setProductos(mapped);
      if (usuarioCache) guardarCache('productos', usuarioCache, data);
      return mapped;
    } catch (error) {
      console.error('Error cargando productos:', error);
      return [];
    } finally {
      productosEnCursoRef.current -= 1;
    }
  };

  const loadStock = async ({ silencioso = false } = {}) => {
    const sesion = generacionSesionRef.current;
    stockEnCursoRef.current += 1;
    try {
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.stock,
        queryFn: () => stockAPI.getAll(),
        staleTime: 60 * 1000
      });
      if (sesion !== generacionSesionRef.current) return;
      ultimaCargaStockRef.current = Date.now();
      const items = Array.isArray(data?.items) ? data.items : [];
      const map = {};
      items.forEach(item => {
        const key = normalizeLookupKey(item?.mpn);
        if (!key) return;
        // Solo lo realmente disponible entra al mapa: 0 se trata igual que sin stock.
        if (!(Number(item?.quantity) > 0)) return;
        map[key] = item.quantity;
      });
      // Las entregas del carrito se recalculan en el efecto de entregas al cambiar el mapa.
      // Si el stock no cambió se conserva el mismo objeto y no se renderiza nada.
      setStockByMpn(prev => (mismoMapaDeStock(prev, map) ? prev : map));
    } catch (error) {
      console.error('Error cargando stock:', error);
      // En segundo plano un fallo no borra el stock que ya se estaba mostrando.
      if (!silencioso) setStockByMpn({});
    } finally {
      stockEnCursoRef.current -= 1;
    }
  };

  const loadStockCatalog = async () => {
    const sesion = generacionSesionRef.current;
    // Con datos ya en pantalla (volvió a la vista) se refresca sin esqueleto ni vaciar la tabla.
    const hayDatos = stockCatalog.length > 0;
    try {
      if (!hayDatos) setStockCatalogLoading(true);
      setStockCatalogError('');
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.stockCatalog,
        queryFn: () => stockAPI.getCatalog(),
        staleTime: VIDA_UTIL_DATOS_MS
      });
      if (sesion !== generacionSesionRef.current) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      setStockCatalog(items);
    } catch (error) {
      console.error('Error cargando catálogo de stock:', error);
      if (!hayDatos) {
        setStockCatalogError(error.message || 'Error cargando stock disponible');
        setStockCatalog([]);
      }
    } finally {
      setStockCatalogLoading(false);
    }
  };

  // Recarga en segundo plano del catálogo y del stock cuando lo que hay en memoria tiene más
  // de VIDA_UTIL_DATOS_MS. No muestra esqueletos ni vacía la pantalla y no toca el carrito, la
  // búsqueda ni los filtros: solo reemplaza los datos si llegaron distintos. Cada dato decide
  // por su cuenta (productos y stock tienen su propia marca) y no se duplica una carga en vuelo.
  const refrescarCatalogoSiVencido = () => {
    if (!isLoggedIn) return;
    if (productosEnCursoRef.current === 0 && estaVencido(ultimaCargaProductosRef.current)) {
      loadProductos(undefined, { silencioso: true });
    }
    if (stockEnCursoRef.current === 0 && estaVencido(ultimaCargaStockRef.current)) {
      loadStock({ silencioso: true });
    }
  };
  const refrescarCatalogoRef = useRef(null);
  refrescarCatalogoRef.current = refrescarCatalogoSiVencido;
  const alVolverALaPestanaRef = useRef(null);
  alVolverALaPestanaRef.current = () => {
    refrescarCatalogoSiVencido();
    // La tabla de Stock disponible también se refresca (su propia consulta vence a los mismos 2 minutos).
    if (currentView === 'stock') loadStockCatalog();
  };

  // (a) Se ENTRA al Cotizador o a Stock. Nunca en cada clic del menú: solo si está vencido.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (currentView === 'cotizador' || currentView === 'stock') refrescarCatalogoRef.current();
  }, [isLoggedIn, currentView]);

  // (b) La pestaña vuelve a estar visible después de un rato.
  useEffect(() => {
    if (!isLoggedIn) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') alVolverALaPestanaRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isLoggedIn]);

  // Recibe lo que hay escrito en los campos al enviar: un gestor de contraseñas
  // puede rellenarlos sin avisar a React y el estado quedaría vacío.
  const handleLogin = async (usuarioCampo = usuario, passwordCampo = password) => {
    const usuarioFinal = String(usuarioCampo || '').trim();
    const passwordFinal = String(passwordCampo || '');
    if (!usuarioFinal || !passwordFinal) {
      setLoginError('Escribe tu usuario y tu contraseña.');
      return;
    }
    try {
      setLoginError('');
      setUsuario(usuarioFinal);
      setPassword(passwordFinal);
      getOrCreateSessionId();
      getOrCreateDeviceId();
      const data = await authAPI.login(usuarioFinal, passwordFinal);
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
      const mensaje = error.message || 'Error de autenticación';
      setLoginError(/payload invalido/i.test(mensaje)
        ? 'Usuario o contraseña con formato no válido: el usuario tiene al menos 3 caracteres y la contraseña al menos 8.'
        : mensaje);
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
    // Catálogo e historial guardados son del usuario que sale.
    limpiarCaches();
    queryClient.clear();
    generacionSesionRef.current += 1;
    ultimaCargaProductosRef.current = null;
    ultimaCargaStockRef.current = null;
    ultimoCrudoProductosRef.current = null;
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
    // El dashboard también lo usa (margen del mes, seguimiento) y el CRM (pestaña Cotizaciones, insignia).
    if (!isLoggedIn || (currentView !== 'historial' && currentView !== 'dashboard' && currentView !== 'crm')) return;
    let cancelled = false;
    const loadHistorial = async () => {
      // Con datos ya cargados no se vuelve a mostrar "Cargando": se refresca en segundo plano.
      if (historial.length === 0) setHistorialLoading(true);
      setHistorialError('');
      try {
        const data = await queryClient.fetchQuery({
          queryKey: [...queryKeys.cotizaciones, 'includeItems'],
          queryFn: () => cotizacionesAPI.getAll({ includeItems: true }),
          // Cambiar entre vistas no vuelve a descargar todo durante 30 s; un cambio
          // (aquí o en el embudo) invalida la consulta y la próxima pasada la trae fresca.
          staleTime: 30 * 1000
        });
        if (!cancelled) setHistorial(data);
      } catch (error) {
        if (!cancelled) setHistorialError('Error obteniendo cotizaciones');
      } finally {
        if (!cancelled) setHistorialLoading(false);
      }
    };
    loadHistorial();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, currentView, crmTab, activasRecarga]);

  // Archivadas (solo admin completo): se piden aparte y solo al mirarlas.
  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'crm' || crmTab !== 'cotizaciones' || historialVista !== 'archivadas') return;
    let cancelled = false;
    const cargar = async () => {
      setArchivadasLoading(true);
      setArchivadasError('');
      try {
        const data = await queryClient.fetchQuery({
          queryKey: [...queryKeys.cotizaciones, 'includeItems', 'archivadas'],
          queryFn: () => cotizacionesAPI.getAll({ includeItems: true, archivadas: true }),
          staleTime: 30 * 1000
        });
        if (!cancelled) setHistorialArchivadas(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setArchivadasError('Error obteniendo cotizaciones archivadas');
      } finally {
        if (!cancelled) setArchivadasLoading(false);
      }
    };
    cargar();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, isFullAdmin, currentView, crmTab, historialVista, archivadasRecarga]);

  // Admin completo: el historial vive en CRM › Cotizaciones. /historial, Alt+3 y
  // cualquier "ir al historial" terminan allí, con la cotización pedida abierta.
  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'historial') return;
    const params = new URLSearchParams({ tab: 'cotizaciones' });
    if (expandedHistorialId) {
      params.set('cotizacion', String(expandedHistorialId));
      enfocarCotizacionRef.current = expandedHistorialId;
    }
    recordarDestinoCrm('cotizaciones', expandedHistorialId || null);
    setCrmTab('cotizaciones');
    setCurrentView('crm');
    navigate(`/crm?${params.toString()}`, { replace: true });
  }, [isLoggedIn, isFullAdmin, currentView, expandedHistorialId, navigate]);

  // La pestaña del CRM queda en la URL (/crm?tab=…) para volver a ella al recargar.
  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'crm' || location.pathname !== '/crm') return;
    const deseado = crmTab === 'resumen' ? '' : `?tab=${crmTab}`;
    if (location.search !== deseado) navigate(`/crm${deseado}`, { replace: true });
  }, [isLoggedIn, isFullAdmin, currentView, crmTab, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!isLoggedIn || currentView !== 'stock') return;
    loadStockCatalog();
  }, [isLoggedIn, currentView]);

  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'usuarios') return;
    loadUsuarios();
  }, [isLoggedIn, isFullAdmin, currentView]);


  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'usuarios') return;
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
  }, [isLoggedIn, isFullAdmin, currentView, sessionAutoRefresh]);

  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'usuarios' || !selectedSessionUserId) return;
    loadUserActivity(selectedSessionUserId);
  }, [isLoggedIn, isFullAdmin, currentView, selectedSessionUserId]);

  useEffect(() => {
    if (isCotizadorStockAdmin && currentView !== 'cotizador' && currentView !== 'stock' && currentView !== 'cliente') {
      setCurrentView('cotizador');
      return;
    }
    if (isFullAdmin) return;
    if (!canViewDashboard && currentView === 'dashboard') {
      setCurrentView('cotizador');
      return;
    }
    const blockedForClient = new Set(['admin', 'usuarios', 'ordenes', 'compras', 'crm']);
    if (blockedForClient.has(currentView) || (currentView === 'ia' && !canViewIA)) {
      setCurrentView('cotizador');
      return;
    }
  }, [isFullAdmin, isCotizadorStockAdmin, currentView, canViewDashboard, canViewIA]);

  useEffect(() => {
    if (isLoggedIn && location.pathname === '/login') {
      navigate('/dashboard', { replace: true });
      return;
    }
    const nextView = ROUTE_TO_VIEW[location.pathname];
    if (!nextView) return;
    if (isCotizadorStockAdmin && nextView !== 'cotizador') {
      if (location.pathname !== '/cotizador') {
        navigate('/cotizador', { replace: true });
      }
      if (currentView !== 'cotizador') setCurrentView('cotizador');
      return;
    }
    if (!isFullAdmin && nextView === 'dashboard' && !canViewDashboard) {
      if (location.pathname !== '/cotizador') {
        navigate('/cotizador', { replace: true });
      }
      if (currentView !== 'cotizador') setCurrentView('cotizador');
      return;
    }
    if (!isFullAdmin && ADMIN_VIEWS.has(nextView)) {
      if (location.pathname !== '/cotizador') {
        navigate('/cotizador', { replace: true });
      }
      if (currentView !== 'cotizador') setCurrentView('cotizador');
      return;
    }
    if (nextView !== currentView) {
      setCurrentView(nextView);
    }
  }, [location.pathname, isLoggedIn, isFullAdmin, isCotizadorStockAdmin, canViewDashboard, navigate]);

  // Vista -> ruta. Solo reacciona cuando CAMBIA LA VISTA (clic en el menú, Alt+número,
  // buscador, un botón interno): la ruta se lee de la referencia. Como la página ya no se
  // remonta al cambiar de ruta, si también dependiera de la ruta, al volver atrás en el
  // navegador esta sincronización vería la vista vieja y desharía el viaje.
  useEffect(() => {
    if (!isLoggedIn || !hasRouteSync) return;
    if (!VIEW_TO_ROUTE[currentView]) return;
    // El admin completo no tiene vista Historial: la redirige el efecto de CRM › Cotizaciones.
    if (isFullAdmin && currentView === 'historial') return;
    if (isCotizadorStockAdmin && currentView !== 'cotizador' && currentView !== 'stock' && currentView !== 'cliente') return;
    if (!isFullAdmin && ADMIN_VIEWS.has(currentView)) {
      return;
    }
    if (!canViewDashboard && currentView === 'dashboard') return;
    const targetRoute = VIEW_TO_ROUTE[currentView];
    if (pathnameRef.current !== targetRoute) {
      navigateRef.current(targetRoute, { replace: true });
    }
  }, [currentView, isLoggedIn, isFullAdmin, isCotizadorStockAdmin, canViewDashboard, hasRouteSync]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const onKeyDown = (event) => {
      if (!event.altKey) return;
      const keyMap = {
        '1': canViewDashboard ? 'dashboard' : 'cotizador',
        '2': canViewCotizador ? 'cotizador' : null,
        '3': canViewHistorial ? 'historial' : null,
        '4': canViewStock ? 'stock' : null,
        '5': isFullAdmin ? 'ordenes' : null,
        '6': isFullAdmin ? 'crm' : null
      };
      const target = keyMap[event.key];
      if (!target) return;
      event.preventDefault();
      setCurrentView(target);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLoggedIn, isFullAdmin, canViewDashboard, canViewCotizador, canViewHistorial, canViewStock]);

  useEffect(() => {
    if (!user || isAdmin) return;
    setCliente(prev => ({
      ...prev,
      nombre: prev.nombre && prev.nombre !== 'N/A' ? prev.nombre : (user.nombre || user.usuario || ''),
      empresa: prev.empresa && prev.empresa !== 'N/A' ? prev.empresa : (user.empresa || '')
    }));
  }, [user, isAdmin]);

  useEffect(() => {
    setOwnPartnerCategory(user?.partner_category || DEFAULT_AXIS_PARTNER);
  }, [user]);

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleLogin(); };

  // Cargar Excel
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target.result;
        const XLSX = await getXLSX();
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
        notify(`Se importaron ${result.productos.length} productos correctamente`);
      } catch (error) {
        console.error('Error:', error);
        notify('Error al procesar el archivo');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const downloadTemplate = async () => {
    const headers = [{
      Marca: '',
      SKU: '',
      MPN: '',
      Descripción: '',
      'Precio Disty': '',
      'GP (%)': '',
      'Tiempo Entrega': ''
    }];
    const XLSX = await getXLSX();
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
      notify(`Sync OK (${adminOrigin}): ${summary}`);
    } catch (error) {
      notify(error.message || 'Error sincronizando productos');
    } finally {
      setSaving(false);
    }
  };

  // CRUD Productos
  const handleAddProduct = async () => {
    if (!newProduct.sku && !newProduct.desc) return notify('Ingrese SKU o Descripción');
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
      notify('Error al guardar producto');
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
      notify('Error al actualizar producto');
    } finally {
      setSaving(false);
    }
  };

  const deleteProductosByIds = async (ids, successMessage) => {
    const validIds = ids.filter(id => id !== undefined && id !== null && id !== '');
    if (validIds.length === 0) {
      notify('No hay IDs válidos para eliminar.');
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
        notify('Se eliminaron ' + (validIds.length - failed.length) + ' productos. Fallaron ' + failed.length + '.' + detail);
      } else {
        notify(successMessage);
      }
    } catch (error) {
      console.error('Error eliminando productos:', error);
      notify(error.message || 'Error al eliminar productos');
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
    // El backend ya descuenta lo asignado en OSO: 0 disponible no es entrega inmediata.
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return '';
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
      tiempoCatalogo: producto.tiempo,
      tiempo: getStockEntregaText(producto.mpn) || producto.tiempo
    }]);
  };

  // Entrega de cada línea según stock disponible y cantidad: si el pedido supera el
  // stock, se agrega "| diferencia <ETA>". Solo toca entregas generadas por el sistema.
  useEffect(() => {
    setCotizacion(prev => {
      let cambio = false;
      const next = prev.map(item => {
        const eta = item.tiempoCatalogo ?? productos.find(p => p.id === item.id)?.tiempo ?? '';
        if (!esEntregaAutomatica(item.tiempo, eta)) return item;
        const texto = textoEntregaLinea({
          disponible: stockByMpn[normalizeLookupKey(item.mpn)],
          cantidad: item.cant,
          etaCatalogo: eta
        });
        if (!texto || texto === item.tiempo) return item;
        cambio = true;
        return { ...item, tiempo: texto };
      });
      return cambio ? next : prev;
    });
  }, [cotizacion, stockByMpn, productos]);

  const applyPartnerCategoryToAxis = (category) => {
    setCotizacionPartnerCategory(category);
    setCotizacion(items => items.map(item => (
      (item.origen || 'QNAP') === 'AXIS' ? { ...item, partnerCategory: category } : item
    )));
  };

  const syncCotizacionWithCatalogPrices = (catalogItems) => {
    if (!Array.isArray(catalogItems) || catalogItems.length === 0) return;
    const byId = new Map(catalogItems.map(item => [Number(item.id), item]));
    setCotizacion(prev => prev.map(item => {
      // Una línea de quote no está en el catálogo: su costo viene del quote y no se repone.
      if (item.deQuote || esOrigenQuote(item.origen)) return item;
      const match = byId.get(Number(item.id));
      if (!match) return item;
      return {
        ...item,
        precio: Number.isFinite(Number(match.precio)) ? Number(match.precio) : item.precio,
        precio_cliente: Number.isFinite(Number(match.precio_cliente)) ? Number(match.precio_cliente) : item.precio_cliente,
        costoChile: match.costoChile ?? null
      };
    }));
  };

  const handleCotizacionPartnerCategoryChange = async (category) => {
    const previousCategory = cotizacionPartnerCategory;
    applyPartnerCategoryToAxis(category);
    if (!isVentasUser) return;
    try {
      setUpdatingCotizacionPartner(true);
      const updated = await usuariosAPI.updateOwnPartnerCategory(category);
      const nextPartnerCategory = updated?.partner_category || category;
      setUser(prev => {
        if (!prev) return prev;
        const next = { ...prev, partner_category: nextPartnerCategory };
        localStorage.setItem('user', JSON.stringify(next));
        return next;
      });
      const refreshedCatalog = await loadProductos(user?.role);
      syncCotizacionWithCatalogPrices(refreshedCatalog);
    } catch (error) {
      applyPartnerCategoryToAxis(previousCategory);
      notify(error.message || 'No se pudo actualizar la categoría de partner');
    } finally {
      setUpdatingCotizacionPartner(false);
    }
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

  // Quitar no pide confirmación: se puede deshacer desde el aviso o con Ctrl+Z.
  const deshacerQuitada = () => {
    const ultima = quitadasRef.current.pop();
    if (!ultima) return false;
    if (ultima.tipo === 'todo') {
      setCotizacion(ultima.items);
      setCurrentQuoteNumero(ultima.numero);
    } else {
      setCotizacion(c => {
        if (c.some(x => x.id === ultima.item.id)) return c;
        const next = [...c];
        next.splice(Math.min(ultima.index, next.length), 0, ultima.item);
        return next;
      });
    }
    notify('Restaurado', { tipo: 'ok', duracion: 2000 });
    return true;
  };

  // Cambios desde la tabla del carrito. El precio unitario se traduce a GP de la línea,
  // así el precio que escribes queda fijo aunque cambie el GP global.
  const cambiarLineaCarrito = (id, campo, valor) => {
    if (campo === 'precioUnitario') {
      const item = cotizacion.find(x => x.id === id);
      const precio = Number(valor);
      if (!item || !(precio > 0)) return;
      const gpPct = (1 - margenItem(item).costo / precio) * 100;
      if (!Number.isFinite(gpPct) || gpPct >= 99.9) return;
      updateItem(id, 'gpOverride', String(Math.round(gpPct * 10000) / 10000));
      return;
    }
    if (campo === 'gpOverride' && valor !== '' && Number(valor) >= 99.9) return;
    updateItem(id, campo, valor);
  };

  const moverLineaCarrito = (indice, delta) => {
    setCotizacion(prev => {
      const destino = indice + delta;
      if (destino < 0 || destino >= prev.length) return prev;
      const next = [...prev];
      [next[indice], next[destino]] = [next[destino], next[indice]];
      return next;
    });
  };

  const removeItem = (id) => {
    const index = cotizacion.findIndex(x => x.id === id);
    if (index < 0) return;
    const item = cotizacion[index];
    quitadasRef.current = [...quitadasRef.current.slice(-19), { tipo: 'linea', item, index }];
    setCotizacion(c => c.filter(x => x.id !== id));
    notify(`Quitaste ${item.sku || item.mpn || 'la línea'}`, { tipo: 'info', accion: { label: 'Deshacer', onClick: deshacerQuitada } });
  };
  const clearCotizacion = () => {
    if (cotizacion.length === 0) return;
    quitadasRef.current = [...quitadasRef.current.slice(-19), { tipo: 'todo', items: cotizacion, numero: currentQuoteNumero }];
    setCotizacion([]);
    setCurrentQuoteNumero(null);
    notify(`Carrito vacío (${cotizacion.length} línea${cotizacion.length === 1 ? '' : 's'} quitadas)`, {
      tipo: 'info',
      accion: { label: 'Deshacer', onClick: deshacerQuitada }
    });
  };

  // Agrega varias líneas de una vez (lista pegada, duplicar). Suma cantidades si ya estaban.
  const agregarVarios = (entradas) => {
    setCotizacion(c => {
      const next = [...c];
      for (const { producto, cantidad } of entradas) {
        const cant = Math.max(1, parseInt(cantidad, 10) || 1);
        const idx = next.findIndex(x => x.id === producto.id);
        if (idx >= 0) {
          next[idx] = { ...next[idx], cant: next[idx].cant + cant };
        } else {
          next.push({
            ...producto,
            cant,
            partnerCategory: producto.origen === 'AXIS' ? cotizacionPartnerCategory : undefined,
            rebateProject: producto.origen === 'AXIS' ? 0 : undefined,
            gpOverride: null,
            tiempoCatalogo: producto.tiempo,
            tiempo: getStockEntregaText(producto.mpn) || producto.tiempo
          });
        }
      }
      return next;
    });
  };

  // Los quotes de fabricante son solo del admin completo (el admin de stock está limitado a AXIS).
  const puedeCargarQuotes = isAdmin && !isCotizadorStockAdmin;

  // Líneas de un quote de fabricante: cada una entra como línea NUEVA (nunca se fusiona con otra,
  // aunque repita MPN). Margen propio vacío: usa el 8 % de las líneas de quote.
  // `carritoVacio`: el carrito se acaba de vaciar en este mismo gesto (duplicar), así que los ids
  // del carrito anterior no cuentan. `silencioso`: quien llama da su propio aviso.
  const agregarLineasDeQuote = (productos, { silencioso = false, carritoVacio = false } = {}) => {
    if (!puedeCargarQuotes) return;
    const lista = (Array.isArray(productos) ? productos : []).filter(Boolean);
    if (lista.length === 0) return;
    const usados = new Set(carritoVacio ? [] : cotizacion.map(x => x.id));
    const nuevas = lista.map(producto => {
      const { cantidadSugerida, ...resto } = producto;
      // El id es la clave de la línea (editar, quitar, mover): si ya existe, se hace único.
      let id = resto.id;
      for (let k = 2; usados.has(id); k += 1) id = `${resto.id}~${k}`;
      usados.add(id);
      return {
        ...resto,
        id,
        cant: Math.max(1, parseInt(cantidadSugerida, 10) || 1),
        partnerCategory: undefined,
        rebateProject: undefined,
        gpOverride: null,
        tiempoCatalogo: resto.tiempo,
        tiempo: resto.tiempo
      };
    });
    setCotizacion(c => [...c, ...nuevas]);
    if (silencioso) return;
    notify(`Quote: ${nuevas.length} línea${nuevas.length === 1 ? '' : 's'} agregada${nuevas.length === 1 ? '' : 's'} al carrito`, { tipo: 'ok' });
  };

  const agregarListaPegada = (entradas, { sinResolver = 0, noEncontradas = [] } = {}) => {
    agregarVarios(entradas);
    setPegarListaTexto(null);
    const partes = [`Agregados ${entradas.length} producto${entradas.length === 1 ? '' : 's'}`];
    if (sinResolver) partes.push(`${sinResolver} ambiguo${sinResolver === 1 ? '' : 's'} sin elegir`);
    if (noEncontradas.length) partes.push(`No están en el catálogo: ${noEncontradas.slice(0, 4).join(', ')}${noEncontradas.length > 4 ? '…' : ''}`);
    notify(partes.join('. '), { tipo: noEncontradas.length || sinResolver ? 'info' : 'ok', duracion: noEncontradas.length ? 9000 : 4000 });
    catalogInputRef.current?.focus();
  };

  // Margen de una línea del carrito: precio = costo / (1 - gp), así que costo = precio · (1 - gp).
  const margenItem = (item) => {
    const precio = calcularPrecioClienteItem(item);
    const gp = gpDeLinea(item, gpGlobales);
    const costo = precio * (1 - gp);
    return { precio, costo, gpPct: gp * 100, margenTotal: (precio - costo) * item.cant };
  };
  const totalCotizacion = useMemo(
    () => cotizacion.reduce((t, i) => t + calcularPrecioClienteItem(i) * i.cant, 0),
    [cotizacion, calcParams, cotizacionGpGlobalQnap, cotizacionGpGlobalAxis]
  );

  // Resumen de margen del carrito (solo se muestra a quien ve costos).
  const resumenMargenCarrito = useMemo(() => {
    if (!isAdmin || cotizacion.length === 0) return null;
    let venta = 0;
    let costo = 0;
    for (const item of cotizacion) {
      const m = margenItem(item);
      venta += m.precio * item.cant;
      costo += m.costo * item.cant;
    }
    return {
      venta,
      costo,
      margen: venta - costo,
      gpPct: venta > 0 ? ((venta - costo) / venta) * 100 : null,
      origenes: cotizacion.map(i => i.origen || 'QNAP')
    };
  }, [cotizacion, calcParams, cotizacionGpGlobalQnap, cotizacionGpGlobalAxis, isAdmin]);

  // Marca visual de la fila en el carrito: margen bajo el mínimo (solo admin) o SKU por crear.
  const alertaLineaCarrito = (item) => {
    if (isAdmin && estadoMargen(margenItem(item).gpPct, item.origen, configMargen) === 'bajo_piso') return 'bajo_piso';
    if (normalizeLookupKey(item.sku).replace(/\s+/g, '') === 'tocreate' || !String(item.sku || '').trim()) return 'por_crear';
    return null;
  };

  // Lo que conviene revisar antes de generar (no bloquea).
  const problemasEnvio = () => {
    const nombre = (item) => `${item.sku && item.sku !== 'To Create' ? item.sku : item.mpn} · ${item.desc || ''}`;
    const bajoPiso = isAdmin
      ? cotizacion
        .map(item => ({ item, m: margenItem(item) }))
        .filter(({ item, m }) => estadoMargen(m.gpPct, item.origen, configMargen) === 'bajo_piso')
        .map(({ item, m }) => ({ id: item.id, nombre: nombre(item), detalle: formatoPct(m.gpPct) }))
      : [];
    const porCrear = cotizacion
      .filter(item => normalizeLookupKey(item.sku).replace(/\s+/g, '') === 'tocreate' || !String(item.sku || '').trim())
      .map(item => ({ id: item.id, nombre: nombre(item) }));
    const hayStock = Object.keys(stockByMpn || {}).length > 0;
    const sinStock = hayStock
      ? cotizacion
        .filter(item => !getStockEntregaText(item.mpn))
        .map(item => ({ id: item.id, nombre: nombre(item), detalle: `×${item.cant}` }))
      : [];
    return { bajoPiso, porCrear, sinStock };
  };

  const generarCotizacion = ({ saltarRevision = false } = {}) => {
    if (cotizacion.length === 0) return;
    if (!saltarRevision) {
      const p = problemasEnvio();
      // Sin stock es lo normal en importación: se muestra como contexto, pero solo
      // abre la revisión un margen bajo el piso o un SKU por crear.
      if (p.bajoPiso.length || p.porCrear.length) {
        setRevisionAbierta(true);
        return;
      }
    }
    setRevisionAbierta(false);
    setCurrentView('cliente');
  };

  // Guardar cotización
  // Tras cualquier cambio, el próximo ingreso al historial trae datos frescos (no la cache de 30 s).
  const invalidarHistorial = () => queryClient.invalidateQueries({ queryKey: queryKeys.cotizaciones });

  const saveCotizacion = async ({ silent = false } = {}) => {
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
        ? cotizacion.map(item => {
            const origen = item.origen || 'QNAP';
            const gp = gpDeLinea(item, gpGlobales);
            const precioUnitario = calcularPrecioClienteItem(item);
            const isAxisItem = origen === 'AXIS';
            const partnerCategory = isAxisItem ? (item.partnerCategory || cotizacionPartnerCategory) : null;
            return {
              producto_id: item.id,
              marca: item.marca,
              sku: item.sku,
              mpn: item.mpn,
              descripcion: item.desc,
              origen,
              precio_disty: item.precio,
              gp,
              rebate_partner: isAxisItem ? getAxisPartnerRebate(item, partnerCategory) : null,
              rebate_proyecto: isAxisItem ? (parseFloat(item.rebateProject) || 0) : null,
              partner_category: partnerCategory,
              // precio = costo / (1 - gp): se guarda el costo para ver el margen al editar.
              costo_unitario: precioUnitario * (1 - gp),
              cantidad: item.cant,
              precio_unitario: precioUnitario,
              precio_total: precioUnitario * item.cant,
              tiempo_entrega: item.tiempo
            };
          })
        : cotizacion.map(item => ({
            producto_id: item.id,
            cantidad: item.cant
          }));

      const created = await cotizacionesAPI.create({
        cliente: {
          nombre: clientePayload.nombre,
          empresa: clientePayload.empresa,
          email: clientePayload.pid,
          telefono: clientePayload.proyecto
        },
        items,
        total: totalCotizacion
      });

      // Guardamos el número/folio asignado para que el PDF del borrador ya lo muestre.
      const numeroAsignado = created?.cotizacion?.numero ?? null;
      if (numeroAsignado) setCurrentQuoteNumero(numeroAsignado);
      invalidarHistorial();
      if (!silent) notify(`Cotización guardada correctamente${numeroAsignado ? ` (N° ${numeroAsignado})` : ''}`);
      return created?.cotizacion || null;
    } catch (error) {
      notify(error.message || 'Error al guardar cotización');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const loadUsuarios = async () => {
    try {
      setUsuariosLoading(true);
      setUsuariosError('');
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.usuarios,
        queryFn: () => usuariosAPI.getAll(),
        staleTime: 0
      });
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

  const loadDashboardOrdenes = async () => {
    try {
      const [data, metaRows] = await Promise.all([
        osoAPI.getOrders(),
        boMetaAPI.getAll()
      ]);
      const { orders, boMeta } = procesarCargaOso(data, metaRows);
      setDashboardOrders(orders);
      setDashboardBoMeta(boMeta);
    } catch {
      // el dashboard sigue con lo que ya tenía
    }
  };

  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'dashboard') return;
    let cancelled = false;
    const loadDashboardMetrics = async () => {
      try {
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.cotizaciones,
          queryFn: () => cotizacionesAPI.getAll(),
          staleTime: 0
        });
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        if (!cancelled) setHistorial(rows);
      } catch (_) {
        if (!cancelled) setHistorial([]);
      }
      await Promise.all([loadUsuarios(), loadDashboardOrdenes()]);
    };
    loadDashboardMetrics();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, isFullAdmin, currentView]);

  useEffect(() => {
    if (!isLoggedIn || !isFullAdmin || currentView !== 'dashboard') return;
    let cancelled = false;
    productosAPI.getSyncStatus()
      .then((data) => { if (!cancelled) setSyncStatus(data); })
      .catch(() => { if (!cancelled) setSyncStatus(null); });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, isFullAdmin, currentView]);

  // Drawer móvil: cerrar con Escape y bloquear el scroll del fondo mientras está abierto.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentView]);

  // Al cambiar de vista se cierra todo lo que estaba abierto ENCIMA de la vista. Antes lo
  // hacía el remontaje de la página al cambiar de ruta; ahora la página persiste y hay que
  // hacerlo a propósito. Filtros, búsquedas, paginación y filas expandidas NO se tocan.
  useEffect(() => {
    if (vistaAnteriorRef.current === currentView) return;
    vistaAnteriorRef.current = currentView;
    setPaletteOpen(false);
    setAtajosAbiertos(false);
    setRevisionAbierta(false);
    setQuoteAbierto(false);
    setEditorCotizacionId(null);
    setVersionesDe(null);
    setPerdidaDe(null);
    setArchivarFechaAbierto(false);
    setCompraPreviewCot(null);
    setProjectRegistroModal(null);
    if (conservarPegarListaRef.current) conservarPegarListaRef.current = false;
    else setPegarListaTexto(null);
  }, [currentView]);

  // Navegación restringida por usuario: si cae en una vista fuera de su lista
  // (p. ej. dashboard al loguearse), lo llevamos al cotizador. 'cliente' es la
  // vista interna del flujo de cotización y se permite siempre.
  useEffect(() => {
    if (!isLoggedIn || !navRestriction) return;
    if (currentView === 'cliente') return;
    if (!navRestriction.includes(currentView)) {
      setCurrentView('cotizador');
    }
  }, [isLoggedIn, navRestriction, currentView]);

  // Atajos globales: Ctrl+K / Cmd+K alterna el buscador rápido y Ctrl+M / Cmd+M
  // el índice de navegación. Funcionan escribiendo dentro de un campo, porque son
  // con modificador y no compiten con el texto.
  useEffect(() => {
    if (!isLoggedIn) return;
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const tecla = String(e.key).toLowerCase();
      if (tecla === 'k') {
        e.preventDefault();
        setPaletteOpen(open => !open);
      } else if (tecla === 'm') {
        e.preventDefault();
        // Si el buscador rápido está abierto, el índice lo reemplaza.
        setPaletteOpen(false);
        setMobileMenuOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLoggedIn]);

  // Atajos de uso diario. El manejador se renueva en cada render (ref) para
  // leer siempre el estado actual sin re-suscribir el listener.
  const atajosRef = useRef(null);
  atajosRef.current = (e) => {
    if (!isLoggedIn || editorCotizacionId || pegarListaTexto !== null || revisionAbierta) return;
    const el = e.target;
    const escribiendo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 'Enter' && currentView === 'cotizador' && cotizacion.length > 0) {
      e.preventDefault();
      generarCotizacion();
      return;
    }
    if (escribiendo) return;
    if (ctrl && String(e.key).toLowerCase() === 'z' && !e.shiftKey && currentView === 'cotizador') {
      if (deshacerQuitada()) e.preventDefault();
      return;
    }
    if (ctrl || e.altKey) return;
    if (e.key === '?') {
      e.preventDefault();
      setAtajosAbiertos(v => !v);
      return;
    }
    if (e.key === '/' && canViewCotizador && currentView !== 'crm') {
      e.preventDefault();
      if (currentView !== 'cotizador') setCurrentView('cotizador');
      setTimeout(() => catalogInputRef.current?.focus(), 50);
      return;
    }
    const enListaCotizaciones = currentView === 'historial' || (currentView === 'crm' && crmTab === 'cotizaciones');
    if (enListaCotizaciones && expandedHistorialId) {
      if (document.querySelector('[role="dialog"]')) return;
      const cot = historialBase.find(c => c.id === expandedHistorialId);
      if (!cot) return;
      const tecla = String(e.key).toLowerCase();
      if (tecla === 'e' && isFullAdmin && historialVista !== 'archivadas') {
        e.preventDefault();
        setEditorCotizacionId(cot.id);
      } else if (tecla === 'p') {
        e.preventDefault();
        exportHistorialPdf(cot);
      } else if (tecla === 'd' && canViewCotizador) {
        e.preventDefault();
        duplicarCotizacion(cot);
      }
    }
  };
  useEffect(() => {
    const onKeyDown = (e) => atajosRef.current?.(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    if (!confirm('Cerrar esta sesión?')) return;
    try {
      await sesionesAPI.revoke(sessionId);
      await loadActiveSessions({ silent: true });
      await loadUserActivity(selectedSessionUserId);
    } catch (error) {
      notify(error.message || 'Error revocando sesión');
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
      notify(`Sync OK: ${qnapSummary} ${axisSummary}`);
    } catch (error) {
      notify(error.message || 'Error sincronizando productos');
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
      notify(`Sync OK: ${summary}`);
    } catch (error) {
      notify(error.message || 'Error sincronizando productos');
    } finally {
      setSaving(false);
    }
  };

  const exportCotizacionExcel = async () => {
    if (cotizacion.length === 0) {
      notify('No hay productos para exportar');
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
    const XLSX = await getXLSX();
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
      notify('No hay productos para exportar');
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

  const buildPdfPayloadFromCurrentQuote = () => {
    const items = cotizacion.map(item => {
      const cantidad = parseInt(item.cant || 1, 10) || 1;
      const precioUnitario = Number(calcularPrecioClienteItem(item) || 0);
      return {
        marca: item.marca || '',
        cantidad,
        sku: item.sku || '',
        mpn: item.mpn || '',
        descripcion: item.desc || '',
        precio_unitario: precioUnitario,
        precio_total: Number((precioUnitario * cantidad).toFixed(2)),
        tiempo_entrega: item.tiempo || ''
      };
    });
    return {
      created_at: new Date().toISOString(),
      numero: currentQuoteNumero ?? null,
      usuario_role: isCotizadorStockAdmin ? COTIZADOR_STOCK_ADMIN_ROLE : (isAdmin ? 'admin' : 'client'),
      cliente: {
        nombre: cliente.nombre || '',
        empresa: cliente.empresa || '',
        pid: cliente.pid || '',
        proyecto: cliente.proyecto || ''
      },
      items,
      total: Number(totalCotizacion || 0)
    };
  };

  const buildPdfPayloadFromHistorial = (cot) => {
    const items = Array.isArray(cot?.items) ? cot.items : [];
    return {
      created_at: cot?.created_at || new Date().toISOString(),
      numero: cot?.numero ?? null,
      usuario_role: cot?.usuario_role || (isCotizadorStockAdmin ? COTIZADOR_STOCK_ADMIN_ROLE : (isAdmin ? 'admin' : 'client')),
      cliente: {
        nombre: cot?.cliente_nombre || '',
        empresa: cot?.cliente_empresa || '',
        pid: cot?.cliente_email || '',
        proyecto: cot?.cliente_telefono || ''
      },
      items: items.map(item => {
        const cantidad = parseInt(item?.cantidad || item?.cant || 1, 10) || 1;
        const precioUnitario = Number(item?.precio_unitario || 0);
        const precioTotal = Number.isFinite(Number(item?.precio_total))
          ? Number(item.precio_total)
          : Number((precioUnitario * cantidad).toFixed(2));
        return {
          marca: item?.marca || '',
          cantidad,
          sku: item?.sku || '',
          mpn: item?.mpn || '',
          descripcion: item?.descripcion || item?.desc || '',
          precio_unitario: precioUnitario,
          precio_total: precioTotal,
          tiempo_entrega: item?.tiempo_entrega || item?.tiempo || ''
        };
      }),
      total: Number(cot?.total || 0)
    };
  };

  const exportCotizacionPdf = async () => {
    if (cotizacion.length === 0) {
      notify('No hay productos para exportar');
      return;
    }
    try {
      setSaving(true);
      // Si la cotización aún no tiene folio, la guardamos para asignarle número antes del PDF.
      let numero = currentQuoteNumero;
      if (!numero) {
        const saved = await saveCotizacion({ silent: true });
        numero = saved?.numero ?? null;
      }
      const folio = numero ? `COT-${numero}_` : '';
      const filenameBase = `${folio}${buildExportFilename(new Date(), cliente.proyecto, cliente.empresa)}`;
      const payload = buildPdfPayloadFromCurrentQuote();
      payload.numero = numero ?? payload.numero;
      await cotizacionesAPI.downloadPdf(payload, filenameBase);
    } catch (error) {
      notify(error.message || 'Error exportando PDF');
    } finally {
      setSaving(false);
    }
  };

  const exportHistorialPdf = async (cot) => {
    try {
      setSaving(true);
      const folio = cot?.numero ? `COT-${cot.numero}_` : '';
      const filenameBase = `${folio}${buildExportFilename(cot?.created_at || new Date(), cot?.cliente_telefono, cot?.cliente_empresa, cot?.version)}`;
      const payload = buildPdfPayloadFromHistorial(cot);
      // El servidor nombra el archivo con la version real de la cotizacion.
      payload.version = cot?.version || 1;
      await cotizacionesAPI.downloadPdf(payload, filenameBase);
    } catch (error) {
      notify(error.message || 'Error exportando PDF');
    } finally {
      setSaving(false);
    }
  };

  const exportHistorialExcel = async (cot) => {
    const fechaKey = getDateKey(cot.created_at || new Date());
    const filenameBase = buildExportFilename(cot.created_at || new Date(), cot.cliente_telefono, cot.cliente_empresa, cot.version);
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
    const XLSX = await getXLSX();
    const ws = XLSX.utils.aoa_to_sheet([...headerRows, tableHeader, ...tableRows, [], totalRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion');
    XLSX.writeFile(wb, `${filenameBase}.xlsx`);
  };

  const exportStockExcel = async () => {
    const rows = filteredStockCatalog.map(item => ([
      item.brand || '',
      item.name || '',
      item.sku || '',
      item.mpn || '',
      formatStockQuantity(item.quantity) || '',
      ...(isFullAdmin ? [precioSistemaDe(item, margenSistema) ?? ''] : []),
      item.origin || '',
      item.imageUrl || ''
    ]));
    const header = ['Marca', 'Descripción', 'SKU', 'MPN', 'Disponible', ...(isFullAdmin ? ['Precio sistema (USD)'] : []), 'Origen', 'Imagen'];
    const XLSX = await getXLSX();
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock');
    const filenameBase = `stock-${getDateKeyCompact(new Date()) || 'export'}`;
    XLSX.writeFile(wb, `${filenameBase}.xlsx`);
  };

  const exportStockPdf = async () => {
    const filenameBase = `stock-${getDateKeyCompact(new Date()) || 'export'}`;
    await downloadPdfFromElement(stockExportRef.current, filenameBase);
  };

  const handleProjectUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await getXLSX();
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
              tiempoCatalogo: match.tiempo,
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
      notify(`Carga completa. Agregados: ${added}, omitidos: ${skipped}.`);
    } catch (error) {
      console.error('Error leyendo proyecto:', error);
      notify('Error leyendo archivo de proyecto');
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
    const clienteTerm = isAdmin ? '' : historialFilters.cliente.trim().toLowerCase();
    const pidTerm = isAdmin ? '' : historialFilters.pid.trim().toLowerCase();
    const proyectoTerm = isAdmin ? '' : historialFilters.proyecto.trim().toLowerCase();
    const productoTerm = isAdmin ? '' : historialFilters.producto.trim().toLowerCase();
    const etapasSeleccionadas = historialFilters.etapas || [];
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
    return historialBase.filter(cot => {
      if (!isOwnCotizacion(cot)) return false;
      if (etapasSeleccionadas.length > 0 && !etapasSeleccionadas.includes(etapaDeCotizacion(cot))) return false;
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
      if (globalQuery) {
        const textSources = [
          cot.cliente_nombre,
          cot.cliente_empresa,
          cot.cliente_email,
          cot.cliente_telefono,
          ...(cot.items || []).map(item => `${item.sku || ''} ${item.mpn || ''} ${item.descripcion || ''}`)
        ];
        const matchesGlobal = textSources.some(v => (v || '').toString().toLowerCase().includes(globalQuery));
        if (!matchesGlobal) return false;
      }
      return true;
    });
  }, [historialBase, historialFilters, isAdmin, user, globalQuery]);

  const historialCounts = useMemo(() => {
    const clienteQuotes = historial.filter(cot => isClienteQuote(cot)).length;
    const registroQuotes = historial.filter(cot => isClienteQuote(cot) && hasProjectRegistro(cot)).length;
    const registroPendientes = historial.filter(cot => isClienteQuote(cot) && hasProjectRegistro(cot) && !dismissedRegistroById[cot.id]).length;
    return { clienteQuotes, registroQuotes, registroPendientes };
  }, [historial, dismissedRegistroById]);

  // Cotizaciones enviadas que llevan más de 7 días sin respuesta: lo que hay que seguir.
  const DIAS_SEGUIMIENTO = 7;
  const seguimiento = useMemo(() => {
    const limite = Date.now() - DIAS_SEGUIMIENTO * 86400000;
    return historial
      .filter(cot => normalizeEstado(cot.estado) === 'enviada' && new Date(cot.created_at).getTime() < limite)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(cot => ({
        id: cot.id,
        folio: cot.numero || cot.id,
        empresa: cot.cliente_empresa || 'Sin empresa',
        proyecto: cot.cliente_telefono || '',
        total: Number(cot.total) || 0,
        dias: Math.floor((Date.now() - new Date(cot.created_at).getTime()) / 86400000)
      }));
  }, [historial]);

  // Abre una cotización en la lista: CRM › Cotizaciones (admin completo) o Mis cotizaciones.
  const abrirCotizacionEnHistorial = (id) => {
    const numero = Number(id) || null;
    if (isFullAdmin && historialVista !== 'activas') cambiarVistaHistorial('activas');
    setExpandedHistorialId(numero);
    enfocarCotizacionRef.current = numero;
    if (isFullAdmin) {
      setCrmTab('cotizaciones');
      // Ya dentro del CRM basta con cambiar de pestaña.
      if (currentView === 'crm') return;
    }
    setCurrentView('historial');
  };

  const dashboardKpis = useMemo(() => {
    if (!isFullAdmin) {
      return [
        { label: 'Cotizaciones', value: historial.length, hint: 'Historial total' },
        { label: 'Productos', value: productos.length, hint: 'Catálogo activo' },
        { label: 'Órdenes', value: dashboardOrders.length, hint: 'Órdenes OSO' },
        { label: 'Usuarios', value: usuarios.length, hint: 'Usuarios registrados' }
      ];
    }
    const ahora = new Date();
    const delMes = historial.filter(cot => {
      const d = new Date(cot.created_at);
      return d.getFullYear() === ahora.getFullYear() && d.getMonth() === ahora.getMonth();
    });
    const montoMes = delMes.reduce((sum, cot) => sum + (Number(cot.total) || 0), 0);
    let ventaConCosto = 0;
    let margenMes = 0;
    for (const cot of delMes) {
      const m = margenCotizacion(cot);
      if (!m) continue;
      margenMes += m.margen;
      ventaConCosto += m.venta;
    }
    const gpMes = ventaConCosto > 0 ? (margenMes / ventaConCosto) * 100 : null;
    const hace90 = Date.now() - 90 * 86400000;
    const cerradas = historial.filter(cot => new Date(cot.created_at).getTime() >= hace90 && ['aprobada', 'rechazada'].includes(normalizeEstado(cot.estado)));
    const aprobadas = cerradas.filter(cot => normalizeEstado(cot.estado) === 'aprobada').length;
    return [
      { label: 'Cotizado este mes', value: formatCurrency(montoMes), hint: `${delMes.length} cotizaci${delMes.length === 1 ? 'ón' : 'ones'}` },
      { label: 'Margen del mes', value: formatCurrency(margenMes), hint: gpMes === null ? 'Sin líneas con costo' : `GP ${formatoPct(gpMes)} sobre lo cotizado con costo` },
      { label: 'Tasa de cierre', value: cerradas.length ? `${Math.round((aprobadas / cerradas.length) * 100)}%` : '—', hint: `${aprobadas} ganadas de ${cerradas.length} cerradas en 90 días` },
      { label: 'Sin respuesta', value: seguimiento.length, hint: `Cotizadas hace más de ${DIAS_SEGUIMIENTO} días`, onClick: seguimiento.length ? () => setCurrentView('historial') : undefined }
    ];
  }, [isFullAdmin, historial, productos.length, dashboardOrders.length, usuarios.length, seguimiento]);

  // Sin borradores: el dashboard es otra instancia y nunca tiene ediciones sin guardar.
  const invoiceMonthOptions = useMemo(
    () => opcionesMesFacturacion(dashboardBoMeta, {}),
    [dashboardBoMeta]
  );

  const dashboardBilling = useMemo(() => {
    const getOsoMeta = (bo) => metaDeOrden(dashboardBoMeta, {}, bo);
    const getBoInvoiceMonth = (bo) => mesFacturacionDeBo(dashboardBoMeta, {}, bo);
    const getBoInvoiceWeek = (bo) => semanaFacturacionDeBo(dashboardBoMeta, {}, bo);
    const getAxisMontoNumber = (bo, line) => (!bo || !line ? 0 : numeroMonto(undefined, line, 'montoAxis'));
    const getIntcomexMontoNumber = (bo, line) => (!bo || !line ? 0 : numeroMonto(undefined, line, 'montoIntcomex'));
    const weeks = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Sin sem'];
    const initRows = () => weeks.map(week => ({ week, axis: 0, intcomex: 0, boSummaries: [] }));
    const remainingRows = initRows();
    const invoicedRows = initRows();
    const rowIndexByWeek = weeks.reduce((acc, week, idx) => {
      acc[week] = idx;
      return acc;
    }, {});

    const getWeekLabel = (weekValue) => {
      const week = String(weekValue || '').trim();
      if (['1', '2', '3', '4'].includes(week)) return `Sem ${week}`;
      return 'Sin sem';
    };

    const addRowAmount = (rows, week, axis, intcomex) => {
      const idx = rowIndexByWeek[week] ?? rowIndexByWeek['Sin sem'];
      rows[idx].axis += axis;
      rows[idx].intcomex += intcomex;
    };

    const addBoSummary = (rows, week, summary) => {
      const idx = rowIndexByWeek[week] ?? rowIndexByWeek['Sin sem'];
      rows[idx].boSummaries.push(summary);
    };

    const computeBoAmounts = (order) => {
      return (order?.lines || []).reduce((acc, line) => {
        const qty = Number(line?.orderQty) || 0;
        const axis = getAxisMontoNumber(order?.bo, line) * qty;
        const intcomex = getIntcomexMontoNumber(order?.bo, line) * qty;
        acc.axis += axis;
        acc.intcomex += intcomex;
        return acc;
      }, { axis: 0, intcomex: 0 });
    };

    const ordersByBo = new Map((dashboardOrders || []).map(order => [order.bo, order]));
    const boList = Array.from(new Set([
      ...(dashboardOrders || []).map(order => order.bo),
      ...Object.keys(dashboardBoMeta || {})
    ]));

    const summary = {
      remainingAxis: 0,
      remainingIntcomex: 0,
      invoicedAxis: 0,
      invoicedIntcomex: 0,
      remainingBos: 0,
      invoicedBos: 0,
      remainingWithAmounts: 0,
      invoicedWithAmounts: 0
    };

    boList.forEach((bo) => {
      const month = getBoInvoiceMonth(bo);
      if (!month || month !== dashboardInvoiceMonth) return;
      const order = ordersByBo.get(bo);
      const { axis, intcomex } = computeBoAmounts(order);
      const total = axis + intcomex;
      const hasAmounts = (axis + intcomex) > 0;
      const week = getWeekLabel(getBoInvoiceWeek(bo));
      const isInvoiced = Boolean(getOsoMeta(bo)?.invoiced);
      const customerName = (order?.customerName || getOsoMeta(bo)?.customerName || 'Sin cliente').toString().trim() || 'Sin cliente';
      const boSummary = { bo, customerName, total, axis, intcomex };

      if (isInvoiced) {
        summary.invoicedBos += 1;
        if (hasAmounts) summary.invoicedWithAmounts += 1;
        summary.invoicedAxis += axis;
        summary.invoicedIntcomex += intcomex;
        addRowAmount(invoicedRows, week, axis, intcomex);
        addBoSummary(invoicedRows, week, boSummary);
      } else {
        summary.remainingBos += 1;
        if (hasAmounts) summary.remainingWithAmounts += 1;
        summary.remainingAxis += axis;
        summary.remainingIntcomex += intcomex;
        addRowAmount(remainingRows, week, axis, intcomex);
        addBoSummary(remainingRows, week, boSummary);
      }
    });

    const sortBoSummaries = (rows) => rows.map((row) => ({
      ...row,
      boSummaries: [...row.boSummaries].sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return String(a.bo || '').localeCompare(String(b.bo || ''));
      })
    }));

    return {
      month: dashboardInvoiceMonth,
      monthLabel: formatInvoiceMonthLabel(dashboardInvoiceMonth),
      remainingRows: sortBoSummaries(remainingRows),
      invoicedRows: sortBoSummaries(invoicedRows),
      maxRemainingAxis: Math.max(...remainingRows.map(row => row.axis), 0),
      maxRemainingIntcomex: Math.max(...remainingRows.map(row => row.intcomex), 0),
      maxInvoicedAxis: Math.max(...invoicedRows.map(row => row.axis), 0),
      maxInvoicedIntcomex: Math.max(...invoicedRows.map(row => row.intcomex), 0),
      ...summary
    };
  }, [dashboardOrders, dashboardBoMeta, dashboardInvoiceMonth]);

  const toggleEtapaFilter = (etapa) => {
    setHistorialFilters(prev => {
      const current = new Set(prev.etapas || []);
      if (current.has(etapa)) current.delete(etapa);
      else current.add(etapa);
      return { ...prev, etapas: Array.from(current) };
    });
  };

  const cambiarVistaHistorial = (vista) => {
    if (vista === historialVista) return;
    setHistorialVista(vista);
    setSelectedHistorialIds(new Set());
    setExpandedHistorialId(null);
    setPageByTable(prev => ({ ...prev, historial: 1 }));
  };

  useEffect(() => {
    setSelectedHistorialIds(prev => {
      const validIds = new Set(historialBase.map(cot => cot.id));
      const next = new Set();
      prev.forEach(id => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [historialBase]);

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
      ? '¿Eliminar 1 cotización guardada?'
      : `¿Eliminar ${ids.length} cotizaciones guardadas?`;
    if (!confirm(msg)) return;
    try {
      setSaving(true);
      const results = await Promise.allSettled(ids.map(id => cotizacionesAPI.delete(id)));
      const failed = results.filter(r => r.status === 'rejected');
      setHistorial(prev => prev.filter(cot => !ids.includes(cot.id)));
      setHistorialArchivadas(prev => prev.filter(cot => !ids.includes(cot.id)));
      invalidarHistorial();
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.todo });
      setSelectedHistorialIds(new Set());
      if (failed.length > 0) {
        const firstError = failed[0]?.reason?.message || 'Error eliminando cotizaciones';
        notify(`Se eliminaron ${ids.length - failed.length}. Fallaron ${failed.length}. ${firstError}`);
      }
    } catch (error) {
      notify(error.message || 'Error eliminando cotizaciones');
    } finally {
      setSaving(false);
    }
  };

  const createUsuario = async (formElement = null) => {
    const sourceForm = formElement || nuevoUsuarioFormRef.current;
    const formData = sourceForm ? new FormData(sourceForm) : null;
    const usuarioFromForm = (formData?.get('nuevo_usuario') || '').toString();
    const nombreFromForm = (formData?.get('nuevo_nombre') || '').toString();
    const passwordFromForm = (formData?.get('nuevo_password') || '').toString();

    const usuarioValue = (usuarioFromForm || nuevoUsuario.usuario || '').trim();
    const nombreValue = (nombreFromForm || nuevoUsuario.nombre || '').trim();
    const passwordValue = (passwordFromForm || nuevoUsuario.password || '').toString();

    if (!usuarioValue || !passwordValue.trim()) {
      notify('Usuario y contraseña son requeridos');
      return;
    }

    try {
      setUsuariosLoading(true);
      const payload = {
        usuario: usuarioValue,
        nombre: nombreValue,
        password: passwordValue,
        role: 'client',
        gp: 0.15,
        gp_qnap: 0.15,
        gp_axis: 0.15,
        partner_category: DEFAULT_AXIS_PARTNER,
        intcomex_profile: null,
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
      notify(error.message || 'Error creando usuario');
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
      notify(error.message || 'Error actualizando usuario');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const resetUsuarioPassword = async (userId, newPassword) => {
    if (!newPassword) {
      notify('Ingrese una contraseña');
      return;
    }
    try {
      setUsuariosLoading(true);
      await usuariosAPI.updatePassword(userId, newPassword);
      notify('Contraseña actualizada');
    } catch (error) {
      notify(error.message || 'Error actualizando contraseña');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const updateOwnPassword = async () => {
    if (!accountPasswordCurrent) {
      notify('Ingrese su contraseña actual');
      return;
    }
    if (!accountPassword) {
      notify('Ingrese una contraseña');
      return;
    }
    if (accountPassword !== accountPasswordConfirm) {
      notify('Las contraseñas no coinciden');
      return;
    }
    try {
      setSaving(true);
      await usuariosAPI.updateOwnPassword(accountPasswordCurrent, accountPassword);
      setAccountPasswordCurrent('');
      setAccountPassword('');
      setAccountPasswordConfirm('');
      notify('Contraseña actualizada');
    } catch (error) {
      notify(error.message || 'Error actualizando contraseña');
    } finally {
      setSaving(false);
    }
  };

  const updateOwnPartnerCategory = async () => {
    if (!canEditPartnerCategory) return;
    try {
      setUpdatingOwnPartnerCategory(true);
      const updated = await usuariosAPI.updateOwnPartnerCategory(ownPartnerCategory);
      const nextPartnerCategory = updated?.partner_category || ownPartnerCategory;
      setUser(prev => {
        if (!prev) return prev;
        const next = { ...prev, partner_category: nextPartnerCategory };
        localStorage.setItem('user', JSON.stringify(next));
        return next;
      });
      setCotizacionPartnerCategory(nextPartnerCategory);
      notify('Nivel de partner actualizado');
    } catch (error) {
      notify(error.message || 'Error actualizando nivel de partner');
    } finally {
      setUpdatingOwnPartnerCategory(false);
    }
  };

  const toggleUsuarioActivo = async (target) => {
    const activar = target.activo === false;
    if (!activar && !confirm('Desactivar esta cuenta? Se cerrarán sus sesiones y no podrá iniciar sesión.')) return;
    try {
      setUsuariosLoading(true);
      const updated = await usuariosAPI.setActivo(target.id, activar);
      setUsuarios(prev => prev.map(u => (u.id === target.id ? { ...u, activo: updated.activo } : u)));
      notify(activar ? 'Cuenta activada' : 'Cuenta desactivada');
    } catch (error) {
      notify(error.message || 'Error cambiando el estado del usuario');
    } finally {
      setUsuariosLoading(false);
    }
  };

  const deleteUsuario = async (userId) => {
    if (!confirm('Eliminar este usuario?')) return;
    try {
      setUsuariosLoading(true);
      await usuariosAPI.delete(userId);
      setUsuarios(prev => prev.filter(u => u.id !== userId));
    } catch (error) {
      notify(error.message || 'Error eliminando usuario');
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
          intcomex_profile: normalizeIntcomexProfile(u.intcomex_profile),
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
      notify('Ingrese nombre de empresa');
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
        intcomex_profile: normalizeIntcomexProfile(empresaForm.intcomex_profile),
        partner_category: empresaForm.partner_category || DEFAULT_AXIS_PARTNER,
        logo_url: empresaForm.logo_url || ''
      }
    }));
    setEmpresaForm({
      nombre: '',
      role: 'client',
      gp_qnap: '15',
      gp_axis: '15',
      intcomex_profile: '',
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
      intcomex_profile: normalizeIntcomexProfile(empresa.intcomex_profile),
      partner_category: empresa.partner_category || DEFAULT_AXIS_PARTNER,
      logo_url: empresa.logo_url || ''
    });
  };

  const assignUserToEmpresa = async (userId, empresaName, intcomexProfileOverride = '') => {
    if (!empresaName) {
      await updateUsuario(userId, { empresa: '', logo_url: '', intcomex_profile: null });
      return;
    }
    const config = empresaConfigs[empresaName];
    if (!config) return;
    const isIntcomexEmpresa = normalizeText(empresaName) === 'intcomex';
    const intcomexProfile = isIntcomexEmpresa
      ? normalizeIntcomexProfile(intcomexProfileOverride || config.intcomex_profile)
      : '';
    const isVentasProfile = isIntcomexEmpresa && intcomexProfile === 'ventas';
    await updateUsuario(userId, {
      empresa: empresaName,
      role: isVentasProfile ? 'client' : (config.role || 'client'),
      gp_qnap: isVentasProfile ? 15 : (config.gp_qnap ?? 15),
      gp_axis: isVentasProfile ? 13 : (config.gp_axis ?? 15),
      gp: isVentasProfile ? 15 : (config.gp_qnap ?? 15),
      intcomex_profile: intcomexProfile || null,
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
        usuariosEmpresa.map(u => updateUsuario(u.id, { empresa: '', logo_url: '', intcomex_profile: null }))
      );
      setEmpresaConfigs(prev => {
        const next = { ...prev };
        delete next[empresaName];
        return next;
      });
    } catch (error) {
      notify(error.message || 'Error eliminando empresa');
    } finally {
      setUsuariosLoading(false);
    }
  };

  // Tras cambiar etapa, archivar o restaurar: la lista, el embudo y el resumen del CRM se refrescan.
  const invalidarCotizacionesYCrm = () => {
    invalidarHistorial();
    queryClient.invalidateQueries({ queryKey: queryKeys.crm.todo });
  };

  // Cambia la etapa de una cotización (y de su oportunidad). "Perdida" pide el motivo antes.
  const cambiarEtapaCotizacion = async (cot, etapa, motivo) => {
    if (!cot?.id || !etapa) return;
    if (etapa === 'perdida' && !motivo) {
      setPerdidaDe(cot);
      return;
    }
    try {
      setSaving(true);
      const result = await cotizacionesAPI.updateEstado(cot.id, { etapa, motivo_perdida: motivo });
      setHistorial(prev => prev.map(c => (
        c.id === cot.id
          ? {
            ...c,
            etapa: result?.etapa || etapa,
            estado: result?.estado || c.estado,
            motivo_perdida: etapa === 'perdida' ? (result?.motivo_perdida ?? motivo) : (result?.motivo_perdida ?? null)
          }
          : c
      )));
      invalidarCotizacionesYCrm();
      notify(`Cotización ${cot.numero || `#${cot.id}`} movida a ${nombreEtapa(result?.etapa || etapa)}`, { tipo: 'ok' });
    } catch (error) {
      notify(error.message || 'No se pudo cambiar la etapa', { tipo: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const restaurarCotizaciones = async (ids) => {
    const lista = (ids || []).filter(Boolean);
    if (lista.length === 0) return;
    try {
      setSaving(true);
      const resultado = await cotizacionesAPI.restaurar(lista);
      setHistorialArchivadas(prev => prev.filter(cot => !lista.includes(cot.id)));
      setSelectedHistorialIds(new Set());
      invalidarCotizacionesYCrm();
      setArchivadasRecarga(n => n + 1);
      setActivasRecarga(n => n + 1);
      notify(`Se restauraron ${textoConteoArchivo(resultado)}.`, { tipo: 'ok' });
    } catch (error) {
      notify(error.message || 'No se pudo restaurar', { tipo: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Tras archivar (por ids o por fecha): quita de las activas lo que ya no está y avisa.
  const trasArchivar = (resultado, ids) => {
    if (Array.isArray(ids)) setHistorial(prev => prev.filter(cot => !ids.includes(cot.id)));
    setSelectedHistorialIds(new Set());
    setExpandedHistorialId(prev => (Array.isArray(ids) && ids.includes(prev) ? null : prev));
    invalidarCotizacionesYCrm();
    setArchivadasRecarga(n => n + 1);
    // Archivar por fecha no dice qué ids salieron: se vuelve a pedir la lista de activas.
    if (!Array.isArray(ids)) {
      queryClient.fetchQuery({
        queryKey: [...queryKeys.cotizaciones, 'includeItems'],
        queryFn: () => cotizacionesAPI.getAll({ includeItems: true })
      }).then(data => setHistorial(Array.isArray(data) ? data : [])).catch(() => {});
    }
    notify(`Se archivaron ${textoConteoArchivo(resultado)}. Puedes verlas y restaurarlas en Archivadas.`, {
      tipo: 'ok',
      accion: Array.isArray(ids) ? { label: 'Deshacer', onClick: () => restaurarCotizaciones(ids) } : undefined
    });
  };

  const archivarCotizaciones = async (ids) => {
    const lista = (ids || []).filter(Boolean);
    if (lista.length === 0) return;
    try {
      setSaving(true);
      const resultado = await cotizacionesAPI.archivar({ ids: lista });
      trasArchivar(resultado, lista);
    } catch (error) {
      notify(error.message || 'No se pudo archivar', { tipo: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // El guardado vive en el editor (CotizacionEditor): aca solo se refleja el resultado.
  const handleCotizacionEditada = (actualizada) => {
    if (!actualizada?.id) return;
    setHistorial(prev => prev.map(c => (c.id === actualizada.id ? { ...c, ...actualizada } : c)));
    invalidarCotizacionesYCrm();
  };

  // Producto del catálogo que corresponde a una fila de stock (por MPN, luego SKU).
  const productoDeStock = (item) => productos.find(p =>
    (item.mpn && normalizeLookupKey(p.mpn) === normalizeLookupKey(item.mpn)) ||
    (item.sku && normalizeLookupKey(p.sku) === normalizeLookupKey(item.sku))
  );

  // Duplicar: la cotización pasa al carrito como una nueva, con precios y stock de hoy.
  const duplicarCotizacion = (cot) => {
    const items = Array.isArray(cot?.items) ? cot.items : [];
    const porId = new Map(productos.map(p => [Number(p.id), p]));
    const porCodigo = (item) => productos.find(p =>
      (item.mpn && normalizeLookupKey(p.mpn) === normalizeLookupKey(item.mpn)) ||
      (item.sku && item.sku !== 'To Create' && normalizeLookupKey(p.sku) === normalizeLookupKey(item.sku))
    );
    const entradas = [];
    const deQuote = [];
    const faltantes = [];
    for (const item of items) {
      // Una línea de quote no está en el catálogo: se rearma con el costo del fabricante guardado.
      const quote = puedeCargarQuotes && esOrigenQuote(item.origen) ? productoDeQuoteGuardado(item) : null;
      if (quote) {
        deQuote.push(quote);
        continue;
      }
      const producto = porId.get(Number(item.producto_id)) || porCodigo(item);
      if (producto) entradas.push({ producto, cantidad: Number(item.cantidad) || 1 });
      else faltantes.push(item.sku && item.sku !== 'To Create' ? item.sku : item.mpn || 'sin código');
    }
    if (entradas.length === 0 && deQuote.length === 0) {
      notify('No se pudo duplicar: ninguno de sus productos está en el catálogo activo.', { tipo: 'error' });
      return;
    }
    const carritoAnterior = cotizacion;
    const clienteAnterior = cliente;
    const numeroAnterior = currentQuoteNumero;
    setCotizacion([]);
    agregarVarios(entradas);
    agregarLineasDeQuote(deQuote, { silencioso: true, carritoVacio: true });
    setCurrentQuoteNumero(null);
    setCliente(c => ({
      ...c,
      ...(isAdmin ? { nombre: cot.cliente_nombre || '', empresa: cot.cliente_empresa || '', pid: cot.cliente_email || '' } : {}),
      proyecto: cot.cliente_telefono || ''
    }));
    setCurrentView('cotizador');
    const folio = cot.numero ? `N° ${cot.numero}` : `#${cot.id}`;
    notify(
      `Cotización ${folio} duplicada con precios de hoy.` +
        (faltantes.length ? ` Sin catálogo: ${faltantes.slice(0, 4).join(', ')}${faltantes.length > 4 ? '…' : ''}.` : ''),
      {
        tipo: faltantes.length ? 'info' : 'ok',
        duracion: 8000,
        accion: {
          label: 'Deshacer',
          onClick: () => {
            setCotizacion(carritoAnterior);
            setCliente(clienteAnterior);
            setCurrentQuoteNumero(numeroAnterior);
          }
        }
      }
    );
  };



  const getCompraOrigenLabel = (cot) => etiquetaCompraOrigen(cot.items);

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
  const sanitizeCompraHtml = (html) =>
    DOMPurify.sanitize(html || '', {
      ALLOWED_TAGS: ['p', 'br', 'table', 'tr', 'th', 'td', 'tbody', 'thead'],
      ALLOWED_ATTR: ['border', 'cellpadding', 'cellspacing']
    });
  const copyHtmlToClipboard = async (html) => {
    try {
      if (navigator.clipboard?.write) {
        const blob = new Blob([html], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        await navigator.clipboard.write([item]);
        notify('HTML copiado al portapapeles');
        return;
      }
      await navigator.clipboard.writeText(html);
      notify('Texto copiado al portapapeles');
    } catch (error) {
      notify('No se pudo copiar automáticamente. Selecciona y copia manualmente.');
    }
  };

  const enviarACompras = (cot) => {
    // Solo se muestra la info para copiar/pegar; ya no se abre el cliente de correo.
    setCompraPreviewCot(cot);
  };

  const filteredProductos = useMemo(() => {
    const localTerm = isAdmin ? '' : searchTerm.toLowerCase();
    return adminProductos.filter(p => {
      const localMatch =
        p.marca.toLowerCase().includes(localTerm) ||
        p.sku.toLowerCase().includes(localTerm) ||
        (p.mpn || '').toLowerCase().includes(localTerm) ||
        p.desc.toLowerCase().includes(localTerm);
      if (!localMatch) return false;
      if (!globalQuery) return true;
      return [p.sku, p.mpn, p.desc, p.marca]
        .some(v => (v || '').toLowerCase().includes(globalQuery));
    });
  }, [adminProductos, searchTerm, globalQuery, isAdmin]);

  const filteredCatalogo = useMemo(() => {
    const t = catalogSearch.toLowerCase();
    return productos.filter(p =>
      (!isCotizadorStockAdmin || (p.origen || 'QNAP') === 'AXIS') && (
        p.marca.toLowerCase().includes(t) ||
        p.sku.toLowerCase().includes(t) ||
        (p.mpn || '').toLowerCase().includes(t) ||
        p.desc.toLowerCase().includes(t)
      ) && (
        !globalQuery ||
        [p.sku, p.mpn, p.desc, p.marca].some(v => (v || '').toLowerCase().includes(globalQuery))
      )
    );
  }, [productos, catalogSearch, globalQuery, isCotizadorStockAdmin]);

  const filteredStockCatalog = useMemo(() => {
    const tokens = buildSearchTokens(stockCatalogQuery);
    const originFilter = isCotizadorStockAdmin ? 'AXIS' : stockCatalogOrigin;
    const filtrados = stockCatalog.filter(item => {
      // 0 disponible (sin bodega o todo asignado en OSO) cuenta como sin stock: no se lista.
      if (!(Number(item.quantity) > 0)) return false;
      if (originFilter !== 'all' && (item.origin || '').toUpperCase() !== originFilter) return false;
      if (tokens.length === 0) return true;
      const haystack = [
        item.brand,
        item.name,
        item.sku,
        item.mpn
      ].map(normalizeSearchText).join(' ');
      const tokenMatch = tokens.every(token => haystack.includes(token));
      if (!tokenMatch) return false;
      if (!globalQuery) return true;
      return [item.sku, item.mpn, item.name, item.brand].some(v => (v || '').toLowerCase().includes(globalQuery));
    });
    return filtrados;
  }, [stockCatalog, stockCatalogQuery, stockCatalogOrigin, globalQuery, isCotizadorStockAdmin]);

  const unassignedUsuarios = useMemo(
    () => usuarios.filter(u => !(u.empresa || '').trim()).filter(u => (
      !globalQuery ||
      [u.usuario, u.nombre, u.empresa].some(v => (v || '').toLowerCase().includes(globalQuery))
    )),
    [usuarios, globalQuery]
  );

  const paginateRows = (rows, key) => {
    const pageSize = pageSizeByTable[key] || DEFAULT_PAGE_SIZE;
    const currentPage = pageByTable[key] || 1;
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    return {
      page: safePage,
      pageSize,
      total,
      totalPages,
      rows: rows.slice(start, end)
    };
  };

  const productosPage = useMemo(() => paginateRows(filteredProductos, 'productos'), [filteredProductos, pageByTable, pageSizeByTable]);
  const historialPage = useMemo(() => paginateRows(filteredHistorial, 'historial'), [filteredHistorial, pageByTable, pageSizeByTable]);
  const usuariosPage = useMemo(() => paginateRows(unassignedUsuarios, 'usuarios'), [unassignedUsuarios, pageByTable, pageSizeByTable]);

  const updateTablePage = (key, page) => {
    setPageByTable(prev => ({ ...prev, [key]: page }));
  };

  const updateTablePageSize = (key, size) => {
    setPageSizeByTable(prev => ({ ...prev, [key]: size }));
    setPageByTable(prev => ({ ...prev, [key]: 1 }));
  };

  useEffect(() => {
    setPageByTable(prev => ({ ...prev, productos: 1 }));
  }, [searchTerm, globalQuery, adminOrigin]);

  useEffect(() => {
    setPageByTable(prev => ({ ...prev, historial: 1 }));
  }, [historialFilters, globalQuery]);

  // Al abrir una cotización desde otra vista: se ubica su página y queda a la vista.
  useEffect(() => {
    const id = enfocarCotizacionRef.current;
    if (!id || historialLoading) return;
    const indice = filteredHistorial.findIndex(cot => cot.id === id);
    if (indice < 0) {
      if (historial.some(cot => cot.id === id)) {
        // Existe pero los filtros la ocultan: se limpian y se vuelve a intentar.
        setHistorialFilters(FILTROS_HISTORIAL_VACIOS);
        setGlobalSearch('');
      }
      return;
    }
    enfocarCotizacionRef.current = null;
    const tamano = pageSizeByTable.historial || DEFAULT_PAGE_SIZE;
    setPageByTable(prev => ({ ...prev, historial: Math.floor(indice / tamano) + 1 }));
    setTimeout(() => document.getElementById(`cotizacion-fila-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  }, [filteredHistorial, historialLoading, expandedHistorialId]);

  useEffect(() => {
    setPageByTable(prev => ({ ...prev, usuarios: 1 }));
  }, [globalQuery, usuarios.length]);

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
      <div className="min-h-screen app-bg flex flex-col items-center justify-center gap-4" role="status" aria-label="Cargando MyQuote">
        <img src="/brand/myquote-symbol-web.svg" alt="" className="h-12 w-12 animate-pulse dark:invert" />
        <span className="text-sm text-slate-500">Cargando…</span>
      </div>
    );
  }

  // LOGIN
  if (!isLoggedIn) {
    const campoLogin = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900";
    return (
      <div className="min-h-screen app-bg flex flex-col">
        <header className="flex items-center justify-between px-6 sm:px-10 h-16">
          <img src="/brand/myquote-horizontal-web.svg" alt="MyQuote" className="h-7 w-auto dark:invert" />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        <main className="flex-1 flex items-center justify-center px-6 pb-24">
          <form
            className="stagger-children w-full max-w-[340px] flex flex-col gap-7"
            onSubmit={e => {
              e.preventDefault();
              const campos = new FormData(e.currentTarget);
              handleLogin(campos.get('usuario'), campos.get('password'));
            }}
          >
            <div className="space-y-2">
              <div className="mq-sobre">Acceso</div>
              <h1 className="text-[32px] leading-9 font-semibold tracking-tight text-slate-900">Ingresar</h1>
              <p className="text-sm leading-5 text-slate-500">Usa el usuario y la contraseña que te entregó Intcomex.</p>
            </div>
            <div className="space-y-4">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-700" htmlFor="login-usuario">
                Usuario
                <input
                  id="login-usuario"
                  name="usuario"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={usuario}
                  onChange={e => setUsuario(e.target.value)}
                  className={campoLogin}
                  placeholder="nombre.apellido"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-700" htmlFor="login-password">
                Contraseña
                <span className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={`${campoLogin} pr-20`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-pressed={showPassword}
                    className="mq-btn mq-btn-xs mq-btn-fantasma absolute right-1.5 top-1/2 -translate-y-1/2"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </span>
              </label>
              {loginError && (
                <p role="alert" className="animate-fade-in-up rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  {loginError}
                </p>
              )}
            </div>
            <button type="submit" className="mq-btn mq-btn-lg mq-btn-primario w-full">
              Ingresar
            </button>
          </form>
        </main>
        <footer className="px-6 sm:px-10 h-14 flex items-center justify-between border-t border-slate-200">
          <span className="mq-sobre">Intcomex Chile · Product Management</span>
          <span className="mq-sobre hidden sm:inline">Axis · QNAP</span>
        </footer>
      </div>
    );
  }

  // VISTA CLIENTE
  if (currentView === 'cliente') {
    const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
    return (
      <div className="min-h-screen bg-slate-100 p-4 print:bg-white">
        <div data-pdf-root="1" className="max-w-4xl mx-auto bg-white shadow-xl print:shadow-none rounded-lg overflow-hidden print-area">
          <div className="p-4 sm:p-8 border-b bg-white">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div style={{ width: '208px', height: '56px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <img
                  src="/logo.png"
                  alt="Logo"
                  width={208}
                  height={56}
                  style={{ width: '208px', height: '56px', objectFit: 'contain', objectPosition: 'left center', display: 'block' }}
                />
              </div>
              <div className="text-right text-xs text-slate-500">
                <div><span className="font-semibold text-slate-700">Fecha:</span> {fecha}</div>
              </div>
            </div>
          </div>
          <div className="p-4 bg-slate-50 border-b grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm break-words">
            <div><b>Nombre:</b> {cliente.nombre || 'N/A'}</div>
            <div><b>Empresa:</b> {cliente.empresa || 'N/A'}</div>
            <div><b>PID:</b> {cliente.pid || 'N/A'}</div>
            <div><b>Nombre del proyecto:</b> {cliente.proyecto || 'N/A'}</div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
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
                    <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
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
              <div className="bg-slate-900 text-white px-6 py-3 rounded-lg">
                <span className="text-sm">TOTAL (No incluye IVA): </span>
                <span className="text-xl font-bold">{formatCurrency(totalCotizacion)}</span>
              </div>
            </div>
          </div>
          <div className="p-4 bg-slate-50 border-t text-xs text-slate-600">
            <h3 className="font-bold text-slate-800 mb-2">OBSERVACIONES Y CONDICIONES:</h3>
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
                <li>La presente cotización no constituye una oferta formal ni vinculante hasta su validación por el Product Manager. (Alexis González)</li>
              )}
            </ol>
          </div>
          <div className="p-3 bg-slate-800 text-white text-center text-sm">
            <p className="font-semibold">Favor Emitir Orden de Compra a: INTCOMEX CHILE S.A.</p>
            <p className="text-slate-300">Rut: 96.705.940-4 - Cordillera 331 - Quilicura - Santiago</p>
          </div>
        </div>
        <div className="mt-4 flex justify-center gap-3 flex-wrap print:hidden">
          <button onClick={() => setCurrentView('cotizador')} className="mq-btn mq-btn-fantasma">
            Volver
          </button>
          <button onClick={exportCotizacionPdf} className="mq-btn mq-btn-secundario">
            Exportar PDF
          </button>
          <button onClick={exportCotizacionExcel} className="mq-btn mq-btn-secundario">
            Exportar Excel
          </button>
          <button onClick={saveCotizacion} disabled={saving} className="mq-btn mq-btn-primario">
            {saving ? 'Guardando…' : 'Guardar cotización'}
          </button>
        </div>
      </div>
    );
  }

  // Lista de cotizaciones: "Mis cotizaciones" (clientes) y CRM › Cotizaciones (admin completo).
  // En el CRM recibe `abrirEmpresa` para enlazar la empresa del CRM de cada fila.
  const renderHistorialContenido = ({ abrirEmpresa } = {}) => {
    const verArchivadas = isFullAdmin && historialVista === 'archivadas';
    const cargandoLista = verArchivadas ? archivadasLoading : historialLoading;
    const errorLista = verArchivadas ? archivadasError : historialError;
    const seleccionadas = selectedHistorialIds.size;
    const conteosEtapa = contarPorEtapa(historialBase);
    const limpiarFiltros = () => {
      setGlobalSearch('');
      setHistorialFilters(FILTROS_HISTORIAL_VACIOS);
    };
    const tituloLista = !isAdmin ? 'Mis cotizaciones' : verArchivadas ? 'Cotizaciones archivadas' : 'Cotizaciones activas';
    return (
      <div className="space-y-4">
        <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="mq-cot-barra">
              <h2 className="text-base font-semibold text-slate-900">{tituloLista}</h2>
              {isFullAdmin && <ConmutadorArchivo vista={historialVista} onCambiar={cambiarVistaHistorial} />}
              {seleccionadas > 0 && isFullAdmin && !verArchivadas && (
                <button
                  type="button"
                  onClick={() => archivarCotizaciones(Array.from(selectedHistorialIds))}
                  disabled={saving}
                  className="mq-btn mq-btn-xs mq-btn-secundario"
                >
                  Archivar seleccionadas ({seleccionadas})
                </button>
              )}
              {seleccionadas > 0 && verArchivadas && (
                <button
                  type="button"
                  onClick={() => restaurarCotizaciones(Array.from(selectedHistorialIds))}
                  disabled={saving}
                  className="mq-btn mq-btn-xs mq-btn-secundario"
                >
                  Restaurar seleccionadas ({seleccionadas})
                </button>
              )}
              {seleccionadas > 0 && (verArchivadas || !isFullAdmin) && (
                <button
                  type="button"
                  onClick={deleteSelectedCotizaciones}
                  disabled={saving}
                  className="mq-btn mq-btn-xs mq-btn-peligro"
                >
                  Eliminar seleccionados ({seleccionadas})
                </button>
              )}
            </div>
            <div className="mq-cot-barra">
              {isFullAdmin && !verArchivadas && (
                <button type="button" onClick={() => setArchivarFechaAbierto(true)} className="mq-btn mq-btn-xs mq-btn-fantasma">
                  Archivar anteriores a…
                </button>
              )}
              {isFullAdmin && canViewCotizador && !verArchivadas && (
                <button type="button" onClick={() => setCurrentView('cotizador')} className="mq-btn mq-btn-xs mq-btn-primario">Nueva cotización</button>
              )}
              <span className="text-xs text-slate-500">{historialPage.total} resultados</span>
            </div>
          </div>
          {verArchivadas && (
            <p className="mt-2 text-xs text-slate-500">
              Archivar no borra. Las archivadas no aparecen en el embudo, el resumen, el dashboard ni el seguimiento automático.
              Aquí son de solo lectura: puedes verlas, exportarlas y ver sus versiones, o restaurarlas para volver a trabajarlas.
              «Eliminar» las borra para siempre.
            </p>
          )}
          {isAdmin && !verArchivadas && (
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
            {isAdmin && (
              <input
                type="text"
                aria-label="Buscar"
                placeholder="Buscar…"
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm md:col-span-2"
              />
            )}
            <input
              type="date"
              aria-label="Fecha"
              value={historialFilters.fecha}
              onChange={e => setHistorialFilters(f => ({ ...f, fecha: e.target.value }))}
              className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
            />
            {!isAdmin && (
              <>
                <input
                  type="text"
                  placeholder="Buscar cliente..."
                  value={historialFilters.cliente}
                  onChange={e => setHistorialFilters(f => ({ ...f, cliente: e.target.value }))}
                  className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                />
                <input
                  type="text"
                  placeholder="Buscar PID..."
                  value={historialFilters.pid}
                  onChange={e => setHistorialFilters(f => ({ ...f, pid: e.target.value }))}
                  className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                />
                <input
                  type="text"
                  placeholder="Buscar proyecto..."
                  value={historialFilters.proyecto}
                  onChange={e => setHistorialFilters(f => ({ ...f, proyecto: e.target.value }))}
                  className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                />
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={historialFilters.producto}
                  onChange={e => setHistorialFilters(f => ({ ...f, producto: e.target.value }))}
                  className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                />
              </>
            )}
            <button
              type="button"
              onClick={() => setHistorialFilters(FILTROS_HISTORIAL_VACIOS)}
              className="mq-btn mq-btn-secundario"
            >
              Limpiar filtros
            </button>
          </div>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Etapa:</span>
              <FiltroEtapas seleccion={historialFilters.etapas || []} conteos={conteosEtapa} onAlternar={toggleEtapaFilter} />
            </div>
          )}
        </div>
        <div className="glass-card rounded-2xl shadow-card border border-white/70 overflow-hidden">
          {cargandoLista ? (
            <table className="w-full text-sm"><tbody><FilasEsqueleto filas={6} columnas={7} /></tbody></table>
          ) : errorLista ? (
            <div className="p-6 text-center text-red-600">{errorLista}</div>
          ) : historialPage.total === 0 ? (
            <EstadoVacio
              icono="carpeta"
              titulo={historialBase.length > 0
                ? 'Ninguna cotización coincide con los filtros'
                : verArchivadas ? 'No hay cotizaciones archivadas' : 'Aún no hay cotizaciones'}
              detalle={historialBase.length > 0
                ? 'Quita algún filtro para ver más resultados.'
                : verArchivadas ? 'Lo que archives aparecerá aquí y se podrá restaurar.' : 'Las cotizaciones que generes aparecerán aquí.'}
              accion={historialBase.length > 0
                ? { label: 'Limpiar filtros', onClick: limpiarFiltros }
                : (canViewCotizador && !verArchivadas ? { label: 'Nueva cotización', onClick: () => setCurrentView('cotizador') } : undefined)}
            />
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todas las filtradas"
                        checked={filteredHistorial.length > 0 && filteredHistorial.every(cot => selectedHistorialIds.has(cot.id))}
                        onChange={toggleSelectAllHistorialFiltered}
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Folio</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Proyecto</th>
                    <th className="px-3 py-2 text-left">Empresa</th>
                    <th className="px-3 py-2 text-left">PID</th>
                    <th className="px-3 py-2 text-left">Etapa</th>
                    {isFullAdmin && <th className="px-3 py-2 text-right">Margen</th>}
                    <th className="px-3 py-2 text-right">Monto</th>
                    <th className="px-3 py-2 text-right"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historialPage.rows.map(cot => {
                    const highlightCliente = isAdmin && isClienteQuote(cot);
                    const showRegistroAlert = isAdmin && !verArchivadas && isClienteQuote(cot) && hasProjectRegistro(cot) && !dismissedRegistroById[cot.id];
                    const highlightRegistro = highlightCliente && showRegistroAlert;
                    const etapa = etapaDeCotizacion(cot);
                    const isGanada = etapa === 'ganada';
                    const isExpanded = expandedHistorialId === cot.id;
                    const folio = cot.numero || `#${cot.id}`;
                    const verVersiones = isFullAdmin ? () => setVersionesDe(cot) : undefined;
                    return (
                      <React.Fragment key={cot.id}>
                        <tr
                          id={`cotizacion-fila-${cot.id}`}
                          onClick={() => {
                            setExpandedHistorialId(prev => (prev === cot.id ? null : cot.id));
                            if (showRegistroAlert) setProjectRegistroModal(cot);
                          }}
                          className={`cursor-pointer ${
                            verArchivadas
                              ? 'mq-cot-archivada hover:bg-slate-50'
                              : highlightRegistro
                                ? 'bg-amber-50/70 border-l-4 border-amber-300'
                                : isGanada
                                  ? 'bg-green-50/70 border-l-4 border-green-300'
                                  : highlightCliente
                                    ? 'bg-blue-50/60'
                                    : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar cotización ${folio}`}
                              checked={selectedHistorialIds.has(cot.id)}
                              onChange={() => toggleSelectHistorial(cot.id)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-slate-700">{folio}</span>
                              <EtiquetaVersion version={cot.version} numero={folio} onVer={verVersiones} />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">{getDateKey(cot.created_at) || 'N/A'}</td>
                          <td className="px-3 py-2">{cot.cliente_telefono || 'N/A'}</td>
                          <td className="px-3 py-2">
                            <div>{cot.cliente_empresa || 'N/A'}</div>
                            {isFullAdmin && cot.empresa_crm && (
                              abrirEmpresa && cot.empresa_id ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); abrirEmpresa(cot.empresa_id); }}
                                  className="mq-enlace mq-cot-empresa text-left"
                                  title="Abrir la ficha de la empresa en el CRM"
                                >
                                  CRM: {cot.empresa_crm}
                                </button>
                              ) : (
                                <span className="mq-cot-empresa text-slate-500">CRM: {cot.empresa_crm}</span>
                              )
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span>{cot.cliente_email || 'N/A'}</span>
                              {showRegistroAlert && (
                                <span
                                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold"
                                  title="Registro de proyecto"
                                >
                                  !
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2"><EtapaCotizacion etapa={etapa} /></td>
                          {isFullAdmin && (
                            <td className="px-3 py-2 text-right">
                              {(() => {
                                const m = margenCotizacion(cot);
                                return m ? (
                                  <span className="inline-flex flex-col items-end" title={m.parcial ? 'Algunas líneas no tienen costo' : undefined}>
                                    <MargenChip gpPct={m.gpPct} origen={m.origenes} />
                                  </span>
                                ) : <span className="text-xs text-slate-500">—</span>;
                              })()}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(cot.total || 0)}</td>
                          <td className="px-2 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {isFullAdmin && !verArchivadas && (
                              <button
                                type="button"
                                onClick={() => setEditorCotizacionId(cot.id)}
                                className="mq-btn mq-btn-xs mq-btn-fantasma text-slate-900"
                                title="Editar (E)"
                              >
                                Editar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => exportHistorialPdf(cot)}
                              className="mq-btn mq-btn-xs mq-btn-fantasma"
                              title="Descargar PDF (P)"
                            >
                              PDF
                            </button>
                            {canViewCotizador && (
                              <button
                                type="button"
                                onClick={() => duplicarCotizacion(cot)}
                                className="mq-btn mq-btn-xs mq-btn-fantasma"
                                title="Duplicar como nueva cotización (D)"
                              >
                                Duplicar
                              </button>
                            )}
                            {isFullAdmin && (verArchivadas ? (
                              <button
                                type="button"
                                onClick={() => restaurarCotizaciones([cot.id])}
                                disabled={saving}
                                className="mq-btn mq-btn-xs mq-btn-fantasma"
                                title="Volver a las activas"
                              >
                                Restaurar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => archivarCotizaciones([cot.id])}
                                disabled={saving}
                                className="mq-btn mq-btn-xs mq-btn-fantasma"
                                title="Archivar (no borra; se puede restaurar)"
                              >
                                Archivar
                              </button>
                            ))}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-white">
                            <td colSpan={isFullAdmin ? 10 : 9} className="px-4 py-3 border-t">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div>
                                  <div className="text-xs text-slate-500">Proyecto</div>
                                  <div className="font-semibold text-slate-800">{cot.cliente_telefono || 'N/A'}</div>
                                </div>
                                {isAdmin && (
                                  <div>
                                    <div className="text-xs text-slate-500">Etapa</div>
                                    <div className="mt-1">
                                      {verArchivadas
                                        ? <EtapaCotizacion etapa={etapa} />
                                        : (
                                          <SelectorEtapa
                                            etapa={etapa}
                                            etiqueta={`Etapa de la cotización ${folio}`}
                                            deshabilitado={saving}
                                            onElegir={(nueva) => cambiarEtapaCotizacion(cot, nueva)}
                                          />
                                        )}
                                    </div>
                                    {etapa === 'perdida' && (
                                      <div className="mq-cot-motivo">Motivo: {cot.motivo_perdida || 'sin motivo registrado'}</div>
                                    )}
                                  </div>
                                )}
                                {isFullAdmin && (
                                  <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                    <div className="text-xs text-slate-600">
                                      {verArchivadas
                                        ? `Archivada${cot.archivada_en ? ` el ${getDateKey(cot.archivada_en)}` : ''}. Restáurala para editarla o cambiar su etapa.`
                                        : `Vigente: v${Number(cot.version) || 1}. Cada guardado con cambios crea una versión nueva y conserva las anteriores.`}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setVersionesDe(cot); }}
                                        className="mq-btn mq-btn-sm mq-btn-secundario"
                                      >
                                        Versiones
                                      </button>
                                      {verArchivadas ? (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); restaurarCotizaciones([cot.id]); }}
                                          disabled={saving}
                                          className="mq-btn mq-btn-sm mq-btn-primario"
                                        >
                                          Restaurar
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); setEditorCotizacionId(cot.id); }}
                                          className="mq-btn mq-btn-sm mq-btn-primario"
                                        >
                                          Editar cotización
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <div className="text-xs text-slate-500">PDF</div>
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); exportHistorialPdf(cot); }}
                                      className="mq-btn mq-btn-xs mq-btn-secundario"
                                    >
                                      PDF
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); exportHistorialExcel(cot); }}
                                      className="mq-btn mq-btn-xs mq-btn-secundario"
                                    >
                                      Excel
                                    </button>
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); exportHistorialAxis(cot); }}
                                        className="mq-btn mq-btn-xs mq-btn-secundario"
                                      >
                                        Exportar a Axis
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {isAdmin && (
                                  <div>
                                    <div className="text-xs text-slate-500">Compras</div>
                                    {!verArchivadas && normalizeEstado(cot.estado) === 'aprobada' ? (
                                      <div className="mt-1 flex items-center gap-2">
                                        <input
                                          type="text"
                                          aria-label="BO"
                                          value={boByCotizacionId[cot.id] || ''}
                                          onChange={e => setBoByCotizacionId(prev => ({ ...prev, [cot.id]: e.target.value }))}
                                          placeholder="BO"
                                          className="w-24 px-2 py-1 border rounded text-xs"
                                        />
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); enviarACompras(cot); }}
                                          className="mq-btn mq-btn-xs mq-btn-primario"
                                        >
                                          Enviar a compras
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="mt-1 text-xs text-slate-500">
                                        {verArchivadas ? 'No disponible en archivadas' : 'Disponible cuando está Ganada'}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="md:col-span-2">
                                  <div className="text-xs text-slate-500 mb-1">Productos</div>
                                  {Array.isArray(cot.items) && cot.items.length > 0 ? (
                                    <div className="space-y-1 text-xs text-slate-600">
                                      {cot.items.map(item => (
                                        <div key={`${cot.id}-${item.id}`} className="flex justify-between gap-3">
                                          <span className="truncate">
                                            {Number(item.cantidad) || 1}× {(item.sku || item.mpn || 'SKU')} - {item.descripcion || 'Sin descripción'}
                                          </span>
                                          <span className="shrink-0 tabular-nums">{formatCurrency(Number(item.precio_total) || 0)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-slate-500">Sin productos</span>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <div className="p-3 border-t bg-white flex items-center justify-end gap-2 text-xs">
                <label htmlFor="page-size-historial">Filas</label>
                <select
                  id="page-size-historial"
                  value={historialPage.pageSize}
                  onChange={(e) => updateTablePageSize('historial', Number(e.target.value))}
                  className="h-8 px-2 border border-slate-300 rounded-lg bg-white text-sm"
                >
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                </select>
                <button
                  type="button"
                  onClick={() => updateTablePage('historial', Math.max(1, historialPage.page - 1))}
                  disabled={historialPage.page <= 1}
                  className="mq-btn mq-btn-xs mq-btn-secundario"
                >
                  Anterior
                </button>
                <span>Página {historialPage.page}/{historialPage.totalPages}</span>
                <button
                  type="button"
                  onClick={() => updateTablePage('historial', Math.min(historialPage.totalPages, historialPage.page + 1))}
                  disabled={historialPage.page >= historialPage.totalPages}
                  className="mq-btn mq-btn-xs mq-btn-secundario"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // VISTA PRINCIPAL
  const cotizadorContextValue = {
    isAdmin,
    globalSearch,
    setGlobalSearch,
    dashboardKpis,
    dashboardInvoiceMonth,
    setDashboardInvoiceMonth,
    invoiceMonthOptions,
    dashboardBilling,
    setCurrentView,
    syncStatus,
    seguimiento,
    abrirCotizacionEnHistorial,
    isFullAdmin
  };

  // Modelo único de navegación: alimenta los pills de desktop, el drawer y la barra inferior móvil.
  const navItems = [
    canViewCotizador && { key: 'cotizador', grupo: 'ventas', label: 'Cotizador', short: 'Cotizar', icon: 'calc', badge: cotizacion.length > 0 ? cotizacion.length : null, badgeTone: 'blue' },
    canViewIA && { key: 'ia', grupo: 'ventas', label: 'Asistente IA', short: 'IA', icon: 'sparkles' },
    // El admin completo ve sus cotizaciones en CRM › Cotizaciones.
    canViewHistorial && !isFullAdmin && {
      key: 'historial',
      grupo: 'ventas',
      label: 'Mis cotizaciones',
      short: 'Historial',
      icon: 'clock'
    },
    canViewStock && { key: 'stock', grupo: 'ventas', label: 'Stock disponible', short: 'Stock', icon: 'box' },
    canViewDashboard && { key: 'dashboard', grupo: 'ventas', label: 'Dashboard', short: 'Inicio', icon: 'home' },
    isFullAdmin && {
      key: 'crm',
      grupo: 'ventas',
      label: 'CRM',
      short: 'CRM',
      icon: 'users',
      badge: historialCounts.registroPendientes > 0 ? historialCounts.registroPendientes : null,
      badgeTone: 'amber'
    },
    isFullAdmin && { key: 'ordenes', grupo: 'operaciones', label: 'Órdenes activas', short: 'Órdenes', icon: 'truck' },
    isFullAdmin && { key: 'compras', grupo: 'operaciones', label: 'Vista compras', short: 'Compras', icon: 'cart' },
    isFullAdmin && { key: 'admin', grupo: 'admin', label: 'Listas de precio', short: 'Precios', icon: 'tag' },
    isFullAdmin && { key: 'usuarios', grupo: 'admin', label: 'Usuarios', short: 'Usuarios', icon: 'users' },
    canViewAccount && { key: 'cuenta', grupo: 'cuenta', label: 'Mi cuenta', short: 'Cuenta', icon: 'user' }
  ].filter(Boolean).filter(item => !navRestriction || navRestriction.includes(item.key));
  const NAV_GRUPOS = [['ventas', 'Ventas'], ['operaciones', 'Operaciones'], ['admin', 'Administración'], ['cuenta', 'Cuenta']];
  const gruposNav = NAV_GRUPOS
    .map(([clave, titulo]) => ({ clave, titulo, items: navItems.filter(item => item.grupo === clave) }))
    .filter(g => g.items.length > 0);
  // Con un solo grupo (clientes) no se muestran encabezados.
  const vistaActual = navItems.find(item => item.key === currentView);
  // Hacia qué lado entra la vista: depende de si se avanza o retrocede en el menú.
  const direccionVista = direccionDeVista(navItems.map(item => item.key), currentView);
  const BOTTOM_NAV_PRIORITY = ['cotizador', 'dashboard', 'stock', 'historial', 'crm', 'compras', 'ordenes', 'cuenta'];
  const bottomNavItems = BOTTOM_NAV_PRIORITY
    .map(key => navItems.find(item => item.key === key))
    .filter(Boolean)
    .slice(0, 4);

  return (
    <CotizadorContext.Provider value={cotizadorContextValue}>
    <div className="min-h-screen app-bg">
      {!isAdmin && (
        <a
          href="https://wa.me/56935134131"
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-24 lg:bottom-5 right-4 lg:right-5 z-40 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg bg-green-500 text-white hover:bg-green-600"
          aria-label="Necesitas Ayuda? WhatsApp"
        >
          <span className="text-sm font-semibold">¿Necesitas Ayuda?</span>
        </a>
      )}
      <BarraSuperior
        grupos={gruposNav}
        actual={currentView}
        onIr={setCurrentView}
        onIndice={() => setMobileMenuOpen(true)}
        onBuscar={() => setPaletteOpen(true)}
        theme={theme}
        onTema={toggleTheme}
        user={user}
        onSalir={handleLogout}
      />
      <Indice
        abierto={mobileMenuOpen}
        grupos={gruposNav}
        actual={currentView}
        onIr={setCurrentView}
        onCerrar={cerrarIndice}
        onBuscar={() => setPaletteOpen(true)}
        theme={theme}
        onTema={toggleTheme}
        user={user}
        onSalir={handleLogout}
      />
      <Cortina vista={currentView} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden bg-[var(--mq-ground)] border-b border-slate-200 sticky top-0 z-40">
          <div className="px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img src="/brand/myquote-symbol-web.svg" alt="MyQuote" className="h-7 w-7 shrink-0 dark:invert" />
              <h1 className="text-base font-bold tracking-tight text-slate-900 truncate">{vistaActual?.label || 'MyQuote'}</h1>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Abrir menú"
                className="mq-btn-icono !h-10 !w-10"
              >
                <NavIcon name="menu" className="w-6 h-6" />
              </button>
            </div>
          </div>
        </header>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          navItems={navItems}
          currentView={currentView}
          onNavigate={(key) => setCurrentView(key)}
          productos={productos}
          onPickProducto={(p) => { setCurrentView('cotizador'); setCatalogSearch(p.sku || p.mpn || p.desc || ''); }}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />

        <PegarListaModal
          abierto={pegarListaTexto !== null}
          textoInicial={pegarListaTexto || ''}
          productos={isCotizadorStockAdmin ? productos.filter(p => (p.origen || 'QNAP') === 'AXIS') : productos}
          onAgregar={agregarListaPegada}
          onCerrar={() => setPegarListaTexto(null)}
        />
        {puedeCargarQuotes && (
          <CargarQuoteModal
            abierto={quoteAbierto}
            onCerrar={() => setQuoteAbierto(false)}
            onAgregar={agregarLineasDeQuote}
          />
        )}
        <AtajosAyuda abierto={atajosAbiertos} onCerrar={() => setAtajosAbiertos(false)} esAdmin={isFullAdmin} />
        <RevisionEnvioModal
          abierto={revisionAbierta}
          problemas={revisionAbierta ? problemasEnvio() : { bajoPiso: [], porCrear: [], sinStock: [] }}
          onVolver={() => setRevisionAbierta(false)}
          onGenerar={() => generarCotizacion({ saltarRevision: true })}
        />

        {isFullAdmin && editorCotizacionId && (
          <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] text-white">Abriendo editor…</div>}>
            <CotizacionEditor
              cotizacionId={editorCotizacionId}
              productos={productos}
              getStockText={(mpn) => getStockEntregaText(mpn)}
              onClose={() => setEditorCotizacionId(null)}
              onSaved={handleCotizacionEditada}
              onExportPdf={exportHistorialPdf}
            />
          </Suspense>
        )}

        {isFullAdmin && versionesDe && (
          <PanelVersiones
            cotizacionId={versionesDe.id}
            versionActual={Number(versionesDe.version) || 1}
            numero={versionesDe.numero || `#${versionesDe.id}`}
            onCerrar={() => setVersionesDe(null)}
          />
        )}
        {isFullAdmin && perdidaDe && (
          <PerdidaDialogo
            oportunidad={{ titulo: `Cotización ${perdidaDe.numero || `#${perdidaDe.id}`}${perdidaDe.cliente_empresa ? ` · ${perdidaDe.cliente_empresa}` : ''}` }}
            onCerrar={() => setPerdidaDe(null)}
            onConfirmar={(motivo) => cambiarEtapaCotizacion(perdidaDe, 'perdida', motivo)}
          />
        )}
        {isFullAdmin && archivarFechaAbierto && (
          <ArchivarAnterioresDialogo
            onCerrar={() => setArchivarFechaAbierto(false)}
            onArchivado={(resultado) => trasArchivar(resultado, null)}
          />
        )}

        <nav
          aria-label="Navegación principal móvil"
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid" style={{ gridTemplateColumns: `repeat(${bottomNavItems.length + 1}, minmax(0, 1fr))` }}>
            {bottomNavItems.map(item => (
              <button
                key={item.key}
                onClick={() => setCurrentView(item.key)}
                aria-label={item.label}
                className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-xs font-medium transition ${currentView === item.key ? 'text-slate-900 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}
              >
                <span className="relative">
                  <NavIcon name={item.icon} className="w-5 h-5" />
                  {item.badge ? (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                {item.short}
              </button>
            ))}
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menú completo"
              className="flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              <NavIcon name="menu" className="w-5 h-5" />
              Menú
            </button>
          </div>
        </nav>

        {/* w-[92%] junto a w-full aplicaba dos anchos en conflicto sobre el mismo
            elemento y cual ganaba dependia del orden del CSS compilado. Se usa
            max-w, que expresa lo mismo sin competir con w-full. */}
        <main
          className={`mq-vista ${isClient ? 'max-w-[92%]' : 'max-w-[84rem]'} mx-auto w-full px-3 sm:px-6 pt-4 sm:pt-7 pb-28 lg:pb-10`}
          style={direccionVista ? { '--mq-dx': `${direccionVista * 44}px`, '--mq-dy': '0px' } : undefined}
        >
        {currentView === 'dashboard' && (
          <Suspense fallback={<div className="text-sm text-slate-500 p-4">Cargando…</div>}>
            <DashboardView />
          </Suspense>
        )}
        {currentView === 'ia' && canViewIA && (
          <Suspense fallback={<div className="text-sm text-slate-500 p-4">Cargando…</div>}>
            <AsistenteIAView
              usuario={user?.usuario}
              onCargarLista={(texto) => {
                conservarPegarListaRef.current = true;
                setCurrentView('cotizador');
                setPegarListaTexto(texto);
              }}
            />
          </Suspense>
        )}
        {currentView === 'crm' && isFullAdmin && (
          <Suspense fallback={<div className="text-sm text-slate-500 p-4">Cargando…</div>}>
            <CrmView
              onAbrirCotizacion={abrirCotizacionEnHistorial}
              tab={crmTab}
              onTab={setCrmTab}
              cotizaciones={renderHistorialContenido}
            />
          </Suspense>
        )}
        {currentView === 'stock' && (
          <div className="space-y-4 view-enter">
            <EncabezadoPagina
              seccion="Ventas"
              titulo="Stock disponible"
              subtitulo="Entrega inmediata: stock en bodega menos lo ya asignado a clientes (OSO)."
            >
              <button onClick={exportStockExcel} className="mq-btn mq-btn-sm mq-btn-secundario">Exportar Excel</button>
              <button onClick={exportStockPdf} className="mq-btn mq-btn-sm mq-btn-secundario">Exportar PDF</button>
            </EncabezadoPagina>
            <div className="glass-card rounded-2xl shadow-card border border-white/70 overflow-hidden">
              <div className="p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    </span>
                    <input
                      type="text"
                      aria-label="Buscar en stock"
                      placeholder="Buscar por marca, SKU, MPN o descripción…"
                      value={stockCatalogQuery}
                      onChange={e => setStockCatalogQuery(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {(isCotizadorStockAdmin ? ['AXIS'] : ['all', 'AXIS', 'QNAP']).map(origin => (
                      <button
                        key={origin}
                        onClick={() => setStockCatalogOrigin(origin)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                          (isCotizadorStockAdmin ? 'AXIS' : stockCatalogOrigin) === origin ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {origin === 'all' ? 'Todos' : origin}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  {filteredStockCatalog.length} productos con unidades · puedes buscar por varias palabras, por ejemplo «Axis 03181».
                </div>
                {isFullAdmin && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-700">Margen del precio de sistema</span>
                    {['AXIS', 'QNAP'].map(marca => (
                      <label key={marca} className="flex items-center gap-1.5">
                        {marca === 'AXIS' ? 'Axis' : 'QNAP'}
                        <NumeroInput
                          value={margenSistema[marca]}
                          onCommit={valor => { if (valor !== null && valor < 100) cambiarMargenSistema(marca, valor); }}
                          decimales={1}
                          min={0}
                          ariaLabel={`Margen del precio de sistema ${marca === 'AXIS' ? 'Axis' : 'QNAP'} en porcentaje`}
                          className="h-8 w-16 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm tabular-nums text-slate-800"
                        />
                        %
                      </label>
                    ))}
                    <button type="button" onClick={restablecerMargenSistema} className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
                      Restablecer (13% / 15%)
                    </button>
                    <span className="text-slate-500">Costo real de bodega ÷ (1 − margen), sin rebate de partner.</span>
                  </div>
                )}
              </div>
              <div ref={stockExportRef} data-pdf-root="1" className="overflow-x-auto bg-white px-3 py-4 sm:px-6 sm:py-6">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="w-full px-3 py-3 text-left">Producto</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left">Marca</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left">SKU</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left">MPN</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right">Disponible</th>
                      {isFullAdmin && <th className="whitespace-nowrap px-3 py-3 text-right">Precio sistema</th>}
                      {canViewCotizador && <th className="px-3 py-3 text-right"><span className="sr-only">Cotizar</span></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockCatalogLoading && <FilasEsqueleto filas={6} columnas={(canViewCotizador ? 6 : 5) + (isFullAdmin ? 1 : 0)} />}
                    {!stockCatalogLoading && stockCatalogError && (
                      <tr>
                        <td colSpan={(canViewCotizador ? 6 : 5) + (isFullAdmin ? 1 : 0)} className="px-4 py-6 text-center text-red-600">{stockCatalogError}</td>
                      </tr>
                    )}
                    {!stockCatalogLoading && !stockCatalogError && filteredStockCatalog.length === 0 && (
                      <tr>
                        <td colSpan={(canViewCotizador ? 6 : 5) + (isFullAdmin ? 1 : 0)}>
                          <EstadoVacio
                            icono="search"
                            titulo={stockCatalogQuery.trim() ? 'Sin coincidencias en stock' : 'No hay stock disponible'}
                            detalle={stockCatalogQuery.trim() ? 'Prueba con el MPN o parte del modelo.' : 'Cuando entre mercadería aparecerá aquí.'}
                          />
                        </td>
                      </tr>
                    )}
                    {!stockCatalogLoading && !stockCatalogError && filteredStockCatalog.map((item, idx) => (
                      <tr key={`${item.mpn || item.sku || 'item'}-${idx}`} className={`${idx % 2 === 1 ? 'bg-slate-50/40' : ''} ${Number(item.quantity) > 0 ? '' : 'opacity-60'}`}>
                        <td className="w-full min-w-[240px] max-w-0 px-3 py-3">
                          <div className="flex items-center gap-3">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name || 'Producto'}
                                className="w-14 h-14 shrink-0 object-contain bg-white border rounded"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-14 h-14 shrink-0 bg-slate-100 border rounded" />
                            )}
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800 truncate" title={item.name || undefined}>{item.name || 'Sin descripción'}</div>
                              {item.origin && (
                                <div className="text-xs text-slate-500">{item.origin}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{item.brand || 'N/A'}</td>
                        <td className="whitespace-nowrap px-3 py-3">{item.sku || 'N/A'}</td>
                        <td className="whitespace-nowrap px-3 py-3">{item.mpn || 'N/A'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:text-emerald-300 dark:ring-emerald-500/30">{formatStockQuantity(item.quantity) || '0'}</span>
                          {Number(item.asignado) > 0 && (
                            <div className="text-xs text-slate-500" title="Unidades en bodega ya asignadas a clientes (OSO)">
                              {formatStockQuantity(item.asignado)} asignada{Number(item.asignado) === 1 ? '' : 's'} de {formatStockQuantity(item.stock_bodega)}
                            </div>
                          )}
                        </td>
                        {isFullAdmin && (
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                            {(() => {
                              const precio = precioSistemaDe(item, margenSistema);
                              return precio === null
                                ? <span className="text-xs text-slate-500" title="La hoja de stock no trae costo para este equipo">Sin costo</span>
                                : <span className="font-semibold text-slate-900">{formatCurrency(precio)}</span>;
                            })()}
                          </td>
                        )}
                        {canViewCotizador && (
                          <td className="whitespace-nowrap px-3 py-3 text-right" data-html2canvas-ignore="true">
                            {(() => {
                              const enLista = productoDeStock(item);
                              // En stock pero fuera de la lista de precios: el admin lo cotiza igual,
                              // con el costo real de stock como base del precio.
                              const producto = enLista || (isFullAdmin
                                ? productoFueraDeLista(item, {
                                    gpPorDefecto: String(item.origin || item.brand || '').toUpperCase().includes('AXIS') ? cotizacionGpGlobalAxis : cotizacionGpGlobalQnap
                                  })
                                : null);
                              if (!producto) return <span className="text-xs text-slate-500" title="No está en tu lista de precios">Sin precio</span>;
                              const enCarrito = cotizacion.find(x => x.id === producto.id);
                              return (
                                <button
                                  type="button"
                                  title={enLista ? undefined : 'No está en la lista de precios: se cotiza con el costo real de stock'}
                                  onClick={() => {
                                    addToCotizacion(producto);
                                    notify(`Agregado ${producto.sku || producto.mpn} al cotizador`, {
                                      tipo: 'ok',
                                      accion: { label: 'Ir al cotizador', onClick: () => setCurrentView('cotizador') }
                                    });
                                  }}
                                  className="mq-btn mq-btn-sm mq-btn-secundario"
                                >
                                  {enCarrito ? `En carrito (${enCarrito.cant}) · +1` : (enLista ? 'Agregar' : 'Agregar · fuera de lista')}
                                </button>
                              );
                            })()}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {currentView === 'usuarios' && isFullAdmin && (
          <div className="space-y-4 view-enter">
            <EncabezadoPagina seccion="Administración" titulo="Usuarios" subtitulo="Empresas, márgenes por cliente, accesos y sesiones activas." />
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
              <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-slate-900">Empresas</h2>
                  <span className="text-xs text-slate-500">{Object.keys(empresaConfigs).length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowEmpresaForm(v => !v)}
                    className="mq-btn mq-btn-primario"
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
                      className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-slate-500">
                        Rol
                        <select
                          value={empresaForm.role}
                          onChange={e => setEmpresaForm(f => ({ ...f, role: e.target.value }))}
                          className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-800"
                        >
                          <option value="client">Cliente</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-500">
                        GP QNAP (%)
                        <input
                          type="number"
                          value={empresaForm.gp_qnap}
                          onChange={e => setEmpresaForm(f => ({ ...f, gp_qnap: e.target.value }))}
                          className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-800"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-500">
                        GP AXIS (%)
                        <input
                          type="number"
                          value={empresaForm.gp_axis}
                          onChange={e => setEmpresaForm(f => ({ ...f, gp_axis: e.target.value }))}
                          className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-800"
                        />
                      </label>
                    </div>
                    <select
                      value={empresaForm.partner_category}
                      onChange={e => setEmpresaForm(f => ({ ...f, partner_category: e.target.value }))}
                      className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                    >
                      <option>Partner Autorizado</option>
                      <option>Partner Silver</option>
                      <option>Partner Gold</option>
                      <option>Partner Multiregional</option>
                    </select>
                    <div className="flex items-center gap-3">
                      <label className="mq-btn mq-btn-sm mq-btn-secundario">
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
                        className="mq-btn mq-btn-primario"
                      >
                        Guardar empresa
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-4 space-y-3 max-h-[60vh] overflow-auto pr-1">
                  {Object.values(empresaConfigs).length === 0 ? (
                    <div className="text-xs text-slate-500">Crea una empresa para asignar usuarios.</div>
                  ) : (
                    Object.values(empresaConfigs).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(empresa => (
                      <div
                        key={empresa.nombre}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={async (e) => {
                          e.preventDefault();
                          const userId = e.dataTransfer.getData('text/plain');
                          const isIntcomexEmpresa = normalizeText(empresa.nombre) === 'intcomex';
                          if (userId) await assignUserToEmpresa(Number(userId), empresa.nombre, isIntcomexEmpresa ? 'ventas' : '');
                        }}
                        className="border border-dashed border-slate-300 rounded-xl p-3 bg-white"
                      >
                        {(() => {
                          const usersInEmpresa = usuarios.filter(u => (u.empresa || '').trim() === empresa.nombre);
                          const isIntcomexEmpresa = normalizeText(empresa.nombre) === 'intcomex';
                          const usersVentas = usersInEmpresa.filter(u => normalizeIntcomexProfile(u.intcomex_profile) === 'ventas');
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
                              <div className="text-xs text-slate-500">
                                Rol: {empresa.role === 'admin' ? 'Administrador' : 'Cliente'} • GP QNAP {empresa.gp_qnap}% • GP AXIS {empresa.gp_axis}%
                              </div>
                              <div className="text-xs text-slate-500">Partner: {empresa.partner_category}</div>
                              {isIntcomexEmpresa && (
                                <div className="text-xs text-slate-500">Perfil disponible: Ventas</div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => loadEmpresaForm(empresa)}
                            className="mq-btn mq-btn-xs mq-btn-secundario"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => deleteEmpresa(empresa.nombre)}
                            className="mq-btn mq-btn-xs mq-btn-peligro"
                          >
                            Eliminar
                          </button>
                        </div>
                        {isIntcomexEmpresa && (
                          <div className="grid grid-cols-1 gap-2">
                            <div
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={async (e) => {
                                e.preventDefault();
                                const userId = e.dataTransfer.getData('text/plain');
                                if (userId) await assignUserToEmpresa(Number(userId), empresa.nombre, 'ventas');
                              }}
                              className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                            >
                              <div className="text-xs font-semibold text-slate-900">Perfil Ventas</div>
                              <div className="text-xs text-slate-500">Cotizador, Historial y Stock. QNAP 15% y AXIS 13% fijos.</div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                {usersVentas.length === 0 ? (
                                  <span className="text-slate-400">Arrastra usuarios aquí.</span>
                                ) : (
                                  usersVentas.map(u => (
                                    <button
                                      key={`ventas-${u.id}`}
                                      onClick={() => handleUserClick(u.id)}
                                      className="h-7 px-2.5 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                                    >
                                      {u.nombre || u.usuario}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
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
                                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center">
                                      {initials || 'U'}
                                    </span>
                                    <span className="text-xs text-slate-700">{u.nombre || u.usuario}</span>
                                    {u.activo === false && <span className="text-xs text-rose-600">(inactiva)</span>}
                                    {isIntcomexEmpresa && normalizeIntcomexProfile(u.intcomex_profile) && (
                                      <span className="text-xs uppercase text-slate-500">({normalizeIntcomexProfile(u.intcomex_profile)})</span>
                                    )}
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

              <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-slate-900">Usuarios</h3>
                  <span className="text-xs text-slate-500">{usuariosPage.total}</span>
                </div>
                {isAdmin && (
                  <div className="mb-3">
                    <input
                      type="text"
                      aria-label="Buscar"
                      placeholder="Buscar…"
                      value={globalSearch}
                      onChange={e => setGlobalSearch(e.target.value)}
                      className="w-full h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                    />
                  </div>
                )}
                {selectedUsuarioId && (() => {
                  const selectedUser = usuarios.find(u => u.id === selectedUsuarioId);
                  if (!selectedUser) return null;
                  const isFixedAdmin = (selectedUser.usuario || '').toLowerCase() === 'agonz';
                  const isSelectedIntcomex = normalizeText(selectedUser.empresa) === 'intcomex';
                  const selectedProfile = normalizeIntcomexProfile(selectedUser.intcomex_profile);
                  return (
                    <div className="mb-3 border rounded-xl p-3 bg-white/80">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            {selectedUser.usuario}
                            {selectedUser.activo === false && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Inactiva</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">{selectedUser.nombre || 'Sin nombre'}</div>
                          <div className="text-xs text-slate-400">
                            {selectedUser.empresa ? `Empresa: ${selectedUser.empresa}` : 'Sin empresa'}
                          </div>
                          {isSelectedIntcomex && (
                            <div className="text-xs text-slate-400">
                              Perfil Intcomex: {selectedProfile || 'Sin perfil'}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => setSelectedUsuarioId(null)}
                          className="mq-btn mq-btn-xs mq-btn-fantasma"
                        >
                          Cerrar
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2">
                        <select
                          value={selectedUser.empresa || ''}
                          onChange={e => assignUserToEmpresa(selectedUser.id, e.target.value, normalizeText(e.target.value) === 'intcomex' ? 'ventas' : '')}
                          className="h-8 px-2 border border-slate-300 rounded-lg bg-white text-sm"
                          disabled={Object.keys(empresaConfigs).length === 0}
                        >
                          <option value="">Sin empresa</option>
                          {Object.values(empresaConfigs).map(emp => (
                            <option key={emp.nombre} value={emp.nombre}>{emp.nombre}</option>
                          ))}
                        </select>
                        {isSelectedIntcomex && (
                          <select
                            value={selectedProfile || ''}
                            onChange={e => assignUserToEmpresa(selectedUser.id, selectedUser.empresa, e.target.value)}
                            className="h-8 px-2 border border-slate-300 rounded-lg bg-white text-sm"
                          >
                            <option value="">Selecciona perfil Intcomex</option>
                            <option value="ventas">Ventas</option>
                          </select>
                        )}
                        <div className="flex items-center gap-2">
                          <input
                            placeholder="Nueva contraseña"
                            value={usuarioPasswordById[selectedUser.id] || ''}
                            onChange={e => setUsuarioPasswordById(prev => ({ ...prev, [selectedUser.id]: e.target.value }))}
                            className="h-8 px-2 border border-slate-300 rounded-lg bg-white text-sm flex-1"
                          />
                          <button
                            onClick={() => resetUsuarioPassword(selectedUser.id, usuarioPasswordById[selectedUser.id])}
                            disabled={usuariosLoading}
                            className="mq-btn mq-btn-xs mq-btn-secundario"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => toggleUsuarioActivo(selectedUser)}
                            disabled={usuariosLoading || (selectedUser.activo !== false && selectedUser.id === user?.id)}
                            title={selectedUser.id === user?.id ? 'No puedes desactivar tu propia cuenta' : undefined}
                            className="mq-btn mq-btn-xs mq-btn-secundario"
                          >
                            {selectedUser.activo === false ? 'Activar' : 'Desactivar'}
                          </button>
                          <button
                            onClick={() => deleteUsuario(selectedUser.id)}
                            disabled={usuariosLoading || isFixedAdmin}
                            className="mq-btn mq-btn-xs mq-btn-peligro"
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
                    className="mq-btn mq-btn-primario"
                  >
                    {showUsuarioForm ? 'Cerrar' : 'Crear usuario'}
                  </button>
                </div>
                {showUsuarioForm && (
                  <form
                    ref={nuevoUsuarioFormRef}
                    onSubmit={(e) => {
                      e.preventDefault();
                      createUsuario(e.currentTarget);
                    }}
                    className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3"
                  >
                    <input
                      name="nuevo_usuario"
                      autoComplete="username"
                      placeholder="Usuario"
                      value={nuevoUsuario.usuario}
                      onChange={e => setNuevoUsuario(u => ({ ...u, usuario: e.target.value }))}
                      className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                    />
                    <input
                      name="nuevo_nombre"
                      autoComplete="name"
                      placeholder="Nombre"
                      value={nuevoUsuario.nombre}
                      onChange={e => setNuevoUsuario(u => ({ ...u, nombre: e.target.value }))}
                      className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                    />
                    <input
                      name="nuevo_password"
                      placeholder="Contraseña"
                      type="password"
                      autoComplete="new-password"
                      value={nuevoUsuario.password}
                      onChange={e => setNuevoUsuario(u => ({ ...u, password: e.target.value }))}
                      className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                    />
                    <button
                      type="submit"
                      disabled={usuariosLoading}
                      className="mq-btn mq-btn-primario md:col-span-3"
                    >
                      Crear usuario
                    </button>
                    {usuariosError && (
                      <div className="text-xs text-red-600 md:col-span-3">{usuariosError}</div>
                    )}
                  </form>
                )}

                {usuariosLoading ? (
                  <div className="text-xs text-slate-500">Cargando…</div>
                ) : usuariosPage.total === 0 ? (
                  <div className="text-xs text-slate-500">Sin usuarios.</div>
                ) : (
                  <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                    {usuariosPage.rows.map(u => {
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
                              <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                {u.usuario}
                                {u.activo === false && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Inactiva</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500">{u.nombre || 'Sin nombre'}</div>
                              <div className="text-xs text-slate-400">
                                {u.empresa ? `Empresa: ${u.empresa}` : 'Sin empresa'}
                              </div>
                              {normalizeText(u.empresa) === 'intcomex' && normalizeIntcomexProfile(u.intcomex_profile) && (
                                <div className="text-xs text-slate-400">
                                  Perfil: {normalizeIntcomexProfile(u.intcomex_profile)}
                                </div>
                              )}
                            </div>
                            <div className="text-xs uppercase tracking-wide text-slate-400">
                              {u.role === 'admin' ? 'Administrador' : 'Cliente'}
                            </div>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              onClick={() => setSelectedUsuarioId(u.id)}
                              className="mq-btn mq-btn-xs mq-btn-primario"
                            >
                              Editar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="pt-2 flex items-center justify-end gap-2 text-xs">
                      <label htmlFor="page-size-usuarios">Filas</label>
                      <select
                        id="page-size-usuarios"
                        value={usuariosPage.pageSize}
                        onChange={(e) => updateTablePageSize('usuarios', Number(e.target.value))}
                        className="h-8 px-2 border border-slate-300 rounded-lg bg-white text-sm"
                      >
                        <option value={10}>10</option>
                        <option value={15}>15</option>
                        <option value={25}>25</option>
                      </select>
                      <button
                        onClick={() => updateTablePage('usuarios', Math.max(1, usuariosPage.page - 1))}
                        disabled={usuariosPage.page <= 1}
                        className="mq-btn mq-btn-xs mq-btn-secundario"
                      >
                        Anterior
                      </button>
                      <span>Página {usuariosPage.page}/{usuariosPage.totalPages}</span>
                      <button
                        onClick={() => updateTablePage('usuarios', Math.min(usuariosPage.totalPages, usuariosPage.page + 1))}
                        disabled={usuariosPage.page >= usuariosPage.totalPages}
                        className="mq-btn mq-btn-xs mq-btn-secundario"
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <Suspense fallback={<div className="glass-card rounded-2xl border border-white/70 p-4 text-sm text-slate-500">Cargando mapa…</div>}>
              <ConnectionsMap />
            </Suspense>
            <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">Sesiones activas</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => loadActiveSessions()}
                    className="mq-btn mq-btn-sm mq-btn-secundario"
                  >
                    Refrescar
                  </button>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={sessionAutoRefresh}
                      onChange={(e) => setSessionAutoRefresh(e.target.checked)}
                    />
                    Actualización automática (10 s)
                  </label>
                </div>
              </div>
              {sessionsError && <div className="mt-2 text-sm text-rose-600">{sessionsError}</div>}
              <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-4">
                <div className="border border-white/70 rounded-xl p-3 bg-white/70">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-slate-900">Usuarios activos</h3>
                    <span className="text-xs text-slate-500">{sessionsByUser.length}</span>
                  </div>
                  {sessionsLoading ? (
                    <div className="text-sm text-slate-500">Cargando sesiones...</div>
                  ) : sessionsByUser.length === 0 ? (
                    <div className="text-sm text-slate-500">No hay sesiones activas.</div>
                  ) : (
                    <div className="space-y-2">
                      {sessionsByUser.map(item => (
                        <button
                          key={item.userId}
                          onClick={() => setSelectedSessionUserId(item.userId)}
                          className={`w-full text-left p-3 rounded-xl border transition ${selectedSessionUserId === item.userId ? 'border-slate-900 bg-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                        >
                          <div className="text-sm font-semibold text-slate-900">{item.nombre || item.usuario || 'Usuario'}</div>
                          <div className="text-xs text-slate-500">{item.empresa || 'Sin empresa'} - {item.role || 'client'}</div>
                          <div className="text-xs text-slate-500">
                            Sesiones: {item.sessions.length} · Última actividad: {formatDateTime(item.lastSeen)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  <div className="border border-white/70 rounded-xl p-3 bg-white/70">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-base font-semibold text-slate-900">Sesiones del usuario</h3>
                      <button
                        onClick={() => loadUserActivity(selectedSessionUserId)}
                        className="mq-btn mq-btn-xs mq-btn-secundario"
                      >
                        Actualizar
                      </button>
                    </div>
                    {userActivityLoading ? (
                      <div className="text-sm text-slate-500">Cargando actividad...</div>
                    ) : userActivityError ? (
                      <div className="text-sm text-rose-600">{userActivityError}</div>
                    ) : userSessions.length === 0 ? (
                      <div className="text-sm text-slate-500">Selecciona un usuario con sesiones activas.</div>
                    ) : (
                      <div className="space-y-2">
                        {userSessions.map(session => (
                          <div key={session.session_id} className="p-3 rounded-xl border border-white/70 bg-white/70">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-900">
                                  Ses. #{(session.session_id || '').toString().slice(-6)}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {session.device_id || 'Dispositivo N/A'} - {session.ip_address || 'IP N/A'}
                                </div>
                                <div className="text-xs text-slate-500">
                                  Inicio: {formatDateTime(session.started_at)} · Última: {formatDateTime(session.last_seen)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${session.active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                  {session.active ? 'Activa' : 'Inactiva'}
                                </span>
                                {session.active && (
                                  <button
                                    onClick={() => revokeSession(session.session_id)}
                                    className="mq-btn mq-btn-xs mq-btn-peligro"
                                  >
                                    Cerrar
                                  </button>
                                )}
                              </div>
                            </div>
                            {session.user_agent && (
                              <div className="mt-2 text-xs text-slate-500">UA: {session.user_agent}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border border-white/70 rounded-xl p-3 bg-white/70">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-base font-semibold text-slate-900">Logs de acceso</h3>
                      <span className="text-xs text-slate-500">{userLogs.length}</span>
                    </div>
                    {userActivityLoading ? (
                      <div className="text-sm text-slate-500">Cargando logs...</div>
                    ) : userLogs.length === 0 ? (
                      <div className="text-sm text-slate-500">Sin registros para este usuario.</div>
                    ) : (
                      <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                        {userLogs.map(log => (
                          <div key={log.id} className="p-3 rounded-xl border border-white/70 bg-white/70">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold text-slate-900">
                                {log.success ? 'Login OK' : 'Login fallido'}
                              </div>
                              <span className="text-xs text-slate-500">{formatDateTime(log.created_at)}</span>
                            </div>
                            <div className="text-xs text-slate-500">
                              IP: {log.ip_address || 'N/A'} · Sesión: {(log.session_id || '').toString().slice(-6) || 'N/A'}
                            </div>
                            {log.user_agent && (
                              <div className="text-xs text-slate-500 mt-1">UA: {log.user_agent}</div>
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
        {currentView === 'admin' && isFullAdmin && (
          <div className="space-y-4 view-enter">
            <EncabezadoPagina seccion="Administración" titulo="Listas de precio" subtitulo="Productos QNAP y AXIS sincronizados desde el Excel maestro." />
            <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <button
                  onClick={() => setAdminOrigin('QNAP')}
                  className={`mq-btn mq-btn-sm ${adminOrigin === 'QNAP' ? 'mq-btn-primario' : 'mq-btn-fantasma'}`}
                >
                  QNAP
                </button>
                <button
                  onClick={() => setAdminOrigin('AXIS')}
                  className={`mq-btn mq-btn-sm ${adminOrigin === 'AXIS' ? 'mq-btn-primario' : 'mq-btn-fantasma'}`}
                >
                  AXIS
                </button>
                <a
                  href="https://docs.google.com/spreadsheets/d/1cSAaO8GbWFKuboZzhQcyc2CuSD38xtQv8ELjO33G2U0/edit?gid=0#gid=0"
                  target="_blank"
                  rel="noreferrer"
                  className="mq-btn mq-btn-sm mq-btn-secundario sm:ml-auto"
                >
                  Abrir Excel maestro
                </a>
                <button
                  onClick={() => syncFromSheetsOrigin('QNAP')}
                  disabled={saving}
                  className="mq-btn mq-btn-sm mq-btn-secundario"
                >
                  Sync rápido QNAP
                </button>
                <button
                  onClick={() => syncFromSheetsOrigin('AXIS')}
                  disabled={saving}
                  className="mq-btn mq-btn-sm mq-btn-secundario"
                >
                  Sync rápido AXIS
                </button>
              </div>
              {showAddForm && (
                <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
                  <h3 className="text-base font-semibold text-slate-900 mb-3">Nuevo producto</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <input placeholder="Marca" value={newProduct.marca} onChange={e => setNewProduct(p => ({ ...p, marca: e.target.value }))} className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                    <input placeholder="SKU *" value={newProduct.sku} onChange={e => setNewProduct(p => ({ ...p, sku: e.target.value }))} className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                    <input placeholder="MPN" value={newProduct.mpn} onChange={e => setNewProduct(p => ({ ...p, mpn: e.target.value }))} className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                    <input placeholder="Descripción" value={newProduct.desc} onChange={e => setNewProduct(p => ({ ...p, desc: e.target.value }))} className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                    <input type="number" placeholder="Precio Disty" value={newProduct.precio} onChange={e => setNewProduct(p => ({ ...p, precio: e.target.value }))} className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                    <input placeholder="GP % (ej: 15)" value={newProduct.gp} onChange={e => setNewProduct(p => ({ ...p, gp: e.target.value }))} className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                    <input placeholder="Tiempo Entrega" value={newProduct.tiempo} onChange={e => setNewProduct(p => ({ ...p, tiempo: e.target.value }))} className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={handleAddProduct} disabled={saving} className="mq-btn mq-btn-primario">
                      {saving ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button onClick={() => setShowAddForm(false)} className="mq-btn mq-btn-secundario">Cancelar</button>
                  </div>
                </div>
              )}
            </div>
            <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Parámetros de cálculo</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-700">Inbound Freight</label>
                  <input
                    type="number"
                    step="0.001"
                    value={adminOrigin === 'AXIS' ? AXIS_CONSTANTS.INBOUND_FREIGHT : (Number.isFinite(calcParams.INBOUND_FREIGHT) ? calcParams.INBOUND_FREIGHT : '')}
                    onChange={e => updateCalcParam('INBOUND_FREIGHT', e.target.value)}
                    className="h-10 w-full px-3 border border-slate-300 rounded-lg bg-white text-sm tabular-nums"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-700">IC</label>
                  <input
                    type="number"
                    step="0.001"
                    value={adminOrigin === 'AXIS' ? AXIS_CONSTANTS.IC : (Number.isFinite(calcParams.IC) ? calcParams.IC : '')}
                    onChange={e => updateCalcParam('IC', e.target.value)}
                    className="h-10 w-full px-3 border border-slate-300 rounded-lg bg-white text-sm tabular-nums"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-700">INT (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={adminOrigin === 'AXIS' ? (AXIS_CONSTANTS.INT * 100) : (Number.isFinite(calcParams.INT) ? (calcParams.INT * 100) : '')}
                    onChange={e => updateCalcParam('INT', e.target.value, true)}
                    className="h-10 w-full px-3 border border-slate-300 rounded-lg bg-white text-sm tabular-nums"
                  />
                </div>
              </div>
            </div>
            <div className="glass-card rounded-2xl shadow-card border border-white/70 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base font-semibold text-slate-900">Catálogo <span className="font-normal text-slate-500">({adminProductos.length})</span></h3>
                {isAdmin ? (
                  <input
                    type="text"
                    aria-label="Buscar"
                    placeholder="Buscar…"
                    value={globalSearch}
                    onChange={e => setGlobalSearch(e.target.value)}
                    className="h-9 w-56 px-3 border border-slate-300 rounded-lg bg-white text-sm"
                  />
                ) : (
                  <input type="text" aria-label="Buscar productos" placeholder="Buscar…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-9 w-56 px-3 border border-slate-300 rounded-lg bg-white text-sm" />
                )}
              </div>
              {selectedIds.size > 1 && (
                <div className="px-3 py-2 border-b bg-white">
                  <button
                    onClick={deleteSelectedProducts}
                    disabled={saving}
                    className="mq-btn mq-btn-xs mq-btn-peligro"
                  >
                    Eliminar seleccionados ({selectedIds.size})
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
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
                  <tbody className="divide-y divide-slate-100">
                    {productosPage.total === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">{adminProductos.length === 0 ? 'No hay productos. Cargue un Excel o agregue uno.' : 'Sin resultados.'}</td></tr>
                    ) : productosPage.rows.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        {editingId === p.id ? (
                          <>
                            <td className="px-2 py-1 text-center">
                              <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelectOne(p.id)} />
                            </td>
                            <td className="px-2 py-1"><input value={editForm.marca} onChange={e => setEditForm(f => ({ ...f, marca: e.target.value }))} className="w-full h-8 px-2 border border-slate-300 rounded-md bg-white text-sm" /></td>
                            <td className="px-2 py-1"><input value={editForm.sku} onChange={e => setEditForm(f => ({ ...f, sku: e.target.value }))} className="w-full h-8 px-2 border border-slate-300 rounded-md bg-white text-sm" /></td>
                            <td className="px-2 py-1"><input value={editForm.mpn} onChange={e => setEditForm(f => ({ ...f, mpn: e.target.value }))} className="w-full h-8 px-2 border border-slate-300 rounded-md bg-white text-sm" /></td>
                            <td className="px-2 py-1"><input value={editForm.desc} onChange={e => setEditForm(f => ({ ...f, desc: e.target.value }))} className="w-full h-8 px-2 border border-slate-300 rounded-md bg-white text-sm" /></td>
                            <td className="px-2 py-1"><input type="number" value={editForm.precio} onChange={e => setEditForm(f => ({ ...f, precio: e.target.value }))} className="w-20 h-8 px-2 border border-slate-300 rounded-md bg-white text-sm text-right" /></td>
                            <td className="px-2 py-1 text-right text-slate-600">{formatCurrency(calcularPrecioClienteLocal(parseFloat(editForm.precio) || 0, calcParams.DEFAULT_GP))}</td>
                            <td className="px-2 py-1 text-center">
                              <button onClick={saveEdit} disabled={saving} className="mq-btn mq-btn-xs mq-btn-primario">Guardar</button>
                              <button onClick={() => setEditingId(null)} className="mq-btn mq-btn-xs mq-btn-fantasma">Cancelar</button>
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
                            <td className="px-3 py-2 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(calcularPrecioAdmin(p))}</td>
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => startEdit(p)} className="mq-btn mq-btn-xs mq-btn-fantasma text-slate-900">Editar</button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t flex items-center justify-between flex-wrap gap-2">
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span>{selectedIds.size > 0 ? `${selectedIds.size} seleccionados` : 'Sin seleccionados'}</span>
                  {filteredProductos.length > 0 && (
                    <button
                      onClick={toggleSelectAllFiltered}
                      className="mq-btn mq-btn-xs mq-btn-fantasma"
                    >
                      Seleccionar todo
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <label htmlFor="page-size-productos">Filas</label>
                  <select
                    id="page-size-productos"
                    value={productosPage.pageSize}
                    onChange={(e) => updateTablePageSize('productos', Number(e.target.value))}
                    className="h-8 px-2 border border-slate-300 rounded-lg bg-white text-sm"
                  >
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={25}>25</option>
                  </select>
                  <button
                    onClick={() => updateTablePage('productos', Math.max(1, productosPage.page - 1))}
                    disabled={productosPage.page <= 1}
                    className="mq-btn mq-btn-xs mq-btn-secundario"
                  >
                    Anterior
                  </button>
                  <span>Página {productosPage.page}/{productosPage.totalPages}</span>
                  <button
                    onClick={() => updateTablePage('productos', Math.min(productosPage.totalPages, productosPage.page + 1))}
                    disabled={productosPage.page >= productosPage.totalPages}
                    className="mq-btn mq-btn-xs mq-btn-secundario"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'historial' && !isFullAdmin && (
          <div className="space-y-4 view-enter">
            <EncabezadoPagina
              seccion="Ventas"
              titulo="Mis cotizaciones"
              subtitulo="Las cotizaciones que has generado y su etapa."
            >
              {canViewCotizador && (
                <button type="button" onClick={() => setCurrentView('cotizador')} className="mq-btn mq-btn-primario">Nueva cotización</button>
              )}
            </EncabezadoPagina>
            {renderHistorialContenido()}
          </div>
        )}

        {(currentView === 'ordenes' || currentView === 'compras') && isFullAdmin && (
          <Suspense fallback={<div className="text-sm text-slate-500 p-4">Cargando…</div>}>
            <OrdenesComprasView
              modo={currentView}
              isAdmin={isAdmin}
              isFullAdmin={isFullAdmin}
              globalSearch={globalSearch}
              setGlobalSearch={setGlobalSearch}
              globalQuery={globalQuery}
              getDateKey={getDateKey}
              downloadPdfFromElement={downloadPdfFromElement}
              copyHtmlToClipboard={copyHtmlToClipboard}
            />
          </Suspense>
        )}

        {currentView === 'cotizador' && (
          <div className="view-enter">
            <EncabezadoPagina
              seccion="Ventas"
              titulo="Cotización"
              subtitulo={(cliente.empresa?.trim() || cliente.nombre?.trim())
                ? `${cliente.empresa?.trim() || 'Empresa'} · ${cliente.nombre?.trim() || 'Cliente'}`
                : 'Completa los datos del cliente para comenzar.'}
            >
              {isAdmin && (
                <>
                  <label
                    htmlFor="project-upload"
                    className="mq-btn mq-btn-sm mq-btn-secundario"
                  >
                    <Icono nombre="subir" /> Cargar proyecto
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
            </EncabezadoPagina>

            <div className="space-y-3">
            <section className="glass-card rounded-2xl shadow-card border border-white/70 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="mq-sobre">Cliente</h3>
              </div>
              <div className={`grid grid-cols-1 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : ''} gap-2`}>
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
                          className={`${fieldInputClass} ${!canEditClienteBase ? 'bg-slate-50 text-slate-500' : ''}`}
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
                          className={`${fieldInputClass} ${!canEditClienteBase ? 'bg-slate-50 text-slate-500' : ''}`}
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
                        <div className="sm:col-span-2 flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => setShowProjectRegistro(v => !v)}
                            aria-expanded={showProjectRegistro}
                            className="mq-btn mq-btn-sm mq-btn-fantasma self-start text-slate-900"
                          >
                            {showProjectRegistro ? '− Ocultar registro de proyecto' : '+ Registrar proyecto'}
                          </button>
                          {showProjectRegistro && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                              <label className={`${fieldLabelClass} sm:col-span-2`}>
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
            </section>

            <section className="glass-card rounded-2xl shadow-card border border-white/70">
              {/* Barra de herramientas: fija arriba al bajar por el carrito (escritorio). */}
              <div className="lg:sticky lg:top-14 z-20 rounded-t-2xl border-b border-slate-200/80 bg-white/95 backdrop-blur px-3 py-3 space-y-2 dark:bg-slate-900/95 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar por SKU, MPN o modelo… (o pega una lista)"
                      value={catalogSearch}
                      onChange={e => { setCatalogSearch(e.target.value); setCatalogActivo(0); }}
                      onPaste={e => {
                        const texto = e.clipboardData?.getData('text') || '';
                        if (pareceLista(texto)) {
                          e.preventDefault();
                          setPegarListaTexto(texto);
                        }
                      }}
                      onKeyDown={e => {
                        const visibles = filteredCatalogo.slice(0, 50);
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setCatalogActivo(i => Math.min(i + 1, visibles.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setCatalogActivo(i => Math.max(i - 1, 0));
                        } else if (e.key === 'Enter' && catalogSearch.trim() && visibles[catalogActivo]) {
                          e.preventDefault();
                          const p = visibles[catalogActivo];
                          addToCotizacion(p);
                          setCatalogSearch('');
                          setCatalogActivo(0);
                          notify(`Agregado ${p.sku || p.mpn}`, { tipo: 'ok', duracion: 1800 });
                        } else if (e.key === 'Escape') {
                          setCatalogSearch('');
                        }
                      }}
                      id="catalog-search" ref={catalogInputRef}
                      role="combobox"
                      aria-expanded={catalogSearch.trim() !== ''}
                      aria-controls="catalog-resultados"
                      autoComplete="off"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100"
                    />
                    <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline rounded border border-slate-300 px-1.5 font-mono text-xs text-slate-400 dark:border-slate-600">/</kbd>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPegarListaTexto('')}
                    className="mq-btn mq-btn-lg mq-btn-secundario shrink-0"
                    aria-label="Pegar lista"
                    title="Pega SKU y cantidades desde un correo o Excel"
                  >
                    <Icono nombre="portapapeles" />
                    <span className="hidden sm:inline">Pegar lista</span>
                  </button>
                  {puedeCargarQuotes && (
                    <button
                      type="button"
                      onClick={() => setQuoteAbierto(true)}
                      className="mq-btn mq-btn-lg mq-btn-secundario shrink-0"
                      title="Cargar el quote de ISS, Neural Labs o Milestone"
                    >
                      <Icono nombre="portapapeles" />
                      <span className="hidden sm:inline">Cargar quote</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    {(isAdmin || isVentasUser) && (
                      <CollapsibleFilters label="Ajustes">
                        {isAdmin && (
                          <div className="flex items-center gap-3 flex-wrap">
                            {!isCotizadorStockAdmin && (
                              <GpGlobalCampo
                                etiqueta="GP QNAP"
                                gp={cotizacionGpGlobalQnap}
                                onCambio={v => updateGlobalMargin('QNAP', v)}
                              />
                            )}
                            <GpGlobalCampo
                              etiqueta="GP AXIS"
                              gp={cotizacionGpGlobalAxis}
                              onCambio={v => updateGlobalMargin('AXIS', v)}
                            />
                            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                              Partner
                              <select
                                value={cotizacionPartnerCategory}
                                onChange={e => handleCotizacionPartnerCategoryChange(e.target.value)}
                                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                              >
                                <option>Partner Autorizado</option>
                                <option>Partner Silver</option>
                                <option>Partner Gold</option>
                                <option>Partner Multiregional</option>
                              </select>
                            </label>
                            {isFullAdmin && (
                              <button
                                type="button"
                                onClick={() => setSemaforoAbierto(v => !v)}
                                aria-expanded={semaforoAbierto}
                                className={`mq-btn mq-btn-sm ${semaforoAbierto ? 'mq-btn-primario' : 'mq-btn-fantasma'}`}
                                title="Mínimo aceptable y objetivo de margen"
                              >
                                <Icono nombre="ajustes" /> Semáforo de margen
                              </button>
                            )}
                          </div>
                        )}
                        {isVentasUser && (
                          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                            Partner AXIS
                            <select
                              value={cotizacionPartnerCategory}
                              onChange={e => handleCotizacionPartnerCategoryChange(e.target.value)}
                              disabled={updatingCotizacionPartner}
                              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            >
                              <option>Partner Autorizado</option>
                              <option>Partner Silver</option>
                              <option>Partner Gold</option>
                              <option>Partner Multiregional</option>
                            </select>
                          </label>
                        )}
                      </CollapsibleFilters>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {cotizacion.length > 0 && (
                      <span>{cotizacion.length} producto{cotizacion.length === 1 ? '' : 's'}</span>
                    )}
                    <button
                      onClick={clearCotizacion}
                      disabled={cotizacion.length === 0}
                      className="mq-btn mq-btn-xs mq-btn-peligro"
                    >
                      Vaciar carrito
                    </button>
                  </div>
                </div>
                {isFullAdmin && semaforoAbierto && <SemaforoMargenAjustes />}

                {catalogSearch.trim() !== '' && catalogDropdownStyle && createPortal(
                  <div id="catalog-resultados" role="listbox" style={catalogDropdownStyle} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredCatalogo.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500">
                        Sin resultados para «{catalogSearch.trim()}». Prueba con el MPN o parte del modelo.
                      </div>
                    ) : filteredCatalogo.slice(0, 50).map((p, i) => {
                      const disponible = Number(stockByMpn[normalizeLookupKey(p.mpn)]) || 0;
                      const enCarrito = cotizacion.find(x => x.id === p.id);
                      return (
                        <button
                          key={p.id}
                          role="option"
                          aria-selected={i === catalogActivo}
                          onMouseDown={e => e.preventDefault()}
                          onMouseEnter={() => setCatalogActivo(i)}
                          onClick={() => {
                            addToCotizacion(p);
                            setCatalogSearch('');
                            setCatalogActivo(0);
                            // El foco vuelve al buscador: se sigue escribiendo el siguiente producto.
                            catalogInputRef.current?.focus();
                            notify(`Agregado ${p.sku || p.mpn}`, { tipo: 'ok', duracion: 1800 });
                          }}
                          className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 ${i === catalogActivo ? 'bg-slate-100' : ''}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`shrink-0 text-xs font-semibold px-1.5 rounded ${(p.origen || 'QNAP') === 'AXIS' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'}`}>{p.marca}</span>
                              <span className="font-mono text-xs text-slate-500 truncate">
                                <Resaltado texto={p.sku} busqueda={catalogSearch} /> · <Resaltado texto={p.mpn} busqueda={catalogSearch} />
                              </span>
                              {enCarrito && (
                                <span className="shrink-0 text-[11px] font-medium text-blue-700 dark:text-blue-300">×{enCarrito.cant} en carrito</span>
                              )}
                            </div>
                            <p className="text-sm text-slate-800 dark:text-slate-100 truncate">
                              <Resaltado texto={p.desc} busqueda={catalogSearch} />
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(calcularPrecioCatalogo(p))}</p>
                            {disponible > 0 ? (
                              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">● {disponible} disp.</p>
                            ) : (
                              <p className="text-xs text-slate-400 max-w-[11rem] truncate" title={p.tiempo}>{p.tiempo || 'ETA por confirmar'}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>,
                  document.body
                )}
              </div>
              <div className="overflow-hidden rounded-b-2xl">
                <CarritoLineas
                  items={cotizacion}
                  isAdmin={isAdmin}
                  precioItem={calcularPrecioClienteItem}
                  margenItem={margenItem}
                  gpBase={(item) => gpBaseDeOrigen(item.origen, gpGlobales)}
                  rebatePartner={getAxisPartnerRebate}
                  partnerDefault={cotizacionPartnerCategory}
                  alertaLinea={alertaLineaCarrito}
                  onCambio={cambiarLineaCarrito}
                  onQuitar={removeItem}
                  onMover={moverLineaCarrito}
                />
              </div>
            </section>

            {/* Total siempre a la vista mientras se arma la cotización. */}
            {cotizacion.length > 0 && (
              <div className={`sticky ${isClient ? 'bottom-20' : 'bottom-20 lg:bottom-3'} z-30`}>
                <div className="flex items-center justify-between gap-3 flex-wrap rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-float">
                  <div className="flex items-center gap-x-5 gap-y-1 flex-wrap min-w-0">
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total</div>
                      <div className="text-[22px] leading-7 font-bold text-slate-900 tabular-nums">{formatCurrency(totalCotizacion)}</div>
                    </div>
                    {resumenMargenCarrito && (
                      <>
                        <div className="hidden xl:block">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Costo</div>
                          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatCurrency(resumenMargenCarrito.costo)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Margen</div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatCurrency(resumenMargenCarrito.margen)}</span>
                            <MargenChip gpPct={resumenMargenCarrito.gpPct} origen={resumenMargenCarrito.origenes} />
                          </div>
                        </div>
                        {(() => {
                          const bajoPiso = problemasEnvio().bajoPiso.length;
                          return bajoPiso > 0 ? (
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30">
                              {bajoPiso} línea{bajoPiso === 1 ? '' : 's'} bajo el mínimo
                            </span>
                          ) : null;
                        })()}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    {isAdmin && (
                      <button
                        onClick={exportCotizacionAxis}
                        className="mq-btn mq-btn-secundario"
                      >
                        Exportar a Axis
                      </button>
                    )}
                    <button
                      onClick={() => generarCotizacion()}
                      title="Ctrl+Enter"
                      className="mq-btn mq-btn-primario px-5"
                    >
                      Generar cotización
                    </button>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        )}

        {currentView === 'cuenta' && canViewAccount && (
          <div className="space-y-4 view-enter">
            <EncabezadoPagina seccion="Cuenta" titulo="Mi cuenta" subtitulo="Tus datos, nivel de partner y contraseña." />
            <div className="glass-card rounded-2xl shadow-card border border-white/70 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h3 className="text-base font-semibold text-slate-900">Datos</h3>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Nombre
                  <input
                    value={user?.nombre || user?.usuario || ''}
                    readOnly
                    className="h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 bg-slate-50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Empresa
                  <input
                    value={user?.empresa || ''}
                    readOnly
                    className="h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 bg-slate-50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Nivel de partner
                  {canEditPartnerCategory ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={ownPartnerCategory}
                        onChange={e => setOwnPartnerCategory(e.target.value)}
                        className="h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white flex-1"
                      >
                        <option>Partner Autorizado</option>
                        <option>Partner Silver</option>
                        <option>Partner Gold</option>
                        <option>Partner Multiregional</option>
                      </select>
                      <button
                        onClick={updateOwnPartnerCategory}
                        disabled={updatingOwnPartnerCategory}
                        className="mq-btn mq-btn-primario"
                      >
                        Guardar
                      </button>
                    </div>
                  ) : (
                    <input
                      value={user?.partner_category || 'Partner Autorizado'}
                      readOnly
                      className="h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 bg-slate-50"
                    />
                  )}
                </label>
              </div>
            </div>

            <div className="glass-card rounded-2xl shadow-card border border-white/70 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h3 className="text-base font-semibold text-slate-900">Cambiar contraseña</h3>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                <label className="flex flex-col gap-1 text-xs text-slate-500 md:col-span-2">
                  Contraseña actual
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={accountPasswordCurrent}
                    onChange={e => setAccountPasswordCurrent(e.target.value)}
                    className="h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Nueva contraseña
                  <input
                    type="password"
                    value={accountPassword}
                    onChange={e => setAccountPassword(e.target.value)}
                    className="h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Confirmar contraseña
                  <input
                    type="password"
                    value={accountPasswordConfirm}
                    onChange={e => setAccountPasswordConfirm(e.target.value)}
                    className="h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white"
                  />
                </label>
                <div>
                  <button
                    onClick={updateOwnPassword}
                    disabled={saving}
                    className="mq-btn mq-btn-primario"
                  >
                    Guardar contraseña
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {projectRegistroModal && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] p-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-float w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Registro de proyecto</h3>
                <button
                  onClick={() => setProjectRegistroModal(null)}
                  className="mq-btn mq-btn-sm mq-btn-fantasma"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Cliente final</div>
                  <div className="font-semibold text-slate-800">{projectRegistroModal.cliente_final || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Nombre del proyecto</div>
                  <div className="font-semibold text-slate-800">{projectRegistroModal.cliente_telefono || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Fecha ejecución</div>
                  <div className="font-semibold text-slate-800">{projectRegistroModal.fecha_ejecucion || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Fecha implementación</div>
                  <div className="font-semibold text-slate-800">{projectRegistroModal.fecha_implementacion || 'N/A'}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-slate-500">VMS a utilizar</div>
                  <div className="font-semibold text-slate-800">{projectRegistroModal.vms || 'N/A'}</div>
                </div>
                <div className="md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600">
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
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] p-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-float w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-scale-in">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Enviar a compras</h3>
                <button onClick={() => setCompraPreviewCot(null)} className="mq-btn mq-btn-sm mq-btn-fantasma">Cerrar</button>
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
                  className="border rounded-lg p-3 bg-slate-50 text-sm"
                  dangerouslySetInnerHTML={{ __html: sanitizeCompraHtml(buildCompraHtml(compraPreviewCot)) }}
                ></div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => copyHtmlToClipboard(buildCompraTableHtml(compraPreviewCot))}
                    className="mq-btn mq-btn-sm mq-btn-primario"
                  >
                    Copiar tabla HTML
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(`Compra ${getCompraOrigenLabel(compraPreviewCot)} - BO ${(boByCotizacionId[compraPreviewCot.id] || '').trim() || compraPreviewCot.id || 'XXXX'}`)}
                    className="mq-btn mq-btn-sm mq-btn-secundario"
                  >
                    Copiar asunto
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText('juan.parral@intcomex.com')}
                    className="mq-btn mq-btn-sm mq-btn-secundario"
                  >
                    Copiar destinatario
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </main>
        {/* El footer va DENTRO de la columna de contenido: como hermano del sidebar
            en la fila flex, su texto largo se quedaba con el ancho y dejaba el
            contenido del cliente en 0px. */}
        {!isAdmin && (
          <footer className="mt-auto px-4 py-3 pb-24 lg:pb-3 lg:pr-56 text-[11px] leading-4 text-slate-500 border-t border-slate-200">
            <div className="max-w-5xl">
              <p>
                Plataforma de gestión de cotizaciones comerciales diseñada para la emisión de propuestas formales.
                Solución desarrollada como iniciativa de optimización de procesos comerciales por Alexis González – Product Manager.
                Las cotizaciones generadas están sujetas a validación comercial, disponibilidad de stock y condiciones vigentes al momento de la confirmación.
              </p>
            </div>
          </footer>
        )}
      </div>
    </div>
    </CotizadorContext.Provider>
  );
}





























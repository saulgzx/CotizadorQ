import React, { useState, useEffect, useMemo } from 'react';
import { osoAPI, boMetaAPI, boLineMetaAPI } from '../../api';
import { safeJsonParseArray } from '../cotizador/cotizadorHelpers';
import { notify } from '../ui/toast';
import PantallazoMontos, { esHoja } from '../cotizador/PantallazoMontos';
import { leerPantallazo } from '../cotizador/leerPantallazo';
import { leerMontosDeExcel } from '../cotizador/leerExcelMontos';
import { calzarMontos } from '../cotizador/pantallazoMontos';
import EncabezadoPagina from '../ui/EncabezadoPagina';
import { EstadoVacio, ListaEsqueleto } from '../ui/Esqueleto';
import {
  aplicarMontosGuardados,
  borradorSucio,
  cambiarBorrador,
  claveLinea,
  construirPayloadMontos,
  fusionarAsignaciones,
  normalizarMontoLinea,
  numeroMonto,
  resumirLectura,
  valorMonto
} from '../cotizador/montosOrden';
import {
  calcularEstadisticasOso,
  claveMes,
  contarEstadosOrdenes,
  empresasOso,
  estadoOrden,
  estadoSAndD,
  filasReporteLineas,
  filtrarOrdenarOrdenesOso,
  htmlSAndD,
  mesFacturacionDeBo,
  metaDeOrden,
  metaSucia,
  nombreClienteOrden,
  normalizarMesFacturacion,
  normalizarSemanaFacturacion,
  opcionesMesFacturacion,
  ordenarFacturadas,
  ordenesFacturadasFueraDeLista,
  porcentajeAsignadoOrden,
  procesarCargaOso,
  semanaFacturacionDeBo,
  tramoAsignacion,
  totalesOrden
} from './ordenesOso';

const DEFAULT_PAGE_SIZE = 15;

// xlsx (SheetJS) se carga bajo demanda para sacar ~400KB del bundle inicial.
let _xlsxModulePromise = null;
const getXLSX = () => {
  if (!_xlsxModulePromise) _xlsxModulePromise = import('xlsx');
  return _xlsxModulePromise;
};

// Vistas Órdenes y Vista compras. Una sola instancia para las dos (modo = 'ordenes' | 'compras'),
// así los borradores sin guardar sobreviven al pasar de una a otra.
export default function OrdenesComprasView({
  modo,
  isAdmin,
  isFullAdmin,
  globalSearch,
  setGlobalSearch,
  globalQuery,
  getDateKey,
  downloadPdfFromElement,
  copyHtmlToClipboard
}) {
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
    return safeJsonParseArray(localStorage.getItem('pinnedBos'), []);
  });
  const [boMeta, setBoMeta] = useState({});
  const [boDraft, setBoDraft] = useState({});
  const [boSaving, setBoSaving] = useState({});
  const [axisDraft, setAxisDraft] = useState({});
  const [intcomexDraft, setIntcomexDraft] = useState({});
  const [purchaseDraft, setPurchaseDraft] = useState({});
  // Paginación propia de la vista (antes compartía pageByTable con otras tablas).
  const [pageByTable, setPageByTable] = useState({ ordenes: 1 });
  const [pageSizeByTable, setPageSizeByTable] = useState({ ordenes: DEFAULT_PAGE_SIZE });

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
    if (modo !== 'ordenes') return undefined;
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
  }, [modo, expandedBo, osoOrders]);

  const invoicedBos = useMemo(
    () => ordenesFacturadasFueraDeLista(boMeta, osoOrders),
    [boMeta, osoOrders]
  );

  const getOrderStatus = (order) => estadoOrden(order);

  const sortedInvoicedBos = useMemo(
    () => ordenarFacturadas(invoicedBos, invoicedSort, invoicedFilter),
    [invoicedBos, invoicedSort, invoicedFilter]
  );

  const osoStats = useMemo(() => contarEstadosOrdenes(osoOrders), [osoOrders]);

  const safePinnedBos = useMemo(() => (Array.isArray(pinnedBos) ? pinnedBos : []), [pinnedBos]);

  const getOsoMeta = (bo) => metaDeOrden(boMeta, boDraft, bo);

  const normalizeInvoiceMonthValue = normalizarMesFacturacion;

  const normalizeInvoiceWeekValue = normalizarSemanaFacturacion;

  const getBoInvoiceMonth = (bo) => mesFacturacionDeBo(boMeta, boDraft, bo);

  const getBoInvoiceWeek = (bo) => semanaFacturacionDeBo(boMeta, boDraft, bo);

  const invoiceMonthOptions = useMemo(
    () => opcionesMesFacturacion(boMeta, boDraft),
    [boMeta, boDraft]
  );

  const isBoMetaDirty = (bo) => metaSucia(boMeta, boDraft, bo);

  const getOsoCustomerName = (order) => nombreClienteOrden(order, boMeta, boDraft);

  const filteredOsoOrders = useMemo(() => filtrarOrdenarOrdenesOso(osoOrders, {
    boMeta,
    boDraft,
    texto: osoFilter,
    esAdmin: isAdmin,
    empresa: osoCompanyFilter,
    estado: osoStatusFilter,
    filtroRapido: osoQuickFilter,
    mesFacturacion: osoInvoiceMonth,
    orden: osoSort,
    busquedaGlobal: globalQuery
  }), [osoOrders, osoFilter, osoStatusFilter, osoSort, osoQuickFilter, osoInvoiceMonth, boMeta, boDraft, osoCompanyFilter, globalQuery, isAdmin]);

  const osoCompanies = useMemo(
    () => empresasOso(osoOrders, boMeta, boDraft),
    [osoOrders, boMeta, boDraft]
  );

  const getOsoOrderTotals = (order) => totalesOrden(order);

  const getOsoAllocPct = (order, totals) =>
    porcentajeAsignadoOrden(order, totals, getOsoMeta(order?.bo));

  const normalizeAxisAmount = normalizarMontoLinea;

  const getAxisLineKey = claveLinea;

  const getAxisDraftValue = (bo, lineKey) => {
    const draft = axisDraft[bo];
    if (!draft) return undefined;
    return draft[lineKey];
  };

  const getAxisMontoValue = (bo, line) => {
    if (!bo || !line) return '';
    return valorMonto(axisDraft[bo], line, 'montoAxis');
  };

  const getAxisMontoNumber = (bo, line) => {
    if (!bo || !line) return 0;
    return numeroMonto(axisDraft[bo], line, 'montoAxis');
  };

  const getIntcomexDraftValue = (bo, lineKey) => {
    const draft = intcomexDraft[bo];
    if (!draft) return undefined;
    return draft[lineKey];
  };

  const getIntcomexMontoValue = (bo, line) => {
    if (!bo || !line) return '';
    return valorMonto(intcomexDraft[bo], line, 'montoIntcomex');
  };

  const getIntcomexMontoNumber = (bo, line) => {
    if (!bo || !line) return 0;
    return numeroMonto(intcomexDraft[bo], line, 'montoIntcomex');
  };

  // --- Carga de montos desde un archivo --------------------------------------
  // Dos caminos según el archivo:
  //  - Excel: se parsea en el navegador. Los números están en celdas, no hay nada
  //    que interpretar, así que es exacto, instantáneo y no depende de la miniPC.
  //  - PDF o imagen: va a la cola del asistente y la lee Claude Code en la miniPC.
  // En los dos casos solo se prellenan los BORRADORES: nada se guarda hasta que
  // Alexis revise y apriete Guardar.

  const leerPantallazoDeOrden = (order, campo) => async (file) => {
    const lineas = order?.lines || [];
    if (esHoja(file)) {
      const hoja = await leerMontosDeExcel(file);
      return { ...calzarMontos({ filas: hoja.filas, lineas }), ...hoja, origen: 'excel' };
    }
    return leerPantallazo({
      file,
      campo,
      marca: ['AXIS', 'QNAP'].includes(String(order?.brand || '').toUpperCase())
        ? String(order.brand).toUpperCase()
        : 'AXIS',
      lineas
    });
  };

  const aplicarPantallazo = (order, campo) => (resultado) => {
    const asignaciones = resultado?.asignaciones || {};
    if (Object.keys(asignaciones).length) {
      const setDraft = campo === 'axis' ? setAxisDraft : setIntcomexDraft;
      setDraft(prev => fusionarAsignaciones(prev, order.bo, asignaciones));
    }
    const { mensaje, tipo } = resumirLectura(resultado);
    notify(mensaje, { tipo });
  };

  const updateAxisDraft = (bo, lineKey, value) => {
    if (!bo && bo !== 0) return;
    setAxisDraft(prev => cambiarBorrador(prev, bo, lineKey, value));
  };

  const updateIntcomexDraft = (bo, lineKey, value) => {
    if (!bo && bo !== 0) return;
    setIntcomexDraft(prev => cambiarBorrador(prev, bo, lineKey, value));
  };

  const isAxisDirty = (order) => {
    const bo = order?.bo;
    if (!bo) return false;
    return borradorSucio(order, axisDraft[bo], 'montoAxis');
  };

  const isIntcomexDirty = (order) => {
    const bo = order?.bo;
    if (!bo) return false;
    return borradorSucio(order, intcomexDraft[bo], 'montoIntcomex');
  };

  const saveLineAmounts = async (order) => {
    const bo = order?.bo;
    if (!bo) return false;
    const axis = axisDraft[bo] || {};
    const intcomex = intcomexDraft[bo] || {};
    if (!Object.keys(axis).length && !Object.keys(intcomex).length) return false;
    const payloadLines = construirPayloadMontos(order, axis, intcomex);
    if (!payloadLines.length) return false;
    await boLineMetaAPI.save(bo, { lines: payloadLines });
    setOsoOrders(prev => aplicarMontosGuardados(prev, bo, payloadLines));
    setAxisDraft(prev => {
      const next = { ...prev };
      delete next[bo];
      return next;
    });
    setIntcomexDraft(prev => {
      const next = { ...prev };
      delete next[bo];
      return next;
    });
    return true;
  };

  const toMonthKey = claveMes;

  const getAllocBucket = tramoAsignacion;

  const computeOsoStats = (orders) => calcularEstadisticasOso(orders, boMeta, boDraft);

  const buildOsoLineReportRows = (orders) =>
    filasReporteLineas(orders, { boMeta, boDraft, axisDraft, intcomexDraft });

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
    const modeLabel = osoReportMode === 'proximas' ? 'proximas' : (osoReportMode === 'axis' ? 'axis' : 'empresa');
    downloadPdfFromElement(element, `reporte-oso-${modeLabel}-${dateKey}`);
  };

  const exportOsoReportExcel = async () => {
    const dateKey = getDateKey(new Date()) || 'export';
    const modeLabel = osoReportMode === 'proximas' ? 'proximas' : (osoReportMode === 'axis' ? 'axis' : 'empresa');
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
          'PO Axis': getOsoReportValue(item, 'poAxis'),
          Proyecto: getOsoReportValue(item, 'projectName'),
          'PO Cliente': getOsoReportValue(item, 'customerPo'),
          Cliente: getOsoReportValue(item, 'cliente'),
          MPN: item.mpn || 'N/A',
          SKU: item.sku || 'N/A',
          Producto: item.desc || 'N/A',
          'ETA Est.': getOsoReportValue(item, 'etaEstimado'),
          'Mes Fact.': item.invoiceMonth || '',
          'Semana Fact.': item.invoiceWeek || '',
          'Cant. Orden': item.orderQty,
          'Cant. Alocada': item.allocQty,
          'Cant. Despachada': item.shippedQty,
          'Monto Axis': item.montoAxis || 0,
          'Monto Intcomex': item.montoIntcomex || 0,
          Notas: getOsoReportValue(item, 'notas')
        }))
      );
    } else if (osoReportMode === 'axis') {
      const grouped = new Map();
      osoLineReportRows.forEach(row => {
        const empresa = (getOsoReportValue(row, 'cliente') || 'Sin empresa').toString().trim() || 'Sin empresa';
        if (!grouped.has(empresa)) grouped.set(empresa, []);
        grouped.get(empresa).push(row);
      });
      rows = Array.from(grouped.entries()).flatMap(([empresa, items]) =>
        items.map(item => {
          const meta = getOsoMeta(item.bo) || {};
          return {
            Empresa: empresa,
            BO: getOsoReportValue(item, 'bo'),
            'PO Axis': getOsoReportValue(item, 'poAxis') || meta.poAxis || '',
            Proyecto: getOsoReportValue(item, 'projectName') || meta.projectName || '',
            'PO Cliente': getOsoReportValue(item, 'customerPo'),
            Cliente: getOsoReportValue(item, 'cliente'),
            MPN: item.mpn || 'N/A',
            SKU: item.sku || 'N/A',
            Producto: item.desc || 'N/A',
            'ETA Est.': getOsoReportValue(item, 'etaEstimado'),
            'Mes Fact.': item.invoiceMonth || '',
            'Semana Fact.': item.invoiceWeek || '',
            'Cant. Orden': item.orderQty,
            'Monto Axis': item.montoAxis || 0,
            'Monto a facturar': item.montoFacturar || 0,
            'Monto Intcomex': item.montoIntcomex || 0,
            'Monto a facturar (Intcomex)': item.montoFacturarIntcomex || 0,
            Notas: getOsoReportValue(item, 'notas')
          };
        })
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
          'Mes Fact.': item.invoiceMonth || '',
          'Semana Fact.': item.invoiceWeek || '',
          'Cant. Orden': item.orderQty,
          'Cant. Alocada': item.allocQty,
          'Cant. Despachada': item.shippedQty,
          'Monto Axis': item.montoAxis || 0,
          'Monto Intcomex': item.montoIntcomex || 0,
          Notas: item.notas
        }));
    }
    if (!rows.length) {
      notify('No hay datos para exportar.');
      return;
    }
    const XLSX = await getXLSX();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Detalle');
    XLSX.writeFile(wb, `reporte-oso-${modeLabel}-${dateKey}.xlsx`);
  };

  const osoLineReportRows = useMemo(
    () => buildOsoLineReportRows(filteredOsoOrders),
    [filteredOsoOrders, axisDraft, intcomexDraft, boMeta, boDraft]
  );

  const exportOsoReport = async () => {
    const orders = filteredOsoOrders;
    if (!orders.length) {
      notify('No hay órdenes para exportar con los filtros actuales.');
      return;
    }

    const getOsoOrderAmountTotals = (order) => {
      return (order?.lines || []).reduce((acc, line) => {
        const qty = Number(line?.orderQty) || 0;
        const montoAxis = getAxisMontoNumber(order?.bo, line);
        const montoIntcomex = getIntcomexMontoNumber(order?.bo, line);
        acc.montoAxis += montoAxis;
        acc.montoIntcomex += montoIntcomex;
        acc.montoFacturarAxis += (montoAxis * qty);
        acc.montoFacturarIntcomex += (montoIntcomex * qty);
        return acc;
      }, {
        montoAxis: 0,
        montoIntcomex: 0,
        montoFacturarAxis: 0,
        montoFacturarIntcomex: 0
      });
    };

    const detailRows = orders.map(order => {
      const totals = getOsoOrderTotals(order);
      const amountTotals = getOsoOrderAmountTotals(order);
      const meta = getOsoMeta(order.bo);
      const invoiceMonth = getBoInvoiceMonth(order.bo) || '';
      const invoiceWeek = getBoInvoiceWeek(order.bo) || '';
      const invoiceMonthWeek = invoiceMonth
        ? `${invoiceMonth}${invoiceWeek ? ` (Sem ${invoiceWeek})` : ''}`
        : '';
      return {
        BO: order.bo || '',
        Cliente: getOsoCustomerName(order),
        '% Alocado': getOsoAllocPct(order, totals),
        Estado: getOrderStatus(order),
        'ETA Estimada': order.etaEstimated || '',
        'Planned Ship Date': order.plannedShipDate || '',
        'Mes Facturación': invoiceMonth,
        'Semana Facturación': invoiceWeek,
        'Mes/Semana Facturación': invoiceMonthWeek,
        Proyecto: meta.projectName || '',
        'PO Axis': meta.poAxis || '',
        'Orden Cliente': order.customerPO || meta.customerPO || '',
        'S&D': getSAndDStatus(order.bo),
        'Cant. Orden': totals.orderQty,
        'Cant. Alocada': totals.allocQty,
        'Cant. Despachada': totals.shippedQty,
        'Monto Axis': amountTotals.montoAxis,
        'Monto Intcomex': amountTotals.montoIntcomex,
        'Monto a facturar (Axis)': amountTotals.montoFacturarAxis,
        'Monto a facturar (Intcomex)': amountTotals.montoFacturarIntcomex
      };
    });

    const customerMap = new Map();
    const etaMonthMap = new Map();
    const invoiceMonthMap = new Map();
    const allocBucketMap = new Map();

    orders.forEach(order => {
      const totals = getOsoOrderTotals(order);
      const amountTotals = getOsoOrderAmountTotals(order);
      const customer = getOsoCustomerName(order);
      const allocPct = getOsoAllocPct(order, totals);
      const etaMonth = toMonthKey(order.etaEstimated);
      const invoiceMonth = getBoInvoiceMonth(order.bo) || 'Sin fecha';
      const invoiceWeek = getBoInvoiceWeek(order.bo) || '';
      const invoiceMonthWeek = invoiceMonth === 'Sin fecha'
        ? invoiceMonth
        : `${invoiceMonth}${invoiceWeek ? ` (Sem ${invoiceWeek})` : ''}`;
      const bucket = getAllocBucket(allocPct);

      const update = (map, key) => {
        if (!map.has(key)) {
          map.set(key, {
            key,
            orders: 0,
            totalOrderQty: 0,
            totalAllocQty: 0,
            totalShippedQty: 0,
            totalMontoAxis: 0,
            totalMontoIntcomex: 0,
            totalMontoFacturarAxis: 0,
            totalMontoFacturarIntcomex: 0,
            allocPctSum: 0
          });
        }
        const item = map.get(key);
        item.orders += 1;
        item.totalOrderQty += totals.orderQty;
        item.totalAllocQty += totals.allocQty;
        item.totalShippedQty += totals.shippedQty;
        item.totalMontoAxis += amountTotals.montoAxis;
        item.totalMontoIntcomex += amountTotals.montoIntcomex;
        item.totalMontoFacturarAxis += amountTotals.montoFacturarAxis;
        item.totalMontoFacturarIntcomex += amountTotals.montoFacturarIntcomex;
        item.allocPctSum += allocPct;
      };

      update(customerMap, customer);
      update(etaMonthMap, etaMonth);
      update(invoiceMonthMap, invoiceMonthWeek);
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
          'Monto Axis': item.totalMontoAxis,
          'Monto Intcomex': item.totalMontoIntcomex,
          'Monto a facturar (Axis)': item.totalMontoFacturarAxis,
          'Monto a facturar (Intcomex)': item.totalMontoFacturarIntcomex,
          '% Alocado Prom.': item.orders ? Math.round((item.allocPctSum / item.orders) * 10) / 10 : 0
        }))
        .sort((a, b) => (b['Órdenes'] || 0) - (a['Órdenes'] || 0));

    const stats = computeOsoStats(orders);
    const amountStats = detailRows.reduce((acc, row) => {
      acc.montoAxis += Number(row['Monto Axis']) || 0;
      acc.montoIntcomex += Number(row['Monto Intcomex']) || 0;
      acc.montoFacturarAxis += Number(row['Monto a facturar (Axis)']) || 0;
      acc.montoFacturarIntcomex += Number(row['Monto a facturar (Intcomex)']) || 0;
      return acc;
    }, {
      montoAxis: 0,
      montoIntcomex: 0,
      montoFacturarAxis: 0,
      montoFacturarIntcomex: 0
    });
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
      { Métrica: 'Monto Axis', Valor: amountStats.montoAxis },
      { Métrica: 'Monto Intcomex', Valor: amountStats.montoIntcomex },
      { Métrica: 'Monto a facturar (Axis)', Valor: amountStats.montoFacturarAxis },
      { Métrica: 'Monto a facturar (Intcomex)', Valor: amountStats.montoFacturarIntcomex },
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

    const XLSX = await getXLSX();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Resumen');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(customerMap, 'Cliente')), 'Por Cliente');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(etaMonthMap, 'Mes ETA')), 'Por Mes ETA');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(invoiceMonthMap, 'Mes/Sem Fact')), 'Por Mes Fact');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mapToRows(allocBucketMap, '% Alocado')), 'Por % Alocado');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detalle');

    const filename = `reporte-ordenes-${getDateKey(new Date()) || 'export'}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const copyOsoExecutiveSummary = () => {
    const orders = filteredOsoOrders;
    if (!orders.length) {
      notify('No hay órdenes para resumir con los filtros actuales.');
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
    notify('Resumen ejecutivo copiado.');
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

  // value llega en porcentaje (15 = 15%) desde GpGlobalCampo.

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

  const ordenesPage = useMemo(() => paginateRows(filteredOsoOrders, 'ordenes'), [filteredOsoOrders, pageByTable, pageSizeByTable]);

  const updateTablePage = (key, page) => {
    setPageByTable(prev => ({ ...prev, [key]: page }));
  };

  const updateTablePageSize = (key, size) => {
    setPageSizeByTable(prev => ({ ...prev, [key]: size }));
    setPageByTable(prev => ({ ...prev, [key]: 1 }));
  };

  useEffect(() => {
    setPageByTable(prev => ({ ...prev, ordenes: 1 }));
  }, [osoFilter, osoStatusFilter, osoSort, osoQuickFilter, osoInvoiceMonth, osoCompanyFilter, globalQuery]);

  const loadOsoOrders = async () => {
    try {
      setOsoLoading(true);
      setOsoError('');
      const [data, metaRows] = await Promise.all([
        osoAPI.getOrders(),
        boMetaAPI.getAll()
      ]);
      const { orders, boMeta: metaMap, faltantes } = procesarCargaOso(data, metaRows);
      setOsoOrders(orders);
      setBoMeta(metaMap);
      setMissingBos(faltantes);
      setShowMissingBosModal(faltantes.length > 0);
    } catch (error) {
      setOsoError(error.message || 'Error cargando órdenes');
    } finally {
      setOsoLoading(false);
    }
  };

  useEffect(() => {
    if (!isFullAdmin || (modo !== 'ordenes' && modo !== 'compras')) return;
    loadOsoOrders();
  }, [isFullAdmin, modo]);

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

  const saveBoMeta = async (order) => {
    const bo = order?.bo;
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
      estimatedInvoiceMonth: normalizeEmpty(
        normalizeInvoiceMonthValue(draft.estimatedInvoiceMonth ?? boMeta[bo]?.estimatedInvoiceMonth ?? boMeta[bo]?.estimatedInvoiceDate ?? '')
      ),
      estimatedInvoiceWeek: normalizeEmpty(
        normalizeInvoiceWeekValue(draft.estimatedInvoiceWeek ?? boMeta[bo]?.estimatedInvoiceWeek ?? '')
      )
    };
    try {
      setBoSaving(prev => ({ ...prev, [bo]: true }));
      let boSaved = false;
      let axisSaved = false;
      if (isBoMetaDirty(bo)) {
        const saved = await boMetaAPI.save(bo, payload);
        updateBoMetaLocal(bo, {
          projectName: saved.project_name || saved.projectName || payload.projectName,
          poAxis: saved.po_axis || saved.poAxis || payload.poAxis,
          estimatedInvoiceMonth: normalizeInvoiceMonthValue(
            saved.estimated_invoice_month || saved.estimatedInvoiceMonth || payload.estimatedInvoiceMonth || boMeta[bo]?.estimatedInvoiceMonth || ''
          ),
          estimatedInvoiceWeek: normalizeInvoiceWeekValue(
            saved.estimated_invoice_week ?? saved.estimatedInvoiceWeek ?? payload.estimatedInvoiceWeek ?? boMeta[bo]?.estimatedInvoiceWeek ?? ''
          ),
          sAndDStatus: saved.s_and_d_status || saved.sAndDStatus || boMeta[bo]?.sAndDStatus,
          invoiced: saved.invoiced ?? boMeta[bo]?.invoiced,
          invoicedAt: saved.invoiced_at || saved.invoicedAt || boMeta[bo]?.invoicedAt
        });
        setBoDraft(prev => {
          const next = { ...prev };
          delete next[bo];
          return next;
        });
        boSaved = true;
      }
      if (isAxisDirty(order) || isIntcomexDirty(order)) {
        await saveLineAmounts(order);
        axisSaved = true;
      }
      if (!boSaved && !axisSaved) {
        notify('No hay cambios para guardar.');
      }
    } catch (error) {
      notify(error.message || 'No se pudo guardar la información del BO');
    } finally {
      setBoSaving(prev => ({ ...prev, [bo]: false }));
    }
  };

  const buildSAndDHtml = (order) => htmlSAndD(order, boMeta, boDraft);

  const getSAndDStatus = (bo) => estadoSAndD(boMeta, bo);

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
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'mq-btn-secundario';
    const etaBadge = (() => {
      if (!order.etaEstimated) return null;
      const eta = new Date(order.etaEstimated);
      if (Number.isNaN(eta.getTime())) return null;
      const today = new Date();
      const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
      const etaUtc = Date.UTC(eta.getFullYear(), eta.getMonth(), eta.getDate());
      const diffDays = Math.round((etaUtc - todayUtc) / 86400000);
      if (diffDays < 0) return { label: `ETA vencido: ${order.etaEstimated}`, className: 'bg-rose-100 text-rose-700' };
      if (diffDays <= 7) return { label: `ETA en ≤ 7 días: ${order.etaEstimated}`, className: 'bg-amber-100 text-amber-700' };
      return { label: `ETA estimado: ${order.etaEstimated}`, className: 'bg-emerald-100 text-emerald-700' };
    })();
    const progress = totalOrderQty > 0 ? Math.min((totalShippedQty / totalOrderQty) * 100, 100) : 0;
    const draft = boDraft[order.bo] || {};
    const projectValue = draft.projectName ?? boMeta[order.bo]?.projectName ?? '';
    const poAxisValue = draft.poAxis ?? boMeta[order.bo]?.poAxis ?? '';
    const invoiceMonthValue = normalizeInvoiceMonthValue(
      draft.estimatedInvoiceMonth ?? boMeta[order.bo]?.estimatedInvoiceMonth ?? boMeta[order.bo]?.estimatedInvoiceDate ?? ''
    );
    const invoiceWeekValue = normalizeInvoiceWeekValue(
      draft.estimatedInvoiceWeek ?? boMeta[order.bo]?.estimatedInvoiceWeek ?? ''
    );
    const missingInvoiceMonth = mode === 'ordenes' && !invoiceMonthValue;
    const purchaseDraftRow = purchaseDraft[order.bo] || {};
    const purchaseStatus = (purchaseDraftRow.purchaseStatus ?? boMeta[order.bo]?.purchaseStatus ?? '').toString().toLowerCase() === 'comprado'
      ? 'comprado'
      : 'pendiente';
    const purchaseDispatch = purchaseDraftRow.purchaseDispatch ?? boMeta[order.bo]?.purchaseDispatch ?? '';
    const purchaseShipping = purchaseDraftRow.purchaseShipping ?? boMeta[order.bo]?.purchaseShipping ?? '';
    const purchaseSo = purchaseDraftRow.purchaseSo ?? boMeta[order.bo]?.purchaseSo ?? '';
    const purchasePoAxis = purchaseDraftRow.poAxis ?? boMeta[order.bo]?.poAxis ?? '';
    const isDirty = isBoMetaDirty(order.bo);
    const isPurchaseDirty = mode === 'compras' && (
      (purchaseDraftRow.purchaseStatus !== undefined && (purchaseDraftRow.purchaseStatus ?? '') !== (boMeta[order.bo]?.purchaseStatus ?? '')) ||
      (purchaseDraftRow.purchaseDispatch !== undefined && (purchaseDraftRow.purchaseDispatch ?? '') !== (boMeta[order.bo]?.purchaseDispatch ?? '')) ||
      (purchaseDraftRow.purchaseShipping !== undefined && (purchaseDraftRow.purchaseShipping ?? '') !== (boMeta[order.bo]?.purchaseShipping ?? '')) ||
      (purchaseDraftRow.purchaseSo !== undefined && (purchaseDraftRow.purchaseSo ?? '') !== (boMeta[order.bo]?.purchaseSo ?? '')) ||
      (purchaseDraftRow.poAxis !== undefined && (purchaseDraftRow.poAxis ?? '') !== (boMeta[order.bo]?.poAxis ?? ''))
    );
    const canEditAxis = mode === 'ordenes';

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
        className={`relative overflow-hidden border rounded-2xl bg-white shadow-card ${
          isPendingPurchase
            ? 'border-slate-200 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-rose-500'
            : missingInvoiceMonth
              ? 'border-slate-200 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-rose-500'
              : (isEmbarcador ? 'border-slate-200 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-amber-400' : 'border-slate-200')
        }`}
      >
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex flex-col gap-2">
            {missingInvoiceMonth && !isPendingPurchase && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <div className="font-semibold">Falta mes facturación</div>
                <div className="mt-0.5 text-rose-700/80">Define “Mes fact.” para esta BO.</div>
              </div>
            )}
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
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 basis-full sm:basis-auto flex-1 min-w-0 text-left cursor-pointer"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard?.writeText?.(String(order.bo || ''));
                  }}
                  className="font-mono text-sm font-semibold text-slate-900 whitespace-nowrap hover:underline"
                  title="Copiar BO"
                  type="button"
                >
                  BO {order.bo}
                </button>
                <span className="text-slate-700 break-words">{order.customerName || 'Cliente N/A'}</span>
                <span className={`whitespace-nowrap text-xs px-2 py-0.5 rounded-full ${statusClass}`}>{status}</span>
              </div>
              {etaBadge && (
                <span className={`whitespace-nowrap text-xs px-2 py-0.5 rounded-full ${etaBadge.className}`}>
                  {etaBadge.label}
                </span>
              )}
              <span className="whitespace-nowrap text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">{order.allocPct ?? 0}% asignado</span>
              <button
                onClick={() => togglePinnedBo(order.bo)}
                className={`mq-btn mq-btn-xs ${pinned ? 'bg-amber-50 text-amber-800 border-amber-200' : 'mq-btn-fantasma'}`}
              >
                {pinned ? 'Quitar pin' : 'Fijar'}
              </button>
              {mode === 'ordenes' && (
                <button
                  onClick={() => saveBoMeta(order)}
                  disabled={(!isDirty && !isAxisDirty(order) && !isIntcomexDirty(order)) || boSaving[order.bo]}
                  className={`mq-btn mq-btn-xs ${(isDirty || isAxisDirty(order) || isIntcomexDirty(order)) ? 'bg-slate-900 text-white hover:bg-slate-800' : 'mq-btn-secundario'} ${boSaving[order.bo] ? 'opacity-60' : ''}`}
                >
                  {boSaving[order.bo] ? 'Guardando…' : 'Guardar'}
                </button>
              )}
              {mode === 'ordenes' && (
                <button
                  onClick={() => handleSAndDClick(order)}
                  className={`mq-btn mq-btn-xs ${sAndDClass}`}
                >
                  {sAndDStatus === 'aplicado' ? 'S&D Aplicado' : 'S&D Pendiente'}
                </button>
              )}
              {mode === 'compras' && (
                <button
                  onClick={() => savePurchaseMeta(order.bo)}
                  disabled={!isPurchaseDirty}
                  className={`mq-btn mq-btn-xs ${isPurchaseDirty ? 'bg-slate-900 text-white hover:bg-slate-800' : 'mq-btn-secundario'}`}
                >
                  Guardar cambios
                </button>
              )}
              <button
                onClick={() => setExpandedBo(prev => (prev === order.bo ? null : order.bo))}
                className="mq-btn mq-btn-xs mq-btn-fantasma"
              >
                {expandedBo === order.bo ? 'Ocultar' : 'Ver detalle'}
              </button>
            </div>
            {mode === 'ordenes' ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <label className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Proyecto</span>
                  <input
                    value={projectValue}
                    onChange={(e) => updateBoDraft(order.bo, { projectName: e.target.value })}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-56 bg-white"
                    placeholder="Nombre del proyecto"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">PO Axis</span>
                  <input
                    value={poAxisValue}
                    onChange={(e) => updateBoDraft(order.bo, { poAxis: e.target.value })}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-40 bg-white"
                    placeholder="PO Axis"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Mes fact.</span>
                  <select
                    value={invoiceMonthValue}
                    onChange={(e) => updateBoDraft(order.bo, { estimatedInvoiceMonth: e.target.value })}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-44 bg-white"
                  >
                    <option value="">Sin mes</option>
                    {invoiceMonthOptions.map(option => (
                      <option key={`inv-month-${option.value}`} value={option.value} disabled={option.disabled}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Semana</span>
                  <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-0.5">
                    {[1, 2, 3, 4].map(week => (
                      <button
                        key={`${order.bo}-week-${week}`}
                        type="button"
                        onClick={() => updateBoDraft(order.bo, { estimatedInvoiceWeek: String(week) })}
                        className={`min-w-[26px] h-6 px-1.5 text-xs font-medium rounded-md transition ${invoiceWeekValue === String(week) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'}`}
                      >
                        {week}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateBoDraft(order.bo, { estimatedInvoiceWeek: '' })}
                      className={`min-w-[26px] h-6 px-1.5 text-xs font-medium rounded-md transition ${invoiceWeekValue === '' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'}`}
                      title="Sin semana"
                    >
                      -
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <label className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Compra</span>
                  <select
                    value={purchaseStatus}
                    onChange={(e) => updatePurchaseDraft(order.bo, { purchaseStatus: e.target.value })}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-40 bg-white"
                  >
                    <option value="pendiente">Pendiente compra</option>
                    <option value="comprado">Comprado</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">SO</span>
                  <input
                    value={purchaseSo}
                    onChange={(e) => updatePurchaseDraft(order.bo, { purchaseSo: e.target.value })}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-40 bg-white"
                    placeholder="SO"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">PO</span>
                  <input
                    value={purchasePoAxis}
                    onChange={(e) => updatePurchaseDraft(order.bo, { poAxis: e.target.value })}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-40 bg-white"
                    placeholder="PO Axis"
                  />
                </label>
                {purchaseStatus === 'comprado' && (
                  <>
                    <label className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">Despacho</span>
                      <select
                        value={purchaseDispatch}
                        onChange={(e) => updatePurchaseDraft(order.bo, { purchaseDispatch: e.target.value })}
                        className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-40 bg-white"
                      >
                        <option value="">Seleccionar</option>
                        <option value="xus">XUS</option>
                        <option value="embarcador">Embarcador</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">Vía</span>
                      <select
                        value={purchaseShipping}
                        onChange={(e) => updatePurchaseDraft(order.bo, { purchaseShipping: e.target.value })}
                        className="h-8 px-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-40 bg-white"
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
            <div className="h-full bg-slate-700 rounded-full" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
        {expandedBo === order.bo && (
          <div className="px-4 pb-4">
            <div className="text-xs text-slate-500 mb-2">
              Orden Cliente: {order.customerPO || 'N/A'}
            </div>
            <div className="text-xs text-slate-500 mb-2">
              Planned Ship Date: {order.plannedShipDate || 'N/A'}
            </div>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <PantallazoMontos
                campo='intcomex'
                onLeer={leerPantallazoDeOrden(order, 'intcomex')}
                onListo={aplicarPantallazo(order, 'intcomex')}
                deshabilitado={!!boSaving[order.bo]}
              />
              <PantallazoMontos
                campo='axis'
                onLeer={leerPantallazoDeOrden(order, 'axis')}
                onListo={aplicarPantallazo(order, 'axis')}
                deshabilitado={!!boSaving[order.bo]}
              />
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left">MPN</th>
                    <th className="px-2 py-2 text-left">SKU</th>
                    <th className="px-2 py-2 text-left">Producto</th>
                    <th className="px-2 py-2 text-right">Monto Axis</th>
                    <th className="px-2 py-2 text-right">Monto Intcomex</th>
                    <th className="px-2 py-2 text-left">Entrega (OOR)</th>
                    <th className="px-2 py-2 text-right">Cant. Alocada</th>
                    <th className="px-2 py-2 text-right">Cant. Orden</th>
                    <th className="px-2 py-2 text-right">Cant. Despachada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(order.lines || []).map((line, idx) => (
                    <tr key={`${order.bo}-${line.lineIndex ?? idx}`} className={idx % 2 === 1 ? 'bg-slate-50/40' : ''}>
                      <td className="px-2 py-2">{line.mpn || 'N/A'}</td>
                      <td className="px-2 py-2">{line.sku || 'N/A'}</td>
                      <td className="px-2 py-2">{line.desc || 'N/A'}</td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          value={getAxisMontoValue(order.bo, line)}
                          onChange={(e) => updateAxisDraft(order.bo, getAxisLineKey(line), e.target.value)}
                          disabled={!canEditAxis}
                          className={`w-24 h-8 px-2 border border-slate-300 rounded-md text-sm text-right tabular-nums ${canEditAxis ? '' : 'bg-slate-50 text-slate-400'}`}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          value={getIntcomexMontoValue(order.bo, line)}
                          onChange={(e) => updateIntcomexDraft(order.bo, getAxisLineKey(line), e.target.value)}
                          disabled={!canEditAxis}
                          className={`w-24 h-8 px-2 border border-slate-300 rounded-md text-sm text-right tabular-nums ${canEditAxis ? '' : 'bg-slate-50 text-slate-400'}`}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-2">{line.tiempoEntrega || 'N/A'}</td>
                      <td className="px-2 py-2 text-right">{line.allocQty ?? 0}</td>
                      <td className="px-2 py-2 text-right">{line.orderQty ?? 0}</td>
                      <td className="px-2 py-2 text-right">{line.shippedQty ?? 0}</td>
                    </tr>
                  ))}
                  {(order.lines || []).length > 0 && (
                    <tr className="bg-slate-100/70 font-semibold text-slate-700">
                      <td className="px-2 py-2" colSpan={6}>Totales</td>
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

  return (
    <>
        {modo === 'ordenes' && isFullAdmin && (
          <div className="space-y-4 view-enter">
            <EncabezadoPagina seccion="Operaciones" titulo="Órdenes activas" subtitulo="BO del OSO con proyecto, mes de facturación y montos AXIS / Intcomex." />
            <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  {isAdmin ? (
                    <input
                      value={globalSearch}
                      onChange={(e) => setGlobalSearch(e.target.value)}
                      placeholder="Buscar…"
                      aria-label="Buscar"
                      className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-full md:w-52"
                    />
                  ) : (
                    <input
                      value={osoFilter}
                      onChange={(e) => setOsoFilter(e.target.value)}
                      placeholder="Buscar BO o cliente"
                      aria-label="Buscar órdenes"
                      className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-full md:w-52"
                    />
                  )}
                  <select
                    value={osoStatusFilter}
                    onChange={(e) => setOsoStatusFilter(e.target.value)}
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-40"
                  >
                    <option value="all">Todos</option>
                    <option value="activa">Activas</option>
                    <option value="parcial">Parciales</option>
                    <option value="completa">Completas</option>
                  </select>
                  <select
                    value={osoSort}
                    onChange={(e) => setOsoSort(e.target.value)}
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-44"
                  >
                    <option value="bo">Ordenar por BO</option>
                    <option value="empresa">Ordenar por empresa</option>
                    <option value="porcentaje">Ordenar por %</option>
                    <option value="fact-month">Ordenar por mes facturación</option>
                    <option value="eta">Ordenar por ETA</option>
                  </select>
                  <div className="relative w-[calc(50%-0.25rem)] md:w-52">
                    <button
                      onClick={() => setShowCompanyDropdown(prev => !prev)}
                      className="w-full h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 text-left"
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
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-44"
                  >
                    <option value="">Acciones…</option>
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
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-52"
                  >
                    <option value="">Informes…</option>
                    <option value="empresa">Informe por empresa</option>
                    <option value="proximas">Próximas entregas</option>
                    <option value="axis">Reporte Axis</option>
                  </select>
                  </div>
                </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center h-7 px-2.5 rounded-lg bg-slate-100 text-slate-700 tabular-nums">
                  Total: {osoStats.total} · Activas: {osoStats.activa} · Parciales: {osoStats.parcial} · Completas: {osoStats.completa} · Facturadas: {invoicedBos.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  onClick={() => setShowOsoFilters(prev => !prev)}
                  className="mq-btn mq-btn-xs mq-btn-secundario"
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
                        className={`mq-btn mq-btn-xs ${osoQuickFilter === item.key ? 'mq-btn-primario' : 'mq-btn-secundario'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                    <label className="flex items-center gap-2 ml-2">
                      <span className="text-slate-500">Facturación mes</span>
                      <select
                        value={osoInvoiceMonth}
                        onChange={(e) => setOsoInvoiceMonth(e.target.value)}
                        className="h-8 px-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white"
                      >
                        <option value="">Todos</option>
                        {invoiceMonthOptions.map(option => (
                          <option key={`filter-month-ordenes-${option.value}`} value={option.value} disabled={option.disabled}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              {osoError && <div className="mt-2 text-sm text-rose-600">{osoError}</div>}
              {osoLoading ? (
                <ListaEsqueleto className="mt-4" />
              ) : ordenesPage.total === 0 ? (
                <EstadoVacio icono="truck" titulo="Sin órdenes activas" detalle="Prueba quitando filtros o cambiando el mes de facturación." />
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
                  {ordenesPage.rows
                    .filter(order => !safePinnedBos.includes(order.bo))
                    .map(order => renderOrderCard(order, { mode: 'ordenes' }))}
                  <div className="pt-2 flex items-center justify-end gap-2 text-xs">
                    <label htmlFor="page-size-ordenes">Filas</label>
                    <select
                      id="page-size-ordenes"
                      value={ordenesPage.pageSize}
                      onChange={(e) => updateTablePageSize('ordenes', Number(e.target.value))}
                      className="h-8 px-2 border border-slate-300 rounded-lg bg-white text-sm"
                    >
                      <option value={10}>10</option>
                      <option value={15}>15</option>
                      <option value={25}>25</option>
                    </select>
                    <button
                      onClick={() => updateTablePage('ordenes', Math.max(1, ordenesPage.page - 1))}
                      disabled={ordenesPage.page <= 1}
                      className="mq-btn mq-btn-xs mq-btn-secundario"
                    >
                      Anterior
                    </button>
                    <span>Página {ordenesPage.page}/{ordenesPage.totalPages}</span>
                    <button
                      onClick={() => updateTablePage('ordenes', Math.min(ordenesPage.totalPages, ordenesPage.page + 1))}
                      disabled={ordenesPage.page >= ordenesPage.totalPages}
                      className="mq-btn mq-btn-xs mq-btn-secundario"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>

            {invoicedBos.length > 0 && (
              <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-800">
                      Órdenes facturadas <span className="text-xs text-slate-500">({invoicedBos.length})</span>
                    </h3>
                    <p className="text-xs text-slate-500">BOs que ya no están en OSO y marcaste como facturados.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      value={invoicedFilter}
                      onChange={(e) => setInvoicedFilter(e.target.value)}
                      placeholder="Buscar BO o cliente"
                      className="h-8 px-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white w-40"
                    />
                    <label className="text-slate-500">Ordenar por:</label>
                    <select
                      value={invoicedSort}
                      onChange={(e) => setInvoicedSort(e.target.value)}
                      className="h-8 px-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white"
                    >
                      <option value="date">Fecha (reciente)</option>
                      <option value="lastSeen">Última vez en OSO</option>
                      <option value="cliente">Cliente (A-Z)</option>
                      <option value="bo">BO</option>
                    </select>
                    <button
                      onClick={() => setShowInvoicedSection(prev => !prev)}
                      className="mq-btn mq-btn-xs mq-btn-fantasma"
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
                          <span className="ml-2 text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">% {item.allocPct ?? 0}</span>
                          <span className="ml-2 text-xs text-slate-500">Proyecto: {item.projectName || 'N/A'}</span>
                          <span className="ml-2 text-xs text-slate-500">PO Axis: {item.poAxis || 'N/A'}</span>
                        </div>
                        <div className="text-xs text-slate-500 whitespace-nowrap">
                          Facturado: {item.invoicedAt ? new Date(item.invoicedAt).toLocaleDateString() : 'N/A'}
                        </div>
                        <button
                          onClick={() => unmarkBoInvoiced(item.bo)}
                          className="mq-btn mq-btn-xs mq-btn-fantasma"
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

        {modo === 'compras' && isFullAdmin && (
          <div className="space-y-4 view-enter">
            <EncabezadoPagina seccion="Operaciones" titulo="Vista compras" subtitulo="Estado de compra, despacho y vía de cada BO del OSO." />
            <div className="glass-card rounded-2xl shadow-card border border-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <input
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                    placeholder="Buscar…"
                    aria-label="Buscar"
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-full md:w-52"
                  />
                  <select
                    value={osoStatusFilter}
                    onChange={(e) => setOsoStatusFilter(e.target.value)}
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-40"
                  >
                    <option value="all">Todos</option>
                    <option value="activa">Activas</option>
                    <option value="parcial">Parciales</option>
                    <option value="completa">Completas</option>
                  </select>
                  <select
                    value={osoSort}
                    onChange={(e) => setOsoSort(e.target.value)}
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-44"
                  >
                    <option value="bo">Ordenar por BO</option>
                    <option value="empresa">Ordenar por empresa</option>
                    <option value="porcentaje">Ordenar por %</option>
                    <option value="fact-month">Ordenar por mes facturación</option>
                    <option value="eta">Ordenar por ETA</option>
                  </select>
                  <div className="relative w-[calc(50%-0.25rem)] md:w-52">
                    <button
                      onClick={() => setShowCompanyDropdown(prev => !prev)}
                      className="w-full h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 text-left"
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
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-44"
                  >
                    <option value="">Acciones…</option>
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
                    className="h-10 px-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-900 w-[calc(50%-0.25rem)] md:w-52"
                  >
                    <option value="">Informes…</option>
                    <option value="empresa">Informe por empresa</option>
                    <option value="proximas">Próximas entregas</option>
                    <option value="axis">Reporte Axis</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center h-7 px-2.5 rounded-lg bg-slate-100 text-slate-700 tabular-nums">
                  Total: {osoStats.total} · Activas: {osoStats.activa} · Parciales: {osoStats.parcial} · Completas: {osoStats.completa}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  onClick={() => setShowOsoFilters(prev => !prev)}
                  className="mq-btn mq-btn-xs mq-btn-secundario"
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
                        className={`mq-btn mq-btn-xs ${osoQuickFilter === item.key ? 'mq-btn-primario' : 'mq-btn-secundario'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                    <label className="flex items-center gap-2 ml-2">
                      <span className="text-slate-500">Facturación mes</span>
                      <select
                        value={osoInvoiceMonth}
                        onChange={(e) => setOsoInvoiceMonth(e.target.value)}
                        className="h-8 px-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white"
                      >
                        <option value="">Todos</option>
                        {invoiceMonthOptions.map(option => (
                          <option key={`filter-month-compras-${option.value}`} value={option.value} disabled={option.disabled}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              {osoError && <div className="mt-2 text-sm text-rose-600">{osoError}</div>}
              {osoLoading ? (
                <ListaEsqueleto className="mt-4" />
              ) : filteredOsoOrders.length === 0 ? (
                <EstadoVacio icono="truck" titulo="Sin órdenes activas" detalle="Prueba quitando filtros o cambiando el mes de facturación." />
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
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] p-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-float w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">BO no encontrados en OSO</h3>
                <button
                  onClick={() => setShowMissingBosModal(false)}
                  className="mq-btn mq-btn-sm mq-btn-fantasma"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-sm text-slate-600">
                  Estos BO ya no están en OSO. ¿Marcar como facturados?
                </div>
                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {missingBos.map(bo => (
                    <div key={bo} className="flex items-center justify-between gap-2 border rounded-lg p-2">
                      <div className="text-sm font-semibold text-slate-800">BO {bo}</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => markBoInvoiced(bo)}
                          className="mq-btn mq-btn-xs bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          Marcar facturado
                        </button>
                        <button
                          onClick={() => openDeleteBoModal(bo)}
                          className="mq-btn mq-btn-xs bg-rose-600 text-white hover:bg-rose-700"
                        >
                          Eliminar
                        </button>
                        <button
                          onClick={() => dismissMissingBo(bo)}
                          className="mq-btn mq-btn-xs mq-btn-secundario"
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
                    className="mq-btn mq-btn-sm mq-btn-primario"
                  >
                    Marcar todos
                  </button>
                  <button
                    onClick={() => setShowMissingBosModal(false)}
                    className="mq-btn mq-btn-sm mq-btn-secundario"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {deleteBoTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] p-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-float w-full max-w-md max-h-[90vh] overflow-y-auto animate-scale-in">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Eliminar BO {deleteBoTarget}</h3>
                <button
                  onClick={closeDeleteBoModal}
                  className="mq-btn mq-btn-sm mq-btn-fantasma"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-slate-600">
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
                    className="mq-btn mq-btn-sm mq-btn-secundario"
                    disabled={deleteBoLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmDeleteBo}
                    className="mq-btn mq-btn-sm bg-rose-600 text-white hover:bg-rose-700"
                    disabled={deleteBoLoading}
                  >
                    {deleteBoLoading ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showOsoReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] p-3 animate-fade-in">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-float w-[96vw] h-[90vh] overflow-hidden flex flex-col animate-scale-in">
              <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Informe de órdenes activas</h3>
                  <p className="text-xs text-slate-500">ETA estimado por línea = Entrega OOR + 15 días.</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setOsoReportMode('empresa')}
                    className={`mq-btn mq-btn-xs ${osoReportMode === 'empresa' ? 'mq-btn-primario' : 'mq-btn-secundario'}`}
                  >
                    Por empresa
                  </button>
                  <button
                    onClick={() => setOsoReportMode('proximas')}
                    className={`mq-btn mq-btn-xs ${osoReportMode === 'proximas' ? 'mq-btn-primario' : 'mq-btn-secundario'}`}
                  >
                    Próximas entregas
                  </button>
                  <button
                    onClick={() => setOsoReportMode('axis')}
                    className={`mq-btn mq-btn-xs ${osoReportMode === 'axis' ? 'mq-btn-primario' : 'mq-btn-secundario'}`}
                  >
                    Reporte Axis
                  </button>
                  <button
                    onClick={exportOsoReportPdf}
                    className="mq-btn mq-btn-xs mq-btn-secundario"
                  >
                    Exportar PDF
                  </button>
                  <button
                    onClick={exportOsoReportExcel}
                    className="mq-btn mq-btn-xs mq-btn-secundario"
                  >
                    Exportar Excel
                  </button>
                  <button
                    onClick={() => setOsoReportEdits({})}
                    className="mq-btn mq-btn-xs mq-btn-secundario"
                  >
                    Limpiar cambios
                  </button>
                  <button
                    onClick={() => setShowOsoReportModal(false)}
                    className="mq-btn mq-btn-sm mq-btn-fantasma"
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
                                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                                  <tr>
                                    <th className="px-2 py-2 text-left">BO</th>
                                    <th className="px-2 py-2 text-left">PO Axis</th>
                                    <th className="px-2 py-2 text-left">Proyecto</th>
                                    <th className="px-2 py-2 text-left">PO Cliente</th>
                                    <th className="px-2 py-2 text-left">Cliente</th>
                                    <th className="px-2 py-2 text-left">MPN</th>
                                    <th className="px-2 py-2 text-left">SKU</th>
                                    <th className="px-2 py-2 text-left">Producto</th>
                                    <th className="px-2 py-2 text-left">ETA Est.</th>
                                    <th className="px-2 py-2 text-left">Mes Fact.</th>
                                    <th className="px-2 py-2 text-left">Sem.</th>
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
                                          value={getOsoReportValue(row, 'poAxis')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { poAxis: e.target.value })}
                                          className="w-28 px-2 py-1 border border-slate-200 rounded text-xs"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={getOsoReportValue(row, 'projectName')}
                                          onChange={(e) => updateOsoReportEdit(row.key, { projectName: e.target.value })}
                                          className="w-32 px-2 py-1 border border-slate-200 rounded text-xs"
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
                                      <td className="px-2 py-2">{row.invoiceMonth || 'N/A'}</td>
                                      <td className="px-2 py-2">{row.invoiceWeek || 'N/A'}</td>
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
                    ) : osoReportMode === 'axis' ? (
                      (() => {
                        const groups = new Map();
                        osoLineReportRows.forEach(row => {
                          const empresa = (getOsoReportValue(row, 'cliente') || 'Sin empresa').toString().trim() || 'Sin empresa';
                          if (!groups.has(empresa)) groups.set(empresa, []);
                          groups.get(empresa).push(row);
                        });
                        const ordered = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                        return ordered.map(([empresa, rows]) => (
                          <div key={`axis-${empresa}`} className="border border-slate-200 rounded-2xl overflow-hidden">
                            <div className="px-3 py-2 bg-slate-50 text-sm font-semibold text-slate-700">{empresa}</div>
                            <div className="overflow-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                                  <tr>
                                    <th className="px-2 py-2 text-left">BO</th>
                                    <th className="px-2 py-2 text-left">PO Cliente</th>
                                    <th className="px-2 py-2 text-left">Cliente</th>
                                    <th className="px-2 py-2 text-left">MPN</th>
                                    <th className="px-2 py-2 text-left">SKU</th>
                                    <th className="px-2 py-2 text-left">Producto</th>
                                    <th className="px-2 py-2 text-left">ETA Est.</th>
                                    <th className="px-2 py-2 text-left">Mes Fact.</th>
                                    <th className="px-2 py-2 text-left">Sem.</th>
                                    <th className="px-2 py-2 text-right">Cant. Orden</th>
                                    <th className="px-2 py-2 text-right">Monto Axis</th>
                                    <th className="px-2 py-2 text-right">Monto a facturar</th>
                                    <th className="px-2 py-2 text-left">Notas</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {rows.map(row => (
                                    <tr key={`axis-${row.key}`}>
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
                                      <td className="px-2 py-2">{row.invoiceMonth || 'N/A'}</td>
                                      <td className="px-2 py-2">{row.invoiceWeek || 'N/A'}</td>
                                      <td className="px-2 py-2 text-right">{row.orderQty}</td>
                                      <td className="px-2 py-2 text-right">{row.montoAxis || 0}</td>
                                      <td className="px-2 py-2 text-right">{row.montoFacturar || 0}</td>
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
                                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                                  <tr>
                                    <th className="px-2 py-2 text-left">BO</th>
                                    <th className="px-2 py-2 text-left">PO Cliente</th>
                                    <th className="px-2 py-2 text-left">Cliente</th>
                                    <th className="px-2 py-2 text-left">MPN</th>
                                    <th className="px-2 py-2 text-left">SKU</th>
                                    <th className="px-2 py-2 text-left">Producto</th>
                                    <th className="px-2 py-2 text-left">ETA Est.</th>
                                    <th className="px-2 py-2 text-left">Mes Fact.</th>
                                    <th className="px-2 py-2 text-left">Sem.</th>
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
                                      <td className="px-2 py-2">{row.invoiceMonth || 'N/A'}</td>
                                      <td className="px-2 py-2">{row.invoiceWeek || 'N/A'}</td>
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
                <img src="/brand/myquote-horizontal-web.svg" alt="MyQuote" data-pdf-logo="1" className="h-10 w-auto object-contain" />
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">Informe de órdenes activas</div>
                <div className="text-xs text-slate-500">Generado: {new Date().toLocaleDateString()}</div>
                <div className="text-xs text-slate-500">
                  Modo: {osoReportMode === 'proximas' ? 'Próximas entregas' : (osoReportMode === 'axis' ? 'Reporte Axis' : 'Por empresa')}
                </div>
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
                    <table className="w-full text-xs border border-slate-200">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2 py-1 text-left">BO</th>
                          <th className="px-2 py-1 text-left">PO Axis</th>
                          <th className="px-2 py-1 text-left">Proyecto</th>
                          <th className="px-2 py-1 text-left">PO Cliente</th>
                          <th className="px-2 py-1 text-left">Cliente</th>
                          <th className="px-2 py-1 text-left">MPN</th>
                          <th className="px-2 py-1 text-left">SKU</th>
                          <th className="px-2 py-1 text-left">Producto</th>
                          <th className="px-2 py-1 text-left">ETA Est.</th>
                          <th className="px-2 py-1 text-left">Mes Fact.</th>
                          <th className="px-2 py-1 text-left">Sem.</th>
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
                            <td className="px-2 py-1">{row.invoiceMonth || 'N/A'}</td>
                            <td className="px-2 py-1">{row.invoiceWeek || 'N/A'}</td>
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
            ) : osoReportMode === 'axis' ? (
              (() => {
                const groups = new Map();
                osoLineReportRows.forEach(row => {
                  const empresa = (getOsoReportValue(row, 'cliente') || 'Sin empresa').toString().trim() || 'Sin empresa';
                  if (!groups.has(empresa)) groups.set(empresa, []);
                  groups.get(empresa).push(row);
                });
                const ordered = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                return ordered.map(([empresa, rows]) => (
                  <div key={`pdf-axis-${empresa}`} className="mb-4">
                    <div className="font-semibold text-slate-700 mb-2">{empresa}</div>
                    <table className="w-full text-xs border border-slate-200">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2 py-1 text-left">BO</th>
                          <th className="px-2 py-1 text-left">PO Cliente</th>
                          <th className="px-2 py-1 text-left">Cliente</th>
                          <th className="px-2 py-1 text-left">MPN</th>
                          <th className="px-2 py-1 text-left">SKU</th>
                          <th className="px-2 py-1 text-left">Producto</th>
                          <th className="px-2 py-1 text-left">ETA Est.</th>
                          <th className="px-2 py-1 text-left">Mes Fact.</th>
                          <th className="px-2 py-1 text-left">Sem.</th>
                          <th className="px-2 py-1 text-right">Cant. Orden</th>
                          <th className="px-2 py-1 text-right">Monto Axis</th>
                          <th className="px-2 py-1 text-right">Monto a facturar</th>
                          <th className="px-2 py-1 text-left">Notas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map(row => {
                          const meta = getOsoMeta(row.bo) || {};
                          const poAxisValue = getOsoReportValue(row, 'poAxis') || meta.poAxis || '';
                          const projectValue = getOsoReportValue(row, 'projectName') || meta.projectName || '';
                          return (
                            <tr key={`pdf-axis-${row.key}`}>
                              <td className="px-2 py-1">{getOsoReportValue(row, 'bo')}</td>
                              <td className="px-2 py-1">{poAxisValue}</td>
                              <td className="px-2 py-1">{projectValue}</td>
                              <td className="px-2 py-1">{getOsoReportValue(row, 'customerPo')}</td>
                              <td className="px-2 py-1">{getOsoReportValue(row, 'cliente')}</td>
                              <td className="px-2 py-1">{row.mpn || 'N/A'}</td>
                              <td className="px-2 py-1">{row.sku || 'N/A'}</td>
                              <td className="px-2 py-1">{row.desc || 'N/A'}</td>
                              <td className="px-2 py-1">{getOsoReportValue(row, 'etaEstimado')}</td>
                              <td className="px-2 py-1">{row.invoiceMonth || 'N/A'}</td>
                              <td className="px-2 py-1">{row.invoiceWeek || 'N/A'}</td>
                              <td className="px-2 py-1 text-right">{row.orderQty}</td>
                              <td className="px-2 py-1 text-right">{row.montoAxis || 0}</td>
                              <td className="px-2 py-1 text-right">{row.montoFacturar || 0}</td>
                              <td className="px-2 py-1">{getOsoReportValue(row, 'notas')}</td>
                            </tr>
                          );
                        })}
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
                  <table className="w-full text-xs border border-slate-200">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-2 py-1 text-left">BO</th>
                        <th className="px-2 py-1 text-left">PO Cliente</th>
                        <th className="px-2 py-1 text-left">Cliente</th>
                        <th className="px-2 py-1 text-left">MPN</th>
                        <th className="px-2 py-1 text-left">SKU</th>
                        <th className="px-2 py-1 text-left">Producto</th>
                        <th className="px-2 py-1 text-left">ETA Est.</th>
                        <th className="px-2 py-1 text-left">Mes Fact.</th>
                        <th className="px-2 py-1 text-left">Sem.</th>
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
                          <td className="px-2 py-1">{row.invoiceMonth || 'N/A'}</td>
                          <td className="px-2 py-1">{row.invoiceWeek || 'N/A'}</td>
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

    </>
  );
}

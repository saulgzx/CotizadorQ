// Lógica pura de las órdenes (OSO): estado, meta del BO, filtros, orden, estadísticas
// y filas del reporte. Sin React, sin red y sin notify, para poder probarla.
// El componente solo guarda el estado (boMeta, boDraft, borradores de montos) y llama
// a estas funciones pasándoselo por parámetro.
import { MONTH_LABEL_FORMATTER } from '../cotizador/cotizadorConstants';
import { numeroMonto } from '../cotizador/montosOrden';

// --- Estado de la orden -------------------------------------------------------

// 'Completa' | 'Parcial' | 'Activa' según lo despachado contra lo pedido.
export const estadoOrden = (order) => {
  const totalOrderQty = (order.lines || []).reduce((acc, line) => acc + (Number(line.orderQty) || 0), 0);
  const totalShippedQty = (order.lines || []).reduce((acc, line) => acc + (Number(line.shippedQty) || 0), 0);
  return totalOrderQty > 0
    ? (totalShippedQty >= totalOrderQty ? 'Completa' : (totalShippedQty > 0 ? 'Parcial' : 'Activa'))
    : 'Activa';
};

// --- Meta del BO (guardada + borrador) ---------------------------------------

// El borrador pisa a la meta guardada, campo por campo.
export const metaDeOrden = (boMeta, boDraft, bo) => {
  const meta = boMeta[bo] || {};
  const draft = boDraft[bo] || {};
  return { ...meta, ...draft };
};

// 'YYYY-MM' o ''. Acepta 'YYYY-MM' tal cual o una fecha parseable.
export const normalizarMesFacturacion = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// '1'..'4' o ''.
export const normalizarSemanaFacturacion = (value) => {
  if (value === undefined || value === null || value === '') return '';
  const parsed = parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 4) return '';
  return String(parsed);
};

export const mesFacturacionDeBo = (boMeta, boDraft, bo) => {
  const meta = metaDeOrden(boMeta, boDraft, bo);
  return normalizarMesFacturacion(meta.estimatedInvoiceMonth) || normalizarMesFacturacion(meta.estimatedInvoiceDate);
};

export const semanaFacturacionDeBo = (boMeta, boDraft, bo) =>
  normalizarSemanaFacturacion(metaDeOrden(boMeta, boDraft, bo).estimatedInvoiceWeek);

// ¿El borrador del BO difiere de lo guardado?
export const metaSucia = (boMeta, boDraft, bo) => {
  const draft = boDraft[bo] || {};
  return (
    (draft.projectName !== undefined && draft.projectName !== (boMeta[bo]?.projectName ?? '')) ||
    (draft.poAxis !== undefined && draft.poAxis !== (boMeta[bo]?.poAxis ?? '')) ||
    (draft.estimatedInvoiceMonth !== undefined &&
      normalizarMesFacturacion(draft.estimatedInvoiceMonth) !== normalizarMesFacturacion(boMeta[bo]?.estimatedInvoiceMonth || boMeta[bo]?.estimatedInvoiceDate)) ||
    (draft.estimatedInvoiceWeek !== undefined &&
      normalizarSemanaFacturacion(draft.estimatedInvoiceWeek) !== normalizarSemanaFacturacion(boMeta[bo]?.estimatedInvoiceWeek))
  );
};

export const nombreClienteOrden = (order, boMeta, boDraft) =>
  (order?.customerName || metaDeOrden(boMeta, boDraft, order?.bo)?.customerName || 'Sin cliente').toString().trim() || 'Sin cliente';

// 'aplicado' | 'pendiente' (solo mira la meta guardada, no el borrador).
export const estadoSAndD = (boMeta, bo) => {
  const status = boMeta[bo]?.sAndDStatus;
  return status === 'aplicado' ? 'aplicado' : 'pendiente';
};

// --- Totales y porcentajes ----------------------------------------------------

export const totalesOrden = (order) => {
  const totals = { orderQty: 0, shippedQty: 0, allocQty: 0 };
  (order?.lines || []).forEach(line => {
    totals.orderQty += Number(line.orderQty) || 0;
    totals.shippedQty += Number(line.shippedQty) || 0;
    totals.allocQty += Number(line.allocQty) || 0;
  });
  return totals;
};

// meta = meta efectiva del BO (metaDeOrden). order.allocPct manda; luego meta.allocPct;
// luego se calcula desde las cantidades.
export const porcentajeAsignadoOrden = (order, totals, meta) => {
  const raw = order?.allocPct ?? meta?.allocPct;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return parsed;
  if (totals?.orderQty > 0) {
    return Math.round((totals.allocQty / totals.orderQty) * 1000) / 10;
  }
  return 0;
};

// --- Fechas -------------------------------------------------------------------

export const claveMes = (value) => {
  if (!value) return 'Sin fecha';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Sin fecha';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const sumarDiasIso = (isoDate, days) => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const tramoAsignacion = (pct) => {
  if (!Number.isFinite(pct)) return 'Sin %';
  if (pct < 25) return '0-24%';
  if (pct < 50) return '25-49%';
  if (pct < 75) return '50-74%';
  if (pct < 100) return '75-99%';
  return '>=100%';
};

// --- Estadísticas -------------------------------------------------------------

// Conteo simple por estado (lo que muestra el encabezado de la vista).
export const contarEstadosOrdenes = (orders) => {
  const stats = { total: orders.length, activa: 0, parcial: 0, completa: 0 };
  orders.forEach(order => {
    const status = estadoOrden(order).toLowerCase();
    if (status === 'parcial') stats.parcial += 1;
    else if (status === 'completa') stats.completa += 1;
    else stats.activa += 1;
  });
  return stats;
};

// Estadísticas del reporte. `hoy` se puede inyectar para probar las ETA.
export const calcularEstadisticasOso = (orders, boMeta, boDraft, hoy = new Date()) => {
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
  const todayUtc = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let allocPctSum = 0;
  orders.forEach(order => {
    const status = estadoOrden(order).toLowerCase();
    if (status === 'parcial') stats.parcial += 1;
    else if (status === 'completa') stats.completa += 1;
    else stats.activa += 1;
    const totals = totalesOrden(order);
    stats.totalOrderQty += totals.orderQty;
    stats.totalAllocQty += totals.allocQty;
    stats.totalShippedQty += totals.shippedQty;
    allocPctSum += porcentajeAsignadoOrden(order, totals, metaDeOrden(boMeta, boDraft, order?.bo));
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

// Monto de una línea desde su borrador (0 si falta el BO o la línea).
const montoDeLinea = (drafts, bo, line, campo) => {
  if (!bo || !line) return 0;
  return numeroMonto(drafts[bo], line, campo);
};

// Una fila por línea de cada orden, para el reporte detallado.
// drafts = { boMeta, boDraft, axisDraft, intcomexDraft }.
export const filasReporteLineas = (orders, { boMeta, boDraft, axisDraft, intcomexDraft }) => {
  const rows = [];
  orders.forEach(order => {
    const bo = order?.bo || '';
    const meta = metaDeOrden(boMeta, boDraft, order?.bo);
    const cliente = nombreClienteOrden(order, boMeta, boDraft);
    const invoiceMonth = mesFacturacionDeBo(boMeta, boDraft, order?.bo);
    const invoiceWeek = semanaFacturacionDeBo(boMeta, boDraft, order?.bo);
    const customerPo = order?.customerPO || meta?.customerPO || '';
    const poAxis = meta?.poAxis || '';
    const projectName = meta?.projectName || '';
    (order.lines || []).forEach((line, idx) => {
      const entregaOor = line.tiempoEntrega || '';
      const montoAxis = montoDeLinea(axisDraft, order?.bo, line, 'montoAxis');
      const montoIntcomex = montoDeLinea(intcomexDraft, order?.bo, line, 'montoIntcomex');
      rows.push({
        key: `${bo}-${line.lineIndex ?? idx}-${line.sku || ''}-${line.mpn || ''}`.trim(),
        lineIndex: line.lineIndex ?? idx,
        bo,
        customerPo,
        poAxis,
        projectName,
        cliente,
        empresa: cliente,
        sku: line.sku || '',
        mpn: line.mpn || '',
        desc: line.desc || '',
        entregaOor,
        etaEstimado: entregaOor ? sumarDiasIso(entregaOor, 15) : '',
        invoiceMonth,
        invoiceWeek: invoiceWeek ? Number(invoiceWeek) : '',
        allocQty: line.allocQty ?? 0,
        orderQty: line.orderQty ?? 0,
        shippedQty: line.shippedQty ?? 0,
        montoAxis,
        montoFacturar: montoAxis * (Number(line.orderQty) || 0),
        montoIntcomex,
        montoFacturarIntcomex: montoIntcomex * (Number(line.orderQty) || 0),
        notas: ''
      });
    });
  });
  return rows;
};

// --- Marca y correo S&D -------------------------------------------------------

export const normalizarMarca = (value) => {
  const raw = (value || '').toString().toLowerCase();
  if (raw.includes('axis')) return 'Axis';
  if (raw.includes('qnap')) return 'QNAP';
  if (raw.includes('iss')) return 'ISS';
  if (raw.includes('neural')) return 'Neural Labs';
  if (raw.includes('milestone')) return 'Milestone';
  return (value || '').toString().trim();
};

export const marcaDeOrden = (order) => {
  const candidate =
    order?.brand ||
    order?.marca ||
    order?.manufBrand ||
    order?.manufacturer ||
    order?.lines?.[0]?.brand ||
    order?.lines?.[0]?.marca ||
    '';
  return normalizarMarca(candidate);
};

export const htmlSAndD = (order, boMeta, boDraft) => {
  const bo = order?.bo || '';
  const po = boDraft[order?.bo]?.projectName ?? boMeta[order?.bo]?.projectName ?? '';
  const brand = marcaDeOrden(order) || '';
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

// --- Listas y filtros ---------------------------------------------------------

// BOs marcados como facturados en la meta que ya no vienen en la lista de órdenes.
export const ordenesFacturadasFueraDeLista = (boMeta, osoOrders) => {
  const existing = new Set(osoOrders.map(order => order.bo));
  return Object.entries(boMeta)
    .filter(([bo, meta]) => meta?.invoiced && !meta?.deleted && !existing.has(bo))
    .map(([bo, meta]) => ({ bo, ...meta }))
    .sort((a, b) => new Date(b.invoicedAt || 0).getTime() - new Date(a.invoicedAt || 0).getTime());
};

// Filtro de texto + orden ('cliente' | 'bo' | 'lastSeen' | otro = por fecha de facturación desc).
export const ordenarFacturadas = (invoicedBos, invoicedSort, invoicedFilter) => {
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
};

const indiceDeMes = (key) => {
  if (!/^\d{4}-\d{2}$/.test(key || '')) return Number.NEGATIVE_INFINITY;
  const [year, month] = String(key).split('-').map(Number);
  return (year * 12) + (month - 1);
};

// Meses para el selector de facturación: 36 desde el actual + los ya guardados o en
// borrador (aunque sean pasados, para que se vean y puedan corregirse; deshabilitados).
export const opcionesMesFacturacion = (boMeta, boDraft, ahora = new Date()) => {
  const options = new Set();
  const now = ahora;
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentIndex = indiceDeMes(currentKey);

  for (let i = 0; i < 36; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.add(key);
  }
  Object.values(boMeta || {}).forEach(meta => {
    const key = normalizarMesFacturacion(meta?.estimatedInvoiceMonth || meta?.estimatedInvoiceDate);
    if (key) options.add(key);
  });
  Object.values(boDraft || {}).forEach(draft => {
    const key = normalizarMesFacturacion(draft?.estimatedInvoiceMonth);
    if (key) options.add(key);
  });
  return Array.from(options)
    .sort((a, b) => indiceDeMes(a) - indiceDeMes(b))
    .map((key) => {
      const [year, month] = key.split('-');
      const d = new Date(Number(year), Number(month) - 1, 1);
      const idx = indiceDeMes(key);
      const isPast = idx < currentIndex;
      return {
        value: key,
        label: `${MONTH_LABEL_FORMATTER.format(d).replace('.', '')}${isPast ? ' (pasado)' : ''}`,
        disabled: isPast
      };
    });
};

const FILTROS_RAPIDOS = new Set(['all', 'sd-pending', 'missing-project', 'missing-po']);

// Filtra y ordena las órdenes de la vista.
// opciones = { boMeta, boDraft, texto, esAdmin, empresa, estado, filtroRapido,
//              mesFacturacion, orden, busquedaGlobal }
//  - texto: filtro de la vista (se ignora si esAdmin), busca en BO y cliente.
//  - busquedaGlobal: ya en minúsculas y sin espacios en los extremos.
//  - estado: 'all' | 'activa' | 'parcial' | 'completa' (minúsculas).
//  - orden: 'empresa' | 'porcentaje' | 'fact-month' | 'eta' | otro = por BO.
export const filtrarOrdenarOrdenesOso = (osoOrders, opciones) => {
  const {
    boMeta,
    boDraft,
    texto,
    esAdmin,
    empresa,
    estado,
    filtroRapido,
    mesFacturacion,
    orden,
    busquedaGlobal
  } = opciones;
  const query = esAdmin ? '' : (texto || '').trim().toLowerCase();
  const companyFilter = (empresa || '').trim().toLowerCase();
  const list = osoOrders.filter(order => {
    const bo = (order.bo || '').toString().toLowerCase();
    const customer = (order.customerName || '').toString().toLowerCase();
    // El proyecto y el PO Axis no vienen en la orden: viven en la meta del BO (lo que
    // se ve en la tarjeta, borrador incluido). Antes se buscaba en order.projectName /
    // order.poAxis, que no existen, y la búsqueda nunca encontraba por esos dos campos.
    const metaBusqueda = busquedaGlobal ? metaDeOrden(boMeta, boDraft, order.bo) : null;
    const globalMatch = !busquedaGlobal || [
      order.bo,
      order.customerName,
      metaBusqueda.projectName,
      metaBusqueda.poAxis,
      ...(order.lines || []).map(line => `${line.sku || ''} ${line.mpn || ''}`)
    ].some(v => (v || '').toString().toLowerCase().includes(busquedaGlobal));
    const matchesText = (!query || bo.includes(query) || customer.includes(query)) && globalMatch;
    if (!matchesText) return false;
    if (companyFilter) {
      const name = nombreClienteOrden(order, boMeta, boDraft).toLowerCase();
      if (name !== companyFilter) return false;
    }
    if (!estado || estado === 'all') return true;
    const status = estadoOrden(order);
    return status.toLowerCase() === estado;
  });
  const filteredByQuick = list.filter(order => {
    const meta = metaDeOrden(boMeta, boDraft, order.bo);
    const projectName = (meta.projectName || '').trim();
    const poAxis = (meta.poAxis || '').trim();
    const invoiceMonth = normalizarMesFacturacion(meta.estimatedInvoiceMonth) || normalizarMesFacturacion(meta.estimatedInvoiceDate);
    if (mesFacturacion && invoiceMonth !== mesFacturacion) return false;
    const quickFilter = FILTROS_RAPIDOS.has(filtroRapido) ? filtroRapido : 'all';
    if (!quickFilter || quickFilter === 'all') return true;
    if (quickFilter === 'sd-pending') return estadoSAndD(boMeta, order.bo) !== 'aplicado';
    if (quickFilter === 'missing-project') return !projectName;
    if (quickFilter === 'missing-po') return !poAxis;
    return true;
  });
  if (orden === 'empresa') {
    return [...filteredByQuick].sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
  }
  if (orden === 'porcentaje') {
    return [...filteredByQuick].sort((a, b) => (Number(b.allocPct) || 0) - (Number(a.allocPct) || 0));
  }
  if (orden === 'fact-month') {
    return [...filteredByQuick].sort((a, b) => {
      const monthA = mesFacturacionDeBo(boMeta, boDraft, a.bo) || '9999-99';
      const monthB = mesFacturacionDeBo(boMeta, boDraft, b.bo) || '9999-99';
      if (monthA !== monthB) return monthA.localeCompare(monthB);
      const weekA = Number(semanaFacturacionDeBo(boMeta, boDraft, a.bo) || 99);
      const weekB = Number(semanaFacturacionDeBo(boMeta, boDraft, b.bo) || 99);
      if (weekA !== weekB) return weekA - weekB;
      return (a.bo || '').localeCompare(b.bo || '');
    });
  }
  if (orden === 'eta') {
    const toTs = (value) => {
      if (!value) return Number.POSITIVE_INFINITY;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
    };
    return [...filteredByQuick].sort((a, b) => toTs(a.etaEstimated) - toTs(b.etaEstimated));
  }
  return [...filteredByQuick].sort((a, b) => (a.bo || '').localeCompare(b.bo || ''));
};

// Empresas (con su cantidad de órdenes) para el selector, ordenadas por nombre.
export const empresasOso = (osoOrders, boMeta, boDraft) => {
  const map = new Map();
  osoOrders.forEach(order => {
    const name = nombreClienteOrden(order, boMeta, boDraft);
    map.set(name, (map.get(name) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

// --- Carga desde la API ---------------------------------------------------------

// Convierte la respuesta de OSO y de la meta de BO en { orders, boMeta, faltantes }.
// `faltantes` son los BO con meta que ya no vienen en OSO y que no están facturados
// ni eliminados. La usan la vista de órdenes y el cargador del dashboard.
export const procesarCargaOso = (data, metaRows) => {
  const orders = data.orders || [];
  const metaMap = (metaRows || []).reduce((acc, row) => {
    if (!row?.bo) return acc;
    const invoiceMonth = normalizarMesFacturacion(row.estimated_invoice_month || row.estimatedInvoiceMonth || row.estimated_invoice_date || row.estimatedInvoiceDate || '');
    const invoiceWeek = normalizarSemanaFacturacion(row.estimated_invoice_week ?? row.estimatedInvoiceWeek ?? '');
    acc[row.bo] = {
      projectName: row.project_name || row.projectName || '',
      poAxis: row.po_axis || row.poAxis || '',
      estimatedInvoiceDate: row.estimated_invoice_date || row.estimatedInvoiceDate || '',
      estimatedInvoiceMonth: invoiceMonth,
      estimatedInvoiceWeek: invoiceWeek,
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
  const existingBos = new Set(orders.map(order => order.bo));
  const faltantes = Object.keys(metaMap).filter(bo =>
    !existingBos.has(bo) && !metaMap[bo]?.invoiced && !metaMap[bo]?.deleted
  );
  return { orders, boMeta: metaMap, faltantes };
};

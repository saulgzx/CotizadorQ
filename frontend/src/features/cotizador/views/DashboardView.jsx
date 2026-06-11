import React from 'react';
import { useCotizador } from '../cotizadorContext';
import { formatCurrency } from '../cotizadorHelpers';

export default function DashboardView() {
  const {
    isAdmin,
    globalSearch,
    setGlobalSearch,
    dashboardKpis,
    dashboardInvoiceMonth,
    setDashboardInvoiceMonth,
    invoiceMonthOptions,
    dashboardBilling,
    setCurrentView,
    syncStatus
  } = useCotizador();

  const formatSyncAge = (createdAt) => {
    const ts = new Date(createdAt).getTime();
    if (Number.isNaN(ts)) return '';
    const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `hace ${hours} h`;
    return `hace ${Math.round(hours / 24)} días`;
  };

  return (
    <div className="space-y-4 view-enter">
      {isAdmin && (
        <div className="glass-card rounded-2xl border border-white/70 dark:border-white/10 p-4 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.4)]">
          <input
            type="text"
            aria-label="Buscar"
            placeholder="Buscar..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60"
          />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 stagger-children">
        {dashboardKpis.map((kpi) => (
          <div key={kpi.label} className="glass-card rounded-2xl border border-white/70 dark:border-white/10 p-4 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.4)] transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="text-xs text-slate-500 dark:text-slate-400">{kpi.label}</div>
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">{kpi.value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{kpi.hint}</div>
          </div>
        ))}
      </div>
      {isAdmin && syncStatus?.syncs?.length > 0 && (
        <div className="glass-card rounded-2xl border border-white/70 dark:border-white/10 p-3 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.4)]">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Catálogo (Google Sheets):</span>
            {syncStatus.syncs.map((s) => {
              const ok = s.status === 'ok';
              const ageLabel = formatSyncAge(s.created_at);
              return (
                <span
                  key={s.origen}
                  title={s.warnings || s.error || ''}
                  className={`max-w-full truncate px-2 py-1 rounded-full border ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'}`}
                >
                  {s.origen}: {ok
                    ? `sincronizado ${ageLabel} (${s.inserted} nuevos, ${s.updated} actualizados${s.rejected > 0 ? `, ${s.rejected} rechazados` : ''})`
                    : `${s.status === 'aborted' ? 'ABORTADO' : s.status === 'error' ? 'ERROR' : s.status} ${ageLabel}`}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {isAdmin && (
        <div className="glass-card rounded-2xl border border-white/70 dark:border-white/10 p-4 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.4)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">Facturación estimada y reportada</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Fuente: BO + mes/semana facturación + montos Axis/Intcomex.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Mes:</span>
              <select
                value={dashboardInvoiceMonth}
                onChange={(e) => setDashboardInvoiceMonth(e.target.value)}
                className="px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900/60"
              >
                {invoiceMonthOptions.map(option => (
                  <option key={`dashboard-month-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/10 p-4">
              <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Estimado restante ({dashboardBilling.monthLabel})</div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg border border-emerald-200 bg-white/80 dark:border-emerald-500/30 dark:bg-slate-900/40 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Axis</div>
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(dashboardBilling.remainingAxis)}</div>
                </div>
                <div className="rounded-lg border border-sky-200 bg-white/80 dark:border-sky-500/30 dark:bg-slate-900/40 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Intcomex</div>
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(dashboardBilling.remainingIntcomex)}</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                BO: {dashboardBilling.remainingBos} (con monto: {dashboardBilling.remainingWithAmounts})
              </div>
              <div className="mt-3 space-y-2">
                {dashboardBilling.remainingRows.map(row => {
                  const maxAxis = dashboardBilling.maxRemainingAxis || 1;
                  const maxIntcomex = dashboardBilling.maxRemainingIntcomex || 1;
                  const axisPct = row.axis > 0 ? Math.max(4, Math.round((row.axis / maxAxis) * 100)) : 0;
                  const intcomexPct = row.intcomex > 0 ? Math.max(4, Math.round((row.intcomex / maxIntcomex) * 100)) : 0;
                  return (
                    <div key={`remaining-${row.week}`}>
                      <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        <span>{row.week}</span>
                        <span>A: {formatCurrency(row.axis)} · I: {formatCurrency(row.intcomex)}</span>
                      </div>
                      <div className="h-2 w-full bg-white dark:bg-slate-800/80 rounded-full overflow-hidden border border-emerald-100 dark:border-emerald-500/20">
                        <div className="h-full bg-emerald-500" style={{ width: `${axisPct}%` }} />
                      </div>
                      <div className="h-2 w-full bg-white dark:bg-slate-800/80 rounded-full overflow-hidden border border-sky-100 dark:border-sky-500/20 mt-1">
                        <div className="h-full bg-sky-500" style={{ width: `${intcomexPct}%` }} />
                      </div>
                      {row.boSummaries.length > 0 && (
                        <details className="mt-1.5 rounded-md border border-emerald-100 bg-white/80 dark:border-emerald-500/20 dark:bg-slate-900/40 px-2 py-1 max-w-full overflow-hidden">
                          <summary className="cursor-pointer text-[11px] text-emerald-800 dark:text-emerald-300 font-medium select-none">
                            Ver resumen BO ({row.boSummaries.length})
                          </summary>
                          <div className="mt-1 max-h-40 overflow-y-auto overflow-x-hidden divide-y divide-emerald-50 dark:divide-emerald-500/10">
                            {row.boSummaries.map((item) => (
                              <div key={`remaining-week-detail-${row.week}-${item.bo}`} className="py-1 text-[11px] text-slate-700 dark:text-slate-300">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">BO {item.bo || 'N/A'}</span>
                                  <span className="font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(item.total)}</span>
                                </div>
                                <div className="text-slate-500 dark:text-slate-400 truncate">{item.customerName}</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/40 dark:border-blue-500/20 dark:bg-blue-500/10 p-4">
              <div className="text-sm font-semibold text-blue-800 dark:text-blue-300">Ya facturado reportado ({dashboardBilling.monthLabel})</div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg border border-blue-200 bg-white/80 dark:border-blue-500/30 dark:bg-slate-900/40 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Axis</div>
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(dashboardBilling.invoicedAxis)}</div>
                </div>
                <div className="rounded-lg border border-cyan-200 bg-white/80 dark:border-cyan-500/30 dark:bg-slate-900/40 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Intcomex</div>
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(dashboardBilling.invoicedIntcomex)}</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                BO: {dashboardBilling.invoicedBos} (con monto: {dashboardBilling.invoicedWithAmounts})
              </div>
              <div className="mt-3 space-y-2">
                {dashboardBilling.invoicedRows.map(row => {
                  const maxAxis = dashboardBilling.maxInvoicedAxis || 1;
                  const maxIntcomex = dashboardBilling.maxInvoicedIntcomex || 1;
                  const axisPct = row.axis > 0 ? Math.max(4, Math.round((row.axis / maxAxis) * 100)) : 0;
                  const intcomexPct = row.intcomex > 0 ? Math.max(4, Math.round((row.intcomex / maxIntcomex) * 100)) : 0;
                  return (
                    <div key={`invoiced-${row.week}`}>
                      <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        <span>{row.week}</span>
                        <span>A: {formatCurrency(row.axis)} · I: {formatCurrency(row.intcomex)}</span>
                      </div>
                      <div className="h-2 w-full bg-white dark:bg-slate-800/80 rounded-full overflow-hidden border border-blue-100 dark:border-blue-500/20">
                        <div className="h-full bg-blue-500" style={{ width: `${axisPct}%` }} />
                      </div>
                      <div className="h-2 w-full bg-white dark:bg-slate-800/80 rounded-full overflow-hidden border border-cyan-100 dark:border-cyan-500/20 mt-1">
                        <div className="h-full bg-cyan-500" style={{ width: `${intcomexPct}%` }} />
                      </div>
                      {row.boSummaries.length > 0 && (
                        <details className="mt-1.5 rounded-md border border-blue-100 bg-white/80 dark:border-blue-500/20 dark:bg-slate-900/40 px-2 py-1 max-w-full overflow-hidden">
                          <summary className="cursor-pointer text-[11px] text-blue-800 dark:text-blue-300 font-medium select-none">
                            Ver resumen BO ({row.boSummaries.length})
                          </summary>
                          <div className="mt-1 max-h-40 overflow-y-auto overflow-x-hidden divide-y divide-blue-50 dark:divide-blue-500/10">
                            {row.boSummaries.map((item) => (
                              <div key={`invoiced-week-detail-${row.week}-${item.bo}`} className="py-1 text-[11px] text-slate-700 dark:text-slate-300">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">BO {item.bo || 'N/A'}</span>
                                  <span className="font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(item.total)}</span>
                                </div>
                                <div className="text-slate-500 dark:text-slate-400 truncate">{item.customerName}</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="glass-card rounded-2xl border border-white/70 dark:border-white/10 p-4 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.4)]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">Accesos rápidos</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Atajos de teclado: Alt+1 Dashboard, Alt+2 Cotizador, Alt+3 Historial.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setCurrentView('cotizador')} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">Ir a cotizador</button>
          <button onClick={() => setCurrentView('historial')} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm hover:bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Ver historial</button>
          {isAdmin && (
            <>
              <button onClick={() => setCurrentView('admin')} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm hover:bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Lista de precios</button>
              <button onClick={() => setCurrentView('ordenes')} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm hover:bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Órdenes activas</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { useCotizador } from '../cotizadorContext';
import { formatCurrency } from '../cotizadorHelpers';
import EncabezadoPagina from '../../ui/EncabezadoPagina';
import Icono from '../../ui/Icono';

const tarjeta = 'glass-card rounded-2xl border border-slate-200 shadow-card';

// Barras de facturación: AXIS en su color de marca, Intcomex en tinta.
const BARRA_AXIS = 'bg-amber-400';
const BARRA_INTCOMEX = 'bg-slate-700 dark:bg-slate-300';

function Leyenda() {
  return (
    <span className='flex items-center gap-3 text-xs text-slate-500'>
      <span className='flex items-center gap-1.5'><span className={`h-2 w-2 rounded-full ${BARRA_AXIS}`} />AXIS</span>
      <span className='flex items-center gap-1.5'><span className={`h-2 w-2 rounded-full ${BARRA_INTCOMEX}`} />Intcomex</span>
    </span>
  );
}

function PanelFacturacion({ titulo, axis, intcomex, bos, conMonto, filas, maxAxis, maxIntcomex, prefijo }) {
  return (
    <section className='rounded-xl border border-slate-200 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold text-slate-900'>{titulo}</h3>
        <span className='text-xs text-slate-500'>{bos} BO · {conMonto} con monto</span>
      </div>
      <dl className='mt-3 grid grid-cols-2 gap-2'>
        <div className='rounded-lg bg-slate-50 px-3 py-2'>
          <dt className='mq-sobre'>AXIS</dt>
          <dd className='text-lg font-bold tabular-nums text-slate-900'>{formatCurrency(axis)}</dd>
        </div>
        <div className='rounded-lg bg-slate-50 px-3 py-2'>
          <dt className='mq-sobre'>Intcomex</dt>
          <dd className='text-lg font-bold tabular-nums text-slate-900'>{formatCurrency(intcomex)}</dd>
        </div>
      </dl>
      <ul className='mt-4 space-y-3'>
        {filas.map((row) => {
          const axisPct = row.axis > 0 ? Math.max(3, Math.round((row.axis / (maxAxis || 1)) * 100)) : 0;
          const intcomexPct = row.intcomex > 0 ? Math.max(3, Math.round((row.intcomex / (maxIntcomex || 1)) * 100)) : 0;
          const vacia = !row.axis && !row.intcomex;
          return (
            <li key={`${prefijo}-${row.week}`}>
              <div className='mb-1 flex flex-wrap items-center justify-between gap-x-2 text-xs'>
                <span className='font-medium text-slate-700'>{row.week}</span>
                <span className={`tabular-nums ${vacia ? 'text-slate-400' : 'text-slate-600'}`}>
                  {formatCurrency(row.axis)} · {formatCurrency(row.intcomex)}
                </span>
              </div>
              <div className='space-y-1'>
                <div className='h-1.5 w-full overflow-hidden rounded-full bg-slate-100'>
                  <div className={`h-full rounded-full ${BARRA_AXIS}`} style={{ width: `${axisPct}%` }} />
                </div>
                <div className='h-1.5 w-full overflow-hidden rounded-full bg-slate-100'>
                  <div className={`h-full rounded-full ${BARRA_INTCOMEX}`} style={{ width: `${intcomexPct}%` }} />
                </div>
              </div>
              {row.boSummaries.length > 0 && (
                <details className='group mt-1.5'>
                  <summary className='inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900'>
                    <Icono nombre='abajo' className='h-3.5 w-3.5 transition group-open:rotate-180' />
                    {row.boSummaries.length} BO
                  </summary>
                  <ul className='mt-1 max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200'>
                    {row.boSummaries.map((item) => (
                      <li key={`${prefijo}-detalle-${row.week}-${item.bo}`} className='flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs'>
                        <span className='min-w-0'>
                          <span className='font-mono text-slate-700'>{item.bo || 'N/A'}</span>
                          <span className='ml-2 truncate text-slate-500'>{item.customerName}</span>
                        </span>
                        <span className='font-semibold tabular-nums text-slate-900'>{formatCurrency(item.total)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
    syncStatus,
    seguimiento = [],
    abrirCotizacionEnHistorial,
    isFullAdmin
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

  const mesActual = new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

  return (
    <div className='view-enter'>
      <EncabezadoPagina seccion='Ventas' titulo='Dashboard' subtitulo={`Resumen de ${mesActual}`}>
        {isAdmin && (
          <label className='relative block w-64 max-w-full' htmlFor='dashboard-buscar'>
            <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'>
              <Icono nombre='search' />
            </span>
            <input
              id='dashboard-buscar'
              type='text'
              aria-label='Buscar en todas las vistas'
              placeholder='Buscar en todas las vistas…'
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className='h-10 w-full rounded-[10px] border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900'
            />
          </label>
        )}
        <button type='button' onClick={() => setCurrentView('cotizador')} className='mq-btn mq-btn-primario'>
          Nueva cotización
        </button>
      </EncabezadoPagina>

      <div className='space-y-4'>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          {dashboardKpis.map((kpi) => {
            const Tag = kpi.onClick ? 'button' : 'div';
            return (
              <Tag
                key={kpi.label}
                {...(kpi.onClick ? { type: 'button', onClick: kpi.onClick } : {})}
                className={`${tarjeta} p-4 text-left ${kpi.onClick ? 'transition hover:border-slate-300' : ''}`}
              >
                <div className='mq-sobre'>{kpi.label}</div>
                <div className='mt-1.5 text-[28px] font-bold leading-8 tracking-tight tabular-nums text-slate-900'>{kpi.value}</div>
                <div className='mt-1 text-xs text-slate-500'>{kpi.hint}</div>
              </Tag>
            );
          })}
        </div>

        {isFullAdmin && seguimiento.length > 0 && (
          <section className={`${tarjeta} p-4`}>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <h3 className='text-base font-semibold text-slate-900'>Para hacer seguimiento</h3>
              <span className='text-xs text-slate-500'>Enviadas hace más de 7 días, sin aprobar ni rechazar</span>
            </div>
            <ul className='mt-3 divide-y divide-slate-100'>
              {seguimiento.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <button
                    type='button'
                    onClick={() => abrirCotizacionEnHistorial(item.id)}
                    className='flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-slate-50'
                  >
                    <span className='min-w-0'>
                      <span className='mr-2 font-mono text-xs text-slate-500'>{item.folio}</span>
                      <span className='font-medium text-slate-900'>{item.empresa}</span>
                      {item.proyecto && <span className='text-slate-500'> · {item.proyecto}</span>}
                    </span>
                    <span className='flex items-center gap-3'>
                      <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold ${item.dias > 21 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                        hace {item.dias} días
                      </span>
                      <span className='font-semibold tabular-nums text-slate-900'>{formatCurrency(item.total)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {seguimiento.length > 8 && (
              <p className='mt-2 text-xs text-slate-500'>Y {seguimiento.length - 8} más en el historial.</p>
            )}
          </section>
        )}

        {isAdmin && syncStatus?.syncs?.length > 0 && (
          <div className='flex flex-wrap items-center gap-2 text-xs'>
            <span className='mq-sobre'>Catálogo</span>
            {syncStatus.syncs.map((s) => {
              const ok = s.status === 'ok';
              const ageLabel = formatSyncAge(s.created_at);
              return (
                <span
                  key={s.origen}
                  title={s.warnings || s.error || ''}
                  className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                >
                  <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-current' />
                  {s.origen}: {ok
                    ? `sincronizado ${ageLabel} · ${s.inserted} nuevos, ${s.updated} actualizados${s.rejected > 0 ? `, ${s.rejected} rechazados` : ''}`
                    : `${s.status === 'aborted' ? 'abortado' : s.status === 'error' ? 'con error' : s.status} ${ageLabel}`}
                </span>
              );
            })}
          </div>
        )}

        {isAdmin && (
          <section className={`${tarjeta} p-4`}>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h3 className='text-base font-semibold text-slate-900'>Facturación estimada y reportada</h3>
                <p className='text-xs text-slate-500'>Por semana de facturación de cada BO, con montos AXIS e Intcomex.</p>
              </div>
              <div className='flex items-center gap-4'>
                <Leyenda />
                <label className='flex items-center gap-2 text-xs font-medium text-slate-500' htmlFor='dashboard-mes'>
                  Mes
                  <select
                    id='dashboard-mes'
                    value={dashboardInvoiceMonth}
                    onChange={(e) => setDashboardInvoiceMonth(e.target.value)}
                    className='h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900'
                  >
                    {invoiceMonthOptions.map(option => (
                      <option key={`dashboard-month-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className='mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2'>
              <PanelFacturacion
                titulo={`Por facturar · ${dashboardBilling.monthLabel}`}
                axis={dashboardBilling.remainingAxis}
                intcomex={dashboardBilling.remainingIntcomex}
                bos={dashboardBilling.remainingBos}
                conMonto={dashboardBilling.remainingWithAmounts}
                filas={dashboardBilling.remainingRows}
                maxAxis={dashboardBilling.maxRemainingAxis}
                maxIntcomex={dashboardBilling.maxRemainingIntcomex}
                prefijo='restante'
              />
              <PanelFacturacion
                titulo={`Facturado · ${dashboardBilling.monthLabel}`}
                axis={dashboardBilling.invoicedAxis}
                intcomex={dashboardBilling.invoicedIntcomex}
                bos={dashboardBilling.invoicedBos}
                conMonto={dashboardBilling.invoicedWithAmounts}
                filas={dashboardBilling.invoicedRows}
                maxAxis={dashboardBilling.maxInvoicedAxis}
                maxIntcomex={dashboardBilling.maxInvoicedIntcomex}
                prefijo='facturado'
              />
            </div>
          </section>
        )}

        <section className={`${tarjeta} p-4`}>
          <h3 className='text-base font-semibold text-slate-900'>Accesos rápidos</h3>
          <p className='mt-1 text-xs text-slate-500'>
            Atajos: <kbd className='font-mono'>Alt+1</kbd> Dashboard · <kbd className='font-mono'>Alt+2</kbd> Cotizador · <kbd className='font-mono'>Alt+3</kbd> Historial · <kbd className='font-mono'>Alt+4</kbd> Stock · <kbd className='font-mono'>/</kbd> buscar producto · <kbd className='font-mono'>?</kbd> todos los atajos
          </p>
          <div className='mt-3 flex flex-wrap gap-2'>
            <button type='button' onClick={() => setCurrentView('cotizador')} className='mq-btn mq-btn-sm mq-btn-primario'>Ir al cotizador</button>
            <button type='button' onClick={() => setCurrentView('historial')} className='mq-btn mq-btn-sm mq-btn-secundario'>Ver historial</button>
            {isAdmin && (
              <>
                <button type='button' onClick={() => setCurrentView('admin')} className='mq-btn mq-btn-sm mq-btn-secundario'>Listas de precio</button>
                <button type='button' onClick={() => setCurrentView('ordenes')} className='mq-btn mq-btn-sm mq-btn-secundario'>Órdenes activas</button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

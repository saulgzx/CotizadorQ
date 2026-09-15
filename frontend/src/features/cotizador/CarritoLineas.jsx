import React from 'react';
import NumeroInput from '../ui/NumeroInput';
import MargenChip from './MargenChip';
import { formatCurrency } from './cotizadorHelpers';

// Carrito del cotizador con el mismo formato que el editor de cotizaciones:
// una fila por producto, costo ⇄ GP ⇄ precio enlazados y margen a la vista.
// Los clientes ven solo producto, cantidad, precio y entrega.

const PARTNERS = ['Partner Autorizado', 'Partner Silver', 'Partner Gold', 'Partner Multiregional'];

const textoBase =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

const BotonMover = ({ onClick, disabled, label, children }) => (
  <button type='button' onClick={onClick} disabled={disabled} aria-label={label} className='px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30'>
    {children}
  </button>
);

const CeldaProducto = ({ item, isAdmin, onCambio }) => (
  <div className='min-w-0'>
    <div className='mb-1 flex flex-wrap items-center gap-1.5'>
      <span className={`rounded px-1.5 text-xs font-semibold ${(item.origen || 'QNAP') === 'AXIS' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'}`}>
        {item.marca || item.origen}
      </span>
      <span className='font-mono text-xs text-slate-600'>{item.sku && item.sku !== 'To Create' ? item.sku : 'SKU por crear'}</span>
      <span className='font-mono text-xs text-slate-400'>{item.mpn}</span>
    </div>
    {isAdmin ? (
      <textarea
        value={item.desc || ''}
        onChange={(e) => onCambio(item.id, 'desc', e.target.value)}
        rows={2}
        aria-label='Descripción'
        className={`${textoBase} resize-y text-xs`}
      />
    ) : (
      <p className='text-sm text-slate-800'>{item.desc}</p>
    )}
  </div>
);

export default function CarritoLineas({
  items,
  isAdmin,
  precioItem,
  margenItem,
  gpBase,
  rebatePartner,
  partnerDefault,
  onCambio,
  onQuitar,
  onMover
}) {
  if (items.length === 0) {
    return (
      <div className='p-8 text-center text-sm text-slate-500'>
        <p className='font-medium text-slate-600'>El carrito está vacío</p>
        <p className='mt-1'>Busca por SKU, MPN o modelo, o usa «Pegar lista».</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[640px] text-sm'>
          <thead className='bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800'>
            <tr>
              <th className='px-3 py-2 text-left'>Producto</th>
              <th className='w-24 px-2 py-2 text-right'>Cant.</th>
              <th className='w-32 px-2 py-2 text-right'>P. unitario</th>
              <th className='w-32 px-2 py-2 text-right'>Total</th>
              <th className='w-48 px-2 py-2 text-left'>Entrega</th>
              <th className='w-10 px-2 py-2' />
            </tr>
          </thead>
          <tbody className='divide-y divide-slate-100 dark:divide-slate-800'>
            {items.map((item) => {
              const pu = precioItem(item);
              return (
                <tr key={item.id} className='align-top'>
                  <td className='px-3 py-2'>
                    <CeldaProducto item={item} isAdmin={false} onCambio={onCambio} />
                  </td>
                  <td className='px-2 py-2'>
                    <NumeroInput entero min={1} value={item.cant} onCommit={(v) => onCambio(item.id, 'cant', v)} ariaLabel='Cantidad' />
                  </td>
                  <td className='px-2 py-2 text-right tabular-nums'>{formatCurrency(pu)}</td>
                  <td className='px-2 py-2 text-right font-semibold tabular-nums text-blue-700 dark:text-blue-300'>{formatCurrency(pu * item.cant)}</td>
                  <td className='px-2 py-2 text-xs text-slate-600'>{item.tiempo}</td>
                  <td className='px-2 py-2 text-center'>
                    <button type='button' onClick={() => onQuitar(item.id)} aria-label={`Quitar ${item.sku || item.mpn}`} className='rounded px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600'>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[1040px] text-sm'>
        <thead className='bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800'>
          <tr>
            <th className='w-8 px-1 py-2' />
            <th className='px-2 py-2 text-left'>Producto</th>
            <th className='w-20 px-2 py-2 text-right'>Cant.</th>
            <th className='w-44 px-2 py-2 text-left'>Costo</th>
            <th className='w-24 px-2 py-2 text-right'>GP %</th>
            <th className='w-32 px-2 py-2 text-right'>P. unitario</th>
            <th className='w-28 px-2 py-2 text-right'>Total</th>
            <th className='w-28 px-2 py-2 text-right'>Margen</th>
            <th className='w-44 px-2 py-2 text-left'>Entrega</th>
            <th className='w-10 px-2 py-2' />
          </tr>
        </thead>
        <tbody className='divide-y divide-slate-100 dark:divide-slate-800'>
          {items.map((item, index) => {
            const esAxis = (item.origen || 'QNAP') === 'AXIS';
            const m = margenItem(item);
            const gpGlobal = gpBase(item) * 100;
            const tieneGpPropio = item.gpOverride !== null && item.gpOverride !== undefined;
            return (
              <tr key={item.id} className='align-top'>
                <td className='px-1 py-2'>
                  <div className='flex flex-col items-center text-xs'>
                    <BotonMover onClick={() => onMover(index, -1)} disabled={index === 0} label='Subir línea'>▲</BotonMover>
                    <span className='text-slate-400'>{index + 1}</span>
                    <BotonMover onClick={() => onMover(index, 1)} disabled={index === items.length - 1} label='Bajar línea'>▼</BotonMover>
                  </div>
                </td>
                <td className='min-w-[240px] px-2 py-2'>
                  <CeldaProducto item={item} isAdmin onCambio={onCambio} />
                </td>
                <td className='px-2 py-2'>
                  <NumeroInput entero min={1} value={item.cant} onCommit={(v) => onCambio(item.id, 'cant', v)} ariaLabel='Cantidad' />
                </td>
                <td className='px-2 py-2'>
                  <div className='flex flex-col gap-1 text-xs'>
                    {item.costoChile > 0 ? (
                      <div className='rounded-md bg-emerald-50 px-2 py-1 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' title='OH Unit USD de la hoja Stock'>
                        <div className='font-semibold'>Real stock {formatCurrency(item.costoChile)}</div>
                        <button type='button' onClick={() => onCambio(item.id, 'costoChile', null)} className='underline decoration-dotted'>
                          usar costo disty
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className='uppercase text-slate-400'>Disty USD</span>
                        <NumeroInput value={item.precio} onCommit={(v) => onCambio(item.id, 'precio', v)} ariaLabel='Costo disty' />
                      </>
                    )}
                    {esAxis && (
                      <>
                        <select
                          value={item.partnerCategory || partnerDefault}
                          onChange={(e) => onCambio(item.id, 'partnerCategory', e.target.value)}
                          aria-label='Categoría de partner'
                          className={`${textoBase} text-xs`}
                        >
                          {PARTNERS.map((p) => (
                            <option key={p} value={p}>
                              {p.replace('Partner ', '')} · {formatCurrency(rebatePartner(item, p))}
                            </option>
                          ))}
                        </select>
                        <span className='uppercase text-slate-400'>Rebate proyecto</span>
                        <NumeroInput value={item.rebateProject ?? 0} onCommit={(v) => onCambio(item.id, 'rebateProject', v)} ariaLabel='Rebate proyecto' />
                      </>
                    )}
                    <span className='text-right text-slate-500'>
                      Final <span className='font-semibold tabular-nums text-slate-700'>{formatCurrency(m.costo)}</span>
                    </span>
                  </div>
                </td>
                <td className='px-2 py-2'>
                  <NumeroInput
                    value={tieneGpPropio ? item.gpOverride * 100 : null}
                    decimales={1}
                    min={-999}
                    permitirVacio
                    placeholder={gpGlobal.toFixed(1)}
                    onCommit={(v) => onCambio(item.id, 'gpOverride', v === null ? '' : String(v))}
                    ariaLabel='GP %'
                  />
                  {!tieneGpPropio && <div className='mt-1 text-right text-xs text-slate-400'>global</div>}
                </td>
                <td className='px-2 py-2'>
                  <NumeroInput value={m.precio} onCommit={(v) => onCambio(item.id, 'precioUnitario', v)} ariaLabel='Precio unitario' />
                </td>
                <td className='px-2 py-2 text-right font-semibold tabular-nums text-slate-800'>{formatCurrency(m.precio * item.cant)}</td>
                <td className='px-2 py-2 text-right'>
                  <div className='flex flex-col items-end gap-1'>
                    <MargenChip gpPct={m.gpPct} origen={item.origen} />
                    <span className='text-xs tabular-nums text-slate-500'>{formatCurrency(m.margenTotal)}</span>
                  </div>
                </td>
                <td className='px-2 py-2'>
                  <textarea
                    value={item.tiempo || ''}
                    onChange={(e) => onCambio(item.id, 'tiempo', e.target.value)}
                    rows={2}
                    aria-label='Tiempo de entrega'
                    className={`${textoBase} resize-y text-xs`}
                  />
                </td>
                <td className='px-2 py-2 text-center'>
                  <button type='button' onClick={() => onQuitar(item.id)} aria-label={`Quitar ${item.sku || item.mpn}`} className='rounded px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600'>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

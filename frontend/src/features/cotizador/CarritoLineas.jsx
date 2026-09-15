import React, { useState } from 'react';
import NumeroInput from '../ui/NumeroInput';
import Icono from '../ui/Icono';
import MargenChip from './MargenChip';
import { formatCurrency } from './cotizadorHelpers';
import { partesEntrega } from './entregaStock';

// Carrito del cotizador con el mismo formato que el editor de cotizaciones:
// una fila por producto, costo ⇄ GP ⇄ precio enlazados y margen a la vista.
// Los clientes ven solo producto, cantidad, precio y entrega.
// En pantallas chicas cada línea es una tarjeta.

const PARTNERS = ['Partner Autorizado', 'Partner Silver', 'Partner Gold', 'Partner Multiregional'];

const textoBase =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

const FONDO_ALERTA = {
  bajo_piso: 'bg-rose-50/70 dark:bg-rose-500/5',
  por_crear: 'bg-amber-50/70 dark:bg-amber-500/5'
};
const TITULO_ALERTA = {
  bajo_piso: 'Margen bajo el mínimo aceptable',
  por_crear: 'SKU por crear'
};

const chip = 'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';

const BotonMover = ({ onClick, disabled, label, children }) => (
  <button type='button' onClick={onClick} disabled={disabled} aria-label={label} title={label} className='grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent'>
    {children}
  </button>
);

const BotonQuitar = ({ item, onQuitar }) => (
  <button
    type='button'
    onClick={() => onQuitar(item.id)}
    aria-label={`Quitar ${item.sku || item.mpn}`}
    title='Quitar'
    className='grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10'
  >
    <Icono nombre='close' />
  </button>
);

const Etiqueta = ({ children }) => (
  <span className='text-[11px] font-medium uppercase tracking-wide text-slate-400'>{children}</span>
);

const CeldaProducto = ({ item, isAdmin, onCambio }) => (
  <div className='min-w-0'>
    <div className='mb-1 flex flex-wrap items-center gap-1.5'>
      <span className={`rounded-md px-1.5 text-[11px] font-bold uppercase tracking-wide ${(item.origen || 'QNAP') === 'AXIS' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'}`}>
        {item.origen || item.marca}
      </span>
      <span className='font-mono text-xs text-slate-600 dark:text-slate-300'>{item.sku && item.sku !== 'To Create' ? item.sku : 'SKU por crear'}</span>
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
      <p className='text-sm text-slate-800 dark:text-slate-100'>{item.desc}</p>
    )}
  </div>
);

// Entrega como etiquetas; el texto completo (el que va al PDF) se edita con el lápiz.
const CeldaEntrega = ({ item, editable, onCambio }) => {
  const [editando, setEditando] = useState(false);
  const partes = partesEntrega(item.tiempo, item.cant);
  const vacia = !partes.inmediata && !partes.texto;

  if (editable && (editando || vacia)) {
    return (
      <textarea
        value={item.tiempo || ''}
        onChange={(e) => onCambio(item.id, 'tiempo', e.target.value)}
        onBlur={() => setEditando(false)}
        autoFocus={editando}
        rows={3}
        placeholder='Plazo de entrega'
        aria-label='Tiempo de entrega'
        className={`${textoBase} resize-y text-xs`}
      />
    );
  }

  return (
    <div className='flex flex-wrap items-start gap-1' title={item.tiempo}>
      {partes.inmediata ? (
        <>
          <span className={`${chip} bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30`}>
            <span className='h-1.5 w-1.5 rounded-full bg-current' aria-hidden='true' />
            {partes.inmediata} inmediata
          </span>
          {partes.eta && (
            <span className={`${chip} bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30`}>
              {partes.pendiente > 0 ? `${partes.pendiente} en ` : ''}{partes.eta}
            </span>
          )}
        </>
      ) : (
        <span className={`${chip} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300`}>{partes.texto}</span>
      )}
      {editable && (
        <button
          type='button'
          onClick={() => setEditando(true)}
          aria-label='Editar entrega'
          title='Editar el texto de entrega'
          className='grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        >
          <Icono nombre='lapiz' className='h-3.5 w-3.5' />
        </button>
      )}
    </div>
  );
};

// Costo de la línea: disty editable o costo real de stock; en AXIS el detalle
// de partner y rebate queda plegado para que la fila no crezca.
const CeldaCosto = ({ item, costoFinal, rebatePartner, partnerDefault, onCambio }) => {
  const esAxis = (item.origen || 'QNAP') === 'AXIS';
  const partner = item.partnerCategory || partnerDefault;
  const rebateProyecto = Number(item.rebateProject) || 0;
  // Nivel de descuento que dio Axis en la linea, sobre el precio de lista
  // disty: es el numero con el que se negocia, no el monto suelto.
  const listaDisty = Number(item.precio) || 0;
  const descuentoPct = (rebate) => (listaDisty > 0 ? (rebate / listaDisty) * 100 : null);
  const pctLinea = descuentoPct(rebatePartner(item, partner) + rebateProyecto);
  return (
    <div className='flex flex-col gap-1 text-xs'>
      {item.costoChile > 0 ? (
        <div className='rounded-md bg-emerald-50 px-2 py-1 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' title='OH Unit USD de la hoja Stock'>
          <div className='font-semibold'>Real stock {formatCurrency(item.costoChile)}</div>
          <button type='button' onClick={() => onCambio(item.id, 'costoChile', null)} className='underline decoration-dotted'>
            usar costo disty
          </button>
        </div>
      ) : (
        <NumeroInput value={item.precio} onCommit={(v) => onCambio(item.id, 'precio', v)} ariaLabel='Costo disty' />
      )}
      {esAxis && (
        <details className='group rounded-md border border-slate-200 dark:border-slate-700'>
          <summary className='flex cursor-pointer list-none items-center justify-between gap-1 px-2 py-1 text-slate-600 dark:text-slate-300'>
            <span className='min-w-0 truncate'>
              {partner.replace('Partner ', '')} −{formatCurrency(rebatePartner(item, partner))}
              {rebateProyecto > 0 && ` · proy. −${formatCurrency(rebateProyecto)}`}
            </span>
            {pctLinea !== null && (
              <span
                title={`Descuento Axis de la linea: rebate total sobre el precio de lista disty (${formatCurrency(listaDisty)})`}
                className='shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
              >
                −{pctLinea.toFixed(1)}%
              </span>
            )}
            <span className='text-slate-400 transition group-open:rotate-180'><Icono nombre='abajo' className='h-3.5 w-3.5' /></span>
          </summary>
          <div className='flex flex-col gap-1 border-t border-slate-200 p-2 dark:border-slate-700'>
            <select
              value={partner}
              onChange={(e) => onCambio(item.id, 'partnerCategory', e.target.value)}
              aria-label='Categoría de partner'
              className={`${textoBase} text-xs`}
            >
              {PARTNERS.map((p) => {
                const pct = descuentoPct(rebatePartner(item, p));
                return (
                  <option key={p} value={p}>
                    {p.replace('Partner ', '')} · {formatCurrency(rebatePartner(item, p))}
                    {pct !== null && ` · ${pct.toFixed(1)}%`}
                  </option>
                );
              })}
            </select>
            <Etiqueta>Rebate proyecto</Etiqueta>
            <NumeroInput value={item.rebateProject ?? 0} onCommit={(v) => onCambio(item.id, 'rebateProject', v)} ariaLabel='Rebate proyecto' />
          </div>
        </details>
      )}
      <span className='text-right text-slate-500'>
        Final <span className='font-semibold tabular-nums text-slate-700 dark:text-slate-200'>{formatCurrency(costoFinal)}</span>
      </span>
    </div>
  );
};

const CampoGp = ({ item, gpGlobal, onCambio }) => {
  const tieneGpPropio = item.gpOverride !== null && item.gpOverride !== undefined;
  return (
    <>
      <NumeroInput
        value={tieneGpPropio ? item.gpOverride * 100 : null}
        decimales={1}
        min={-999}
        permitirVacio
        placeholder={gpGlobal.toFixed(1)}
        onCommit={(v) => onCambio(item.id, 'gpOverride', v === null ? '' : String(v))}
        ariaLabel='GP %'
      />
      {!tieneGpPropio && <div className='mt-0.5 text-right text-[11px] text-slate-400'>global</div>}
    </>
  );
};

export default function CarritoLineas({
  items,
  isAdmin,
  precioItem,
  margenItem,
  gpBase,
  rebatePartner,
  partnerDefault,
  alertaLinea = () => null,
  onCambio,
  onQuitar,
  onMover
}) {
  if (items.length === 0) {
    return (
      <div className='flex flex-col items-center gap-1 px-4 py-12 text-center text-sm text-slate-500'>
        <span className='mb-2 grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500'>
          <Icono nombre='cart' className='h-5 w-5' />
        </span>
        <p className='font-medium text-slate-700 dark:text-slate-200'>El carrito está vacío</p>
        <p>Busca por SKU, MPN o modelo, o usa «Pegar lista».</p>
      </div>
    );
  }

  const alertaDe = (item) => {
    const alerta = alertaLinea(item);
    return { alerta, fondo: FONDO_ALERTA[alerta] || '', titulo: TITULO_ALERTA[alerta] };
  };

  if (!isAdmin) {
    return (
      <>
        <ul className='divide-y divide-slate-100 md:hidden dark:divide-slate-800'>
          {items.map((item) => {
            const pu = precioItem(item);
            return (
              <li key={item.id} className='space-y-2 p-3'>
                <div className='flex items-start gap-2'>
                  <div className='min-w-0 flex-1'>
                    <CeldaProducto item={item} isAdmin={false} onCambio={onCambio} />
                  </div>
                  <BotonQuitar item={item} onQuitar={onQuitar} />
                </div>
                <div className='grid grid-cols-3 items-end gap-2'>
                  <label className='flex flex-col gap-0.5'>
                    <Etiqueta>Cant.</Etiqueta>
                    <NumeroInput entero min={1} value={item.cant} onCommit={(v) => onCambio(item.id, 'cant', v)} ariaLabel='Cantidad' />
                  </label>
                  <div className='text-right'>
                    <Etiqueta>P. unit.</Etiqueta>
                    <div className='tabular-nums'>{formatCurrency(pu)}</div>
                  </div>
                  <div className='text-right'>
                    <Etiqueta>Total</Etiqueta>
                    <div className='font-semibold tabular-nums text-blue-700 dark:text-blue-300'>{formatCurrency(pu * item.cant)}</div>
                  </div>
                </div>
                <CeldaEntrega item={item} editable={false} onCambio={onCambio} />
              </li>
            );
          })}
        </ul>
        <div className='hidden overflow-x-auto md:block'>
          <table className='w-full min-w-[640px] text-sm'>
            <thead className='bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800'>
              <tr>
                <th className='px-3 py-2 text-left'>Producto</th>
                <th className='w-24 px-2 py-2 text-right'>Cant.</th>
                <th className='w-32 px-2 py-2 text-right'>P. unitario</th>
                <th className='w-32 px-2 py-2 text-right'>Total</th>
                <th className='w-56 px-2 py-2 text-left'>Entrega</th>
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
                    <td className='px-2 py-2'>
                      <CeldaEntrega item={item} editable={false} onCambio={onCambio} />
                    </td>
                    <td className='px-2 py-2 text-center'>
                      <BotonQuitar item={item} onQuitar={onQuitar} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <>
      <ul className='divide-y divide-slate-100 md:hidden dark:divide-slate-800'>
        {items.map((item, index) => {
          const m = margenItem(item);
          const { fondo, titulo } = alertaDe(item);
          return (
            <li key={item.id} className={`space-y-2 p-3 ${fondo}`} title={titulo}>
              <div className='flex items-start gap-2'>
                <div className='flex flex-col items-center text-xs'>
                  <BotonMover onClick={() => onMover(index, -1)} disabled={index === 0} label='Subir línea'><Icono nombre='arriba' className='h-3.5 w-3.5' /></BotonMover>
                  <span className='text-slate-400'>{index + 1}</span>
                  <BotonMover onClick={() => onMover(index, 1)} disabled={index === items.length - 1} label='Bajar línea'><Icono nombre='abajo' className='h-3.5 w-3.5' /></BotonMover>
                </div>
                <div className='min-w-0 flex-1'>
                  <CeldaProducto item={item} isAdmin onCambio={onCambio} />
                </div>
                <BotonQuitar item={item} onQuitar={onQuitar} />
              </div>
              <div className='grid grid-cols-3 gap-2'>
                <label className='flex flex-col gap-0.5'>
                  <Etiqueta>Cant.</Etiqueta>
                  <NumeroInput entero min={1} value={item.cant} onCommit={(v) => onCambio(item.id, 'cant', v)} ariaLabel='Cantidad' />
                </label>
                <label className='flex flex-col gap-0.5'>
                  <Etiqueta>GP %</Etiqueta>
                  <CampoGp item={item} gpGlobal={gpBase(item) * 100} onCambio={onCambio} />
                </label>
                <label className='flex flex-col gap-0.5'>
                  <Etiqueta>P. unit.</Etiqueta>
                  <NumeroInput value={m.precio} onCommit={(v) => onCambio(item.id, 'precioUnitario', v)} ariaLabel='Precio unitario' />
                </label>
              </div>
              <CeldaCosto item={item} costoFinal={m.costo} rebatePartner={rebatePartner} partnerDefault={partnerDefault} onCambio={onCambio} />
              <div className='flex items-center justify-between gap-2'>
                <span className='flex items-center gap-2'>
                  <MargenChip gpPct={m.gpPct} origen={item.origen} />
                  <span className='text-xs tabular-nums text-slate-500'>{formatCurrency(m.margenTotal)}</span>
                </span>
                <span className='font-semibold tabular-nums text-slate-800 dark:text-slate-100'>{formatCurrency(m.precio * item.cant)}</span>
              </div>
              <CeldaEntrega item={item} editable onCambio={onCambio} />
            </li>
          );
        })}
      </ul>

      <div className='hidden overflow-x-auto md:block'>
        <table className='w-full min-w-[920px] text-sm'>
          <thead className='bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800'>
            <tr>
              <th className='w-8 px-1 py-2' />
              <th className='px-2 py-2 text-left'>Producto</th>
              <th className='w-20 px-2 py-2 text-right'>Cant.</th>
              <th className='w-44 px-2 py-2 text-left'>Costo</th>
              <th className='w-24 px-2 py-2 text-right'>GP %</th>
              <th className='w-32 px-2 py-2 text-right'>P. unitario</th>
              <th className='w-32 px-2 py-2 text-right'>Total · margen</th>
              <th className='w-48 px-2 py-2 text-left'>Entrega</th>
              <th className='w-10 px-2 py-2' />
            </tr>
          </thead>
          <tbody className='divide-y divide-slate-100 dark:divide-slate-800'>
            {items.map((item, index) => {
              const m = margenItem(item);
              const { alerta, fondo, titulo } = alertaDe(item);
              return (
                <tr key={item.id} className={`align-top ${fondo}`} title={titulo}>
                  <td className={`px-1 py-2 ${alerta ? `border-l-2 ${alerta === 'bajo_piso' ? 'border-rose-400' : 'border-amber-400'}` : ''}`}>
                    <div className='flex flex-col items-center text-xs'>
                      <BotonMover onClick={() => onMover(index, -1)} disabled={index === 0} label='Subir línea'><Icono nombre='arriba' className='h-3.5 w-3.5' /></BotonMover>
                      <span className='text-slate-400'>{index + 1}</span>
                      <BotonMover onClick={() => onMover(index, 1)} disabled={index === items.length - 1} label='Bajar línea'><Icono nombre='abajo' className='h-3.5 w-3.5' /></BotonMover>
                    </div>
                  </td>
                  <td className='min-w-[220px] px-2 py-2'>
                    <CeldaProducto item={item} isAdmin onCambio={onCambio} />
                  </td>
                  <td className='px-2 py-2'>
                    <NumeroInput entero min={1} value={item.cant} onCommit={(v) => onCambio(item.id, 'cant', v)} ariaLabel='Cantidad' />
                  </td>
                  <td className='px-2 py-2'>
                    <CeldaCosto item={item} costoFinal={m.costo} rebatePartner={rebatePartner} partnerDefault={partnerDefault} onCambio={onCambio} />
                  </td>
                  <td className='px-2 py-2'>
                    <CampoGp item={item} gpGlobal={gpBase(item) * 100} onCambio={onCambio} />
                  </td>
                  <td className='px-2 py-2'>
                    <NumeroInput value={m.precio} onCommit={(v) => onCambio(item.id, 'precioUnitario', v)} ariaLabel='Precio unitario' />
                  </td>
                  <td className='px-2 py-2 pt-2.5 text-right'>
                    <div className='flex flex-col items-end gap-1'>
                      <span className='font-semibold tabular-nums text-slate-800 dark:text-slate-100'>{formatCurrency(m.precio * item.cant)}</span>
                      <MargenChip gpPct={m.gpPct} origen={item.origen} />
                      <span className='text-xs tabular-nums text-slate-500'>{formatCurrency(m.margenTotal)}</span>
                    </div>
                  </td>
                  <td className='px-2 py-2 pt-2.5'>
                    <CeldaEntrega item={item} editable onCambio={onCambio} />
                  </td>
                  <td className='px-2 py-2 text-center'>
                    <BotonQuitar item={item} onQuitar={onQuitar} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

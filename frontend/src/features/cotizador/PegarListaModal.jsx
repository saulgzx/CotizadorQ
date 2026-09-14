import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parsearLista, resolverLista } from './listaPegada';

// Pegar una lista de productos con cantidades y agregarla al carrito de una vez.
export default function PegarListaModal({ abierto, textoInicial = '', productos, onAgregar, onCerrar }) {
  const [texto, setTexto] = useState(textoInicial);
  const [elecciones, setElecciones] = useState({});
  const areaRef = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    setTexto(textoInicial);
    setElecciones({});
    requestAnimationFrame(() => areaRef.current?.focus());
  }, [abierto, textoInicial]);

  const resultado = useMemo(() => resolverLista(productos, parsearLista(texto)), [productos, texto]);

  if (!abierto) return null;

  const elegidas = resultado.ambiguas
    .map((a, i) => {
      const id = elecciones[i];
      const producto = a.candidatos.find((c) => String(c.id) === String(id));
      return producto ? { producto, cantidad: a.cantidad } : null;
    })
    .filter(Boolean);
  const total = resultado.resueltas.length + elegidas.length;

  const agregar = () => {
    onAgregar([...resultado.resueltas, ...elegidas], {
      sinResolver: resultado.ambiguas.length - elegidas.length,
      noEncontradas: resultado.noEncontradas
    });
  };

  return (
    <div className='fixed inset-0 z-[65] flex items-start justify-center bg-black/40 p-4 pt-[8vh]' onClick={onCerrar}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='pegar-lista-titulo'
        className='flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-scale-in dark:bg-slate-900'
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCerrar();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && total > 0) agregar();
        }}
      >
        <div className='border-b border-slate-200 px-5 py-4 dark:border-slate-700'>
          <h2 id='pegar-lista-titulo' className='text-lg font-semibold text-slate-900'>Pegar lista de productos</h2>
          <p className='text-sm text-slate-500'>Una línea por producto: SKU o MPN y la cantidad, en el orden que venga del correo o del Excel.</p>
        </div>
        <div className='grid min-h-0 flex-1 gap-4 overflow-auto p-5 md:grid-cols-2'>
          <textarea
            id='pegar-lista-texto'
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={10}
            placeholder={'TS-464-8G\t2\n2 x RAIL-B02\n03181-001; 4'}
            className='min-h-[200px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100'
          />
          <div className='space-y-3 text-sm'>
            {texto.trim() === '' && <p className='text-slate-500'>La vista previa aparece al pegar.</p>}
            {resultado.resueltas.length > 0 && (
              <div>
                <div className='mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700'>
                  Listas para agregar ({resultado.resueltas.length})
                </div>
                <ul className='space-y-1'>
                  {resultado.resueltas.map(({ producto, cantidad }) => (
                    <li key={producto.id} className='flex justify-between gap-2 rounded-md bg-emerald-50 px-2 py-1 dark:bg-emerald-500/10'>
                      <span className='truncate'>
                        <span className='font-mono text-xs text-slate-500'>{producto.sku || producto.mpn}</span> {producto.desc}
                      </span>
                      <span className='shrink-0 font-semibold tabular-nums'>×{cantidad}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {resultado.ambiguas.length > 0 && (
              <div>
                <div className='mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700'>
                  Elige el producto ({resultado.ambiguas.length})
                </div>
                <ul className='space-y-2'>
                  {resultado.ambiguas.map((a, i) => (
                    <li key={`${a.linea}-${i}`} className='rounded-md bg-amber-50 px-2 py-1.5 dark:bg-amber-500/10'>
                      <div className='mb-1 font-mono text-xs text-slate-600'>{a.linea}</div>
                      <select
                        id={`pegar-lista-eleccion-${i}`}
                        value={elecciones[i] || ''}
                        onChange={(e) => setElecciones((prev) => ({ ...prev, [i]: e.target.value }))}
                        className='w-full rounded border border-amber-200 bg-white px-2 py-1 text-sm dark:border-amber-500/30 dark:bg-slate-900'
                      >
                        <option value=''>No agregar</option>
                        {a.candidatos.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.sku} · {c.mpn}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {resultado.noEncontradas.length > 0 && (
              <div>
                <div className='mb-1 text-xs font-semibold uppercase tracking-wide text-rose-700'>
                  No están en el catálogo ({resultado.noEncontradas.length})
                </div>
                <ul className='space-y-1 font-mono text-xs text-rose-700'>
                  {resultado.noEncontradas.map((linea, i) => (
                    <li key={`${linea}-${i}`}>{linea}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <div className='flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-700'>
          <span className='text-xs text-slate-500'>Ctrl+Enter agrega · Esc cierra</span>
          <div className='flex gap-2'>
            <button type='button' onClick={onCerrar} className='rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100'>
              Cancelar
            </button>
            <button
              type='button'
              onClick={agregar}
              disabled={total === 0}
              className='rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900'
            >
              Agregar {total > 0 ? `${total} producto${total === 1 ? '' : 's'}` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

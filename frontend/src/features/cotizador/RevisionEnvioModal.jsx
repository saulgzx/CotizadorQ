import React, { useEffect, useRef } from 'react';

// Ultimo control antes de generar la cotizacion: lista lo que conviene mirar.
// No bloquea: se puede generar igual.
export default function RevisionEnvioModal({ abierto, problemas, onVolver, onGenerar }) {
  const generarRef = useRef(null);

  useEffect(() => {
    if (abierto) requestAnimationFrame(() => generarRef.current?.focus());
  }, [abierto]);

  if (!abierto) return null;
  const grupos = [
    { clave: 'bajoPiso', titulo: 'Margen bajo el piso', tono: 'text-rose-700 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300' },
    { clave: 'porCrear', titulo: 'SKU por crear (suma días al plazo)', tono: 'text-amber-800 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300' },
    { clave: 'sinStock', titulo: 'Sin stock en bodega (plazo de catálogo)', tono: 'text-slate-700 bg-slate-100 dark:bg-slate-800 dark:text-slate-300' }
  ].filter((g) => (problemas[g.clave] || []).length > 0);

  return (
    <div className='fixed inset-0 z-[65] flex items-start justify-center bg-black/40 p-4 pt-[10vh]' onClick={onVolver}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='revision-titulo'
        className='max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-2xl animate-scale-in dark:bg-slate-900'
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onVolver()}
      >
        <h2 id='revision-titulo' className='text-lg font-semibold text-slate-900'>Revisa antes de generar</h2>
        <p className='mb-4 text-sm text-slate-500'>Nada de esto impide generar la cotización; es lo que un cliente podría preguntar.</p>
        <div className='space-y-3'>
          {grupos.map((g) => (
            <div key={g.clave}>
              <div className='mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500'>{g.titulo}</div>
              <ul className='space-y-1'>
                {problemas[g.clave].map((p) => (
                  <li key={`${g.clave}-${p.id}`} className={`flex justify-between gap-3 rounded-md px-2 py-1 text-sm ${g.tono}`}>
                    <span className='truncate'>{p.nombre}</span>
                    {p.detalle && <span className='shrink-0 font-semibold tabular-nums'>{p.detalle}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' onClick={onVolver} className='rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100'>
            Volver y corregir
          </button>
          <button
            ref={generarRef}
            type='button'
            onClick={onGenerar}
            className='rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700'
          >
            Generar igual
          </button>
        </div>
      </div>
    </div>
  );
}

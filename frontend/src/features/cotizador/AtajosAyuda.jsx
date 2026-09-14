import React, { useEffect } from 'react';

const Tecla = ({ children }) => (
  <kbd className='inline-block min-w-[26px] rounded-md border border-b-2 border-slate-300 bg-white px-1.5 py-0.5 text-center font-mono text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'>
    {children}
  </kbd>
);

export const ATAJOS = [
  { grupo: 'En toda la app', teclas: [['Ctrl', 'K']], texto: 'Buscar vistas y productos' },
  { grupo: 'En toda la app', teclas: [['Alt', '1…5']], texto: 'Ir a Dashboard, Cotizador, Historial, Stock, Órdenes' },
  { grupo: 'En toda la app', teclas: [['?']], texto: 'Mostrar esta ayuda' },
  { grupo: 'Cotizador', teclas: [['/']], texto: 'Buscar producto para agregar' },
  { grupo: 'Cotizador', teclas: [['↑', '↓'], ['Enter']], texto: 'Elegir resultado y agregarlo; el buscador sigue abierto' },
  { grupo: 'Cotizador', teclas: [['Ctrl', 'V']], texto: 'Pegar en el buscador una lista de SKU con cantidades' },
  { grupo: 'Cotizador', teclas: [['Ctrl', 'Z']], texto: 'Deshacer la última línea quitada' },
  { grupo: 'Cotizador', teclas: [['Ctrl', 'Enter']], texto: 'Revisar y generar la cotización' },
  { grupo: 'Historial', teclas: [['E'], ['P'], ['D']], texto: 'Editar, descargar PDF o duplicar la cotización abierta' },
  { grupo: 'Editor de cotización', teclas: [['Ctrl', 'S']], texto: 'Guardar cambios' },
  { grupo: 'Editor de cotización', teclas: [['Esc']], texto: 'Cerrar el editor' }
];

export default function AtajosAyuda({ abierto, onCerrar, esAdmin }) {
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onCerrar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto, onCerrar]);

  if (!abierto) return null;
  const visibles = ATAJOS.filter((a) => esAdmin || a.grupo !== 'Editor de cotización');
  const grupos = [...new Set(visibles.map((a) => a.grupo))];

  return (
    <div className='fixed inset-0 z-[65] flex items-start justify-center bg-black/40 p-4 pt-[10vh]' onClick={onCerrar}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='atajos-titulo'
        className='max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-2xl animate-scale-in dark:bg-slate-900'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='mb-4 flex items-center justify-between'>
          <h2 id='atajos-titulo' className='text-lg font-semibold text-slate-900'>Atajos de teclado</h2>
          <button type='button' onClick={onCerrar} className='rounded px-2 py-1 text-slate-500 hover:bg-slate-100' aria-label='Cerrar ayuda'>
            ✕
          </button>
        </div>
        <div className='space-y-4'>
          {grupos.map((grupo) => (
            <div key={grupo}>
              <div className='mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500'>{grupo}</div>
              <ul className='divide-y divide-slate-100 dark:divide-slate-800'>
                {visibles
                  .filter((a) => a.grupo === grupo)
                  .map((a) => (
                    <li key={a.texto} className='flex items-center justify-between gap-4 py-2 text-sm text-slate-700'>
                      <span>{a.texto}</span>
                      <span className='flex shrink-0 items-center gap-1.5'>
                        {a.teclas.map((combo, i) => (
                          <span key={i} className='flex items-center gap-1'>
                            {i > 0 && <span className='text-slate-400'>·</span>}
                            {combo.map((t) => (
                              <Tecla key={t}>{t}</Tecla>
                            ))}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

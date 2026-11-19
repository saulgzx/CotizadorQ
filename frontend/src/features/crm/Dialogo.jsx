import React, { useEffect, useId, useRef } from 'react';

const FOCOS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const claseInput =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-500/40';

export function Campo({ etiqueta, children, ayuda }) {
  return (
    <label className='block text-sm'>
      <span className='mb-1 block font-medium text-slate-700 dark:text-slate-200'>{etiqueta}</span>
      {children}
      {ayuda && <span className='mt-1 block text-xs text-slate-500 dark:text-slate-400'>{ayuda}</span>}
    </label>
  );
}

// Diálogos abiertos, del más antiguo al más reciente: el teclado es del último.
const PILA = [];

/**
 * Diálogo modal accesible: role="dialog", foco atrapado, Esc cierra y el foco
 * vuelve al elemento que lo abrió.
 */
export default function Dialogo({ titulo, onCerrar, children, ancho = 'max-w-md', descripcion }) {
  const ref = useRef(null);
  const tituloId = useId();
  const descId = useId();

  useEffect(() => {
    const previo = document.activeElement;
    const nodo = ref.current;
    const inicial = nodo?.querySelector('[data-autofocus]') || nodo?.querySelector(FOCOS);
    inicial?.focus();
    return () => {
      if (previo && typeof previo.focus === 'function' && document.contains(previo)) previo.focus();
    };
  }, []);

  // Teclado a nivel de documento, no del nodo: si el elemento enfocado desaparece o se
  // deshabilita (p. ej. una sección que se oculta tras guardar), el foco cae en <body> y un
  // listener puesto en el diálogo ya no recibiría Escape. Con varios diálogos abiertos, solo
  // responde el de más arriba.
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;
  useEffect(() => {
    const yo = {};
    PILA.push(yo);
    const alTeclear = (e) => {
      if (PILA[PILA.length - 1] !== yo) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cerrarRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodo = ref.current;
      const lista = Array.from(nodo?.querySelectorAll(FOCOS) || []);
      if (lista.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const fuera = !nodo.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === primero || fuera)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (document.activeElement === ultimo || fuera)) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      const i = PILA.indexOf(yo);
      if (i !== -1) PILA.splice(i, 1);
    };
  }, []);

  return (
    <div
      className='fixed inset-0 z-[60] !m-0 flex items-start justify-center overflow-auto bg-slate-950/40 p-4 pt-[8vh] backdrop-blur-[2px] animate-fade-in'
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={ref}
        role='dialog'
        aria-modal='true'
        aria-labelledby={tituloId}
        aria-describedby={descripcion ? descId : undefined}
        className={`w-full ${ancho} rounded-2xl border border-slate-200 bg-white p-5 shadow-float animate-scale-in dark:border-slate-700 dark:bg-slate-900`}
      >
        <div className='mb-3 flex items-start justify-between gap-3'>
          <div>
            <h2 id={tituloId} className='text-lg font-semibold text-slate-900 dark:text-slate-100'>{titulo}</h2>
            {descripcion && <p id={descId} className='mt-0.5 text-sm text-slate-500 dark:text-slate-400'>{descripcion}</p>}
          </div>
          <button
            type='button'
            onClick={onCerrar}
            aria-label='Cerrar diálogo'
            className='grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

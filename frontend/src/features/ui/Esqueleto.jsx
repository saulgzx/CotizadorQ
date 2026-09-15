import React from 'react';
import Icono from './Icono';

// Marcadores de carga: muestran la forma de lo que viene en vez de un "Cargando…".

const barra = 'animate-pulse rounded bg-slate-200/80 dark:bg-slate-700/60';

export const BarraEsqueleto = ({ className = '' }) => <span className={`block h-3 ${barra} ${className}`} aria-hidden='true' />;

/** Filas de tabla con celdas grises. */
export function FilasEsqueleto({ filas = 5, columnas = 5 }) {
  return (
    <>
      {Array.from({ length: filas }, (_, f) => (
        <tr key={f} aria-hidden='true'>
          {Array.from({ length: columnas }, (_, c) => (
            <td key={c} className='px-3 py-3'>
              <BarraEsqueleto className={c === 0 ? 'w-3/4' : c === columnas - 1 ? 'ml-auto w-12' : 'w-1/2'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Bloque de líneas, para listas o tarjetas. */
export function ListaEsqueleto({ lineas = 4, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`} role='status' aria-label='Cargando'>
      {Array.from({ length: lineas }, (_, i) => (
        <div key={i} className='space-y-2 rounded-xl border border-slate-100 p-3 dark:border-slate-800'>
          <BarraEsqueleto className='w-1/3' />
          <BarraEsqueleto className='w-2/3' />
        </div>
      ))}
    </div>
  );
}

/** Tarjetas de KPI. */
export function TarjetasEsqueleto({ cantidad = 4, className = '' }) {
  return (
    <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 ${className}`} role='status' aria-label='Cargando'>
      {Array.from({ length: cantidad }, (_, i) => (
        <div key={i} className='space-y-3 rounded-xl border border-white/70 bg-white/70 p-3'>
          <BarraEsqueleto className='h-5 w-20 rounded-full' />
          <BarraEsqueleto className='h-6 w-12' />
          <BarraEsqueleto className='w-24' />
        </div>
      ))}
    </div>
  );
}

/** Estado vacío con ícono, explicación y acción opcional. */
export function EstadoVacio({ icono = 'bandeja', titulo, detalle, accion }) {
  return (
    <div className='flex flex-col items-center gap-1 px-4 py-10 text-center text-sm text-slate-500'>
      <span className='mb-2 grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500'>
        <Icono nombre={icono} className='h-5 w-5' />
      </span>
      <p className='font-medium text-slate-700 dark:text-slate-200'>{titulo}</p>
      {detalle && <p>{detalle}</p>}
      {accion && (
        <button
          type='button'
          onClick={accion.onClick}
          className='mq-btn mq-btn-primario mt-3'
        >
          {accion.label}
        </button>
      )}
    </div>
  );
}

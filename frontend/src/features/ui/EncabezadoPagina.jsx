import React from 'react';

/**
 * Encabezado único de página: sección (miga), título, subtítulo y acciones a la derecha.
 * Mismo tamaño y ritmo en todas las vistas.
 */
export default function EncabezadoPagina({ seccion, titulo, subtitulo, children }) {
  return (
    <div className='mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4'>
      <div className='min-w-0'>
        {seccion && <div className='mq-sobre mb-1.5'>{seccion}</div>}
        <h2 className='text-[28px] font-semibold leading-8 tracking-tight text-slate-900'>{titulo}</h2>
        {subtitulo && <p className='mt-1 text-sm text-slate-500'>{subtitulo}</p>}
      </div>
      {children && <div className='flex flex-wrap items-center gap-2'>{children}</div>}
    </div>
  );
}

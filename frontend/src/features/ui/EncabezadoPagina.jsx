import React from 'react';

/**
 * Encabezado único de página: sección (miga), título, subtítulo y acciones a la derecha.
 * Mismo tamaño y ritmo en todas las vistas.
 */
export default function EncabezadoPagina({ seccion, titulo, subtitulo, children }) {
  return (
    <div className='mq-encabezado mb-5 flex flex-wrap items-end justify-between gap-3 pb-4'>
      <div className='min-w-0'>
        {seccion && <div className='mq-sobre mb-1.5'>{seccion}</div>}
        <h2 className='mq-encabezado-titulo text-[28px] font-semibold leading-9 tracking-tight text-slate-900'><span>{titulo}</span></h2>
        {subtitulo && <p className='mq-encabezado-sub mt-0.5 text-sm text-slate-500'>{subtitulo}</p>}
      </div>
      {children && <div className='mq-encabezado-acciones flex flex-wrap items-center gap-2'>{children}</div>}
    </div>
  );
}

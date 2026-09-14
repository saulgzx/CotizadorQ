import React from 'react';
import { ESTILO_MARGEN, TEXTO_MARGEN, estadoMargen, formatoPct, useConfigMargen } from './margen';

/** GP con color de semaforo. `origen` puede ser una marca o una lista de marcas. */
export default function MargenChip({ gpPct, origen, className = '' }) {
  const [config] = useConfigMargen();
  const estado = estadoMargen(gpPct, origen, config);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${ESTILO_MARGEN[estado]} ${className}`}
      title={TEXTO_MARGEN[estado]}
    >
      <span className='h-1.5 w-1.5 rounded-full bg-current' aria-hidden='true' />
      {formatoPct(gpPct)}
    </span>
  );
}

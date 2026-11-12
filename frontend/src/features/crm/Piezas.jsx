import React, { useEffect, useRef, useState } from 'react';

// Piezas visuales compartidas del CRM: cifra animada, panel, barra y estado.

/** Cuenta desde 0 hasta el valor al montar (o al cambiar). Respeta "reducir movimiento". */
export function useConteo(valor, duracion = 900) {
  const destino = Number(valor) || 0;
  const [actual, setActual] = useState(destino);
  const desde = useRef(0);

  useEffect(() => {
    const quieto = typeof window === 'undefined' || !window.requestAnimationFrame
      || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (quieto || destino === desde.current) {
      desde.current = destino;
      setActual(destino);
      return undefined;
    }
    const inicio = desde.current;
    const t0 = performance.now();
    let id;
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / duracion);
      const suave = 1 - (1 - p) ** 4;
      setActual(inicio + (destino - inicio) * suave);
      if (p < 1) id = requestAnimationFrame(paso);
      else desde.current = destino;
    };
    id = requestAnimationFrame(paso);
    return () => { cancelAnimationFrame(id); desde.current = destino; };
  }, [destino, duracion]);

  return actual;
}

export function Cifra({ valor, formato = (n) => Math.round(n).toLocaleString('es-CL') }) {
  const n = useConteo(valor);
  return <>{formato(n)}</>;
}

/** Fila de indicadores en un solo panel dividido por líneas. */
export function Indicadores({ children }) {
  return <dl className='mq-kpis'>{children}</dl>;
}

export function Indicador({ etiqueta, children, detalle, tono }) {
  return (
    <div className='mq-kpi'>
      <dt className='mq-sobre'>{etiqueta}</dt>
      <dd className='mq-kpi-valor'>
        {tono && <span className={`mq-punto mq-punto-${tono}`} aria-hidden='true' />}
        {children}
      </dd>
      {detalle && <dd className='mq-kpi-detalle'>{detalle}</dd>}
    </div>
  );
}

export function Panel({ titulo, detalle, accion, children, className = '' }) {
  return (
    <section className={`mq-panel ${className}`}>
      <header className='mq-panel-cabecera'>
        <div className='min-w-0'>
          <h3 className='mq-panel-titulo'>{titulo}</h3>
          {detalle && <p className='mq-panel-detalle'>{detalle}</p>}
        </div>
        {accion}
      </header>
      {children}
    </section>
  );
}

/** Barra horizontal de magnitud (un solo tono). `razon` va de 0 a 1. */
export function Barra({ razon, serie, orden = 0 }) {
  return (
    <span className='mq-barra' aria-hidden='true'>
      <span
        className={`mq-barra-relleno ${serie ? `mq-serie-${serie}` : ''}`}
        style={{ width: `${Math.max(razon > 0 ? 2 : 0, Math.round(razon * 100))}%`, '--i': orden }}
      />
    </span>
  );
}

/** Estado con punto de color + texto (nunca solo color). */
export function Estado({ tono = 'neutro', children }) {
  return (
    <span className='mq-estado'>
      <span className={`mq-punto mq-punto-${tono}`} aria-hidden='true' />
      {children}
    </span>
  );
}

export function Vacio({ children }) {
  return <p className='px-4 py-8 text-center text-sm text-slate-500'>{children}</p>;
}

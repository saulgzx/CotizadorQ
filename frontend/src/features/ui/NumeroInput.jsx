import React, { useState } from 'react';

/**
 * Input numerico que no pelea con el cursor: mientras tiene foco guarda el texto
 * tal cual y comunica cada valor valido; al salir muestra el valor formateado.
 * Vacio llama onCommit(null) solo si permitirVacio.
 */
export default function NumeroInput({
  value,
  onCommit,
  decimales = 2,
  min = 0,
  entero = false,
  permitirVacio = false,
  placeholder,
  ariaLabel,
  className = '',
  id
}) {
  const [texto, setTexto] = useState('');
  const [foco, setFoco] = useState(false);
  const mostrar =
    value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
      ? ''
      : String(entero ? Math.trunc(Number(value)) : Number(value).toFixed(decimales));

  return (
    <input
      id={id}
      type='text'
      inputMode={entero ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={foco ? texto : mostrar}
      onFocus={(e) => {
        setTexto(mostrar);
        setFoco(true);
        const el = e.target;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => setFoco(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        setTexto(e.target.value);
        if (raw.trim() === '') {
          if (permitirVacio) onCommit(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= min) onCommit(entero ? Math.trunc(n) : n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={`${/(^|\s)w-/.test(className) ? '' : 'w-full '}rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 ${className}`}
    />
  );
}

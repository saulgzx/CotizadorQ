import React from 'react';

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Marca en el texto las palabras buscadas (2+ caracteres, sin distinguir mayúsculas). */
export default function Resaltado({ texto, busqueda }) {
  const valor = String(texto ?? '');
  const palabras = String(busqueda || '')
    .trim()
    .split(/\s+/)
    .filter((p) => p.length >= 2)
    .map(escapar);
  if (!valor || palabras.length === 0) return valor;
  const patron = new RegExp(`(${palabras.join('|')})`, 'gi');
  return valor.split(patron).map((parte, i) =>
    i % 2 === 1 ? (
      <mark key={i} className='rounded-sm bg-yellow-200/80 px-0.5 text-inherit dark:bg-yellow-500/30'>
        {parte}
      </mark>
    ) : (
      parte
    )
  );
}

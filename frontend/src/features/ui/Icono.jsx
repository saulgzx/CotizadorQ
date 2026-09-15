import React from 'react';

// Set único de íconos de línea (trazo 1.75, estilo Lucide). Reemplaza símbolos
// unicode y emojis para que se vean igual en Windows, Mac y Android.
export const ICONOS = {
  home: 'M3 10.5 12 3l9 7.5M5.25 9.75V21h4.5v-6h4.5v6h4.5V9.75',
  truck: 'M3 7.5h10.5V17H3zM13.5 10.5H18l3 3V17h-7.5M6 17a1.9 1.9 0 1 0 0 3.8A1.9 1.9 0 0 0 6 17zm10.5 0a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z',
  cart: 'M2.5 4h2l2.3 11.5h11l2.2-8.5H6M9.5 19.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  tag: 'M3 11.25V4.5A1.5 1.5 0 0 1 4.5 3h6.75L21 12.75 12.75 21zM7.5 7.5h.008',
  users: 'M15 19.5a4.5 4.5 0 0 0-9 0M16.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM18.4 12.6a4.5 4.5 0 0 1 3.1 4.4M16 4.7a3 3 0 0 1 0 5.6',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  box: 'M21 7.5 12 3 3 7.5m18 0L12 12m9-4.5V16.5L12 21m0-9L3 7.5m9 4.5v9m-9-13.5V16.5L12 21',
  clock: 'M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  user: 'M17.98 19.4a8.25 8.25 0 0 0-11.96 0M15.75 9.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0zM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  menu: 'M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5',
  search: 'M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
  close: 'M6 18 18 6M6 6l12 12',
  logout: 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18.75 15.75 21.75 12l-3-3.75M9 12h12.75',
  lapiz: 'M4 20h4L19 9l-4-4L4 16z',
  arriba: 'm6 15 6-6 6 6',
  abajo: 'm6 9 6 6 6-6',
  ajustes: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM10 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  subir: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  portapapeles: 'M8 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1M9 3h6v3H9zM9 11h6M9 15h6',
  carpeta: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  bandeja: 'M3 13h5l1.5 2.5h5L16 13h5M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z'
};

export default function Icono({ nombre, className = 'h-4 w-4', titulo }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
      aria-hidden={titulo ? undefined : 'true'}
      role={titulo ? 'img' : undefined}
    >
      {titulo && <title>{titulo}</title>}
      <path d={ICONOS[nombre] || ICONOS.menu} />
    </svg>
  );
}

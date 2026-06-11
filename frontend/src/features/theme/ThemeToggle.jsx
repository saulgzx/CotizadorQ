import React from 'react';

/**
 * Botón de alternancia de tema claro/oscuro.
 * Controlado por el padre: recibe { theme, onToggle } (no usa el hook internamente).
 *
 * @param {{ theme: 'light' | 'dark', onToggle: () => void }} props
 */
export default function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Cambiar tema"
      title={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      className="relative px-2.5 py-2 rounded-xl text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/10 transition-colors duration-200"
    >
      <span className="relative block w-[18px] h-[18px]">
        {/* Sol: visible en tema claro */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`absolute inset-0 w-[18px] h-[18px] transition-all duration-300 ${
            isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'
          }`}
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        {/* Luna: visible en tema oscuro */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`absolute inset-0 w-[18px] h-[18px] transition-all duration-300 ${
            isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
          }`}
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
    </button>
  );
}

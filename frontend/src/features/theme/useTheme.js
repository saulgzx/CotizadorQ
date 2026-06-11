import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const STORAGE_KEY = 'theme';

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (_) {
    // localStorage no disponible (modo privado, etc.)
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyThemeClass(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Hook de tema claro/oscuro.
 * - Lee localStorage 'theme' ('light' | 'dark'); si no existe usa prefers-color-scheme.
 * - Aplica/remueve la clase 'dark' en <html> antes de pintar (useLayoutEffect).
 * - Persiste en localStorage solo cuando el usuario alterna manualmente.
 * - Sigue los cambios del sistema únicamente si no hay preferencia manual guardada.
 *
 * @returns {{ theme: 'light' | 'dark', toggleTheme: () => void }}
 */
export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  // Sincroniza la clase 'dark' en <html> antes del pintado para evitar flash.
  useLayoutEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  // Sigue prefers-color-scheme SOLO mientras el usuario no haya fijado preferencia manual.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => {
      let stored = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch (_) {
        /* noop */
      }
      if (stored === 'light' || stored === 'dark') return; // preferencia manual: ignorar sistema
      setTheme(event.matches ? 'dark' : 'light');
    };
    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    // Safari < 14
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (_) {
        /* noop */
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}

export default useTheme;

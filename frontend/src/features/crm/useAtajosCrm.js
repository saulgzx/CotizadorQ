import { useEffect, useRef } from 'react';

/**
 * Atajos del CRM: "/" enfoca la búsqueda y "N" crea. No se activan mientras se
 * escribe en un campo, con modificadores, ni con un diálogo abierto.
 */
export default function useAtajosCrm({ onBuscar, onCrear }) {
  const ref = useRef({ onBuscar, onCrear });
  ref.current = { onBuscar, onCrear };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      const escribiendo =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (escribiendo || document.querySelector('[role="dialog"]')) return;
      if (e.key === '/' && ref.current.onBuscar) {
        e.preventDefault();
        ref.current.onBuscar();
      } else if (String(e.key).toLowerCase() === 'n' && ref.current.onCrear) {
        e.preventDefault();
        ref.current.onCrear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

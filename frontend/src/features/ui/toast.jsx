import React, { useEffect, useState } from 'react';

// Avisos no bloqueantes. Reemplazan a window.alert: no detienen la pantalla,
// se van solos y pueden traer una accion (p. ej. "Deshacer").
//
// notify('Cotización guardada')                       -> tipo inferido
// notify('No se pudo guardar', { tipo: 'error' })
// notify('Línea quitada', { accion: { label: 'Deshacer', onClick } })

const listeners = new Set();
let secuencia = 0;

const PATRON_ERROR = /error|no se pudo|fall[oó]|inv[aá]lid|no tienes|no hay|debe|requerid|sin permiso|expir|no encontr|ingres[ea]|no coinciden|son requeridos/i;
const PATRON_OK = /guardad|copiad|actualizad|eliminad|exportad|correct|listo|agregad|creado|enviad|restaurad|duplicad|sincroniz/i;

export const inferirTipo = (mensaje) => {
  const texto = String(mensaje ?? '');
  if (PATRON_ERROR.test(texto)) return 'error';
  if (PATRON_OK.test(texto)) return 'ok';
  return 'info';
};

export const notify = (mensaje, opciones = {}) => {
  const tipo = opciones.tipo || inferirTipo(mensaje);
  const toast = {
    id: ++secuencia,
    mensaje: String(mensaje ?? ''),
    tipo,
    accion: opciones.accion || null,
    duracion: opciones.duracion ?? (tipo === 'error' ? 8000 : opciones.accion ? 7000 : 4000)
  };
  listeners.forEach((listener) => listener({ tipo: 'agregar', toast }));
  return toast.id;
};

export const cerrarAviso = (id) => listeners.forEach((listener) => listener({ tipo: 'quitar', id }));

const ESTILOS = {
  ok: 'border-emerald-200 bg-white text-slate-800 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-slate-100',
  error: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-950 dark:text-rose-100',
  info: 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
};
const PUNTO = { ok: 'bg-emerald-500', error: 'bg-rose-500', info: 'bg-blue-500' };

export function Toaster() {
  const [avisos, setAvisos] = useState([]);

  useEffect(() => {
    const timers = new Map();
    const quitar = (id) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      setAvisos((prev) => prev.filter((a) => a.id !== id));
    };
    const listener = (evento) => {
      if (evento.tipo === 'quitar') return quitar(evento.id);
      const { toast } = evento;
      // Mismo mensaje repetido: se reemplaza en vez de apilarse.
      setAvisos((prev) => [...prev.filter((a) => a.mensaje !== toast.mensaje), toast].slice(-4));
      timers.set(toast.id, setTimeout(() => quitar(toast.id), toast.duracion));
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div
      // Sobre la barra movil y sobre el boton "¿Necesitas ayuda?" del cliente.
      className='pointer-events-none fixed inset-x-3 bottom-40 z-[70] flex flex-col items-end gap-2 lg:inset-x-auto lg:bottom-20 lg:right-5'
      role='status'
      aria-live='polite'
    >
      {avisos.map((aviso) => (
        <div
          key={aviso.id}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg animate-fade-in-up ${ESTILOS[aviso.tipo]}`}
        >
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PUNTO[aviso.tipo]}`} aria-hidden='true' />
          <p className='min-w-0 flex-1 whitespace-pre-line break-words'>{aviso.mensaje}</p>
          {aviso.accion && (
            <button
              type='button'
              onClick={() => {
                aviso.accion.onClick();
                cerrarAviso(aviso.id);
              }}
              className='shrink-0 rounded-md px-2 py-0.5 font-semibold text-slate-900 underline-offset-2 hover:underline'
            >
              {aviso.accion.label}
            </button>
          )}
          <button
            type='button'
            onClick={() => cerrarAviso(aviso.id)}
            className='grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            aria-label='Cerrar aviso'
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

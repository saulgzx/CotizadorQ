import React, { useEffect, useState } from 'react';
import { MARGEN_DEFAULTS, useConfigMargen } from './margen';
import { notify } from '../ui/toast';

const MARCAS = ['QNAP', 'AXIS'];

const aTexto = (config) =>
  Object.fromEntries(MARCAS.map((m) => [m, { objetivo: String(config[m].objetivo), piso: String(config[m].piso) }]));

// Devuelve el mensaje de error, o null si el borrador se puede guardar.
export const validarBorrador = (borrador) => {
  for (const marca of MARCAS) {
    const objetivo = Number(String(borrador[marca].objetivo).replace(',', '.'));
    const piso = Number(String(borrador[marca].piso).replace(',', '.'));
    if (String(borrador[marca].objetivo).trim() === '' || !Number.isFinite(objetivo) || objetivo <= 0 || objetivo >= 100) {
      return `${marca}: el objetivo debe estar entre 0 y 100 %.`;
    }
    if (String(borrador[marca].piso).trim() === '' || !Number.isFinite(piso) || piso < 0 || piso >= 100) {
      return `${marca}: el mínimo aceptable debe estar entre 0 y 100 %.`;
    }
    if (piso > objetivo) {
      return `${marca}: el mínimo aceptable (${piso} %) no puede ser mayor que el objetivo (${objetivo} %).`;
    }
  }
  return null;
};

/**
 * Ajuste del semaforo de margen. Se edita como borrador y solo se aplica al
 * guardar, para poder subir o bajar los umbrales sin que el carrito cambie
 * de color con cada tecla.
 */
export default function SemaforoMargenAjustes() {
  const [config, setConfig] = useConfigMargen();
  const [borrador, setBorrador] = useState(() => aTexto(config));

  // Si se guarda desde otra pestaña o se restablece, el borrador se alinea.
  useEffect(() => {
    setBorrador(aTexto(config));
  }, [config]);

  const guardado = aTexto(config);
  const sucio = MARCAS.some(
    (m) => borrador[m].objetivo !== guardado[m].objetivo || borrador[m].piso !== guardado[m].piso
  );
  const error = sucio ? validarBorrador(borrador) : null;

  const cambiar = (marca, campo, valor) =>
    setBorrador((prev) => ({ ...prev, [marca]: { ...prev[marca], [campo]: valor } }));

  const guardar = () => {
    if (error) {
      notify(error, { tipo: 'error' });
      return;
    }
    const numerico = Object.fromEntries(
      MARCAS.map((m) => [
        m,
        {
          objetivo: Number(String(borrador[m].objetivo).replace(',', '.')),
          piso: Number(String(borrador[m].piso).replace(',', '.'))
        }
      ])
    );
    setConfig(numerico);
    notify(
      `Semáforo de margen guardado. QNAP: mínimo ${numerico.QNAP.piso} %, objetivo ${numerico.QNAP.objetivo} %. ` +
        `AXIS: mínimo ${numerico.AXIS.piso} %, objetivo ${numerico.AXIS.objetivo} %.`,
      { tipo: 'ok' }
    );
  };

  const esDefault = MARCAS.every(
    (m) => config[m].objetivo === MARGEN_DEFAULTS[m].objetivo && config[m].piso === MARGEN_DEFAULTS[m].piso
  );

  return (
    <form
      className='flex w-full flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500'
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      <div className='basis-full'>
        <span className='font-semibold text-slate-700'>Semáforo de margen</span>
        <span className='ml-2 text-slate-500'>
          Bajo el mínimo aceptable la línea sale en rojo y pide revisión; entre mínimo y objetivo, en amarillo.
        </span>
      </div>
      {MARCAS.map((marca) => (
        <fieldset key={marca} className='flex items-end gap-2'>
          <legend className='sr-only'>{marca}</legend>
          <span className='pb-1 font-semibold text-slate-700'>{marca}</span>
          <label className='flex flex-col gap-0.5' htmlFor={`margen-piso-${marca}`}>
            Mínimo aceptable %
            <input
              id={`margen-piso-${marca}`}
              type='number'
              step='0.5'
              min='0'
              max='99'
              value={borrador[marca].piso}
              onChange={(e) => cambiar(marca, 'piso', e.target.value)}
              className='h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-right text-sm tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
            />
          </label>
          <label className='flex flex-col gap-0.5' htmlFor={`margen-objetivo-${marca}`}>
            Objetivo %
            <input
              id={`margen-objetivo-${marca}`}
              type='number'
              step='0.5'
              min='0'
              max='99'
              value={borrador[marca].objetivo}
              onChange={(e) => cambiar(marca, 'objetivo', e.target.value)}
              className='h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-right text-sm tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
            />
          </label>
        </fieldset>
      ))}
      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='submit'
          disabled={!sucio || Boolean(error)}
          className='mq-btn mq-btn-sm mq-btn-primario'
        >
          Guardar cambios
        </button>
        {sucio && (
          <button
            type='button'
            onClick={() => setBorrador(aTexto(config))}
            className='mq-btn mq-btn-sm mq-btn-fantasma'
          >
            Descartar
          </button>
        )}
        {!sucio && !esDefault && (
          <button
            type='button'
            onClick={() => setBorrador(aTexto(MARGEN_DEFAULTS))}
            className='mq-btn mq-btn-sm mq-btn-fantasma'
            title='Carga 15 % QNAP / 13 % AXIS con mínimo 10 %; luego guarda'
          >
            Valores por defecto
          </button>
        )}
      </div>
      {error && <p className='basis-full text-sm font-medium text-rose-700 dark:text-rose-300'>{error}</p>}
      {sucio && !error && <p className='basis-full text-sm text-amber-700 dark:text-amber-300'>Cambios sin guardar.</p>}
    </form>
  );
}

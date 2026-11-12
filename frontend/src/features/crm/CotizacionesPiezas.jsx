import React, { useEffect, useState } from 'react';
import Dialogo, { Campo, claseInput } from './Dialogo';
import { cotizacionesAPI } from '../../api';
import { ETAPAS, mensajeError, nombreEtapa } from './formato';
import { etapaDeCotizacion, textoConteoArchivo, tonoEtapa } from './etapasCotizacion';
import './cotizaciones.css';

// Piezas de la pestaña Cotizaciones del CRM (y de "Mis cotizaciones").

/** Etapa de una cotización: punto de color + texto. */
export function EtapaCotizacion({ cot, etapa }) {
  const clave = etapa || etapaDeCotizacion(cot);
  return (
    <span className='mq-estado'>
      <span className={`mq-punto mq-punto-${tonoEtapa(clave)}`} aria-hidden='true' />
      {nombreEtapa(clave)}
    </span>
  );
}

/** Chips de filtro por etapa, con conteo. `seleccion` es un arreglo de claves. */
export function FiltroEtapas({ seleccion = [], conteos = {}, onAlternar }) {
  return (
    <div className='mq-cot-grupo' role='group' aria-label='Filtrar por etapa'>
      {ETAPAS.map((e) => (
        <button
          key={e.clave}
          type='button'
          className='mq-filtro'
          aria-pressed={seleccion.includes(e.clave)}
          onClick={() => onAlternar(e.clave)}
        >
          <i className={`mq-punto mq-punto-${tonoEtapa(e.clave)}`} aria-hidden='true' />
          {e.nombre}
          <span>{conteos[e.clave] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** Cambio de etapa: una opción por etapa; la vigente queda marcada. */
export function SelectorEtapa({ etapa, onElegir, deshabilitado = false, etiqueta = 'Etapa' }) {
  return (
    <div className='mq-cot-grupo' role='group' aria-label={etiqueta}>
      {ETAPAS.map((e) => (
        <button
          key={e.clave}
          type='button'
          className='mq-filtro'
          aria-pressed={etapa === e.clave}
          disabled={deshabilitado}
          onClick={(ev) => {
            ev.stopPropagation();
            if (etapa !== e.clave) onElegir(e.clave);
          }}
        >
          <i className={`mq-punto mq-punto-${tonoEtapa(e.clave)}`} aria-hidden='true' />
          {e.nombre}
        </button>
      ))}
    </div>
  );
}

/** Conmutador Activas / Archivadas. */
export function ConmutadorArchivo({ vista, onCambiar }) {
  return (
    <div className='mq-cot-grupo' role='group' aria-label='Cotizaciones activas o archivadas'>
      <button type='button' className='mq-filtro' aria-pressed={vista === 'activas'} onClick={() => onCambiar('activas')}>
        Activas
      </button>
      <button type='button' className='mq-filtro' aria-pressed={vista === 'archivadas'} onClick={() => onCambiar('archivadas')}>
        Archivadas
      </button>
    </div>
  );
}

/** Etiqueta vN; con `onVer` es un botón que abre el historial de versiones. */
export function EtiquetaVersion({ version, numero, onVer }) {
  const n = Number(version) || 1;
  if (!onVer) return <span className='mq-cot-version'>v{n}</span>;
  return (
    <button
      type='button'
      className='mq-cot-version'
      title='Ver versiones'
      aria-label={`Ver versiones de la cotización ${numero} (vigente v${n})`}
      onClick={(e) => {
        e.stopPropagation();
        onVer();
      }}
    >
      v{n}
    </button>
  );
}

const hoyISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Archivar todo lo anterior a una fecha. Muestra la vista previa del servidor
 * antes de confirmar. `onArchivado(resultado)` recibe { cotizaciones, oportunidades }.
 */
export function ArchivarAnterioresDialogo({ onCerrar, onArchivado }) {
  const [fecha, setFecha] = useState('');
  const [previa, setPrevia] = useState(null);
  const [consultando, setConsultando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPrevia(null);
    setError('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return undefined;
    let vivo = true;
    setConsultando(true);
    const id = setTimeout(() => {
      cotizacionesAPI
        .previaArchivar(fecha)
        .then((data) => vivo && setPrevia(data || { cotizaciones: 0, oportunidades: 0 }))
        .catch((e) => vivo && setError(mensajeError(e, 'No se pudo consultar la vista previa')))
        .finally(() => vivo && setConsultando(false));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [fecha]);

  const total = (Number(previa?.cotizaciones) || 0) + (Number(previa?.oportunidades) || 0);

  const confirmar = async (e) => {
    e.preventDefault();
    if (!previa || total === 0) return;
    try {
      setEnviando(true);
      setError('');
      const resultado = await cotizacionesAPI.archivar({ antesDe: fecha });
      onArchivado?.(resultado);
      onCerrar();
    } catch (err) {
      setError(mensajeError(err, 'No se pudo archivar'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      titulo='Archivar anteriores a una fecha'
      descripcion='Archivar no borra: lo archivado sale del embudo, del resumen, del dashboard y del seguimiento automático, y se puede restaurar.'
      onCerrar={onCerrar}
    >
      <form onSubmit={confirmar} className='space-y-3'>
        <Campo etiqueta='Archivar lo creado antes del' ayuda='Se archivan las cotizaciones y sus oportunidades del CRM.'>
          <input
            data-autofocus
            type='date'
            className={claseInput}
            value={fecha}
            max={hoyISO()}
            onChange={(e) => setFecha(e.target.value)}
          />
        </Campo>
        <div aria-live='polite' className='min-h-[1.25rem] text-sm text-slate-700 dark:text-slate-200'>
          {consultando && 'Calculando…'}
          {!consultando && previa && (total > 0
            ? `Se archivarán ${textoConteoArchivo(previa)}.`
            : 'No hay nada activo anterior a esa fecha.')}
        </div>
        {error && <p role='alert' className='text-sm text-rose-700 dark:text-rose-300'>{error}</p>}
        <div className='mt-4 flex justify-end gap-2'>
          <button type='button' onClick={onCerrar} className='mq-btn mq-btn-secundario'>Cancelar</button>
          <button type='submit' disabled={!previa || total === 0 || consultando || enviando} className='mq-btn mq-btn-primario'>
            {enviando ? 'Archivando…' : 'Archivar'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { useCambiarEtapa } from './hooks';
import { PerdidaDialogo } from './DialogosCrm';
import { claseInput } from './Dialogo';
import { ETAPAS, MARCAS, diasTexto, nombreEtapa, usd } from './formato';
import { BarraEsqueleto, EstadoVacio, ListaEsqueleto } from '../ui/Esqueleto';
import { notify } from '../ui/toast';
import { mensajeError } from './formato';
import './embudo.css';

const ALTO_MINIMO = 420;

// Tono del punto de cada etapa con las clases del sistema (mq-punto-*).
const TONO_ETAPA = { nueva: 'neutro', cotizada: 'info', negociacion: 'aviso', ganada: 'ok', perdida: 'critico' };

/**
 * Alto disponible para el tablero: desde su borde superior hasta el fondo de la ventana,
 * descontando el relleno inferior del <main>. Se recalcula al cambiar el tamaño de la
 * ventana o el alto de lo que hay encima (ResizeObserver sobre <body>).
 */
function useAltoDisponible(nodo) {
  const [alto, setAlto] = useState(null);
  useLayoutEffect(() => {
    if (!nodo || typeof window === 'undefined') return undefined;
    let cuadro = 0;
    const calcular = () => {
      const top = nodo.getBoundingClientRect().top + window.scrollY;
      const main = nodo.closest('main');
      const relleno = main ? parseFloat(window.getComputedStyle(main).paddingBottom) || 0 : 0;
      const nuevo = Math.max(ALTO_MINIMO, Math.floor(window.innerHeight - top - relleno));
      setAlto((previo) => (previo === nuevo ? previo : nuevo));
    };
    const medir = () => {
      if (typeof window.requestAnimationFrame !== 'function') return calcular();
      window.cancelAnimationFrame(cuadro);
      cuadro = window.requestAnimationFrame(calcular);
      return undefined;
    };
    calcular();
    window.addEventListener('resize', medir);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    observador?.observe(document.body);
    return () => {
      window.removeEventListener('resize', medir);
      observador?.disconnect();
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(cuadro);
    };
  }, [nodo]);
  return alto;
}

function Cifra({ etiqueta, cantidad, monto, tono }) {
  return (
    <div className='embudo-cifra'>
      <span className={`mq-punto mq-punto-${tono}`} aria-hidden='true' />
      <span className='mq-sobre'>{etiqueta}</span>
      <span className='embudo-cifra-monto'>{usd(monto)}</span>
      <span className='embudo-cifra-cantidad' title={`${cantidad} ${cantidad === 1 ? 'oportunidad' : 'oportunidades'}`}>
        {cantidad} {cantidad === 1 ? 'op.' : 'ops.'}
      </span>
    </div>
  );
}

export function TarjetaOportunidad({ op, onMover, onAbrirEmpresa, onAbrirCotizacion, arrastrable = true }) {
  const motivo = op.etapa === 'perdida' && op.motivo_perdida ? `Motivo: ${op.motivo_perdida}` : null;
  const tieneCotizacion = op.cotizacion_numero != null && op.cotizacion_id != null;
  return (
    <article
      draggable={arrastrable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(op.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className='embudo-tarjeta'
      aria-label={`Oportunidad ${op.titulo}`}
      title={motivo || undefined}
    >
      <div className='embudo-linea'>
        <button
          type='button'
          onClick={() => onAbrirEmpresa?.(op.empresa_id)}
          className='embudo-empresa'
          title={op.empresa_nombre}
        >
          {op.empresa_nombre}
        </button>
        <span className='embudo-monto'>{usd(op.monto)}</span>
      </div>
      <div className='embudo-linea embudo-linea-2'>
        <span className='embudo-titulo' title={op.titulo}>{op.titulo}</span>
        <span className='embudo-meta'>
          <span className='embudo-dias' title={`${diasTexto(op.dias_en_etapa)} en la etapa`}>{diasTexto(op.dias_en_etapa)}</span>
          {op.marca && <span className='embudo-marca'>{op.marca}</span>}
          {op.es_proyecto && <span className='embudo-marca embudo-bid' title='Proyecto / BID'>BID</span>}
          {tieneCotizacion && (onAbrirCotizacion ? (
            <button
              type='button'
              className='embudo-cot'
              onClick={() => onAbrirCotizacion(op.cotizacion_id)}
              aria-label={`Abrir cotización ${op.cotizacion_numero}`}
            >
              #{op.cotizacion_numero}
            </button>
          ) : (
            <span className='embudo-cot'>#{op.cotizacion_numero}</span>
          ))}
        </span>
      </div>
      {motivo && <p className='embudo-motivo'>{motivo}</p>}
      <span className='embudo-mover' title='Mover a otra etapa'>
        <svg viewBox='0 0 16 16' width='12' height='12' aria-hidden='true' focusable='false'>
          <path d='M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
        <select
          aria-label={`Mover ${op.titulo} a otra etapa`}
          value={op.etapa}
          onChange={(e) => onMover(op, e.target.value)}
        >
          {ETAPAS.map((et) => <option key={et.clave} value={et.clave}>{et.nombre}</option>)}
        </select>
      </span>
    </article>
  );
}

/** Cambio de etapa con diálogo de motivo para "perdida". Devuelve [mover, dialogo]. */
export function useMoverOportunidad() {
  const cambiar = useCambiarEtapa();
  const [perdida, setPerdida] = useState(null);

  const mover = (op, etapa) => {
    if (etapa === op.etapa) return;
    if (etapa === 'perdida') setPerdida(op);
    else cambiar.mutate({ id: op.id, etapa });
  };
  const dialogo = perdida ? (
    <PerdidaDialogo
      oportunidad={perdida}
      onCerrar={() => setPerdida(null)}
      onConfirmar={(motivo) => cambiar.mutate({ id: perdida.id, etapa: 'perdida', motivo_perdida: motivo })}
    />
  ) : null;
  return [mover, dialogo];
}

export default function EmbudoTab({ inputBusquedaRef, onAbrirEmpresa, onAbrirCotizacion }) {
  const [texto, setTexto] = useState('');
  const [marca, setMarca] = useState('');
  const [mover, dialogo] = useMoverOportunidad();
  const [sobre, setSobre] = useState(null);
  const [tablero, setTablero] = useState(null);
  const alto = useAltoDisponible(tablero);

  const embudo = useQuery({ queryKey: queryKeys.crm.embudo, queryFn: crmApi.embudo });
  const lista = useQuery({ queryKey: queryKeys.crm.oportunidades, queryFn: () => crmApi.listarOportunidades() });

  const items = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (lista.data?.items || []).filter((op) => {
      if (marca && op.marca !== marca) return false;
      if (!t) return true;
      return `${op.titulo} ${op.empresa_nombre} ${op.contacto_nombre || ''}`.toLowerCase().includes(t);
    });
  }, [lista.data, texto, marca]);

  const porEtapa = (clave) => {
    const col = items.filter((op) => op.etapa === clave);
    if (clave === 'ganada' || clave === 'perdida') {
      col.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }
    return col;
  };

  const onDrop = (e, etapa) => {
    e.preventDefault();
    setSobre(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const op = (lista.data?.items || []).find((o) => o.id === id);
    if (op) mover(op, etapa);
  };

  useEffect(() => {
    if (lista.isError) notify(mensajeError(lista.error, 'No se pudo cargar el embudo'), { tipo: 'error' });
  }, [lista.isError, lista.error]);

  const e = embudo.data;
  const hayDatos = (lista.data?.items || []).length > 0;

  return (
    <div className='embudo'>
      {embudo.isLoading ? (
        <div className='embudo-franja' aria-hidden='true'>
          <BarraEsqueleto className='w-full max-w-xl' />
        </div>
      ) : (
        <div className='embudo-franja' role='group' aria-label='Totales del embudo'>
          <Cifra etiqueta='Abiertas' cantidad={e?.abiertas?.cantidad ?? 0} monto={e?.abiertas?.monto} tono='info' />
          <Cifra etiqueta='Ganadas del mes' cantidad={e?.ganadas_mes?.cantidad ?? 0} monto={e?.ganadas_mes?.monto} tono='ok' />
          <Cifra etiqueta='Perdidas del mes' cantidad={e?.perdidas_mes?.cantidad ?? 0} monto={e?.perdidas_mes?.monto} tono='critico' />
        </div>
      )}

      <div className='embudo-filtros'>
        <input
          ref={inputBusquedaRef}
          type='search'
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
          aria-label='Buscar oportunidades'
          placeholder='Buscar por empresa, título o contacto  ( / )'
          className={`${claseInput} max-w-sm flex-1`}
        />
        <select aria-label='Filtrar por marca' value={marca} onChange={(ev) => setMarca(ev.target.value)} className={`${claseInput} !w-auto`}>
          <option value=''>Todas las marcas</option>
          {MARCAS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {lista.isLoading ? (
        <ListaEsqueleto lineas={3} />
      ) : !hayDatos ? (
        <div className='embudo-vacio'>
          <EstadoVacio
            icono='carpeta'
            titulo='Aún no hay oportunidades'
            detalle='Se crean solas al generar una cotización. También puedes crear una con el botón «Nueva oportunidad».'
          />
        </div>
      ) : (
        <div
          ref={setTablero}
          className='embudo-tablero'
          style={alto ? { '--embudo-alto': `${alto}px` } : undefined}
        >
          {ETAPAS.map((et) => {
            const col = porEtapa(et.clave);
            const total = col.reduce((s, op) => s + (Number(op.monto) || 0), 0);
            return (
              <section
                key={et.clave}
                aria-label={`Etapa ${et.nombre}`}
                onDragOver={(ev) => { ev.preventDefault(); setSobre(et.clave); }}
                onDragLeave={() => setSobre((s) => (s === et.clave ? null : s))}
                onDrop={(ev) => onDrop(ev, et.clave)}
                className={`embudo-columna ${sobre === et.clave ? 'embudo-columna-sobre' : ''}`}
              >
                <header className='embudo-cabecera'>
                  <h3 className='embudo-etapa'>
                    <span className={`mq-punto mq-punto-${TONO_ETAPA[et.clave] || 'neutro'}`} aria-hidden='true' />
                    {et.nombre}
                    <span className='embudo-cantidad'>{col.length}</span>
                  </h3>
                  <span className='embudo-total'>{usd(total)}</span>
                </header>
                <div className='embudo-lista'>
                  {col.map((op) => (
                    <TarjetaOportunidad
                      key={op.id}
                      op={op}
                      onMover={mover}
                      onAbrirEmpresa={onAbrirEmpresa}
                      onAbrirCotizacion={onAbrirCotizacion}
                    />
                  ))}
                  {col.length === 0 && <p className='embudo-columna-vacia'>Sin oportunidades en {nombreEtapa(et.clave).toLowerCase()}</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {dialogo}
    </div>
  );
}

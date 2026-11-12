import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { useCambiarEtapa } from './hooks';
import { PerdidaDialogo } from './DialogosCrm';
import { claseInput } from './Dialogo';
import { ETAPAS, MARCAS, diasTexto, nombreEtapa, usd } from './formato';
import { EstadoVacio, ListaEsqueleto, TarjetasEsqueleto } from '../ui/Esqueleto';
import { notify } from '../ui/toast';
import { mensajeError } from './formato';

const LIMITE_CERRADAS = 25;

function Total({ etiqueta, cantidad, monto, tono }) {
  return (
    <div className='rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-900'>
      <div className='mq-sobre'>{etiqueta}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tono}`}>{usd(monto)}</div>
      <div className='text-sm text-slate-500 dark:text-slate-400'>{cantidad} {cantidad === 1 ? 'oportunidad' : 'oportunidades'}</div>
    </div>
  );
}

export function TarjetaOportunidad({ op, onMover, onAbrirEmpresa, arrastrable = true }) {
  return (
    <article
      draggable={arrastrable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(op.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className='animate-fade-in-up rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-card motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-900'
      aria-label={`Oportunidad ${op.titulo}`}
    >
      <button
        type='button'
        onClick={() => onAbrirEmpresa?.(op.empresa_id)}
        className='block max-w-full truncate text-left text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300'
      >
        {op.empresa_nombre}
      </button>
      <div className='mt-0.5 font-medium text-slate-900 dark:text-slate-100'>{op.titulo}</div>
      <div className='mt-1 flex items-baseline justify-between gap-2'>
        <span className='font-semibold tabular-nums text-slate-900 dark:text-slate-100'>{usd(op.monto)}</span>
        <span className='text-xs text-slate-500 dark:text-slate-400'>{diasTexto(op.dias_en_etapa)} en la etapa</span>
      </div>
      {(op.marca || op.es_proyecto) && (
        <div className='mt-2 flex flex-wrap gap-1'>
          {op.marca && <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200'>{op.marca}</span>}
          {op.es_proyecto && <span className='rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200'>Proyecto / BID</span>}
        </div>
      )}
      {op.etapa === 'perdida' && op.motivo_perdida && (
        <p className='mt-2 text-xs text-slate-500 dark:text-slate-400'>Motivo: {op.motivo_perdida}</p>
      )}
      <select
        aria-label={`Mover ${op.titulo} a otra etapa`}
        value={op.etapa}
        onChange={(e) => onMover(op, e.target.value)}
        className={`${claseInput} mt-2 !py-1 text-xs`}
      >
        {ETAPAS.map((et) => <option key={et.clave} value={et.clave}>{et.nombre}</option>)}
      </select>
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

export default function EmbudoTab({ inputBusquedaRef, onAbrirEmpresa }) {
  const [texto, setTexto] = useState('');
  const [marca, setMarca] = useState('');
  const [mover, dialogo] = useMoverOportunidad();
  const [sobre, setSobre] = useState(null);

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
    <div className='space-y-4'>
      {embudo.isLoading ? (
        <TarjetasEsqueleto cantidad={3} />
      ) : (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <Total etiqueta='Abiertas' cantidad={e?.abiertas?.cantidad ?? 0} monto={e?.abiertas?.monto} tono='text-slate-900 dark:text-slate-100' />
          <Total etiqueta='Ganadas del mes' cantidad={e?.ganadas_mes?.cantidad ?? 0} monto={e?.ganadas_mes?.monto} tono='text-emerald-700 dark:text-emerald-300' />
          <Total etiqueta='Perdidas del mes' cantidad={e?.perdidas_mes?.cantidad ?? 0} monto={e?.perdidas_mes?.monto} tono='text-rose-700 dark:text-rose-300' />
        </div>
      )}

      <div className='flex flex-wrap gap-2'>
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
        <div className='rounded-xl border border-dashed border-slate-300 dark:border-slate-700'>
          <EstadoVacio
            icono='carpeta'
            titulo='Aún no hay oportunidades'
            detalle='Se crean solas al generar una cotización. También puedes crear una con el botón «Nueva oportunidad».'
          />
        </div>
      ) : (
        <div className='flex gap-3 overflow-x-auto pb-2'>
          {ETAPAS.map((et) => {
            const col = porEtapa(et.clave);
            const cerrada = et.clave === 'ganada' || et.clave === 'perdida';
            const visibles = cerrada ? col.slice(0, LIMITE_CERRADAS) : col;
            const total = col.reduce((s, op) => s + (Number(op.monto) || 0), 0);
            return (
              <section
                key={et.clave}
                aria-label={`Etapa ${et.nombre}`}
                onDragOver={(ev) => { ev.preventDefault(); setSobre(et.clave); }}
                onDragLeave={() => setSobre((s) => (s === et.clave ? null : s))}
                onDrop={(ev) => onDrop(ev, et.clave)}
                className={`min-w-[250px] flex-1 rounded-xl border p-2 transition-colors ${
                  sobre === et.clave
                    ? 'border-blue-400 bg-blue-50/60 dark:border-blue-400/60 dark:bg-blue-500/10'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50'
                }`}
              >
                <header className='mb-2 flex items-center justify-between gap-2 px-1'>
                  <h3 className='flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100'>
                    <span className={`h-2 w-2 rounded-full ${et.punto}`} aria-hidden='true' />
                    {et.nombre}
                    <span className='rounded-full bg-slate-200 px-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100'>{col.length}</span>
                  </h3>
                  <span className='text-xs tabular-nums text-slate-500 dark:text-slate-400'>{usd(total)}</span>
                </header>
                <div className='space-y-2'>
                  {visibles.map((op) => (
                    <TarjetaOportunidad key={op.id} op={op} onMover={mover} onAbrirEmpresa={onAbrirEmpresa} />
                  ))}
                  {col.length === 0 && <p className='px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-400'>Sin oportunidades en {nombreEtapa(et.clave).toLowerCase()}</p>}
                  {col.length > visibles.length && (
                    <p className='px-2 py-1 text-center text-xs text-slate-500 dark:text-slate-400'>y {col.length - visibles.length} más antiguas</p>
                  )}
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

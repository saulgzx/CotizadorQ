import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import Dialogo from './Dialogo';
import { EstadoVacio, ListaEsqueleto } from '../ui/Esqueleto';
import { notify } from '../ui/toast';
import { mensajeError } from './formato';

function Grupo({ grupo, indice, onFusionar }) {
  // Por defecto se conserva la que tiene más cotizaciones.
  const [destinoId, setDestinoId] = useState(() =>
    [...grupo.empresas].sort((a, b) => (b.cotizaciones || 0) - (a.cotizaciones || 0))[0].id
  );
  const destino = grupo.empresas.find((e) => e.id === destinoId);
  const origenes = grupo.empresas.filter((e) => e.id !== destinoId);
  const nombreGrupo = `grupo-${indice}`;

  return (
    <fieldset className='rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900'>
      <legend className='px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'>
        {grupo.motivo || 'Nombres parecidos'}
      </legend>
      <p className='mb-2 text-sm text-slate-600 dark:text-slate-300'>Elige la empresa que se conserva:</p>
      <div className='space-y-1.5'>
        {grupo.empresas.map((emp) => (
          <label key={emp.id} className='flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100'>
            <input type='radio' name={nombreGrupo} checked={emp.id === destinoId} onChange={() => setDestinoId(emp.id)} />
            <span className='font-medium'>{emp.nombre}</span>
            <span className='text-slate-500 dark:text-slate-400'>({emp.cotizaciones} {emp.cotizaciones === 1 ? 'cotización' : 'cotizaciones'})</span>
          </label>
        ))}
      </div>
      <div className='mt-3 flex flex-wrap gap-2'>
        {origenes.map((o) => (
          <button key={o.id} type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={() => onFusionar(destino, o)}>
            Fusionar «{o.nombre}» en «{destino.nombre}»
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function FusionDuplicados({ onVolver }) {
  const qc = useQueryClient();
  const [pendiente, setPendiente] = useState(null);
  const duplicados = useQuery({ queryKey: queryKeys.crm.duplicados, queryFn: crmApi.duplicadosEmpresas });

  const fusionar = useMutation({
    mutationFn: ({ destino, origen }) => crmApi.fusionarEmpresas(destino.id, origen.id),
    onSuccess: (res, { destino }) => {
      const m = res?.movidos || {};
      notify(
        `Empresas fusionadas en «${destino.nombre}»: ${m.contactos ?? 0} contactos, ${m.oportunidades ?? 0} oportunidades y ${m.cotizaciones ?? 0} cotizaciones movidos`,
        { tipo: 'ok' }
      );
      qc.invalidateQueries({ queryKey: queryKeys.crm.todo });
    },
    onError: (error) => notify(`No se pudo fusionar: ${mensajeError(error)}`, { tipo: 'error' }),
    onSettled: () => setPendiente(null)
  });

  const grupos = duplicados.data?.grupos || [];

  return (
    <div className='space-y-4'>
      <button type='button' onClick={onVolver} className='mq-btn mq-btn-sm mq-btn-fantasma'>← Volver a empresas</button>
      <p className='text-sm text-slate-600 dark:text-slate-300'>
        Estas empresas tienen nombres muy parecidos. Si son la misma, fusiónalas para juntar sus contactos, oportunidades y cotizaciones.
      </p>
      {duplicados.isLoading ? (
        <ListaEsqueleto lineas={2} />
      ) : grupos.length === 0 ? (
        <div className='rounded-xl border border-dashed border-slate-300 dark:border-slate-700'>
          <EstadoVacio icono='users' titulo='No hay posibles duplicados' detalle='Todas tus empresas tienen nombres distintos.' />
        </div>
      ) : (
        <div className='space-y-3'>
          {grupos.map((g, i) => (
            <Grupo key={g.empresas.map((e) => e.id).join('-')} grupo={g} indice={i} onFusionar={(destino, origen) => setPendiente({ destino, origen })} />
          ))}
        </div>
      )}

      {pendiente && (
        <Dialogo titulo='Confirmar fusión' onCerrar={() => setPendiente(null)} ancho='max-w-lg'>
          <div className='space-y-2 text-sm text-slate-700 dark:text-slate-200'>
            <p>
              Se moverán todos los <strong>contactos</strong>, <strong>oportunidades</strong> y{' '}
              <strong>cotizaciones</strong> ({pendiente.origen.cotizaciones} de esta empresa) desde{' '}
              <strong>«{pendiente.origen.nombre}»</strong> hacia <strong>«{pendiente.destino.nombre}»</strong>.
            </p>
            <p>Los contactos con el mismo email se unirán en uno solo.</p>
            <p className='font-semibold text-rose-700 dark:text-rose-300'>
              «{pendiente.origen.nombre}» se eliminará y esto no se puede deshacer.
            </p>
          </div>
          <div className='mt-4 flex justify-end gap-2'>
            <button type='button' data-autofocus className='mq-btn mq-btn-secundario' onClick={() => setPendiente(null)}>Cancelar</button>
            <button
              type='button'
              className='mq-btn mq-btn-primario'
              disabled={fusionar.isPending}
              onClick={() => fusionar.mutate(pendiente)}
            >
              {fusionar.isPending ? 'Fusionando…' : 'Fusionar empresas'}
            </button>
          </div>
        </Dialogo>
      )}
    </div>
  );
}

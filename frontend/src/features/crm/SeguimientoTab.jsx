import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { seguimientoApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { fechaCL, mensajeError, nombreEtapa, porcentaje, usd } from './formato';
import {
  GRUPOS_SEGUIMIENTO, conteoSeguimiento, cuando, estadoSeguimiento, hitosSeguimiento, nombreAccion, puedePausar, puedeReanudar
} from './resumen';
import { Cifra, Estado, Indicador, Indicadores, Panel } from './Piezas';
import { EstadoVacio, FilasEsqueleto } from '../ui/Esqueleto';
import { notify } from '../ui/toast';

const horas = (min) => {
  const m = Math.round(Number(min) || 0);
  return m < 60 ? `${m} min` : `${(m / 60).toFixed(1).replace('.0', '')} h`;
};

function Hitos({ seg }) {
  const hitos = hitosSeguimiento(seg);
  return (
    <ol className='mq-hitos' aria-label={`Avance: ${hitos.filter((h) => h.hecho).map((h) => h.nombre).join(', ') || 'sin hitos aún'}`}>
      {hitos.map((h, i) => (
        <li key={h.nombre} className={`mq-hito ${h.hecho ? 'mq-hito-hecho' : ''} ${h.hecho && h.final ? `mq-hito-${h.final}` : ''}`} style={{ '--i': i }} title={`${h.nombre}${h.hecho ? ' · hecho' : ' · pendiente'}`}>
          <span className='mq-hito-punto' />
          <span className='mq-hito-nombre'>{h.nombre}</span>
        </li>
      ))}
    </ol>
  );
}

export default function SeguimientoTab({ onAbrirCotizacion }) {
  const qc = useQueryClient();
  const [grupo, setGrupo] = useState('');
  const lista = useQuery({ queryKey: queryKeys.crm.seguimiento, queryFn: seguimientoApi.lista, retry: false });
  const valor = useQuery({ queryKey: queryKeys.crm.seguimientoValor, queryFn: seguimientoApi.valor, retry: false });

  const cambiar = useMutation({
    mutationFn: ({ id, accion }) => (accion === 'pausar' ? seguimientoApi.pausar(id) : seguimientoApi.reanudar(id)),
    onSuccess: (_d, { accion }) => notify(accion === 'pausar' ? 'Seguimiento pausado' : 'Seguimiento reanudado', { tipo: 'ok' }),
    onError: (error) => notify(mensajeError(error, 'No se pudo cambiar el seguimiento'), { tipo: 'error' }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.crm.seguimiento })
  });

  const items = lista.data?.items || [];
  const conteo = conteoSeguimiento(items);
  const visibles = grupo ? items.filter((s) => estadoSeguimiento(s.estado).grupo === grupo) : items;
  const v = valor.data;
  const tasaRespuesta = v?.respuestas_por_paso
    ? (() => {
      const filas = Object.values(v.respuestas_por_paso);
      const enviados = filas.reduce((s, f) => s + (Number(f?.enviados) || 0), 0);
      const respuestas = filas.reduce((s, f) => s + (Number(f?.respuestas) || 0), 0);
      return enviados > 0 ? respuestas / enviados : null;
    })()
    : null;

  return (
    <div className='space-y-4'>
      {lista.data && !lista.data.activo && (
        <div className='mq-aviso'>
          <Estado tono='neutro'>El seguimiento automático está apagado en el servidor.</Estado>
          <span className='text-slate-500'>No se dan de alta cotizaciones nuevas ni se crean borradores hasta activarlo (variable SEGUIMIENTO_ACTIVO).</span>
        </div>
      )}

      <Indicadores>
        <Indicador etiqueta='En curso' tono='info' detalle='Buscando el correo o esperando respuesta'><Cifra valor={conteo.curso} /></Indicador>
        <Indicador etiqueta='Borradores por enviar' tono='aviso' detalle='Listos en Outlook, esperan tu envío'><Cifra valor={conteo.borrador} /></Indicador>
        <Indicador etiqueta='Respondieron' tono='ok' detalle={tasaRespuesta === null ? 'Clientes que contestaron' : `Tasa de respuesta ${porcentaje(tasaRespuesta)} · 30 días`}><Cifra valor={conteo.respondida} /></Indicador>
        <Indicador etiqueta='Tiempo ahorrado' detalle={v?.ingreso_atribuido ? `${usd(v.ingreso_atribuido)} de ingreso atribuido · 30 días` : 'Últimos 30 días'}>
          {valor.isLoading || !v ? '—' : horas(v.tiempo_ahorrado_min)}
        </Indicador>
      </Indicadores>

      <Panel
        titulo='Cotizaciones en seguimiento'
        detalle='Cadencia: 1er seguimiento a los 3 días hábiles, 2º a los 7, cierre a los 7. Nada se envía solo: tú revisas y envías cada borrador.'
      >
        <div className='mq-filtros' role='group' aria-label='Filtrar por estado'>
          <button type='button' className='mq-filtro' aria-pressed={grupo === ''} onClick={() => setGrupo('')}>Todas <span>{items.length}</span></button>
          {GRUPOS_SEGUIMIENTO.map((g) => (
            <button key={g.clave} type='button' className='mq-filtro' aria-pressed={grupo === g.clave} onClick={() => setGrupo(g.clave)}>
              {g.nombre} <span>{conteo[g.clave]}</span>
            </button>
          ))}
        </div>
        <div className='overflow-x-auto'>
          <table className='mq-tabla'>
            <thead>
              <tr>
                <th scope='col'>Cotización</th>
                <th scope='col' className='text-right'>Monto</th>
                <th scope='col'>Avance</th>
                <th scope='col'>Estado</th>
                <th scope='col'>Próximo paso</th>
                <th scope='col'><span className='sr-only'>Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.isLoading && <FilasEsqueleto filas={4} columnas={6} />}
              {visibles.map((s) => {
                const est = estadoSeguimiento(s.estado);
                return (
                  <tr key={s.oportunidad_id}>
                    <td>
                      <div className='flex items-baseline gap-2'>
                        {s.numero && s.cotizacion_id && onAbrirCotizacion ? (
                          <button type='button' className='mq-enlace font-mono text-xs' onClick={() => onAbrirCotizacion(s.cotizacion_id)}>{s.numero}</button>
                        ) : s.numero ? <span className='font-mono text-xs text-slate-500'>{s.numero}</span> : null}
                        <span className='font-medium text-slate-900'>{s.empresa_nombre || '—'}</span>
                      </div>
                      <div className='mt-0.5 max-w-[28rem] truncate text-xs text-slate-500'>
                        {s.titulo}{s.contacto_nombre ? ` · ${s.contacto_nombre}` : ''} · {nombreEtapa(s.etapa)}
                      </div>
                      {s.respuesta_resumen && <p className='mt-1.5 max-w-[28rem] border-l-2 border-slate-300 pl-2 text-xs text-slate-600'>{s.respuesta_resumen}</p>}
                    </td>
                    <td className='text-right tabular-nums text-slate-900'>{usd(s.monto)}</td>
                    <td><Hitos seg={s} /></td>
                    <td>
                      <Estado tono={est.tono}>{est.nombre}</Estado>
                      {s.enviado_en && <div className='mt-0.5 text-xs text-slate-500'>Enviada el {fechaCL(s.enviado_en)}</div>}
                    </td>
                    <td>
                      {s.siguiente ? (
                        <>
                          <div className='text-slate-900'>{nombreAccion(s.siguiente.accion)}</div>
                          {s.siguiente.en && <div className='text-xs text-slate-500'>{fechaCL(s.siguiente.en)} · {cuando(s.siguiente.en)}</div>}
                        </>
                      ) : <span className='text-slate-500'>—</span>}
                    </td>
                    <td className='text-right'>
                      {puedePausar(s) && <button type='button' className='mq-btn mq-btn-xs mq-btn-secundario' disabled={cambiar.isPending} onClick={() => cambiar.mutate({ id: s.oportunidad_id, accion: 'pausar' })}>Pausar</button>}
                      {puedeReanudar(s) && <button type='button' className='mq-btn mq-btn-xs mq-btn-primario' disabled={cambiar.isPending} onClick={() => cambiar.mutate({ id: s.oportunidad_id, accion: 'reanudar' })}>Reanudar</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lista.isError && <EstadoVacio icono='bandeja' titulo='No se pudo cargar el seguimiento' detalle={mensajeError(lista.error)} />}
        {!lista.isLoading && !lista.isError && visibles.length === 0 && (
          <EstadoVacio
            icono='clock'
            titulo={grupo ? 'Nada en este estado' : 'Aún no hay cotizaciones en seguimiento'}
            detalle={grupo ? 'Prueba con otro filtro.' : 'Entran solas las oportunidades nuevas o cotizadas con una cotización de los últimos 30 días.'}
          />
        )}
      </Panel>
    </div>
  );
}

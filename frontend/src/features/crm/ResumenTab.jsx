import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi, seguimientoApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { diasTexto, nombreEtapa, porcentaje, usd } from './formato';
import {
  GRUPOS_SEGUIMIENTO, conteoSeguimiento, cuando, empresasPorPipeline, estadoSeguimiento, estancadas,
  etapasEmbudo, nombreAccion, pipelinePorMarca, tasaCierre
} from './resumen';
import { Barra, Cifra, Estado, Indicador, Indicadores, Panel, Vacio } from './Piezas';
import { ListaEsqueleto } from '../ui/Esqueleto';

const usd0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const SERIE = { AXIS: 1, QNAP: 2, MIXTA: 3 };

export default function ResumenTab({ onAbrirEmpresa, onIrA }) {
  const embudo = useQuery({ queryKey: queryKeys.crm.embudo, queryFn: crmApi.embudo });
  const lista = useQuery({ queryKey: queryKeys.crm.oportunidades, queryFn: () => crmApi.listarOportunidades() });
  const seguimiento = useQuery({ queryKey: queryKeys.crm.seguimiento, queryFn: seguimientoApi.lista, retry: false });

  const e = embudo.data;
  const ops = lista.data?.items || [];
  const etapas = etapasEmbudo(e);
  const empresas = empresasPorPipeline(ops);
  const quietas = estancadas(ops);
  const marcas = pipelinePorMarca(ops);
  const tasa = tasaCierre(e);
  const segs = seguimiento.data?.items || [];
  const conteo = conteoSeguimiento(segs);
  const proximos = segs
    .filter((s) => s.siguiente?.en && ['curso', 'borrador'].includes(estadoSeguimiento(s.estado).grupo))
    .sort((a, b) => String(a.siguiente.en).localeCompare(String(b.siguiente.en)))
    .slice(0, 4);

  return (
    <div className='space-y-4'>
      <Indicadores>
        <Indicador etiqueta='Pipeline abierto' detalle={`${e?.abiertas?.cantidad ?? 0} oportunidades en curso`}>
          <Cifra valor={e?.abiertas?.monto} formato={usd0} />
        </Indicador>
        <Indicador etiqueta='Ganado este mes' tono='ok' detalle={`${e?.ganadas_mes?.cantidad ?? 0} cerradas ganadas`}>
          <Cifra valor={e?.ganadas_mes?.monto} formato={usd0} />
        </Indicador>
        <Indicador etiqueta='Perdido este mes' tono='critico' detalle={`${e?.perdidas_mes?.cantidad ?? 0} cerradas perdidas`}>
          <Cifra valor={e?.perdidas_mes?.monto} formato={usd0} />
        </Indicador>
        <Indicador etiqueta='Tasa de cierre del mes' detalle='Ganadas sobre el total de cerradas'>
          {tasa === null ? '—' : <Cifra valor={tasa * 100} formato={(n) => `${Math.round(n)}%`} />}
        </Indicador>
      </Indicadores>

      <div className='grid gap-4 lg:grid-cols-[1.35fr_1fr]'>
        <Panel
          titulo='Embudo de ventas'
          detalle='Monto abierto por etapa. La barra compara cada etapa con la mayor.'
          accion={<button type='button' className='mq-btn mq-btn-xs mq-btn-fantasma' onClick={() => onIrA('embudo')}>Abrir tablero</button>}
        >
          {embudo.isLoading ? <ListaEsqueleto lineas={3} className='p-4' /> : (
            <ol className='mq-embudo'>
              {etapas.map((et, i) => (
                <li key={et.clave}>
                  <button type='button' className='mq-embudo-fila' onClick={() => onIrA('embudo')} title={`${nombreEtapa(et.clave)}: ${et.cantidad} oportunidades, ${usd(et.monto)}`}>
                    <span className='mq-embudo-paso'>{String(i + 1).padStart(2, '0')}</span>
                    <span className='mq-embudo-nombre'>
                      {nombreEtapa(et.clave)}
                      <span className='mq-embudo-cantidad'>{et.cantidad}</span>
                    </span>
                    <Barra razon={et.razon} orden={i} />
                    <span className='mq-embudo-monto'>{usd0(et.monto)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className='mq-panel-pie'>
            <Estado tono='ok'>Ganadas del mes · {e?.ganadas_mes?.cantidad ?? 0} · {usd0(e?.ganadas_mes?.monto || 0)}</Estado>
            <Estado tono='critico'>Perdidas del mes · {e?.perdidas_mes?.cantidad ?? 0} · {usd0(e?.perdidas_mes?.monto || 0)}</Estado>
          </div>
        </Panel>

        <Panel
          titulo='Seguimiento automático'
          detalle='Cotizaciones que el sistema está siguiendo por correo.'
          accion={<button type='button' className='mq-btn mq-btn-xs mq-btn-fantasma' onClick={() => onIrA('seguimiento')}>Ver todas</button>}
        >
          {seguimiento.isLoading ? <ListaEsqueleto lineas={2} className='p-4' /> : seguimiento.isError ? (
            <Vacio>No se pudo leer el seguimiento automático.</Vacio>
          ) : (
            <>
              <div className='mq-panel-franja'>
                <Estado tono={seguimiento.data?.activo ? 'ok' : 'neutro'}>
                  {seguimiento.data?.activo ? 'Activo' : 'Apagado en el servidor'}
                </Estado>
                <span className='text-sm text-slate-500'>{segs.length} {segs.length === 1 ? 'cotización' : 'cotizaciones'}</span>
              </div>
              <dl className='mq-mini'>
                {GRUPOS_SEGUIMIENTO.slice(0, 4).map((g) => (
                  <div key={g.clave}>
                    <dt>{g.nombre}</dt>
                    <dd><Cifra valor={conteo[g.clave]} /></dd>
                  </div>
                ))}
              </dl>
              {proximos.length > 0 ? (
                <ul className='mq-lista'>
                  {proximos.map((s) => (
                    <li key={s.oportunidad_id} className='mq-lista-fila'>
                      <span className='min-w-0'>
                        <span className='block truncate font-medium text-slate-900'>{s.empresa_nombre || s.titulo}</span>
                        <span className='block truncate text-xs text-slate-500'>{nombreAccion(s.siguiente.accion)}</span>
                      </span>
                      <span className='shrink-0 text-xs tabular-nums text-slate-500'>{cuando(s.siguiente.en)}</span>
                    </li>
                  ))}
                </ul>
              ) : <Vacio>Sin pasos pendientes.</Vacio>}
            </>
          )}
        </Panel>
      </div>

      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel titulo='Empresas con más pipeline' detalle='Monto abierto por empresa.' accion={<button type='button' className='mq-btn mq-btn-xs mq-btn-fantasma' onClick={() => onIrA('empresas')}>Ver empresas</button>}>
          {lista.isLoading ? <ListaEsqueleto lineas={3} className='p-4' /> : empresas.length === 0 ? <Vacio>Aún no hay oportunidades abiertas.</Vacio> : (
            <ul className='mq-lista'>
              {empresas.map((emp, i) => (
                <li key={emp.empresa_id}>
                  <button type='button' className='mq-lista-fila mq-lista-boton' onClick={() => onAbrirEmpresa(emp.empresa_id)} title={`${emp.nombre}: ${emp.cantidad} abiertas, ${usd(emp.monto)}`}>
                    <span className='min-w-0 flex-1'>
                      <span className='flex items-baseline justify-between gap-3'>
                        <span className='truncate font-medium text-slate-900'>{emp.nombre}</span>
                        <span className='shrink-0 tabular-nums text-slate-900'>{usd0(emp.monto)}</span>
                      </span>
                      <Barra razon={emp.razon} orden={i} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel titulo='Oportunidades estancadas' detalle='Abiertas con 7 días o más en la misma etapa.'>
          {lista.isLoading ? <ListaEsqueleto lineas={3} className='p-4' /> : quietas.length === 0 ? <Vacio>Nada estancado. Todo se movió esta semana.</Vacio> : (
            <ul className='mq-lista'>
              {quietas.map((op) => (
                <li key={op.id}>
                  <button type='button' className='mq-lista-fila mq-lista-boton' onClick={() => onAbrirEmpresa(op.empresa_id)}>
                    <span className='min-w-0'>
                      <span className='block truncate font-medium text-slate-900'>{op.titulo}</span>
                      <span className='block truncate text-xs text-slate-500'>{op.empresa_nombre} · {nombreEtapa(op.etapa)} · {usd0(op.monto)}</span>
                    </span>
                    <Estado tono={op.dias_en_etapa >= 21 ? 'critico' : 'aviso'}>{diasTexto(op.dias_en_etapa)}</Estado>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel titulo='Pipeline por marca' detalle='Reparto del monto abierto.'>
          {lista.isLoading ? <ListaEsqueleto lineas={2} className='p-4' /> : marcas.total === 0 ? <Vacio>Aún no hay monto abierto.</Vacio> : (
            <div className='p-4'>
              <div className='mq-reparto' role='img' aria-label={marcas.filas.map((f) => `${f.marca} ${porcentaje(f.razon)}`).join(', ')}>
                {marcas.filas.filter((f) => f.monto > 0).map((f) => (
                  <span key={f.marca} className={`mq-serie-${SERIE[f.marca]}`} style={{ flexGrow: f.monto }} title={`${f.marca}: ${usd(f.monto)} (${porcentaje(f.razon)})`} />
                ))}
                {marcas.sinMarca > 0 && <span className='mq-serie-0' style={{ flexGrow: marcas.sinMarca }} title={`Sin marca: ${usd(marcas.sinMarca)}`} />}
              </div>
              <ul className='mt-4 space-y-2.5 text-sm'>
                {marcas.filas.map((f) => (
                  <li key={f.marca} className='flex items-baseline justify-between gap-3'>
                    <span className='flex items-center gap-2 text-slate-700'>
                      <span className={`mq-cuadro mq-serie-${SERIE[f.marca]}`} aria-hidden='true' />
                      {f.marca}
                    </span>
                    <span className='tabular-nums text-slate-900'>{usd0(f.monto)} <span className='text-slate-500'>· {porcentaje(f.razon)}</span></span>
                  </li>
                ))}
                {marcas.sinMarca > 0 && (
                  <li className='flex items-baseline justify-between gap-3'>
                    <span className='flex items-center gap-2 text-slate-700'><span className='mq-cuadro mq-serie-0' aria-hidden='true' />Sin marca</span>
                    <span className='tabular-nums text-slate-900'>{usd(marcas.sinMarca)}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

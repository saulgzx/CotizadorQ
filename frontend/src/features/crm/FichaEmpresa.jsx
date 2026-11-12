import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { ContactoDialogo, EmpresaDialogo, OportunidadDialogo } from './DialogosCrm';
import { useMoverOportunidad } from './EmbudoTab';
import { ETAPAS, diasTexto, fechaCL, mensajeError, nombreEtapa, porcentaje, usd } from './formato';
import { claseInput } from './Dialogo';
import { EstadoVacio, ListaEsqueleto, TarjetasEsqueleto } from '../ui/Esqueleto';
import { EtapaCotizacion } from './CotizacionesPiezas';
import { notify } from '../ui/toast';

const Seccion = ({ titulo, accion, children }) => (
  <section className='rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900'>
    <div className='mb-3 flex items-center justify-between gap-2'>
      <h3 className='text-base font-semibold text-slate-900 dark:text-slate-100'>{titulo}</h3>
      {accion}
    </div>
    {children}
  </section>
);

const Dato = ({ etiqueta, valor, tono = 'text-slate-900 dark:text-slate-100' }) => (
  <div className='rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900'>
    <div className='mq-sobre'>{etiqueta}</div>
    <div className={`mt-1 text-lg font-bold tabular-nums ${tono}`}>{valor}</div>
  </div>
);

export default function FichaEmpresa({ empresaId, onVolver, onAbrirCotizacion, registrarCrear }) {
  const qc = useQueryClient();
  const [dialogo, setDialogo] = useState(null);
  const [mover, dialogoPerdida] = useMoverOportunidad();
  const ficha = useQuery({
    queryKey: queryKeys.crm.empresa(empresaId),
    queryFn: () => crmApi.obtenerEmpresa(empresaId)
  });

  // El atajo N crea una oportunidad desde la ficha.
  useEffect(() => {
    registrarCrear?.(() => setDialogo({ tipo: 'oportunidad' }));
    return () => registrarCrear?.(null);
  }, [registrarCrear]);

  useEffect(() => {
    if (ficha.isError) notify(mensajeError(ficha.error, 'No se pudo cargar la empresa'), { tipo: 'error' });
  }, [ficha.isError, ficha.error]);

  const refrescar = () => qc.invalidateQueries({ queryKey: queryKeys.crm.todo });

  const archivarContacto = async (c) => {
    try {
      await crmApi.actualizarContacto(c.id, { archivado: !c.archivado });
      notify(c.archivado ? 'Contacto restaurado' : 'Contacto archivado', { tipo: 'ok' });
      refrescar();
    } catch (err) {
      notify(mensajeError(err), { tipo: 'error' });
    }
  };

  const archivarEmpresa = async (emp) => {
    try {
      await crmApi.actualizarEmpresa(emp.id, { archivada: !emp.archivada });
      notify(emp.archivada ? 'Empresa restaurada' : 'Empresa archivada', { tipo: 'ok' });
      refrescar();
    } catch (err) {
      notify(mensajeError(err), { tipo: 'error' });
    }
  };

  if (ficha.isLoading) {
    return (
      <div className='space-y-4'>
        <TarjetasEsqueleto cantidad={4} />
        <ListaEsqueleto lineas={3} />
      </div>
    );
  }
  if (!ficha.data) {
    return (
      <div className='space-y-3'>
        <button type='button' onClick={onVolver} className='mq-btn mq-btn-sm mq-btn-fantasma'>← Volver a empresas</button>
        <EstadoVacio icono='users' titulo='No se pudo cargar la empresa' detalle='Revisa la conexión e inténtalo de nuevo.' accion={{ label: 'Reintentar', onClick: () => ficha.refetch() }} />
      </div>
    );
  }

  const { empresa, contactos = [], oportunidades = [], cotizaciones = [], resumen = {} } = ficha.data;
  const contactosActivos = contactos.filter((c) => !c.archivado);

  return (
    <div className='space-y-4'>
      <button type='button' onClick={onVolver} className='mq-btn mq-btn-sm mq-btn-fantasma'>← Volver a empresas</button>

      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100'>
            {empresa.nombre}
            {empresa.archivada && <span className='ml-2 rounded-full bg-slate-200 px-2 py-0.5 align-middle text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100'>Archivada</span>}
          </h2>
          <p className='mt-0.5 text-sm text-slate-600 dark:text-slate-300'>
            {[empresa.rut && `RUT ${empresa.rut}`, empresa.sitio].filter(Boolean).join(' · ') || 'Sin RUT ni sitio web'}
          </p>
          {empresa.notas && <p className='mt-1 max-w-2xl whitespace-pre-line text-sm text-slate-600 dark:text-slate-300'>{empresa.notas}</p>}
        </div>
        <div className='flex gap-2'>
          <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={() => setDialogo({ tipo: 'empresa' })}>Editar datos</button>
          <button type='button' className='mq-btn mq-btn-sm mq-btn-peligro' onClick={() => archivarEmpresa(empresa)}>
            {empresa.archivada ? 'Restaurar empresa' : 'Archivar empresa'}
          </button>
        </div>
      </div>

      <div className='grid grid-cols-2 gap-3 md:grid-cols-5' aria-label='Resumen de la empresa'>
        <Dato etiqueta='Cotizaciones' valor={resumen.cotizaciones ?? 0} />
        <Dato etiqueta='Monto cotizado' valor={usd(resumen.monto_cotizado)} />
        <Dato etiqueta='Ganadas' valor={`${resumen.ganadas ?? 0} · ${usd(resumen.monto_ganado)}`} tono='text-emerald-700 dark:text-emerald-300' />
        <Dato etiqueta='Perdidas' valor={resumen.perdidas ?? 0} tono='text-rose-700 dark:text-rose-300' />
        <Dato etiqueta='Tasa de cierre' valor={porcentaje(resumen.tasa_cierre)} />
      </div>

      <Seccion
        titulo='Contactos'
        accion={<button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={() => setDialogo({ tipo: 'contacto' })}>Agregar contacto</button>}
      >
        {contactos.length === 0 ? (
          <EstadoVacio icono='user' titulo='Sin contactos' detalle='Se agregan solos al generar una cotización con email, o puedes agregar uno.' />
        ) : (
          <ul className='divide-y divide-slate-100 dark:divide-slate-800'>
            {contactos.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${c.archivado ? 'opacity-60' : ''}`}>
                <div className='min-w-0'>
                  <div className='font-medium text-slate-900 dark:text-slate-100'>
                    {c.nombre}{c.cargo && <span className='font-normal text-slate-500 dark:text-slate-400'> · {c.cargo}</span>}
                    {c.archivado && <span className='ml-2 text-xs text-slate-500'>(archivado)</span>}
                  </div>
                  <div className='text-slate-600 dark:text-slate-300'>{[c.email, c.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
                </div>
                <div className='flex gap-1'>
                  <button type='button' className='mq-btn mq-btn-xs mq-btn-fantasma' aria-label={`Editar contacto ${c.nombre}`} onClick={() => setDialogo({ tipo: 'contacto', contacto: c })}>Editar</button>
                  <button type='button' className='mq-btn mq-btn-xs mq-btn-fantasma' aria-label={`${c.archivado ? 'Restaurar' : 'Archivar'} contacto ${c.nombre}`} onClick={() => archivarContacto(c)}>
                    {c.archivado ? 'Restaurar' : 'Archivar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion
        titulo='Oportunidades'
        accion={<button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={() => setDialogo({ tipo: 'oportunidad' })}>Nueva oportunidad</button>}
      >
        {oportunidades.length === 0 ? (
          <EstadoVacio icono='carpeta' titulo='Aún no hay oportunidades' detalle='Se crean solas al generar una cotización.' />
        ) : (
          <ul className='divide-y divide-slate-100 dark:divide-slate-800'>
            {oportunidades.map((op) => (
              <li key={op.id} className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'>
                <div className='min-w-0'>
                  <div className='font-medium text-slate-900 dark:text-slate-100'>
                    {op.titulo}
                    {op.marca && <span className='ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200'>{op.marca}</span>}
                    {op.es_proyecto && <span className='ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200'>Proyecto / BID</span>}
                  </div>
                  <div className='text-slate-600 dark:text-slate-300'>
                    {usd(op.monto)} · {diasTexto(op.dias_en_etapa)} en {nombreEtapa(op.etapa).toLowerCase()}
                    {op.etapa === 'perdida' && op.motivo_perdida ? ` · Motivo: ${op.motivo_perdida}` : ''}
                  </div>
                </div>
                <select
                  aria-label={`Etapa de ${op.titulo}`}
                  value={op.etapa}
                  onChange={(e) => mover(op, e.target.value)}
                  className={`${claseInput} !w-auto !py-1`}
                >
                  {ETAPAS.map((et) => <option key={et.clave} value={et.clave}>{et.nombre}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion titulo='Cotizaciones'>
        {cotizaciones.length === 0 ? (
          <EstadoVacio icono='doc' titulo='Sin cotizaciones vinculadas' detalle='Aparecen aquí al generar una cotización para esta empresa.' />
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400'>
                <tr>
                  <th scope='col' className='px-2 py-1 font-semibold'>N°</th>
                  <th scope='col' className='px-2 py-1 font-semibold'>Fecha</th>
                  <th scope='col' className='px-2 py-1 font-semibold'>Etapa</th>
                  <th scope='col' className='px-2 py-1 text-right font-semibold'>Total</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-slate-100 dark:divide-slate-800'>
                {cotizaciones.map((c) => (
                  <tr key={c.id}>
                    <td className='px-2 py-1.5 font-medium'>
                      {onAbrirCotizacion ? (
                        <button type='button' onClick={() => onAbrirCotizacion(c.id)} className='text-blue-700 hover:underline dark:text-blue-300' aria-label={`Abrir cotización ${c.numero} en Cotizaciones`}>
                          #{c.numero}
                        </button>
                      ) : `#${c.numero}`}
                    </td>
                    <td className='px-2 py-1.5 text-slate-600 dark:text-slate-300'>{fechaCL(c.created_at)}</td>
                    <td className='px-2 py-1.5'><EtapaCotizacion cot={c} /></td>
                    <td className='px-2 py-1.5 text-right tabular-nums'>{usd(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {dialogo?.tipo === 'empresa' && <EmpresaDialogo empresa={empresa} onCerrar={() => setDialogo(null)} />}
      {dialogo?.tipo === 'contacto' && <ContactoDialogo empresaId={empresa.id} contacto={dialogo.contacto} onCerrar={() => setDialogo(null)} />}
      {dialogo?.tipo === 'oportunidad' && <OportunidadDialogo empresaId={empresa.id} contactos={contactosActivos} onCerrar={() => setDialogo(null)} />}
      {dialogoPerdida}
    </div>
  );
}

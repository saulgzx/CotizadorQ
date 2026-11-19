import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { useGuardarSeguimiento } from './hooks';
import { useMoverOportunidad } from './EmbudoTab';
import Dialogo, { claseInput } from './Dialogo';
import { ETAPAS, diasTexto, fechaCL, usd } from './formato';
import {
  ATAJOS_SEGUIMIENTO,
  ETAPAS_CON_SEGUIMIENTO,
  LARGO_NOTA_SEGUIMIENTO,
  TONO_URGENCIA,
  esFechaValida,
  fechaDeAtajo,
  hoyLocal,
  textoSeguimiento,
  urgenciaDeOportunidad
} from './seguimiento';

const chip = 'inline-flex h-[1.125rem] items-center rounded border border-slate-300 px-1.5 font-mono text-[10.5px] font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300';
const enlace = 'rounded text-left font-medium text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-300';
const etiquetaDato = 'text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400';

const Dato = ({ etiqueta, children }) => (
  <div className='min-w-0'>
    <dt className={etiquetaDato}>{etiqueta}</dt>
    <dd className='mt-0.5 text-sm text-slate-900 dark:text-slate-100'>{children}</dd>
  </div>
);

// Fecha y nota tal como las guardaría el servidor: vacío = null, la nota recortada.
const normalizar = (fecha, nota) => ({
  proximo_seguimiento: String(fecha ?? '').trim() || null,
  seguimiento_nota: String(nota ?? '').trim() || null
});

/**
 * Detalle de UNA oportunidad: datos, etapa, seguimiento (fecha + nota) y cotizaciones.
 * Lee de la misma consulta del árbol, así que muestra al instante lo que ya está en caché.
 */
export default function OportunidadPanel({ oportunidadId, onCerrar, onAbrirEmpresa, onAbrirCotizacion, hoy }) {
  const consulta = useQuery({ queryKey: queryKeys.crm.arbol, queryFn: () => crmApi.arbol() });
  const op = (consulta.data?.oportunidades || []).find((o) => o.id === oportunidadId);

  if (!op) {
    return (
      <Dialogo titulo='Oportunidad' onCerrar={onCerrar}>
        {consulta.isLoading ? (
          <p className='text-sm text-slate-500 dark:text-slate-400'>Cargando…</p>
        ) : (
          <div className='space-y-4'>
            <p className='text-sm text-slate-700 dark:text-slate-200'>Esta oportunidad ya no está disponible</p>
            <div className='flex justify-end'>
              <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={onCerrar}>Cerrar</button>
            </div>
          </div>
        )}
      </Dialogo>
    );
  }
  const cotizaciones = (consulta.data?.cotizaciones || []).filter((c) => c.oportunidad_id === op.id);
  return (
    <DetalleOportunidad
      op={op}
      cotizaciones={cotizaciones}
      hoy={hoy || hoyLocal()}
      onCerrar={onCerrar}
      onAbrirEmpresa={onAbrirEmpresa}
      onAbrirCotizacion={onAbrirCotizacion}
    />
  );
}

function DetalleOportunidad({ op, cotizaciones, hoy, onCerrar, onAbrirEmpresa, onAbrirCotizacion }) {
  const [mover, dialogoPerdida] = useMoverOportunidad();
  const guardar = useGuardarSeguimiento();
  const primerAtajo = useRef(null);

  // Formulario del seguimiento: parte de lo guardado y solo se reinicia al guardar con éxito
  // (si el servidor falla, y la caché vuelve atrás, lo escrito se conserva).
  const [fecha, setFecha] = useState(op.proximo_seguimiento ?? '');
  const [nota, setNota] = useState(op.seguimiento_nota ?? '');
  const [hecho, setHecho] = useState(false);

  const guardada = { proximo_seguimiento: op.proximo_seguimiento ?? null, seguimiento_nota: op.seguimiento_nota ?? null };
  const hayGuardado = Boolean(guardada.proximo_seguimiento);
  const conSeguimiento = ETAPAS_CON_SEGUIMIENTO.includes(op.etapa);
  const urgencia = urgenciaDeOportunidad(op, hoy);
  const escrito = normalizar(fecha, nota);
  const cambios = escrito.proximo_seguimiento !== guardada.proximo_seguimiento || escrito.seguimiento_nota !== guardada.seguimiento_nota;
  const fechaInvalida = escrito.proximo_seguimiento !== null && !esFechaValida(escrito.proximo_seguimiento);
  const notaSinFecha = escrito.proximo_seguimiento === null && escrito.seguimiento_nota !== null;
  const puedeGuardar = (cambios || hecho) && !fechaInvalida && !notaSinFecha && !guardar.isPending;
  const motivo = op.etapa === 'perdida' && op.motivo_perdida ? op.motivo_perdida : null;
  const cerrarYAbrir = (fn, valor) => {
    onCerrar();
    fn?.(valor);
  };

  const enviar = (datos) => {
    guardar.mutate(
      { id: op.id, ...datos },
      {
        onSuccess: () => {
          setFecha(datos.proximo_seguimiento ?? '');
          setNota(datos.seguimiento_nota ?? '');
          setHecho(false);
        }
      }
    );
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (puedeGuardar) enviar(escrito);
  };

  const marcarHecho = () => {
    setFecha('');
    setNota('');
    setHecho(true);
    primerAtajo.current?.focus();
  };

  return (
    <>
      <Dialogo titulo={op.titulo} onCerrar={onCerrar} ancho='max-w-xl'>
        <div className='space-y-5'>
          <div className='-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300'>
            {op.empresa_nombre && (
              op.empresa_id != null ? (
                <button type='button' className={enlace} title={`Abrir ficha de ${op.empresa_nombre}`} onClick={() => cerrarYAbrir(onAbrirEmpresa, op.empresa_id)}>
                  {op.empresa_nombre}
                </button>
              ) : (
                <span>{op.empresa_nombre}</span>
              )
            )}
            {op.contacto_nombre && <span>{op.contacto_nombre}</span>}
            {op.es_proyecto && <span className={chip} title='Proyecto / BID'>Proyecto / BID</span>}
            {op.bo && <span className={chip} title={`Orden ${op.bo}`}>{/^bo/i.test(String(op.bo)) ? op.bo : `BO ${op.bo}`}</span>}
          </div>

          <dl className='grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3'>
            <Dato etiqueta='Monto'>{usd(op.monto)}</Dato>
            <Dato etiqueta='Marca'>{op.marca || '—'}</Dato>
            <Dato etiqueta='En la etapa'>{op.dias_en_etapa == null ? '—' : diasTexto(op.dias_en_etapa)}</Dato>
            {op.fecha_cierre_estimada && <Dato etiqueta='Cierre estimado'>{fechaCL(op.fecha_cierre_estimada)}</Dato>}
            <Dato etiqueta='Etapa'>
              <select
                className={`${claseInput} !h-8 !w-auto !py-0`}
                aria-label={`Etapa de ${op.titulo}`}
                value={op.etapa}
                onChange={(e) => mover(op, e.target.value)}
              >
                {ETAPAS.map((et) => <option key={et.clave} value={et.clave}>{et.nombre}</option>)}
              </select>
            </Dato>
            {motivo && <Dato etiqueta='Motivo de la pérdida'>{motivo}</Dato>}
          </dl>

          <section aria-labelledby='op-seguimiento' className='space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700'>
            <h3 id='op-seguimiento' className='text-sm font-semibold text-slate-900 dark:text-slate-100'>Seguimiento</h3>
            {!conSeguimiento ? (
              <p className='text-sm text-slate-500 dark:text-slate-400'>Una oportunidad cerrada no lleva seguimiento.</p>
            ) : (
              <form onSubmit={onSubmit} className='space-y-3'>
                <div className='text-sm'>
                  <p className='flex flex-wrap items-center gap-2 text-slate-900 dark:text-slate-100'>
                    <span className={`mq-punto mq-punto-${TONO_URGENCIA[urgencia]}`} aria-hidden='true' />
                    <span className='font-medium'>{textoSeguimiento(guardada.proximo_seguimiento, hoy)}</span>
                    {/* "Vencido hace 3 días" o "Mañana" no dicen el día; "26-nov" ya lo dice. */}
                    {hayGuardado && urgencia !== 'futuro' && (
                      <span className='text-slate-500 dark:text-slate-400'>{fechaCL(guardada.proximo_seguimiento)}</span>
                    )}
                  </p>
                  {guardada.seguimiento_nota && (
                    <p className='mt-1 whitespace-pre-line text-slate-600 dark:text-slate-300'>Nota: {guardada.seguimiento_nota}</p>
                  )}
                </div>

                <div className='flex flex-wrap gap-1.5' role='group' aria-label='Atajos de fecha'>
                  {ATAJOS_SEGUIMIENTO.map((a, i) => (
                    <button
                      key={a.clave}
                      ref={i === 0 ? primerAtajo : undefined}
                      type='button'
                      className='mq-btn mq-btn-sm mq-btn-secundario'
                      disabled={guardar.isPending}
                      onClick={() => setFecha(fechaDeAtajo(a.clave, hoy) || '')}
                    >
                      {a.nombre}
                    </button>
                  ))}
                </div>

                <div className='grid gap-3 sm:grid-cols-[auto_1fr]'>
                  <input
                    type='date'
                    className={`${claseInput} !w-auto self-start`}
                    aria-label='Fecha del próximo seguimiento'
                    value={fecha}
                    disabled={guardar.isPending}
                    onChange={(e) => setFecha(e.target.value)}
                  />
                  <div>
                    <textarea
                      className={claseInput}
                      rows={2}
                      aria-label='Nota del seguimiento'
                      maxLength={LARGO_NOTA_SEGUIMIENTO}
                      placeholder='Qué hay que hacer: llamar a Ana por el descuento'
                      value={nota}
                      disabled={guardar.isPending}
                      onChange={(e) => setNota(e.target.value)}
                    />
                    <p className='mt-0.5 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400'>
                      {nota.length}/{LARGO_NOTA_SEGUIMIENTO}
                    </p>
                  </div>
                </div>

                {hecho && !fecha && (
                  <p className='text-sm text-slate-600 dark:text-slate-300'>
                    Elige cuándo es el próximo seguimiento, o guarda sin fecha para dejarla sin seguimiento.
                  </p>
                )}
                {notaSinFecha && <p role='alert' className='text-sm text-rose-700 dark:text-rose-300'>Pon una fecha para guardar la nota</p>}
                {fechaInvalida && <p role='alert' className='text-sm text-rose-700 dark:text-rose-300'>La fecha no es válida</p>}

                <div className='flex flex-wrap items-center gap-2'>
                  <button type='submit' className='mq-btn mq-btn-sm mq-btn-primario' disabled={!puedeGuardar}>
                    Guardar seguimiento
                  </button>
                  {hayGuardado && (
                    <>
                      <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' disabled={guardar.isPending} onClick={marcarHecho}>
                        Hecho
                      </button>
                      <button
                        type='button'
                        className='mq-btn mq-btn-sm mq-btn-secundario'
                        disabled={guardar.isPending}
                        onClick={() => enviar({ proximo_seguimiento: null, seguimiento_nota: null })}
                      >
                        Quitar seguimiento
                      </button>
                    </>
                  )}
                </div>
              </form>
            )}
          </section>

          <section aria-labelledby='op-cotizaciones' className='space-y-2'>
            <h3 id='op-cotizaciones' className='text-sm font-semibold text-slate-900 dark:text-slate-100'>Cotizaciones</h3>
            {cotizaciones.length === 0 ? (
              <p className='text-sm text-slate-500 dark:text-slate-400'>Sin cotizaciones vinculadas.</p>
            ) : (
              <ul className='divide-y divide-slate-200 text-sm dark:divide-slate-700'>
                {cotizaciones.map((cot, i) => (
                  <li key={cot.id} className='flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5'>
                    <button
                      type='button'
                      className={`${enlace} font-semibold tabular-nums`}
                      aria-label={`Abrir cotización ${cot.numero}`}
                      onClick={() => cerrarYAbrir(onAbrirCotizacion, cot.id)}
                    >
                      #{cot.numero}
                    </button>
                    {Number(cot.version) > 1 && <span className='font-mono text-xs text-slate-500 dark:text-slate-400'>v{Number(cot.version)}</span>}
                    {i === 0 && cotizaciones.length > 1 && <span className={`${chip} !border-blue-500 !text-blue-700 dark:!text-blue-300`}>vigente</span>}
                    <span className='text-slate-500 dark:text-slate-400'>{fechaCL(cot.created_at)}</span>
                    <span className='ml-auto tabular-nums text-slate-900 dark:text-slate-100'>{usd(cot.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Dialogo>
      {dialogoPerdida}
    </>
  );
}

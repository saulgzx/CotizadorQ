import React, { useEffect, useId, useRef, useState } from 'react';
import { cotizacionesAPI } from '../../../api';
import { formatCurrency } from '../cotizadorHelpers';
import { diffVersiones, etiquetaLinea } from './versionDiff';
import '../../crm/cotizaciones.css';

const fechaHora = (valor) => {
  if (!valor) return '';
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const dinero = (v) => (v === null || v === undefined ? '—' : formatCurrency(Number(v) || 0));
const conSigno = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCurrency(Math.abs(n))}`;

const Grupo = ({ titulo, children }) => (
  <div>
    <div className='mq-sobre'>{titulo}</div>
    <ul className='mt-0.5 space-y-0.5'>{children}</ul>
  </div>
);

/** Resumen "qué cambió" de una versión respecto de la anterior. */
export function QueCambio({ diff, versionAnterior }) {
  if (!diff) return null;
  return (
    <section className='mq-versiones-cambios' aria-label={`Qué cambió respecto de v${versionAnterior}`}>
      <div className='flex items-baseline justify-between gap-2'>
        <h4 className='text-xs font-semibold text-slate-700 dark:text-slate-200'>Qué cambió respecto de v{versionAnterior}</h4>
        <span className='text-xs tabular-nums text-slate-600 dark:text-slate-300'>
          Total {conSigno(diff.total.diferencia)}
        </span>
      </div>
      {diff.sinCambios ? (
        <p className='text-xs text-slate-500'>Sin diferencias en líneas, precios ni datos del cliente.</p>
      ) : (
        <div className='mt-1 space-y-1.5 text-xs text-slate-600 dark:text-slate-300'>
          {diff.agregadas.length > 0 && (
            <Grupo titulo='Líneas agregadas'>
              {diff.agregadas.map((l, i) => (
                <li key={`a${i}`}>+ {l.cantidad}× {l.etiqueta} · {dinero(l.precio_unitario)} c/u</li>
              ))}
            </Grupo>
          )}
          {diff.quitadas.length > 0 && (
            <Grupo titulo='Líneas quitadas'>
              {diff.quitadas.map((l, i) => (
                <li key={`q${i}`}>− {l.cantidad}× {l.etiqueta}</li>
              ))}
            </Grupo>
          )}
          {diff.cantidad.length > 0 && (
            <Grupo titulo='Cantidad'>
              {diff.cantidad.map((c, i) => <li key={`c${i}`}>{c.etiqueta}: {c.antes} → {c.despues}</li>)}
            </Grupo>
          )}
          {diff.precio.length > 0 && (
            <Grupo titulo='Precio unitario'>
              {diff.precio.map((c, i) => <li key={`p${i}`}>{c.etiqueta}: {dinero(c.antes)} → {dinero(c.despues)}</li>)}
            </Grupo>
          )}
          {diff.costo.length > 0 && (
            <Grupo titulo='Costo unitario'>
              {diff.costo.map((c, i) => <li key={`k${i}`}>{c.etiqueta}: {dinero(c.antes)} → {dinero(c.despues)}</li>)}
            </Grupo>
          )}
          {diff.cliente.length > 0 && (
            <Grupo titulo='Datos del cliente'>
              {diff.cliente.map((c) => (
                <li key={c.campo}>{c.etiqueta}: {c.antes || '—'} → {c.despues || '—'}</li>
              ))}
            </Grupo>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Historial de versiones v1…vN de una cotización. Con `onCargar` (editor) ofrece
 * cargar una versión en el editor; sin él es de solo lectura.
 */
export default function PanelVersiones({ cotizacionId, versionActual, numero, onCerrar, onCargar, conCosto = true }) {
  const [versiones, setVersiones] = useState(null);
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [detalles, setDetalles] = useState({});
  const [cargando, setCargando] = useState(null);
  const tituloId = useId();
  const cerrarRef = useRef(null);
  const soloLectura = typeof onCargar !== 'function';

  useEffect(() => {
    let vivo = true;
    setVersiones(null);
    setError('');
    cotizacionesAPI
      .getVersiones(cotizacionId)
      .then((data) => {
        if (!vivo) return;
        const lista = Array.isArray(data) ? [...data] : [];
        lista.sort((a, b) => Number(b.version) - Number(a.version));
        setVersiones(lista);
      })
      .catch((e) => vivo && setError(e.message || 'No se pudieron cargar las versiones'));
    return () => {
      vivo = false;
    };
  }, [cotizacionId]);

  const onCerrarRef = useRef(onCerrar);
  onCerrarRef.current = onCerrar;
  useEffect(() => {
    const previo = document.activeElement;
    cerrarRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCerrarRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previo && typeof previo.focus === 'function' && document.contains(previo)) previo.focus();
    };
  }, []);

  const vigente = (v) => Boolean(v.vigente) || Number(v.version) === Number(versionActual);
  const anteriorDe = (version) =>
    (versiones || []).map((v) => Number(v.version)).filter((n) => n < Number(version)).sort((a, b) => b - a)[0] ?? null;

  const traer = async (version) => {
    if (detalles[version]) return detalles[version];
    const data = await cotizacionesAPI.getVersion(cotizacionId, version);
    setDetalles((prev) => ({ ...prev, [version]: data }));
    return data;
  };

  const ver = async (version) => {
    if (abierta === version) {
      setAbierta(null);
      return;
    }
    try {
      setCargando(version);
      setError('');
      const previa = anteriorDe(version);
      await Promise.all([traer(version), previa !== null ? traer(previa) : null]);
      setAbierta(version);
    } catch (e) {
      setError(e.message || 'No se pudo cargar la versión');
    } finally {
      setCargando(null);
    }
  };

  const total = versiones?.length || 0;

  return (
    <div className='fixed inset-0 z-[60] !m-0 flex justify-end bg-slate-950/40 backdrop-blur-[2px]' onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <aside
        role='dialog'
        aria-modal='true'
        aria-labelledby={tituloId}
        className='flex h-full w-full max-w-md flex-col bg-white shadow-float dark:bg-slate-900'
      >
        <div className='flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700'>
          <div>
            <h3 id={tituloId} className='font-semibold text-slate-800 dark:text-slate-100'>
              Versiones{numero ? ` de la cotización ${numero}` : ''}
            </h3>
            <p className='text-xs text-slate-500'>
              {total > 0 ? `v1…v${Math.max(...versiones.map((v) => Number(v.version)))} · ` : ''}
              Vigente: v{versionActual || 1}. Cada nota describe la versión que creó.
              {soloLectura ? ' Solo lectura.' : ''}
            </p>
          </div>
          <button
            ref={cerrarRef}
            type='button'
            onClick={onCerrar}
            className='grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            aria-label='Cerrar versiones'
          >
            ✕
          </button>
        </div>
        <div className='flex-1 overflow-auto p-4'>
          {error && <div role='alert' className='mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'>{error}</div>}
          {versiones === null && !error && <div className='text-sm text-slate-500'>Cargando…</div>}
          {versiones?.length === 0 && <div className='text-sm text-slate-500'>No hay versiones registradas.</div>}
          <ol className='space-y-2'>
            {(versiones || []).map((v) => {
              const n = Number(v.version);
              const detalle = detalles[n];
              const previa = anteriorDe(n);
              const diff = abierta === n && detalle && previa !== null && detalles[previa]
                ? diffVersiones(detalles[previa], detalle, { conCosto })
                : null;
              const esVigente = vigente(v);
              return (
                <li key={n} className={`mq-version ${esVigente ? 'mq-version-vigente' : ''}`}>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='flex items-center gap-2'>
                      <span className='font-mono text-sm font-semibold text-slate-800 dark:text-slate-100'>v{n}</span>
                      {esVigente && <span className='mq-estado'><span className='mq-punto mq-punto-ok' aria-hidden='true' />Vigente</span>}
                    </span>
                    <span className='text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200'>{formatCurrency(Number(v.total) || 0)}</span>
                  </div>
                  <div className='text-xs text-slate-500'>
                    {n === 1 ? 'Creada' : 'Guardada'} el {fechaHora(v.creado_en) || '—'}
                    {v.creado_por ? ` por ${v.creado_por}` : ''}
                  </div>
                  {v.nota
                    ? <div className='mt-1 text-xs italic text-slate-600 dark:text-slate-300'>“{v.nota}”</div>
                    : <div className='mt-1 text-xs text-slate-400'>Sin nota</div>}
                  <button
                    type='button'
                    onClick={() => ver(n)}
                    disabled={cargando !== null}
                    aria-expanded={abierta === n}
                    className='mt-2 mq-btn mq-btn-xs mq-btn-fantasma'
                  >
                    {cargando === n ? 'Cargando…' : abierta === n ? 'Ocultar detalle' : 'Ver detalle'}
                  </button>
                  {abierta === n && detalle && (
                    <div className='mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-700'>
                      {previa === null
                        ? <p className='text-xs text-slate-500'>Versión inicial de la cotización.</p>
                        : <QueCambio diff={diff} versionAnterior={previa} />}
                      <div>
                        <div className='mq-sobre'>Líneas</div>
                        {(detalle.items || []).map((item, i) => (
                          <div key={item.id ?? i} className='flex justify-between gap-2 text-xs text-slate-600 dark:text-slate-300'>
                            <span className='truncate'>{item.cantidad}× {etiquetaLinea(item)}</span>
                            <span className='tabular-nums'>{formatCurrency(Number(item.precio_total) || 0)}</span>
                          </div>
                        ))}
                      </div>
                      {!soloLectura && !esVigente && (
                        <>
                          <button type='button' onClick={() => onCargar(detalle)} className='mt-2 w-full mq-btn mq-btn-sm mq-btn-primario'>
                            Cargar v{n} en el editor
                          </button>
                          <p className='text-xs text-slate-500'>No se guarda hasta que presiones Guardar: queda como una versión nueva.</p>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}

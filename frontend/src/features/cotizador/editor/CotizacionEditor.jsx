import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cotizacionesAPI } from '../../../api';
import { COTIZACION_ESTADOS, DEFAULT_AXIS_PARTNER } from '../cotizadorConstants';
import { formatCurrency } from '../cotizadorHelpers';
import {
  aplicarCambio,
  buscarEnCatalogo,
  cambiosDeLinea,
  gpDe,
  huella,
  lineaAPayload,
  lineaDesdeItem,
  lineaDesdeProducto,
  margenDe,
  MODO_COSTO,
  rebatePartnerDeProducto,
  resumenLineas,
  totalLinea
} from './editorCalc';

// Editor de cotizaciones guardadas. SOLO para el rol admin: muestra costo,
// rebate y margen, que el backend nunca envia a otros roles.

const PARTNERS = ['Partner Autorizado', 'Partner Silver', 'Partner Gold', 'Partner Multiregional'];

const fechaInput = (valor) => (valor ? String(valor).slice(0, 10) : '');

const formDesdeCotizacion = (cot) => ({
  nombre: cot?.cliente_nombre || '',
  empresa: cot?.cliente_empresa || '',
  email: cot?.cliente_email || '',
  telefono: cot?.cliente_telefono || '',
  cliente_final: cot?.cliente_final || '',
  fecha_ejecucion: fechaInput(cot?.fecha_ejecucion),
  fecha_implementacion: fechaInput(cot?.fecha_implementacion),
  vms: cot?.vms || '',
  estado: !cot?.estado || cot.estado === 'pendiente' ? 'revision' : cot.estado
});

const fechaHora = (valor) => {
  if (!valor) return '';
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const pct = (valor) => (valor === null || valor === undefined ? '—' : `${valor.toFixed(1)}%`);

const tonoMargen = (valorPct) => {
  if (valorPct === null || valorPct === undefined) return 'text-slate-400';
  if (valorPct < 0) return 'text-rose-600 dark:text-rose-400';
  if (valorPct < 8) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
};

const inputBase =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

/**
 * Input numerico que no pelea con el cursor: mientras tiene foco guarda el
 * texto tal cual; el valor se comunica en cada cambio valido.
 */
const NumeroInput = ({ value, onCommit, decimales = 2, min = 0, className = '', placeholder, ariaLabel, entero = false }) => {
  const [texto, setTexto] = useState('');
  const [foco, setFoco] = useState(false);
  const mostrar = value === null || value === undefined || value === '' ? '' : String(entero ? value : Number(value).toFixed(decimales));
  return (
    <input
      type='text'
      inputMode='decimal'
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={foco ? texto : mostrar}
      onFocus={(e) => {
        setTexto(mostrar);
        setFoco(true);
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => setFoco(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        setTexto(e.target.value);
        if (raw.trim() === '') return;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= min) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={`${inputBase} w-full text-right tabular-nums ${className}`}
    />
  );
};

const Campo = ({ label, children, className = '' }) => (
  <label className={`flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 ${className}`}>
    {label}
    {children}
  </label>
);

const BuscadorProductos = ({ productos, onAgregar }) => {
  const [texto, setTexto] = useState('');
  const [activo, setActivo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const resultados = useMemo(() => buscarEnCatalogo(productos, texto, 8), [productos, texto]);

  const agregar = (producto) => {
    onAgregar(producto);
    setTexto('');
    setActivo(0);
  };

  return (
    <div className='relative min-w-[260px] flex-[2]'>
      <input
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setActivo(0);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActivo((i) => Math.min(i + 1, resultados.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActivo((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && resultados[activo]) {
            e.preventDefault();
            agregar(resultados[activo]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setAbierto(false);
          }
        }}
        placeholder='Agregar producto: SKU, MPN o descripción…'
        aria-label='Buscar producto para agregar'
        className={`${inputBase} w-full py-2`}
      />
      {abierto && texto.trim() && (
        <div className='absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900'>
          {resultados.length === 0 ? (
            <div className='px-3 py-2 text-sm text-slate-500'>Sin coincidencias en el catálogo.</div>
          ) : (
            resultados.map((p, i) => (
              <button
                key={p.id}
                type='button'
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => agregar(p)}
                onMouseEnter={() => setActivo(i)}
                className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${
                  i === activo ? 'bg-blue-50 dark:bg-slate-800' : ''
                }`}
              >
                <span className='min-w-0'>
                  <span className='block font-mono text-xs text-slate-500'>
                    {p.sku} · {p.mpn}
                  </span>
                  <span className='block truncate text-slate-800 dark:text-slate-100'>{p.desc}</span>
                </span>
                <span className='shrink-0 text-xs text-slate-500'>
                  {p.origen} · disty {formatCurrency(Number(p.precio) || 0)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const PanelVersiones = ({ cotizacionId, versionActual, onCerrar, onCargar }) => {
  const [versiones, setVersiones] = useState(null);
  const [error, setError] = useState('');
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    let vivo = true;
    cotizacionesAPI
      .getVersiones(cotizacionId)
      .then((data) => vivo && setVersiones(Array.isArray(data) ? data : []))
      .catch((e) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [cotizacionId]);

  const ver = async (version) => {
    try {
      setCargando(true);
      setDetalle(await cotizacionesAPI.getVersion(cotizacionId, version));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className='fixed inset-0 z-[60] flex justify-end bg-black/30' onClick={onCerrar}>
      <aside
        className='flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900'
        onClick={(e) => e.stopPropagation()}
        aria-label='Versiones anteriores'
      >
        <div className='flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700'>
          <div>
            <h3 className='font-semibold text-slate-800'>Versiones anteriores</h3>
            <p className='text-xs text-slate-500'>Vigente: v{versionActual}. Cada guardado conserva la versión previa.</p>
          </div>
          <button type='button' onClick={onCerrar} className='rounded px-2 py-1 text-slate-500 hover:bg-slate-100' aria-label='Cerrar'>
            ✕
          </button>
        </div>
        <div className='flex-1 overflow-auto p-4'>
          {error && <div className='mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'>{error}</div>}
          {versiones === null && !error && <div className='text-sm text-slate-500'>Cargando…</div>}
          {versiones?.length === 0 && (
            <div className='text-sm text-slate-500'>Todavía no hay versiones anteriores: esta cotización nunca se editó.</div>
          )}
          <ul className='space-y-2'>
            {(versiones || []).map((v) => (
              <li key={v.version} className='rounded-lg border border-slate-200 p-3 dark:border-slate-700'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-semibold text-slate-800'>v{v.version}</span>
                  <span className='text-sm font-semibold tabular-nums text-slate-700'>{formatCurrency(Number(v.total) || 0)}</span>
                </div>
                <div className='text-xs text-slate-500'>
                  Reemplazada el {fechaHora(v.creado_en)}
                  {v.creado_por ? ` por ${v.creado_por}` : ''}
                </div>
                {v.nota && <div className='mt-1 text-xs italic text-slate-600'>“{v.nota}”</div>}
                <button
                  type='button'
                  onClick={() => ver(v.version)}
                  disabled={cargando}
                  className='mt-2 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50'
                >
                  {cargando ? 'Cargando…' : 'Ver detalle'}
                </button>
                {detalle?.version === v.version && (
                  <div className='mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-700'>
                    {(detalle.items || []).map((item) => (
                      <div key={item.id} className='flex justify-between gap-2 text-xs text-slate-600'>
                        <span className='truncate'>
                          {item.cantidad}× {item.sku || item.mpn}
                        </span>
                        <span className='tabular-nums'>{formatCurrency(Number(item.precio_total) || 0)}</span>
                      </div>
                    ))}
                    <button
                      type='button'
                      onClick={() => onCargar(detalle)}
                      className='mt-2 w-full rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700'
                    >
                      Cargar v{v.version} en el editor
                    </button>
                    <p className='text-[11px] text-slate-500'>No se guarda hasta que presiones Guardar: queda como una versión nueva.</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
};

const CeldaCosto = ({ linea, onCambio, productoCatalogo }) => {
  const esAxis = linea.origen === 'AXIS';
  const sinDisty = !(Number(linea.precio_disty) > 0);
  return (
    <div className='flex w-40 flex-col gap-1'>
      {sinDisty && !linea.nueva ? (
        <>
          <span className='text-[10px] uppercase text-slate-400'>Costo final</span>
          <NumeroInput
            value={linea.costo_unitario}
            onCommit={(v) => onCambio('costo_unitario', v)}
            placeholder='sin costo'
            ariaLabel='Costo final unitario'
          />
          {linea.costo_unitario === null && <span className='text-[10px] text-amber-600'>Sin costo guardado</span>}
        </>
      ) : (
        <>
          <span className='text-[10px] uppercase text-slate-400'>Disty USD</span>
          <NumeroInput value={linea.precio_disty} onCommit={(v) => onCambio('precio_disty', v)} ariaLabel='Costo disty' />
          {esAxis && (
            <>
              <span className='mt-1 flex items-center justify-between text-[10px] uppercase text-slate-400'>
                Rebate partner
                {linea.rebate_inferido && (
                  <span className='rounded bg-amber-100 px-1 normal-case text-amber-700' title='No se guardó al crear: se dedujo del costo'>
                    inferido
                  </span>
                )}
              </span>
              {productoCatalogo && (
                <select
                  value={linea.partner_category || ''}
                  onChange={(e) => onCambio('partner_category', e.target.value)}
                  className={`${inputBase} w-full text-xs`}
                  aria-label='Categoría de partner'
                >
                  <option value=''>Manual</option>
                  {PARTNERS.map((p) => (
                    <option key={p} value={p}>
                      {p.replace('Partner ', '')}
                    </option>
                  ))}
                </select>
              )}
              <NumeroInput value={linea.rebate_partner} onCommit={(v) => onCambio('rebate_partner', v)} ariaLabel='Rebate partner' />
              <span className='mt-1 text-[10px] uppercase text-slate-400'>Rebate proyecto</span>
              <NumeroInput value={linea.rebate_proyecto} onCommit={(v) => onCambio('rebate_proyecto', v)} ariaLabel='Rebate proyecto' />
            </>
          )}
          <span className='text-right text-[11px] text-slate-500'>
            Final <span className='font-semibold tabular-nums text-slate-700'>{formatCurrency(linea.costo_unitario || 0)}</span>
          </span>
        </>
      )}
    </div>
  );
};

const CotizacionEditor = ({ cotizacionId, productos = [], getStockText, onClose, onSaved, onExportPdf }) => {
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [cot, setCot] = useState(null);
  const [form, setForm] = useState(formDesdeCotizacion(null));
  const [lineas, setLineas] = useState([]);
  const [huellaGuardada, setHuellaGuardada] = useState('');
  const [modoCosto, setModoCosto] = useState(MODO_COSTO.MANTENER_PRECIO);
  const [gpMasivo, setGpMasivo] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [conflicto, setConflicto] = useState(false);
  const [aviso, setAviso] = useState('');
  const [verVersiones, setVerVersiones] = useState(false);
  const totalOriginal = useRef(0);
  const mainRef = useRef(null);

  const productoPorId = useMemo(() => new Map(productos.map((p) => [Number(p.id), p])), [productos]);

  const cargar = useCallback(async () => {
    try {
      setCargando(true);
      setErrorCarga('');
      setConflicto(false);
      const data = await cotizacionesAPI.getOne(cotizacionId);
      const nuevasLineas = (data.items || []).map(lineaDesdeItem);
      const nuevoForm = formDesdeCotizacion(data);
      setCot(data);
      setForm(nuevoForm);
      setLineas(nuevasLineas);
      setHuellaGuardada(huella(nuevoForm, nuevasLineas));
      totalOriginal.current = Number(data.total) || 0;
      setNota('');
    } catch (e) {
      setErrorCarga(e.message || 'No se pudo cargar la cotización');
    } finally {
      setCargando(false);
    }
  }, [cotizacionId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const sucio = !cargando && cot && huella(form, lineas) !== huellaGuardada;
  const resumen = useMemo(() => resumenLineas(lineas), [lineas]);

  const cerrar = useCallback(() => {
    if (sucio && !window.confirm('Hay cambios sin guardar. ¿Descartarlos y cerrar?')) return;
    onClose();
  }, [sucio, onClose]);

  const cambiarLinea = (key, campo, valor) => {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        if (campo === 'partner_category') {
          const producto = productoPorId.get(Number(l.producto_id));
          const conCategoria = { ...l, partner_category: valor || null };
          if (!valor || !producto) return conCategoria;
          return aplicarCambio(conCategoria, 'rebate_partner', rebatePartnerDeProducto(producto, valor), modoCosto);
        }
        return aplicarCambio(l, campo, valor, modoCosto);
      })
    );
  };

  const mover = (indice, delta) => {
    setLineas((prev) => {
      const destino = indice + delta;
      if (destino < 0 || destino >= prev.length) return prev;
      const next = [...prev];
      [next[indice], next[destino]] = [next[destino], next[indice]];
      return next;
    });
  };

  const agregarProducto = (producto) => {
    const existente = lineas.find((l) => l.producto_id && Number(l.producto_id) === Number(producto.id));
    if (existente) {
      cambiarLinea(existente.key, 'cantidad', existente.cantidad + 1);
      setAviso(`${producto.sku || producto.mpn} ya estaba: se sumó 1 unidad.`);
      return;
    }
    const gpBase = lineas.map(gpDe).find((g) => g !== null);
    const linea = lineaDesdeProducto(producto, {
      gpPct: gpBase ?? 15,
      partnerCategory: lineas.find((l) => l.partner_category)?.partner_category || DEFAULT_AXIS_PARTNER,
      tiempoEntrega: getStockText?.(producto.mpn) || producto.tiempo
    });
    setLineas((prev) => [...prev, linea]);
    setAviso('');
  };

  const aplicarGpATodas = () => {
    const valor = Number(String(gpMasivo).replace(',', '.'));
    if (!Number.isFinite(valor) || valor >= 100) return;
    const sinCosto = lineas.filter((l) => l.costo_unitario === null).length;
    setLineas((prev) => prev.map((l) => aplicarCambio(l, 'gp', valor)));
    setAviso(sinCosto ? `GP ${valor}% aplicado. ${sinCosto} línea(s) sin costo no cambiaron.` : `GP ${valor}% aplicado a todas las líneas.`);
  };

  const actualizarCostosCatalogo = () => {
    let cambiadas = 0;
    let sinProducto = 0;
    // Se calcula sobre el estado actual y no dentro del updater: React aplica
    // el updater despues, y los contadores llegarian en cero al aviso.
    const next = lineas.map((l) => {
      const producto = productoPorId.get(Number(l.producto_id));
      if (!producto) {
        sinProducto += 1;
        return l;
      }
      let actualizada = aplicarCambio(l, 'precio_disty', Number(producto.precio) || 0, modoCosto);
      if (l.origen === 'AXIS' && l.partner_category) {
        actualizada = aplicarCambio(actualizada, 'rebate_partner', rebatePartnerDeProducto(producto, l.partner_category), modoCosto);
      }
      if (actualizada.costo_unitario !== l.costo_unitario) cambiadas += 1;
      return actualizada;
    });
    setLineas(next);
    setAviso(
      `Costos del catálogo: ${cambiadas} línea(s) cambiaron` +
        (sinProducto ? `, ${sinProducto} sin producto en el catálogo` : '') +
        (modoCosto === MODO_COSTO.MANTENER_PRECIO ? '. Se mantuvo el precio.' : '. Se mantuvo el margen.')
    );
  };

  const guardar = async ({ conPdf = false } = {}) => {
    if (lineas.length === 0) {
      setError('La cotización debe tener al menos una línea.');
      return;
    }
    if (resumen.negativas > 0 && !window.confirm(`${resumen.negativas} línea(s) quedan con margen negativo. ¿Guardar igual?`)) {
      return;
    }
    try {
      setGuardando(true);
      setError('');
      const { estado, ...cliente } = form;
      const actualizada = await cotizacionesAPI.update(cotizacionId, {
        expected_version: cot?.version || undefined,
        estado,
        nota: nota.trim() || undefined,
        cliente,
        items: lineas.map((l, i) => lineaAPayload(l, i))
      });
      const combinada = { ...cot, ...actualizada };
      onSaved?.(combinada);
      if (conPdf) await onExportPdf?.(combinada);
      onClose();
    } catch (e) {
      if (e.status === 409) {
        setConflicto(true);
        mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        mainRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      setError(e.message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!guardando && sucio) guardar();
      } else if (e.key === 'Escape' && !verVersiones) {
        cerrar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // La pagina de fondo no se desplaza mientras el editor esta abierto.
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  const cargarVersion = (detalle) => {
    const actuales = new Map(lineas.filter((l) => l.original && l.producto_id).map((l) => [Number(l.producto_id), l.original]));
    const restauradas = (detalle.items || []).map((item) => {
      const linea = lineaDesdeItem({ ...item, id: null });
      const original = actuales.get(Number(item.producto_id));
      return original ? { ...linea, nueva: false, original } : { ...linea, nueva: true, original: null };
    });
    if (detalle.cotizacion) {
      setForm((prev) => ({ ...formDesdeCotizacion(detalle.cotizacion), estado: prev.estado }));
    }
    setLineas(restauradas);
    setNota(`Restaurada desde v${detalle.version}`);
    setVerVersiones(false);
    setAviso(`Se cargó la v${detalle.version}. Revisa y guarda para dejarla vigente.`);
  };

  const campoForm = (clave) => ({
    value: form[clave],
    onChange: (e) => setForm((f) => ({ ...f, [clave]: e.target.value })),
    className: `${inputBase} w-full`
  });

  const deltaVenta = resumen.venta - totalOriginal.current;

  return (
    <div className='fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-950' role='dialog' aria-modal='true' aria-label='Editor de cotización'>
      {/* Barra superior */}
      <header className='flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900'>
        <button type='button' onClick={cerrar} className='rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100' aria-label='Cerrar editor'>
          ←
        </button>
        <div className='min-w-[180px] flex-1'>
          <h2 className='truncate text-lg font-semibold text-slate-800'>
            Editar cotización {cot?.numero ? `N° ${cot.numero}` : cot ? `#${cot.id}` : ''}
          </h2>
          {cot && (
            <p className='hidden text-xs text-slate-500 sm:block'>
              Creada {fechaHora(cot.created_at)}
              {cot.usuario ? ` por ${cot.usuario}` : ''} · v{cot.version || 1}
              {cot.updated_at ? ` · última edición ${fechaHora(cot.updated_at)}${cot.updated_by ? ` (${cot.updated_by})` : ''}` : ''}
            </p>
          )}
        </div>
        {cot && (
          <>
            <select
              value={form.estado}
              onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}
              className={`${inputBase} py-1.5`}
              aria-label='Estado'
            >
              {COTIZACION_ESTADOS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type='button'
              onClick={() => setVerVersiones(true)}
              className='rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600'
            >
              Versiones
            </button>
          </>
        )}
      </header>

      {cargando ? (
        <div className='flex flex-1 items-center justify-center text-slate-500'>Cargando cotización…</div>
      ) : errorCarga ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-3 text-rose-600'>
          {errorCarga}
          <button type='button' onClick={cargar} className='rounded bg-slate-800 px-3 py-1.5 text-sm text-white'>
            Reintentar
          </button>
        </div>
      ) : (
        <div className='flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden'>
          <main ref={mainRef} className='min-w-0 flex-1 space-y-4 p-4 lg:overflow-auto'>
            {conflicto && (
              <div className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200'>
                <span>Otra sesión guardó esta cotización mientras la editabas. Tus cambios no se guardaron.</span>
                <button type='button' onClick={cargar} className='rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700'>
                  Recargar la versión vigente
                </button>
              </div>
            )}

            {/* Datos del cliente */}
            <section className='rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'>
              <h3 className='mb-3 text-sm font-semibold text-slate-700'>Cliente y proyecto</h3>
              <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
                <Campo label='Nombre'>
                  <input {...campoForm('nombre')} />
                </Campo>
                <Campo label='Empresa'>
                  <input {...campoForm('empresa')} />
                </Campo>
                <Campo label='PID'>
                  <input {...campoForm('email')} />
                </Campo>
                <Campo label='Proyecto'>
                  <input {...campoForm('telefono')} />
                </Campo>
                <Campo label='Cliente final'>
                  <input {...campoForm('cliente_final')} />
                </Campo>
                <Campo label='VMS'>
                  <input {...campoForm('vms')} />
                </Campo>
                <Campo label='Fecha ejecución'>
                  <input type='date' {...campoForm('fecha_ejecucion')} />
                </Campo>
                <Campo label='Fecha implementación'>
                  <input type='date' {...campoForm('fecha_implementacion')} />
                </Campo>
              </div>
            </section>

            {/* Lineas */}
            <section className='rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'>
              <div className='flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-700'>
                <BuscadorProductos productos={productos} onAgregar={agregarProducto} />
                <div className='flex items-end gap-1'>
                  <Campo label='GP a todas'>
                    <input
                      value={gpMasivo}
                      onChange={(e) => setGpMasivo(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && aplicarGpATodas()}
                      placeholder='%'
                      inputMode='decimal'
                      className={`${inputBase} w-20 py-2 text-right`}
                    />
                  </Campo>
                  <button
                    type='button'
                    onClick={aplicarGpATodas}
                    className='rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600'
                  >
                    Aplicar
                  </button>
                </div>
                <Campo label='Si cambia el costo'>
                  <div className='flex overflow-hidden rounded-md border border-slate-200 text-sm dark:border-slate-600'>
                    {[
                      [MODO_COSTO.MANTENER_PRECIO, 'Mantener precio'],
                      [MODO_COSTO.MANTENER_MARGEN, 'Mantener margen']
                    ].map(([valor, etiqueta]) => (
                      <button
                        key={valor}
                        type='button'
                        onClick={() => setModoCosto(valor)}
                        aria-pressed={modoCosto === valor}
                        className={`px-3 py-2 normal-case tracking-normal ${
                          modoCosto === valor ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {etiqueta}
                      </button>
                    ))}
                  </div>
                </Campo>
                <button
                  type='button'
                  onClick={actualizarCostosCatalogo}
                  className='rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600'
                  title='Trae el costo disty (y el rebate de la categoría de partner) vigente del catálogo'
                >
                  Actualizar costos del catálogo
                </button>
              </div>
              {aviso && (
                <div className='flex items-center justify-between border-b border-slate-100 bg-blue-50 px-4 py-2 text-xs text-blue-800 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-200'>
                  {aviso}
                  <button type='button' onClick={() => setAviso('')} aria-label='Ocultar aviso'>
                    ✕
                  </button>
                </div>
              )}

              <div className='overflow-x-auto'>
                <table className='w-full min-w-[1100px] text-sm'>
                  <thead className='bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800'>
                    <tr>
                      <th className='w-10 px-2 py-2' />
                      <th className='px-2 py-2 text-left'>Producto</th>
                      <th className='w-20 px-2 py-2 text-right'>Cant.</th>
                      <th className='px-2 py-2 text-left'>Costo</th>
                      <th className='w-24 px-2 py-2 text-right'>GP %</th>
                      <th className='w-32 px-2 py-2 text-right'>P. unitario</th>
                      <th className='w-28 px-2 py-2 text-right'>Total</th>
                      <th className='w-28 px-2 py-2 text-right'>Margen</th>
                      <th className='w-44 px-2 py-2 text-left'>Entrega</th>
                      <th className='w-10 px-2 py-2' />
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-slate-100 dark:divide-slate-800'>
                    {lineas.length === 0 && (
                      <tr>
                        <td colSpan={10} className='px-4 py-8 text-center text-slate-500'>
                          Sin líneas. Agrega productos con el buscador.
                        </td>
                      </tr>
                    )}
                    {lineas.map((l, i) => {
                      const cambios = cambiosDeLinea(l);
                      const cambio = (campo) => cambios.campos.includes(campo);
                      const margen = margenDe(l);
                      const gp = gpDe(l);
                      const marcado = 'bg-amber-50 dark:bg-amber-900/20';
                      return (
                        <tr key={l.key} className={`align-top ${cambios.nueva ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}>
                          <td className='px-2 py-2'>
                            <div className='flex flex-col items-center text-slate-400'>
                              <button type='button' onClick={() => mover(i, -1)} disabled={i === 0} className='px-1 disabled:opacity-30' aria-label='Subir línea'>
                                ▲
                              </button>
                              <span className='text-[10px]'>{i + 1}</span>
                              <button
                                type='button'
                                onClick={() => mover(i, 1)}
                                disabled={i === lineas.length - 1}
                                className='px-1 disabled:opacity-30'
                                aria-label='Bajar línea'
                              >
                                ▼
                              </button>
                            </div>
                          </td>
                          <td className='min-w-[260px] px-2 py-2'>
                            <div className='mb-1 flex flex-wrap items-center gap-1.5'>
                              <span className='font-mono text-xs text-slate-600'>{l.sku || '—'}</span>
                              <span className='font-mono text-xs text-slate-400'>{l.mpn}</span>
                              <span
                                className={`rounded px-1.5 text-[10px] font-semibold ${
                                  l.origen === 'AXIS' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                                }`}
                              >
                                {l.origen}
                              </span>
                              {cambios.nueva && <span className='rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800'>nueva</span>}
                            </div>
                            <textarea
                              value={l.descripcion}
                              onChange={(e) => cambiarLinea(l.key, 'descripcion', e.target.value)}
                              rows={2}
                              aria-label='Descripción'
                              className={`${inputBase} w-full resize-y text-xs ${cambio('descripcion') ? marcado : ''}`}
                            />
                          </td>
                          <td className='px-2 py-2'>
                            <NumeroInput
                              entero
                              min={1}
                              value={l.cantidad}
                              onCommit={(v) => cambiarLinea(l.key, 'cantidad', v)}
                              ariaLabel='Cantidad'
                              className={cambio('cantidad') ? marcado : ''}
                            />
                            {cambio('cantidad') && <div className='mt-1 text-right text-[10px] text-slate-400 line-through'>{l.original.cantidad}</div>}
                          </td>
                          <td className={`px-2 py-2 ${cambio('costo_unitario') ? marcado : ''}`}>
                            <CeldaCosto
                              linea={l}
                              productoCatalogo={productoPorId.get(Number(l.producto_id))}
                              onCambio={(campo, valor) => cambiarLinea(l.key, campo, valor)}
                            />
                          </td>
                          <td className='px-2 py-2'>
                            {gp === null ? (
                              <div className='py-1 text-right text-xs text-slate-400' title='Sin costo no hay GP'>
                                —
                              </div>
                            ) : (
                              <NumeroInput value={gp} decimales={1} min={-999} onCommit={(v) => cambiarLinea(l.key, 'gp', v)} ariaLabel='GP %' />
                            )}
                          </td>
                          <td className='px-2 py-2'>
                            <NumeroInput
                              value={l.precio_unitario}
                              onCommit={(v) => cambiarLinea(l.key, 'precio_unitario', v)}
                              ariaLabel='Precio unitario'
                              className={cambio('precio_unitario') ? marcado : ''}
                            />
                            {cambio('precio_unitario') && (
                              <div className='mt-1 text-right text-[10px] text-slate-400 line-through'>{formatCurrency(l.original.precio_unitario)}</div>
                            )}
                          </td>
                          <td className='px-2 py-2 text-right font-semibold tabular-nums text-slate-800'>{formatCurrency(totalLinea(l))}</td>
                          <td className='px-2 py-2 text-right tabular-nums'>
                            <div className={`font-semibold ${tonoMargen(margen.pct)}`}>{margen.total === null ? '—' : formatCurrency(margen.total)}</div>
                            <div className={`text-xs ${tonoMargen(margen.pct)}`}>{pct(margen.pct)}</div>
                          </td>
                          <td className='px-2 py-2'>
                            <textarea
                              value={l.tiempo_entrega}
                              onChange={(e) => cambiarLinea(l.key, 'tiempo_entrega', e.target.value)}
                              rows={2}
                              aria-label='Tiempo de entrega'
                              className={`${inputBase} w-full resize-y text-xs ${cambio('tiempo_entrega') ? marcado : ''}`}
                            />
                          </td>
                          <td className='px-2 py-2 text-center'>
                            <button
                              type='button'
                              onClick={() => setLineas((prev) => prev.filter((x) => x.key !== l.key))}
                              className='rounded px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                              aria-label={`Quitar ${l.sku || l.mpn}`}
                              title='Quitar línea'
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </main>

          {/* Resumen */}
          <aside className='border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 lg:w-80 lg:shrink-0 lg:overflow-auto lg:border-l lg:border-t-0'>
            <div className='space-y-4 lg:sticky lg:top-0'>
              <div>
                <div className='text-[11px] uppercase tracking-wide text-slate-500'>Total venta</div>
                <div className='text-3xl font-bold tabular-nums text-slate-900'>{formatCurrency(resumen.venta)}</div>
                {sucio && Math.abs(deltaVenta) >= 0.01 && (
                  <div className='text-xs text-slate-500'>
                    Antes {formatCurrency(totalOriginal.current)} ·{' '}
                    <span className={deltaVenta > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {deltaVenta > 0 ? '+' : ''}
                      {formatCurrency(deltaVenta)}
                    </span>
                  </div>
                )}
              </div>
              <dl className='grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800'>
                <div>
                  <dt className='text-[11px] uppercase text-slate-500'>Costo</dt>
                  <dd className='font-semibold tabular-nums text-slate-800'>{formatCurrency(resumen.costo)}</dd>
                </div>
                <div>
                  <dt className='text-[11px] uppercase text-slate-500'>Margen</dt>
                  <dd className={`font-semibold tabular-nums ${tonoMargen(resumen.margen_pct)}`}>
                    {formatCurrency(resumen.margen)} <span className='text-xs'>({pct(resumen.margen_pct)})</span>
                  </dd>
                </div>
                <div>
                  <dt className='text-[11px] uppercase text-slate-500'>Líneas</dt>
                  <dd className='font-semibold text-slate-800'>{lineas.length}</dd>
                </div>
                <div>
                  <dt className='text-[11px] uppercase text-slate-500'>Unidades</dt>
                  <dd className='font-semibold text-slate-800'>{lineas.reduce((s, l) => s + l.cantidad, 0)}</dd>
                </div>
              </dl>
              {(resumen.sin_costo > 0 || resumen.negativas > 0) && (
                <ul className='space-y-1 text-xs'>
                  {resumen.sin_costo > 0 && (
                    <li className='rounded bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'>
                      {resumen.sin_costo} línea(s) sin costo: no cuentan en el margen.
                    </li>
                  )}
                  {resumen.negativas > 0 && (
                    <li className='rounded bg-rose-50 px-2 py-1 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'>{resumen.negativas} línea(s) con margen negativo.</li>
                  )}
                </ul>
              )}
              <p className='text-[11px] text-slate-400'>Costo y margen solo se ven con tu cuenta admin; el PDF y el cliente ven precios.</p>

              <Campo label='Qué cambió (queda en el historial)'>
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder='Ej: cliente pidió 3 unidades y 5% de descuento'
                  className={`${inputBase} w-full normal-case tracking-normal`}
                />
              </Campo>

              {error && <div className='rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'>{error}</div>}

              <div className='flex flex-col gap-2'>
                <button
                  type='button'
                  onClick={() => guardar()}
                  disabled={guardando || !sucio}
                  className='rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  {guardando ? 'Guardando…' : sucio ? 'Guardar cambios' : 'Sin cambios'}
                </button>
                <button
                  type='button'
                  onClick={() => guardar({ conPdf: true })}
                  disabled={guardando || !sucio}
                  className='rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  Guardar y descargar PDF
                </button>
                <button
                  type='button'
                  onClick={cerrar}
                  className='rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100'
                >
                  {sucio ? 'Descartar cambios' : 'Cerrar'}
                </button>
                <p className='text-center text-[11px] text-slate-400'>Ctrl+S guarda · Esc cierra</p>
              </div>
            </div>
          </aside>
        </div>
      )}

      {!cargando && cot && (
        <div className='flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900 lg:hidden'>
          <div>
            <div className='text-lg font-bold tabular-nums text-slate-900'>{formatCurrency(resumen.venta)}</div>
            <div className={`text-xs ${tonoMargen(resumen.margen_pct)}`}>Margen {pct(resumen.margen_pct)}</div>
          </div>
          <button
            type='button'
            onClick={() => guardar()}
            disabled={guardando || !sucio}
            className='rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50'
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}

      {verVersiones && cot && (
        <PanelVersiones
          cotizacionId={cotizacionId}
          versionActual={cot.version || 1}
          onCerrar={() => setVerVersiones(false)}
          onCargar={cargarVersion}
        />
      )}
    </div>
  );
};

export default CotizacionEditor;

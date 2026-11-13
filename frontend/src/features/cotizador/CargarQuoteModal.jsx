import React, { useEffect, useId, useRef, useState } from 'react';
import {
  TIPO_PDF,
  TIPOS_IMAGEN,
  TAMANO_MAXIMO_PDF,
  TAMANO_MAXIMO_IMAGEN,
  formatearTamano,
  esPdf
} from './PantallazoMontos';
import { normalizarMonto } from './pantallazoMontos';
import { CONSTANTS } from './cotizadorConstants';
import { leerQuote } from './leerQuote';
import {
  FABRICANTES,
  GP_QUOTE_POR_DEFECTO,
  TIPOS_MILESTONE,
  costoChileQuote,
  precioClienteQuote,
  fleteEntradaQuote,
  porcentajeInternacion,
  productoDeQuote,
  usaMargenQnap,
  tipoEsDudoso,
  tipoMilestoneSugerido
} from './quoteFabricante';

// Carga de un quote de fabricante (ISS, Neural Labs, Milestone, Velasea): se lee el PDF o la imagen,
// se muestra una tabla editable y recién cuando la persona confirma las líneas pasan al carrito.
// No hace llamadas de red propias: todo pasa por `leer`.

const TIPOS_ACEPTADOS = [TIPO_PDF, ...TIPOS_IMAGEN];

const ETIQUETAS_PROBLEMA = {
  'sin-mpn': 'sin MPN',
  'sin-cantidad': 'sin cantidad',
  'sin-costo': 'sin costo',
  'total-no-cuadra': 'el total no cuadra',
  'mpn-repetido': 'MPN repetido'
};
// Estos dos se recalculan con lo que la persona escribe; el resto viene tal cual del lector.
const PROBLEMAS_RECALCULADOS = ['sin-costo', 'sin-cantidad'];

const TIPO_ROTULO = { licencia: 'Licencia', servidor: 'Servidor' };

const validarArchivo = (file) => {
  if (!file || !TIPOS_ACEPTADOS.includes(file.type)) return 'Solo se aceptan PDF o imágenes PNG, JPG o WEBP';
  const maximo = esPdf(file) ? TAMANO_MAXIMO_PDF : TAMANO_MAXIMO_IMAGEN;
  if (file.size > maximo) {
    return `${esPdf(file) ? 'El PDF' : 'La imagen'} pesa ${formatearTamano(file.size)} y el máximo es ${formatearTamano(maximo)}`;
  }
  return null;
};

const archivoDe = (dataTransfer) => {
  if (!dataTransfer) return null;
  if (dataTransfer.files && dataTransfer.files.length > 0) return dataTransfer.files[0];
  const item = Array.from(dataTransfer.items || []).find((i) => i.kind === 'file');
  return item ? item.getAsFile() : null;
};

// 1234.5 -> "1.234,50" (a mano: no depende de los datos de idioma del entorno).
const formatoUSD = (n) => {
  const [entera, decimales] = (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2).split('.');
  return `${entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimales}`;
};

const cantidadValida = (texto) => {
  const t = String(texto ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
};

// Costo leído -> texto del campo, con coma decimal y al menos 2 decimales. Con exactamente 3
// decimales se escribe con 4 ("12,1250"): "12,125" se volvería a leer como doce mil ciento
// veinticinco en cuanto la persona tocara el campo (así interpreta los miles normalizarMonto).
export const textoNumero = (n) => {
  if (n === null || n === undefined || n === '') return '';
  const numero = Number(n);
  if (!Number.isFinite(numero)) return String(n);
  const decimales = (String(numero).split('.')[1] || '').length;
  const fijos = decimales === 3 ? 4 : Math.max(2, decimales);
  return numero.toFixed(fijos).replace('.', ',');
};

// 0.15 -> "15 %"; 0.011 -> "1,1 %" (hasta dos decimales, con coma).
const pctTexto = (decimal) => `${String(Math.round(decimal * 10000) / 100).replace('.', ',')} %`;

const textoRecargo = (fabricante) => {
  if (!fabricante) return '';
  if (fabricante === 'MILESTONE') {
    return `Licencias ${pctTexto(porcentajeInternacion('MILESTONE', 'licencia'))} · Servidores ${pctTexto(porcentajeInternacion('MILESTONE', 'servidor'))}`;
  }
  const arancel = `Transporte y arancel ${pctTexto(porcentajeInternacion(fabricante))}`;
  const flete = fleteEntradaQuote(fabricante);
  // Velasea: como QNAP pero sin IC, o sea con flete de entrada además del arancel.
  return flete !== 1 ? `Flete de entrada ${pctTexto(flete - 1)} · ${arancel} · sin IC` : arancel;
};

// Margen con que se muestra el precio de referencia: 8 % en los quotes; el global de QNAP en
// los fabricantes que se cotizan como QNAP (Velasea).
const gpDeReferencia = (fabricante, gpQnap) => (usaMargenQnap(fabricante) ? gpQnap : GP_QUOTE_POR_DEFECTO);

// Valores derivados de una línea según lo que hay escrito y el fabricante elegido.
const derivar = (linea, fabricante, gp) => {
  const cantidad = cantidadValida(linea.cantidad);
  const costo = linea.costoFijo ?? normalizarMonto(linea.costo);
  const tipo = fabricante === 'MILESTONE' ? linea.tipo ?? tipoMilestoneSugerido(linea) : null;
  const costoChile = fabricante && costo !== null ? costoChileQuote(costo, fabricante, tipo) : null;
  const precio = costoChile !== null ? precioClienteQuote(costoChile, gp) : null;
  const valida = cantidad !== null && costo !== null && costoChile !== null;
  const problemas = [
    ...linea.problemas.filter((p) => !PROBLEMAS_RECALCULADOS.includes(p)),
    ...(cantidad === null ? ['sin-cantidad'] : []),
    ...(costo === null ? ['sin-costo'] : [])
  ];
  return {
    cantidad,
    costo,
    tipo,
    costoChile,
    precio,
    valida,
    incluida: valida && linea.incluir,
    problemas,
    revisarTipo: fabricante === 'MILESTONE' && !linea.tipoTocado && tipoEsDudoso(linea)
  };
};

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100';

export default function CargarQuoteModal({ abierto, onCerrar, onAgregar, leer = leerQuote, gpQnap = CONSTANTS.DEFAULT_GP }) {
  const [fabricante, setFabricante] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [archivo, setArchivo] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState(null);
  const [falloLectura, setFalloLectura] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [conTabla, setConTabla] = useState(false);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const lecturaRef = useRef(0);
  const uidRef = useRef(0);
  const idTitulo = useId();
  const idInput = useId();

  // Al cerrarse se olvida todo: al volver a abrir parte limpio. Una lectura en vuelo se descarta.
  useEffect(() => {
    if (abierto) {
      dialogRef.current?.focus();
      return;
    }
    lecturaRef.current += 1;
    setFabricante(null);
    setLineas([]);
    setAvisos([]);
    setArchivo(null);
    setLeyendo(false);
    setError(null);
    setFalloLectura(false);
    setArrastrando(false);
    setConTabla(false);
  }, [abierto]);

  if (!abierto) return null;

  const nuevaLinea = (base = {}) => ({
    uid: ++uidRef.current,
    mpn: '',
    descripcion: '',
    cantidad: '1',
    costo: '',
    costoFijo: null,
    tipo: null,
    tipoTocado: false,
    problemas: [],
    incluir: false,
    ...base
  });

  const desdeLector = (l) => {
    const costoFijo = Number(l.costoUnitario) > 0 ? Number(l.costoUnitario) : null;
    const valida = cantidadValida(l.cantidad) !== null && costoFijo !== null;
    return nuevaLinea({
      mpn: l.mpn ?? '',
      descripcion: l.descripcion ?? '',
      cantidad: l.cantidad === null || l.cantidad === undefined ? '' : String(l.cantidad),
      costo: textoNumero(l.costoUnitario),
      costoFijo,
      tipo: l.tipo ?? null,
      problemas: Array.isArray(l.problemas) ? l.problemas : [],
      incluir: valida
    });
  };

  const ejecutarLectura = async (file) => {
    const turno = ++lecturaRef.current;
    setLeyendo(true);
    setError(null);
    setFalloLectura(false);
    let resultado;
    try {
      resultado = await leer({ file, fabricante });
    } catch (e) {
      if (turno !== lecturaRef.current) return;
      setLeyendo(false);
      setFalloLectura(true);
      setError((e && e.message) || 'No se pudo leer el quote');
      return;
    }
    if (turno !== lecturaRef.current) return;
    setLeyendo(false);
    // Las líneas nuevas se agregan al final: así se juntan dos quotes del mismo fabricante.
    setLineas((prev) => [...prev, ...(resultado?.lineas ?? []).map(desdeLector)]);
    setAvisos((prev) => [...prev, ...(resultado?.avisos ?? [])]);
    setConTabla(true);
  };

  const bloqueado = leyendo;
  const sinFabricante = !fabricante;

  const recibir = (file) => {
    if (bloqueado || !file) return;
    if (sinFabricante) {
      setFalloLectura(false);
      setError('Elige primero el fabricante del quote');
      return;
    }
    const problema = validarArchivo(file);
    if (problema) {
      // Un archivo rechazado no pisa el que ya estaba cargado.
      setFalloLectura(false);
      setError(problema);
      return;
    }
    setArchivo(file);
    ejecutarLectura(file);
  };

  const abrirSelector = () => {
    if (bloqueado) return;
    if (sinFabricante) {
      setError('Elige primero el fabricante del quote');
      return;
    }
    inputRef.current?.click();
  };

  const alPegar = (e) => {
    const file = archivoDe(e.clipboardData);
    if (!file) return; // texto u otra cosa: no es para nosotros
    e.preventDefault();
    recibir(file);
  };

  const alSoltar = (e) => {
    e.preventDefault();
    setArrastrando(false);
    recibir(archivoDe(e.dataTransfer));
  };

  const alElegir = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    recibir(file);
  };

  const cambiar = (uid, cambios) =>
    setLineas((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...cambios } : l)));
  const quitar = (uid) => setLineas((prev) => prev.filter((l) => l.uid !== uid));

  const agregarManual = () => {
    setLineas((prev) => [...prev, nuevaLinea()]);
    setConTabla(true);
  };

  const gpRef = gpDeReferencia(fabricante, gpQnap);
  const filas = lineas.map((l) => ({ linea: l, d: derivar(l, fabricante, gpRef) }));
  const incluidas = filas.filter(({ d }) => d.incluida);
  const totales = incluidas.reduce(
    (acc, { d }) => ({
      fabricante: acc.fabricante + d.cantidad * d.costo,
      chile: acc.chile + d.cantidad * d.costoChile,
      venta: acc.venta + d.cantidad * d.precio
    }),
    { fabricante: 0, chile: 0, venta: 0 }
  );

  const agregarAlCarrito = () => {
    const productos = incluidas
      .map(({ linea, d }) =>
        productoDeQuote(
          { mpn: linea.mpn, descripcion: linea.descripcion, cantidad: d.cantidad, costoUnitario: d.costo },
          { fabricante, tipo: fabricante === 'MILESTONE' ? d.tipo : undefined }
        )
      )
      .filter(Boolean);
    onAgregar(productos);
    onCerrar();
  };

  const alTecla = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
    }
  };

  const esMilestone = fabricante === 'MILESTONE';
  const mostrarTabla = conTabla || lineas.length > 0;
  const n = incluidas.length;

  return (
    <div className='fixed inset-0 z-[65] flex items-start justify-center bg-slate-950/40 backdrop-blur-[2px] p-4 pt-[4vh]'>
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className='flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-float outline-none animate-scale-in dark:bg-slate-900'
        onKeyDown={alTecla}
        onPaste={alPegar}
      >
        <div className='flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700'>
          <div>
            <h2 id={idTitulo} className='text-lg font-semibold text-slate-900 dark:text-slate-100'>
              Cargar quote de fabricante
            </h2>
            <p className='text-sm text-slate-500 dark:text-slate-400'>
              Sube el PDF o la imagen del quote, revisa las líneas y elige cuáles van al carrito.
            </p>
          </div>
          <button type='button' onClick={onCerrar} aria-label='Cerrar' className='mq-btn mq-btn-icono'>
            ×
          </button>
        </div>

        <div className='min-h-0 flex-1 space-y-4 overflow-auto p-5'>
          <div className='flex flex-wrap items-center gap-3'>
            <span id={`${idTitulo}-fab`} className='text-sm font-medium text-slate-700 dark:text-slate-200'>
              Fabricante
            </span>
            <div role='radiogroup' aria-labelledby={`${idTitulo}-fab`} className='flex gap-2'>
              {Object.entries(FABRICANTES).map(([clave, { nombre }]) => (
                <button
                  key={clave}
                  type='button'
                  role='radio'
                  aria-checked={fabricante === clave}
                  onClick={() => setFabricante(clave)}
                  className={`mq-btn mq-btn-sm ${fabricante === clave ? 'mq-btn-primario' : 'mq-btn-secundario'}`}
                >
                  {nombre}
                </button>
              ))}
            </div>
            {fabricante && (
              <span className='text-sm text-slate-600 dark:text-slate-300'>{textoRecargo(fabricante)}</span>
            )}
          </div>

          <div
            onDrop={alSoltar}
            onDragOver={(e) => {
              e.preventDefault();
              if (!bloqueado) setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            className='space-y-2'
          >
            <div
              role='button'
              tabIndex={0}
              aria-label='Elegir o soltar el archivo del quote'
              aria-disabled={bloqueado || sinFabricante}
              aria-busy={leyendo}
              onClick={abrirSelector}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  abrirSelector();
                }
              }}
              className={`flex items-center gap-3 rounded-xl border border-dashed p-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${
                arrastrando
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                  : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
              } ${bloqueado || sinFabricante ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-400 dark:hover:border-slate-500'}`}
            >
              {archivo ? (
                <>
                  <div
                    aria-hidden='true'
                    className='grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-50 text-[10px] font-semibold tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                  >
                    {esPdf(archivo) ? 'PDF' : 'IMG'}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate font-medium text-slate-900 dark:text-slate-100'>
                      {archivo.name || 'Imagen pegada'}
                    </div>
                    <div className='text-xs text-slate-500 dark:text-slate-400'>
                      {formatearTamano(archivo.size)} · para leer otro quote, suéltalo o elígelo aquí
                    </div>
                  </div>
                </>
              ) : (
                <div className='min-w-0 flex-1 text-center'>
                  <div className='font-medium text-slate-700 dark:text-slate-200'>
                    {sinFabricante ? 'Elige primero el fabricante' : 'Adjunta el quote del fabricante'}
                  </div>
                  <div className='text-xs text-slate-500 dark:text-slate-400'>
                    Arrastra el archivo, haz clic para elegirlo o pega una imagen con Ctrl+V. PDF hasta 12 MB, o PNG/JPG/WEBP hasta 6 MB.
                  </div>
                </div>
              )}
            </div>
            <input
              ref={inputRef}
              id={idInput}
              type='file'
              accept={TIPOS_ACEPTADOS.join(',')}
              onChange={alElegir}
              tabIndex={-1}
              aria-label='Elegir archivo del quote'
              className='sr-only'
            />
          </div>

          {leyendo && (
            <p role='status' className='text-sm text-slate-600 dark:text-slate-300'>
              Leyendo el quote… puede tardar hasta un minuto
            </p>
          )}

          {error && (
            <div
              role='alert'
              className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950 dark:text-rose-100'
            >
              <span>{error}</span>
              {falloLectura && archivo && (
                <button
                  type='button'
                  onClick={() => ejecutarLectura(archivo)}
                  disabled={bloqueado}
                  className='mq-btn mq-btn-xs mq-btn-secundario'
                >
                  Reintentar
                </button>
              )}
            </div>
          )}

          {avisos.length > 0 && (
            <ul
              aria-label='Avisos del lector'
              className='space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-100'
            >
              {avisos.map((aviso, i) => (
                <li key={`${i}-${aviso}`}>{aviso}</li>
              ))}
            </ul>
          )}

          {mostrarTabla && (
            <div className='overflow-x-auto'>
              <table className='w-full min-w-[56rem] border-separate border-spacing-y-1 text-sm'>
                <thead>
                  <tr className='text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400'>
                    <th className='px-1'>Incluir</th>
                    <th className='px-1'>MPN</th>
                    <th className='px-1'>Descripción</th>
                    <th className='px-1'>Cant.</th>
                    <th className='px-1'>Mi costo USD</th>
                    {esMilestone && <th className='px-1'>Tipo</th>}
                    <th className='px-1 text-right'>Costo Chile</th>
                    <th className='px-1 text-right'>Precio cliente {pctTexto(gpRef)}</th>
                    <th className='px-1'>Revisar</th>
                    <th className='px-1'>
                      <span className='sr-only'>Quitar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map(({ linea, d }, i) => {
                    const num = i + 1;
                    return (
                      <tr key={linea.uid} className='align-top'>
                        <td className='px-1 pt-1.5'>
                          <input
                            type='checkbox'
                            aria-label={`Incluir línea ${num}`}
                            checked={d.incluida}
                            disabled={!d.valida}
                            onChange={(e) => cambiar(linea.uid, { incluir: e.target.checked })}
                          />
                        </td>
                        <td className='px-1'>
                          <input
                            type='text'
                            aria-label={`MPN línea ${num}`}
                            value={linea.mpn}
                            onChange={(e) => cambiar(linea.uid, { mpn: e.target.value })}
                            className={`${inputCls} min-w-[8rem] font-mono`}
                          />
                        </td>
                        <td className='px-1'>
                          <input
                            type='text'
                            aria-label={`Descripción línea ${num}`}
                            value={linea.descripcion}
                            onChange={(e) => cambiar(linea.uid, { descripcion: e.target.value })}
                            className={`${inputCls} min-w-[14rem]`}
                          />
                        </td>
                        <td className='px-1'>
                          <input
                            type='number'
                            min={1}
                            step={1}
                            inputMode='numeric'
                            aria-label={`Cantidad línea ${num}`}
                            value={linea.cantidad}
                            onChange={(e) => cambiar(linea.uid, { cantidad: e.target.value })}
                            className={`${inputCls} w-20 tabular-nums`}
                          />
                        </td>
                        <td className='px-1'>
                          <input
                            type='text'
                            inputMode='decimal'
                            aria-label={`Mi costo USD línea ${num}`}
                            value={linea.costo}
                            onChange={(e) => cambiar(linea.uid, { costo: e.target.value, costoFijo: null })}
                            className={`${inputCls} w-28 tabular-nums`}
                          />
                        </td>
                        {esMilestone && (
                          <td className='px-1'>
                            <select
                              aria-label={`Tipo línea ${num}`}
                              value={d.tipo}
                              onChange={(e) => cambiar(linea.uid, { tipo: e.target.value, tipoTocado: true })}
                              className={inputCls}
                            >
                              {TIPOS_MILESTONE.map((t) => (
                                <option key={t} value={t}>
                                  {TIPO_ROTULO[t]}
                                </option>
                              ))}
                            </select>
                            {d.revisarTipo && (
                              <span className='mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'>
                                revisar tipo
                              </span>
                            )}
                          </td>
                        )}
                        <td className='px-1 pt-1.5 text-right tabular-nums'>
                          {d.costoChile !== null ? formatoUSD(d.costoChile) : '—'}
                        </td>
                        <td className='px-1 pt-1.5 text-right tabular-nums'>
                          {d.precio !== null ? formatoUSD(d.precio) : '—'}
                        </td>
                        <td className='px-1 pt-1'>
                          <div className='flex flex-wrap gap-1'>
                            {d.problemas.map((p) => (
                              <span
                                key={p}
                                className='rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900 dark:bg-rose-500/20 dark:text-rose-200'
                              >
                                {ETIQUETAS_PROBLEMA[p] ?? p}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className='px-1'>
                          <button
                            type='button'
                            onClick={() => quitar(linea.uid)}
                            aria-label={`Quitar línea ${num}`}
                            className='mq-btn mq-btn-xs mq-btn-fantasma'
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <button
              type='button'
              onClick={agregarManual}
              disabled={sinFabricante}
              title={sinFabricante ? 'Elige primero el fabricante' : undefined}
              className='mq-btn mq-btn-sm mq-btn-secundario'
            >
              Agregar línea a mano
            </button>
          </div>
        </div>

        <div className='flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-700'>
          <div className='flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700 dark:text-slate-200'>
            <span>{n === 1 ? '1 línea' : `${n} líneas`}</span>
            <span>
              Costo fabricante total <strong className='tabular-nums'>US$ {formatoUSD(totales.fabricante)}</strong>
            </span>
            <span>
              Costo Chile total <strong className='tabular-nums'>US$ {formatoUSD(totales.chile)}</strong>
            </span>
            <span>
              Venta total al {pctTexto(gpRef)} <strong className='tabular-nums'>US$ {formatoUSD(totales.venta)}</strong>
            </span>
          </div>
          <div className='flex gap-2'>
            <button type='button' onClick={onCerrar} className='mq-btn mq-btn-fantasma'>
              Cancelar
            </button>
            <button
              type='button'
              onClick={agregarAlCarrito}
              disabled={n === 0 || leyendo}
              className='mq-btn mq-btn-primario'
            >
              Agregar {n} al carrito
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

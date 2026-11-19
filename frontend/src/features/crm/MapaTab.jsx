import React, { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { FiltroEtapas } from './CotizacionesPiezas';
import { claseInput } from './Dialogo';
import { AGRUPACIONES, conteosPorEtapa, construirArbol } from './arbol';
import { ETAPAS, mensajeError, nombreEtapa, usd } from './formato';
import {
  ETAPAS_CON_SEGUIMIENTO,
  FILTROS_SEGUIMIENTO,
  NOMBRE_URGENCIA,
  TONO_URGENCIA,
  hoyLocal,
  pasaFiltroSeguimiento,
  resumenSeguimiento,
  textoSeguimiento,
  urgenciaDeOportunidad
} from './seguimiento';
import { CABECERA_MAPA, altoDelMapa, disponerMapa, guardarPreferenciasMapa, leerPreferenciasMapa, usdCorto } from './mapa';
import { EstadoVacio, ListaEsqueleto } from '../ui/Esqueleto';
import './arbol.css';
import './mapa.css';

const ANCHO_POR_DEFECTO = 1200;
const ANCHO_ANGOSTO = 640;
const MARCAS_CONOCIDAS = ['AXIS', 'QNAP', 'MIXTA'];

const NOMBRE_AGRUPADOS = {
  empresa: ['empresa', 'empresas'],
  etapa: ['etapa', 'etapas'],
  marca: ['marca', 'marcas']
};

const COLORES = [
  { clave: 'seguimiento', nombre: 'Seguimiento' },
  { clave: 'etapa', nombre: 'Etapa' },
  { clave: 'marca', nombre: 'Marca' }
];

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const minuscula = (texto) => texto.charAt(0).toLowerCase() + texto.slice(1);
const marcaDe = (op) => (MARCAS_CONOCIDAS.includes(op.marca) ? op.marca : null);
const redondear = (n) => Math.round(n * 100) / 100;
const textoBo = (bo) => (/^bo/i.test(String(bo)) ? String(bo) : `BO ${bo}`);

/** Clase de color de una tarjeta (o de una muestra de la leyenda) según lo que se pinta. */
const claseColor = (colorPor, urgencia, op) => {
  if (colorPor === 'etapa') return `mq-mapa-c-etapa-${op.etapa}`;
  if (colorPor === 'marca') return `mq-mapa-c-marca-${(marcaDe(op) || 'sin').toLowerCase()}`;
  return `mq-mapa-c-${urgencia}`;
};

/** Tono del punto de la tarjeta, o null si no lleva. Fuera del modo seguimiento solo marca lo urgente. */
const tonoPunto = (colorPor, urgencia) => {
  if (urgencia === 'cerrada') return null;
  if (colorPor === 'seguimiento') return urgencia === 'sin' ? 'sin' : TONO_URGENCIA[urgencia];
  return urgencia === 'vencido' || urgencia === 'hoy' || urgencia === 'manana' ? TONO_URGENCIA[urgencia] : null;
};

function Punto({ tono }) {
  if (!tono) return null;
  return <i className={tono === 'sin' ? 'mq-punto mq-mapa-punto-hueco' : `mq-punto mq-punto-${tono}`} aria-hidden='true' />;
}

/** "Cámaras bodega, Acme SA, $35,800.00, Cotizada, seguimiento vencido hace 3 días". */
function describir(op, urgencia, hoy) {
  const partes = [op.titulo, op.empresa_nombre, usd(op.monto), nombreEtapa(op.etapa)].filter(Boolean);
  if (urgencia === 'sin') partes.push('sin seguimiento');
  else if (urgencia !== 'cerrada') partes.push(`seguimiento ${minuscula(textoSeguimiento(op.proximo_seguimiento, hoy))}`);
  return partes.join(', ');
}

const Tarjeta = memo(function Tarjeta({ op, t, dx, dy, colorPor, hoy, mostrarEmpresa }) {
  const urgencia = urgenciaDeOportunidad(op, hoy);
  const tono = tonoPunto(colorPor, urgencia);
  const descripcion = describir(op, urgencia, hoy);
  const nota = urgencia === 'cerrada' ? '' : String(op.seguimiento_nota ?? '').trim();
  const conSeguimiento = urgencia !== 'cerrada';
  const textoSeg = conSeguimiento ? textoSeguimiento(op.proximo_seguimiento, hoy) : '';
  const marca = marcaDe(op);
  const tamano = t.tamano;
  const lineaSeguimiento = conSeguimiento && (
    <span className='mq-mapa-seg'>
      <Punto tono={tono} />
      <span className='mq-mapa-seg-texto'>{textoSeg}</span>
    </span>
  );

  let cuerpo;
  if (tamano === 'xl') {
    cuerpo = (
      <>
        <span className='mq-mapa-titulo mq-mapa-dos-lineas'>{op.titulo}</span>
        {mostrarEmpresa && op.empresa_nombre && <span className='mq-mapa-empresa'>{op.empresa_nombre}</span>}
        <span className='mq-mapa-monto mq-mapa-monto-grande'>{usd(op.monto)}</span>
        <span className='mq-mapa-meta'>{marca ? `${nombreEtapa(op.etapa)} · ${marca}` : nombreEtapa(op.etapa)}</span>
        {lineaSeguimiento}
        {nota && <span className='mq-mapa-nota mq-mapa-dos-lineas'>«{nota}»</span>}
        {(op.es_proyecto || op.bo) && (
          <span className='mq-mapa-chips'>
            {op.es_proyecto && <span className='mq-mapa-chip'>BID</span>}
            {op.bo && <span className='mq-mapa-chip'>{textoBo(op.bo)}</span>}
          </span>
        )}
      </>
    );
  } else if (tamano === 'l') {
    cuerpo = (
      <>
        <span className='mq-mapa-titulo mq-mapa-dos-lineas'>{op.titulo}</span>
        <span className='mq-mapa-monto'>{usd(op.monto)}</span>
        {lineaSeguimiento}
        <span className='mq-mapa-meta'>{nombreEtapa(op.etapa)}</span>
      </>
    );
  } else if (tamano === 'm') {
    cuerpo = (
      <>
        <span className='mq-mapa-titulo mq-mapa-una-linea'>{op.titulo}</span>
        <span className='mq-mapa-monto'>{usd(op.monto)}</span>
        {lineaSeguimiento}
      </>
    );
  } else if (tamano === 'c') {
    // Compacta: nombre en una línea y, debajo, el monto abreviado con el punto del seguimiento.
    cuerpo = (
      <>
        <span className='mq-mapa-titulo mq-mapa-una-linea'>{op.titulo}</span>
        <span className='mq-mapa-seg'>
          <Punto tono={tono} />
          <span className='mq-mapa-monto'>{usdCorto(op.monto)}</span>
        </span>
      </>
    );
  } else if (tamano === 's') {
    cuerpo = (
      <>
        <span className='mq-mapa-monto'>{usdCorto(op.monto)}</span>
        <Punto tono={tono} />
      </>
    );
  } else {
    cuerpo = <Punto tono={tono} />;
  }

  return (
    <button
      type='button'
      className={`mq-mapa-tarjeta ${claseColor(colorPor, urgencia, op)}`}
      style={{ left: redondear(t.x - dx), top: redondear(t.y - dy), width: t.w, height: t.h }}
      data-oportunidad-id={op.id}
      data-tamano={tamano}
      data-urgencia={urgencia}
      aria-label={descripcion}
      title={nota ? `${descripcion}. Nota: ${nota}` : descripcion}
    >
      {cuerpo}
    </button>
  );
});

function Leyenda({ colorPor, grupos }) {
  let items;
  if (colorPor === 'seguimiento') {
    const hayCerradas = grupos.some((g) => g.oportunidades.some((o) => !ETAPAS_CON_SEGUIMIENTO.includes(o.op.etapa)));
    items = [
      { clase: 'mq-mapa-c-vencido', texto: 'Vencido' },
      { clase: 'mq-mapa-c-hoy', texto: 'Hoy o mañana' },
      { clase: 'mq-mapa-c-futuro', texto: 'Más adelante' },
      { clase: 'mq-mapa-c-sin', texto: 'Sin seguimiento' },
      ...(hayCerradas ? [{ clase: 'mq-mapa-c-cerrada', texto: NOMBRE_URGENCIA.cerrada }] : [])
    ];
  } else if (colorPor === 'etapa') {
    const presentes = new Set(grupos.flatMap((g) => g.oportunidades.map((o) => o.op.etapa)));
    items = ETAPAS.filter((e) => presentes.has(e.clave)).map((e) => ({ clase: `mq-mapa-c-etapa-${e.clave}`, texto: e.nombre }));
  } else {
    const presentes = new Set(grupos.flatMap((g) => g.oportunidades.map((o) => (marcaDe(o.op) || 'SIN'))));
    items = [...MARCAS_CONOCIDAS, 'SIN']
      .filter((m) => presentes.has(m))
      .map((m) => ({ clase: `mq-mapa-c-marca-${m.toLowerCase()}`, texto: m === 'SIN' ? 'Sin marca' : m }));
  }
  return (
    <ul className='mq-mapa-leyenda' aria-label='Leyenda de colores'>
      {items.map((it) => (
        <li key={it.clase}>
          <span className={`mq-mapa-muestra ${it.clase}`} aria-hidden='true' />
          {it.texto}
        </li>
      ))}
    </ul>
  );
}

export default function MapaTab({ inputBusquedaRef, onAbrirEmpresa, onAbrirOportunidad, hoy: hoyProp }) {
  const [inicial] = useState(leerPreferenciasMapa);
  const [agruparPor, setAgruparPor] = useState(inicial.agruparPor);
  const [colorPor, setColorPor] = useState(inicial.colorPor);
  const [etapas, setEtapas] = useState(inicial.etapas);
  const [marca, setMarca] = useState(inicial.marca);
  const [seguimiento, setSeguimiento] = useState(inicial.seguimiento);
  const [busqueda, setBusqueda] = useState('');
  const [hoyMontaje] = useState(() => hoyLocal());
  const hoy = hoyProp || hoyMontaje;
  const [ancho, setAncho] = useState(ANCHO_POR_DEFECTO);
  const lienzoRef = useRef(null);

  const consulta = useQuery({ queryKey: queryKeys.crm.arbol, queryFn: () => crmApi.arbol() });
  const datos = consulta.data;
  const busquedaDiferida = useDeferredValue(busqueda);

  // Búsqueda, etapas y marca ANTES del filtro de seguimiento: de aquí salen los números de los chips.
  const arbolBase = useMemo(
    () => construirArbol(datos, { agruparPor, busqueda: busquedaDiferida, etapas, marca }),
    [datos, agruparPor, busquedaDiferida, etapas, marca]
  );
  const resumen = useMemo(
    () => resumenSeguimiento(arbolBase.grupos.flatMap((g) => g.oportunidades.map((o) => o.op)), hoy),
    [arbolBase, hoy]
  );
  const datosFiltrados = useMemo(() => {
    if (!seguimiento || !datos) return datos;
    return { ...datos, oportunidades: (datos.oportunidades || []).filter((op) => pasaFiltroSeguimiento(op, seguimiento, hoy)) };
  }, [datos, seguimiento, hoy]);
  const arbol = useMemo(
    () => (seguimiento ? construirArbol(datosFiltrados, { agruparPor, busqueda: busquedaDiferida, etapas, marca }) : arbolBase),
    [seguimiento, arbolBase, datosFiltrados, agruparPor, busquedaDiferida, etapas, marca]
  );
  const conteos = useMemo(() => conteosPorEtapa(datos, { busqueda: busquedaDiferida, marca }), [datos, busquedaDiferida, marca]);
  // Solo si no hay nada que mostrar: ¿existe lo buscado en las etapas que el filtro oculta?
  const enOtrasEtapas = useMemo(() => {
    if (arbol.grupos.length > 0 || etapas.length === 0) return 0;
    return construirArbol(datosFiltrados, { busqueda: busquedaDiferida, marca, etapas: [] }).totales.oportunidades;
  }, [arbol, etapas, datosFiltrados, busquedaDiferida, marca]);

  const hayOportunidades = (datos?.oportunidades || []).length > 0;
  const mostrandoMapa = !consulta.isLoading && !consulta.isError && hayOportunidades && arbol.grupos.length > 0;

  useEffect(() => {
    guardarPreferenciasMapa({ agruparPor, colorPor, etapas, marca, seguimiento });
  }, [agruparPor, colorPor, etapas, marca, seguimiento]);

  // Ancho del lienzo: ResizeObserver si existe; si no, clientWidth (o 1200 donde no hay layout).
  useLayoutEffect(() => {
    const el = lienzoRef.current;
    if (!el) return undefined;
    const medir = (valor) => {
      const w = Math.round(valor || el.clientWidth || ANCHO_POR_DEFECTO);
      setAncho((previo) => (previo === w ? previo : w));
    };
    medir(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect?.width;
      if (w > 0) medir(w);
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, [mostrandoMapa]);

  const angosto = ancho < ANCHO_ANGOSTO;
  const alto = useMemo(
    () =>
      altoDelMapa({
        cantidad: arbol.totales.oportunidades,
        ancho,
        // Área holgada por tarjeta: con pocas oportunidades el mapa llena una pantalla y con
        // muchas crece hacia abajo. En un celular necesitan más, para poder leerse y tocarse.
        minimo: angosto ? 460 : 600,
        areaPorTarjeta: angosto ? 20000 : 18000
      }),
    [arbol, ancho, angosto]
  );
  const disposicion = useMemo(
    () =>
      disponerMapa({
        grupos: arbol.grupos.map((g) => ({ id: g.id, items: g.oportunidades.map((o) => ({ id: o.id, monto: o.op.monto })) })),
        ancho,
        alto,
        // La más chica debe alcanzar para leer su nombre y su monto (unos 100 x 56 px).
        areaMinima: angosto ? 4800 : 5600
      }),
    [arbol, ancho, alto, angosto]
  );
  const indice = useMemo(() => {
    const grupos = new Map(arbol.grupos.map((g) => [g.id, g]));
    const ops = new Map();
    arbol.grupos.forEach((g) => g.oportunidades.forEach((o) => ops.set(o.id, o.op)));
    return { grupos, ops };
  }, [arbol]);

  const cambiarAgrupacion = (clave) => setAgruparPor(clave);
  const alternarEtapa = (clave) => setEtapas((prev) => (prev.includes(clave) ? prev.filter((e) => e !== clave) : [...prev, clave]));
  const verTodasLasEtapas = () => setEtapas([]);
  const limpiarFiltros = () => {
    setBusqueda('');
    setEtapas([]);
    setMarca('');
    setSeguimiento('');
  };

  const abrirDesdeEvento = (e) => {
    const tarjeta = e.target.closest?.('[data-oportunidad-id]');
    if (!tarjeta) return null;
    const op = indice.ops.get(`o:${tarjeta.dataset.oportunidadId}`);
    return op || null;
  };
  const alHacerClic = (e) => {
    const op = abrirDesdeEvento(e);
    if (op) onAbrirOportunidad?.(op.id);
  };
  // Enter y Espacio abren la tarjeta; se atienden aquí (y no con el clic nativo) para no abrir dos veces.
  const alTeclear = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const op = abrirDesdeEvento(e);
    if (!op) return;
    e.preventDefault();
    onAbrirOportunidad?.(op.id);
  };
  const alSoltarTecla = (e) => {
    if (e.key === ' ' && e.target.closest?.('[data-oportunidad-id]')) e.preventDefault();
  };

  const teclearSegmento = (e) => {
    const i = AGRUPACIONES.findIndex((a) => a.clave === agruparPor);
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const siguiente = AGRUPACIONES[(i + paso + AGRUPACIONES.length) % AGRUPACIONES.length];
    cambiarAgrupacion(siguiente.clave);
    const grupo = e.currentTarget;
    setTimeout(() => grupo.querySelector('[aria-checked="true"]')?.focus(), 0);
  };

  const { totales } = arbol;
  const [unoAgrupado, variosAgrupado] = NOMBRE_AGRUPADOS[agruparPor];
  const truncado = Boolean(datos?.truncado);
  const montoMostrado = arbol.grupos.reduce((s, g) => s + g.montoTotal, 0);
  const { enPiso } = disposicion;

  let contenido;
  if (consulta.isLoading) {
    contenido = <ListaEsqueleto lineas={4} />;
  } else if (consulta.isError) {
    contenido = (
      <div role='alert' className='mq-arbol-error'>
        <p>{mensajeError(consulta.error, 'No se pudo cargar el mapa del CRM')}</p>
        <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={() => consulta.refetch()}>Reintentar</button>
      </div>
    );
  } else if (!hayOportunidades) {
    contenido = (
      <div className='mq-arbol-vacio'>
        <EstadoVacio
          icono='carpeta'
          titulo='Aún no hay oportunidades'
          detalle='Se crean solas al generar una cotización. También puedes crear una con el botón «Nueva oportunidad».'
        />
      </div>
    );
  } else if (arbol.grupos.length === 0 && enOtrasEtapas > 0) {
    contenido = (
      <div className='mq-arbol-vacio'>
        <EstadoVacio
          icono='bandeja'
          titulo='Nada en las etapas seleccionadas'
          detalle={`Hay ${plural(enOtrasEtapas, 'oportunidad que coincide', 'oportunidades que coinciden')} en otras etapas.`}
          accion={{ label: 'Ver todas las etapas', onClick: verTodasLasEtapas }}
        />
      </div>
    );
  } else if (arbol.grupos.length === 0) {
    contenido = (
      <div className='mq-arbol-vacio'>
        <EstadoVacio
          icono='bandeja'
          titulo='Ninguna oportunidad coincide con los filtros'
          detalle='Prueba con otra búsqueda, otras etapas, otra marca u otro seguimiento.'
          accion={{ label: 'Limpiar filtros', onClick: limpiarFiltros }}
        />
      </div>
    );
  } else {
    contenido = (
      <>
        <Leyenda colorPor={colorPor} grupos={arbol.grupos} />
        <div
          ref={lienzoRef}
          className='mq-mapa-lienzo'
          style={{ height: disposicion.alto }}
          onClick={alHacerClic}
          onKeyDown={alTeclear}
          onKeyUp={alSoltarTecla}
        >
          {disposicion.grupos.map((b) => {
            const g = indice.grupos.get(b.id);
            if (!g) return null;
            const monto = g.agrupacion === 'etapa' ? g.montoTotal : g.montoAbierto;
            return (
              <div
                key={b.id}
                role='group'
                aria-label={`${g.titulo}: ${plural(g.conteo, 'oportunidad', 'oportunidades')}, ${usd(monto)}`}
                className='mq-mapa-bloque'
                data-grupo-id={b.id}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                title={b.conCabecera ? undefined : `${g.titulo} · ${g.conteo} · ${usd(monto)}`}
              >
                {b.conCabecera && (
                  <div className='mq-mapa-cabecera' style={{ height: CABECERA_MAPA }}>
                    {g.empresaId != null ? (
                      <button
                        type='button'
                        className='mq-mapa-grupo-titulo mq-mapa-ficha'
                        aria-label={`Ficha de ${g.titulo}`}
                        title={`Abrir ficha de ${g.titulo}`}
                        onClick={() => onAbrirEmpresa?.(g.empresaId)}
                      >
                        {g.titulo}
                      </button>
                    ) : (
                      <span className='mq-mapa-grupo-titulo' title={g.titulo}>{g.titulo}</span>
                    )}
                    <span className='mq-mapa-grupo-cifras'>
                      {g.conteo}
                      {b.w >= 150 && ` · ${usd(monto)}`}
                    </span>
                  </div>
                )}
                {b.tarjetas.map((t) => {
                  const op = indice.ops.get(t.id);
                  if (!op) return null;
                  return (
                    <Tarjeta
                      key={t.id}
                      op={op}
                      t={t}
                      dx={b.x}
                      dy={b.y}
                      colorPor={colorPor}
                      hoy={hoy}
                      mostrarEmpresa={agruparPor !== 'empresa'}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className='mq-arbol-pie'>
          {plural(totales.grupos, unoAgrupado, variosAgrupado)} · {plural(totales.oportunidades, 'oportunidad', 'oportunidades')} · {usd(montoMostrado)}
        </p>
        {enPiso > 0 && (
          <p className='mq-arbol-pie'>
            {enPiso === 1
              ? 'La más chica se muestra con un tamaño mínimo para que se pueda ver y abrir.'
              : `Las ${enPiso} más chicas se muestran con un tamaño mínimo para que se puedan ver y abrir.`}
          </p>
        )}
      </>
    );
  }

  return (
    <div className='mq-arbol mq-mapa'>
      <div className='mq-arbol-barra'>
        <div className='mq-arbol-campo'>
          <span className='mq-sobre' id='mapa-agrupar'>Agrupar por</span>
          <div role='radiogroup' aria-labelledby='mapa-agrupar' className='mq-arbol-segmentos' onKeyDown={teclearSegmento}>
            {AGRUPACIONES.map((a) => (
              <button
                key={a.clave}
                type='button'
                role='radio'
                aria-checked={agruparPor === a.clave}
                tabIndex={agruparPor === a.clave ? 0 : -1}
                className='mq-arbol-segmento'
                onClick={() => cambiarAgrupacion(a.clave)}
              >
                {a.nombre}
              </button>
            ))}
          </div>
        </div>
        <label className='mq-arbol-campo'>
          <span className='mq-sobre'>Color</span>
          <select aria-label='Color de las tarjetas' value={colorPor} onChange={(e) => setColorPor(e.target.value)} className={`${claseInput} !w-auto`}>
            {COLORES.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
          </select>
        </label>
        <input
          ref={inputBusquedaRef}
          type='search'
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label='Buscar en el mapa'
          placeholder='Buscar empresa, oportunidad, BO, N° de cotización, proyecto o PID  ( / )'
          className={`${claseInput} mq-arbol-buscar`}
        />
        <label className='mq-arbol-campo'>
          <span className='mq-sobre'>Marca</span>
          <select aria-label='Filtrar por marca' value={marca} onChange={(e) => setMarca(e.target.value)} className={`${claseInput} !w-auto`}>
            <option value=''>Todas</option>
            <option value='AXIS'>AXIS</option>
            <option value='QNAP'>QNAP</option>
            <option value='MIXTA'>MIXTA</option>
            <option value='SIN'>Sin marca</option>
          </select>
        </label>
      </div>

      <div className='mq-arbol-barra'>
        <FiltroEtapas seleccion={etapas} conteos={conteos} onAlternar={alternarEtapa} />
      </div>

      <div className='mq-cot-grupo' role='group' aria-label='Filtrar por seguimiento'>
        {FILTROS_SEGUIMIENTO.map((f) => {
          const dato = f.clave ? resumen[f.clave] : null;
          return (
            <button
              key={f.clave || 'todas'}
              type='button'
              className='mq-filtro'
              aria-pressed={seguimiento === f.clave}
              onClick={() => setSeguimiento(f.clave)}
            >
              {f.nombre}{' '}
              <span>{dato ? `${dato.cantidad} · ${usd(dato.monto)}` : arbolBase.totales.oportunidades}</span>
            </button>
          );
        })}
      </div>

      {truncado && (
        <p role='status' className='mq-arbol-aviso'>
          Se muestran las {(datos.oportunidades || []).length} oportunidades más recientes de {datos.total_oportunidades}
        </p>
      )}

      {contenido}
    </div>
  );
}

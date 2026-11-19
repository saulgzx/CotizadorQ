import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { useMoverOportunidad } from './EmbudoTab';
import { FiltroEtapas } from './CotizacionesPiezas';
import { claseInput } from './Dialogo';
import { AGRUPACIONES, conteosPorEtapa, construirArbol, filasVisibles, guardarPreferencias, leerPreferencias, moverFoco } from './arbol';
import { ETAPAS, diasTexto, fechaCL, mensajeError, usd } from './formato';
import { EstadoVacio, ListaEsqueleto } from '../ui/Esqueleto';
import './arbol.css';

const TAMANO_PAGINA = 300;
const TECLAS_FOCO = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
const INTERACTIVOS = 'button, select, a, input, textarea, label';

const NOMBRE_AGRUPADOS = {
  empresa: ['empresa', 'empresas'],
  etapa: ['etapa', 'etapas'],
  marca: ['marca', 'marcas']
};

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// "BO-1001" ya dice BO; "1001" se muestra como "BO 1001".
const textoBo = (bo) => (/^bo/i.test(String(bo)) ? String(bo) : `BO ${bo}`);
// El campo del PID es el antiguo "email" de la cotización: si trae un correo se muestra tal cual.
const textoPid = (pid) => (/^pid/i.test(String(pid)) || String(pid).includes('@') ? String(pid) : `PID ${pid}`);

// El cotizador guarda "N/A" cuando no hay proyecto o PID: eso no es un dato que mostrar.
const SIN_DATO = /^(n\s*\/?\s*a|-+|sin dato)$/i;
const dato = (valor) => {
  const texto = String(valor ?? '').trim();
  return texto && !SIN_DATO.test(texto) ? texto : null;
};

const copiar = (conjunto, cambiar) => {
  const nuevo = new Set(conjunto);
  cambiar(nuevo);
  return nuevo;
};

function Flecha({ expandible, expandido }) {
  return (
    <span className='mq-arbol-flecha' data-abierto={expandido ? 'true' : 'false'} data-vacia={expandible ? undefined : 'true'} aria-hidden='true'>
      {expandible && (
        <svg viewBox='0 0 16 16' width='12' height='12' focusable='false'>
          <path d='M6 3.5 10.5 8 6 12.5' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
      )}
    </span>
  );
}

function CeldaGrupo({ fila, onAbrirEmpresa }) {
  const g = fila.nodo;
  const detalle = g.abiertas > 0 ? plural(g.abiertas, 'abierta', 'abiertas') : plural(g.conteo, 'oportunidad', 'oportunidades');
  return (
    <>
      <div role='gridcell' className='mq-arbol-celda mq-arbol-nombre'>
        <Flecha expandible={fila.expandible} expandido={fila.expandido} />
        <span className='mq-arbol-titulo mq-arbol-titulo-grupo'>{g.titulo}</span>
        <span className='mq-arbol-detalle'>{detalle}</span>
        {g.empresaId != null && (
          <button
            type='button'
            className='mq-arbol-enlace mq-arbol-ficha'
            aria-label={`Ficha de ${g.titulo}`}
            onClick={() => onAbrirEmpresa?.(g.empresaId)}
          >
            Ficha
          </button>
        )}
      </div>
      <div role='gridcell' className='mq-arbol-celda' />
      <div role='gridcell' className='mq-arbol-celda' />
      <div role='gridcell' className='mq-arbol-celda mq-arbol-monto'>
        <span>{usd(g.agrupacion === 'etapa' ? g.montoTotal : g.montoAbierto)}</span>
        {g.agrupacion !== 'etapa' && g.montoGanado > 0 && <span className='mq-arbol-detalle'>Ganado {usd(g.montoGanado)}</span>}
      </div>
      <div role='gridcell' className='mq-arbol-celda' />
    </>
  );
}

function CeldaOportunidad({ fila, agruparPorEmpresa, onMover, onAbrirEmpresa }) {
  const { op } = fila.nodo;
  const motivo = op.etapa === 'perdida' && op.motivo_perdida ? op.motivo_perdida : null;
  const dias = op.dias_en_etapa;
  return (
    <>
      <div role='gridcell' className='mq-arbol-celda mq-arbol-nombre'>
        <Flecha expandible={fila.expandible} expandido={fila.expandido} />
        <span className='mq-arbol-cuerpo'>
          <span className='mq-arbol-linea'>
            <span className='mq-arbol-titulo' title={op.titulo}>{op.titulo}</span>
            {op.es_proyecto && <span className='mq-arbol-chip mq-arbol-chip-acento' title='Proyecto / BID'>BID</span>}
            {op.bo && <span className='mq-arbol-chip' title={`Orden ${op.bo}`}>{textoBo(op.bo)}</span>}
          </span>
          {(op.contacto_nombre || !agruparPorEmpresa || motivo) && (
            <span className='mq-arbol-linea mq-arbol-detalle'>
              {!agruparPorEmpresa && op.empresa_nombre && (
                op.empresa_id != null ? (
                  <button
                    type='button'
                    className='mq-arbol-enlace'
                    title={`Abrir ficha de ${op.empresa_nombre}`}
                    onClick={() => onAbrirEmpresa?.(op.empresa_id)}
                  >
                    {op.empresa_nombre}
                  </button>
                ) : (
                  <span>{op.empresa_nombre}</span>
                )
              )}
              {op.contacto_nombre && <span>{op.contacto_nombre}</span>}
              {motivo && <span title={`Motivo: ${motivo}`}>Motivo: {motivo}</span>}
            </span>
          )}
        </span>
      </div>
      <div role='gridcell' className='mq-arbol-celda'>
        <select
          className={`${claseInput} mq-arbol-select`}
          aria-label={`Etapa de ${op.titulo}`}
          value={op.etapa}
          onChange={(e) => onMover(op, e.target.value)}
        >
          {ETAPAS.map((et) => <option key={et.clave} value={et.clave}>{et.nombre}</option>)}
        </select>
      </div>
      <div role='gridcell' className='mq-arbol-celda mq-arbol-marca'>{op.marca || '—'}</div>
      <div role='gridcell' className='mq-arbol-celda mq-arbol-monto'>{usd(op.monto)}</div>
      <div role='gridcell' className='mq-arbol-celda mq-arbol-dias'>{dias == null ? '—' : diasTexto(dias)}</div>
    </>
  );
}

function CeldaCotizacion({ fila, onAbrirCotizacion }) {
  const { cot, vigente } = fila.nodo;
  const secundario = [
    dato(cot.proyecto),
    dato(cot.pid) ? textoPid(dato(cot.pid)) : null,
    cot.created_at ? fechaCL(cot.created_at) : null,
    dato(cot.usuario)
  ].filter(Boolean);
  const version = Number(cot.version);
  return (
    <>
      <div role='gridcell' className='mq-arbol-celda mq-arbol-nombre'>
        <Flecha expandible={false} expandido={false} />
        <span className='mq-arbol-cuerpo'>
          <span className='mq-arbol-linea'>
            <button
              type='button'
              className='mq-arbol-enlace mq-arbol-numero'
              aria-label={`Abrir cotización ${cot.numero}`}
              onClick={() => onAbrirCotizacion?.(cot.id)}
            >
              #{cot.numero}
            </button>
            {version > 1 && <span className='mq-arbol-version'>v{version}</span>}
            {vigente && fila.tamano > 1 && <span className='mq-arbol-chip mq-arbol-chip-acento'>vigente</span>}
          </span>
          {secundario.length > 0 && <span className='mq-arbol-linea mq-arbol-detalle'>{secundario.join(' · ')}</span>}
        </span>
      </div>
      <div role='gridcell' className='mq-arbol-celda' />
      <div role='gridcell' className='mq-arbol-celda' />
      <div role='gridcell' className='mq-arbol-celda mq-arbol-monto'>{usd(cot.total)}</div>
      <div role='gridcell' className='mq-arbol-celda' />
    </>
  );
}

export default function ArbolTab({ inputBusquedaRef, onAbrirEmpresa, onAbrirCotizacion }) {
  const [inicial] = useState(leerPreferencias);
  const [agruparPor, setAgruparPor] = useState(inicial.agruparPor);
  const [etapas, setEtapas] = useState(inicial.etapas);
  const [marca, setMarca] = useState(inicial.marca);
  const [expandidos, setExpandidos] = useState(() => new Set(inicial.expandidos));
  const [plegadosBusqueda, setPlegadosBusqueda] = useState(() => new Set());
  const [busqueda, setBusqueda] = useState('');
  const [limite, setLimite] = useState(TAMANO_PAGINA);
  const [focoId, setFocoId] = useState(null);
  const [mover, dialogo] = useMoverOportunidad();
  const contenedorRef = useRef(null);
  const pendienteFoco = useRef(null);

  const consulta = useQuery({ queryKey: queryKeys.crm.arbol, queryFn: () => crmApi.arbol() });
  const datos = consulta.data;
  const busquedaDiferida = useDeferredValue(busqueda);

  const arbol = useMemo(
    () => construirArbol(datos, { agruparPor, busqueda: busquedaDiferida, etapas, marca }),
    [datos, agruparPor, busquedaDiferida, etapas, marca]
  );
  const conteos = useMemo(() => conteosPorEtapa(datos, { busqueda: busquedaDiferida, marca }), [datos, busquedaDiferida, marca]);

  // Lo que se ve desplegado: lo del usuario más lo que abre la búsqueda, menos lo que plegó durante ella.
  const desplegados = useMemo(() => {
    if (arbol.abrirPorBusqueda.size === 0 && plegadosBusqueda.size === 0) return expandidos;
    return copiar(expandidos, (s) => {
      arbol.abrirPorBusqueda.forEach((id) => s.add(id));
      plegadosBusqueda.forEach((id) => s.delete(id));
    });
  }, [expandidos, arbol, plegadosBusqueda]);
  const filas = useMemo(() => filasVisibles(arbol, desplegados), [arbol, desplegados]);
  const dibujadas = useMemo(() => filas.slice(0, limite), [filas, limite]);
  const focoEfectivo = dibujadas.some((f) => f.id === focoId) ? focoId : dibujadas[0]?.id;

  useEffect(() => {
    guardarPreferencias({ agruparPor, etapas, marca, expandidos: [...expandidos] });
  }, [agruparPor, etapas, marca, expandidos]);

  // Tras mover el foco con el teclado, la fila nueva ya está dibujada: se enfoca aquí.
  useEffect(() => {
    const id = pendienteFoco.current;
    if (!id) return;
    pendienteFoco.current = null;
    const fila = [...(contenedorRef.current?.querySelectorAll('[role="row"][data-fila-id]') || [])].find((el) => el.dataset.filaId === id);
    fila?.focus();
  });

  const fijarDesplegado = (id, abrir) => {
    if (desplegados.has(id) === abrir) return;
    if (abrir) {
      setExpandidos((prev) => copiar(prev, (s) => s.add(id)));
      setPlegadosBusqueda((prev) => (prev.has(id) ? copiar(prev, (s) => s.delete(id)) : prev));
    } else {
      setExpandidos((prev) => (prev.has(id) ? copiar(prev, (s) => s.delete(id)) : prev));
      if (arbol.abrirPorBusqueda.has(id)) setPlegadosBusqueda((prev) => copiar(prev, (s) => s.add(id)));
    }
  };
  const alternar = (id) => fijarDesplegado(id, !desplegados.has(id));

  const desplegarTodo = () => {
    const todos = new Set();
    arbol.grupos.forEach((g) => {
      todos.add(g.id);
      g.oportunidades.forEach((o) => o.cotizaciones.length > 0 && todos.add(o.id));
    });
    setExpandidos(todos);
    setPlegadosBusqueda(new Set());
  };
  const plegarTodo = () => {
    setExpandidos(new Set());
    setPlegadosBusqueda(new Set(arbol.abrirPorBusqueda));
  };

  const cambiarBusqueda = (texto) => {
    setBusqueda(texto);
    setPlegadosBusqueda(new Set());
    setLimite(TAMANO_PAGINA);
  };
  const cambiarAgrupacion = (clave) => {
    if (clave === agruparPor) return;
    setAgruparPor(clave);
    // Los ids de los grupos cambian con la agrupación; los de oportunidad se conservan.
    setExpandidos((prev) => new Set([...prev].filter((id) => id.startsWith('o:'))));
    setPlegadosBusqueda(new Set());
    setLimite(TAMANO_PAGINA);
    setFocoId(null);
  };
  const alternarEtapa = (clave) => {
    setEtapas((prev) => (prev.includes(clave) ? prev.filter((e) => e !== clave) : [...prev, clave]));
    setLimite(TAMANO_PAGINA);
  };
  const cambiarMarca = (valor) => {
    setMarca(valor);
    setLimite(TAMANO_PAGINA);
  };
  const verTodasLasEtapas = () => {
    setEtapas([]);
    setLimite(TAMANO_PAGINA);
  };
  const limpiarFiltros = () => {
    setBusqueda('');
    setEtapas([]);
    setMarca('');
    setPlegadosBusqueda(new Set());
    setLimite(TAMANO_PAGINA);
  };

  const enfocar = (id) => {
    const i = filas.findIndex((f) => f.id === id);
    if (i >= limite) setLimite(Math.ceil((i + 1) / TAMANO_PAGINA) * TAMANO_PAGINA);
    setFocoId(id);
    pendienteFoco.current = id;
  };

  const alTeclear = (e, fila) => {
    // Solo cuando el foco está en la fila misma: select y botones conservan sus teclas.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (fila.expandible) alternar(fila.id);
      else if (fila.tipo === 'cotizacion') onAbrirCotizacion?.(fila.nodo.cot.id);
      else return;
      e.preventDefault();
      return;
    }
    if (!TECLAS_FOCO.has(e.key)) return;
    e.preventDefault();
    const r = moverFoco(filas, fila.id, e.key);
    if (r.expandir) fijarDesplegado(r.expandir, true);
    if (r.contraer) fijarDesplegado(r.contraer, false);
    if (r.foco && r.foco !== fila.id) enfocar(r.foco);
  };

  const alHacerClic = (e, fila) => {
    if (!fila.expandible) return;
    const destino = e.target.closest?.(INTERACTIVOS);
    if (destino && destino !== e.currentTarget) return;
    alternar(fila.id);
  };

  const hayOportunidades = (datos?.oportunidades || []).length > 0;
  // Cuántas calzan con la búsqueda y la marca sin mirar el filtro de etapas.
  const enOtrasEtapas = Object.values(conteos).reduce((a, b) => a + b, 0);
  const { totales } = arbol;
  const [unoAgrupado, variosAgrupado] = NOMBRE_AGRUPADOS[agruparPor];
  const truncado = Boolean(datos?.truncado);

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

  let contenido;
  if (consulta.isLoading) {
    contenido = <ListaEsqueleto lineas={4} />;
  } else if (consulta.isError) {
    contenido = (
      <div role='alert' className='mq-arbol-error'>
        <p>{mensajeError(consulta.error, 'No se pudo cargar el árbol del CRM')}</p>
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
  } else if (arbol.grupos.length === 0 && etapas.length > 0 && enOtrasEtapas > 0) {
    // Lo buscado existe, pero en una etapa que el filtro no muestra (típico: una cotización ya
    // ganada con el filtro en "abiertas"). Decirlo es mejor que un "sin resultados" a secas.
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
          detalle='Prueba con otra búsqueda, otras etapas u otra marca.'
          accion={{ label: 'Limpiar filtros', onClick: limpiarFiltros }}
        />
      </div>
    );
  } else {
    contenido = (
      <>
        <div className='mq-arbol-scroll'>
          <div ref={contenedorRef} role='treegrid' aria-label='Árbol del CRM' className='mq-arbol-tabla'>
            <div role='row' className='mq-arbol-fila mq-arbol-cabecera'>
              <div role='columnheader' className='mq-arbol-celda mq-sobre'>{AGRUPACIONES.find((a) => a.clave === agruparPor)?.nombre}</div>
              <div role='columnheader' className='mq-arbol-celda mq-sobre'>Etapa</div>
              <div role='columnheader' className='mq-arbol-celda mq-sobre'>Marca</div>
              <div role='columnheader' className='mq-arbol-celda mq-sobre mq-arbol-monto'>Monto</div>
              <div role='columnheader' className='mq-arbol-celda mq-sobre mq-arbol-dias'>Días</div>
            </div>
            {dibujadas.map((fila) => (
              <div
                key={fila.id}
                role='row'
                data-fila-id={fila.id}
                data-tipo={fila.tipo}
                aria-level={fila.nivel}
                aria-posinset={fila.posicion}
                aria-setsize={fila.tamano}
                aria-expanded={fila.expandible ? fila.expandido : undefined}
                tabIndex={fila.id === focoEfectivo ? 0 : -1}
                className={`mq-arbol-fila mq-arbol-fila-${fila.tipo}`}
                data-expandible={fila.expandible ? 'true' : undefined}
                style={{ '--mq-arbol-nivel': fila.nivel - 1 }}
                onKeyDown={(e) => alTeclear(e, fila)}
                onClick={(e) => alHacerClic(e, fila)}
                onFocus={() => setFocoId(fila.id)}
              >
                {fila.tipo === 'grupo' && <CeldaGrupo fila={fila} onAbrirEmpresa={onAbrirEmpresa} />}
                {fila.tipo === 'oportunidad' && (
                  <CeldaOportunidad fila={fila} agruparPorEmpresa={agruparPor === 'empresa'} onMover={mover} onAbrirEmpresa={onAbrirEmpresa} />
                )}
                {fila.tipo === 'cotizacion' && <CeldaCotizacion fila={fila} onAbrirCotizacion={onAbrirCotizacion} />}
              </div>
            ))}
          </div>
        </div>
        {filas.length > dibujadas.length && (
          <div className='mq-arbol-mas'>
            <span>Se muestran {dibujadas.length} de {filas.length} filas.</span>
            <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={() => setLimite((l) => l + TAMANO_PAGINA)}>
              Mostrar {TAMANO_PAGINA} más
            </button>
          </div>
        )}
        <p className='mq-arbol-pie'>
          {plural(totales.grupos, unoAgrupado, variosAgrupado)} · {plural(totales.oportunidades, 'oportunidad', 'oportunidades')} ·{' '}
          {plural(totales.abiertas, 'abierta', 'abiertas')} por {usd(totales.montoAbierto)}
        </p>
      </>
    );
  }

  return (
    <div className='mq-arbol'>
      <div className='mq-arbol-barra'>
        <div className='mq-arbol-campo'>
          <span className='mq-sobre' id='arbol-agrupar'>Agrupar por</span>
          <div role='radiogroup' aria-labelledby='arbol-agrupar' className='mq-arbol-segmentos' onKeyDown={teclearSegmento}>
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
        <input
          ref={inputBusquedaRef}
          type='search'
          value={busqueda}
          onChange={(e) => cambiarBusqueda(e.target.value)}
          aria-label='Buscar en el árbol'
          placeholder='Buscar empresa, oportunidad, BO, N° de cotización, proyecto o PID  ( / )'
          className={`${claseInput} mq-arbol-buscar`}
        />
        <label className='mq-arbol-campo'>
          <span className='mq-sobre'>Marca</span>
          <select aria-label='Filtrar por marca' value={marca} onChange={(e) => cambiarMarca(e.target.value)} className={`${claseInput} !w-auto`}>
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
        <div className='mq-arbol-acciones'>
          <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={desplegarTodo} disabled={arbol.grupos.length === 0}>
            Desplegar todo
          </button>
          <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={plegarTodo} disabled={arbol.grupos.length === 0}>
            Plegar todo
          </button>
        </div>
      </div>

      {truncado && (
        <p role='status' className='mq-arbol-aviso'>
          Se muestran las {(datos.oportunidades || []).length} oportunidades más recientes de {datos.total_oportunidades}
        </p>
      )}

      {contenido}
      {dialogo}
    </div>
  );
}

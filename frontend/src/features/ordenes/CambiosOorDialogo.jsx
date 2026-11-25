import React, { useState } from 'react';
import Dialogo from '../crm/Dialogo';
import { notify } from '../ui/toast';
import {
  NOMBRE_TIPO,
  TONO_TIPO,
  conteosDeFiltros,
  fechaCorta,
  fechaHora,
  filtrarGrupos,
  indicadoresDe,
  resumenEnTexto,
  textoCantidad,
  textoDespacho,
  textoDias,
  textoFacturacion,
  titularDeBo
} from './cambiosOor';
import './cambiosOor.css';

const FILTROS = [
  { clave: '', conteo: 'todo', nombre: 'Todo' },
  { clave: 'facturacion', conteo: 'facturacion', nombre: 'Facturación afectada' },
  { clave: 'atraso', conteo: 'atraso', nombre: 'Atrasos' },
  { clave: 'otros', conteo: 'otros', nombre: 'Otros' }
];

const lista = (v) => (Array.isArray(v) ? v : []);

function TablaLineas({ lineas, etiqueta }) {
  return (
    <div className='mq-oor-tabla-caja'>
      <table className='mq-oor-tabla' aria-label={etiqueta}>
        <thead>
          <tr>
            <th scope='col'>Tipo</th>
            <th scope='col'>Parte</th>
            <th scope='col'>Descripción</th>
            <th scope='col'>Cant.</th>
            <th scope='col'>Despacho</th>
            <th scope='col'>Días</th>
            <th scope='col'>Llegada estimada</th>
          </tr>
        </thead>
        <tbody>
          {lista(lineas).map((item, i) => {
            const l = item?.linea || {};
            return (
              <tr key={l.clave ? `${l.clave}-${item?.tipo}` : i}>
                <td>
                  <span className={`mq-oor-chip mq-oor-chip-${TONO_TIPO[item?.tipo] || 'info'}`}>
                    {NOMBRE_TIPO[item?.tipo] || item?.tipo || 'Cambio'}
                  </span>
                </td>
                <td className='mq-oor-num'>{l.parte || '—'}</td>
                <td>{l.descripcion || '—'}</td>
                <td className='mq-oor-num'>{textoCantidad(item) || '—'}</td>
                <td className='mq-oor-num'>{textoDespacho(item)}</td>
                <td className='mq-oor-num'>{textoDias(item?.dias) || '—'}</td>
                <td className='mq-oor-num'>{fechaCorta(l.eta) || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TarjetaBo({ grupo, onAbrirOrden }) {
  const dias = textoDias(grupo?.dias);
  const claseDias = Number(grupo?.dias) > 0 ? 'mq-oor-dias-atraso' : 'mq-oor-dias-adelanto';
  const afectada = grupo?.facturacion?.afectada;
  const etaAntes = fechaCorta(grupo?.eta?.antes);
  const etaAhora = fechaCorta(grupo?.eta?.ahora);
  const identidad = [grupo?.cliente, grupo?.proyecto].filter(Boolean);
  const hayFacturacion = !!grupo?.facturacion?.mes;
  let claseFact = 'mq-oor-facturacion';
  let sufijo = '';
  if (afectada === true) {
    claseFact += ' mq-oor-facturacion-afectada';
    sufijo = ' — queda antes de la nueva llegada: revisa la configuración';
  } else if (afectada === false) {
    sufijo = ' — sigue calzando';
  } else if (!hayFacturacion || afectada === null) {
    claseFact += ' mq-oor-facturacion-apagada';
  }
  return (
    <section
      aria-label={`BO ${grupo?.bo ?? ''}`}
      className={`mq-oor-tarjeta${afectada === true ? ' mq-oor-tarjeta-alerta' : ''}`}
    >
      <div className='mq-oor-cabecera'>
        <p className='mq-oor-bo m-0'>
          <strong>BO {grupo?.bo}</strong>
          {identidad.map((t) => <span key={t}> · {t}</span>)}
        </p>
        {onAbrirOrden && (
          <button type='button' className='mq-btn mq-btn-xs mq-btn-secundario' onClick={() => onAbrirOrden(grupo?.bo)}>
            Ver en Órdenes
          </button>
        )}
      </div>
      <div className='mq-oor-titular'>
        <h3>{titularDeBo(grupo)}</h3>
        {dias && <span className={`mq-oor-dias ${claseDias}`}>{dias}</span>}
      </div>
      <div className='mq-oor-detalle'>
        {etaAhora && <span>Llegada estimada: {etaAntes ? `${etaAntes} → ${etaAhora}` : etaAhora}</span>}
        {grupo?.poAxis && <span>PO Axis {grupo.poAxis}</span>}
        {grupo?.compartida && <span>PO compartida con otra BO</span>}
      </div>
      <p className={claseFact}>{textoFacturacion(grupo?.facturacion)}{sufijo}</p>
      <TablaLineas lineas={grupo?.lineas} etiqueta={`Líneas de la BO ${grupo?.bo ?? ''}`} />
    </section>
  );
}

function Indicador({ nombre, valor, alerta }) {
  return (
    <div className={`mq-oor-indicador${alerta ? ' mq-oor-indicador-alerta' : ''}`}>
      <dt>{nombre}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

export default function CambiosOorDialogo({ datos, onCerrar, onMarcarVisto, marcando = false, soloLectura = false, onAbrirOrden }) {
  const [filtro, setFiltro] = useState('');
  const ind = indicadoresDe(datos);
  const conteos = conteosDeFiltros(datos);
  const grupos = filtrarGrupos(datos, filtro);
  const sinBo = lista(datos?.sinBo).filter((p) => lista(p?.lineas).length > 0);
  const avisos = lista(datos?.avisos);

  const desde = fechaHora(datos?.desde?.tomado_en);
  const hasta = fechaHora(datos?.hasta?.tomado_en);
  const partes = [];
  if (soloLectura && datos?.visto_en) partes.push(`Revisado el ${fechaHora(datos.visto_en)}.`);
  if (desde) partes.push(`Comparado con ${soloLectura ? 'la versión del' : 'lo que revisaste el'} ${desde}.`);
  if (hasta) partes.push(`Versión nueva del ${hasta}.`);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resumenEnTexto(datos));
      notify('Resumen copiado al portapapeles', { tipo: 'ok' });
    } catch {
      notify('No se pudo copiar el resumen', { tipo: 'error' });
    }
  };

  return (
    <Dialogo titulo='Cambió el OOR' descripcion={partes.join(' ')} onCerrar={onCerrar} ancho='max-w-5xl'>
      <div className='mq-oor'>
        <dl className='mq-oor-indicadores' aria-label='Resumen de cambios'>
          <Indicador nombre='BO con cambios' valor={ind.bos} />
          <Indicador nombre='BO atrasadas' valor={ind.bosAtrasadas} />
          <Indicador nombre='BO con facturación afectada' valor={ind.bosConFacturacionAfectada} alerta={ind.bosConFacturacionAfectada > 0} />
          <Indicador nombre='Líneas atrasadas' valor={ind.atraso} />
          <Indicador nombre='Líneas adelantadas' valor={ind.adelanto} />
          <Indicador nombre='Líneas nuevas' valor={ind.nueva} />
          <Indicador nombre='Líneas cerradas' valor={ind.cerrada} />
          <Indicador nombre='Líneas sin BO' valor={ind.lineasSinBo} />
        </dl>

        <div className='mq-oor-filtros' role='group' aria-label='Filtrar cambios'>
          {FILTROS.map((f) => (
            <button
              key={f.clave || 'todo'}
              type='button'
              className='mq-oor-filtro'
              aria-pressed={filtro === f.clave}
              onClick={() => setFiltro(f.clave)}
            >
              {f.nombre} <span className='mq-oor-filtro-n'>{conteos[f.conteo]}</span>
            </button>
          ))}
        </div>

        {grupos.length === 0 && lista(datos?.grupos).length > 0 && (
          <p className='mq-oor-vacio'>No hay BO con este filtro.</p>
        )}
        {grupos.map((g, i) => (
          <TarjetaBo key={`${g?.bo}-${i}`} grupo={g} onAbrirOrden={onAbrirOrden} />
        ))}

        {sinBo.length > 0 && (
          <section aria-label='Cambios de PO sin BO asociada' className='flex flex-col gap-3'>
            <h3 className='mq-oor-seccion-titulo'>Cambios de PO sin BO asociada</h3>
            {sinBo.map((p, i) => (
              <section key={`${p?.po}-${i}`} aria-label={`PO ${p?.po ?? ''}`} className='mq-oor-tarjeta'>
                <p className='mq-oor-bo m-0'><strong>PO Axis {p?.po}</strong></p>
                <TablaLineas lineas={p?.lineas} etiqueta={`Líneas del PO ${p?.po ?? ''}`} />
                <p className='mq-oor-ayuda'>Asocia este PO Axis a su BO en Órdenes para verlo cruzado.</p>
              </section>
            ))}
          </section>
        )}

        {avisos.length > 0 && (
          <div role='note' aria-label='Avisos del OOR'>
            <ul className='mq-oor-avisos'>
              {avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}

        <div className='mq-oor-pie'>
          <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={copiar}>Copiar resumen</button>
          {soloLectura ? (
            <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={onCerrar}>Cerrar</button>
          ) : (
            <>
              <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={onCerrar}>Más tarde</button>
              <button type='button' className='mq-btn mq-btn-sm mq-btn-primario' disabled={marcando} onClick={() => onMarcarVisto?.()}>
                Marcar como revisado
              </button>
            </>
          )}
        </div>
      </div>
    </Dialogo>
  );
}

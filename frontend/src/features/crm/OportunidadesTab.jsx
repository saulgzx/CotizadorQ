import React, { useEffect, useState } from 'react';
import ArbolTab from './ArbolTab';
import MapaTab from './MapaTab';
import OportunidadPanel from './OportunidadPanel';
import './arbol.css';

const CLAVE_PREFERENCIAS = 'crmOportunidades';

export const VISTAS = [
  { clave: 'mapa', nombre: 'Mapa' },
  { clave: 'tabla', nombre: 'Tabla' }
];

const vistaGuardada = () => {
  try {
    const crudo = JSON.parse(window.localStorage.getItem(CLAVE_PREFERENCIAS) || 'null');
    return VISTAS.some((v) => v.clave === crudo?.vista) ? crudo.vista : 'mapa';
  } catch {
    return 'mapa';
  }
};

const guardarVista = (vista) => {
  try {
    window.localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify({ vista }));
  } catch {
    // Sin almacenamiento (modo privado, cuota): la vista funciona igual, sin recordarse.
  }
};

/**
 * Pestaña Oportunidades del CRM: el mapa de tarjetas o la tabla-árbol (se recuerda la última),
 * y el panel de detalle de la oportunidad que se abre desde cualquiera de las dos.
 */
export default function OportunidadesTab({ inputBusquedaRef, onAbrirEmpresa, onAbrirCotizacion }) {
  const [vista, setVista] = useState(vistaGuardada);
  const [panelId, setPanelId] = useState(null);

  useEffect(() => {
    guardarVista(vista);
  }, [vista]);

  const teclearVista = (e) => {
    const i = VISTAS.findIndex((v) => v.clave === vista);
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    setVista(VISTAS[(i + paso + VISTAS.length) % VISTAS.length].clave);
    const grupo = e.currentTarget;
    setTimeout(() => grupo.querySelector('[aria-checked="true"]')?.focus(), 0);
  };

  const comunes = { inputBusquedaRef, onAbrirEmpresa, onAbrirCotizacion, onAbrirOportunidad: setPanelId };

  return (
    <div className='space-y-3'>
      <div className='flex justify-end'>
        <div role='radiogroup' aria-label='Vista' className='mq-arbol-segmentos' onKeyDown={teclearVista}>
          {VISTAS.map((v) => (
            <button
              key={v.clave}
              type='button'
              role='radio'
              aria-checked={vista === v.clave}
              tabIndex={vista === v.clave ? 0 : -1}
              className='mq-arbol-segmento'
              onClick={() => setVista(v.clave)}
            >
              {v.nombre}
            </button>
          ))}
        </div>
      </div>

      {vista === 'mapa' ? <MapaTab {...comunes} /> : <ArbolTab {...comunes} />}

      {panelId != null && (
        <OportunidadPanel
          oportunidadId={panelId}
          onCerrar={() => setPanelId(null)}
          onAbrirEmpresa={onAbrirEmpresa}
          onAbrirCotizacion={onAbrirCotizacion}
        />
      )}
    </div>
  );
}

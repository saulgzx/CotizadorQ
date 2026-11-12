import React, { useCallback, useRef, useState } from 'react';
import EncabezadoPagina from '../ui/EncabezadoPagina';
import EmbudoTab from './EmbudoTab';
import ResumenTab from './ResumenTab';
import SeguimientoTab from './SeguimientoTab';
import EmpresasTab from './EmpresasTab';
import FichaEmpresa from './FichaEmpresa';
import FusionDuplicados from './FusionDuplicados';
import { EmpresaDialogo, OportunidadDialogo } from './DialogosCrm';
import useAtajosCrm from './useAtajosCrm';

const TABS = [
  { clave: 'resumen', nombre: 'Resumen' },
  { clave: 'embudo', nombre: 'Embudo' },
  { clave: 'empresas', nombre: 'Empresas' },
  { clave: 'seguimiento', nombre: 'Seguimiento automático' }
];

export default function CrmView({ onAbrirCotizacion }) {
  const [tab, setTab] = useState('resumen');
  const [empresaId, setEmpresaId] = useState(null);
  const [fusion, setFusion] = useState(false);
  const [dialogo, setDialogo] = useState(null);
  const busquedaRef = useRef(null);
  const crearFichaRef = useRef(null);
  const registrarCrear = useCallback((fn) => {
    crearFichaRef.current = fn;
  }, []);

  const abrirEmpresa = (id) => {
    setTab('empresas');
    setFusion(false);
    setEmpresaId(id);
  };
  const cambiarTab = (clave) => {
    setTab(clave);
    setEmpresaId(null);
    setFusion(false);
  };

  const crear = () => {
    if (tab !== 'empresas') setDialogo('oportunidad');
    else if (empresaId && crearFichaRef.current) crearFichaRef.current();
    else if (!fusion) setDialogo('empresa');
  };

  useAtajosCrm({
    onBuscar: () => busquedaRef.current?.focus(),
    onCrear: crear
  });

  return (
    <div className='space-y-4 view-enter'>
      <EncabezadoPagina seccion='Ventas' titulo='CRM' subtitulo='Empresas, contactos y oportunidades de tus cotizaciones.'>
        <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={() => setDialogo('empresa')}>Nueva empresa</button>
        <button type='button' className='mq-btn mq-btn-sm mq-btn-primario' onClick={() => setDialogo('oportunidad')}>Nueva oportunidad</button>
      </EncabezadoPagina>

      <div role='tablist' aria-label='Secciones del CRM' className='mq-pestanas'>
        {TABS.map((t) => (
          <button
            key={t.clave}
            type='button'
            role='tab'
            id={`crm-tab-${t.clave}`}
            aria-selected={tab === t.clave}
            aria-controls='crm-panel'
            onClick={() => cambiarTab(t.clave)}
            className='mq-pestana'
          >
            {t.nombre}
          </button>
        ))}
      </div>

      <div id='crm-panel' role='tabpanel' aria-labelledby={`crm-tab-${tab}`} key={tab} className='mq-panel-entra'>
        {tab === 'resumen' && <ResumenTab onAbrirEmpresa={abrirEmpresa} onIrA={cambiarTab} />}
        {tab === 'seguimiento' && <SeguimientoTab onAbrirCotizacion={onAbrirCotizacion} />}
        {tab === 'embudo' && <EmbudoTab inputBusquedaRef={busquedaRef} onAbrirEmpresa={abrirEmpresa} />}
        {tab === 'empresas' && empresaId && (
          <FichaEmpresa
            empresaId={empresaId}
            onVolver={() => setEmpresaId(null)}
            onAbrirCotizacion={onAbrirCotizacion}
            registrarCrear={registrarCrear}
          />
        )}
        {tab === 'empresas' && !empresaId && fusion && <FusionDuplicados onVolver={() => setFusion(false)} />}
        {tab === 'empresas' && !empresaId && !fusion && (
          <EmpresasTab
            inputBusquedaRef={busquedaRef}
            onAbrirEmpresa={abrirEmpresa}
            onRevisarDuplicados={() => setFusion(true)}
            onCrear={() => setDialogo('empresa')}
          />
        )}
      </div>

      {dialogo === 'empresa' && (
        <EmpresaDialogo onCerrar={() => setDialogo(null)} onAbrirExistente={abrirEmpresa} onGuardada={(emp) => emp?.id && abrirEmpresa(emp.id)} />
      )}
      {dialogo === 'oportunidad' && <OportunidadDialogo onCerrar={() => setDialogo(null)} />}
    </div>
  );
}

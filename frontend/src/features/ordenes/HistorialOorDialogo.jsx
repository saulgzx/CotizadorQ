import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Dialogo from '../crm/Dialogo';
import CambiosOorDialogo from './CambiosOorDialogo';
import { oorApi } from './oorApi';
import { queryKeys } from '../../app/queryKeys';
import { fechaHora } from './cambiosOor';
import './cambiosOor.css';

const nombreDeRevision = (rev) => `Revisado el ${fechaHora(rev?.visto_en) || 'fecha desconocida'}`;

// Historial de los cambios del OOR que ya se revisaron. Al elegir uno se abre su detalle
// en solo lectura.
export default function HistorialOorDialogo({ onCerrar, onAbrirOrden }) {
  const [elegida, setElegida] = useState(null);
  const historial = useQuery({
    queryKey: queryKeys.oor.historial,
    queryFn: () => oorApi.historial(),
    retry: false
  });
  const revision = useQuery({
    queryKey: queryKeys.oor.revision(elegida),
    queryFn: () => oorApi.revision(elegida),
    enabled: elegida != null,
    retry: false
  });

  const items = Array.isArray(historial.data?.items) ? historial.data.items : [];
  const detalle = elegida != null && revision.data?.hay !== false ? revision.data : null;

  return (
    <>
      <Dialogo titulo='Cambios del OOR revisados' descripcion='Cada vez que marcas los cambios como revisados queda aquí.' onCerrar={onCerrar} ancho='max-w-2xl'>
        <div className='mq-oor'>
          {historial.isPending && <p className='mq-oor-vacio'>Cargando…</p>}
          {historial.isError && <p className='mq-oor-vacio' role='alert'>No se pudo cargar el historial: {historial.error?.message}</p>}
          {historial.isSuccess && items.length === 0 && <p className='mq-oor-vacio'>Aún no hay cambios revisados.</p>}
          {items.length > 0 && (
            <ul className='mq-oor-historial' aria-label='Revisiones'>
              {items.map((rev) => {
                const r = rev?.resumen || {};
                return (
                  <li key={rev.id}>
                    <button type='button' className='mq-oor-historial-item' onClick={() => setElegida(rev.id)}>
                      <span className='font-medium'>{nombreDeRevision(rev)}</span>
                      <span className='mq-oor-historial-meta'>
                        {r.bos ?? 0} BO con cambios · {r.bosAtrasadas ?? 0} atrasadas · {r.bosConFacturacionAfectada ?? 0} con facturación afectada
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {elegida != null && revision.isPending && <p className='mq-oor-vacio'>Cargando revisión…</p>}
          {elegida != null && revision.isError && (
            <p className='mq-oor-vacio' role='alert'>No se pudo cargar la revisión: {revision.error?.message}</p>
          )}
        </div>
      </Dialogo>
      {detalle && (
        <CambiosOorDialogo
          datos={detalle}
          soloLectura
          onCerrar={() => setElegida(null)}
          onAbrirOrden={onAbrirOrden ? (bo) => { onCerrar(); onAbrirOrden(bo); } : undefined}
        />
      )}
    </>
  );
}

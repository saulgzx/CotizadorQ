import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { oorApi } from './oorApi';
import { queryKeys } from '../../app/queryKeys';
import { notify } from '../ui/toast';

// AvisoCambiosOor escucha este evento para abrir el pop-up ignorando lo pospuesto.
export const EVENTO_ABRIR_CAMBIOS_OOR = 'oor:abrir-cambios';

const primerAviso = (r) => (Array.isArray(r?.avisos) && r.avisos[0] ? ` ${r.avisos[0]}` : '');

// Lee el OOR en ese momento y avisa el resultado. Es una acción explícita: los errores SÍ se muestran.
export function useActualizarOor() {
  const queryClient = useQueryClient();
  const mutacion = useMutation({
    mutationFn: () => oorApi.actualizar(),
    onSuccess: (r) => {
      const lineas = r?.lineas ?? 0;
      if (r?.hay === true) {
        // Misma caché que usa AvisoCambiosOor: así hay un solo pop-up.
        queryClient.setQueryData(queryKeys.oor.pendiente, r);
        try {
          sessionStorage.removeItem('oorPospuesto');
        } catch {
          /* sin sessionStorage */
        }
        window.dispatchEvent(new Event(EVENTO_ABRIR_CAMBIOS_OOR));
      } else if (r?.motivo === 'primera_vez') {
        notify(`Primera lectura del OOR guardada (${lineas} líneas). Desde ahora, al actualizarlo verás qué cambió.`, { tipo: 'ok' });
      } else if (r?.motivo === 'sin_datos') {
        notify(`La pestaña OOR está vacía o no se pudo leer.${primerAviso(r)}`, { tipo: 'error' });
      } else {
        notify(`El OOR no tiene cambios desde tu última revisión (${lineas} líneas leídas)`, { tipo: 'ok' });
      }
    },
    onError: (error) => notify(error?.message || 'No se pudo leer el OOR', { tipo: 'error' })
  });
  return { actualizar: () => mutacion.mutate(), leyendo: mutacion.isPending };
}

export default function BotonActualizarOor({ className = 'mq-btn mq-btn-sm mq-btn-secundario' }) {
  const { actualizar, leyendo } = useActualizarOor();
  return (
    <button type='button' className={className} disabled={leyendo} onClick={actualizar}>
      {leyendo ? 'Leyendo OOR…' : 'Actualizar OOR'}
    </button>
  );
}

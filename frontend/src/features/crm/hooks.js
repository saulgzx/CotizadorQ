import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { notify } from '../ui/toast';
import { mensajeError, nombreEtapa } from './formato';

const aplicarEtapa = (op, id, etapa, motivo) =>
  op.id === id
    ? { ...op, etapa, dias_en_etapa: 0, motivo_perdida: etapa === 'perdida' ? motivo || op.motivo_perdida : op.motivo_perdida }
    : op;

/**
 * Cambio de etapa optimista: mueve la oportunidad en el embudo y en las fichas
 * abiertas al instante y, si el servidor falla, devuelve todo como estaba.
 */
export function useCambiarEtapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, etapa, motivo_perdida: motivo }) =>
      crmApi.actualizarOportunidad(id, { etapa, ...(etapa === 'perdida' ? { motivo_perdida: motivo } : {}) }),
    onMutate: async ({ id, etapa, motivo_perdida: motivo }) => {
      await qc.cancelQueries({ queryKey: queryKeys.crm.todo });
      const previos = qc.getQueriesData({ queryKey: queryKeys.crm.todo });
      qc.setQueriesData({ queryKey: queryKeys.crm.oportunidades }, (data) =>
        data?.items ? { ...data, items: data.items.map((op) => aplicarEtapa(op, id, etapa, motivo)) } : data
      );
      qc.setQueriesData({ queryKey: ['crm', 'empresa'] }, (data) =>
        data?.oportunidades
          ? { ...data, oportunidades: data.oportunidades.map((op) => aplicarEtapa(op, id, etapa, motivo)) }
          : data
      );
      return { previos };
    },
    onError: (error, vars, contexto) => {
      (contexto?.previos || []).forEach(([clave, data]) => qc.setQueryData(clave, data));
      notify(`No se pudo mover a ${nombreEtapa(vars.etapa)}: ${mensajeError(error)}`, { tipo: 'error' });
    },
    onSuccess: (_data, vars) => {
      notify(`Oportunidad movida a ${nombreEtapa(vars.etapa)}`, { tipo: 'ok' });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.crm.todo });
      // La etapa de la oportunidad es la de su cotización: la lista de Cotizaciones también cambia.
      qc.invalidateQueries({ queryKey: queryKeys.cotizaciones });
    }
  });
}

/**
 * Refleja las órdenes vigentes (pestaña OSO) como oportunidades ganadas.
 * Es idempotente en el backend, así que se puede apretar sin miedo a duplicar.
 */
export function useSincronizarOrdenes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => crmApi.sincronizarOrdenes(),
    onSuccess: (r) => {
      const nuevas = (r?.creadas || 0) + (r?.enlazadas || 0) + (r?.ganadas || 0);
      const partes = [];
      if (r?.creadas) partes.push(`${r.creadas} nueva${r.creadas === 1 ? '' : 's'}`);
      if (r?.enlazadas) partes.push(`${r.enlazadas} enlazada${r.enlazadas === 1 ? '' : 's'}`);
      if (r?.ganadas) partes.push(`${r.ganadas} ganada${r.ganadas === 1 ? '' : 's'}`);
      if (r?.sinCliente) partes.push(`${r.sinCliente} sin cliente`);
      if (r?.errores) partes.push(`${r.errores} con error`);
      notify(
        nuevas || partes.length
          ? `${r.ordenes} órdenes revisadas: ${partes.join(', ')}`
          : `${r?.ordenes || 0} órdenes revisadas, el embudo ya estaba al día`,
        { tipo: r?.errores ? 'error' : 'ok' }
      );
    },
    onError: (error) => {
      notify(`No se pudieron sincronizar las órdenes: ${mensajeError(error)}`, { tipo: 'error' });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.crm.todo });
      qc.invalidateQueries({ queryKey: queryKeys.cotizaciones });
    }
  });
}

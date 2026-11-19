import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { notify } from '../ui/toast';
import { mensajeError, nombreEtapa } from './formato';

// Al ganar o perder, el servidor borra el seguimiento: la pantalla lo refleja sin esperarlo.
const aplicarEtapa = (op, id, etapa, motivo) =>
  op.id === id
    ? {
        ...op,
        etapa,
        dias_en_etapa: 0,
        motivo_perdida: etapa === 'perdida' ? motivo || op.motivo_perdida : op.motivo_perdida,
        ...(etapa === 'ganada' || etapa === 'perdida' ? { proximo_seguimiento: null, seguimiento_nota: null } : {})
      }
    : op;

// Aplica `parche(op)` a la oportunidad `id` en todas las cachés del CRM que la contienen.
const parchearOportunidad = (qc, id, parche) => {
  const aplicar = (op) => (op.id === id ? parche(op) : op);
  qc.setQueriesData({ queryKey: queryKeys.crm.oportunidades }, (data) =>
    data?.items ? { ...data, items: data.items.map(aplicar) } : data
  );
  qc.setQueriesData({ queryKey: queryKeys.crm.arbol }, (data) =>
    data?.oportunidades ? { ...data, oportunidades: data.oportunidades.map(aplicar) } : data
  );
  qc.setQueriesData({ queryKey: ['crm', 'empresa'] }, (data) =>
    data?.oportunidades ? { ...data, oportunidades: data.oportunidades.map(aplicar) } : data
  );
};

/**
 * Cambio de etapa optimista: mueve la oportunidad en el embudo, el árbol y las fichas
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
      parchearOportunidad(qc, id, (op) => aplicarEtapa(op, id, etapa, motivo));
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
 * Guarda la fecha del próximo seguimiento y su nota (ambas null = sin seguimiento).
 * Optimista como el cambio de etapa: si el servidor falla, devuelve todo como estaba.
 */
export function useGuardarSeguimiento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, proximo_seguimiento, seguimiento_nota }) =>
      crmApi.actualizarOportunidad(id, { proximo_seguimiento, seguimiento_nota }),
    onMutate: async ({ id, proximo_seguimiento: fecha, seguimiento_nota: nota }) => {
      await qc.cancelQueries({ queryKey: queryKeys.crm.todo });
      const previos = qc.getQueriesData({ queryKey: queryKeys.crm.todo });
      parchearOportunidad(qc, id, (op) => ({ ...op, proximo_seguimiento: fecha ?? null, seguimiento_nota: nota ?? null }));
      return { previos };
    },
    onError: (error, _vars, contexto) => {
      (contexto?.previos || []).forEach(([clave, data]) => qc.setQueryData(clave, data));
      notify(`No se pudo guardar el seguimiento: ${mensajeError(error)}`, { tipo: 'error' });
    },
    onSuccess: (_data, vars) => {
      notify(vars.proximo_seguimiento ? 'Seguimiento guardado' : 'Seguimiento quitado', { tipo: 'ok' });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.crm.todo });
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

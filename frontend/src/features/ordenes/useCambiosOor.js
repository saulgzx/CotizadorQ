import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { oorApi } from './oorApi';
import { queryKeys } from '../../app/queryKeys';
import { notify } from '../ui/toast';

const MIN_ESPERA_SEG = 15;
const MAX_ESPERA_SEG = 180;

// Cuánto esperar para volver a preguntar cuando el servidor dice "estabilizando"
// (la pestaña cambió hace poco y puede estar a medio pegar). null = lo normal .
export const esperaDeEstabilizando = (datos) => {
  if (datos?.hay !== false || datos?.motivo !== 'estabilizando') return null;
  const seg = Number(datos.revisar_en_seg);
  const base = Number.isFinite(seg) ? seg : MIN_ESPERA_SEG;
  return Math.min(MAX_ESPERA_SEG, Math.max(MIN_ESPERA_SEG, base)) * 1000;
};

// Consulta de los cambios pendientes del OOR al entrar a la app. Un error de red no se muestra: se
// vuelve a intentar en la siguiente vuelta.
export function useCambiosOor({ activo }) {
  const queryClient = useQueryClient();

  const consulta = useQuery({
    queryKey: queryKeys.oor.pendiente,
    queryFn: () => oorApi.pendiente(),
    enabled: !!activo,
    retry: false,
    // Una sola consulta al entrar (solo mira la base de datos). La lectura de la planilla la
    // dispara el botón «Actualizar OOR»; solo se repite si el servidor dice «estabilizando».
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) => esperaDeEstabilizando(query.state.data) ?? false
  });

  const mutacion = useMutation({
    mutationFn: (hastaId) => oorApi.marcarVisto(hastaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.oor.todo });
    }
  });

  const datos = activo ? consulta.data ?? null : null;
  const hay = datos?.hay === true;

  // Devuelve true si quedó marcado; si falla avisa el error y deja el pop-up abierto.
  const marcarVisto = useCallback(async () => {
    const hastaId = datos?.hasta?.id;
    if (hastaId == null) return false;
    try {
      await mutacion.mutateAsync(hastaId);
      notify('Cambios del OOR marcados como revisados', { tipo: 'ok' });
      return true;
    } catch (error) {
      notify(error?.message || 'No se pudo marcar como revisado', { tipo: 'error' });
      return false;
    }
  }, [datos, mutacion]);

  return { datos, hay, marcarVisto, marcando: mutacion.isPending };
}
